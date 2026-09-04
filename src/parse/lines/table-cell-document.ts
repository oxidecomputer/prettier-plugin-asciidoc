/**
 * An `a|` cell's own document (issue #130): the LINES Asciidoctor
 * reads a cell's nested `Document` from
 * (`@inner_document = Document.new inner_document_lines`,
 * table.rb:309), recovered from the cell's recorded runs.
 *
 * A cell's `content` runs are already the buffer Asciidoctor's table
 * loop accumulates (`parser_ctx.buffer`, parser.rb:2389-2397, and
 * src/ast.ts's own statement of the same fact); what this module adds
 * is the two transforms that stand between that buffer and the nested
 * document's source, and it applies them WITHOUT losing where each
 * surviving line sits in the whole document:
 *
 *   1. `close_cell` (table.rb:617-649) hands psv the buffer as
 *      written and hands csv and dsv `@buffer.strip`.
 *   2. `Table::Cell#initialize`'s asciidoc arm (table.rb:263-273)
 *      rstrips what it got, and then either drops the leading
 *      newlines - keeping the first content line's own indentation,
 *      which is what `advance` compensates the cursor for - or, when
 *      the text does not begin with a newline, lstrips it.
 *
 * Both transforms only TRIM: at the ends of the buffer, and at the
 * ends of its first and last lines. So every line that survives is
 * still a span of the document's own source, and the offsets here are
 * absolute, exactly as `splitLines`'s are. That is what lets a
 * confined reader over these lines stamp document positions rather
 * than cell-relative ones.
 *
 * ONE shape breaks that: csv's unquote and quote-squeeze
 * (table.rb:633-648) delete quote characters from inside the value,
 * so such a cell's document text is spelled by no span of the source
 * at all. That is a state of its own here
 * ({@link TableCellDocument}), not a silently wrong line list.
 *
 * The trims take the buffer's two ENDS in a different whitespace
 * dialect from the one the reader gave every line
 * ({@link isCellWhitespace} states it, and says which authority
 * settled it).
 *
 * A cell that trims away to nothing yields NO lines, where
 * `cell_text.split LF, -1` (table.rb:301) hands the nested document
 * one empty line. Unobservable - both spell a document with no blocks
 * - and it is the same divergence, for the same reason, that
 * `splitLines` already records for a document of nothing but a
 * byte-order mark.
 */
import type { TableCutting, TableTextRun } from "../../ast.js";
import { rstrip } from "../line-shapes.js";
import type { LocationIndex } from "../positions.js";
import type { SourceLine } from "./split.js";

/** The run kind that is a cell's own text (src/ast.ts's TableRunKind). */
const CONTENT_RUN = "content";

/** The double quote csv quotes a value with (`q = '"'`, table.rb:633). */
const CSV_QUOTE = '"';

/**
 * Whether `text` is nothing but whitespace to the trims below, and
 * the one place this module says which whitespace that is.
 *
 * ONE dialect statement for BOTH ends of a cell's buffer, because
 * both ends are trimmed by the same set and neither is the set the
 * READER used. Every line reaching this module was already rstripped
 * by the registry's {@link rstrip}, which is the six ASCII whitespace
 * characters; what `close_cell`'s `@buffer.strip` (table.rb:629) and
 * the asciidoc arm's `cell_text.rstrip`/`cell_text.lstrip`
 * (table.rb:266, table.rb:272) then take off the buffer's two ends is
 * JavaScript's `\s`.
 *
 * Ruby and the pinned oracle DISAGREE about that set, and the oracle
 * wins: Ruby's `String#strip` takes a NUL and leaves U+00A0, and the
 * oracle does the reverse. Probed at both ends, two copies of each
 * character per cell: a NUL, U+200B or U+0085 survives into the
 * nested document, while a space, tab, vertical tab, form feed,
 * U+00A0, U+2000, U+3000, U+2028 or U+FEFF is gone. The rows that
 * hold this against the oracle live in
 * tests/parser/table-cell-document.test.ts.
 *
 * The MIDDLE of the buffer keeps the reader's ASCII dialect, and that
 * is not an oversight: probed, a line of nothing but U+00A0 between
 * two content lines survives on both sides, because no trim reaches
 * it. Two dialects, because two different pieces of Asciidoctor do
 * the two jobs.
 * @param text - one line's text, already registry-rstripped
 * @returns whether a buffer-end trim would consume the whole line
 */
function isCellWhitespace(text: string): boolean {
  return text.trim() === "";
}

