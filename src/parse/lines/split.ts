/**
 * Source → lines, the way Asciidoctor's reader sees them.
 *
 * `Helpers.prepare_source_string` names two different behaviors, and
 * the two Asciidoctors diverge on it. MRI Ruby's own (helpers.rb:
 * 116-133, not vendored, see docs/coding-standards.md's authority
 * list) does no line-ending normalization at all: BOM strip, split on
 * `\n` alone, per-line rstrip, nothing else. `@asciidoctor/core`
 * 4.0.11's `prepareSourceString` (helpers.js l.80-82) adds a third
 * normalization MRI does not have: it rewrites `\r\n` and then a bare
 * `\r` to `\n` before ever splitting. This codebase's tests run
 * against the JS oracle, and it wins, so all three of ITS
 * normalizations happen here: the byte-order-mark strip, line-ending
 * normalization (`nextLineBreak`, src/parse/positions.ts), and the
 * per-line rstrip. A bare CR is a LINE BREAK under the JS oracle, and
 * an old-Mac document that is several lines to it is several lines
 * here too (issue #68). CRLF is unaffected by the bare-CR rule,
 * because its `\r` is not lone; it still lands at a line end where
 * the rstrip set covers it.
 *
 * A leading BYTE-ORDER MARK is not part of the first line. The oracle
 * drops one U+FEFF from the head of the whole document, and failing
 * that a UTF-8 BOM that arrived as its three raw characters
 * (U+00EF U+00BB U+00BF, what `ï»¿` decodes to when the bytes were
 * read as Latin-1); either way it is one prefix off the document, not
 * a rule any later line gets. So `<BOM>= Title` is a document title,
 * `<BOM>␠= Title` is an indented literal (the BOM goes, the space
 * stays), a SECOND BOM is ordinary text, and a BOM anywhere but
 * offset 0 is ordinary text too.
 *
 * Every line is then RSTRIPPED before any rule runs
 * (`data.each_line {|line| lines << line.rstrip }`), so a delimiter
 * with trailing spaces is still a delimiter and `+␠` is still a list
 * continuation. The raw line is kept alongside because token images
 * and verbatim content must reproduce the author's bytes: the reader
 * classifies on `text` and emits `raw`. A CRLF document therefore
 * keeps its `\r` in `raw` and loses it from `text`.
 *
 * The strip itself is the registry's {@link rstrip}, not `trimEnd()`:
 * the two differ on a trailing NUL and on every non-ASCII space, and
 * every `$`-anchored rule in src/parse/line-shapes.ts is written
 * against the registry's set. One spelling, one dialect.
 */
import { FIRST_LINE } from "../../constants.js";
import { rstrip } from "../line-shapes.js";
import { nextLineBreak } from "../positions.js";
import type { Fragment } from "../positions.js";

/** One source line with both spellings and its position. */
export interface SourceLine {
  /** The line without trailing whitespace — what every rule matches. */
  readonly text: string;
  /** The line as written, without its newline — what tokens carry. */
  readonly raw: string;
  /** Zero-based offset of the line's first character. */
  readonly offset: number;
  /** One-based line number. */
  readonly line: number;
  /**
   * Parse-internal: the extent scan's port of Asciidoctor's tagged
   * Strings. `read_lines_for_list_item` swaps every `+` it reads for
   * `ListContinuationString` (parser.rb l.1432) and erases into
   * `ListContinuationPlaceholder` (parser.rb l.1439/1576) - String
   * instances extended with the `ListContinuationMarker` module - and
   * two later readers key on the tag rather than the text: an inner
   * item scan hard-stops on an erased line after a blank (the JS
   * oracle's strict `thisLine === ''` at parser.js l.2168), and the
   * confined paragraph read folds marker lines only under a tagged `+`
   * head (`readParagraphLines`, parser.js l.1065 and l.3018-47). The
   * tag exists only on COPIES inside item buffers - `splitLines` never
   * writes it, so a document line carries none - which is exactly
   * where the oracle's tagged Strings live.
   *
   * One arm deliberately does NOT read the tag: an erased line
   * reaching the scan's final else is buffered as the blank it
   * spells, where the JS oracle pushes the boxed object with
   * `hasText` true (parser.js l.2225-41). Reachable, if at all, only
   * with an erased cell directly under non-blank content inside a
   * nested extent — no sweep document constructs one; the deep sweep
   * arbitrates.
   */
  readonly continuationTag?: "marker" | "erased";
}

