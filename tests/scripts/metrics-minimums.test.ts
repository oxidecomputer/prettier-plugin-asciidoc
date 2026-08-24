/**
 * The two W9 registries, tested the way every other registry in
 * `scripts/metrics/` is: against throwaway checkouts holding exactly
 * the bytes under test.
 *
 * Both are UNDERCOUNT gates — a minimums file that lost a row and a
 * quarantine manifest that grew both report FEWER problems — so the
 * cases that matter are the ones where a naive reader would see
 * nothing wrong: a file with no recorded minimum, a row naming code
 * that is gone,
 * a manifest that drifted away from its pin in either direction.
 */
import { describe, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readConformance } from "../../scripts/metrics/conformance.js";
import {
  compareMinimums,
  roundDown,
  minimumsStaleness,
  readMinimums,
  readMinimumsFacts,
  type Minimums,
} from "../../scripts/metrics/score-minimums.js";
import { gateFailures } from "../../scripts/metrics/gates.js";
import { makeSnapshot } from "./metrics-snapshot.js";

/**
 * Run a reader against a throwaway checkout holding the given files.
 * @param files - repo-relative path to contents; a path that is
 *   omitted is a file that is not there at that revision
 * @param read - what to ask of that checkout
 * @returns whatever the reader returned
 */
