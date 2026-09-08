/**
 * The symbol half of the repo-internal citation gate
 * (`scripts/internal-symbols.ts`): what counts as a citation in either
 * spelling, what counts as a file having the name, what the tree-wide
 * index holds, and the directions the two checks bite in.
 *
 * The grammar rows matter more than the checks themselves. A rule that
 * let any path in a comment paragraph bind any backticked run in it
 * reports mostly Ruby method names and AsciiDoc spellings standing
 * near an unrelated path, because that is what this repository's
 * comments quote; adjacency is what makes the check usable, and these
 * rows are where that rule is stated as behaviour rather than as
 * prose.
 *
 * The link tags written in this file are FIXTURES, and the gate does
 * not read them (`LINKS_NOT_SCANNED`, scripts/internal-symbols.ts):
 * the rows have to spell a tag that resolves nowhere and one that
 * resolves twice, and a gate reading its own fixtures would fail on
 * them. The paths the rows write are fixtures too, and none of them
 * exists: a citation naming a file the gate read no text for is
 * skipped, which is what keeps these rows out of its own report.
 */
import { describe, expect, test } from "vitest";
import {
  DELETION_LEDGER,
  LINKS_NOT_SCANNED,
  bodiesIn,
  checkLink,
  checkSymbol,
  linkCitations,
  namesIn,
  symbolCitations,
  symbolIndex,
  type FileNames,
  type SymbolIndex,
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

describe("what the scan claims as a link tag", () => {
  test.each([
    ["a plain name", "// {@link alpha}", ["alpha"]],
    ["a qualified name", "/** {@link Node.alpha} */", ["Node.alpha"]],
    ["a tag a wrap broke", "/**\n * see {@link\n * alpha}\n */", ["alpha"]],
    ["a wrap in a line comment", "// see {@link\n// alpha}", ["alpha"]],
    ["two in one comment", "// {@link a} and {@link b}", ["a", "b"]],
  ])("%s is claimed", (_what, text, expected) => {
    expect(linkCitations("src/w.ts", text).map((one) => one.named)).toEqual(
      expected,
    );
  });

  test.each([
    ["a link to a URL", "// {@link https://example.com}"],
    ["a runtime global", "// {@link Promise.all}"],
    [
      "a template hole, which is how this gate prints its own",
      `// {@link \${named}}`,
    ],
    ["another tag entirely", "// {@linkcode alpha}"],
  ])("%s is not", (_what, text) => {
    expect(linkCitations("src/w.ts", text)).toEqual([]);
  });

  test("the citation carries the line it is written on", () => {
    const text = ["// one", "// two", "// {@link alpha}"].join("\n");
    expect(linkCitations("src/w.ts", text).at(0)?.at).toBe("src/w.ts:3");
  });

  test("a file whose tags are fixtures claims none of them", () => {
    // Which is what lets the rows above spell tags that resolve
    // nowhere: this file is one of the two, and the scan skips it.
    const own = "tests/scripts/internal-symbols.test.ts";
    expect(linkCitations(own, "// {@link alpha}")).toEqual([]);
  });

  test("the files whose tags are fixtures are pinned", () => {
    // An exemption nobody can widen by accident: these two write tags
    // that cannot resolve, and every other file's are read. The
    // document that describes the scan is NOT one of them: prose can
    // drop the braces and name the tag in words.
    expect([...LINKS_NOT_SCANNED].toSorted()).toEqual([
      "tests/scripts/internal-citations.test.ts",
      "tests/scripts/internal-symbols.test.ts",
    ]);
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
    ["an accessor", "class Held { get alpha(): number { return 1; } }"],
  ])("%s is declared", (_what, text) => {
    expect(namesIn("src/a.ts", text).declared.has("alpha")).toBe(true);
  });

  test("an import is had but not declared", () => {
    // The whole of the difference between the two halves: a reader
    // opening this file finds the name, so a citation beside its path
    // holds, and the index still has to send them somewhere else.
    const names = namesIn("src/a.ts", 'import { alpha } from "./b.js";');
    expect(names.imported.has("alpha")).toBe(true);
    expect(names.declared.has("alpha")).toBe(false);
  });

  test("a name that appears only in a comment does not count", () => {
    // The reason the walk is the TypeScript compiler's and not a
    // regex over the text: a gate that accepted a symbol because some
    // comment mentioned it would pass exactly the rot it is for.
    const names = namesIn("src/a.ts", "// alpha counts things\n");
    expect(names.declared.has("alpha")).toBe(false);
    expect(names.imported.has("alpha")).toBe(false);
  });
});

describe("what a name is written as", () => {
  test("a declaration's own text is what the name holds", () => {
    const bodies = bodiesIn("src/a.ts", "function alpha(): void {\n  go();\n}");
    expect(bodies.get("alpha")).toEqual([
      "function alpha(): void {\n  go();\n}",
    ]);
  });

  test("a member is held under its own name, not its owner's", () => {
    // Which is what lets a pin name the method a mutant sits in
    // rather than the class around it.
    const bodies = bodiesIn("src/a.ts", "class Held { alpha(): void {} }");
    expect(bodies.get("alpha")).toEqual(["alpha(): void {}"]);
    expect(bodies.has("Held")).toBe(true);
  });

  test("a name written twice holds both texts, in source order", () => {
    // Never one of them: picking would be a guess, and the count of a
    // quoted run inside them is what an ordinal is counted against.
    const bodies = bodiesIn(
      "src/a.ts",
      "function alpha(): void {}\nclass Held { alpha = 2; }",
    );
    expect(bodies.get("alpha")).toEqual([
      "function alpha(): void {}",
      "alpha = 2;",
    ]);
  });

  test("an import carries no text of its own", () => {
    expect(
      bodiesIn("src/a.ts", 'import { alpha } from "./b.js";').has("alpha"),
    ).toBe(false);
  });
});

describe("the index a path-less citation is resolved against", () => {
  test("a name two files declare holds both, in reading order", () => {
    const index = symbolIndex(
      new Map([
        ["src/a.ts", namesIn("src/a.ts", "export const shared = 1;")],
        ["src/b.ts", namesIn("src/b.ts", "const shared = 2;")],
      ]),
    );
    expect(index.get("shared")).toEqual(new Set(["src/a.ts", "src/b.ts"]));
  });

  test("an import puts nothing in it", () => {
    // Which is what makes the index answer "where is this declared"
    // rather than "who mentions it": every importer would otherwise
    // make its own name ambiguous.
    const index = symbolIndex(
      new Map([
        ["src/b.ts", namesIn("src/b.ts", 'import { shared } from "./a.js";')],
      ]),
    );
    expect(index.has("shared")).toBe(false);
  });
});

/**
 * The names one file has, spelled for the two checks.
 * @param declared - what it declares
 * @param imported - what it imports
 * @returns the file's names
 */
function names(declared: string[], imported: string[] = []): FileNames {
  return { declared: new Set(declared), imported: new Set(imported) };
}

describe("holding a citation to its file", () => {
  const citation = { at: "src/w.ts:1", named: "alpha", file: "src/a.ts" };

  test("a name the file has holds", () => {
    expect(checkSymbol(citation, names(["alpha"]))).toEqual([]);
  });

  test("an imported name is a name the file has", () => {
    expect(checkSymbol(citation, names([], ["alpha"]))).toEqual([]);
  });

  test("a name the file lacks fails, and the message says which", () => {
    expect(checkSymbol(citation, names(["beta"])).join("")).toContain(
      "which declares and imports no alpha",
    );
  });

  test("a qualified name fails when only the member is there", () => {
    // Half right is still wrong: it sends a reader to a member of
    // something that is not in the file.
    const qualified = { ...citation, named: "Reader.alpha" };
    expect(checkSymbol(qualified, names(["alpha"])).join("")).toContain(
      "no Reader",
    );
  });

  test("an empty name set fails every segment, and names them all", () => {
    // The degenerate file, asserted so the check cannot quietly hold
    // when it has nothing to hold against.
    const qualified = { ...citation, named: "Reader.alpha" };
    expect(checkSymbol(qualified, names([])).join("")).toContain(
      "no Reader and no alpha",
    );
  });
});

describe("holding a link tag to the tree", () => {
  const index: SymbolIndex = new Map([
    ["alpha", new Set(["src/a.ts"])],
    ["Reader", new Set(["src/a.ts"])],
    ["method", new Set(["src/b.ts"])],
    ["shared", new Set(["src/a.ts", "src/b.ts"])],
  ]);
  const citation = { at: "src/w.ts:1", named: "alpha" };

  test("a name exactly one file declares holds", () => {
    expect(checkLink(citation, names([]), index)).toEqual([]);
  });

  test("a name the citing file declares holds whatever else shares it", () => {
    // Which is what TypeScript resolves the tag against, and what
    // keeps the tree's other `shared` from being this one's problem.
    const own = { ...citation, named: "shared" };
    expect(checkLink(own, names(["shared"]), index)).toEqual([]);
  });

  test("a name the citing file only IMPORTS is asked of the tree", () => {
    const own = { ...citation, named: "shared" };
    expect(checkLink(own, names([], ["shared"]), index).join("")).toContain(
      "is declared in 2 files (src/a.ts, src/b.ts)",
    );
  });

  test("a name several files declare fails, and says to write the path", () => {
    // The rule that keeps the migration honest: a path-less spelling
    // is for names that resolve, and this one sends a reader to two
    // places.
    const shared = { ...citation, named: "shared" };
    expect(checkLink(shared, names([]), index).join("")).toContain(
      "so write the name with its path beside it instead",
    );
  });

  test("a name nothing declares fails, and names the segment", () => {
    const gone = { ...citation, named: "gone" };
    expect(checkLink(gone, names([]), index).join("")).toContain(
      "names no gone anything declares",
    );
  });

  test("a qualified name split across two files resolves nowhere", () => {
    // Both segments are declared, and no ONE file declares both, so
    // the tag would send a reader to a member of something that is
    // not there.
    const split = { ...citation, named: "Reader.method" };
    expect(checkLink(split, names([]), index).join("")).toContain(
      "names no ONE file declaring Reader and method",
    );
  });
});

describe("a path written the way a document writes one", () => {
  test("a backticked path is claimed the way a bare one is", () => {
    // Which the documents and the ledger notes need: a path in prose
    // is a code span, and the two cases that reached review were both
    // written that way.
    expect(symbolCitations("docs/a.md", "`beta` in `src/alpha.ts`")).toEqual([
      { at: "docs/a.md:1", named: "beta", file: "src/alpha.ts" },
    ]);
  });

  test("a name a JSON note writes beside a path is claimed", () => {
    expect(
      symbolCitations("scripts/a.json", '{ "note": "`beta` (src/alpha.ts)" }'),
    ).toEqual([
      { at: "scripts/a.json:1", named: "beta", file: "src/alpha.ts" },
    ]);
  });

  test("a word between the name and the path is still prose", () => {
    // Adjacency and not scope, whichever file the prose is written in.
    expect(
      symbolCitations("docs/a.md", "the `beta` rule in `src/alpha.ts`"),
    ).toEqual([]);
  });
});

describe("the ledger whose names are gone on purpose", () => {
  test("neither scan reads the deletion ledger", () => {
    // Its rows are ABOUT what a change removed, so a row whose name
    // still resolved would be the broken one. Every other ledger's
    // notes are read.
    const row = '{ "symbol": "`beta` (src/alpha.ts)", "why": "{@link beta}" }';
    expect(symbolCitations(DELETION_LEDGER, row)).toEqual([]);
    expect(linkCitations(DELETION_LEDGER, row)).toEqual([]);
    expect(symbolCitations("scripts/other.json", row)).toHaveLength(1);
  });
});
