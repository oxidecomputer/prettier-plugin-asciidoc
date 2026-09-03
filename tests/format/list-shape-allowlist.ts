/**
 * The list-shape sweep's ALLOWLIST: every document in the sweep's
 * alphabet that fails render-equality or idempotence TODAY, grouped by
 * the MECHANISM that fails it and keyed to the tracker issue that owns
 * the fix. It is EMPTY today, and the file stays so a family that
 * comes back has a place to be named rather than a number to move.
 *
 * The grouping is the point. A flat list of bare strings is a number a
 * reviewer can only watch go up or down; grouped, each block is one
 * bug with one issue, and a shape that moves between blocks is a
 * mechanism claim somebody has to defend. The equality gates read
 * {@link FAILING_TODAY}, which is every block concatenated, so
 * the grouping cannot drift away from what is enforced.
 *
 * Every entry was classified by MEASUREMENT, not by shape: each was
 * formatted twice and rendered on both sides, and the family is the
 * mechanism that the byte and render deltas show.
 *
 * A shape LEAVING this file is progress and must be deliberate: the
 * commit that fixes one of the families takes its block out and says
 * so. The families that have left, newest first: **#54, the literal
 * slurp's re-shape** (8 shapes, the last of them); **#55,
 * INLINE_SPAN_SWALLOWS_LINE_BREAK** (78 shapes — the tokenizer's
 * directional flags took its 39 constrained twins and the
 * span-keeps-break fix took the 39 unconstrained ones); **#57,
 * REFLOW_JOIN_CHANGES_READING** (4 shapes, and 14 of the 22 #54
 * shapes left with it — all eighteen failed because reflow packed the
 * item's principal text onto the marker line and a `// c` moved up
 * into the first buffer line, where the metadata loop eats it and
 * leaves `next_block`'s blank count at zero, parser.rb l.505 read at
 * l.764; the item's text now holds a break there, {@link hazard} in
 * src/print/list-hazard.ts); and the 33 whose failing tail hung on a
 * block anchor standing in a list item's SECOND block, which the
 * classifier read as that block's own metadata and reflowed the line
 * behind it into prose (the anchor now ends any block after the
 * item's first, INTERRUPTERS_BY_CONTEXT's `listItem` row in
 * src/parse/line-shapes.ts).
 */

/**
 * EMPTY, and that is the assertion: every document the sweep's
 * alphabet spells, at both depths, formats to a fixed point that
 * Asciidoctor renders like its source.
 *
 * The last family to leave was **#54, the literal slurp's re-shape**
 * (8 shapes): an indented literal tail and what followed it re-read
 * differently once printed, because `printedGap` invented a blank in
 * front of the nested list behind the tail and that blank ended the
 * item where the source had not. The blank that stops a slurp now
 * goes where the slurp must stop — at the item BOUNDARY, decided from
 * the item's own output lines (`tailSwallowsMarker`,
 * src/print/list.ts) — and all eight are their own output. Their rows
 * live in tests/format/marker-spelling.test.ts, "a slurp that stays
 * inside the item needs no blank".
 */
export const FAILING_TODAY: readonly string[] = [];
