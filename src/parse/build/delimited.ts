/**
 * Delimited blocks: the verbatim ones whose content is source text
 * (listing, literal, pass, fenced code, comment block) and the parent
 * ones whose content is blocks (example, sidebar, open, quote).
 *
 * Every function here is `(extent, index) → node` and nothing else:
 * no traversal, no context. What a line MEANS was decided by
 * lines/classify.ts against the registry in line-shapes.ts, and which
 * block it belongs to by the reader's frame stack. These only take it
 * apart.
 */
import type {
  BlockNode,
  CommentNode,
  DelimitedBlockNode,
  Location,
  ParentBlockNode,
} from "../../ast.js";
import { EMPTY, NEWLINE_LENGTH } from "../../constants.js";
import { unreachable } from "../../unreachable.js";
import { rstrip } from "../line-shapes.js";
import { delimiterKind, type DelimiterKind } from "../lines/classify.js";
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
 * @returns A complete DelimitedBlockNode with content sliced
 *   directly from the source text.
 */
function buildDelimitedBlock(
  extent: BlockExtent,
  variant: DelimitedBlockNode["variant"],
  at: LocationIndex,
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
 * The AST variant of a verbatim delimited block. Fenced code blocks are
 * listing blocks in the AST: AsciiDoc and Markdown fences serve the
 * same purpose — the distinction is syntactic, not semantic.
 * @param kind - the opener's delimiter kind (never a comment block)
 * @param open - the opener, for the error message
 * @returns the variant
 */
function verbatimVariant(
  kind: DelimiterKind,
  open: Fragment,
): "listing" | "literal" | "pass" {
  const variant = kind === "fencedCode" ? "listing" : kind;
  if (variant !== "listing" && variant !== "literal" && variant !== "pass") {
    // Three places have to agree on which delimiters are verbatim:
    // `delimiterKind`'s union, the reader's COMPOUND_VARIANTS (a kind
    // in it opens a compound frame and never reaches here), and this
    // list. The guard is the only thing that holds them together.
    return unreachable(`not a verbatim delimiter: ${open.image}`);
  }
  return variant;
}

// A fenced code block's opener is three backticks followed by the
// optional language hint: "```rust" → "rust".
const BACKTICK_COUNT = 3;

/**
 * A delimited block whose content is verbatim — listing, literal,
 * pass, fenced code — or a comment block, which is a CommentNode.
 *
 * The kind comes from the opener's delimiter; content is sliced from
 * the source between the delimiters rather than rebuilt from lines,
 * because a rebuild loses the blank lines inside.
 * @param extent - where the block opened and closed
 * @param at - the document's location index
 * @returns the delimited block, or a block comment
 */
export function buildVerbatimBlock(
  extent: BlockExtent,
  at: LocationIndex,
): DelimitedBlockNode | CommentNode {
  const { open } = extent;
  // The frame was opened by `delimiterKind` recognising this same
  // line, so re-running it here cannot miss — unless the reader and
  // this builder disagree about what the opener's text is (rstrip,
  // the fence tip). The guard is what says they must agree.
  const kind =
    delimiterKind(rstrip(open.image)) ??
    unreachable(`not a delimiter: ${open.image}`);
  if (kind === "commentBlock") {
    return buildBlockComment(extent, at);
  }
  const node = buildDelimitedBlock(extent, verbatimVariant(kind, open), at);
  if (kind === "fencedCode") {
    // Fences imply the `source` style even without a language hint;
    // the printer uses this to decide whether to emit `[source]`.
    node.fenced = true;
    const language = open.image.slice(BACKTICK_COUNT).trim();
    if (language.length > EMPTY) node.language = language;
  }
  return node;
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
