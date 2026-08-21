/**
 * The invariants every AST must satisfy, whatever the input — the
 * replacement for `expectStreamInvariants` in reader-lists.test.ts,
 * which asserted them of a token stream that is about to stop
 * existing (spec Decision 9: the grammar's LL(1) proof and its role
 * as an independent well-formedness check on the reader's emission
 * order are knowingly retired, and these take their place).
 *
 * They are deliberately structural: nothing here knows which node
 * kinds exist, so the same file keeps working after the reader builds
 * the AST itself. The walk is over any object carrying `type` and
 * `position`, which is every AST node and nothing else.
 */
import { expect } from "vitest";
import type { Location } from "../../src/ast.js";
import { parse } from "../../src/parser.js";

/**
 * The shape the walk recognises: a node with a source position. The
 * index signature is what keeps the rest of the file cast-free — a
 * node's other fields (`value`, `children`, ...) are read as
 * `unknown` and guarded, never asserted into existence.
 */
interface AnyNode extends Record<string, unknown> {
  /** The node's discriminant. */
  readonly type: string;
  /** Its source span, end exclusive. */
  readonly position: { readonly start: Location; readonly end: Location };
}

/**
 * Narrow an unknown value to a plain object.
 * @param value - anything reachable from the AST
 * @returns whether it is a non-null object
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Narrow an unknown value to an array of unknowns.
 *
 * `Array.isArray` alone narrows `unknown` to `any[]`, which spreads
 * an `any` into every element that follows; this predicate keeps the
 * elements `unknown` so the guards downstream stay real.
 * @param value - anything reachable from the AST
 * @returns whether it is an array
 */
function isArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/**
 * Narrow an unknown value to a Location.
 * @param value - a candidate `position.start` / `position.end`
 * @returns whether it has the three numeric coordinates
 */
function isLocation(value: unknown): value is Location {
  return (
    isRecord(value) &&
    typeof value.offset === "number" &&
    typeof value.line === "number" &&
    typeof value.column === "number"
  );
}

/**
 * Narrow an unknown value to a positioned AST node.
 * @param value - anything reachable from the AST
 * @returns whether it is a node with a full position
 */
function isNode(value: unknown): value is AnyNode {
  if (!isRecord(value)) return false;
  const { type, position } = value;
  return (
    typeof type === "string" &&
    isRecord(position) &&
    isLocation(position.start) &&
    isLocation(position.end)
  );
}

/**
 * The start offset of a node, or of the node a wrapper holds — an
 * `attachedBlocks` entry is `{block, continuation, pluses}`, not a
 * node.
 * @param value - a node or a wrapper around one
 * @returns its start offset, or 0 when there is no node in it
 */
function startOffsetOf(value: unknown): number {
  if (isNode(value)) return value.position.start.offset;
  if (isRecord(value)) {
    for (const inner of Object.values(value)) {
      if (isNode(inner)) return inner.position.start.offset;
    }
  }
  return 0;
}

/**
 * A list item's children in SOURCE order.
 *
 * A list item is the one node whose properties are NOT in source
 * order: `children` holds its inline nodes and its NESTED LISTS, while
 * `attachedBlocks` holds everything else, and a nested list can start
 * after an attached block (`* a` / `+` / `para` / `** b`). That split
 * is the printer's, not the source's — the AST is Asciidoctor's
 * `list_item.blocks` cut in two — so this merges the two arrays by
 * start offset. Verified against the corpus at `8c42f624`: without the
 * merge, 5 of 1,627 documents fail the ordering invariant below for
 * exactly this reason (`lists_test.rb#list item paragraph in list item
 * and nested list item#0` is the smallest).
 * @param item - a `listItem` node
 * @returns its children and attached blocks, earliest first
 */
function itemChildren(item: AnyNode): readonly unknown[] {
  // No cast: the index signature makes both reads `unknown`, so the
  // guards below are real checks, not a lie dressed as a type.
  const { children, attachedBlocks } = item;
  return [
    ...(isArray(children) ? children : []),
    ...(isArray(attachedBlocks) ? attachedBlocks : []),
  ].toSorted((left, right) => startOffsetOf(left) - startOffsetOf(right));
}

