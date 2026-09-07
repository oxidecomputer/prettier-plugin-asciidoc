/**
 * The list-shape sweep's ALLOWLIST: every document in the sweep's
 * alphabet that fails render-equality or idempotence TODAY, grouped by
 * the MECHANISM that fails it and keyed to the tracker issue that owns
 * the fix. A family that comes back has a place to be named rather
 * than a number to move.
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
 * so.
 *
 * ONE departure was not a fix, and is recorded here so the list below
 * stays a list of fixes. Issue #290 took the deep tier from depth 5
 * to depth 4, and 100 of the 104 shapes then listed left with it:
 * their bodies are five lines, which neither product spells any more,
 * so they departed by BLINDNESS. Their mechanisms are the two named
 * below, both still live at the four shapes that remain.
 *
 * The families that have left by a fix, newest first: **#184, the
 * continuation between two ITEMS of one list** (2 shapes: the `+` is
 * recorded in front of the item it leads and printed back, so the
 * marker under it opens the list the source opened - the field is
 * `leadingGap` in `src/ast.ts` and the printer's arm is
 * `separatorBefore` in `src/print/list.ts`); **#121, the
 * indented-marker-under-continuation indent drop** (735 of the 827
 * shapes the alphabet's "  ** z" member spelled once #161 added it,
 * now that the marker's own indent threads through `src/ast.ts` and
 * `src/print/list.ts`, leaving only the two neighbouring mechanisms
 * below); **#54, the literal slurp's re-shape** (8 shapes, the
 * last of them); **#55, INLINE_SPAN_SWALLOWS_LINE_BREAK** (78 shapes
 * — the tokenizer's directional flags took its 39 constrained twins
 * and the span-keeps-break fix took the 39 unconstrained ones);
 * **#57, REFLOW_JOIN_CHANGES_READING** (4 shapes, and 14 of the 22
 * #54 shapes left with it — all eighteen failed because reflow packed
 * the item's principal text onto the marker line and a `// c` moved
 * up into the first buffer line, where the metadata loop eats it and
 * leaves `next_block`'s blank count at zero, parser.rb l.505 read at
 * l.764; the item's text now holds a break there, `hazard` in
 * src/print/list-hazard.ts); and the 33 whose failing tail hung on a
 * block anchor standing in a list item's SECOND block, which the
 * classifier read as that block's own metadata and reflowed the line
 * behind it into prose (the anchor now ends any block after the
 * item's first, INTERRUPTERS_BY_CONTEXT's `listItem` row in
 * src/parse/line-shapes.ts).
 */

/**
 * Every document the sweep's alphabet spells that fails
 * render-equality or idempotence today, grouped by mechanism. How
 * many there are of each is the block below, not a figure here.
 *
 * The last family to leave was **#184, the continuation between two
 * ITEMS of one list** (2 shapes, see the file comment above). One
 * mechanism remains, found by the same alphabet member (issue #161's
 * "  ** z"):
 *
 * - **#157, PARAGRAPH_REFLOW_SWALLOWS_TRAILING_MARKER**: a paragraph
 *   reflow-joins its own trailing lines onto one output line, and
 *   when an indented nested marker follows the paragraph at zero gap,
 *   the join swallows the marker line into the paragraph's
 *   prose too (`"para\n  ** z\n"` prints as `"para ** z\n"`). #157
 *   already covers this class for the delimiter-line case; these rows
 *   are its list-marker witnesses. EXPIRES when #157's paragraph-join
 *   guard also refuses a following list-marker line.
 * - **FROZEN_PLUS_PARAGRAPH_LOSES_ITS_SHIELD**: an item whose last
 *   block is a paragraph holding a frozen `+` needs a detached `+`
 *   under it to absorb the re-read's single tagged pop. The printer
 *   no longer writes that shield back, so the `+` paragraph does not
 *   survive. NOT PROTECTED BY DESIGN and so NOT AN ISSUE: reaching
 *   the shape means writing three lone `+` lines with nothing between
 *   them and a blank in the middle, which is what an author leaves
 *   behind by editing a continuation down to nothing and not deleting
 *   the punctuation. This row does not EXPIRE; it records a shape the
 *   formatter has stopped protecting.
 */
export const FAILING_TODAY: readonly string[] = [
  // The frozen `+` paragraph that loses its shield. See the file
  // comment above: not an issue, a shape the formatter no longer
  // protects.
  "* a\n+\n+\n\n+\n",
  // #157: a paragraph reflow-joins its trailing lines onto one output
  // line and swallows a following indented nested marker into the
  // same paragraph's prose. See the file comment above.
  "* a\n// c\n+\npara\n  ** z\n",
  "* a\n[[anc]]\n+\npara\n  ** z\n",
  "* a\n[role]\n+\npara\n  ** z\n",
];
