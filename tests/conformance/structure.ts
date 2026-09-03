/**
 * Block structure against the oracle (issue #30): does our AST model
 * a document's BLOCK STRUCTURE the way Asciidoctor does?
 *
 * The crash and idempotency properties ask whether formatting blows
 * up or fails to settle; the fidelity property asks whether it changes
 * what Asciidoctor renders. All three (issue #7) are properties of our
 * OUTPUT. This is a property of our PARSE, and it holds before any
 * formatting happens: a document can round-trip byte-clean, render
 * identically and still be modelled as a tree the oracle never built.
 *
 * WHAT IT PROVES, exactly: both sides are projected onto ONE canonical
 * tree of KIND-ONLY nodes ({@link Shape}), and the two trees must be
 * equal as trees of kinds - kind, child order, nesting, count.
 *
 * WHAT IT DOES NOT PROVE, and the reason this paragraph is here: node
 * identity is the KIND ALONE. A document can agree here while its
 * titles, ids, roles, styles, options, verbatim text, table cells and
 * every inline span are all wrong. Kind-only is what makes the
 * comparison cost about two hundred lines of statements about the two
 * MODELS rather than a canonicalization of every text-carrying field
 * (measured: comparing verbatim content adds two folds and returns
 * only re-indentation and preprocessor-unescape noise). Read a green
 * run as "the block skeleton agrees", never as "the parse is right".
 *
 * Two more limits by construction:
 *
 * - INCLUDES CONTRIBUTE NOTHING. A no-op include processor makes the
 *   oracle's reader push an empty file for every `include::` target,
 *   because a formatter cannot resolve an include either. Bugs that
 *   live in included content are invisible here.
 * - Verbatim and table CONTENT is opaque on both sides: our AST holds
 *   it as one slice, so the oracle is not descended into for
 *   `listing`, `literal`, `pass`, `verse`, `stem` or `table`.
 *
 * Lives under `tests/` because it imports both `src/parser.js` and the
 * oracle, and both `scripts/block-structure.ts` and
 * `tests/conformance/structure.test.ts` import it - the same shape as
 * `tests/conformance/loader.ts`, which `scripts/conformance-triage.ts`
 * already imports.
 */
import {
  AbstractBlock,
  Extensions,
  List,
  LoggerManager,
  NullLogger,
  load,
} from "@asciidoctor/core";
import type { AdmonitionNode, BlockNode, ListNode } from "../../src/ast.js";
import { parse } from "../../src/parser.js";

const nullLogger = NullLogger.create();
LoggerManager.setLogger(nullLogger);

// An include contributes NOTHING to the oracle's tree, which is what
// our AST models - a directive node we drop. Without this the oracle
// either splices a file in or leaves an "Unresolved directive in ..."
// paragraph, and our model can never agree with either.
const registry = Extensions.create();
registry.includeProcessor(function () {
  this.handles(() => true);
  this.process((_document, reader, target) => {
    reader.pushInclude("", target, target, 1, {});
  });
});

// Built once, outside the call: `load`'s typed options do not name
// `extension_registry`, and an object literal at the call site would
// meet the excess-property check.
const LOAD_OPTIONS = {
  safe: "safe",
  logger: nullLogger,
  extension_registry: registry,
};

// The level `= Title` spells, on both sides: the oracle's own header
// title and our documentHeader node are the same leaf.
const DOCUMENT_TITLE_LEVEL = 0;

/** One node of the canonical tree. The kind is the WHOLE identity. */
export interface Shape {
  /** The canonical kind, from the closed alphabet the mapping names. */
  kind: string;
  /** Child shapes, in document order. */
  children: Shape[];
}

/**
 * A childless shape.
 * @param kind - the canonical kind
 * @returns the leaf
 */
function leaf(kind: string): Shape {
  return { kind, children: [] };
}

/**
 * A heading's identity: the bare kind, or the kind with its level when
 * the caller asked for levels.
 *
 * Levels are OFF by default, and that was measured rather than
 * assumed: turning them on moves the corpus from 412 diverging
 * documents to 420, and all eight extra documents are `:leveloffset:`
 * arithmetic and `:doctype: book` special-section promotion -
 * attribute-driven resolutions a formatter must not perform.
 * @param level - the level the side reports, if any
 * @param levels - whether the level is part of the identity
 * @returns the heading kind
 */