/**
 * Every node in DOCUMENT ORDER (pre-order), parents before children.
 *
 * Module-private: `expectAstInvariants` is this file's whole promised
 * interface (the plan's Interfaces section names only it), and knip
 * reports any other export here as unused.
 * @param root - the document node
 * @returns the nodes, in the order a reader meets them
 */
function preorder(root: unknown): AnyNode[] {
  const nodes: AnyNode[] = [];
  const visit = (value: unknown): void => {
    if (isArray(value)) {
      for (const element of value) visit(element);
      return;
    }
    if (!isRecord(value)) return;
    if (isNode(value)) nodes.push(value);
    const children =
      isNode(value) && value.type === "listItem"
        ? itemChildren(value)
        : Object.entries(value)
            .filter(([key]) => key !== "position")
            .map(([, child]) => child);
    for (const child of children) visit(child);
  };
  visit(root);
  return nodes;
}

/**
 * The nodes one array element contributes to its sibling group. An
 * `attachedBlocks` entry is `{block, continuation, pluses}` rather
 * than a node, so it contributes the nodes DIRECTLY on it.
 * @param element - one element of an array in the tree
 * @returns the nodes it holds
 */
function siblingsOf(element: unknown): AnyNode[] {
  if (isNode(element)) return [element];
  if (!isRecord(element)) return [];
  return Object.values(element).filter((inner) => isNode(inner));
}

/**
 * Every array of siblings in the tree, as node arrays.
 * @param root - the document node
 * @returns one entry per sibling array
 */
function siblingGroups(root: unknown): AnyNode[][] {
  const groups: AnyNode[][] = [];
  const visit = (value: unknown): void => {
    if (isArray(value)) {
      const group: AnyNode[] = [];
      for (const element of value) {
        group.push(...siblingsOf(element));
        visit(element);
      }
      if (group.length > 1) groups.push(group);
      return;
    }
    if (!isRecord(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "position") continue;
      visit(child);
    }
  };
  visit(root);
  return groups;
}

/**
 * The line and column an offset really has, recomputed from the
 * source the same way tests/parser/reader.test.ts recomputed them for
 * tokens.
 * @param source - the whole document
 * @param offset - a zero-based character offset
 * @returns the 1-based line and column
 */
function locationOf(
  source: string,
  offset: number,
): { line: number; column: number } {
  const before = source.slice(0, offset);
  return {
    line: before.split("\n").length,
    column: offset - (before.lastIndexOf("\n") + 1) + 1,
  };
}

/**
 * (i) Positions are well formed: inside the source, non-inverted, and
 * their line/column agree with their offset.
 *
 * The one documented exception is an exclusive END that sits one past
 * a newline. A text run that ended at a line break reports its end on
 * the line the break is on (column = the break's column + 1) rather
 * than at column 1 of the next line — both spellings name the same
 * OFFSET, which is the coordinate Prettier reads, and the AST has
 * always spelled it this way.
 * @param source - the whole document
 * @param nodes - every node, in document order
 */
function expectPositionsWellFormed(source: string, nodes: AnyNode[]): void {
  for (const node of nodes) {
    const {
      position: { start, end },
    } = node;
    // KNOWN BUG, fixed in Task 4 of the drop-chevrotain plan and
    // deleted from here in the same change: `buildParentBlock` hands
    // `closeExtent` an EMPTY source string, so every forced-closed
    // parent block ends at {0, 1, 1} — before its own start whenever
    // it does not begin at offset 0 — and a list item that ends on
    // such a block inherits the 0. 64 corpus documents, verified at
    // `8c42f624`: 62 fail here, 2 more only in `expectContainment`
    // (`parse("====\ntext\n")` reproduces the end position). Nothing
    // but that bug can end at offset 0 in a non-empty document, so
    // the exception needs no node-kind list and cannot hide anything
    // else.
    if (end.offset === 0 && source.length > 0) continue;
    expect(start.offset, `${node.type} start in range`).toBeGreaterThanOrEqual(
      0,
    );
    expect(end.offset, `${node.type} end in range`).toBeLessThanOrEqual(
      source.length,
    );
    expect(end.offset, `${node.type} end before start`).toBeGreaterThanOrEqual(
      start.offset,
    );
    expect(
      [start.line, start.column],
      `${node.type} start line/column`,
    ).toEqual(Object.values(locationOf(source, start.offset)));
    if (source[end.offset - 1] === "\n") continue;
    expect([end.line, end.column], `${node.type} end line/column`).toEqual(
      Object.values(locationOf(source, end.offset)),
    );
  }
}