/**
 * What an `a|` cell's nested document is read from.
 *
 * A union rather than a possibly-empty line list, because "this cell
 * holds a document of no lines" (an empty cell) and "this cell's
 * document is not spelled by the cell's bytes" (csv's unquote) are
 * different answers, and only the first one a reader may act on.
 *
 * Named outside this file only by
 * tests/parser/table-cell-document.test.ts, which classifies each
 * cell by its arm; the `src` consumer arrives with the confined
 * reader {@link tableCellDocument} feeds (issue #130).
 * @internal
 */
export type TableCellDocument =
  | {
      /**
       * The cell's document is these lines of the document's own
       * source, in order, with absolute offsets.
       */
      readonly kind: "lines";
      /** The lines, empty for a cell whose buffer trims away to nothing. */
      readonly lines: readonly SourceLine[];
    }
  | {
      /**
       * csv's unquote rewrote the cell's text (table.rb:633-648), so
       * no span of the source spells the document this cell holds and
       * the cell's bytes are all a formatter may work from.
       */
      readonly kind: "rewritten";
    };

/** One line of a cell's buffer, before either trim has run. */
interface BufferLine {
  /** The line as written, newline excluded. */
  readonly raw: string;
  /** Zero-based offset of the line's first character. */
  readonly offset: number;
}

/**
 * Extend the line a run boundary left open, or start one at `offset`.
 * One line of a cell can be spelled by two runs or more, and only the
 * FIRST of them names where the line begins. An ESCAPED separator is
 * what splits one: the scan cuts a run at the escape and opens the
 * next past it (`skip_past_escaped_delimiter`, table.rb:525-528), so
 * `A \| here` is two runs of one line. A dropped `//` line or a
 * skipped blank splits a cell's runs too, but only ever at a line
 * boundary.
 * @param open - the line left open by an earlier run, if any
 * @param segment - the bytes to append
 * @param offset - where `segment` begins, used only to open a line
 * @returns the line, open still
 */
function extend(
  open: BufferLine | undefined,
  segment: string,
  offset: number,
): BufferLine {
  return open === undefined
    ? { raw: segment, offset }
    : { raw: open.raw + segment, offset: open.offset };
}

/**
 * The cell's buffer as lines. Only `content` runs: the `//` lines and
 * the blank lines a reader consumed never reached the table, so they
 * are not in Asciidoctor's buffer either.
 *
 * A trailing newline ENDS the last line rather than opening an empty
 * one, `splitLines`'s own convention and the reason a buffer of
 * `"one\n"` is one line here and rstrips to one line there.
 * @param runs - the cell's recorded runs, in document order
 * @returns the buffer's lines, in order
 */
function bufferLines(runs: readonly TableTextRun[]): BufferLine[] {
  const lines: BufferLine[] = [];
  let open: BufferLine | undefined = undefined;
  for (const run of runs) {
    if (run.kind !== CONTENT_RUN) {
      continue;
    }
    let from = 0;
    for (
      let breakAt = run.image.indexOf("\n");
      breakAt !== -1;
      breakAt = run.image.indexOf("\n", from)
    ) {
      lines.push(
        extend(open, run.image.slice(from, breakAt), run.offset + from),
      );
      open = undefined;
      from = breakAt + 1;
    }
    const tail = run.image.slice(from);
    if (tail !== "") {
      open = extend(open, tail, run.offset + from);
    }
  }
  if (open !== undefined) {
    lines.push(open);
  }
  return lines;
}

/**
 * One buffer line as a source line: rstripped the way the reader
 * rstripped it before the table ever saw it, with each escaped
 * separator's backslash chopped (`skip_past_escaped_delimiter`,
 * table.rb:525-528).
 *
 * The chop is why `text` here is not always `rstrip(raw)`, which is
 * the one place this departs from `splitLines`'s pairing: the
 * backslash is a byte of the source a printer must replay, and it is
 * NOT a byte of the text Asciidoctor matches its rules against. Each
 * spelling answers the question it is asked. csv escapes nothing -
 * its separator sits inside quotes instead - so no chop applies
 * there.
 * @param line - the buffer line
 * @param cutting - the table's resolved cutting
 * @param at - the document's offset to Location index
 * @returns the source line, with an absolute offset and line number
 */
function sourceLineOf(
  line: BufferLine,
  cutting: TableCutting,
  at: LocationIndex,
): SourceLine {
  const stripped = rstrip(line.raw);
  const text =
    cutting.format === "csv"
      ? stripped
      : stripped.split(`\\${cutting.separator}`).join(cutting.separator);
  return {
    text,
    raw: line.raw,
    offset: line.offset,
    line: at.at(line.offset).line,
  };
}

