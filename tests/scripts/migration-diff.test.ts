/**
 * The migration differential's exit-code contract, in particular the
 * measured-nothing floor: a comparison tree that threw on every
 * document must not report as agreement.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../scripts/lib/checkout.js";

/** The exit code a harness that could not run has to produce. */
const CANNOT_RUN = 2;

/** The exit code a gate that failed has to produce. */
const GATE_FAILED = 1;

/**
 * Write a stand-in checkout for `--reference` or `--baseline` to
 * format the domain in.
 *
 * The differential reaches another tree through that tree's own
 * `tests/helpers.js` (see `scripts/lib/tree-format.ts`), so a
 * directory holding one IS a reference as far as the run is
 * concerned.
 * @param formatBody - the body of the stand-in `formatAdoc`
 * @returns the checkout root
 */
function writeStandInCheckout(formatBody: string): string {
  const root = mkdtempSync(path.join(tmpdir(), "migration-diff-stand-in-"));
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "stand-in", private: true, type: "module" }),
  );
  mkdirSync(path.join(root, "tests"));
  writeFileSync(
    path.join(root, "tests", "helpers.js"),
    `export async function formatAdoc(source) {\n${formatBody}\n}\n`,
  );
  return root;
}

/**
 * Run the real CLI and report the code a shell would read.
 * @param argv - the arguments after the script name
 * @returns the process exit code
 */
function runCli(argv: readonly string[]): number {
  const result = spawnSync("bun", ["scripts/migration-diff.ts", ...argv], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return result.status ?? -1;
}

describe("the runner's exit-code contract", () => {
  it("exits 2 on a domain it does not have", () => {
    expect(runCli(["--domain", "nope"])).toBe(CANNOT_RUN);
  });

  it("exits 0 for --domain directive with no comparison tree", () => {
    // The floor below must not fire on the candidate-only run: there
    // is nothing to measure short against when nothing was asked to
    // be compared.
    expect(runCli(["--domain", "directive"])).toBe(0);
  });

  it("exits 2 when the reference threw on every document", () => {
    // The floor #93 adds: a reference that cannot format at all has
    // every document in its own failing set, so the directional
    // bucket the gate reads (other renders as source and candidate
    // does not) is empty by construction - a green tick, or under
    // --gate a false pass, over a tree that measured nothing.
    const root = writeStandInCheckout(
      '  throw new Error("no formatter here");',
    );
    try {
      expect(
        runCli(["--domain", "directive", "--reference", root, "--gate"]),
      ).toBe(CANNOT_RUN);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("exits 1 under --gate when a real reference renders where the candidate does not, and the reference measured something", () => {
    // Distinguishes the new floor from the existing gate: a reference
    // that returns its input unchanged measures every document (it
    // never throws), and its output is a fixed point that always
    // renders as its source - so this checkout's own failing set
    // drives the gate, not the measured-nothing floor.
    const root = writeStandInCheckout("  return source;");
    try {
      expect(
        runCli(["--domain", "directive", "--reference", root, "--gate"]),
      ).toBe(GATE_FAILED);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
