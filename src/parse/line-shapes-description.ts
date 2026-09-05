/**
 * The description-list rows of the line-shape registry: how a
 * `term:: definition` line SPLITS, and the four patterns that decide
 * whether a line continues a description list already open.
 *
 * A SIBLING of line-shapes.ts, not a layer under it. This is registry,
 * and the same rule holds here as there: the classification pass is
 * the only reader allowed to import a pattern by name, and every other
 * consumer asks a lowercase accessor. Both rules are enforced over
 * every `line-shapes*` module rather than over one filename - the
 * pattern-import row in tests/parser/architecture.test.ts and the
 * completeness census in scripts/metrics/shape-census.ts each derive
 * the module list instead of naming a file - so a shape added here is
 * held exactly as one added there.
 *
 * WHY THE ROWS ARE HERE. line-shapes.ts is the registry's main table
 * and its growth is not finished: further line shapes are still to be
 * added to it, and a file at its `max-lines` ceiling cannot take them.
 * The registry keeps headroom by moving whole row families out, never
 * by condensing rows.
 *
 * WHERE THE SPLIT FALLS, and why it is not where the grammar would
 * put it. Two rows of this family stay in line-shapes.ts, each held
 * there by a rule this module cannot argue with:
 *
 * - DESCRIPTION_LIST_LINE and `isDescriptionListLine`, because
 *   `interruptsParagraph` asks that predicate itself. Moving them
 *   would make the two registry modules import each other, and
 *   src/parse admits no import cycle (the graph rules in
 *   scripts/metrics/graph.ts, held by tests/parser/architecture.test.ts).
 *   So the OPENING pattern is imported from there and the parse that
 *   rides its groups out is here.
 * - DLIST_SEPARATOR_WORD, because src/print/reflow.ts reads it, and
 *   print reaches into parse at exactly three addresses, line-shapes.ts
 *   among them and this module not.
 *
 * What that leaves is still one question per export, and the two
 * halves of the one Ruby grammar - `DescriptionListRx` (rx.rb:336)
 * and `DescriptionListSiblingRx` (rx.rb:340-345) - name each other
 * across the two files.
 */
import { DESCRIPTION_LIST_LINE, optionalGroup, rstrip } from "./line-shapes.js";
import type { DescriptionDelimiter } from "../ast.js";

/**
 * Parse a description-list term line into the fields the classifier
 * carries: the delimiter (`::` | `:::` | `::::` | `;;`), the term
 * text (Ruby's group, trailing spaces before the delimiter
 * included: `foo ::` has term `"foo "`), and where the optional
 * inline description starts, as an offset into the RSTRIPPED line.
 * Grammar home: DESCRIPTION_LIST_LINE, imported from line-shapes.ts
 * because `interruptsParagraph` asks it there too (Ruby's
 * `DescriptionListRx`, rx.rb:336, pinned by tests/parser/lines.test.ts's
 * split rows); the groups ride out so no builder
 * or reader ever re-parses the line.
 * @param rawLine - one source line, without its trailing newline;
 *   trailing whitespace is trimmed here (see rstrip)
 * @returns the term line's fields, or undefined when the line is no
 *   description-list item
 */
export function parseDescriptionListLine(rawLine: string):
  | {
      delimiter: DescriptionDelimiter;
      term: string;
      descriptionStart: number | undefined;
    }
  | undefined {
  const line = rstrip(rawLine);
  const groups = DESCRIPTION_LIST_LINE.exec(line)?.groups;
  if (groups === undefined) {
    return undefined;
  }
  // The description group is the one OPTIONAL branch, so it is the
  // one read through {@link optionalGroup}.
  const description = optionalGroup(groups.description);
  return {
    delimiter: delimiterBranch(groups),
    term: groups.term,
    descriptionStart:
      description === undefined ? undefined : line.length - description.length,
  };
}

/**
 * Which delimiter branch of {@link DESCRIPTION_LIST_LINE}
 * participated. The colon branches are mutually exclusive and the
 * `;;` one is what is left when none of them did, so the last arm
 * needs no test of its own: the same fall-through parseListMarker's
 * unordered arm relies on, which is also why `;;` carries no group of
 * its own to read.
 * @param groups - the named groups of a successful match
 * @returns the delimiter the line carries
 */
