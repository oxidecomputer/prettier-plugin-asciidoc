/**
 * The shape-differential's exit-code contract: 0 explained and
 * proved, 1 a proof failed or a diff is unexplained, 2 the harness
 * could not run.
 */
import { describe, expect, it } from "vitest";
import { reportShortDump } from "../../scripts/shape-diff.js";
import {
  CANNOT_RUN,
  GATE_FAILED,
  runCli as runCliScript,
} from "./cli-runner.js";

/**
 * Run `body` with `process.stderr.write` captured, `process.exitCode`
 * restored afterwards. `cannotRun` (scripts/lib/cli.ts) writes its
 * explanation there and leaving a 2 behind would fail the whole
 * vitest process.
 * @param body - what to run
 * @returns everything the run wrote to stderr, and the exit code it
 *   left
 */
function captureExit(body: () => void): {
  stderr: string;
  exitCode: number | string | undefined;
} {
  const before = process.exitCode ?? undefined;
  const chunks: string[] = [];
  const real = process.stderr.write.bind(process.stderr);
  const capture = (chunk: string | Uint8Array): boolean => {
    chunks.push(
      typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
    );
    return true;
  };
  process.stderr.write = capture as typeof process.stderr.write;
  try {
    body();
  } finally {
    process.stderr.write = real;
  }
  const exitCode = process.exitCode ?? undefined;
  process.exitCode = before;
  return { stderr: chunks.join(""), exitCode };
}

/**
 * Run the real CLI and report the code a shell would read.
 * @param argv - the arguments after the script name
 * @returns the process exit code
 */
function runCli(argv: readonly string[]): number {
  return runCliScript("scripts/shape-diff.ts", argv);
}

describe("reportShortDump: the measured-nothing floor is cannot-run, not gate-failed", () => {
  // A short base dump proves nothing about this checkout either way -
  // it is the same class as an unknown revision, not a difference the
  // code introduced - so it must leave the SAME exit code an unknown
  // `--base` does, and a different one than an explained diff does.
  it("exits 2, names what was missing, and does not read as a gate failure", () => {
    const dumped = new Map([["kept/a/plain", "out"]]);
    const shapes = [
      { id: "kept/a/plain", input: "x", renderBlind: false },
      { id: "dropped/b/plain", input: "y", renderBlind: false },
    ];
    const { stderr, exitCode } = captureExit(() => {
      reportShortDump(dumped, shapes, ["dropped/b/plain"]);
    });
    expect(stderr).toContain("1 of 2 rows");
    expect(stderr).toContain("dropped/b/plain");
    expect(exitCode).toBe(CANNOT_RUN);
    expect(exitCode).not.toBe(GATE_FAILED);
  });
});

describe("the runner's exit-code contract", () => {
  it("exits 2 on a --base revision git does not have", () => {
    // No materialized checkout, no dump, nothing measured - the same
    // cannot-run floor as a short dump, reached the way a real
    // invocation would: through the CLI, not the reporter directly.
    expect(runCli(["--base", "not-a-real-revision-ppa-shape-diff-test"])).toBe(
      CANNOT_RUN,
    );
  });
});
