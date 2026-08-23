/**
 * Delimited blocks: the verbatim ones whose content is source text
 * (listing, literal, pass, fenced code, comment block) and the parent
 * ones whose content is blocks (example, sidebar, open, quote).
 *
 * Every function here takes the block's `extent` and the document's
 * `LocationIndex` (`at`); most also take what was already decided
 * elsewhere — a variant, a role, a rename, or the parsed children —
 * and return the finished node. The extent states its own offsets —
 * where content stops and where the node ends — so no builder here
 * re-derives a boundary from a delimiter (spec D4). No traversal, no
 * context: what a line MEANS was decided by lines/classify.ts against
 * the registry in line-shapes.ts, and which block it belongs to by
 * the extent lines/reader.ts collected for it. These only take it
 * apart.
 */
import type {
  AdmonitionNode,
  BlockNode,
  CommentNode,
  DelimitedBlockNode,
  ParentBlockNode,
} from "../../ast.js";
import { NEWLINE_LENGTH } from "../../constants.js";
import type { VerbatimRole } from "../lines/frames.js";
import type { Fragment, LocationIndex } from "../positions.js";

/** The source extent an extent-first delimited read produced. */
export interface BlockExtent {
  /** The opening delimiter line. */
  readonly open: Fragment;
  /**
   * The closing delimiter line, when the block met one. Optional
   * DATA (the table arm branches on it for its raw end), not half
   * of an exclusive pair — `contentEnd` and `end` are total either
   * way, and nothing decodes a two-field encoding of one fact.
   */
  readonly close: Fragment | undefined;
  /**
   * Exclusive offset where content stops: the raw end of the last
   * interior line — always a line's OWN end, never a boundary
   * offset minus one (the arithmetic that dropped a confined
   * content byte, #44). The open line's raw end when the interior
   * is empty (which puts it before contentStart, and the slice
   * guard yields "").
   */
  readonly contentEnd: number;
  /**
   * Exclusive offset where the NODE ends — total over both close
   * kinds: past the close line's raw end when the block closed;
   * the confinement's forced-close offset (spec D2's convention: an
   * inner block's forced end is the terminator line's START; the
   * closed block's OWN end is that line's raw END) when it did not.
   */
  readonly end: number;
  /** The whole document; verbatim content is sliced from it. */
  readonly source: string;
}

/**
 * The half of a {@link BlockExtent} a parent-model builder reads: a
 * compound block's content is its parsed children, never a slice, so
 * only where it opened and where the node ends travel (the
 * extent-first packager passes the full BlockExtent here too,
 * structurally). NOT exported (knip's types bucket gates dead
 * exported types at 0): callers pass literals or a whole BlockExtent;
 * the name exists for the two builders' signatures alone.
 */
type ParentExtent = Pick<BlockExtent, "open" | "end">;

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
  const { open, contentEnd, end, source } = extent;
  // Content starts after the open delimiter + newline.
  const contentStart = open.offset + open.image.length + NEWLINE_LENGTH;
  const content =
    contentStart <= contentEnd ? source.slice(contentStart, contentEnd) : "";
  return {
    type: "delimitedBlock",
    variant,
    form: "delimited",
    content,
    ...(sourceDelimiter === undefined ? {} : { sourceDelimiter }),
    position: { start: at.start(open), end: at.at(end) },
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
  const { open, contentEnd, end, source } = extent;
  const contentStart = open.offset + open.image.length + NEWLINE_LENGTH;
  const value =
    contentStart <= contentEnd ? source.slice(contentStart, contentEnd) : "";
  return {
    type: "comment",
    commentType: "block",
    value,
    position: { start: at.start(open), end: at.at(end) },
  };
}

/**
 * A table block, passed through as an opaque verbatim extent (spec
 * D1, the issue #10 interim fix — full table MODELING is out of
 * scope). Unlike every other delimited block the DELIMITER LINES ARE
 * CONTENT: the slice runs from the start of the opening line through
 * the RAW end of the closing line (trailing whitespace kept, newline
 * excluded), or — forced shut — through `contentEnd`, the raw end
 * of the last line this reader can see (behavior is Ruby's: an
 * unterminated table runs to EOF, parser.rb:863; pinned by
 * tests/parser/table.test.ts and tests/format/table.test.ts).
 * @param extent - where the block opened and closed
 * @param at - the document's location index
 * @returns the table node
 */
function buildTableBlock(
  extent: BlockExtent,
  at: LocationIndex,
): DelimitedBlockNode {
  const { open, close, contentEnd, end, source } = extent;
  // The delimiter lines ARE content (spec D1/α-D1): through the close
  // line's raw end when the table closed, through the last interior
  // line's raw end when it did not — the same bytes as the old
  // spelling on closed tables, the fixed bytes on confined-
  // unterminated ones (#44).
  const rawEnd = close === undefined ? contentEnd : end;
  return {
    type: "delimitedBlock",
    variant: "table",
    form: "delimited",
    content: source.slice(open.offset, rawEnd),
    position: { start: at.start(open), end: at.at(end) },
  };
}

/**
 * A delimited block kept verbatim — listing, literal, pass, fence,
 * verse — or a comment block (a CommentNode), or a table (spec D1).
 * The ROLE was decided at open (lines/open-style.ts) and travels
 * with the extent: nothing is re-derived from the opener here, which
 * is what deleted the two agreement guards this function and
 * verbatimVariant used to carry (spec D4a).
 * @param extent - where the block opened and closed
 * @param role - what the opening line resolved to build
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
 * and the wrapper are one fact). Position is the parent block's own:
 * start at the opener, end at the extent's total `end` (one formula
 * for every close kind, spec D4).
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
  extent: ParentExtent,
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
  return {
    type: "admonition",
    variant,
    form: delimiter,
    text: [],
    children,
    position: { start: at.start(extent.open), end: at.at(extent.end) },
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
 * the extent states it as one offset (`end`) rather than as a pair
 * of boundaries this builder would have to decode.
 * @param extent - where the block opened and where the node ends
 * @param variant - which parent block it is
 * @param children - the blocks the reader put inside it
 * @param at - the document's location index
 * @returns the parent block node
 */
export function buildParentBlock(
  extent: ParentExtent,
  variant: ParentBlockNode["variant"],
  children: BlockNode[],
  at: LocationIndex,
): ParentBlockNode {
  return {
    type: "parentBlock",
    variant,
    children,
    position: { start: at.start(extent.open), end: at.at(extent.end) },
  };
}
