/**
 * The optional prefix every unconstrained and superscript/subscript
 * row of `QUOTE_SUBS` carries in front of its delimiter: Ruby's
 * `\\?(?:\[([^\]]+)\])?` (asciidoctor.rb l.439-469, substitutors.rb
 * l.189-196). doubled-marks.ts (the four unconstrained rows) and
 * super-sub.ts (the two remaining rows) both walk match starts over
 * this same prefix; what differs between them is what a row does
 * once the prefix is behind it and the delimiter itself is found,
 * which is theirs to spell, not this module's.
 */

// Ruby's `\\?`: one optional backslash in front of the whole match.
// Exported: super-sub.ts's own scanRow tests an escaped match directly
// (doubled-marks.ts's scanRow does not need to).
export const ESCAPE = "\\";

// The attrlist group's own brackets, `\[([^\]]+)\])?`. Neither name
// escapes this module: both callers reach the group only through
// {@link nextStart} and {@link delimiterFor}.
const ATTRLIST_OPEN = "[";
const ATTRLIST_CLOSE = "]";

/**
 * The next offset at or after `from` where a match could BEGIN.
 *
 * Only three characters can begin one: the row's own mark, with
 * neither optional group taken; a backslash, which `\\?` takes; and the
 * `[` the attrlist group opens with. Anywhere else both optional groups
 * match empty and the delimiter is then required where it does not
 * stand. Skipping the rest is what keeps the walk linear in the
 * fragment rather than quadratic in it.
 * @param source - the fragment as this row reads it
 * @param mark - the character the row's delimiter doubles, or the row's
 *   delimiter character itself
 * @param from - the first offset to consider
 * @returns the offset, or -1 when no start is left
 */
export function nextStart(source: string, mark: string, from: number): number {
  for (let index = from; index < source.length; index += 1) {
    const character = source.charAt(index);
    if (
      character === mark ||
      character === ESCAPE ||
      character === ATTRLIST_OPEN
    ) {
      return index;
    }
  }
  return -1;
}

/**
 * Where `\[([^\]]+)\]` ends when it stands at `at`, or -1 when it does
 * not stand there.
 *
 * The group's own `\]` is the FIRST `]` at or after `at + 1`, and no
 * other one can be: `[^\]]+` cannot cross a `]`, so shortening it would
 * leave the `\]` to match a character the class already refused. The
 * run in front of that `]` must be at least one character wide, which
 * is why `[]` is no attrlist.
 * @param source - the fragment as this row reads it
 * @param at - the offset the group would begin at
 * @returns the first offset behind the group, or -1
 */
function attrlistEnd(source: string, at: number): number {
  if (source.charAt(at) !== ATTRLIST_OPEN) {
    return -1;
  }
  const close = source.indexOf(ATTRLIST_CLOSE, at + 1);
  return close > at + 1 ? close + 1 : -1;
}

/**
 * Where the opening DELIMITER has to stand for a match beginning at
 * `start` - `start` itself, or behind whichever optional groups take
 * characters there.
 *
 * ONE candidate and not two, because both optional groups are greedy:
 * the engine takes the backslash and the attrlist where they stand,
 * and the arm that declines the attrlist can never match in its place,
 * since its delimiter would have to stand on the `[` the attrlist
 * begins with. So a failed attrlist arm costs this row nothing but the
 * start it was tried at.
 * @param source - the fragment as this row reads it
 * @param start - the offset the match would begin at
 * @returns the offset the delimiter must stand at
 */
export function delimiterFor(source: string, start: number): number {
  const afterEscape = source.charAt(start) === ESCAPE ? start + 1 : start;
  const afterAttrlist = attrlistEnd(source, afterEscape);
  return afterAttrlist === -1 ? afterEscape : afterAttrlist;
}
