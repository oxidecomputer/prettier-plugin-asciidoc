/**
 * The three design-quality budgets: seam width, the defense inventory,
 * and agreement harnesses.
 *
 * These are budgets the repository MAINTAINS, not numbers a tool
 * discovers, so what needs pinning is different in kind from the rest
 * of the scorecard: the COUNTING RULE (which interface members are
 * shared vocabulary, which mentions of a marker are defenses), the
 * registry's own freshness, and each gate's direction. See
 * `docs/simplicity-metrics.md`, "Design-quality budgets".
 */
import { describe, test, expect } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  readDesign,
  readRegistry,
  scanSeam,
  staleEntries,
} from "../../scripts/metrics/design.js";
import { gateFailures } from "../../scripts/metrics/gates.js";
import { REPO_ROOT } from "../../scripts/metrics/model.js";
import { scanSource } from "../../scripts/metrics/scan.js";
import { makeSnapshot, seam } from "./metrics-snapshot.js";

/**
 * Scan a snippet as if it were a source file.
 * @param text - the snippet
 * @returns the counts
 */
function scan(text: string): ReturnType<typeof scanSource> {
  return scanSource("sample.ts", text);
}

/**
 * Every `.ts` file below a directory, recursively.
 * @param directory - directory to walk
 * @returns absolute paths
 */
function sourceFilesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFilesUnder(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

/**
 * Every wrapped marker under `src`, as `file:line: marker`.
 *
 * The gate checks this too, but only when `bun run metrics` runs; the
 * suite is where a rewrap gets caught in the same breath as the edit.
 * @returns one string per wrapped marker; empty is the passing state
 */
function wrappedMarkersInSource(): string[] {
  const found: string[] = [];
  for (const file of sourceFilesUnder(path.join(REPO_ROOT, "src"))) {
    const { markerNearMisses } = scanSource(file, readFileSync(file, "utf8"));
    for (const where of markerNearMisses) {
      found.push(`${path.relative(REPO_ROOT, file)}:${where}`);
    }
  }
  return found;
}

/**
 * Read a registry out of a throwaway checkout holding exactly the given
 * file contents, or holding no registry at all.
 * @param contents - the registry file's bytes; omitted omits the file
 * @returns what `readRegistry` made of it
 */
function readFixtureRegistry(
  contents?: string,
): ReturnType<typeof readRegistry> {
  const root = mkdtempSync(path.join(tmpdir(), "metrics-registry-"));
  try {
    mkdirSync(path.join(root, "scripts", "metrics"), { recursive: true });
    if (contents !== undefined) {
      writeFileSync(
        path.join(root, "scripts", "metrics", "defense-registry.json"),
        contents,
      );
    }
    return readRegistry(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("seam width", () => {
  test.each([
    ["one property", "export interface S {\n  a: number;\n}\n", 1],
    [
      "a method signature",
      "export interface S {\n  a: number;\n  m(x: number): void;\n}\n",
      2,
    ],
    [
      "an arrow-typed member, which is one member not two",
      "export interface S {\n  readonly f: (x: number) => void;\n}\n",
      1,
    ],
    [
      "a nested type literal's fields, which are not shared by name",
      "export interface S {\n  a: { b: number; c: number } | undefined;\n}\n",
      1,
    ],
    [
      "a member's parameter object, reached through a counted member",
      "export interface S {\n  readonly f: (o: { a: number; b: number }) => void;\n}\n",
      1,
    ],
    [
      "an index signature, which is not a named member",
      "export interface S {\n  [key: string]: number;\n}\n",
      0,
    ],
    ["an empty interface", "export interface S {}\n", 0],
    [
      "an unexported interface, since a seam is named not published",
      "interface S {\n  a: number;\n}\n",
      1,
    ],
  ])("counts %s", (_name, text, members) => {
    expect(scanSeam("sample.ts", text, "S")).toEqual({
      members,
      fault: undefined,
    });
  });

  test.each([
    ["a file that declares no interface at all", "export const a = 1;\n"],
    ["a different interface", "export interface Other {\n  a: number;\n}\n"],
    [
      "a type alias of the same name, which has no members to count",
      "export type S = { a: number };\n",
    ],
  ])("reports absent for %s, so it ratchets from absent", (_name, text) => {
    expect(scanSeam("sample.ts", text, "S")).toEqual({
      members: undefined,
      fault: undefined,
    });
  });

  // A named seam must be ONE FLAT declaration. Both shapes below are
  // reachable by an ordinary refactor and both would report FEWER
  // members than a human counting the surface — which a rise-only
  // ratchet reads as progress. Refusing to measure them is the only
  // honest answer a scanner (as opposed to a type-checker) can give.
  test.each([
    [
      "extends, whose inherited members would go uncounted",
      "interface B {\n  b: number;\n}\nexport interface S extends B {\n  a: number;\n}\n",
      "extends another type",
    ],
    [
      "two declarations, which TypeScript merges",
      "export interface S {\n  a: number;\n}\nexport interface S {\n  b: number;\n  c: number;\n}\n",
      "has 2 declarations",
    ],
  ])("refuses to measure a seam that %s", (_name, text, detail) => {
    const scanned = scanSeam("frames.ts", text, "S");
    expect(scanned.members).toBeUndefined();
    expect(scanned.fault).toContain(detail);
    expect(scanned.fault).toContain("one flat declaration");
  });

  // The shipped seams have to satisfy the flatness rule they impose.
  test("every named seam is flat, single, and declared where SEAMS says", () => {
    for (const shipped of readDesign(REPO_ROOT).seams) {
      expect(shipped.fault, shipped.name).toBeUndefined();
      expect(shipped.members, shipped.name).toBeGreaterThan(0);
    }
  });
});

describe("defense marker counting", () => {
  const none = { callerContract: 0, totalFallback: 0, validOnlyWhen: 0 };

  test.each([
    [
      "a line comment",
      "// Total fallback: why\ncode();\n",
      { ...none, totalFallback: 1 },
    ],
    [
      "a JSDoc block",
      "/** Valid only when `x` is set. */\nlet a: number;\n",
      { ...none, validOnlyWhen: 1 },
    ],
    [
      "a precondition marker",
      "/**\n * Caller contract: `x` is non-empty.\n */\nfunction f(): void {}\n",
      { ...none, callerContract: 1 },
    ],
    [
      "two markers in one comment, since each is a defended site",
      "/**\n * Valid only when `f` is a.\n * Valid only when `f` is b.\n */\nlet a: number;\n",
      { ...none, validOnlyWhen: 2 },
    ],
    [
      "no marker at all",
      "// an ordinary comment about a fallback\ncode();\n",
      none,
    ],
    [
      "a marker spelled in a string literal, which is not a comment",
      'const s = "Total fallback: not a comment";\n',
      none,
    ],
    // The marker has to be on ONE line: the count is over comment
    // text, so an 80-column wrap that splits it hides the defense.
    // Pinned so nobody "fixes" the counter into matching across lines
    // without deciding to.
    [
      "a marker broken across two comment lines, which is invisible",
      "/**\n * Valid only\n * when `f` is a.\n */\nlet a: number;\n",
      none,
    ],
  ])("counts %s", (_name, text, expected) => {
    expect(scan(text).markers).toEqual(expected);
  });

  // The near-miss detector. The counting hazard it closes is
  // one-directional and therefore silent: the ratchet fires on RISE, so
  // a marker that STOPS being counted reads as progress. Detection is a
  // comparison — count the marker as written, then again with the
  // comment's line breaks collapsed — so it needs no second pattern to
  // keep in step with DEFENSE_MARKERS.
  test.each([
    [
      "a JSDoc wrap, asterisk and all",
      "/**\n * Valid only\n * when `f` is a.\n */\nlet a: number;\n",
      ["1: Valid only when"],
    ],
    [
      "a line-comment wrap with no asterisk",
      "// Total\n// fallback: why\ncode();\n",
      ["1: Total fallback:"],
    ],
    [
      "a wrap in a comment that also holds an intact marker",
      "/**\n * Valid only when `f` is a.\n * Valid only\n * when `f` is b.\n */\nlet a: number;\n",
      ["1: Valid only when"],
    ],
  ])("catches %s", (_name, text, expected) => {
    expect(scan(text).markerNearMisses).toEqual(expected);
  });

  test.each([
    ["an intact marker", "// Total fallback: why\ncode();\n"],
    ["no marker at all", "// ordinary prose about a fallback\ncode();\n"],
    [
      "prose that merely wraps near the words",
      "/**\n * The fallback is total, and only\n * when it fires does it matter.\n */\nlet a: number;\n",
    ],
    [
      "a marker at a line end followed by unrelated prose",
      "/**\n * Valid only when `f` is a.\n * Something else entirely.\n */\nlet a: number;\n",
    ],
  ])("does not fire on %s", (_name, text) => {
    expect(scan(text).markerNearMisses).toEqual([]);
  });

  // Zero false positives over the shipped tree is what makes this a
  // hard gate rather than a warning, and this is the assertion that
  // fails the day someone rewraps one of the shipped markers. Two of
  // the five `Valid only when` markers sit flush at their line end, so
  // the slack is nil.
  test("no marker under src is wrapped today", () => {
    expect(wrappedMarkersInSource()).toEqual([]);
  });

  // Ruling 34: an `unreachable(` text search would count the one
  // comment under `src` that names the function while explaining why a
  // nearby site is a silent strip instead.
  test.each([
    ["a call", "unreachable(`no`);\n", 1],
    ["a call inside a `??`", "const a = b ?? unreachable(`no`);\n", 1],
    ["two calls", "unreachable(`a`);\nunreachable(`b`);\n", 2],
    ["a comment naming it", "// not an `unreachable()` assertion\n", 0],
    ["a string naming it", 'const s = "unreachable(x)";\n', 0],
    ["an import of it", 'import { unreachable } from "./u.js";\n', 0],
  ])("counts %s", (_name, text, expected) => {
    expect(scan(text).unreachableCalls).toBe(expected);
  });
});

describe("the interior-validation registry", () => {
  const reason = "why it is interior validation";

  // The audited count, as a LITERAL. Comparing it to
  // `readRegistry(...).length` would restate `readDesign`'s own
  // definition and pass with no registry at all, which is exactly the
  // hole this replaces: the number has to be changed BY HAND, as part
  // of deciding that a site was added or designed away.
  const SHIPPED_ENTRIES = 4;

  test("the shipped registry reads, holds its audited count, and is current", () => {
    const { entries, faults } = readRegistry(REPO_ROOT);
    expect(faults).toEqual([]);
    expect(entries).toBeDefined();
    expect(entries).toHaveLength(SHIPPED_ENTRIES);
    const design = readDesign(REPO_ROOT);
    expect(design.interiorValidation).toBe(SHIPPED_ENTRIES);
    expect(design.staleEntries).toEqual([]);
    expect(design.registryFaults).toEqual([]);
  });

  // Tamper case: the freshness net has to FIRE, not merely be green on
  // a healthy tree. An entry naming a function nothing declares is the
  // rot the gate exists for.
  test("tampering with an entry's function name fires the staleness gate", () => {
    const tampered = staleEntries(REPO_ROOT, [
      {
        file: "src/parse/inline/rules.ts",
        function: "isBoundaryyy",
        reason,
      },
    ]);
    expect(tampered).toEqual(["src/parse/inline/rules.ts: isBoundaryyy"]);
    const head = makeSnapshot({ staleEntries: tampered });
    expect(gateFailures(head)[0]).toContain("stale interior-validation");
  });

  // H1: a registry that is not there is not "nothing to measure", it
  // is a family that has been switched off. Ruling 36's rule for knip,
  // applied to a file.
  test("a missing registry is a fault, not a silent n/a", () => {
    const { entries, faults } = readFixtureRegistry();
    expect(entries).toBeUndefined();
    expect(faults).toEqual([
      "scripts/metrics/defense-registry.json: not found",
    ]);
    const head = makeSnapshot({ registryFaults: [...faults] });
    expect(gateFailures(head)[0]).toContain("could not be read");
  });

  // M4: `parseJson` (for tool stdout) would swallow every one of
  // these. A reviewed file in the repository gets strict parsing.
  test.each([
    ["empty bytes", "", "not valid JSON"],
    ["a syntax error", '[{"file": "a"', "not valid JSON"],
    ["leading noise before the array", "banner\n[]", "not valid JSON"],
    ["an object instead of an array", "{}", "not a JSON array"],
    ["a non-object element", '["a"]', "[0]: not an object"],
    [
      "a typo'd key",
      '[{"file": "a", "functon": "b", "reason": "c"}]',
      "unknown key(s) functon",
    ],
    [
      "a non-string field",
      '[{"file": "a", "function": 1, "reason": "c"}]',
      "missing or non-string function",
    ],
    [
      "an empty reason, which makes the entry a list row and not an audit",
      '[{"file": "a", "function": "b", "reason": ""}]',
      "missing or non-string reason",
    ],
    [
      "a missing field",
      '[{"file": "a", "function": "b"}]',
      "missing or non-string reason",
    ],
  ])("rejects %s", (_name, contents, detail) => {
    const { entries, faults } = readFixtureRegistry(contents);
    expect(entries).toBeUndefined();
    expect(faults).toHaveLength(1);
    expect(faults[0]).toContain(detail);
  });

  test("accepts a well-formed registry", () => {
    const { entries, faults } = readFixtureRegistry(
      '[{"file": "a.ts", "function": "b", "reason": "c"}]',
    );
    expect(faults).toEqual([]);
    expect(entries).toEqual([{ file: "a.ts", function: "b", reason: "c" }]);
  });

  // An empty array is a registry that says "no interior validation
  // left" — a legitimate end state, and distinct from a missing file.
  test("accepts an empty registry, which is not the same as no registry", () => {
    const { entries, faults } = readFixtureRegistry("[]");
    expect(faults).toEqual([]);
    expect(entries).toEqual([]);
  });

  test("an entry naming a function that exists is not stale", () => {
    expect(
      staleEntries(REPO_ROOT, [
        { file: "src/parse/build/list.ts", function: "buildList", reason },
      ]),
    ).toEqual([]);
  });

  test.each([
    [
      "the function is gone",
      { file: "src/parse/build/list.ts", function: "goneForever", reason },
      "src/parse/build/list.ts: goneForever",
    ],
    [
      "the file is gone",
      { file: "src/no-such-module.ts", function: "buildList", reason },
      "src/no-such-module.ts: buildList",
    ],
  ])("fails when %s, so the registry cannot rot", (_name, entry, expected) => {
    expect(staleEntries(REPO_ROOT, [entry])).toEqual([expected]);
  });

  test("finds a private method, which is where most guards live", () => {
    expect(
      staleEntries(REPO_ROOT, [
        { file: "src/parse/lines/list-reader.ts", function: "finish", reason },
      ]),
    ).toEqual([]);
  });
});

describe("agreement harnesses", () => {
  // The audited value today: the historical hazard-vs-reader
  // instrument was scratchpad-only and never became a resident test.
  test("none are declared", () => {
    expect(readDesign(REPO_ROOT).harnesses).toEqual([]);
  });
});

describe("the design gates and ratchets", () => {
  test("a widened seam fails, naming it and both widths", () => {
    const base = makeSnapshot({ seams: [seam("ListHost", 9)] });
    const head = makeSnapshot({ seams: [seam("ListHost", 10)] });
    expect(gateFailures(head, base)).toEqual(["seam ListHost: 9 -> 10"]);
  });

  test("a narrowed seam passes, which is the direction the ratchet wants", () => {
    const base = makeSnapshot({ seams: [seam("ListHost", 9)] });
    const head = makeSnapshot({ seams: [seam("ListHost", 8)] });
    expect(gateFailures(head, base)).toEqual([]);
  });

  test.each([
    ["the base does not declare it", seam("ListHost"), seam("ListHost", 9)],
    [
      "the base's registry never named it",
      seam("Other", 1),
      seam("ListHost", 9),
    ],
  ])("the seam RATCHET is skipped when %s", (_name, before, after) => {
    const base = makeSnapshot({ seams: [before] });
    const head = makeSnapshot({ seams: [after] });
    expect(gateFailures(head, base)).toEqual([]);
  });

  // Base-absent cannot have widened, so it is skipped. HEAD-absent is
  // the seam list rotting — a renamed or deleted seam leaving the
  // budget, which a rise-only ratchet reads as nothing at all. Same
  // treatment as a stale registry entry.
  test("a seam absent at HEAD fails, with or without a base", () => {
    const head = makeSnapshot({ seams: [seam("ListHost")] });
    expect(gateFailures(head)).toHaveLength(1);
    expect(gateFailures(head)[0]).toContain("seam ListHost is not declared");
    expect(gateFailures(head)[0]).toContain("update SEAMS");
    const base = makeSnapshot({ seams: [seam("ListHost", 9)] });
    expect(gateFailures(head, base)).toHaveLength(1);
  });

  test("a seam that cannot be measured flat fails at HEAD", () => {
    const fault = "S extends another type in f.ts (one flat declaration)";
    const head = makeSnapshot({ seams: [seam("ListHost", undefined, fault)] });
    expect(gateFailures(head)).toEqual([`seam ${fault}`]);
  });

  test("a risen defense counter fails", () => {
    const base = makeSnapshot({ totalFallback: 8 });
    const head = makeSnapshot({ totalFallback: 9 });
    expect(gateFailures(head, base)).toEqual([
      "Total fallback: markers: 8 -> 9",
    ]);
  });

  // A zero at the base cannot be told apart from "this marker was not
  // a convention yet", and introducing a marker must not read as a
  // regression. Stated as a caveat in docs/simplicity-metrics.md.
  test("a defense counter the base does not carry ratchets from absent", () => {
    const base = makeSnapshot({ totalFallback: 0 });
    const head = makeSnapshot({ totalFallback: 8 });
    expect(gateFailures(head, base)).toEqual([]);
  });

  test("a longer interior-validation registry fails", () => {
    const base = makeSnapshot({ interiorValidation: 5 });
    const head = makeSnapshot({ interiorValidation: 6 });
    expect(gateFailures(head, base)).toEqual([
      "interior validation sites: 5 -> 6",
    ]);
  });

  test("a base with no registry cannot be regressed against", () => {
    const base = makeSnapshot({});
    const head = makeSnapshot({ interiorValidation: 5 });
    expect(gateFailures(head, base)).toEqual([]);
  });

  test("a stale registry entry fails with or without a base", () => {
    const head = makeSnapshot({ staleEntries: ["src/a.ts: gone"] });
    expect(gateFailures(head)).toHaveLength(1);
    expect(gateFailures(head)[0]).toContain("stale interior-validation");
    expect(gateFailures(head)[0]).toContain("src/a.ts: gone");
    expect(gateFailures(head, makeSnapshot({}))).toHaveLength(1);
  });

  // The one gate that can see an UNDERCOUNT. Everything else in this
  // family fires on rise, so a marker that stops being counted reads
  // as progress.
  test("a wrapped marker fails with or without a base", () => {
    const head = makeSnapshot({
      nearMisses: ["src/ast.ts:460: Valid only when"],
    });
    expect(gateFailures(head)).toHaveLength(1);
    expect(gateFailures(head)[0]).toContain("split across two comment lines");
    expect(gateFailures(head)[0]).toContain("src/ast.ts:460");
    expect(gateFailures(head, makeSnapshot({}))).toHaveLength(1);
  });

  test("a registry that could not be read fails with or without a base", () => {
    const head = makeSnapshot({
      registryFaults: ["scripts/metrics/defense-registry.json: not found"],
    });
    expect(gateFailures(head)).toHaveLength(1);
    expect(gateFailures(head)[0]).toContain("could not be read");
    expect(gateFailures(head, makeSnapshot({}))).toHaveLength(1);
  });

  // The three undercount gates read registries that describe THIS
  // repository, so `--root <dir>` and an archived `--base` are measured
  // by them and not judged. Without this, `--root` would fail on every
  // foreign checkout — including the throwaway ones that test this
  // CLI's own exit codes.
  test("a foreign checkout is measured, not judged, by the registries", () => {
    const foreign = makeSnapshot({
      repository: false,
      registryFaults: ["scripts/metrics/defense-registry.json: not found"],
      nearMisses: ["src/a.ts:1: Valid only when"],
      seams: [seam("ListHost")],
    });
    expect(gateFailures(foreign)).toEqual([]);
    // …but the same facts about OUR tree are three failures.
    const ours = makeSnapshot({
      registryFaults: ["scripts/metrics/defense-registry.json: not found"],
      nearMisses: ["src/a.ts:1: Valid only when"],
      seams: [seam("ListHost")],
    });
    expect(gateFailures(ours)).toHaveLength(3);
  });

  // Absolute, not a ratchet: the budget is zero because the second
  // component is the problem, so "no more than last time" is not a
  // thing to want.
  test("a declared agreement harness fails with or without a base", () => {
    const head = makeSnapshot({ harnesses: ["tests/parser/agree.test.ts"] });
    expect(gateFailures(head)).toHaveLength(1);
    expect(gateFailures(head)[0]).toContain("agreement harness");
    expect(gateFailures(head)[0]).toContain("tests/parser/agree.test.ts");
    expect(gateFailures(head, makeSnapshot({}))).toHaveLength(1);
  });
});
