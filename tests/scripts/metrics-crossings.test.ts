/**
 * The crossings registry: what counts as a crossing, what the registry
 * file must look like, and both directions of the membership gate.
 *
 * The two directions are the whole point. A registry that only fails
 * on an UNREGISTERED crossing becomes folklore the moment a coupling
 * is deleted; one that only fails on a STALE row cannot stop a new
 * coupling arriving unargued. Every gate test below plants a real
 * checkout — `src` files and a registry file — because the thing under
 * test is the agreement between the two.
 */
import { describe, test, expect } from "vitest";
import {
  crossings,
  readCrossings,
  readCrossingsRegistry,
} from "../../scripts/metrics/crossings.js";
import { REPO_ROOT } from "../../scripts/metrics/model.js";
import { gateFailures } from "../../scripts/metrics/gates.js";
import { makeSnapshot } from "./metrics-snapshot.js";
import { inCheckout } from "../lib/checkout.js";

/**
 * Run a check over a throwaway checkout: `src` files plus, optionally,
 * a crossings registry.
 * @param files - path under `src` to contents, subdirectories allowed
 * @param registry - the registry file's exact text, when there is one
 * @param read - what to measure
 * @returns whatever `read` returned
 */
function overCheckout<T>(
  files: Record<string, string>,
  registry: string | undefined,
  read: (root: string) => T,
): T {
  return inCheckout(
    {
      ...Object.fromEntries(
        Object.entries(files).map(([name, contents]) => [
          `src/${name}`,
          contents,
        ]),
      ),
      ...(registry === undefined
        ? {}
        : { "scripts/metrics/crossings-registry.json": registry }),
    },
    read,
  );
}

/** One registry row for `a/one.ts`'s `X`, as `b/two.ts` imports it. */
const ROW = {
  file: "src/a/one.ts",
  symbol: "X",
  importer: "src/b/two.ts",
  kind: "vocabulary",
  reason: "the shape the two agree on",
};

// The tree the membership tests plant: one crossing, and nothing else.
const TREE = {
  "a/one.ts": "export interface X {\n  x: number;\n}\n",
  "b/two.ts":
    'import type { X } from "../a/one.js";\nexport const two = (x: X): X => x;\n',
};

describe("what counts as a crossing", () => {
  test("a cross-directory import, resolved through the .js specifier", () => {
    expect(overCheckout(TREE, undefined, crossings)).toEqual([
      { file: "src/a/one.ts", symbol: "X", importer: "src/b/two.ts" },
    ]);
  });

  test("a same-directory import is not a crossing", () => {
    const found = overCheckout(
      {
        "a/one.ts": "export interface X {\n  x: number;\n}\n",
        "a/two.ts":
          'import type { X } from "./one.js";\nexport const two = (x: X): X => x;\n',
      },
      undefined,
      crossings,
    );
    expect(found).toEqual([]);
  });

  // Declared universal vocabulary: the AST, the constants and the
  // can't-happen helper are the language of the whole tree, so their
  // crossings would bury the ones that are a decision.
  test("an import of declared universal vocabulary is exempt", () => {
    const found = overCheckout(
      {
        "ast.ts": "export interface Node {\n  kind: string;\n}\n",
        "b/two.ts":
          'import type { Node } from "../ast.js";\nexport const two = (n: Node): Node => n;\n',
      },
      undefined,
      crossings,
    );
    expect(found).toEqual([]);
  });

  // A re-export is the shape a "removed coupling" hides behind: the
  // symbol still crosses, so it still needs a row.
  test("a re-export crosses under the name it re-exports", () => {
    const found = overCheckout(
      {
        "a/one.ts": "export interface X {\n  x: number;\n}\n",
        "b/two.ts": 'export type { X } from "../a/one.js";\n',
      },
      undefined,
      crossings,
    );
    expect(found).toEqual([
      { file: "src/a/one.ts", symbol: "X", importer: "src/b/two.ts" },
    ]);
  });

  test("the symbol is the DECLARING file's name, not the local alias", () => {
    const found = overCheckout(
      {
        "a/one.ts": "export interface X {\n  x: number;\n}\n",
        "b/two.ts":
          'import type { X as Local } from "../a/one.js";\nexport const two = (x: Local): Local => x;\n',
      },
      undefined,
      crossings,
    );
    expect(found.map((crossing) => crossing.symbol)).toEqual(["X"]);
  });
});

