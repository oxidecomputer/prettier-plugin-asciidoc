import { defineConfig } from "vitest/config";
import base from "./vitest.config.js";

/**
 * The vitest entry for the DEEP sweeps — the `*.deep.test.ts` files,
 * today just the exhaustive depth-5 list-shape product, run by
 * `bun run test:deeply-nested-lists`.
 *
 * It is the base config with one glob moved from `exclude` to
 * `include`: what `vitest.config.ts` refuses to collect is the only
 * thing this collects. Derived from the base rather than written out
 * so the two entries cannot drift on anything else — the
 * `.stryker-tmp` exclusion, the timeout and the coverage block are one
 * definition.
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
    exclude: ["node_modules/**", ".stryker-tmp/**"],
  },
});
