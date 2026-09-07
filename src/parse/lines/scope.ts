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
import type { BlockNode, GapLine } from "../../ast.js";
import {
  contextAbove,
  documentWhitespaceContext,
  type WhitespaceContext,
} from "../../whitespace-fact.js";
import {
  conditionalDirective,
  isDelimiterLine,
  type OpenList,
  type ParagraphContext,
  preprocessorLineEffect,
  type ReaderContext,
} from "../line-shapes.js";
import type { LocationIndex } from "../positions.js";
import type { SourceLine } from "./split.js";

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
      /** The item's own list - the one-list ancestry. */
      readonly list: OpenList;
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
  /**
   * The document's half of every prose block's whitespace context
   * ({@link WhitespaceContext}, src/whitespace-fact.ts): what the
   * document's own attribute entries set. Built once, beside `at`,
   * because it is a fact about the whole source and every confined
   * read needs it.
   */
  readonly whitespace: WhitespaceContext;
}

/**
 * The scope one document's readers share, built once at the top of
 * the read.
 *
 * Here rather than at the call because every field is a fact about
 * the WHOLE source, and this is the module that says what a reader is
 * given: a second caller building the record by hand is a second
 * chance to leave one of them out.
 * @param source - the whole document
 * @param at - the document's offset-to-Location index
 * @returns the scope
 */
export function documentScope(source: string, at: LocationIndex): ReaderScope {
  return {
    source,
    at,
    // One gap record per document - see ReaderScope.gaps.
    gaps: new Map(),
    whitespace: documentWhitespaceContext(source),
  };
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
 * every ancestor list's boundary, so ONE list - the confined item's
 * own - is the whole ancestry the classifier can ever need (the
 * sibling rules and the foreign-marker verbatim rule key on it). A block child reports
 * undefined: fresh-reader behavior is Ruby's (build_block ->
 * Reader.new, no list_type).
 * @param confinement - how the reader is confined, absent for the
 *   document reader
 * @returns the list open around a confined reader, or undefined
 */
