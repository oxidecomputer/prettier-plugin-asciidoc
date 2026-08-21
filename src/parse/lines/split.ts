/**
 * Source → lines, the way Asciidoctor's reader sees them.
 *
 * Every line is RSTRIPPED before any rule runs
 * (`Helpers.prepare_source_string` with `trim_end`:
 * `data.each_line {|line| lines << line.rstrip }`), so a delimiter with
 * trailing spaces is still a delimiter and `+␠` is still a list
 * continuation. The raw line is kept alongside because token images and
 * verbatim content must reproduce the author's bytes: the reader
 * classifies on `text` and emits `raw`. A CRLF document therefore keeps
 * its `\r` in `raw` and loses it from `text`.
 *
 * The strip itself is the registry's {@link rstrip}, not `trimEnd()`:
 * the two differ on a trailing NUL, and every `$`-anchored rule in
 * src/parse/line-shapes.ts is written against the registry's set. One
 * spelling, one dialect.
 */
import { FIRST, FIRST_LINE, NEXT, NOT_FOUND } from "../../constants.js";
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
}

/**
 * Split a document into rstripped lines with offsets.
 * @param source - the whole document
 * @returns one entry per line; a trailing newline ends the last line
 *   rather than opening an empty one (Ruby's `each_line` semantics, and
 *   the reason an empty document has no lines at all)
 */
export function splitLines(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let offset = FIRST;
  let line = FIRST_LINE;
  while (offset < source.length) {
    const end = source.indexOf("\n", offset);
    const stop = end === NOT_FOUND ? source.length : end;
    const raw = source.slice(offset, stop);
    lines.push({ text: rstrip(raw), raw, offset, line });
    offset = stop + NEXT;
    line += NEXT;
  }
  return lines;
}
