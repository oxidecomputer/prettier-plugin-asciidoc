/**
 * Source → lines, the way Asciidoctor's reader sees them.
 *
 * `Helpers.prepare_source_string` does THREE normalizations before
 * the parser sees a single line, and two of them happen here and
 * nowhere else: the byte-order-mark strip and the per-line rstrip.
 * The third is line-ending normalization: the oracle rewrites `\r\n`
 * and then a bare `\r` to `\n` before splitting, so a bare CR is a
 * LINE BREAK to it and merely trailing whitespace to us, and an
 * old-Mac document that is several lines to the oracle is one line
 * here. That is a recorded gap, tracked by issue #68. CRLF is
 * unaffected, because its `\r` lands at a line end where the rstrip
 * set covers it.
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
   * `ListContinuationPlaceholder` (l.1439/1576) — String instances
   * extended with the `ListContinuationMarker` module — and two later
   * readers key on the tag rather than the text: an inner item scan
   * hard-stops on an erased line after a blank (the JS oracle's strict
   * `===` at parser.js l.2168), and the confined paragraph read folds
   * marker lines only under a tagged `+` head (parser.js l.1065,
   * l.3018-47). The tag exists only on COPIES inside item buffers —
   * `splitLines` never writes it, so a document line carries none —
   * which is exactly where the oracle's tagged Strings live.
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
  if (source.startsWith(BOM)) return BOM.length;
  if (source.startsWith(MISDECODED_BOM)) return MISDECODED_BOM.length;
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
  // Line numbers here count the SAME \n scan makeLocationIndex counts
  // (src/parse/positions.ts) — the two authorities cannot disagree
  // while both split on every newline; the agreement is pinned by
  // tests/parser/positions.test.ts. A byte-order mark carries no
  // newline, so skipping it moves no line number.
  const lines: SourceLine[] = [];
  let offset = bomWidth(source);
  let line = FIRST_LINE;
  while (offset < source.length) {
    const end = source.indexOf("\n", offset);
    const stop = end === -1 ? source.length : end;
    const raw = source.slice(offset, stop);
    lines.push({ text: rstrip(raw), raw, offset, line });
    offset = stop + 1;
    line += 1;
  }
  return lines;
}
