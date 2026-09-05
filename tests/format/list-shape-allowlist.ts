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
 * so. The families that have left, newest first: **#121, the
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
 * l.764; the item's text now holds a break there, {@link hazard} in
 * src/print/list-hazard.ts); and the 33 whose failing tail hung on a
 * block anchor standing in a list item's SECOND block, which the
 * classifier read as that block's own metadata and reflowed the line
 * behind it into prose (the anchor now ends any block after the
 * item's first, INTERRUPTERS_BY_CONTEXT's `listItem` row in
 * src/parse/line-shapes.ts).
 */

/**
 * Every document the sweep's alphabet spells, at both depths, that
 * fails render-equality or idempotence today, grouped by mechanism.
 *
 * The last family to leave was **#121, the indented-marker-under-
 * continuation indent drop** (735 shapes, see the file comment above).
 * Two mechanisms remain, both found by the same alphabet member
 * (issue #161's "  ** z"):
 *
 * - **#157, PARAGRAPH_REFLOW_SWALLOWS_TRAILING_MARKER** (90 shapes): a
 *   paragraph reflow-joins its own trailing lines onto one output
 *   line, and when an indented nested marker follows the paragraph at
 *   zero gap, the join swallows the marker line into the paragraph's
 *   prose too (`"para\n  ** z\n"` prints as `"para ** z\n"`). #157
 *   already covers this class for the delimiter-line case; these rows
 *   are its list-marker witnesses. EXPIRES when #157's paragraph-join
 *   guard also refuses a following list-marker line.
 * - **#184, the continuation-drop's "or the reverse" case** (2
 *   shapes): #121 fixed the direct witness, but when the continuation
 *   attaches to an ALREADY-OPEN nested item rather than the top-level
 *   item, dropping the continuation's blank line and `+` still changes
 *   which open list a later same-depth marker rejoins, and the item
 *   that followed it in the source renests onto the wrong list.
 *   EXPIRES when #184 is fixed.
 */