describe("the registry file", () => {
  test.each([
    ["is missing", undefined, "not found"],
    ["is not JSON", "{oops", "not valid JSON"],
    ["is not an array", '{"file":"a"}', "not a JSON array"],
    ["carries an unknown key", '[{"typo":1}]', "unknown key(s) typo"],
    [
      "is missing a field",
      '[{"file":"src/a/one.ts","symbol":"X","importer":"src/b/two.ts","kind":"vocabulary"}]',
      "missing or non-string reason",
    ],
    [
      "carries a classification that is neither",
      `[${JSON.stringify({ ...ROW, kind: "misc" })}]`,
      "kind must be one of vocabulary, contract",
    ],
  ])("faults when it %s", (_name, registry, detail) => {
    const read = overCheckout(TREE, registry, readCrossingsRegistry);
    expect(read.entries).toBeUndefined();
    expect(read.faults.join("\n")).toContain(detail);
  });

  test("reads a well-formed row", () => {
    const read = overCheckout(
      TREE,
      JSON.stringify([ROW]),
      readCrossingsRegistry,
    );
    expect(read.faults).toEqual([]);
    expect(read.entries).toEqual([ROW]);
  });
});

describe("the membership gate, in both directions", () => {
  test("a registered crossing is clean", () => {
    const facts = overCheckout(TREE, JSON.stringify([ROW]), readCrossings);
    expect(facts).toMatchObject({
      registered: 1,
      unregistered: [],
      stale: [],
      faults: [],
    });
  });

  test("a crossing with no row is unregistered", () => {
    const facts = overCheckout(TREE, "[]", readCrossings);
    expect(facts.unregistered).toEqual(["src/a/one.ts X -> src/b/two.ts"]);
    expect(facts.stale).toEqual([]);
  });

  // The staleness half, proved by DELETING the import the row names:
  // the registry must not survive the coupling it describes.
  test("a row whose import is gone is stale", () => {
    const facts = overCheckout(
      { "a/one.ts": TREE["a/one.ts"] },
      JSON.stringify([ROW]),
      readCrossings,
    );
    expect(facts.stale).toEqual(["src/a/one.ts X -> src/b/two.ts"]);
    expect(facts.unregistered).toEqual([]);
  });
});

// A `contract` row must name a seam a class actually satisfies. The
// registry's own header has said so since it was written, and until a
// review caught two pure functions filed as contracts nothing checked
// it: the enum test alone lets the classification mean whatever the
// row's author felt. Both directions are planted, because a gate that
// only refuses is as useless here as a membership list that cannot
// rot.
describe("a contract row must name something implemented", () => {
  test("a pure function filed as a contract is a fault", () => {
    const facts = overCheckout(
      TREE,
      JSON.stringify([{ ...ROW, kind: "contract" }]),
      readCrossings,
    );
    expect(facts.faults.length).toBe(1);
    expect(facts.faults[0]).toContain("is filed as a contract");
    expect(facts.faults[0]).toContain("src/a/one.ts X -> src/b/two.ts");
    expect(facts.unregistered).toEqual([]);
    expect(facts.stale).toEqual([]);
  });

  test("a seam a class implements is clean", () => {
    const facts = overCheckout(
      {
        ...TREE,
        "b/three.ts": [
          'import type { X } from "../a/one.js";',
          "export class Three implements X {",
          "  x = 1;",
          "}",
        ].join("\n"),
      },
      JSON.stringify(
        [
          { ...ROW, kind: "contract" },
          { ...ROW, importer: "src/b/three.ts", kind: "contract" },
        ].toSorted((left, right) => (left.importer < right.importer ? -1 : 1)),
      ),
      readCrossings,
    );
    expect(facts.faults).toEqual([]);
  });
});

describe("this repository's own crossings", () => {
  test("every crossing is registered and every row is live", () => {
    const facts = readCrossings(REPO_ROOT);
    expect(facts.faults).toEqual([]);
    expect(facts.unregistered, facts.unregistered.join("\n")).toEqual([]);
    expect(facts.stale, facts.stale.join("\n")).toEqual([]);
  });
});

describe("what the gate does with the facts", () => {
  test.each([
    ["unregisteredCrossings", "unregistered cross-directory crossing"],
    ["staleCrossings", "stale crossings-registry row"],
  ] as const)("%s fails, naming the crossing", (field, message) => {
    const head = makeSnapshot({ [field]: ["src/a.ts X -> src/b/c.ts"] });
    expect(gateFailures(head)).toHaveLength(1);
    expect(gateFailures(head)[0]).toContain(message);
    expect(gateFailures(head)[0]).toContain("src/a.ts X -> src/b/c.ts");
  });

  // A registry that cannot be read must fail rather than go quiet: a
  // short read reports FEWER unregistered crossings, which is the one
  // direction that looks like progress.
  test("a registry that cannot be read fails on its own", () => {
    const head = makeSnapshot({ crossingFaults: ["not valid JSON"] });
    expect(gateFailures(head)).toHaveLength(1);
    expect(gateFailures(head)[0]).toContain("could not be read");
  });

  // Same tolerance every hand-maintained registry here gets: an
  // archived `--base` revision and a `--root <dir>` checkout are
  // MEASURED by this gate and not judged by it.
  test("a foreign checkout is not judged by our registry", () => {
    const head = makeSnapshot({
      repository: false,
      unregisteredCrossings: ["src/a.ts X -> src/b/c.ts"],
      crossingFaults: ["not found"],
    });
    expect(gateFailures(head)).toEqual([]);
  });
});
