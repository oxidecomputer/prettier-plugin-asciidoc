import { defineConfig } from "vitest/config";

// Generous default so property-based tests with bounded
// run counts aren't killed prematurely.
const TEST_TIMEOUT = 60_000;

export default defineConfig({
  test: {
    // `.stryker-tmp/` is StrykerJS's sandbox: a full copy of the
    // project, tests included. Without this, running the suite while a
    // mutation run is in flight collects every test twice over —
    // measured at 453 files and 19,017 tests against the real 105 and
    // 8,577, with the copies failing on relative paths. eslint already
    // ignores it (`eslint.config.js`); vitest did not.
    // `**/*.deep.test.ts` is the OTHER entry: the deep tier, whose
    // list-shape half sweeps `sweepDocuments(DEEP_DEPTH)`
    // (tests/format/list-shape-sweep.ts) against the allowlist and the
    // reading ledger WHOLE rather than filtered to what one product
    // spells. It is not weakened by living outside the default run: it
    // is a blocking CI step (`bun run test:deeply-nested-lists`) and
    // the prelude to every mutation run. What stays here is the same
    // sweep filtered to `SHALLOW_DEPTH`, which is what the mutation
    // harness gets to kill mutants with, since a mutation run never
    // sees a deep tier.
    exclude: ["node_modules/**", ".stryker-tmp/**", "**/*.deep.test.ts"],
    passWithNoTests: true,
    testTimeout: TEST_TIMEOUT,
    // Coverage is INERT unless `--coverage` is passed, so `bun run
    // test` and the StrykerJS runs are unaffected by its presence:
    // this block only says what a coverage run would do.
    //
    // v8 rather than istanbul because it needs no instrumentation
    // pass — the whole suite plus coverage stays within a few seconds
    // of the plain run, which is what lets `bun run coverage` sit in
    // CI's blocking job (`scripts/metrics/floors.ts` reads the
    // json-summary this writes).
    coverage: {
      provider: "v8",
      // `src` only: the floors are per-source-file, and pulling
      // `scripts/` and `tests/` into the denominator would move every
      // floor whenever a harness changed.
      include: ["src/**/*.ts"],
      // vitest 4 needs no `all` flag: every file matching `include`
      // is reported, imported by a test or not, so a source file
      // nothing exercises shows up at 0% rather than going missing —
      // and a missing file is the one direction a floors file cannot
      // see (`scripts/metrics/floors.ts` turns it into exit 2).
      reporter: ["text-summary", "json-summary"],
      reportsDirectory: "reports/coverage",
    },
  },
});
