/**
 * What a BlockReader is GIVEN: the document-wide facts every reader
 * over one document shares, how a reader that is not the document
 * reader is bounded, and the three questions a confinement answers
 * about the reader it bounds.
 *
 * Split out of reader.ts when that file met the 450-line ceiling -
 * the coding standard's prescribed response, and this is the natural
 * piece to move: the declarations say what a reader is handed rather
 * than what it does, and the three readings below are pure functions
 * of {@link Confinement}, which is declared here.
 */
import type { GapLine } from "../../ast.js";
import {
  conditionalDirective,
  type ParagraphContext,
  type ReaderContext,
} from "../line-shapes.js";
import type { LocationIndex } from "../positions.js";

/**
 * How a reader is confined, when it is not the document reader.
 */
export type Confinement =
  | {
      /**
       * A list item's buffer - the `Reader.new
       * read_lines_for_list_item(...)` `parse_list_item` builds at
       * parser.rb:1359.
       */
      readonly kind: "item";
      /** The item's marker style - the one-style ancestry. */
      readonly style: string;
      /** The item's own tail-safety (ItemExtent.tailSafe). */
      readonly tailSafe: boolean;
      /**
       * How many conditional pairs stand open where this buffer
       * begins. ONE PRODUCER: reader.ts, which folds
       * {@link directiveDepthAfter} over the lines it walks and hands
       * its own count to every reader it confines and every extent
       * scan it starts. The scan keeps a count of its OWN, over the
       * lines it consumes; neither writes the other's.
       */
      readonly directiveDepth: number;
      /**
       * Where a forced close at this buffer's end falls: the last
       * buffer line's raw end - the vii-b clamp, computed at the one
       * place that knows the buffer (listItem()) and carried as data.
       */
      readonly closeOffset: number;
    }
  | {
      /**
       * A compound block's interior (Ruby: build_block's Reader,
       * parser.rb:1046; parse_blocks "does not consider sections",
       * :1091-1092).
       */
      readonly kind: "block";
      /**
       * Whether a trailing `+` at this interior's end re-reads inert
       * - true when the block closed (the printed terminator follows
       * on the very next line and pops it), the enclosing reader's own
       * tail-safety when it did not.
       */
      readonly tailSafe: boolean;
      /**
       * How many conditional pairs stand open where this interior
       * begins - the enclosing reader's own count at the compound
       * open, handed on for the same reason the item arm's is.
       */
      readonly directiveDepth: number;
      /**
       * Where a forced close at this interior's end falls: the
       * terminator line's start when the block closed, the
       * enclosing reader's own forced-close offset when it did not.
       */
      readonly closeOffset: number;
    };

/** What every reader over this document shares, however confined. */
export interface ReaderScope {
  /** The whole document. */
  readonly source: string;
  /** The document's offset->Location index, built once. */
  readonly at: LocationIndex;
  /**
   * The document-wide gap record: every extent scan, at every nesting
   * depth, hands back the separator lines it consumed, reader.ts
   * applies them here, and each item's blocks are paired with their
   * gaps by partitioning it (listItemNode -> gapsOf). Shared because
   * an inner scan re-reads an outer item's buffer, which omits blanks
   * the outer scan skipped - the outer scan's entries are the only
   * record of them.
   */
  readonly gaps: GapRecord;
}

/**
 * The document-wide record of separator lines: 1-based document line
 * number -> what the line spells in a gap. Its writer is reader.ts's
 * applyGapWrites, which holds the rule that makes it correct - FIRST
 * write wins, because an inner scan re-reads an outer item's buffer
 * where a `+` the outer scan erased spells `""`, so the earliest
 * write is the one made by the scan that saw the least-doctored line.
 * Keying by document line number is what makes the union of every
 * scan's writes automatic.
 *
 * Declared here, beside the scope that carries it, because that is
 * where its writer is: the scans decide spellings and return them
 * (GapWrite, item-tail.ts) and reader.ts applies them. NOT exported:
 * nothing else names the type - the reader reaches it through
 * {@link ReaderScope.gaps}, and `gapsOf` (list-reader.ts) takes the
 * read side structurally, which is what keeps the record's own
 * spelling in one file.
 */
type GapRecord = Map<number, GapLine>;

/**
 * Whether a `+` printed at the very end of a reader's lines re-reads
 * inert - the boundary fact every extent scan run from that reader
 * inherits. The document's end is EOF, always safe; an item buffer's
 * end is wherever the enclosing item ended, so the answer is that
 * item's own; a block child's is `closed || enclosing`, decided at
 * the compound open.
 * @param confinement - how the reader is confined, absent for the
 *   document reader
 * @returns the boundary fact the extent scans inherit
 */
export function tailSafeIn(confinement: Confinement | undefined): boolean {
  return confinement?.tailSafe ?? true;
}

/**
 * Where a forced close at a reader's stream end falls: the document
 * length for the document reader (one past the final newline - the
 * spelling every unclosed-at-EOF position has always had), the
 * confinement's boundary for a confined one. One derivation for the
 * boundary every forced close shares, pinned by
 * tests/parser/delimited-end-convention.test.ts and the
 * confined-extent fixtures' position literals.
 * @param confinement - how the reader is confined, absent for the
 *   document reader
 * @param source - the whole document, whose length is the document
 *   reader's own answer
 * @returns the offset a forced close at stream end is stamped with
 */