function inCheckout<T>(
  files: Record<string, string>,
  read: (root: string) => T,
): T {
  const root = mkdtempSync(path.join(tmpdir(), "metrics-minimums-"));
  try {
    for (const [name, contents] of Object.entries(files)) {
      const full = path.join(root, name);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, contents);
    }
    return read(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** A minimums file with one file row and one exception. */
const GOOD_MINIMUMS = JSON.stringify({
  note: "why this file exists",
  files: { "src/a.ts": { coverage: 98.5, mutation: 91.2 } },
  exceptions: [
    {
      file: "src/a.ts",
      what: "the type-forced default arm",
      class: "never",
      reason: "no value inhabits it",
    },
  ],
});

/**
 * Read a minimums file out of a throwaway checkout.
 * @param contents - the file's bytes; omitted omits the file
 * @returns what `readMinimums` made of it
 */
function readFixtureMinimums(
  contents?: string,
): ReturnType<typeof readMinimums> {
  return inCheckout(
    contents === undefined
      ? {}
      : { "scripts/metrics/score-minimums.json": contents },
    readMinimums,
  );
}

describe("the minimums file", () => {
  test("reads its rows and its exceptions", () => {
    const { minimums, faults } = readFixtureMinimums(GOOD_MINIMUMS);
    expect(faults).toEqual([]);
    expect(minimums?.files.get("src/a.ts")).toEqual({
      coverage: 98.5,
      mutation: 91.2,
    });
    expect(minimums?.exceptions).toHaveLength(1);
  });

  // A MISSING file is silence rather than a fault here, which is what
  // lets an archived base ratchet from absent. `readMinimumsFacts` is
  // where HEAD's "there must be one" lives.
  test("is silence when it is not there at all", () => {
    expect(readFixtureMinimums()).toEqual({ minimums: undefined, faults: [] });
  });

  test("faults when HEAD has no minimums file", () => {
    const { recorded, faults } = inCheckout({}, (root) =>
      readMinimumsFacts(root, []),
    );
    expect(recorded).toBeUndefined();
    expect(faults.join("\n")).toContain("not found");
  });

  test.each([
    ["not JSON at all", "{"],
    ["not an object", "[]"],
    ["an unknown top-level key", '{"files":{},"exceptions":[],"flor":1}'],
    [
      "a row that is not an object",
      '{"files":{"src/a.ts":98},"exceptions":[]}',
    ],
    [
      "a row with an unknown key",
      '{"files":{"src/a.ts":{"coverage":1,"mutation":1,"branches":1}},"exceptions":[]}',
    ],
    [
      "a percentage out of range",
      '{"files":{"src/a.ts":{"coverage":101,"mutation":1}},"exceptions":[]}',
    ],
    [
      "an exception with an unknown class",
      '{"files":{},"exceptions":[{"file":"src/a.ts","what":"w","class":"someday","reason":"r"}]}',
    ],
    [
      "an exception with no reason",
      '{"files":{},"exceptions":[{"file":"src/a.ts","what":"w","class":"never","reason":""}]}',
    ],
  ])("refuses %s", (_what, contents) => {
    const { minimums, faults } = readFixtureMinimums(contents);
    // A malformed row invalidates the COUNT, not just that row: a
    // short minimums file passes every comparison it no longer makes.
    expect(minimums).toBeUndefined();
    expect(faults.length).toBeGreaterThan(0);
  });

  test("rounds a measured percentage DOWN to a tenth", () => {
    // Up would make the very run that recorded the minimum fail it.
    expect(roundDown(98.65)).toBe(98.6);
    expect(roundDown(100)).toBe(100);
  });
});

/**
 * A minimums value built by hand, for the comparison tests.
 * @param rows - file path to its `[coverage, mutation]` minimums
 * @returns minimums holding exactly those rows and no exceptions
 */
function minimumsOf(rows: Record<string, [number, number]>): Minimums {
  return {
    files: new Map(
      Object.entries(rows).map(([file, [coverage, mutation]]) => [
        file,
        { coverage, mutation },
      ]),
    ),
    exceptions: [],
  };
}

describe("minimums staleness", () => {
  test("a source file with no row has no recorded minimum", () => {
    const stale = minimumsStaleness(minimumsOf({}), ["src/a.ts"]);
    expect(stale.join("\n")).toContain("src/a.ts has no recorded minimum");
  });

  test("a row naming code that is gone is stale", () => {
    const stale = minimumsStaleness(minimumsOf({ "src/gone.ts": [1, 1] }), []);
    expect(stale.join("\n")).toContain("stale row");
  });

  test("an exception naming code that is gone is stale", () => {
    const minimums: Minimums = {
      files: new Map(),
      exceptions: [
        { file: "src/gone.ts", what: "w", class: "never", reason: "r" },
      ],
    };
    expect(minimumsStaleness(minimums, []).join("\n")).toContain(
      "stale exception",
    );
  });

  test("says nothing when every row describes the tree", () => {
    expect(
      minimumsStaleness(minimumsOf({ "src/a.ts": [1, 1] }), ["src/a.ts"]),
    ).toEqual([]);
  });
});

describe("comparing a run against the minimums", () => {
  const minimums = minimumsOf({ "src/a.ts": [90, 90] });

  test("below the recorded minimum names both numbers", () => {
    const { below } = compareMinimums(
      minimums,
      "coverage",
      new Map([["src/a.ts", 89.9]]),
    );
    expect(below.join("\n")).toContain("89.9 is below its recorded minimum 90");
  });

  test("at the recorded minimum holds", () => {
    const { below, unmeasured } = compareMinimums(
      minimums,
      "mutation",
      new Map([["src/a.ts", 90]]),
    );
    expect(below).toEqual([]);
    expect(unmeasured).toEqual([]);
  });

  // Never a pass: "the report did not mention that file" is the shape
  // a scoped or crashed run takes.
  test("a recorded file the run never mentioned is unmeasured", () => {
    const { below, unmeasured } = compareMinimums(
      minimums,
      "coverage",
      new Map(),
    );
    expect(below).toEqual([]);
    expect(unmeasured.join("\n")).toContain("reported nothing for this file");
  });

  test("a whole point above asks for the minimum to be raised", () => {
    const { liftable } = compareMinimums(
      minimums,
      "coverage",
      new Map([["src/a.ts", 91.5]]),
    );
    expect(liftable.join("\n")).toContain("raise the recorded minimum");
  });

  test("a tenth above the recorded minimum is flap, not a lift", () => {
    const { liftable } = compareMinimums(
      minimums,
      "coverage",
      new Map([["src/a.ts", 90.1]]),
    );
    expect(liftable).toEqual([]);
  });
});

/**
 * Read a conformance pin out of a throwaway checkout.
 * @param quarantined - how many entries the manifest holds
 * @param pin - the pinned count; omitted omits the pin file
 * @returns what `readConformance` made of it
 */
function readFixturePin(
  quarantined: number,
  pin?: number,
): ReturnType<typeof readConformance> {
  const manifest: Record<string, unknown> = {};
  for (let index = 0; index < quarantined; index += 1) {
    manifest[`case#${String(index)}`] = { fails: ["fidelity"], issue: "#9" };
  }
  const files: Record<string, string> = {
    "tests/conformance/quarantine.json": JSON.stringify(manifest),
  };
  if (pin !== undefined) {
    files["scripts/metrics/conformance-pin.json"] = JSON.stringify({
      quarantined: pin,
      note: "why this pin exists",
    });
  }
  return inCheckout(files, readConformance);
}

describe("the conformance pin", () => {
  test("holds when the manifest is the pinned length", () => {
    const { quarantined, pin, faults } = readFixturePin(3, 3);
    expect([quarantined, pin]).toEqual([3, 3]);
    expect(faults).toEqual([]);
  });

  // The failure the pin exists for: `triage --write` grew the manifest.
  test("a manifest that GREW says a case was quarantined", () => {
    const { faults } = readFixturePin(4, 3);
    expect(faults.join("\n")).toContain("QUARANTINED");
    expect(faults.join("\n")).toContain("move the pin");
  });

  // The other direction is not a failure of the code, but leaving the
  // pin above the real count is slack a later re-quarantine slips into.
  test("a manifest that SHRANK says a case was fixed", () => {
    const { faults } = readFixturePin(2, 3);
    expect(faults.join("\n")).toContain("FIXED");
    expect(faults.join("\n")).toContain("Lower the pin");
  });

  test("no pin file at all is a gate that went quiet", () => {
    const { pin, faults } = readFixturePin(3);
    expect(pin).toBeUndefined();
    expect(faults.join("\n")).toContain("unpinned");
  });

  test("a manifest written as an array counts nothing, and says so", () => {
    const { quarantined, faults } = inCheckout(
      { "tests/conformance/quarantine.json": "[]" },
      readConformance,
    );
    expect(quarantined).toBeUndefined();
    expect(faults.join("\n")).toContain("keyed by case id");
  });
});

describe("both faults reach the scorecard's gates", () => {
  test("a conformance fault fails the run", () => {
    expect(
      gateFailures(makeSnapshot({ conformanceFaults: ["the pin moved"] })),
    ).toContain("the pin moved");
  });

  test("a minimums fault fails the run", () => {
    expect(
      gateFailures(
        makeSnapshot({ minimumFaults: ["src/a.ts has no recorded minimum"] }),
      ),
    ).toContain("src/a.ts has no recorded minimum");
  });

  // Repository-scoped, like every other registry check: an archived
  // base and a `--root <dir>` checkout are measured, not judged.
  test("neither is judged on a checkout that is not this repository", () => {
    expect(
      gateFailures(
        makeSnapshot({
          repository: false,
          conformanceFaults: ["the pin moved"],
          minimumFaults: ["no recorded minimum"],
        }),
      ),
    ).toEqual([]);
  });
});
