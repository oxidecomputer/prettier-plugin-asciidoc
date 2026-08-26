/**
 * The list-shape sweep's ALLOWLIST: every document in the sweep's
 * alphabet that fails render-equality or idempotence TODAY, grouped by
 * the MECHANISM that fails it and keyed to the tracker issue that owns
 * the fix.
 *
 * The grouping is the point. A flat list of 59 strings is a number a
 * reviewer can only watch go up or down; grouped, each block is one
 * bug with one issue, and a shape that moves between blocks is a
 * mechanism claim somebody has to defend. The equality gates read
 * {@link FAILING_TODAY}, which is the two blocks concatenated, so
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
 * so.
 */

/**
 * **#54 — the literal slurp's re-shape.** An indented literal tail
 * and what follows it re-read differently once printed:
 * `printedGap`'s slurp arm invents a blank that detaches the nested
 * list behind the tail, or removes the slurp that swallowed the next
 * marker line. The largest family.
 */
const LITERAL_SLURP_RESHAPE: readonly string[] = [
  "* a\n\n  lit\n[[anc]]\n** b\n* a\n",
  "* a\n\n  lit\n[role]\n** b\n* a\n",
  "* a\n  lit\n// c\n\n  lit\n* a\n",
  "* a\n  lit\n// c\n\n  lit\n** b\n",
  "* a\n  lit\n// c\n+\n  lit\n* a\n",
  "* a\n  lit\n// c\n+\n  lit\n** b\n",
  "* a\n  lit\n// c\n+\n+\n** b\n",
  "* a\n  lit\n// c\n+\npara\n** b\n",
  "* a\n  lit\n[[anc]]\npara\n[[anc]]\n  lit\n",
  "* a\n  lit\n[role]\npara\n[[anc]]\n  lit\n",
  "* a\n* a\n[role]\npara\n[[anc]]\n  lit\n",
  "* a\n** b\n\n  lit\n[[anc]]\n* a\n",
  "* a\n** b\n\n  lit\n[role]\n* a\n",
  "* a\n** b\n+\n  lit\n[[anc]]\n* a\n",
  "* a\n** b\n+\n  lit\n[role]\n* a\n",
  "* a\n** b\n[role]\npara\n[[anc]]\n  lit\n",
  "* a\n+\n  lit\n[[anc]]\n** b\n* a\n",
  "* a\n+\n  lit\n[role]\n** b\n* a\n",
  "* a\n.T\n// c\n\n  lit\n* a\n",
  "* a\n.T\n// c\n\n  lit\n** b\n",
  "* a\n.T\n// c\n+\n  lit\n* a\n",
  "* a\n.T\n// c\n+\n  lit\n** b\n",
  "* a\n.T\n[[anc]]\npara\n[[anc]]\n  lit\n",
  "* a\n.T\n[role]\npara\n[[anc]]\n  lit\n",
  "* a\n// c\n[[anc]]\npara\n[[anc]]\n  lit\n",
  "* a\n// c\n[role]\npara\n[[anc]]\n  lit\n",
  "* a\n[[anc]]\n[[anc]]\npara\n[[anc]]\n  lit\n",
  "* a\n[[anc]]\n[role]\npara\n[[anc]]\n  lit\n",
  "* a\n[role]\n.T\npara\n[[anc]]\n  lit\n",
  "* a\n[role]\n// c\npara\n[[anc]]\n  lit\n",
  "* a\n[role]\n[[anc]]\npara\n[[anc]]\n  lit\n",
  "* a\n[role]\n[role]\npara\n[[anc]]\n  lit\n",
  "* a\n[role]\npara\n  lit\n[[anc]]\n  lit\n",
  "* a\n[role]\npara\n.T\n[[anc]]\n  lit\n",
  "* a\n[role]\npara\n[[anc]]\n  lit\n",
  "* a\n[role]\npara\n[[anc]]\n  lit\n\n",
  "* a\n[role]\npara\n[[anc]]\n  lit\n  lit\n",
  "* a\n[role]\npara\n[[anc]]\n  lit\n* a\n",
  "* a\n[role]\npara\n[[anc]]\n  lit\n** b\n",
  "* a\n[role]\npara\n[[anc]]\n  lit\n+\n",
  "* a\n[role]\npara\n[[anc]]\n  lit\n.T\n",
  "* a\n[role]\npara\n[[anc]]\n  lit\n// c\n",
  "* a\n[role]\npara\n[[anc]]\n  lit\n[[anc]]\n",
  "* a\n[role]\npara\n[[anc]]\n  lit\n[role]\n",
  "* a\n[role]\npara\n[[anc]]\n  lit\npara\n",
  "* a\n[role]\npara\n[[anc]]\n.T\n  lit\n",
  "* a\n[role]\npara\n[[anc]]\n// c\n  lit\n",
  "* a\n[role]\npara\npara\n[[anc]]\n  lit\n",
  "* a\npara\n// c\n\n  lit\n* a\n",
  "* a\npara\n// c\n\n  lit\n** b\n",
  "* a\npara\n// c\n+\n  lit\n* a\n",
  "* a\npara\n// c\n+\n  lit\n** b\n",
  "* a\npara\n[[anc]]\npara\n[[anc]]\n  lit\n",
  "* a\npara\n[role]\npara\n[[anc]]\n  lit\n",
];

/**
 * **#57 — a reflow join changes how the lines AFTER it are read.**
 * Two faces: the item's principal text joined across its source break
 * changes the oracle's reading of the `+`-attached block below it,
 * and a `.T` block-title line reflowed onto the paragraph it titles
 * destroys that paragraph outright.
 */
const REFLOW_JOIN_CHANGES_READING: readonly string[] = [
  "* a\n.T\n// c\n+\n+\n** b\n",
  "* a\n.T\n// c\n+\npara\n** b\n",
  "* a\n[role]\npara\n[[anc]]\n.T\npara\n",
  "* a\npara\n// c\n+\n+\n** b\n",
  "* a\npara\n// c\n+\npara\n** b\n",
];

/**
 * The two families, flat — what the sweeps assert set-equality
 * against. The deep entry compares its whole failing set to this;
 * the default entry compares against this filtered to the documents
 * its shallower product actually spells (`allowlistFor`, in
 * `list-shape-sweep.ts`).
 */
export const FAILING_TODAY: readonly string[] = [
  ...LITERAL_SLURP_RESHAPE,
  ...REFLOW_JOIN_CHANGES_READING,
];