export function closeOffsetIn(
  confinement: Confinement | undefined,
  source: string,
): number {
  return confinement?.closeOffset ?? source.length;
}

/**
 * The list ancestry the classifier reads inside a reader. Lists are
 * read extent-first and a confined buffer is already truncated at
 * every ancestor list's boundary, so ONE style - the confined item's
 * own - is the whole ancestry the classifier can ever need (the
 * foreign-marker verbatim rule keys on it). A block child reports
 * undefined: fresh-reader behavior is Ruby's (build_block ->
 * Reader.new, no list_type).
 * @param confinement - how the reader is confined, absent for the
 *   document reader
 * @returns the open list's marker style, or undefined
 */
export function openListStyleIn(
  confinement: Confinement | undefined,
): string | undefined {
  return confinement?.kind === "item" ? confinement.style : undefined;
}

/**
 * The conditional-stack depth after one more line - `+ 1` where the
 * line opens a region, `- 1` where it closes one, unchanged
 * everywhere else ({@link conditionalDirective}).
 *
 * The floor at zero is Ruby's: an `endif` with nothing open is the
 * "unmatched preprocessor directive" error, which logs and pops
 * nothing (reader.rb l.916-917).
 *
 * ONE fold, two holders. reader.ts folds it over the lines it walks
 * and rides the answer on {@link Confinement}; the item scan folds
 * the same function over the lines it consumes and keeps the answer
 * to itself. Both are counting the pairs the author wrote, which is
 * why one fold serves both.
 * @param depth - the depth before the line
 * @param line - one rstripped source line
 * @returns the depth after it
 */
export function directiveDepthAfter(depth: number, line: string): number {
  const directive = conditionalDirective(line);
  if (directive === "opens") {
    return depth + 1;
  }
  return directive === "closes" ? Math.max(depth - 1, 0) : depth;
}

/**
 * Whether the next block belongs to a list item's DIRECT interior.
 * `options[:list_type]` travels only through parse_list_item's own
 * next_block loop: a delimited block inside the item parses its
 * children from a fresh reader with no list flavor (`build_block` ->
 * `Reader.new`), which is literally what happens here - a block child
 * carries `kind: "block"`, so the item's contexts stop at it BY
 * CONSTRUCTION (pinned by the flavor-bit row in
 * tests/format/confinement.test.ts).
 * @param confinement - how the reader is confined, absent for the
 *   document reader
 * @returns true in an item-confined reader
 */
export function directlyInItem(confinement: Confinement | undefined): boolean {
  return confinement?.kind === "item";
}

/**
 * Which interrupting set a paragraph-shaped block gets. Ruby's
 * next_block reads an in-item paragraph with `read_paragraph_lines
 * reader, skipped == 0 && options[:list_type]` (parser.rb
 * l.754/764): adjacent to the previous content the list-item set
 * applies; after any blank line - an erased `+` included, which the
 * buffer spells as a blank - the plain set does (the registry's
 * listContinuation).
 *
 * A reading of the confinement and the reader's own blank run
 * together, which is what puts it beside the other three rather than
 * in reader.ts: both halves are things the reader is HANDED or has
 * counted, and neither is a decision about the block.
 * @param confinement - how the reader is confined, absent for the
 *   document reader
 * @param blanks - blank lines seen since the last consumed line
 * @returns the context for the block about to be read
 */
export function bodyContextIn(
  confinement: Confinement | undefined,
  blanks: number,
): ParagraphContext {
  if (!directlyInItem(confinement)) {
    return "paragraph";
  }
  return blanks > 0 ? "listContinuation" : "listItem";
}

/**
 * The reader's state as `classifyLine` consumes it AT A BLOCK START -
 * read, never derived. The other two positions belong to the extent
 * scans, which build their own context from the same ancestry fact
 * ({@link openListStyleIn}): nothing open, and no line is "first
 * after the block started" until a block has started.
 *
 * The line BELOW is offered to an UNCONFINED reader alone, which is
 * where Ruby asks its one two-line question: `is_next_line_section?`
 * belongs to `next_section`'s loop (parser.rb l.374), and an item's
 * buffer or a compound interior is parsed by `parse_blocks` ->
 * `next_block`, which never reaches it. Deciding that here, at the
 * one producer of a block-start context, keeps the setext arm out of
 * every confined reader without a second test anywhere.
 * @param confinement - how the reader is confined, absent for the
 *   document reader
 * @param nextLine - the line below the one being classified, or
 *   undefined at the end of this reader's stream
 * @returns the read-only context view
 */
export function blockStartContextIn(
  confinement: Confinement | undefined,
  nextLine: string | undefined,
): ReaderContext {
  return {
    openParagraph: undefined,
    openListStyle: openListStyleIn(confinement),
    firstLineAfterStart: false,
    nextLine: confinement === undefined ? nextLine : undefined,
  };
}
