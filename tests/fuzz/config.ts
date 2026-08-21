/**
 * Shared fuzz-test configuration.
 *
 * Setting the FUZZ environment variable enables continuous fuzzing:
 * runs indefinitely until Ctrl-C or the first failure. Without it,
 * tests use the caller-supplied numRuns for CI and allow shrinking
 * (fast-check explores minimal counterexamples on failure).
 * See https://fast-check.dev/docs/advanced/fuzzing/
 */

import type { Parameters } from "fast-check";

// CI runs are SEEDED so the gate is reproducible for BOTH kinds of
// property. The formatter properties are `test.fails` markers for
// known gaps, where a run that happens to find no counterexample
// would turn green into a spurious failure; the reader properties
// (tests/parser/reader-lists.test.ts) are ordinary passing
// properties, where a seed makes a failure replayable. Continuous
// fuzzing (FUZZ set) drops the seed so each run explores fresh
// inputs. Verified: with this seed both `test.fails` properties find
// a counterexample on every run; if a fix ever closes one of them,
// flip its `test.fails` to `test` rather than hunting for a new seed.
const CI_SEED = 1;

// Check for presence, not value — `FUZZ=0` still enables fuzzing.
const FUZZING = process.env.FUZZ !== undefined;

/**
 * Adjusts fast-check parameters for the active run mode.
 *
 * In fuzzing mode (FUZZ env var set): overrides numRuns to
 * infinity, drops the seed, and sets endOnFailure, skipping
 * shrinking so the run stops immediately on the first failure.
 *
 * In CI mode: preserves the caller's numRuns, pins the seed, and
 * clears endOnFailure so fast-check can shrink counterexamples to
 * their minimal form.
 * @param parameters - fast-check parameters supplied by the
 *   caller; numRuns is used as the CI run count, and an explicit
 *   seed overrides the pinned one
 * @returns parameters with numRuns, seed and endOnFailure set for
 *   the active mode
 */
export function fuzzParameters<T>(parameters: Parameters<T>): Parameters<T> {
  return {
    ...parameters,
    numRuns: FUZZING ? Number.POSITIVE_INFINITY : parameters.numRuns,
    seed: FUZZING ? undefined : (parameters.seed ?? CI_SEED),
    endOnFailure: FUZZING,
  };
}