/**
 * A `text` node whose span swallows the node before it whole.
 *
 * An inline text run has a loose START by construction: the paragraph
 * reader splits a line it must re-emit verbatim out of the run it
 * interrupts (`paragraph-reader.ts#take`, which closes the run and
 * pushes a `raw` piece), while the inline builder starts the NEXT
 * `text` node where the previous INLINE node ended — which is before
 * the split-out line. `a *b*\nendif::[]\nc` gives `bold@2..5`,
 * `rawLine@6..15` and `text@5..17`: the text's span reaches back over
 * the raw line, though its value is only `c`. The value is right —
 * invariant (iii) checks it as the tail of the span and passes — so
 * this is the ordering rule being mis-stated for inline text, not a
 * node emitted out of order.
 *
 * The reach-back is not limited to the raw line: everything the run
 * emitted after the previous split is inside the span too, so
 * `. a\nimage::a[]\nifdef::x[]\nimage::a[]\n.T\n` ends on
 * `text@14..39` swallowing both `rawLine@15..25` and the second
 * `inlineMacro@26..36`. Hence "swallows the previous node whole"
 * rather than a rule about raw lines.
 *
 * Found by the reader-soup property (smallest counterexample
 * `* a\nimage::a[]\nendif::[]\n:a: b`), never by the corpus: 0 of
 * 1,627 corpus documents put a raw line inside a text run that
 * follows an inline construct.
 * @param previous - the node that comes first in the walk
 * @param current - the node after it
 * @returns whether the pair is that known nesting
 */
function swallowsPrevious(previous: AnyNode, current: AnyNode): boolean {
  return (
    current.type === "text" &&
    current.position.start.offset <= previous.position.start.offset &&
    current.position.end.offset >= previous.position.end.offset
  );
}

/**
 * (ii) Document order: a pre-order walk yields non-decreasing start
 * offsets, and siblings do not overlap or run backwards. The one
 * exception is a text run reaching back over a line the paragraph
 * reader split out of it — see `swallowsPrevious`.
 *
 * This is the AST form of the token stream's "offsets are monotone",
 * the invariant that found both of the reader's ordering bugs while
 * plan 2 was being written (metadata held back and released after the
 * token that followed it).
 * @param root - the document node
 * @param nodes - every node, in document order
 */
function expectDocumentOrder(root: unknown, nodes: AnyNode[]): void {
  for (let index = 1; index < nodes.length; index += 1) {
    const { [index - 1]: previous, [index]: node } = nodes;
    if (swallowsPrevious(previous, node)) continue;
    expect(
      node.position.start.offset,
      `${node.type} starts before the ${previous.type} the walk met first`,
    ).toBeGreaterThanOrEqual(previous.position.start.offset);
  }
  for (const group of siblingGroups(root)) {
    for (let index = 1; index < group.length; index += 1) {
      if (swallowsPrevious(group[index - 1], group[index])) continue;
      expect(
        group[index].position.start.offset,
        `${group[index - 1].type} overlaps the ${group[index].type} after it`,
      ).toBeGreaterThanOrEqual(group[index - 1].position.end.offset);
    }
  }
}

/**
 * A `text` node's value is the tail of the span it claims.
 *
 * A SUFFIX rather than the whole slice for two reasons, both verified
 * against the parser at `8c42f624`: a checklist item's first text node
 * has its `[x] ` prefix stripped (`trimCheckboxPrefix`) while keeping
 * the position it was parsed at, and a run interrupted by a line the
 * reader re-emits verbatim keeps the START of the run it continues, so
 * its span reaches back over that line (see `swallowsPrevious`).
 * @param slice - the source the node's position names
 * @param value - the node's text
 */
function expectTextValue(slice: string, value: string): void {
  // BOTH sides lose a trailing newline. The span may carry the
  // break that ended the run while the value does not — and the
  // value may carry one the run accumulated (a `|===` table line
  // inside a paragraph) while the span stops at it. Verified at
  // `8c42f624`: de-newlining only the slice fails 19 corpus
  // documents.
  const body = slice.endsWith("\n") ? slice.slice(0, -1) : slice;
  const text = value.endsWith("\n") ? value.slice(0, -1) : value;
  expect(
    body.endsWith(text),
    `text node ${JSON.stringify(value)} is not the tail of ${JSON.stringify(slice)}`,
  ).toBe(true);
}

