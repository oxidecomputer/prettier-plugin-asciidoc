/**
 * Delimited blocks: the verbatim ones whose content is source text
 * (listing, literal, pass, fenced code, comment block) and the parent
 * ones whose content is blocks (example, sidebar, open, quote).
 *
 * Every function here takes the block's `extent` and the document's
 * `LocationIndex` (`at`); most also take what was already decided
 * elsewhere — a variant, a role, a rename, or the parsed children —
 * and return the finished node (`closeExtent`, the shared boundary
 * helper, returns offsets instead of a node). No traversal, no
 * context: what a line MEANS was decided by lines/classify.ts against
 * the registry in line-shapes.ts, and which block it belongs to by
 * the reader's frame stack. These only take it apart.
 */
import type {
  AdmonitionNode,
  BlockNode,
  CommentNode,
  DelimitedBlockNode,
  Location,
  ParentBlockNode,
} from "../../ast.js";
import { NEWLINE_LENGTH } from "../../constants.js";
import type { VerbatimRole } from "../lines/frames.js";
import type { Fragment, LocationIndex } from "../positions.js";

/**
 * The source extent a delimited block read: where it opened, where it
 * closed, and the document both sit in.
 *
 * A block that met its own terminator closes on it; one the reader
 * forced shut (an outer terminator took the line, or EOF came first)
 * closes at the zero-length `unclosed` boundary — at the start of the
 * terminator line that ended it, or at the end of the document.
 * Both undefined reads as EOF; the reader always supplies one.
 */
export interface BlockExtent {
  /** The opening delimiter line. */
  readonly open: Fragment;
  /** The block's own closing delimiter, when it had one. */
  readonly close: Fragment | undefined;
  /**
   * The zero-length forced-close boundary, when it did not.
   * Valid only when `close` is undefined: the two spell the same fact
   * from opposite sides, and the reader always supplies exactly one.
   */
  readonly unclosed: Fragment | undefined;
  /**
   * The whole document. Verbatim content is sliced out of it rather
   * than rebuilt line by line, because a rebuild loses the blank
   * lines inside; and a block forced shut at EOF ends where it ends.
   */
  readonly source: string;
}

/**
 * The content end offset and node end position a block's close implies.
 * @param extent - where the block opened and closed
 * @param at - the document's location index
 * @returns the exclusive offset where content stops (the newline before
 *   a terminator line is not content) and the node's end location
 */
function closeExtent(
  extent: BlockExtent,
  at: LocationIndex,
): { contentEnd: number; end: Location } {
  const { close, unclosed, source } = extent;
  if (close !== undefined) {
    return {
      contentEnd: close.offset - NEWLINE_LENGTH,
      end: at.end(close),
    };
  }
  // A forced close on a LINE: the outer terminator begins there, so
  // the content stops before the newline that precedes it. At EOF the
  // boundary sits one past the last character and everything after the
  // opener is content — up to the document's final newline, which is a
  // line terminator, not content (a synthesised closer goes directly
  // under the last content line).
  if (unclosed !== undefined && unclosed.offset < source.length) {
    return {
      contentEnd: unclosed.offset - NEWLINE_LENGTH,
      end: at.start(unclosed),
    };
  }
  return {
    contentEnd: source.endsWith("\n")
      ? source.length - NEWLINE_LENGTH
      : source.length,
    end: at.at(source.length),
  };
}

/**
 * Builds a DelimitedBlockNode from its extent by extracting content
 * verbatim from the source text. Line-based reconstruction would lose
 * the blank lines inside.
 * @param extent - where the block opened and closed
 * @param variant - The block variant (listing, literal, pass,
 *   etc.) that determines how the printer formats content.
 * @param at - the document's location index
 * @param sourceDelimiter - the masqueraded parent's delimiter, when a
 *   style re-modeled the block (spec D4a); spread in BEFORE
 *   `position`, and THIS field is never assigned after construction —
 *   key order is part of parity's no-change claim, pinned by the
 *   key-order rows in tests/parser/block-masquerade.test.ts. Not a
 *   blanket rule for the node: `annotatedBy` IS stamped after
 *   construction (spec D5a, lines/reader.ts) and therefore trails
 *   `position`, which is admissible only because the parity fold
 *   drops that key before digesting (scripts/parity.ts), so its
 *   position never enters the comparison.
 * @returns A complete DelimitedBlockNode with content sliced
 *   directly from the source text.
 */
function buildDelimitedBlock(
  extent: BlockExtent,
  variant: DelimitedBlockNode["variant"],
  at: LocationIndex,
  sourceDelimiter?: ParentBlockNode["variant"],
): DelimitedBlockNode {
  const { open, source } = extent;
  // Content starts after the open delimiter + newline.
  const contentStart = open.offset + open.image.length + NEWLINE_LENGTH;
  const { contentEnd, end } = closeExtent(extent, at);
  const content =
    contentStart <= contentEnd ? source.slice(contentStart, contentEnd) : "";
  return {
    type: "delimitedBlock",
    variant,
    form: "delimited",
    content,
    ...(sourceDelimiter === undefined ? {} : { sourceDelimiter }),
    position: { start: at.start(open), end },
  };
}

/**
 * Builds a CommentNode from a block comment's extent.
 * Content is sliced from the source text rather than rebuilt line by
 * line (which would lose the blank lines inside); a forced close ends
 * it where the reader ended the block.
 * @param extent - where the block opened and closed
 * @param at - the document's location index
 * @returns A CommentNode with block type whose value contains
 *   the raw content between (or after) the delimiters.
 */