function delimiterBranch(groups: Record<string, string>): DescriptionDelimiter {
  if (optionalGroup(groups.colons4) !== undefined) {
    return "::::";
  }
  if (optionalGroup(groups.colons3) !== undefined) {
    return ":::";
  }
  if (optionalGroup(groups.colons2) !== undefined) {
    return "::";
  }
  return ";;";
}

// One pattern per delimiter, mirroring `DescriptionListSiblingRx`
// (rx.rb:340-345) row for row. A DIFFERENT question from
// DESCRIPTION_LIST_LINE: once a description list is open,
// `is_sibling_list_item?` tests each line against the pattern its
// delimiter is KEYED to and never against DescriptionListRx
// (parser.rb:2280-2282), so the two can read the same line
// differently. `a:: b;; c` is the case: DESCRIPTION_LIST_LINE binds
// `::` with term `a`, and inside a `;;` list the `;;` row below binds
// with term `a:: b`.
//
// The colon rows carry Ruby's exclusion `[^:]` on the term's last
// character (rx.rb:341-343), which is what keeps a LONGER delimiter
// out: `a::: y` is no `::` sibling, so it opens a nested list instead
// of continuing this one. The `;;` row has no exclusion, because
// Ruby's does not (rx.rb:344) - its term group is DescriptionListRx's.
//
// The delimiter needs no capture group: the caller already holds it,
// which is the whole point of keying the family on it.
const DESCRIPTION_SIBLING_LINE: Record<DescriptionDelimiter, RegExp> = {
  "::": /^(?!\/\/[^\/])[ \t]*(?<term>[^ \t][^\n]*?[^:]|[^ \t:])::(?:$|[ \t]+(?<description>[^\n]*))$/v,
  ":::":
    /^(?!\/\/[^\/])[ \t]*(?<term>[^ \t][^\n]*?[^:]|[^ \t:]):::(?:$|[ \t]+(?<description>[^\n]*))$/v,
  "::::":
    /^(?!\/\/[^\/])[ \t]*(?<term>[^ \t][^\n]*?[^:]|[^ \t:])::::(?:$|[ \t]+(?<description>[^\n]*))$/v,
  ";;": /^(?!\/\/[^\/])[ \t]*(?<term>[^ \t][^\n]*?);;(?:$|[ \t]+(?<description>[^\n]*))$/v,
};

/**
 * Whether a line continues the description list that is already open
 * - the predicate half of {@link parseDescriptionSiblingLine}, for
 * the reader that only needs the verdict.
 *
 * The interruption model asks it (line-shapes-interruption.ts): a
 * sibling term ends a `+`-attached paragraph and an indented run
 * inside a description item, which is `is_sibling_list_item?`
 * (parser.rb l.2280-2285) reached from the item scan.
 * @param rawLine - one source line, without its trailing newline;
 *   trailing whitespace is trimmed here (see rstrip)
 * @param delimiter - the delimiter the open list's first term used
 * @returns true when the line is the next item of that same list
 */
export function isDescriptionSiblingLine(
  rawLine: string,
  delimiter: DescriptionDelimiter,
): boolean {
  return DESCRIPTION_SIBLING_LINE[delimiter].test(rstrip(rawLine));
}

/**
 * Parse a line as a SIBLING of a description list that is already
 * open, which is a different reading from
 * {@link parseDescriptionListLine}: the delimiter is given, not
 * discovered, and the term is whatever the pattern keyed to that
 * delimiter captures. Ruby's `DescriptionListSiblingRx[match[2]]`
 * (parser.rb:1225), asked line by line through
 * `is_sibling_list_item?`.
 * @param rawLine - one source line, without its trailing newline;
 *   trailing whitespace is trimmed here (see rstrip)
 * @param delimiter - the delimiter the open list's first term used
 * @returns the term text and where the optional inline description
 *   starts (an offset into the RSTRIPPED line), or undefined when the
 *   line does not continue that list
 */
export function parseDescriptionSiblingLine(
  rawLine: string,
  delimiter: DescriptionDelimiter,
): { term: string; descriptionStart: number | undefined } | undefined {
  const line = rstrip(rawLine);
  const groups = DESCRIPTION_SIBLING_LINE[delimiter].exec(line)?.groups;
  if (groups === undefined) {
    return undefined;
  }
  const description = optionalGroup(groups.description);
  return {
    term: groups.term,
    descriptionStart:
      description === undefined ? undefined : line.length - description.length,
  };
}