/**
 * A verbatim block's content is inside the span it claims.
 * @param slice - the source the node's position names
 * @param content - the block's verbatim content
 */
function expectVerbatimContent(slice: string, content: string): void {
  // KNOWN BUG, reported against the baseline rather than fixed here
  // (this task changes no `src/`, and `paragraph-form.ts` is out of
  // the drop-chevrotain plan's scope by Decision 4): a
  // `[source]`-styled PARAGRAPH whose text run is interrupted by a
  // line the reader re-emits verbatim gets a DOUBLED break where the
  // two pieces are joined, so `content` carries a blank line the
  // source does not have, and the formatter prints it. Reproduce by
  // running `formatAdoc` over the five lines `* a`, `[source]`,
  // `flush`, `ifdef::x[]`, `ifdef::x[]`: the output gains a blank line
  // before the second `ifdef::x[]`. Found by the reader-soup property,
  // 0 of 1,627 corpus documents. Tolerated as EXACTLY that shape —
  // undoubling the content's breaks — so any other content/span
  // disagreement still fails.
  const undoubled = content.replaceAll("\n\n", "\n");
  expect(
    slice.includes(content) || slice.includes(undoubled),
    `verbatim content is not inside ${JSON.stringify(slice)}`,
  ).toBe(true);
}

/**
 * Check one node's value against the source it claims.
 * @param node - the node to check
 * @param slice - the source its position names
 */
function expectOneValue(node: AnyNode, slice: string): void {
  const { value, content } = node;
  if (node.type === "delimitedBlock" && typeof content === "string") {
    expectVerbatimContent(slice, content);
    return;
  }
  if (typeof value !== "string") return;
  switch (node.type) {
    case "text": {
      expectTextValue(slice, value);
      break;
    }
    case "rawLine": {
      expect(slice, "raw line value is its own span").toBe(value);
      break;
    }
    // `includes`, not equality: the span covers a `//` prefix or a
    // directive's delimiters that the value does not.
    case "comment":
    case "preprocessorDirective": {
      expect(slice, `${node.type} value is inside its span`).toContain(value);
      break;
    }
    default: {
      break;
    }
  }
}

/**
 * (iii) Values are drawn from the span they claim.
 * @param source - the whole document
 * @param nodes - every node, in document order
 */
function expectValuesReconstruct(source: string, nodes: AnyNode[]): void {
  for (const node of nodes) {
    const {
      position: { start, end },
    } = node;
    expectOneValue(node, source.slice(start.offset, end.offset));
  }
}

// A list continuation is the one non-blank line the AST records as a
// COUNT rather than a span: `AttachedBlock.pluses` and
// `ListItemNode.danglingContinuation` say how the author spelled it,
// and the block it introduces starts on the next line.
const CONTINUATION = "+";

/**
 * (iv) Every non-blank source line is inside some node's span.
 *
 * A formatter may not silently drop a line the author wrote, and the
 * only way to see that in an AST is coverage. The exception list is
 * exactly one entry long and each entry names why it is there — a
 * NEW exception found by the corpus run is a finding to report, never
 * a widening of the rule.
 * @param source - the whole document
 * @param nodes - every node, in document order
 */
function expectLineCoverage(source: string, nodes: AnyNode[]): void {
  const covered = new Set<number>();
  for (const node of nodes) {
    const {
      position: { start, end },
    } = node;
    const { line: first } = start;
    const { line: last } = end;
    for (let row = first; row <= last; row += 1) covered.add(row);
  }
  const lines = source.split("\n");
  for (const [index, raw] of lines.entries()) {
    const text = raw.trim();
    if (text === "" || text === CONTINUATION) continue;
    expect(
      covered.has(index + 1),
      `line ${String(index + 1)} (${raw}) uncovered`,
    ).toBe(true);
  }
}

// The node kinds whose position spans their whole content, so a
// descendant must lie inside them. A `section`'s position is its
// heading LINE — its blocks come after it — and the `document`'s span
// is the whole source, so neither constrains anything; both are
// deliberately absent.
const SPANNING_CONTAINERS = new Set([
  "parentBlock",
  "list",
  "listItem",
  "delimitedBlock",
]);