export const FAILING_TODAY: readonly string[] = [
  // #157: a paragraph reflow-joins its trailing lines onto one output
  // line and swallows a following indented nested marker into the
  // same paragraph's prose. See the file comment above.
  "* a\n  lit\n[[anc]]\n+\npara\n  ** z\n",
  "* a\n  lit\n[role]\n+\npara\n  ** z\n",
  "* a\n* a\n// c\n+\npara\n  ** z\n",
  "* a\n* a\n[[anc]]\n+\npara\n  ** z\n",
  "* a\n* a\n[role]\n+\npara\n  ** z\n",
  "* a\n+\npara\n  ** z\n+\n  ** z\n",
  "* a\n+\npara\n  ** z\n+\n  lit\n",
  "* a\n+\npara\n  ** z\n+\n** b\n",
  "* a\n+\npara\n  ** z\n+\n+\n",
  "* a\n+\npara\n  ** z\n+\n.T\n",
  "* a\n+\npara\n  ** z\n+\n// c\n",
  "* a\n+\npara\n  ** z\n+\n[[anc]]\n",
  "* a\n+\npara\n  ** z\n+\n[role]\n",
  "* a\n+\npara\n  ** z\n+\npara\n",
  "* a\n.T\n[[anc]]\n+\npara\n  ** z\n",
  "* a\n.T\n[role]\n+\npara\n  ** z\n",
  "* a\n// c\n\n+\npara\n  ** z\n",
  "* a\n// c\n+\n\npara\n  ** z\n",
  "* a\n// c\n+\n.T\npara\n  ** z\n",
  "* a\n// c\n+\n// c\npara\n  ** z\n",
  "* a\n// c\n+\n[[anc]]\npara\n  ** z\n",
  "* a\n// c\n+\n[role]\npara\n  ** z\n",
  "* a\n// c\n+\npara\n  ** z\n",
  "* a\n// c\n+\npara\n  ** z\n\n",
  "* a\n// c\n+\npara\n  ** z\n  ** z\n",
  "* a\n// c\n+\npara\n  ** z\n  lit\n",
  "* a\n// c\n+\npara\n  ** z\n* a\n",
  "* a\n// c\n+\npara\n  ** z\n** b\n",
  "* a\n// c\n+\npara\n  ** z\n+\n",
  "* a\n// c\n+\npara\n  ** z\n.T\n",
  "* a\n// c\n+\npara\n  ** z\n// c\n",
  "* a\n// c\n+\npara\n  ** z\n[[anc]]\n",
  "* a\n// c\n+\npara\n  ** z\n[role]\n",
  "* a\n// c\n+\npara\n  ** z\npara\n",
  "* a\n// c\n+\npara\n  lit\n  ** z\n",
  "* a\n// c\n+\npara\n.T\n  ** z\n",
  "* a\n// c\n+\npara\npara\n  ** z\n",
  "* a\n// c\n// c\n+\npara\n  ** z\n",
  "* a\n// c\n[[anc]]\n+\npara\n  ** z\n",
  "* a\n// c\n[role]\n+\npara\n  ** z\n",
  "* a\n[[anc]]\n\n+\npara\n  ** z\n",
  "* a\n[[anc]]\n+\n\npara\n  ** z\n",
  "* a\n[[anc]]\n+\n.T\npara\n  ** z\n",
  "* a\n[[anc]]\n+\n// c\npara\n  ** z\n",
  "* a\n[[anc]]\n+\n[[anc]]\npara\n  ** z\n",
  "* a\n[[anc]]\n+\n[role]\npara\n  ** z\n",
  "* a\n[[anc]]\n+\npara\n  ** z\n",
  "* a\n[[anc]]\n+\npara\n  ** z\n\n",
  "* a\n[[anc]]\n+\npara\n  ** z\n  ** z\n",
  "* a\n[[anc]]\n+\npara\n  ** z\n  lit\n",
  "* a\n[[anc]]\n+\npara\n  ** z\n* a\n",
  "* a\n[[anc]]\n+\npara\n  ** z\n** b\n",
  "* a\n[[anc]]\n+\npara\n  ** z\n+\n",
  "* a\n[[anc]]\n+\npara\n  ** z\n.T\n",
  "* a\n[[anc]]\n+\npara\n  ** z\n// c\n",
  "* a\n[[anc]]\n+\npara\n  ** z\n[[anc]]\n",
  "* a\n[[anc]]\n+\npara\n  ** z\n[role]\n",
  "* a\n[[anc]]\n+\npara\n  ** z\npara\n",
  "* a\n[[anc]]\n+\npara\n  lit\n  ** z\n",
  "* a\n[[anc]]\n+\npara\n.T\n  ** z\n",
  "* a\n[[anc]]\n+\npara\npara\n  ** z\n",
  "* a\n[[anc]]\n// c\n+\npara\n  ** z\n",
  "* a\n[[anc]]\n[[anc]]\n+\npara\n  ** z\n",
  "* a\n[[anc]]\n[role]\n+\npara\n  ** z\n",
  "* a\n[role]\n\n+\npara\n  ** z\n",
  "* a\n[role]\n+\n\npara\n  ** z\n",
  "* a\n[role]\n+\n.T\npara\n  ** z\n",
  "* a\n[role]\n+\n// c\npara\n  ** z\n",
  "* a\n[role]\n+\n[[anc]]\npara\n  ** z\n",
  "* a\n[role]\n+\n[role]\npara\n  ** z\n",
  "* a\n[role]\n+\npara\n  ** z\n",
  "* a\n[role]\n+\npara\n  ** z\n\n",
  "* a\n[role]\n+\npara\n  ** z\n  ** z\n",
  "* a\n[role]\n+\npara\n  ** z\n  lit\n",
  "* a\n[role]\n+\npara\n  ** z\n* a\n",
  "* a\n[role]\n+\npara\n  ** z\n** b\n",
  "* a\n[role]\n+\npara\n  ** z\n+\n",
  "* a\n[role]\n+\npara\n  ** z\n.T\n",
  "* a\n[role]\n+\npara\n  ** z\n// c\n",
  "* a\n[role]\n+\npara\n  ** z\n[[anc]]\n",
  "* a\n[role]\n+\npara\n  ** z\n[role]\n",
  "* a\n[role]\n+\npara\n  ** z\npara\n",
  "* a\n[role]\n+\npara\n  lit\n  ** z\n",
  "* a\n[role]\n+\npara\n.T\n  ** z\n",
  "* a\n[role]\n+\npara\npara\n  ** z\n",
  "* a\n[role]\n// c\n+\npara\n  ** z\n",
  "* a\n[role]\n[[anc]]\n+\npara\n  ** z\n",
  "* a\n[role]\n[role]\n+\npara\n  ** z\n",
  "* a\npara\n[[anc]]\n+\npara\n  ** z\n",
  "* a\npara\n[role]\n+\npara\n  ** z\n",
  // #184: a continuation that attaches to an already-open nested item
  // (rather than the top-level item) still misnests the item that
  // follows it once the continuation's blank line and `+` are
  // dropped, even though the marker itself keeps its indentation. See
  // the file comment above.
  "* a\n  ** z\n\n+\n  ** z\n* a\n",
  "* a\n** b\n\n+\n  ** z\n* a\n",
];
