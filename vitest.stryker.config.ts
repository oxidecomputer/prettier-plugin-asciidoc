import { mergeConfig } from "vitest/config";
import base from "./vitest.config.js";

/**
 * The vitest config StrykerJS runs the suite with.
 *
 * Identical to `vitest.config.ts` except that each run is ONE process.
 * Stryker's `concurrency` (`-c N`) already forks N test runners; vitest
 * in turn sizes its own worker pool from the CPU count, so the default
 * config multiplies out to N × cores processes — on a 14-core machine
 * that is a load average in the hundreds and a laptop that thermally
 * throttles into a slower run than `-c 4` would have been.
 *
 * `fileParallelism: false` is vitest 4's spelling of what used to be
 * `poolOptions.forks.singleFork`: it pins the pool to one worker (the
 * option's own docs say it overrides `maxWorkers` to 1). `poolOptions`
 * itself no longer exists in vitest 4. With this, `-c N` means exactly
 * N test processes.
 */
export default mergeConfig(base, {
  test: {
    pool: "forks",
    fileParallelism: false,
    // These three hold assertions against the repo's own SOURCE TEXT,
    // and inside Stryker's sandbox that text is the instrumented
    // rewrite (every call becomes a mutant-switch ternary), which is
    // not the domain they measure: the statement-position row and the
    // repo-internal citation quotes fail on text no real tree
    // contains, and the near-miss scan reads markers that are not
    // there. None of them can kill a mutant either - what they read is
    // identical whichever mutant is active. So the class leaves the
    // mutation run entirely.
    exclude: [
      "tests/parser/architecture.test.ts",
      "tests/scripts/internal-citations.test.ts",
      "tests/scripts/metrics-design.test.ts",
    ],
  },
});
