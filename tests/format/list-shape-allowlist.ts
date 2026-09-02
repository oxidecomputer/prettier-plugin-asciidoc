/**
 * The list-shape sweep's ALLOWLIST: every document in the sweep's
 * alphabet that fails render-equality or idempotence TODAY, grouped by
 * the MECHANISM that fails it and keyed to the tracker issue that owns
 * the fix.
 *
 * The grouping is the point. A flat list of bare strings is a number a
 * reviewer can only watch go up or down; grouped, each block is one
 * bug with one issue, and a shape that moves between blocks is a
 * mechanism claim somebody has to defend. The equality gates read
 * {@link FAILING_TODAY}, which is every block concatenated, so
 * the grouping cannot drift away from what is enforced. The #55
 * block (INLINE_SPAN_SWALLOWS_LINE_BREAK, 78 shapes) is gone: the
 * tokenizer's directional flags took its 39 constrained twins, and
 * the span-keeps-break fix took the remaining 39 unconstrained ones.
 *
 * Every entry was classified by MEASUREMENT, not by shape: each was
 * formatted twice and rendered on both sides, and the family is the
 * mechanism that the byte and render deltas show.
 *
 * A shape LEAVING this file is progress and must be deliberate: the
 * commit that fixes one of the families takes its block out and says
 * so. The #57 block (REFLOW_JOIN_CHANGES_READING, 4 shapes) is gone,
 * and 14 of the 22 #54 shapes left with it: all eighteen failed
 * because reflow packed the item's principal text onto the marker
 * line and a `// c` moved up into the first buffer line, where the
 * metadata loop eats it and leaves `next_block`'s blank count at zero
 * (parser.rb l.505, read at l.764). The item's text now holds a break
 * there ({@link hazard}, src/print/list-hazard.ts). 33 of the 59
 * shapes that were here before left together: every one
 * whose failing tail hung on a block anchor standing in a list item's
 * SECOND block, which the classifier read as that block's own
 * metadata and reflowed the line behind it into prose. The anchor now
 * ends any block after the item's first, so the indented line behind
 * it stays a literal (INTERRUPTERS_BY_CONTEXT's `listItem` row,
 * src/parse/line-shapes.ts).
 */

/**
 * **#54 — the literal slurp's re-shape.** An indented literal tail
 * and what follows it re-read differently once printed:
 * `printedGap`'s slurp arm invents a blank that detaches the nested
 * list behind the tail, or removes the slurp that swallowed the next
 * marker line. The only family left, and the only one whose failing
 * tail is decided in `printedGap` rather than in the item's text: no
 * shape here has a first rest line reflow can move anything onto.
 */
const LITERAL_SLURP_RESHAPE: readonly string[] = [
  "* a\n\n  lit\n[[anc]]\n** b\n* a\n",
  "* a\n\n  lit\n[role]\n** b\n* a\n",
  "* a\n** b\n\n  lit\n[[anc]]\n* a\n",
  "* a\n** b\n\n  lit\n[role]\n* a\n",
  "* a\n** b\n+\n  lit\n[[anc]]\n* a\n",
  "* a\n** b\n+\n  lit\n[role]\n* a\n",
  "* a\n+\n  lit\n[[anc]]\n** b\n* a\n",
  "* a\n+\n  lit\n[role]\n** b\n* a\n",
];

/**
 * The one remaining family, flat - what the sweeps assert set-equality
 * against. The deep entry compares its whole failing set to this;
 * the default entry compares against this filtered to the documents
 * its shallower product actually spells (`allowlistFor`, in
 * `list-shape-sweep.ts`).
 */
export const FAILING_TODAY: readonly string[] = [...LITERAL_SLURP_RESHAPE];
