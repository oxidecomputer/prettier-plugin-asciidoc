/**
 * Unit tests for `scripts/printer-reads.ts`: the command line, the
 * measured-nothing floor, and the exit-code decision.
 *
 * `verdict` is driven with the REAL tree and a perturbed
 * classification rather than with a planted tree, because what the
 * gate decides about is the classification and not the code: a row
 * moved back to the state issue #204 recorded is the exact mutation
 * the gate exists to catch, and running it against the real printer
 * is what makes the red a red about this repository. The scan's own
 * planted controls are `tests/scripts/fact-inventory-reads.test.ts`'s.
 */
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  EXEMPT,
  UNREAD_CLAIMS,
} from "../../scripts/fact-inventory-classification.js";
import {
  MINIMUM_READS,
  parseArguments,
  verdict,
} from "../../scripts/printer-reads.js";
import { inCheckout } from "../lib/checkout.js";
import { CANNOT_RUN, runCli } from "./cli-runner.js";

/** The repository root, from this test file's own location. */
const ROOT = path.resolve(import.meta.dirname, "../..");

/** One reason that asserts the printer does not read the field. */
const [UNREAD_CLAIM] = [...UNREAD_CLAIMS];

/** The gate, relative to the repository root. */
const SCRIPT = "scripts/printer-reads.ts";

describe("the verdict on the real checkout", () => {
  test("is clean under the classification the tree ships", () => {
    expect(verdict(ROOT, EXEMPT).kind).toBe("clean");
  });

  test("fails when a row claims the printer does not read what it reads", () => {
    // The state issue #204 found the census in, re-planted: the
    // printer reads Node.position in eight files, so a row saying it
    // does not is a claim the compiler refutes.
    const said = verdict(
      ROOT,
      new Map([...EXEMPT, ["Node.position", UNREAD_CLAIM]]),
    );
    expect(said.kind).toBe("failed");
    expect(said.kind === "failed" ? said.lines.join("\n") : "").toContain(
      "Node.position",
    );
  });

  test("fails when a reason asserts unreadness in its own words", () => {
    // The hole the claim-shape check closes. This spelling was a real
    // row's until this gate landed; the gate cannot recognize it, so
    // a row wearing it would be a claim nothing held.
    const said = verdict(
      ROOT,
      new Map([...EXEMPT, ["LinkNode.form", "own doc: unread"]]),
    );
    expect(said.kind).toBe("failed");
    expect(said.kind === "failed" ? said.lines.join("\n") : "").toContain(
      "LinkNode.form",
    );
  });

  test("cannot run when no row makes a claim to check", () => {
    // Not a pass: a classification that asserts nothing about reads
    // is one this gate proved nothing about, and the 1/2 split exists
    // so those two do not read the same.
    const said = verdict(ROOT, new Map([["Node.type", "type discriminant"]]));
    expect(said.kind).toBe("cannot-run");
  });
});

describe("the measured-nothing floor", () => {
  test("cannot run on a tree that resolves almost no reads", () => {
    // A tree whose printer reads one field is a scan that lost its
    // program, not a printer that reads nothing, and reporting "every
    // claim held" from it would be the green tick the floor exists to
    // refuse.
    const said = inCheckout(
      {
        "src/ast.ts": "export interface PlantedNode {\n  line: string;\n}\n",
        "src/print/planted.ts": [
          'import type { PlantedNode } from "../ast.js";',
          "",
          "export function print(node: PlantedNode): string {",
          "  return node.line;",
          "}",
          "",
        ].join("\n"),
      },
      (root) => verdict(root, new Map([["PlantedNode.line", UNREAD_CLAIM]])),
    );
    expect(said.kind).toBe("cannot-run");
    expect(said.kind === "cannot-run" ? said.message : "").toContain(
      String(MINIMUM_READS),
    );
  });
});

describe("the command line", () => {
  test("takes --list and nothing else", () => {
    expect(parseArguments([])).toBe(false);
    expect(parseArguments(["--list"])).toBe(true);
    expect(() => parseArguments(["--all"])).toThrow("--all");
  });

  test("an unrecognized argument exits 2, not 1 and not 0", () => {
    expect(runCli(SCRIPT, ["--all"])).toBe(CANNOT_RUN);
  });

  test("--help exits 0", () => {
    expect(runCli(SCRIPT, ["--help"])).toBe(0);
  });
});
