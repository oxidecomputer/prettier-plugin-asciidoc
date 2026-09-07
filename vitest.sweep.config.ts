import { defineConfig } from "vitest/config";
import { BATCHED_SWEEPS } from "./vitest.batched-sweep.config.js";
import base from "./vitest.config.js";

/**
 * The vitest entry for the PER-PUSH deep sweeps: the
 * `*.deep.test.ts` files other than the batched ones, run by
 * `bun run test:deeply-nested-lists`. The shape registry's deep tier
 * and the reparse ledger. That script's own
 * header says what each proves; the floor it holds the collected test
 * count to is what makes a file dropped from the glob below an exit 2
 * rather than a green tick.
 *
 * It is the base config with one glob moved from `exclude` to
 * `include`, minus the sweeps `vitest.batched-sweep.config.ts` claims:
 * what `vitest.config.ts` refuses to collect is the only thing this
 * collects, and the batched entry's list is imported rather than
 * restated, so the two deep entries partition the deep files exactly.
 * Derived from the base rather than written out so the entries cannot
 * drift on anything else: the `.stryker-tmp` exclusion, the timeout
 * and the coverage block are one definition.
 *
 * SPREAD, not `mergeConfig`. Vite's merge CONCATENATES arrays, so
 * inheriting the base's `exclude` would exclude the very files this
 * include names and the run would collect zero tests and pass
 * (`passWithNoTests`). That silent green is exactly the failure the
 * exit-code contract exists to prevent, which is also why
 * `scripts/test-deeply-nested-lists.ts` checks that tests actually ran.
 */
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["tests/**/*.deep.test.ts"],
    exclude: ["node_modules/**", ".stryker-tmp/**", ...BATCHED_SWEEPS],
  },
});