function headingKind(level: number | null, levels: boolean): string {
  return levels ? `heading:${String(level)}` : "heading";
}

// ------------------------------------------------------------ oracle

/**
 * Every oracle context this mapping NAMES, and the canonical kind it
 * folds to. CLOSED: a context outside it becomes `?<context>`, which
 * can never match anything on our side, so a construct the oracle
 * learns fails loudly instead of comparing equal by accident.
 *
 * Three entries fold: `stem` joins `pass` (`[stem]`, `[latexmath]`
 * and `[asciimath]` are pass-content blocks in our model), and
 * `section` and `floating_title` both become `heading` - after the
 * section splice below, the discrete/structural distinction is not
 * observable. `dlist` and `dlistItem` are named but have NO
 * counterpart on our side (#9): that is the point, it makes the gap
 * explicit rather than hiding it.
 */
const ORACLE_KINDS: ReadonlyMap<string, string> = new Map([
  ["document", "document"],
  ["paragraph", "paragraph"],
  ["ulist", "list:unordered"],
  ["olist", "list:ordered"],
  ["colist", "list:callout"],
  ["dlist", "dlist"],
  ["list_item", "item"],
  ["listing", "listing"],
  ["literal", "literal"],
  ["pass", "pass"],
  ["stem", "pass"],
  ["verse", "verse"],
  ["table", "table"],
  ["example", "example"],
  ["sidebar", "sidebar"],
  ["open", "open"],
  ["quote", "quote"],
  ["admonition", "admonition"],
  ["thematic_break", "thematic_break"],
  ["page_break", "page_break"],
  ["image", "image"],
  ["video", "video"],
  ["audio", "audio"],
  ["toc", "toc"],
  ["section", "heading"],
  ["floating_title", "heading"],
  ["preamble", "preamble"],
]);

/**
 * The contexts whose CONTENT our AST holds as one opaque slice, so the
 * comparison must not descend into them on either side.
 */
const OPAQUE = new Set([
  "listing",
  "literal",
  "pass",
  "verse",
  "stem",
  "table",
]);

/**
 * Narrow an unknown value to an oracle block.
 *
 * A dlist item is a `[terms, description]` tuple whose second entry is
 * a block or null, and nothing in the typings says so.
 * @param value - anything reachable from the oracle's tree
 * @returns whether it is an oracle block
 */
function isBlock(value: unknown): value is AbstractBlock {
  return value instanceof AbstractBlock;
}

/**
 * Narrow an unknown value to an array of unknowns - the dlist item's
 * tuple. A guard rather than a bare `Array.isArray`, which narrows to
 * `any[]` and trips `no-unsafe-assignment` the moment it is stored.
 * @param value - one entry of a list's items
 * @returns whether it is a tuple rather than a plain item
 */
