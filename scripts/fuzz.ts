#!/usr/bin/env bun
/* eslint-disable no-console -- runner script, not library code */

/**
 * Continuous fuzz-test runner. Discovers all fuzz tests via
 * `vitest list`, then spawns each as a separate process so
 * they run truly in parallel. When any process exits non-zero,
 * all others are killed and the exit code is propagated.
 *
 * Usage: bun scripts/fuzz.ts
 */

import { $ } from "bun";

const FUZZ_GLOBS = ["tests/parser/fuzz.test.ts", "tests/format/fuzz.test.ts"];

// Discover individual test names from vitest.
// Output format: "file > suite > test name" (one per line).
const listing = await $`bun vitest list ${FUZZ_GLOBS}`.text();
const tests = listing
  .trim()
  .split("\n")
  .filter((line) => line.includes(" > "))
  .map((line) => {
    const parts = line.split(" > ");
    const [file] = parts;
    // vitest list gives "file > suite > test", but
    // --testNamePattern matches against "suite test" (space
    // separated, no ">"). Use just the final test name to
    // avoid separator mismatch.
    const name = parts.at(-1) ?? line;
    return { file, name };
  });

if (tests.length === 0) {
  console.error("No fuzz tests discovered.");
  process.exit(1);
}

console.log(`Spawning ${tests.length} fuzz processes:\n`);
for (const t of tests) {
  console.log(`  ${t.file} > ${t.name}`);
}
console.log();

// Spawn each test as its own vitest process.
const procs = tests.map(({ file, name }) =>
  Bun.spawn(
    [
      "bun",
      "vitest",
      "run",
      "--testNamePattern",
      // Anchor so we match exactly this test.
      // Anchor at end only — vitest prepends the describe suite
      // name, so ^-anchoring would require the file path prefix.
      `${name.replaceAll(/[^\w\s]/gv, String.raw`\$&`)}$`,
      "--testTimeout=0",
      file,
    ],
    {
      env: { ...process.env, FUZZ: "1" },
      stdout: "inherit",
      stderr: "inherit",
    },
  ),
);

// Kill each spawned process and its entire process group (the
// vitest workers are descendants that plain proc.kill() misses).
const killAll = (): void => {
  for (const proc of procs) {
    try {
      process.kill(-proc.pid, "SIGKILL");
    } catch {
      /* already dead */
    }
  }
};
process.on("exit", killAll);

// Wait for the first process to exit.
const result = await Promise.race(
  procs.map(async (proc, procIndex) => {
    const code = await proc.exited;
    return { code, index: procIndex, test: tests[procIndex] };
  }),
);

if (result.code !== 0) {
  console.error(`\nFuzz failure in: ${result.test.name}`);
}

process.exit(result.code);
