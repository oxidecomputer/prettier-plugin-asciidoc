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
  },
});