function buildBlockComment(
  extent: BlockExtent,
  at: LocationIndex,
): CommentNode {
  const { open, source } = extent;
  const contentStart = open.offset + open.image.length + NEWLINE_LENGTH;
  const { contentEnd, end } = closeExtent(extent, at);
  const value =
    contentStart <= contentEnd ? source.slice(contentStart, contentEnd) : "";
  return {
    type: "comment",
    commentType: "block",
    value,
    position: { start: at.start(open), end },
  };
}

/**
 * A table block, passed through as an opaque verbatim extent (spec
 * D1, the issue #10 interim fix — full table MODELING is out of
 * scope). Unlike every other delimited block the DELIMITER LINES ARE
 * CONTENT: the slice runs from the start of the opening line through
 * the RAW end of the closing line (trailing whitespace kept, newline
 * excluded), or — forced shut — through the existing `closeExtent`
 * boundary, which is the raw end of the last line this reader can
 * see (behavior is Ruby's: an unterminated table runs to EOF,
 * parser.rb:863; pinned by tests/parser/table.test.ts and
 * tests/format/table.test.ts).
 * @param extent - where the block opened and closed
 * @param at - the document's location index
 * @returns the table node
 */
function buildTableBlock(
  extent: BlockExtent,
  at: LocationIndex,
): DelimitedBlockNode {
  const { open, close, source } = extent;
  const { contentEnd, end } = closeExtent(extent, at);
  const rawEnd =
    close === undefined ? contentEnd : close.offset + close.image.length;
  return {
    type: "delimitedBlock",
    variant: "table",
    form: "delimited",
    content: source.slice(open.offset, rawEnd),
    position: { start: at.start(open), end },
  };
}

/**
 * A delimited block kept verbatim — listing, literal, pass, fence,
 * verse — or a comment block (a CommentNode), or a table (spec D1).
 * The ROLE was decided at open (lines/open-style.ts) and travels on
 * the frame: nothing is re-derived from the opener here, which is
 * what deleted the two agreement guards this function and
 * verbatimVariant used to carry (spec D4a).
 * @param extent - where the block opened and closed
 * @param role - what the frame decided to build, at open
 * @param at - the document's location index
 * @returns the node the role names
 */
export function buildVerbatimBlock(
  extent: BlockExtent,
  role: VerbatimRole,
  at: LocationIndex,
): DelimitedBlockNode | CommentNode {
  if (role.builds === "comment") {
    return buildBlockComment(extent, at);
  }
  if (role.builds === "table") {
    return buildTableBlock(extent, at);
  }
  const node = buildDelimitedBlock(
    extent,
    role.variant,
    at,
    role.sourceDelimiter,
  );
  // fenced/language stay POST-construction assignments on purpose:
  // that is where today's builder puts them, so the serialized key
  // order (…, position, fenced, language) — which parity hashes —
  // does not move. Pinned by the fence key-order row in
  // tests/parser/block-masquerade.test.ts.
  if (role.fenced === true) {
    node.fenced = true;
    if (role.language !== undefined) node.language = role.language;
  }
  return node;
}

/**
 * A delimited block a held admonition style renamed at open
 * (parser.rb:537-538): an AdmonitionNode that KEEPS its parsed
 * children — Ruby keeps the :compound content model (parser.rb:872-875).
 * The wrapper delimiter IS the node's `form` (spec D7: the spelling
 * and the wrapper are one fact). Position is the parent block's own
 * (same extent rule).
 *
 * The rename travels as ONE parameter because the linter caps a
 * builder at four; the two halves are inseparable anyway — a rename
 * is a delimiter and the variant it was renamed to.
 * @param extent - where the block opened and closed
 * @param rename - what the held style made of the block
 * @param rename.delimiter - which parent-block delimiter wraps the body
 * @param rename.variant - the admonition variant (lowercase)
 * @param children - the blocks the reader put inside it
 * @param at - the document's location index
 * @returns the admonition node
 */
export function buildDelimitedAdmonition(
  extent: BlockExtent,
  rename: {
    /** Which parent-block delimiter wraps the body. */
    readonly delimiter: ParentBlockNode["variant"];
    /** The admonition variant (lowercase). */
    readonly variant: string;
  },
  children: BlockNode[],
  at: LocationIndex,
): AdmonitionNode {
  const { delimiter, variant } = rename;
  const { end } = closeExtent(extent, at);
  return {
    type: "admonition",
    variant,
    form: delimiter,
    text: [],
    children,
    position: { start: at.start(extent.open), end },
  };
}

/**
 * A delimited block whose content is parsed as blocks: example,
 * sidebar, open, quote.
 *
 * A parent block's own position ends where the extent it READ ends —
 * on its terminator when it met one, at the start of the outer
 * terminator that took the line when it did not, and at the document
 * end at EOF. That is the same rule the verbatim blocks follow, and
 * the reason this function needs the source: until this change it
 * passed `closeExtent` an empty string, so every forced-closed parent
 * block ended at offset 0 — before its own start unless it happened
 * to begin the document. Fixed here as the one enumerated intended
 * AST difference of the plan that removed the parser toolkit;
 * `scripts/parity.ts --allow-parent-block-end` is what allows it
 * through, and nothing else.
 * @param extent - where the block opened and closed
 * @param variant - which parent block it is
 * @param children - the blocks the reader put inside it
 * @param at - the document's location index
 * @returns the parent block node
 */
export function buildParentBlock(
  extent: BlockExtent,
  variant: ParentBlockNode["variant"],
  children: BlockNode[],
  at: LocationIndex,
): ParentBlockNode {
  const { end } = closeExtent(extent, at);
  return {
    type: "parentBlock",
    variant,
    children,
    position: { start: at.start(extent.open), end },
  };
}