/**
 * One node lies inside the container it is nested in.
 * @param source - the whole document
 * @param node - the nested node
 * @param container - the nearest enclosing spanning container
 */
function expectInside(source: string, node: AnyNode, container: AnyNode): void {
  // The same known bug the well-formedness check exempts: a container
  // that ends at offset 0 constrains nothing. Deleted in Task 4 with
  // its cause. It is what puts the last 2 of that bug's 64 corpus
  // documents on the list — they fail only here.
  if (source.length > 0 && container.position.end.offset === 0) return;
  expect(
    node.position.start.offset,
    `${node.type} starts before its ${container.type}`,
  ).toBeGreaterThanOrEqual(container.position.start.offset);
  expect(
    node.position.end.offset,
    `${node.type} ends after its ${container.type}`,
  ).toBeLessThanOrEqual(container.position.end.offset);
}

/**
 * The container a value's children are measured against: the value
 * itself when it spans its own content, otherwise the one it inherits.
 * @param value - the value the walk is at
 * @param container - the container in force above it
 * @returns the container for its children
 */
function containerFor(
  value: unknown,
  container: AnyNode | undefined,
): AnyNode | undefined {
  return isNode(value) && SPANNING_CONTAINERS.has(value.type)
    ? value
    : container;
}

/**
 * (v) Containment: every node inside a container that spans its
 * content lies within that container's span.
 *
 * This is the AST successor to `expectStreamInvariants`' third
 * invariant, "ParagraphStart/ParagraphEnd are balanced and never
 * negative". A stream can be unbalanced; a tree cannot — what a tree
 * CAN do is put a child outside the parent it is nested in, which is
 * the same failure (a block that escaped its container) seen from the
 * other side. Verified at `8c42f624`: 0 failures over the corpus and
 * 432 lists.
 * @param source - the whole document
 * @param root - the document node
 */
function expectContainment(source: string, root: unknown): void {
  const visit = (value: unknown, container?: AnyNode): void => {
    if (isArray(value)) {
      for (const element of value) visit(element, container);
      return;
    }
    if (!isRecord(value)) return;
    if (isNode(value) && container !== undefined) {
      expectInside(source, value, container);
    }
    const next = containerFor(value, container);
    for (const [key, child] of Object.entries(value)) {
      if (key === "position") continue;
      visit(child, next);
    }
  };
  visit(root);
}

/**
 * (vi) Every list has at least one item.
 *
 * Half of the AST successor to `expectStreamInvariants`' fourth
 * invariant, "one `ItemEnd` per list marker, and `ListEnd` follows
 * `ItemEnd`". The ordering half is structural in a tree and needs no
 * assertion; the counting half is the ORACLE comparison
 * (`itemCount(source) === oracleItems(source)`, spec Testing §3 (iv)),
 * which lives on the characterization rows in reader-lists.test.ts
 * rather than here — the fuzz generators emit `ifdef::` lines that
 * Asciidoctor's preprocessor eats, so the oracle reads a different
 * document than we do and cannot judge generated soup.
 * @param nodes - every node, in document order
 */
function expectListsNonEmpty(nodes: AnyNode[]): void {
  for (const node of nodes) {
    if (node.type !== "list") continue;
    const { children } = node;
    expect(
      isArray(children) && children.length > 0,
      "a list with no items",
    ).toBe(true);
  }
}

/**
 * Assert every AST invariant for one document.
 *
 * The five invariants `expectStreamInvariants` asserted of the token
 * stream map onto these one for one:
 * 1. offsets monotone      → (ii) document order
 * 2. image == source slice → (iii) values reconstruct
 * 3. paragraph balance     → (v) containment
 * 4. one ItemEnd per marker → (vi) non-empty lists, plus the oracle
 *    item count on the characterization rows (Testing §3 (iv))
 * 5. the grammar accepts   → RETIRED with the grammar (spec Decision
 *    9). Nothing replaces it, on purpose: there is no second component
 *    left to disagree with the reader.
 * @param source - the AsciiDoc source to parse and check
 */
export function expectAstInvariants(source: string): void {
  const document = parse(source);
  const nodes = preorder(document);
  expectPositionsWellFormed(source, nodes);
  expectDocumentOrder(document, nodes);
  expectValuesReconstruct(source, nodes);
  expectLineCoverage(source, nodes);
  expectContainment(source, document);
  expectListsNonEmpty(nodes);
}
