/**
 * Block-level printing functions for the AsciiDoc
 * printer.
 *
 * Each function takes an AST node (and optionally
 * Prettier's path/print callbacks) and produces Doc IR.
 * Delimiter-based blocks compute safe delimiter lengths;
 * parent blocks recurse into children via
 * {@link joinBlocks}.
 */
import { doc, type AstPath, type Doc, type ParserOptions } from "prettier";
import type {
  AdmonitionNode,
  BlockNode,
  DelimitedBlockNode,
  DocumentHeaderNode,
  DocumentNode,
  HeaderLineNode,
  InlineNode,
  LeafDelimiterVariant,
  ListItemNode,
  ParentBlockNode,
  TableCellNode,
  TableRowNode,
} from "../ast.js";
import { canonicalAttrlist } from "../parse/attrlist.js";
import { ASCII_NON_WHITESPACE } from "../parse/line-shapes.js";
import {
  MARKER_OFFSET,
  MIN_DELIMITER_LENGTH,
  SAFE_DELIMITER_PAD,
} from "../constants.js";
import { inlineAtoms } from "./inline.js";
import { atomOf, blockBody, type Atom } from "./reflow.js";
import { joinBlocks } from "./join.js";

const {
  builders: { hardline, join },
} = doc;

/**
 * Union of all node types the printer may encounter.
 *
 * Prettier's generic `Printer` type needs this to
 * type-check `path.map()` calls across different node
 * shapes. A table's rows and cells are members for that
 * reason and no other: they are not blocks, and nothing
 * but the table printer's own recursion
 * (src/print/table.ts) ever reaches them. They cannot be
 * dropped from the union even if that recursion goes:
 * `path.map(print, "children")` is typed over every
 * `children` array any member declares, and a table's is
 * one of them.
 */
export type AnyNode =
  | DocumentNode
  | BlockNode
  | InlineNode
  | ListItemNode
  | TableRowNode
  | TableCellNode;

/**
 * Convenience alias for Prettier's AST path, specialized
 * to the AsciiDoc node union.
 *
 * Lets helper functions accept the same path argument as
 * the main print method without repeating verbose generic
 * types.
 */
export type PrintPath = AstPath<AnyNode>;

/**
 * Convenience alias for Prettier's recursive print
 * callback, specialized to the AsciiDoc node union.
 */
export type PrintFunction = (path: PrintPath) => Doc;

/**
 * The options Prettier hands the printer, specialized to the AsciiDoc
 * node union — every width and line-ending setting resolved, which is
 * what makes them the options Prettier's own Doc renderer takes.
 */
export type PrintOptions = ParserOptions<AnyNode>;

/**
 * Prints a comment node to Doc IR.
 *
 * Extracted from the main print method to keep cyclomatic
 * complexity manageable as more node types are added.
 * Line comments produce `// text`; block comments produce
 * `////` delimiters with verbatim content between them.
 * @param node - The comment node.
 * @param node.commentType - Whether this is a line
 *   (`//`) or block (`////`) comment.
 * @param node.value - The text content of the comment.
 * @returns Doc IR for the formatted comment.
 */
export function printComment(node: {
  commentType: "line" | "block";
  value: string;
}): Doc {
  if (node.commentType === "line") {
    if (node.value.length > 0) {
      return ["// ", node.value];
    }
    return "//";
  }
  // Block comment: delimiters on their own lines, content verbatim.
  // Detect whitespace-only content by Ruby's definition of blank
  // (ASCII_NON_WHITESPACE, issue #75), not trim()'s wider one: Prettier
  // strips trailing ASCII whitespace per line, so "     " would become
  // a blank line that re-parses as an empty comment, breaking
  // idempotency - but a line holding only a no-break space is not
  // blank to Asciidoctor, and trim() alone would drop it here.
  if (ASCII_NON_WHITESPACE.test(node.value)) {
    const contentLines = node.value.split("\n");
    return ["////", hardline, join(hardline, contentLines), hardline, "////"];
  }
  return ["////", hardline, "////"];
}

