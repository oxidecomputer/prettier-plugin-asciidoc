/**
 * Shared `+` continuation-marker rules.
 *
 * Two splitters interpret `+` marker lines: the token-level one
 * for lines INSIDE a list item (continuation-builder.ts) and the
 * AST-level sibling absorber for blocks AFTER the item
 * (continuation-absorber.ts). The same document can route the
 * same marker through either path depending on whether a
 * delimited block interrupts the item, so the two must agree on
 * Asciidoctor's quirks or formatting would depend on which path
 * parsed a line. The predicates and rules they must share live
 * here so they cannot drift apart.
 */
import { LAST_ELEMENT, SINGLE } from "../constants.js";

/**
 * How many blank lines a `+` continuation survives.
 *
 * `read_lines_for_list_item` keeps reading across ONE blank line
 * (the detached-continuation form, where the `+` still attaches the
 * block below it) and gives up on the second, which ends the list.
 * Confirmed against the oracle both ways: `* a` / `+` / `` / `para`
 * renders `para` inside the item, and a second blank line makes it a
 * top-level sibling.
 */
export const MAX_DETACHED_BLANK_LINES = 1;

/**
 * Check whether a line's text is a `+` continuation marker: a
 * lone `+`, with trailing whitespace allowed — Asciidoctor
 * right-trims lines before matching, so `+ ` with an invisible
 * trailing space is still a marker.
 * @param text - One source line (no newline), or a token image.
 * @returns True when the line is a marker.
 */
export function isMarkerLineText(text: string): boolean {
  return text.trimEnd() === "+";
}

/**
 * Drop trailing marker-only segments (`+` after `+` at the end
 * of an item or chain). They attach nothing and render nothing
 * in Asciidoctor; emitting the lone `+` as content would render
 * a paragraph the input does not have. Callers fold the removal
 * into their dangling-continuation flag so the printer emits
 * one dangling marker, which renders identically.
 * @param segments - The split segments; trailing marker-only
 *   entries are removed in place (the principal segment always
 *   stays).
 * @param isMarkerOnlySegment - Caller's test for a segment that
 *   carries nothing to attach (its element type differs per
 *   splitter: raw tokens vs inline nodes).
 * @returns True when at least one segment was removed.
 */
export function collapseTrailingMarkerOnly<Element>(
  segments: Element[][],
  isMarkerOnlySegment: (segment: Element[] | undefined) => boolean,
): boolean {
  let collapsed = false;
  while (
    segments.length > SINGLE &&
    isMarkerOnlySegment(segments.at(LAST_ELEMENT))
  ) {
    segments.pop();
    collapsed = true;
  }
  return collapsed;
}