/**
 * `lines` without the whitespace-only ones at its end - the trailing
 * half of the buffer trim, which is `cell_text.rstrip` for psv
 * (table.rb:266) and the tail of `@buffer.strip` for csv and dsv
 * (table.rb:629).
 *
 * Line-granular, which the trim is not, so the test is
 * {@link isCellWhitespace} and NOT `text === ""`: a line the reader
 * left holding a U+00A0 is not blank to the registry rstrip and is
 * whitespace to the buffer trim, so the buffer trim eats the whole
 * line and this must drop it.
 * @param lines - the buffer's lines
 * @returns the lines up to the last one holding a non-whitespace
 *   character
 */
function withoutTrailingBlanks(lines: readonly SourceLine[]): SourceLine[] {
  let end = lines.length;
  while (end > 0 && isCellWhitespace(lines[end - 1].text)) {
    end -= 1;
  }
  return lines.slice(0, end);
}

/**
 * `lines` with the LAST one's own tail trimmed - the rest of the same
 * buffer trim, which stops inside the last surviving line rather than
 * at a line boundary.
 *
 * `text` alone moves. `raw` is the source line as written and stays
 * whole, exactly as it already does for the trailing ASCII whitespace
 * the reader's own rstrip took off `text`: the line's offset does not
 * move, so `raw` is still the span of the source that offset names.
 * @param lines - the buffer's lines, none of them whitespace-only at
 *   the end
 * @returns the lines, the last one's text trimmed
 */
function withLastRstripped(lines: readonly SourceLine[]): SourceLine[] {
  const last = lines.at(-1);
  if (last === undefined) {
    return [];
  }
  return [...lines.slice(0, -1), { ...last, text: last.text.trimEnd() }];
}

/**
 * `lines` without the ones at its front that hold only the newline
 * they end with - the leading-newline arm (table.rb:266-270), which
 * drops those newlines and keeps the first content line's
 * INDENTATION.
 *
 * `text === ""` and not {@link isCellWhitespace} here, and that is the
 * arm's own rule rather than an inconsistency: Ruby drops LINE FEEDS
 * (`while ... start_with? LF`), so a line the reader left holding a
 * U+00A0 stops the loop and keeps its own bytes. Probed, and pinned as
 * a row in tests/parser/table-cell-document.test.ts: an `a|` cell
 * whose lines are one U+00A0 and then `x` reads both of them, where
 * the lstrip arm below would have read only `x`.
 * @param lines - the buffer's lines
 * @returns the lines from the first one with any bytes of its own
 */
function withoutLeadingNewlines(lines: readonly SourceLine[]): SourceLine[] {
  let start = 0;
  while (start < lines.length && lines[start].text === "") {
    start += 1;
  }
  return lines.slice(start);
}

/**
 * `lines` without the whitespace-only ones at its front - the part of
 * an `lstrip` that CROSSES line boundaries. Ruby's lstrip runs over
 * the whole buffer, so it eats a whitespace-only line, the newline
 * behind it and the next line's indentation alike; this drops the
 * whole lines and {@link withFirstLstripped} finishes the job inside
 * the line that survives.
 * @param lines - the buffer's lines
 * @returns the lines from the first one holding a non-whitespace
 *   character
 */
function withoutLeadingWhitespaceLines(
  lines: readonly SourceLine[],
): SourceLine[] {
  let start = 0;
  while (start < lines.length && isCellWhitespace(lines[start].text)) {
    start += 1;
  }
  return lines.slice(start);
}

/**
 * `lines` with its first line lstripped (table.rb:272). Its caller
 * has dropped the whitespace-only lines first, so the first line is
 * either absent or holds a non-whitespace character: the run this
 * removes ends inside that line, and no later line moves.
 *
 * `raw` and `offset` move with `text` here, where
 * {@link withLastRstripped} moves neither: the document's first line
 * genuinely BEGINS later in the source, so the offset has to say so
 * and `raw` has to stay the span that offset names. The two widths
 * agree because the escape chop only ever removes a backslash before
 * a separator, and neither is whitespace, so it can never fall inside
 * a leading whitespace run.
 * @param lines - the buffer's lines, the first one not whitespace-only
 *   if there is one at all
 * @returns the lines, the first one advanced past its own indentation
 */
