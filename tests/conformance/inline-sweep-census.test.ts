/**
 * The inline registry's completeness gate, in `bun run test`.
 *
 * `scripts/inline-census.ts` reconciles the generator against
 * `src/parse/inline/rules.ts`: a rule row with no construct dimension,
 * a dimension whose spelling produces no token of its own kind, a new
 * rules.ts export nobody has decided about, a roster that drifted, an
 * alphabet member that reaches no realized row, or a grid that
 * silently changed size. Any of those is a failure here, which is
 * what makes a new inline construct teach the sweep in the same
 * change rather than sit outside the net unnoticed.
 *
 * It is a TEST rather than a `bun run metrics` row, unlike the
 * line-shape census. The two would sit together happily; what decides
 * it is that the pins this census holds are the sweep's own row
 * counts, and the gate that would notice them going stale first is
 * the sweep beside it.
 */
import { describe, expect, test } from "vitest";
import { inlineCensusFailures } from "../../scripts/inline-census.js";

describe("inline census", () => {
  test("the registry and the inline rule table agree", () => {
    expect(inlineCensusFailures()).toEqual([]);
  });
});
