/**
 * WHAT OUR READER MAKES OF ONE LINE AT ONE POSITION IN A BLOCK, in
 * one function, so the reader's own scans and the printer's packer
 * cannot disagree about what a line means.
 *
 * The reader asks it of the lines the SOURCE holds: does this line
 * continue the block I have open, or end it. The printer asks it of a
 * line it is ABOUT TO WRITE: would the reader read that line back as
 * the block it came from. One question, one table, one
 * implementation.
 *
 * A SHARED HOME AT THE ROOT, beside src/block-metadata.ts and the
 * whitespace record, rather than a fifth address into src/parse. The
 * layer rule (scripts/metrics/graph.ts) counts the printer's reaches
 * INTO src/parse; a root module both halves import is not one of
 * them, which is why the pinned address count
 * (scripts/parse-print-addresses.ts) does not move for this.
 *
 * WHY A POSITION AND NOT A WORD. The printer's older questions were
 * all about a WORD at a line start, because a word is what a packer
 * has in hand ({@link isBlockSyntaxAtLineStart} and its kin,
 * src/print/reflow.ts). The reader's tables are whole-LINE patterns
 * keyed on the block's context and on the line's distance from the
 * block start, so a word probe can only ever approximate them: it
 * answers for a line one word longer than the caller would write
 * (PROBE_SUFFIX, src/parse/line-shapes.ts), it cannot see a shape
 * anchored at BOTH ends (`BLOCK_ATTRIBUTE_LINE` needs its `]`), and
 * it carries no context to key the tables on at all. A position
 * carries both facts the tables want.
 *
 * WHY THE ORDINAL SATURATES AT TWO. Only one thing in the per-line
 * reading counts lines: the interrupting sets distinguish the FIRST
 * line after the block start from every later one
 * (FIRST_LINE_INTERRUPTERS and LATER_LINE_INTERRUPTERS,
 * src/parse/line-shapes-interruption.ts), and the raw-line rules read
 * the same one boolean (`isRawParagraphLine`, src/parse/line-shapes.ts).
 * So three ordinals exhaust the question: the block's own opening
 * line, the line directly under it, and every line below that.
 *
 * WHY THE REST OF THE READER'S STATE IS THE BLOCK'S, ONCE. On a
 * layout every one of whose lines this function accepts, the three
 * variables the item scan carries (parser.rb l.1404-1415, mirrored in
 * `ExtentScan`, src/parse/lines/list-reader.ts) cannot move:
 *
 * - `within_nested_list` flips on a nested marker line, and a marker
 *   line is not accepted here - inside the block's own context it
 *   either interrupts (a sibling or nestable marker) or comes back as
 *   text the reader keeps on its own line ({@link isBlockText}
 *   refuses that too).
 * - `continuation` flips on a lone `+`, which `read_lines_until`
 *   breaks on as `LIST_CONTINUATION` (reader.rb l.413-427) and this
 *   function therefore refuses.
 * - `has_text` is fixed by the block's opening line, which is ordinal
 *   0 and is asked about against the reading the reader recorded for
 *   it.
 *
 * So the state after k accepted lines is the reader's state after k
 * continuation lines of the source block, which is a function of k
 * alone, and the ordinal above is the whole of it.
 */
import type { ReaderContext } from "./parse/line-shapes.js";
import { classifyLine, type LineKind } from "./parse/lines/classify.js";

/**
 * The block's own opening line.
 *
 * Exported for the verdict's unit rows
 * (tests/parser/line-verdict.test.ts), which are the only caller that
 * asks about an opening line so far; the reader's scans never do,
 * because their block's first line is consumed before the scan runs.
 * @internal
 */
export const OPENING_LINE = 0;

/** The line directly under the opening line. */
export const FIRST_CONTINUATION = 1;

/** Every line below that one. */
export const LATER_CONTINUATION = 2;

/**
 * What the block's opening line was read as, in the two parts a
 * re-read can be compared against: the verdict's own discriminant,
 * and - for the one reading with a parameter the printer can change -
 * the marker style `is_sibling_list_item?` compares (parser.rb
 * l.2280-2285).
 *
 * THE OTHER PARAMETERS OF THE VERDICT NEED NO ENTRY HERE, because the
 * printer writes them back verbatim rather than composing them: a
 * description item replays its whole term line
 * (`DescriptionTermNode.line`, src/ast.ts), an admonition its label,
 * an anchor its own bytes. Only the marker is assembled from a
 * recorded style and a recorded gap, so only the marker can come back
 * as a different one.
 *
 * Exported for the verdict's unit rows
 * (tests/parser/line-verdict.test.ts); no src consumer yet, because
 * only an asker about an opening line builds one.
 * @internal
 */
export type BlockOpening =
  | {
      /** The verdict's discriminant, for every reading but a marker. */
      readonly reading: Exclude<LineKind["kind"], "listMarker">;
    }
  | {
      /** A list item's marker line. */
      readonly reading: "listMarker";
      /** The style its marker resolves to. */
      readonly style: string;
    };

/**
 * Where a line stands: the ordinal, the block's recorded reader
 * context, and - at the opening line alone - what that line was read
 * as when the reader read it.
 *
 * TWO ARMS rather than one shape with an optional reading, because
 * the reading is meaningless at a continuation position: there the
 * question is whether the line is the block's own text, and no
 * recorded verdict enters it.
 *
 * Exported for the verdict's unit rows
 * (tests/parser/line-verdict.test.ts); the reader's scans build the
 * value as a literal at the call.
 * @internal
 */