// Maps each leaf delimiter variant to its single delimiter character.
// Used by the printer to compute the minimum safe delimiter length
// and build the output delimiter string. The other variants
// (example, sidebar, quote, verse) reach a delimited block only by
// masquerading, and then they print from the source delimiter the
// open recorded (case 1 of computeMasqueradeDelimiter) — so this
// table is the whole of what remains past that branch, which is now
// what the node types say (LeafDelimiterVariant, src/ast.ts).
const DELIMITER_CHARS: Record<LeafDelimiterVariant, string> = {
  listing: "-",
  literal: ".",
  pass: "+",
};

// Maps each parent block variant to its delimiter character and
// default length. Open blocks always use exactly 2 dashes.
const PARENT_DELIMITER_CHARS: Record<ParentBlockNode["variant"], string> = {
  example: "=",
  sidebar: "*",
  open: "-",
  quote: "_",
};

// Open block delimiter is always exactly 2 dashes.
const OPEN_BLOCK_DELIMITER_LENGTH = 2;

/**
 * The trailing whitespace Prettier's own doc printer strips from a
 * hardline-joined line before writing the line break - narrower than
 * Asciidoctor's rstrip (src/parse/line-shapes.ts's `rstrip`, six ASCII
 * whitespace characters). The non-literal branch of `DOC_TYPE_LINE`
 * calls `result.trim()`, which removes only a trailing run of SPACE
 * and TAB (prettier's `src/document/printer/trim-indentation.js`,
 * `getTrailingIndentionLength`, reached from the `DOC_TYPE_LINE` case
 * in `src/document/printer/printer.js` whenever `doc.literal` is not
 * set - the case every content line below goes through, since content
 * is joined with `hardline`, not `literalline`). A trailing vertical
 * tab or form feed survives that trim untouched; a trailing space or
 * tab does not (#125).
 */
const TRAILING_SPACE_OR_TAB = /[ \t]+$/v;

/**
 * Computes the shortest safe delimiter for a delimited
 * block.
 *
 * Scans the block content for lines that consist entirely
 * of the delimiter character (4+ chars) — these would be
 * misinterpreted as delimiters on re-parse. Each line is
 * compared as {@link TRAILING_SPACE_OR_TAB} will respell it once
 * printed, not as the author's raw bytes: an interior line whose
 * only departure from a delimiter shape is trailing space or tab
 * still prints delimiter-shaped, once the printer's own hardline
 * trims that whitespace away, so pass one has to see the same
 * spelling pass one is about to emit (#125 - matching the raw bytes
 * here left widening one pass behind the trim, a bounded two-pass
 * wobble). Returns a delimiter one character longer than the longest
 * conflict. When no conflicts exist, returns the minimum
 * 4-character delimiter.
 * @param content - The verbatim text content of the
 *   block.
 * @param delimChar - The single character used for the
 *   delimiter (e.g. `-` for listing blocks).
 * @returns The delimiter string, repeated to a safe
 *   length.
 */
function computeDelimiter(content: string, delimChar: string): string {
  let maxConflict = 0;
  // Escape the delimiter char for use in a regex.
  // `.` and `+` are regex metacharacters; `-` is safe
  // outside character classes and must NOT be escaped
  // (the `v` flag rejects unnecessary escapes).
  const escaped = delimChar.replace(/[.+]/v, String.raw`\$&`);
  const pattern = new RegExp(`^${escaped}{${MIN_DELIMITER_LENGTH},}$`, "v");
  // Empty content needs no guard: it splits to one empty line, and no
  // `{4,}` pattern matches that.
  for (const line of content.split("\n")) {
    const printed = line.replace(TRAILING_SPACE_OR_TAB, "");
    if (pattern.test(printed)) {
      maxConflict = Math.max(maxConflict, printed.length);
    }
  }
  const length = Math.max(
    MIN_DELIMITER_LENGTH,
    maxConflict + SAFE_DELIMITER_PAD,
  );
  return delimChar.repeat(length);
}

