/**
 * The two design-quality budgets: seam width and the defense
 * inventory.
 *
 * These are budgets the repository MAINTAINS, not numbers a tool
 * discovers, so what needs pinning is different in kind from the rest
 * of the scorecard: the COUNTING RULE (which interface members are
 * shared vocabulary, which mentions of a marker are defenses), the
 * seam list's own freshness, and each gate's direction. See
 * `docs/harnesses.md`, "Design-quality budgets".
 */
import { describe, test, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { readSeams, scanSeam } from "../../scripts/metrics/design.js";
import { gateFailures } from "../../scripts/metrics/gates.js";
import { REPO_ROOT } from "../../scripts/metrics/model.js";
import { scanSource } from "../../scripts/metrics/scan.js";
import { makeSnapshot, seam, vocabulary } from "./metrics-snapshot.js";

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
    if (entry.isDirectory()) {
      return sourceFilesUnder(full);
    }
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
  test("every named seam is flat, single, and declared where the registry says", () => {
    for (const shipped of readSeams(REPO_ROOT)) {
      expect(shipped.fault, shipped.name).toBeUndefined();
      expect(shipped.members, shipped.name).toBeGreaterThan(0);
    }
  });
});

describe("defense marker counting", () => {
  test.each([
    ["a line comment", "// Total fallback: why\ncode();\n", 1],
    ["a JSDoc block", "/** Total fallback: why. */\nlet a: number;\n", 1],
    [
      "two markers in one comment, since each is a defended site",
      "/**\n * Total fallback: a.\n * Total fallback: b.\n */\nlet a: number;\n",
      2,
    ],
    [
      "no marker at all",
      "// an ordinary comment about a fallback\ncode();\n",
      0,
    ],
    [
      "a marker spelled in a string literal, which is not a comment",
      'const s = "Total fallback: not a comment";\n',
      0,
    ],
    // The marker has to be on ONE line: the count is over comment
    // text, so an 80-column wrap that splits it hides the defense.
    // Pinned so nobody "fixes" the counter into matching across lines
    // without deciding to.
    [
      "a marker broken across two comment lines, which is invisible",
      "/**\n * Total\n * fallback: why.\n */\nlet a: number;\n",
      0,
    ],
  ])("counts %s", (_name, text, expected) => {
    expect(scan(text).totalFallback).toBe(expected);
  });

  // The near-miss detector. The counting hazard it closes is
  // one-directional and therefore silent: the ratchet fires on RISE, so
  // a marker that STOPS being counted reads as progress. Detection is a
  // comparison: count the marker as written, then again with the
  // comment's line breaks collapsed, so it needs no second pattern.
  test.each([
    [
      "a JSDoc wrap, asterisk and all",
      "/**\n * Total\n * fallback: why.\n */\nlet a: number;\n",
      ["1: Total fallback:"],
    ],
    [
      "a line-comment wrap with no asterisk",
      "// Total\n// fallback: why\ncode();\n",
      ["1: Total fallback:"],
    ],
    [
      "a wrap in a comment that also holds an intact marker",
      "/**\n * Total fallback: a.\n * Total\n * fallback: b.\n */\nlet a: number;\n",
      ["1: Total fallback:"],
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
      "/**\n * Total fallback: why.\n * Something else entirely.\n */\nlet a: number;\n",
    ],
  ])("does not fire on %s", (_name, text) => {
    expect(scan(text).markerNearMisses).toEqual([]);
  });

  // Zero false positives over the shipped tree is what makes this a
  // hard gate rather than a warning, and this is the assertion that
  // fails the day someone rewraps the shipped marker.
  test("no marker under src is wrapped today", () => {
    expect(wrappedMarkersInSource()).toEqual([]);
  });

  // An `unreachable(` text search would count the one
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

describe("the design gates and ratchets", () => {
  test("a widened contract fails, naming it and both widths", () => {
    const base = makeSnapshot({ seams: [seam("Host", 9)] });
    const head = makeSnapshot({ seams: [seam("Host", 10)] });
    expect(gateFailures(head, base)).toEqual(["contract Host: 9 -> 10"]);
  });

  // Vocabulary is judged by PRECISION, not width, so its width never
  // ratchets — but an absent declaration still fails, as a contract's does.
  test("a VOCABULARY seam ratchets on nothing, and still fails when absent", () => {
    const base = makeSnapshot({ seams: [vocabulary("ReaderContext", 3)] });
    const wider = makeSnapshot({ seams: [vocabulary("ReaderContext", 9)] });
    expect(gateFailures(wider, base)).toEqual([]);
    const gone = makeSnapshot({ seams: [vocabulary("ReaderContext")] });
    expect(gateFailures(gone)[0]).toContain("vocabulary ReaderContext is not");
  });

  test("a narrowed seam passes, which is the direction the ratchet wants", () => {
    const base = makeSnapshot({ seams: [seam("Host", 9)] });
    const head = makeSnapshot({ seams: [seam("Host", 8)] });
    expect(gateFailures(head, base)).toEqual([]);
  });

  test.each([
    ["the base does not declare it", seam("Host"), seam("Host", 9)],
    ["the base's registry never named it", seam("Other", 1), seam("Host", 9)],
  ])("the seam RATCHET is skipped when %s", (_name, before, after) => {
    const base = makeSnapshot({ seams: [before] });
    const head = makeSnapshot({ seams: [after] });
    expect(gateFailures(head, base)).toEqual([]);
  });

  // Base-absent cannot have widened, so it is skipped. HEAD-absent is
  // the seam list rotting — a renamed or deleted seam leaving the
  // budget, which a rise-only ratchet reads as nothing at all.
  test("a seam absent at HEAD fails, with or without a base", () => {
    const head = makeSnapshot({ seams: [seam("Host")] });
    const [failure = ""] = gateFailures(head);
    expect(failure).toContain("contract Host is not declared");
    expect(failure).toContain("update CONTRACTS/VOCABULARY");
    const base = makeSnapshot({ seams: [seam("Host", 9)] });
    expect(gateFailures(head, base)).toHaveLength(1);
  });

  test("a seam that cannot be measured flat fails at HEAD", () => {
    const fault = "S extends another type in f.ts (one flat declaration)";
    const head = makeSnapshot({
      seams: [seam("Host", undefined, fault)],
    });
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
  // regression. Stated as a caveat in docs/harnesses.md.
  test("a defense counter the base does not carry ratchets from absent", () => {
    const base = makeSnapshot({ totalFallback: 0 });
    const head = makeSnapshot({ totalFallback: 8 });
    expect(gateFailures(head, base)).toEqual([]);
  });

  // The one gate that can see an UNDERCOUNT. Everything else in this
  // family fires on rise, so a marker that stops being counted reads
  // as progress.
  test("a wrapped marker fails with or without a base", () => {
    const head = makeSnapshot({
      nearMisses: ["src/ast.ts:460: Total fallback:"],
    });
    expect(gateFailures(head)).toHaveLength(1);
    expect(gateFailures(head)[0]).toContain("split across two comment lines");
    expect(gateFailures(head)[0]).toContain("src/ast.ts:460");
    expect(gateFailures(head, makeSnapshot({}))).toHaveLength(1);
  });

  // The undercount gates read registries and conventions that describe
  // THIS repository, so `--root <dir>` and an archived `--base` are
  // measured by them and not judged. Without this, `--root` would fail
  // on every foreign checkout, including the throwaway ones that test
  // this CLI's own exit codes.
  test("a foreign checkout is measured, not judged, by the registries", () => {
    const foreign = makeSnapshot({
      repository: false,
      nearMisses: ["src/a.ts:1: Total fallback:"],
      seams: [seam("Host")],
    });
    expect(gateFailures(foreign)).toEqual([]);
    // But the same facts about OUR tree are two failures.
    const ours = makeSnapshot({
      nearMisses: ["src/a.ts:1: Total fallback:"],
      seams: [seam("Host")],
    });
    expect(gateFailures(ours)).toHaveLength(2);
  });
});