/**
 * One line's span, for the builders. The default span is the RAW
 * spelling of the line, trailing whitespace and all, and that is what
 * its position measures; classification used the rstripped `text`, so
 * a builder that has to take the line apart the way the classifier
 * read it asks for `line.text.length` as `to` (held-metadata.ts).
 * @param line - the source line
 * @param from - raw start column index, 0-based
 * @param to - raw end column index, exclusive
 * @returns the span
 */
export function fragmentOfLine(
  line: SourceLine,
  from = 0,
  to = line.raw.length,
): Fragment {
  return { image: line.raw.slice(from, to), offset: line.offset + from };
}

/** The byte-order mark as one decoded character. */
const BOM = "\u{FEFF}";

/**
 * The UTF-8 BOM's three bytes, each decoded as its own Latin-1
 * character — the spelling a UTF-8 document gets when something read
 * it with the wrong encoding, and the second prefix the oracle
 * recognizes.
 */
const MISDECODED_BOM = "\u{EF}\u{BB}\u{BF}";

/**
 * How many characters of byte-order mark the document opens with.
 * ONE prefix at a time, the oracle's own order: a decoded BOM first,
 * the misdecoded spelling only when there is no decoded one.
 * @param source - the whole document
 * @returns 1, 3, or 0 when the document opens with neither spelling
 */
function bomWidth(source: string): number {
  if (source.startsWith(BOM)) {
    return BOM.length;
  }
  if (source.startsWith(MISDECODED_BOM)) {
    return MISDECODED_BOM.length;
  }
  return 0;
}

/**
 * The byte-order mark this document opens with, as the characters
 * themselves.
 *
 * Reading a mark off the head is how the document is UNDERSTOOD, not
 * an edit to it, so the prefix is carried on the document node and put
 * back by the printer: a formatter that swallowed it would shorten
 * every marked file by one mark, and a second mark hiding behind the
 * first would then be stripped by the next read, turning a paragraph
 * into a title one format at a time.
 * @param source - the whole document
 * @returns the mark as written, or the empty string when the document
 *   opens with neither spelling
 */
export function documentBom(source: string): string {
  return source.slice(0, bomWidth(source));
}

/**
 * Split a document into rstripped lines with offsets.
 *
 * Offsets stay ORIGINAL-relative: a stripped byte-order mark is not
 * cut out of the source, it is skipped, so the first line of
 * `<BOM>= Title` starts at offset 1 and `source.slice(offset)` still
 * begins with that line's raw text. This is the invariant every
 * position in the tree is built on (src/parse/positions.ts: an offset
 * counts from the very start of the document source, never from a
 * substring), so the mark costs the first line one column and costs
 * the rest of the document nothing.
 *
 * A document of nothing but a mark yields NO lines here, where the
 * oracle yields one blank one: its empty-data check runs before the
 * strip, so it reaches `"".split("\n")` and gets one empty string.
 * Unobservable either way (both spell a document with no blocks and
 * an empty render), recorded so the next reader diffing against
 * helpers.js does not take it for a bug.
 * @param source - the whole document
 * @returns one entry per line; a trailing newline ends the last line
 *   rather than opening an empty one (Ruby's `each_line` semantics, and
 *   the reason an empty document has no lines at all)
 */
export function splitLines(source: string): SourceLine[] {
  // Line numbers here count the SAME breaks makeLocationIndex counts
  // (src/parse/positions.ts): both call the shared nextLineBreak, so
  // the two authorities cannot disagree; the agreement is pinned by
  // tests/parser/positions.test.ts. A byte-order mark carries no
  // line break, so skipping it moves no line number.
  const lines: SourceLine[] = [];
  let offset = bomWidth(source);
  let line = FIRST_LINE;
  while (offset < source.length) {
    const stop = nextLineBreak(source, offset);
    const raw = source.slice(offset, stop);
    lines.push({ text: rstrip(raw), raw, offset, line });
    offset = stop + 1;
    line += 1;
  }
  return lines;
}