/**
 * Resolves the correct delimiter string for a delimited
 * block, accounting for masquerading.
 *
 * Two cases, and only two:
 * 1. `sourceDelimiter` is set — the block was masqueraded
 *    from a parent block, so it prints from the parent
 *    delimiter chars the open RECORDED.
 * 2. Otherwise the variant is a leaf's
 *    (listing/literal/pass) — {@link DELIMITER_CHARS}.
 *
 * There is no third case, and no assertion saying so: the
 * parameter takes the three delimited-form members, and past
 * the `sourceDelimiter` branch the two that remain (a fence
 * and a leaf block) have leaf variants by declaration, so
 * the delimiter-character lookup is total.
 * @param node - The delimited block node whose delimiter
 *   to compute.
 * @returns The correctly-sized delimiter string.
 */
function computeMasqueradeDelimiter(
  // The delimited-form members that print a FRAME of their own: a
  // leaf block, a fence, a masqueraded parent block. A table is not
  // among them and cannot be: its delimiter lines are CONTENT, so it
  // is a node of its own (src/print/table.ts) rather than a member of
  // this union.
  node: Extract<DelimitedBlockNode, { form: "delimited" }>,
): string {
  if (node.sourceDelimiter !== undefined) {
    const parentChar = PARENT_DELIMITER_CHARS[node.sourceDelimiter];
    return node.sourceDelimiter === "open"
      ? parentChar.repeat(OPEN_BLOCK_DELIMITER_LENGTH)
      : computeDelimiter(node.content, parentChar);
  }
  const leafChar = DELIMITER_CHARS[node.variant];
  return computeDelimiter(node.content, leafChar);
}

/**
 * Whether the reader recorded a `[source]`/`[source,lang]` annotation
 * that already covers this block's implicit source style — a FIELD
 * READ of the reader's own record, replacing a
 * getParentNode() cast and sibling scan that structurally could not
 * see inside list items (the measured duplicated prefix, ledger
 * family fence-annotation). A fence with no language hint still
 * implies `source`, so a bare `[source]` annotation counts.
 *
 * A fence is the ONLY member carrying a language hint, which the node
 * types now say (src/ast.ts): the "or it has a language" half of this
 * test used to be spelled beside the fence test and is gone with the
 * combination it covered, not with any behavior.
 *
 * The fence test itself is LOAD-BEARING and not a restatement of it.
 * A DELIMITED `[source]` / `----` block is not fenced and carries
 * exactly the annotation `source`, so without this line it would
 * report covered and the printer would drop the author's `[source]`
 * line (8 corpus documents measured).
 * @param node - The delimited block to check.
 * @returns True when the annotation already covers the source
 *   attribute this block would otherwise emit.
 */
export function hasPrecedingLanguageAttribute(
  node: DelimitedBlockNode,
): boolean {
  if (node.fenced !== true) {
    return false;
  }
  const expectedValue =
    node.language === undefined ? "source" : `source,${node.language}`;
  return node.annotatedBy === expectedValue;
}

/**
 * Prints a delimited leaf block to Doc IR.
 *
 * Produces delimiter, content lines (verbatim), delimiter.
 * Content is not reflowed — it is preserved exactly. The
 * delimiter length is computed by
 * {@link computeDelimiter} to avoid conflicts with
 * content. Indented literal paragraphs (form: "indented")
 * and paragraph-form blocks are printed verbatim without
 * delimiters.
 * @param node - The delimited block AST node.
 * @param skipSourcePrefix - When true, suppress the
 *   `[source]`/`[source,lang]` prefix normally emitted for
 *   fenced code blocks. Set when the preceding sibling
 *   already has a matching attribute list — which for a bare
 *   fence is the bare `[source]` the printer would otherwise
 *   add a second time.
 * @returns Doc IR for the formatted block.
 */
