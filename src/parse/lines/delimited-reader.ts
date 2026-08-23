/**
 * Delimited blocks, read extent-first — `build_block`'s shape
 * (parser.rb:1007-1077): a block's whole extent is collected BEFORE
 * anything inside it is parsed, by exact-terminator line match
 * (`read_lines_until terminator:` → reader.rb:414, `line ==
 * terminator` on rstripped lines), the bare tip for a fence, the
 * lines' end when it never closes (reader.rb:433-435 warns and keeps
 * the lines). ONE extent scan for both consumers — the reader's open
 * and the item scan's slurp — beside list-reader.ts because the two
 * recursive constructs each own a module (spec D1a). Pinned by the delimitedExtent table in
 * tests/parser/delimited-reader.test.ts and the exact-terminator
 * oracle rows (P6; α-D1's `|===`-vs-`|====` pair).
 */
import type { DelimiterKind } from "./classify.js";
import type { SourceLine } from "./split.js";

/**
 * A fenced code block's terminator is the bare tip, never the opening
 * line: `is_delimited_block?` rewrites the line to its tip for the
 * fence case (parser.rb:967-1001), so ```` ```ruby ```` closes on
 * ```` ``` ````. Exported — the one spelling (N1 final): the scan
 * below is its only src consumer, and the delimitedExtent table test
 * builds fixture sources from it permanently.
 */
export const FENCE_TIP = "```";

/**
 * One delimited block's extent, collected before anything inside it
 * is parsed. NOT exported (knip's types bucket gates dead exported
 * types at 0): consumers destructure the function's result; the name
 * goes public only if a module other than this one comes to spell it.
 */
interface DelimitedExtent {
  /** The opening delimiter line. */
  readonly open: SourceLine;
  /** The terminator line, when the block met one. */
  readonly close: SourceLine | undefined;
  /**
   * The interior lines, exclusive of both delimiters — a subarray
   * view of the caller's lines, absolute offsets intact (declared
   * structural departure, spec D8: Ruby copies into a new Reader).
   */
  readonly interior: readonly SourceLine[];
  /** Index (into the caller's lines) after the whole extent. */
  readonly resume: number;
}

/**
 * Where the block opened at `openIndex` closes and resumes. The
 * `close`/`resume` split removes an ambiguity an integer return had
 * (a terminator on the last line and an unterminated run both end at
 * `lines.length`): the caller no longer re-tests the last line to
 * learn whether the block closed — one derivation, in the scan.
 *
 * No stop-line parameter: the lines the scan is given already end at
 * every enclosing boundary (the reader hands a compound child its
 * interior subarray; the item scan runs over the item's buffer). The
 * old collision rule ("the enclosing terminator is tested FIRST … the
 * outer one wins") is not reordered — it is unrepresentable: the
 * outer terminator is not in the lines.
 * @param lines - the lines the scan runs over
 * @param openIndex - index of the opening delimiter line
 * @param kind - which delimited block it opens
 * @returns the extent: open line, close line (when met), interior
 *   view, and the index the caller resumes at
 */
export function delimitedExtent(
  lines: readonly SourceLine[],
  openIndex: number,
  kind: DelimiterKind,
): DelimitedExtent {
  const open = lines[openIndex];
  const terminator = kind === "fencedCode" ? FENCE_TIP : open.text;
  for (let index = openIndex + 1; index < lines.length; index += 1) {
    if (lines[index].text === terminator) {
      return {
        open,
        close: lines[index],
        interior: lines.slice(openIndex + 1, index),
        resume: index + 1,
      };
    }
  }
  return {
    open,
    close: undefined,
    interior: lines.slice(openIndex + 1),
    resume: lines.length,
  };
}
