/**
 * The address count's exit-code contract, driven over the real
 * repository: the two sources agree today, an unknown argument is a
 * harness failure rather than a shrug, and asking for help is not an
 * error.
 *
 * Driven over `spawnSync` like the other CLI contract suites, because
 * what is being asserted is the CODE a shell reads, and a script whose
 * decisions all sit at the top level has no other entry point.
 */
import { describe, expect, test } from "vitest";
import { CANNOT_RUN, runCli } from "./cli-runner.js";

const SCRIPT = "scripts/parse-print-addresses.ts";

describe("the parse-to-print address count", () => {
  test("passes over this repository, where the two sources agree", () => {
    expect(runCli(SCRIPT, [])).toBe(0);
  });

  test("an unknown argument is a harness failure", () => {
    // A silently dropped argument would print a passing table for a
    // question nobody asked, which is the failure the 1/2 split of
    // the exit-code contract exists to make impossible.
    expect(runCli(SCRIPT, ["--everything"])).toBe(CANNOT_RUN);
  });

  test("asking for help passes", () => {
    expect(runCli(SCRIPT, ["--help"])).toBe(0);
  });
});