export function printDelimitedBlock(
  node: DelimitedBlockNode,
  skipSourcePrefix: boolean,
): Doc {
  // Indented literal paragraphs and paragraph-form blocks: print
  // content verbatim without delimiters. The preceding attribute
  // list (for paragraph form) is a separate node handled by the
  // printer's stacking behavior.
  if (node.form === "indented" || node.form === "paragraph") {
    const contentLines = node.content.split("\n");
    return join(hardline, contentLines);
  }

  // Determine the delimiter character and compute its length.
  // When a block was masqueraded (e.g. [source] on open block
  // `--`), the sourceDelimiter tells us which parent block
  // delimiter to use instead of the variant's default.
  const delimiter = computeMasqueradeDelimiter(node);

  // A fenced code block implies the `source` style even without a
  // language hint — Asciidoctor renders it as `<pre class="highlight">`,
  // not a plain listing. Emit [source] (or [source,lang] when a
  // language hint is present) before the delimiter to preserve that
  // semantics when normalizing to AsciiDoc-native `----` syntax. Skip
  // when the preceding sibling already has a matching attribute list
  // to avoid emitting it twice.
  // Only a fence carries a language hint, so "wants a source prefix"
  // and "is a fence" are one test (src/ast.ts's node types).
  let prefix: Doc[] = [];
  if (node.fenced === true && !skipSourcePrefix) {
    // The synthesized list goes through the SAME spacing rule an
    // authored one does: a fence's info string is the author's
    // (` javascript, numbered`), and leaving it alone here printed a
    // `[source,javascript, numbered]` that the next pass — reading it
    // as a real attribute list — spelled differently.
    prefix =
      node.language === undefined
        ? ["[source]", hardline]
        : ["[", canonicalAttrlist(`source,${node.language}`), "]", hardline];
  }

  // Detect whitespace-only content by Ruby's definition of blank
  // (ASCII_NON_WHITESPACE, issue #75), not trim()'s wider one: Prettier
  // strips trailing ASCII whitespace per line, so all-whitespace
  // content would become blank lines that re-parse as an empty block,
  // breaking idempotency - but a no-break space is not blank to
  // Asciidoctor, and trim() alone would drop that content here.
  if (ASCII_NON_WHITESPACE.test(node.content)) {
    const contentLines = node.content.split("\n");
    return [
      ...prefix,
      delimiter,
      hardline,
      join(hardline, contentLines),
      hardline,
      delimiter,
    ];
  }
  return [...prefix, delimiter, hardline, delimiter];
}

/**
 * Recursively finds the maximum delimiter length used by
 * any descendant parent block with the given variant.
 *
 * Searches through ALL children — not just same-variant
 * — because a quote block inside a sidebar inside a quote
 * still produces `____` delimiters within the outer
 * quote's formatted output. Without this, nested
 * same-type blocks would normalize to identical delimiter
 * lengths and collapse on re-parse.
 * @param variant - The parent-block variant whose
 *   delimiter length to track.
 * @param children - The child block nodes to recurse
 *   into.
 * @returns The longest same-variant delimiter found
 *   among descendants, or 0 if none exist.
 */
function maxDescendantDelimiter(
  variant: ParentBlockNode["variant"],
  children: readonly BlockNode[],
): number {
  let max = 0;
  for (const child of children) {
    if (child.type !== "parentBlock" && child.type !== "admonition") {
      continue;
    }
    const childVariant = delimiterVariantOf(child);
    if (childVariant === undefined) {
      continue;
    } // paragraph-form admonition
    // Recurse regardless of variant — same-variant blocks might be
    // nested deeper; a same-variant child then needs at least the
    // minimum plus whatever its own nesting requires.
    const childInner = maxDescendantDelimiter(variant, child.children);
    max = Math.max(
      max,
      childVariant === variant
        ? Math.max(MIN_DELIMITER_LENGTH, childInner + SAFE_DELIMITER_PAD)
        : childInner,
    );
  }
  return max;
}

/**
 * The wrapper-delimiter variant one child prints with, when it prints
 * parent-style delimiters at all: a parentBlock's `variant`, a
 * delimited-form admonition's `form`. Undefined for everything else —
 * the one answer maxDescendantDelimiter's two arms used to spell
 * twice.
 * @param child - a child block
 * @returns the delimiter variant it wraps itself in, if any
 */