function isTuple(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/**
 * One list item, on the oracle side. An outline item's children are
 * the blocks ATTACHED to it - its principal text is not a child on
 * either side, which is what makes item-level comparison meaningful.
 * @param entry - one entry of `getItems()`: an item, or a dlist tuple
 * @param levels - whether heading levels are part of the identity
 * @returns the item's shape
 */
function oracleItem(entry: unknown, levels: boolean): Shape {
  if (isTuple(entry)) {
    const [, description] = entry;
    return {
      kind: "dlistItem",
      children: isBlock(description) ? oracleKids(description, levels) : [],
    };
  }
  return {
    kind: "item",
    children: isBlock(entry) ? oracleKids(entry, levels) : [],
  };
}

/**
 * One oracle block's children, canonicalized.
 * @param node - the oracle block
 * @param levels - whether heading levels are part of the identity
 * @returns its child shapes, in document order
 */
function oracleKids(node: AbstractBlock, levels: boolean): Shape[] {
  if (node instanceof List) {
    return node.getItems().map((entry) => oracleItem(entry, levels));
  }
  if (OPAQUE.has(node.getContext())) {
    return [];
  }
  return node.getBlocks().flatMap((child) => oracleShape(child, levels));
}

/**
 * One oracle block, canonicalized - a LIST of shapes, because two
 * contexts splice rather than map:
 *
 * - `section` becomes `[heading, ...its children]` in its parent's
 *   child list, because our AST does not model sections (`HeadingNode`
 *   is a leaf by design). Precedent: `foldSectionAndHeadingShapes` in
 *   `scripts/parity-ledger.ts` does the same fold for parity.
 * - `preamble` splices its children and drops the wrapper: it appears
 *   only when a titled document has sections, and nothing in our model
 *   corresponds to it.
 * @param node - the oracle block
 * @param levels - whether heading levels are part of the identity
 * @returns the shapes it contributes to its parent's child list
 */
function oracleShape(node: AbstractBlock, levels: boolean): Shape[] {
  const context = node.getContext();
  const kind = ORACLE_KINDS.get(context);
  if (kind === undefined) {
    return [leaf(`?${context}`)];
  }
  if (context === "section") {
    return [
      leaf(headingKind(node.getLevel(), levels)),
      ...oracleKids(node, levels),
    ];
  }
  if (context === "preamble") {
    return oracleKids(node, levels);
  }
  if (context === "floating_title") {
    return [leaf(headingKind(node.getLevel(), levels))];
  }
  return [{ kind, children: oracleKids(node, levels) }];
}

/**
 * The oracle's canonical tree for one document.
 *
 * The document title is emitted from `hasHeader()` plus a non-null
 * header title, NOT from `getDocumentTitle()`: that also returns a
 * title set by the `:doctitle:` attribute, which would silently absorb
 * the `oracle:doctitle-attribute` family instead of naming it.
 * @param input - the document source
 * @param levels - whether heading levels are part of the identity
 * @returns the canonical tree
 */
export async function oracleTree(
  input: string,
  levels = false,
): Promise<Shape> {
  return oracleDocumentShape(await load(input, LOAD_OPTIONS), levels);
}

/**
 * The oracle's canonical tree, or undefined when Asciidoctor itself
 * refuses to load the document.
 *
 * The `try` wraps the `load()` call and NOTHING else: a failure in
 * {@link oracleDocumentShape} below is a bug in this mapping, and
 * charging it to the oracle would drop that document from the
 * comparison under an expectation the caller reads as satisfied.
 * @param input - the document source
 * @param levels - whether heading levels are part of the identity
 * @returns the canonical tree, or undefined when `load()` threw
 */
export async function tryOracleTree(
  input: string,
  levels = false,
): Promise<Shape | undefined> {
  const document = await tryLoad(input);
  return document === undefined
    ? undefined
    : oracleDocumentShape(document, levels);
}

/**
 * `load()`, or undefined when Asciidoctor refuses the document. The
 * whole body of the `try` is the one call, so nothing else can be
 * mistaken for a refusal.
 * @param input - the document source
 * @returns the loaded document, or undefined when `load()` threw
 */
async function tryLoad(
  input: string,
): Promise<Awaited<ReturnType<typeof load>> | undefined> {
  try {
    return await load(input, LOAD_OPTIONS);
  } catch {
    return undefined;
  }
}

/**
 * Map a loaded oracle document onto the canonical tree.
 * @param document - what `load()` returned
 * @param levels - whether heading levels are part of the identity
 * @returns the canonical tree
 */
function oracleDocumentShape(
  document: Awaited<ReturnType<typeof load>>,
  levels: boolean,
): Shape {
  const header: unknown = document.getHeader();
  const title = isBlock(header) ? header.getTitle() : null;
  const children: Shape[] = [];
  if (document.hasHeader() && title !== null) {
    children.push(leaf(headingKind(DOCUMENT_TITLE_LEVEL, levels)));
  }
  children.push(...oracleKids(document, levels));
  return { kind: "document", children };
}

// --------------------------------------------------------- our side

/**
 * Node types that contribute NOTHING to the canonical tree, in two
 * groups with two different reasons.
 *
 * The metadata trio (`blockAttributeList`, `blockTitle`,
 * `blockAnchor`) is never a block on the oracle's side - it attaches
 * to the following block as attributes. Dropping it is sound in both
 * directions: if the oracle made a BLOCK out of text we called
 * metadata, that block shows up as an unmatched oracle child.
 *
 * The non-block trio (`comment`, `attributeEntry`,
 * `preprocessorDirective`) is eaten by Asciidoctor's reader before
 * `next_block` ever sees it (see `PreprocessorDirectiveNode`'s doc
 * comment in src/ast.ts); our AST keeps them only so the printer can
 * reproduce them.
 */
const DROPPED = new Set([
  "comment",
  "attributeEntry",
  "preprocessorDirective",
  "blockAttributeList",
  "blockTitle",
  "blockAnchor",
]);

/** Our node types that map to one canonical leaf kind and nothing else. */
const LEAF_KINDS: ReadonlyMap<string, string> = new Map([
  ["paragraph", "paragraph"],
  ["thematicBreak", "thematic_break"],
  ["pageBreak", "page_break"],
]);

/** The block-macro names that are a context of their own to the oracle. */
const MACRO_CONTEXTS = new Set(["image", "video", "audio", "toc"]);

/**
 * The five styles Ruby's `ADMONITION_STYLES` names. Any OTHER style
 * leaves the delimiter's own context and rides as `style`, which is
 * why a `[partintro]` or `[abstract]` wrapper folds to its form below.
 */
const ADMONITION_VARIANTS = new Set([
  "note",
  "tip",
  "important",
  "caution",
  "warning",
]);

/**
 * Every `type:` discriminant `src/ast.ts` declares, and what this
 * mapping does with it. The harness checks this census against the
 * file, so a node kind added to the AST fails the run until somebody
 * decides - in one line, here - what the comparison should do with it.
 */
export const AST_KIND_CENSUS: ReadonlyMap<string, string> = new Map([
  ["document", "the root"],
  ["paragraph", "kind paragraph"],
  ["text", "inline, out of scope"],
  ["bold", "inline, out of scope"],
  ["italic", "inline, out of scope"],
  ["monospace", "inline, out of scope"],
  ["highlight", "inline, out of scope"],
  ["curvedQuote", "inline, out of scope"],
  ["superscript", "inline, out of scope"],
  ["subscript", "inline, out of scope"],
  ["characterReference", "inline, out of scope"],
  ["attributeReference", "inline, out of scope"],
  ["link", "inline, out of scope"],
  ["xref", "inline, out of scope"],
  ["inlineAnchor", "inline, out of scope"],
  ["inlineMacro", "inline, out of scope"],
  ["hardLineBreak", "inline, out of scope"],
  ["passthrough", "inline, out of scope"],
  ["rawLine", "inline, out of scope"],
  ["heading", "kind heading"],
  ["discreteHeading", "kind heading"],
  ["documentHeader", "kind heading: the oracle's own doctitle leaf"],
  ["authorLine", "inside a header, which contributes its title alone"],
  ["revisionLine", "inside a header, which contributes its title alone"],
  ["comment", "dropped: the reader eats it"],
  ["attributeEntry", "dropped: the reader eats it"],
  ["preprocessorDirective", "dropped: the reader eats it"],
  ["list", "kind list:<variant>"],
  ["listItem", "kind item"],
  ["delimitedBlock", "kind <variant>"],
  ["parentBlock", "kind <variant>"],
  ["admonition", "kind admonition, or the wrapper's own kind"],
  ["thematicBreak", "kind thematic_break"],
  ["pageBreak", "kind page_break"],
  ["blockMacro", "kind <name>, or macro:<name>"],
  ["blockAttributeList", "dropped: an attribute to the oracle"],
  ["blockTitle", "dropped: an attribute to the oracle"],
  ["blockAnchor", "dropped: an attribute to the oracle"],
  ["table", "not yet reached: a table still passes through as bytes"],
  ["tableRow", "not yet reached: a table still passes through as bytes"],
  ["tableCell", "not yet reached: a table still passes through as bytes"],
]);

/**
 * One list, on our side. An item's children are the blocks it holds
 * after its principal text - nested lists among them, exactly as on
 * the oracle's side.
 * @param node - the list node
 * @param levels - whether heading levels are part of the identity
 * @returns the list's shape
 */
function ourList(node: ListNode, levels: boolean): Shape {
  return {
    kind: `list:${node.variant}`,
    children: node.children.map((item) => ({
      kind: "item",
      children: item.blocks.flatMap((entry) => ourShape(entry.block, levels)),
    })),
  };
}

/**
 * One admonition, on our side. Our AST reuses `AdmonitionNode` for
 * EVERY `[STYLE]`-labelled block, so the corpus carries
 * `admonition:partintro`, `:abstract`, `:quote` and `:custom`. Ruby's
 * rule is the same test the other way round: an ADMONITION style makes
 * an `:admonition` context, and any other style leaves the wrapper's
 * own context in place.
 * @param node - the admonition node
 * @param levels - whether heading levels are part of the identity
 * @returns the admonition's shape
 */
function ourAdmonition(node: AdmonitionNode, levels: boolean): Shape {
  const admonition = ADMONITION_VARIANTS.has(node.variant.toLowerCase());
  const wrapper = node.form === "paragraph" ? "paragraph" : node.form;
  return {
    kind: admonition ? "admonition" : wrapper,
    children: node.children.flatMap((child) => ourShape(child, levels)),
  };
}

/**
 * One of our blocks, canonicalized.
 *
 * The `default` arm returns `?<type>`, a kind nothing on the oracle's
 * side can ever spell. That is the fail-loud half of the census: a new
 * AST node kind diverges on every document that carries it rather than
 * quietly comparing equal.
 * @param node - our block node
 * @param levels - whether heading levels are part of the identity
 * @returns its shape
 */
function ourNode(node: BlockNode, levels: boolean): Shape {
  const leafKind = LEAF_KINDS.get(node.type);
  if (leafKind !== undefined) {
    return leaf(leafKind);
  }
  switch (node.type) {
    case "heading":
    case "discreteHeading": {
      return leaf(headingKind(node.level, levels));
    }
    // A document header contributes exactly what the oracle's own
    // header does: one level-0 heading leaf. Its LINES contribute
    // nothing - the author line, the revision line and the header's
    // attribute entries all reach the oracle as document attributes,
    // never as blocks.
    case "documentHeader": {
      return leaf(headingKind(DOCUMENT_TITLE_LEVEL, levels));
    }
    case "blockMacro": {
      return leaf(
        MACRO_CONTEXTS.has(node.name) ? node.name : `macro:${node.name}`,
      );
    }
    case "list": {
      return ourList(node, levels);
    }
    case "parentBlock": {
      return {
        kind: node.variant,
        children: node.children.flatMap((child) => ourShape(child, levels)),
      };
    }
    case "admonition": {
      return ourAdmonition(node, levels);
    }
    case "delimitedBlock": {
      return leaf(node.variant);
    }
    default: {
      return leaf(`?${node.type}`);
    }
  }
}

/**
 * One of our blocks as the shapes it contributes to its parent's child
 * list: none for the six dropped kinds, one for everything else.
 * @param node - our block node
 * @param levels - whether heading levels are part of the identity
 * @returns the shapes it contributes
 */
function ourShape(node: BlockNode, levels: boolean): Shape[] {
  if (DROPPED.has(node.type)) {
    return [];
  }
  return [ourNode(node, levels)];
}

/**
 * Our canonical tree for one document.
 * @param input - the document source
 * @param levels - whether heading levels are part of the identity
 * @returns the canonical tree
 */
export function ourTree(input: string, levels = false): Shape {
  return {
    kind: "document",
    children: parse(input).children.flatMap((child) => ourShape(child, levels)),
  };
}

// ----------------------------------------------------------- compare

/**
 * A tree, as one line, for a report.
 * @param shape - the tree to render
 * @returns `document(list:unordered(item(paragraph)))`
 */
export function render(shape: Shape): string {
  return shape.children.length === 0
    ? shape.kind
    : `${shape.kind}(${shape.children.map(render).join(" ")})`;
}

/**
 * Every kind in a tree that the mapping did not name - our `?<type>`
 * and the oracle's `?<context>`. The dynamic half of the census: an
 * empty result over the whole corpus and sweep is what says the
 * mapping still covers both models.
 * @param shape - the tree to walk
 * @returns the unmapped kinds it carries, with duplicates
 */
export function unmappedKinds(shape: Shape): string[] {
  const here = shape.kind.startsWith("?") ? [shape.kind] : [];
  return [...here, ...shape.children.flatMap(unmappedKinds)];
}

/**
 * Longest common subsequence of two child lists, by kind: the aligned
 * index pairs.
 *
 * Not cosmetic. A naive positional walk lets one inserted node rename
 * every sibling below it - measured on the same corpus run, that
 * reported 120 distinct signatures against LCS's 89, and its pair
 * census read as cascades rather than causes.
 * @param ours - our child list
 * @param oracle - the oracle's child list
 * @returns the aligned `[ours, oracle]` index pairs, in order
 */
function align(
  ours: readonly Shape[],
  oracle: readonly Shape[],
): Array<[number, number]> {
  const ourCount = ours.length;
  const oracleCount = oracle.length;
  const table: number[][] = Array.from({ length: ourCount + 1 }, () =>
    Array.from({ length: oracleCount + 1 }, () => 0),
  );
  for (let row = ourCount - 1; row >= 0; row -= 1) {
    for (let column = oracleCount - 1; column >= 0; column -= 1) {
      table[row][column] =
        ours[row].kind === oracle[column].kind
          ? table[row + 1][column + 1] + 1
          : Math.max(table[row + 1][column], table[row][column + 1]);
    }
  }
  const pairs: Array<[number, number]> = [];
  let oursAt = 0;
  let oracleAt = 0;
  while (oursAt < ourCount && oracleAt < oracleCount) {
    if (ours[oursAt].kind === oracle[oracleAt].kind) {
      pairs.push([oursAt, oracleAt]);
      oursAt += 1;
      oracleAt += 1;
    } else if (table[oursAt + 1][oracleAt] >= table[oursAt][oracleAt + 1]) {
      oursAt += 1;
    } else {
      oracleAt += 1;
    }
  }
  return pairs;
}

/**
 * Every divergence between two trees, aligned by LCS so one insertion
 * does not cascade over the siblings after it. Events are `-<kind>`
 * (ours only) and `+<kind>` (the oracle's only); an adjacent
 * delete/insert pair folds to `<ours>=><oracle>`. Each event carries
 * its path, tab-separated, so a report can say WHERE.
 * @param ours - our tree
 * @param oracle - the oracle's tree
 * @param path - the parent path, for recursion
 * @returns one `<path>\t<event>` line per divergence
 */
export function divergences(ours: Shape, oracle: Shape, path = ""): string[] {
  const out: string[] = [];
  const pairs = align(ours.children, oracle.children);
  const where = `${path}/${ours.kind}`;
  let oursAt = 0;
  let oracleAt = 0;
  const drain = (untilOurs: number, untilOracle: number): void => {
    const deleted = ours.children.slice(oursAt, untilOurs).map((s) => s.kind);
    const inserted = oracle.children
      .slice(oracleAt, untilOracle)
      .map((s) => s.kind);
    const shared = Math.min(deleted.length, inserted.length);
    for (let at = 0; at < shared; at += 1) {
      out.push(`${where}\t${deleted[at]}=>${inserted[at]}`);
    }
    for (const kind of deleted.slice(shared)) {
      out.push(`${where}\t-${kind}`);
    }
    for (const kind of inserted.slice(shared)) {
      out.push(`${where}\t+${kind}`);
    }
    oursAt = untilOurs;
    oracleAt = untilOracle;
  };
  for (const [ourPair, oraclePair] of pairs) {
    drain(ourPair, oraclePair);
    out.push(
      ...divergences(
        ours.children[ourPair],
        oracle.children[oraclePair],
        where,
      ),
    );
    oursAt = ourPair + 1;
    oracleAt = oraclePair + 1;
  }
  drain(ours.children.length, oracle.children.length);
  return out;
}

/**
 * The pinnable signature of a document's divergence: the sorted
 * multiset of its event kind-pairs with counts, path dropped - e.g.
 * `-paragraph x2; paragraph=>dlist`. This is what a ledger entry
 * claims, so a fix that turns one divergence into a different one
 * fails the gate until somebody rewrites or deletes the entry.
 * @param events - the lines {@link divergences} returned
 * @returns the signature, or the empty string for no events
 */
export function signature(events: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const event of events) {
    const pair = event.split("\t")[1] ?? event;
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
  }
  return [...counts]
    .toSorted((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([pair, count]) => (count === 1 ? pair : `${pair} x${String(count)}`))
    .join("; ");
}