export type BlockPosition =
  | {
      /** The block's opening line. */
      readonly ordinal: 0;
      /** The context the reader classified that line in. */
      readonly reader: ReaderContext;
      /** What it made of it. */
      readonly opens: BlockOpening;
    }
  | {
      /** A continuation line. */
      readonly ordinal: 1 | 2;
      /** The context the reader classifies the block's later lines in. */
      readonly reader: ReaderContext;
    };

/**
 * THE verdict: what our reader makes of `line` standing at
 * `position`, with `next` below it.
 *
 * `next` reaches the classifier at the opening line and nowhere else,
 * and that is the reader's own arrangement rather than a shortcut.
 * The one two-line construct Asciidoctor reads is the underlined
 * section title, whose test is a joint function of both lines'
 * lengths (`setext_section_title?`, parser.rb l.1722-1727), and it is
 * asked from `next_section`'s loop alone: a block that is already
 * open goes through `parse_blocks` and never asks
 * ({@link ReaderContext.nextLine} carries the citation). So a
 * continuation position reads no neighbour, and the opening line
 * reads the one the caller supplies.
 *
 * AT AN OPENING LINE THE NEIGHBOUR IS ALWAYS SUPPLIED, which is the
 * DOCUMENT reader's position and one wider than a confined reader's
 * (a list item's own `next_block` passes undefined). The difference
 * can only turn an accepted line into a refused one, so it costs a
 * block replayed rather than a heading nobody wrote.
 * @param line - the candidate line, without its newline
 * @param next - the line that will stand directly below it, or
 *   undefined at the end of the input
 * @param position - where the line stands; see {@link BlockPosition}
 * @returns what the reader makes of it
 */
export function lineVerdict(
  line: string,
  next: string | undefined,
  position: BlockPosition,
): LineKind {
  return classifyLine(line, {
    ...position.reader,
    firstLineAfterStart: position.ordinal === FIRST_CONTINUATION,
    nextLine: position.ordinal === OPENING_LINE ? next : undefined,
  });
}

/**
 * Whether the reader's scan KEEPS the line in the block it has open -
 * the reader's own use of the verdict, which is what
 * `read_paragraph_lines` and `read_lines_until` decide per line
 * (parser.rb l.962-970, reader.rb l.413-427).
 *
 * A `raw` line counts: the reader keeps it, on its own output line,
 * because the preprocessor consumes it before block structure exists.
 * That is the one place this predicate and the printer's
 * ({@link accepts}) part, and the reason is stated at
 * {@link isBlockText}.
 * @param verdict - what {@link lineVerdict} answered
 * @returns true when the line does not end the block
 */
export function keepsTheLine(verdict: LineKind): boolean {
  return verdict.kind === "text" || verdict.kind === "raw";
}

/**
 * Whether a verdict says the line is the block's OWN REFLOWABLE TEXT,
 * which is what a line the printer composes has to be.
 *
 * NARROWER THAN {@link keepsTheLine} at two readings, and both are
 * lines the reader keeps and the printer may not invent:
 *
 * - `raw`: a comment, a preprocessor directive or a block anchor. The
 *   reader replays such a line where it stands; a line the packer
 *   ASSEMBLED into one of those shapes destroys everything written
 *   after the `//` or hands the text to a directive.
 * - `text` carrying `verbatim`: a marker line of a list that is not
 *   open around the block. The reader keeps it at its own column
 *   because `read_lines_for_list_item` flips `within_nested_list` on
 *   it (parser.rb l.1404-1415) and that flag decides what a later `+`
 *   means. A line the packer moved a marker onto is the same flip at
 *   a place the author did not write it.
 * @param verdict - what {@link lineVerdict} answered
 * @returns true when the line is ordinary, reflowable block text
 */
function isBlockText(verdict: LineKind): boolean {
  return verdict.kind === "text" && verdict.verbatim !== true;
}

/**
 * Whether a re-read verdict opens the SAME block the reader opened.
 * @param verdict - what the candidate opening line was read as
 * @param opening - what the reader read the block's opening line as
 * @returns true when the two are the same reading
 */
function opensTheSameBlock(verdict: LineKind, opening: BlockOpening): boolean {
  if (opening.reading === "listMarker") {
    return verdict.kind === "listMarker" && verdict.style === opening.style;
  }
  return verdict.kind === opening.reading;
}

/**
 * WOULD OUR READER READ `line`, with `next` below it, as the block at
 * `position` - opening it with the recorded reading at ordinal 0, or
 * continuing it as its own text below that.
 *
 * The printer's question, and the whole of what a packer has to ask
 * before it commits an output line: every shape that would make the
 * line something else is one of the reader's own table entries, so
 * there is nothing left for a print-side predicate to know.
 * @param line - the candidate output line, indentation included and
 *   without its newline
 * @param next - the line the printer will write directly below it
 *   (the block's next output line, the blank or delimiter that closes
 *   the block, or undefined at the end of the document)
 * @param position - where the line stands; see {@link BlockPosition}
 * @returns true when the reader reads the line as this block
 *
 * Exported for the verdict's unit rows
 * (tests/parser/line-verdict.test.ts). The reader's own scans read
 * {@link keepsTheLine} instead, which is the one reading that differs
 * between the two askers.
 * @internal
 */
export function accepts(
  line: string,
  next: string | undefined,
  position: BlockPosition,
): boolean {
  const verdict = lineVerdict(line, next, position);
  return position.ordinal === OPENING_LINE
    ? opensTheSameBlock(verdict, position.opens)
    : isBlockText(verdict);
}