function delimiterVariantOf(
  child: BlockNode,
): ParentBlockNode["variant"] | undefined {
  if (child.type === "parentBlock") {
    return child.variant;
  }
  if (child.type === "admonition" && child.form !== "paragraph") {
    return child.form;
  }
  return undefined;
}

/**
 * THE delimited-parent printer (three near-identical bodies became
 * this one): computes the wrapper delimiter for a
 * compound block — a parentBlock or a delimited-form admonition — and
 * prints delimiter/children/delimiter. Open blocks take the fixed
 * two-dash spelling; every other variant out-lengths its deepest
 * same-variant descendant so the nesting re-parses.
 * @param variant - the wrapper's delimiter variant
 * @param node - the block being printed
 * @param path - Prettier's AST path
 * @param print - Prettier's recursive print callback
 * @returns Doc IR for the wrapped block
 */
function printDelimitedParent(
  variant: ParentBlockNode["variant"],
  node: ParentBlockNode | AdmonitionNode,
  path: PrintPath,
  print: PrintFunction,
): Doc {
  const delimChar = PARENT_DELIMITER_CHARS[variant];
  const delimLength =
    variant === "open"
      ? OPEN_BLOCK_DELIMITER_LENGTH
      : Math.max(
          MIN_DELIMITER_LENGTH,
          maxDescendantDelimiter(variant, node.children) + SAFE_DELIMITER_PAD,
        );
  const delimiter = delimChar.repeat(delimLength);
  if (node.children.length === 0) {
    return [delimiter, hardline, delimiter];
  }
  const children = path.map(print, "children");
  return [
    delimiter,
    hardline,
    joinBlocks(node.children, children),
    hardline,
    delimiter,
  ];
}

/**
 * Prints a parent (structural) block to Doc IR.
 *
 * Parent blocks contain other blocks as children and are
 * fenced by delimiter lines (e.g. `====` for example
 * blocks, `--` for open blocks) — one call into
 * {@link printDelimitedParent}, which is where the
 * delimiter length and the wrapping live.
 * @param node - The parent block AST node.
 * @param path - Prettier's AST path, used to recurse
 *   into children via `path.map(print, "children")`.
 * @param print - Prettier's recursive print callback.
 * @returns Doc IR for the formatted parent block.
 */
export function printParentBlock(
  node: ParentBlockNode,
  path: PrintPath,
  print: PrintFunction,
): Doc {
  return printDelimitedParent(node.variant, node, path, print);
}

/**
 * Prints an admonition node to Doc IR: the paragraph form is the
 * label plus THE paragraph body engine over its inline children (one
 * engine by construction); a delimited form goes through
 * {@link printDelimitedParent}, THE wrapper printer, with the
 * delimiter variant read off `form` (the old `delimiter ?? "example"`
 * fallback left WITH the field it defended).
 * @param node - The admonition AST node.
 * @param path - Prettier's AST path, for recursing into the body.
 * @param print - Prettier's recursive print callback.
 * @param printWidth - the column budget for a whole output line.
 * @returns Doc IR for the formatted admonition.
 */
export function printAdmonition(
  node: AdmonitionNode,
  path: PrintPath,
  print: PrintFunction,
  printWidth: number,
): Doc {
  if (node.form === "paragraph") {
    const label = `${node.variant.toUpperCase()}:`;
    // The label is an atom of the body, not a prefix in front of it:
    // it occupies its columns of the first output line, and the packer
    // must measure them. The join after it is the syntax's own space,
    // which may never become a break.
    // The label below holds column 0 of the first line.
    const body = inlineAtoms(node.text, node.position.start.line, {
      atColumnZero: false,
    });
    // Text nodes that are all whitespace produce no atoms, so a text
    // array with children can still yield none — and then the label is
    // the whole line. ONE test for both: an empty text array yields no
    // atoms either, so the emptiness the caller could have asked about
    // upstream is the same emptiness answered here.
    if (body.length === 0) {
      return label;
    }
    const atoms: Atom[] = [
      atomOf(label),
      { ...body[0], glueLeft: false, noBreakBefore: true },
      ...body.slice(1),
    ];
    return blockBody(atoms, printWidth, 0);
  }
  return printDelimitedParent(node.form, node, path, print);
}

