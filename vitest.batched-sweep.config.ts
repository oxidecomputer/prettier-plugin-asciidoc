import { defineConfig } from "vitest/config";
import base from "./vitest.config.js";

/**
 * The deep sweeps that run BATCHED at integration points rather than
 * on every push, behind `bun run test:batched-sweeps`. The cadence is
 * the whitespace battery's and the reference diff's, for a different
 * reason: those two need Asciidoctor's Ruby gem, this one needs
 * minutes nobody should pay per push.
 *
 * One file today, `tests/conformance/inline-sweep.deep.test.ts`: it
 * costs more wall time than every other deep gate put together (its
 * own header carries the measurements), which made it the whole
 * critical path of CI's blocking job while it sat there. What it
 * proves is unchanged; only when it is asked changes.
 *
 * The membership is an EXPLICIT list rather than a file-name suffix of
 * its own, and `vitest.sweep.config.ts` imports it to exclude exactly
 * these files from the per-push entry. So the partition of the
 * `*.deep.test.ts` files into the two cadences is ONE definition, and
 * a file cannot end up collected by both entries or by neither - the
 * second of which `passWithNoTests` would report as a green tick.
 *
 * SPREAD, not `mergeConfig`, for the reason written in
 * `vitest.sweep.config.ts`: Vite's merge concatenates arrays, so the
 * base's `exclude` would exclude the very files named here.
 */
export const BATCHED_SWEEPS: readonly string[] = [
  "tests/conformance/inline-sweep.deep.test.ts",
];

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: [...BATCHED_SWEEPS],
    exclude: ["node_modules/**", ".stryker-tmp/**"],
  },
});