function withFirstLstripped(lines: readonly SourceLine[]): SourceLine[] {
  const first = lines.at(0);
  if (first === undefined) {
    return [];
  }
  const width = first.text.length - first.text.trimStart().length;
  return [
    {
      text: first.text.slice(width),
      raw: first.raw.slice(width),
      offset: first.offset + width,
      line: first.line,
    },
    ...lines.slice(1),
  ];
}

/**
 * The buffer trim, in the two shapes the three formats take.
 *
 * psv is handed the buffer as written (table.rb:618-619) and its
 * asciidoc arm does the whole trim: an rstrip, then either the
 * leading-newline drop or an lstrip, chosen on whether what is left
 * begins with a newline (table.rb:266-273).
 *
 * csv and dsv never reach that arm at all. `Table::Cell#initialize`
 * guards the whole `case cell_style` on `if attributes`
 * (table.rb:252-253), which is Ruby's own note that only a psv cell
 * carries a cellspec, and `close_cell` sets `cellspec = nil` for the
 * other two (table.rb:628-632); their cells take the arm below it
 * (table.rb:284-290), which records that the cell is asciidoc and
 * trims nothing. Their ONLY trim is `@buffer.strip` (table.rb:629),
 * which is an lstrip and an rstrip over the whole buffer - so the
 * leading-newline branch is not theirs to take, and it is unreachable
 * for them because the strip has already eaten every leading
 * newline, not because a second trim found nothing to do.
 * @param lines - the buffer's lines
 * @param format - the table's cutting format
 * @returns the nested document's lines
 */
function trimmed(
  lines: readonly SourceLine[],
  format: TableCutting["format"],
): SourceLine[] {
  const body = withLastRstripped(withoutTrailingBlanks(lines));
  if (format === "psv" && body.at(0)?.text === "") {
    return withoutLeadingNewlines(body);
  }
  return withFirstLstripped(withoutLeadingWhitespaceLines(body));
}

/**
 * Whether csv's quote handling MOVES this cell's bytes.
 *
 * Ruby enters the quote branch on any quote at all
 * (`@format == 'csv' && !cell_text.empty? && (cell_text.include? q)`,
 * table.rb:633), but entering it is not the same as changing
 * anything: the unquoted path is `cell_text.squeeze q`
 * (table.rb:646), and squeezing a lone quote returns the same string.
 * So the two shapes that really rewrite are the ones tested here, and
 * `ab"cd` is not one of them (probed: the oracle answers it
 * unchanged).
 *
 * The whole-value quoted test carries no length guard, because Ruby's
 * does not: a cell of one `"` starts and ends with a quote, takes the
 * unquote path, and comes back empty through its own error branch
 * (`cell_text = ''`, table.rb:641-642). Probed, and it is a rewrite.
 * @param lines - the cell's already-trimmed lines
 * @param format - the table's cutting format
 * @returns whether the document's text differs from the cell's bytes
 */
function csvRewrites(
  lines: readonly SourceLine[],
  format: TableCutting["format"],
): boolean {
  if (format !== "csv") {
    return false;
  }
  const value = lines.map((line) => line.text).join("\n");
  return (
    (value.startsWith(CSV_QUOTE) && value.endsWith(CSV_QUOTE)) ||
    value.includes(`${CSV_QUOTE}${CSV_QUOTE}`)
  );
}

/**
 * The lines an `a|` cell's nested document is read from.
 *
 * Takes the RUNS rather than a built cell, so the table scan's own
 * cut cells and src/ast.ts's `TableCellNode` both satisfy it with no
 * conversion; the caller has already decided that this cell's
 * resolved style is `asciidoc`, and nothing here re-derives that.
 *
 * No `src` consumer yet: reading these lines into blocks needs a
 * confined BlockReader constructed over them, which is the remaining
 * half of issue #130 - the four changes that needs are measured and
 * written out in a comment on that issue. Consumed by
 * tests/parser/table-cell-document.test.ts, which holds every line
 * this returns against the oracle's own inner document, corpus-wide.
 * @param runs - the cell's recorded runs, in document order
 * @param cutting - the table's resolved cutting
 * @param at - the document's offset to Location index
 * @returns the document's lines, or the rewritten verdict
 * @internal
 */
export function tableCellDocument(
  runs: readonly TableTextRun[],
  cutting: TableCutting,
  at: LocationIndex,
): TableCellDocument {
  const lines = trimmed(
    bufferLines(runs).map((line) => sourceLineOf(line, cutting, at)),
    cutting.format,
  );
  return csvRewrites(lines, cutting.format)
    ? { kind: "rewritten" }
    : { kind: "lines", lines };
}