/**
 * Prints an attribute entry node to Doc IR: `:name: value`, `:name:`,
 * or `:!name:`.
 *
 * Two spellings the author had are DERIVED away here, both because
 * Asciidoctor cannot see them. The `!` goes in FRONT: `store_attribute`
 * (parser.rb l.2131, the chop at l.2133-40) chops it off whichever end carries it and
 * reaches the same unset either way, and `:!name:` is the form the
 * AsciiDoc documentation leads with. And the NAME goes down:
 * `sanitize_attribute_name` (parser.rb l.2770-71) is
 * `name.gsub(InvalidAttributeNameCharsRx, '').downcase`, so the case
 * an author typed reaches neither the attribute table nor any
 * reference to it. The character-stripping half of that sanitize is
 * NOT copied — `:Foo Bar:` prints `:foo bar:`, which Asciidoctor
 * sanitizes to the same `foobar` the original did.
 *
 * A value the author CONTINUED onto the lines below carries those
 * lines in its own text, separated by newlines, and they are written
 * back where they stood (see src/parse/lines/attribute-entry.ts for
 * why the split points are the author's to keep). Splitting on the
 * newline is what a block comment's body already does two functions
 * up: a Doc string may hold no line break of its own.
 * @param node - The attribute entry node.
 * @param node.name - The attribute name (without
 *   surrounding colons), as the author spelled it.
 * @param node.value - The attribute value, or undefined
 *   for no-value entries (`:toc:`) and unset entries.
 * @param node.unset - Whether the entry unsets the attribute.
 * @returns Doc IR for the formatted attribute entry.
 */
export function printAttributeEntry(node: {
  name: string;
  value: string | undefined;
  unset: boolean;
}): Doc {
  const bang = node.unset ? "!" : "";
  const name = node.name.toLowerCase();
  if (node.value !== undefined) {
    return [":", bang, name, ": ", join(hardline, node.value.split("\n"))];
  }
  return [":", bang, name, ":"];
}

/**
 * Prints one line of a document header.
 *
 * The two attribution lines and the preprocessor directive print
 * their span back VERBATIM: they are line-oriented header syntax, not
 * prose, and there is no derivation that could put them back - see
 * {@link AuthorLineNode}. The other two go through the printers every
 * other attribute entry and comment go through, so a header attribute
 * entry is normalized exactly like a body one (`:name!:` still prints
 * `:!name:`).
 * @param node - one header line
 * @returns Doc IR for the line, without its newline
 */
function printHeaderLine(node: HeaderLineNode): Doc {
  switch (node.type) {
    case "attributeEntry": {
      return printAttributeEntry(node);
    }
    case "comment": {
      return printComment(node);
    }
    case "preprocessorDirective":
    case "authorLine":
    case "revisionLine": {
      return node.value;
    }
  }
}

/**
 * Prints the document header: the title line, then its lines, each on
 * the line below the last.
 *
 * The separator is a plain `hardline` and there is no decision above
 * it - that is the fix for issue #18. Asciidoctor's header ENDS at
 * the first blank line, so a blank line anywhere inside it demotes
 * everything below to body content: the author line becomes the first
 * paragraph and every section boundary under it shifts. Owning the
 * lines is what leaves {@link joinBlocks} nothing to get wrong here.
 * @param node - the header node
 * @returns Doc IR for the whole header
 */
export function printDocumentHeader(node: DocumentHeaderNode): Doc {
  return [
    // The title is level 0 by construction - a header opens at no
    // other level - so the marker is the same arithmetic the heading
    // arm does, with the level folded out.
    "=".repeat(MARKER_OFFSET),
    " ",
    node.title,
    ...node.lines.map((child): Doc => [hardline, printHeaderLine(child)]),
  ];
}
