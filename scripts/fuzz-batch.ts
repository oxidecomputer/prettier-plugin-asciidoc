#!/usr/bin/env bun
/* eslint-disable @typescript-eslint/no-magic-numbers, no-console -- runner script, not library code */

/**
 * Batch fuzz runner: runs a fuzz test many times with different seeds,
 * collecting counterexamples from failures.
 *
 * Usage: bun scripts/fuzz-batch.ts <test-name-pattern>
 */

import process from "node:process";

const cliArguments = process.argv.slice(2);
if (cliArguments.length === 0) {
  console.error("Usage: bun scripts/fuzz-batch.ts <test-name-pattern>");
  process.exit(1);
}
const [testPattern] = cliArguments;

const OUTDIR = "/tmp/fuzz-results";
const TARGET_FAILURES = 1000;
const PARALLEL = 15;

await Bun.$`mkdir -p ${OUTDIR}`;

console.log(
  `Collecting ${TARGET_FAILURES} failures for "${testPattern}", ${PARALLEL} in parallel...`,
);
console.log(`Results in ${OUTDIR}`);

let completed = 0;
let failures = 0;
let runId = 0;

/** Run a single fuzz test with a random seed, saving output on failure. */
async function runOne(): Promise<void> {
  runId += 1;
  const id = runId;
  const seed = Math.floor(Math.random() * 2 ** 32);
  const outfile = `${OUTDIR}/run-${id}.txt`;

  const proc = Bun.spawn(
    [
      "bun",
      "vitest",
      "run",
      "tests/format/fuzz.test.ts",
      "-t",
      testPattern,
      "--reporter=verbose",
    ],
    {
      env: { ...process.env, FC_SEED: String(seed) },
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    await Bun.write(outfile, stdout + stderr);
    await Bun.write(`${OUTDIR}/run-${id}.seed`, String(seed));
    failures += 1;
    console.log(`FAIL run ${id} (seed=${seed})`);
  }

  completed += 1;
}

let batch = 0;
while (failures < TARGET_FAILURES) {
  batch += 1;
  const batchSize = Math.min(PARALLEL, TARGET_FAILURES - failures);
  // eslint-disable-next-line no-await-in-loop -- intentional batching
  await Promise.all(
    Array.from({ length: batchSize }, async () => {
      await runOne();
    }),
  );
  console.log(
    `Batch ${batch}: ${completed} completed, ${failures}/${TARGET_FAILURES} failures`,
  );
}

console.log();
console.log("=== SUMMARY ===");
console.log(`Total runs: ${completed}`);
console.log(`Failures: ${failures}/${TARGET_FAILURES}`);
console.log(`Results in: ${OUTDIR}`);
