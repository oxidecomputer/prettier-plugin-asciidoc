/**
 * The symbol half of the repo-internal citation gate
 * (`scripts/internal-symbols.ts`): what counts as a symbol citation,
 * what counts as a file having the name, and the two directions the
 * check bites in.
 *
 * The grammar rows matter more than the check itself. A rule that let
 * any path in a comment paragraph bind any backticked run in it
 * reports mostly Ruby method names and AsciiDoc spellings standing
 * near an unrelated path, because that is what this repository's
 * comments quote; adjacency is what makes the check usable, and these
 * rows are where that rule is stated as behaviour rather than as
 * prose.
 */
import { describe, expect, test } from "vitest";
import {
  checkSymbol,
  namesIn,
  symbolCitations,
} from "../../scripts/internal-symbols.js";

describe("what the scan claims as a symbol citation", () => {
  test.each([
    ["a name then a comma then a path", "// (`alpha`, src/a.ts)", ["alpha"]],
    ["a name then a parenthesised path", "// `alpha` (src/a.ts)", ["alpha"]],
    ["a qualified name", "// `Node.alpha` (src/a.ts)", ["Node.alpha"]],
    ["a hash-qualified name", "// `Node#alpha` (src/a.ts)", ["Node#alpha"]],
    ["an empty call suffix", "// `alpha()` (src/a.ts)", ["alpha()"]],
    ["two in one aside", "// `a`, src/a.ts and `b`, src/a.ts", ["a", "b"]],
    ["a preposition between", "// `alpha` in src/a.ts", ["alpha"]],
    ["a wrapped preposition", "// `alpha` in\n// src/a.ts", ["alpha"]],
  ])("%s is claimed", (_what, text, expected) => {
    expect(symbolCitations("src/w.ts", text).map((one) => one.named)).toEqual(
      expected,
    );
  });

  test.each([
    ["a name with no path after it", "// `alpha` does the counting"],
    [
      "a name a whole clause away",
      "// `alpha` counts, and so, later, src/a.ts",
    ],
    ["a foreign method name", "// `parse_list` in parser.rb, see src/a.ts"],
    ["prose in backticks", "// `a  b` renders (src/a.ts)"],
    ["a runtime global", "// `Promise.all` (src/a.ts)"],
    ["a path with no name in front", "// see src/a.ts"],
    // The shape the preposition costs, and the reason the preposition
    // has to sit against the name: prose says "the X rule in <path>"
    // about a rule it is not citing, and only the word between the
    // two tells that apart from a citation.
    [
      "a noun before the preposition",
      "// the `BackslashEscape` rule in src/parse/inline/rules.ts",
    ],
    ["a word outside the preposition set", "// `alpha` reads src/a.ts"],
  ])("%s is not", (_what, text) => {
    expect(symbolCitations("src/w.ts", text)).toEqual([]);
  });

  test("the citation carries the line it is written on", () => {
    const text = ["// one", "// two", "// (`alpha`, src/a.ts)"].join("\n");
    expect(symbolCitations("src/w.ts", text).at(0)?.at).toBe("src/w.ts:3");
  });
});

describe("what counts as a file having a name", () => {
  test.each([
    ["a function", "export function alpha(): void {}"],
    ["a variable", "const alpha = 1;"],
    ["a class", "class alpha {}"],
    ["an interface", "interface alpha { x: 1 }"],
    ["a type alias", "type alpha = 1;"],
    ["an interface member", "interface Held { alpha: 1 }"],
    ["an import", 'import { alpha } from "./b.js";'],
  ])("%s", (_what, text) => {
    expect(namesIn("src/a.ts", text).has("alpha")).toBe(true);
  });

  test("a name that appears only in a comment does not count", () => {
    // The reason the walk is the TypeScript compiler's and not a
    // regex over the text: a gate that accepted a symbol because some
    // comment mentioned it would pass exactly the rot it is for.
    expect(namesIn("src/a.ts", "// alpha counts things\n").has("alpha")).toBe(
      false,
    );
  });
});

describe("holding a citation to its file", () => {
  const citation = { at: "src/w.ts:1", named: "alpha", file: "src/a.ts" };

  test("a name the file has holds", () => {
    expect(checkSymbol(citation, new Set(["alpha"]))).toEqual([]);
  });

  test("a name the file lacks fails, and the message says which", () => {
    expect(checkSymbol(citation, new Set(["beta"])).join("")).toContain(
      "which declares and imports no alpha",
    );
  });

  test("a qualified name fails when only the member is there", () => {
    // Half right is still wrong: it sends a reader to a member of
    // something that is not in the file.
    const qualified = { ...citation, named: "Reader.alpha" };
    expect(checkSymbol(qualified, new Set(["alpha"])).join("")).toContain(
      "no Reader",
    );
  });

  test("an empty name set fails every segment, and names them all", () => {
    // The degenerate file, asserted so the check cannot quietly hold
    // when it has nothing to hold against.
    const qualified = { ...citation, named: "Reader.alpha" };
    expect(checkSymbol(qualified, new Set()).join("")).toContain(
      "no Reader and no alpha",
    );
  });
});