export function openListIn(
  confinement: Confinement | undefined,
): OpenList | undefined {
  return confinement?.kind === "item" ? confinement.list : undefined;
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
 * Whether substituted content stands directly above one line - the
 * reading behind {@link ReaderContext.substitutedContentAbove}, which
 * states what the answer means and what the classifier does with it.
 *
 * Read BACKWARDS off the reader's own lines, one step in the ordinary
 * case and further only through the lines the preprocessor DELETES,
 * so that whatever was above one of those is above the line under it
 * too. Everything else stops the walk, with the answer this one line
 * gives: a directive that SUBSTITUTES ends it true, and any other
 * line ends it false. A blank line is one of those others, and so is
 * every line the classifier would go on to hold as block metadata -
 * a `.Title`, an attribute entry - because the classifier answers
 * those with this very field and reads them as paragraph text while
 * it is true, which leaves the line below them inside a paragraph
 * rather than at a block start this ever runs for.
 * {@link preprocessorLineEffect} names the two effects and cites the
 * arms of each.
 *
 * A reading rather than a fold the reader carries, and that is what
 * makes it exact: the answer is about the line PHYSICALLY above, so it
 * is the same at a block start the reader walked to and at one it
 * resumed to past a whole extent, with no state to keep in step.
 * @param lines - the lines this reader walks
 * @param at - the index of the line being classified
 * @returns true when a substituting directive stands above that line
 */
function substitutedContentStandsAbove(
  lines: readonly SourceLine[],
  at: number,
): boolean {
  for (let index = at - 1; index >= 0; index -= 1) {
    const effect = preprocessorLineEffect(lines[index].text);
    if (effect !== "deleted") {
      return effect === "substitutes";
    }
  }
  return false;
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
 * Whether the line printed directly above one in-item block start is
 * one the printer replays BYTE FOR BYTE and that leaves no paragraph
 * open under it - the two conditions a canonical `'''` needs to read
 * back as the break it was read as.
 *
 * TWO SHAPES ANSWER YES, and they are the whole list:
 *
 * - An ERASED `+`, the `+` the item's own scan read as this item's
 *   continuation and replaced with `ListContinuationPlaceholder`
 *   (parser.rb l.1439). The gap in front of the block below it records
 *   that `+` and the printer writes it back on its own line
 *   ({@link gapParts}), so the bytes the answer depends on are the
 *   bytes the output carries. A `marker`-tagged `+` is NOT this:
 *   `within_nested_list` (parser.rb l.1415) held it for a nested
 *   list's own scan, so this item neither owns it nor prints it here.
 * - A DELIMITER LINE, which at a block start can only be the
 *   TERMINATOR of the delimited block that ended on it: a delimiter
 *   that OPENED a block would have taken this position into that
 *   block's extent. A delimited block prints its own delimiters back
 *   as the author spelled them, and the gap between it and the block
 *   below is empty here, so again the deciding bytes survive.
 *
 * ITEM TEXT is left out for the reason that governs the whole family:
 * a `'''` directly under an open paragraph is absorbed into it
 * (`StartOfBlockOrListProc`, parser.rb l.40, matches no break), and
 * the printer both joins and wraps text, so which text stands above
 * is not the reader's to know.
 *
 * A true BLANK line is left out for a different reason, and it is why
 * the test is not simply "not text": Asciidoctor reads a break across
 * a blank run inside an item too, but the blank the printer writes
 * there does not keep the break INSIDE the item on re-read - a blank
 * with no `+` ends the item's buffer, so the `'''` below it comes
 * back as the document's own break rather than the item's.
 *
 * A LINE COMMENT above the rule is neither, and it is an UNOPENED
 * candidate rather than a shape ruled out: `//` is replayed byte for
 * byte and leaves no paragraph open, and `* a` / `+` / `// c` / `'''`
 * / `last` measures the same render as the author's own rule in both
 * programs. Taking it is a widening of this list, with its own
 * witnesses, not a consequence of the two clauses above.
 * @param above - the line physically above the block start, REQUIRED
 *   because an in-item block start always has one
 *   ({@link markerLineWinsAt} states the invariant that makes it so)
 * @returns true where a printed `'''` reads back as a break
 */
function replayedLineStandsAbove(above: SourceLine): boolean {
  return above.continuationTag === "erased" || isDelimiterLine(above.text);
}

/**
 * Whether a marker line keeps its marker reading at this block start
 * rather than being read as a layout break -
 * {@link ReaderContext.markerLineWins}, which states what that costs
 * and which of the two readings Asciidoctor gives.
 *
 * INSIDE AN ITEM, EXCEPT AT THE TWO POSITIONS A BREAK CAN BE SPELLED
 * AT. Asciidoctor reads the break at every in-item position past the
 * item's first `next_block` call; this reader takes only the ones
 * where the line the printer writes directly above the break is one
 * it replays byte for byte ({@link replayedLineStandsAbove}), because
 * everywhere else the canonical `'''` is absorbed by whatever text
 * stands above it, and which text that is the reader cannot know -
 * the printer both JOINS a description onto its term line and WRAPS
 * the result at a width that belongs to the printer.
 *
 * Read off the confinement and the line above rather than folded
 * forward, for {@link blockStartContextIn}'s reason: both are facts
 * about the POSITION, so they are the same at a block start the
 * reader walked to and at one it resumed to past a whole extent.
 *
 * THE LINE ABOVE ALWAYS EXISTS HERE, and that is a fact about how an
 * item-confined reader is BUILT, not a case this has to defend
 * against. `itemInterior` (reader.ts) is the one producer of an
 * `"item"` confinement, and it hands the reader
 * `[markerLine, ...buffer]` and then calls `readText` before `run()`.
 * The text read consumes the marker line at index 0 - a paragraph
 * extent always takes the line it opens on - so the block loop that
 * reaches this can only be standing at index 1 or later, and there is
 * no `at === 0` arm to write. Measured as well as argued: an instrumented
 * build that throws on an item-confined index 0 raises nothing over
 * the whole suite (202 files, 14,756 tests, the list-shape sweeps
 * among them) or over the five deep sweeps.
 * @param confinement - how the reader is confined, absent for the
 *   document reader
 * @param lines - the lines this reader walks
 * @param at - the index of the line being classified; inside an item
 *   it is never 0, per the invariant above
 * @returns true where a marker line is not offered to the break rows
 */
function markerLineWinsAt(
  confinement: Confinement | undefined,
  lines: readonly SourceLine[],
  at: number,
): boolean {
  if (confinement?.kind !== "item") {
    return false;
  }
  return !replayedLineStandsAbove(lines[at - 1]);
}

/**
 * The reader's state as `classifyLine` consumes it AT A BLOCK START -
 * read, never derived. The other two positions belong to the extent
 * scans, which build their own context from the same ancestry fact
 * ({@link openListIn}): nothing open, and no line is "first
 * after the block started" until a block has started.
 *
 * The line BELOW is offered to an UNCONFINED reader alone, which is
 * where Ruby asks its one two-line question: `is_next_line_section?`
 * belongs to `next_section`'s loop (parser.rb l.374), and an item's
 * buffer or a compound interior is parsed by `parse_blocks` ->
 * `next_block`, which never reaches it. Deciding that here, at the
 * one producer of a block-start context, keeps the setext arm out of
 * every confined reader without a second test anywhere.
 * `substitutedContentAbove` is a GETTER and the only field that is,
 * because it is the only one whose answer costs more than a lookup:
 * the walk it runs is as long as the run of deleted lines above. This
 * producer is called for EVERY line the reader classifies, and most
 * of them never ask - a `//` comment is answered by `classifyLine`'s
 * own raw test before the ladder is reached at all - so an eager walk
 * here makes a run of N comment lines cost N walks over itself.
 * Measured on a document of 8,000 `//` lines and one paragraph:
 * 555 ms with the walk eager, 15 ms with it asked for. The value is
 * the same either way; `substitutedContentStandsAbove` reads the
 * reader's lines and nothing else, and this view is handed on and
 * never stored.
 * @param confinement - how the reader is confined, absent for the
 *   document reader
 * @param lines - the lines this reader walks
 * @param at - the index of the line being classified; the line below
 *   it and the line above it are both read off this
 * @returns the read-only context view
 */
export function blockStartContextIn(
  confinement: Confinement | undefined,
  lines: readonly SourceLine[],
  at: number,
): ReaderContext {
  return {
    openParagraph: undefined,
    openList: openListIn(confinement),
    firstLineAfterStart: false,
    nextLine: confinement === undefined ? lines.at(at + 1)?.text : undefined,
    markerLineWins: markerLineWinsAt(confinement, lines, at),
    get substitutedContentAbove(): boolean {
      return substitutedContentStandsAbove(lines, at);
    },
  };
}

/**
 * The whitespace context of the prose block a reader is about to
 * build: the document's own attribute entries, plus every attribute
 * line of the metadata run standing over the block
 * ({@link contextAbove}, src/whitespace-fact.ts).
 *
 * Read at the BUILD, which is where the block's own annotation is
 * knowable: the held metadata run is flushed before the body is
 * read, so the run is already the tail of the block sequence.
 * @param scope - the document-wide facts, for its half of the answer
 * @param blocks - the block sequence so far; the run stands at its end
 * @returns the context the block's whole-block rows read
 */
export function blockWhitespaceContext(
  scope: ReaderScope,
  blocks: readonly BlockNode[],
): WhitespaceContext {
  return contextAbove(scope.whitespace, blocks);
}
