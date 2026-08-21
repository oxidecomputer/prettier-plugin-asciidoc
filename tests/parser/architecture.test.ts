import { describe, test, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { cruiseImports } from "../../scripts/metrics/graph.js";

/**
 * The architectural rule of the parse layer, enforced by the suite
 * rather than by reviewer memory: block-level context comes from the
 * BlockReader's frame stack and from nowhere else.
 *
 * Before the BlockReader, "where does this block end?" was answered in
 * four different places at once — Chevrotain custom token patterns that
 * walked the token history (`delimiter-patterns.ts`,
 * `paragraph-tokens.ts`), a second lexer mode reached by `push_mode`,
 * grammar `GATE`s that read parser state, and post-hoc AST passes that
 * repaired the result (`continuation-absorber.ts`,
 * `continuation-builder.ts`, `inline-fragment-lexer.ts`). Each of those
 * reconstructs context that the reader already knows. This file is the
 * mechanical guard that they do not grow back: it reads the source of
 * `src/parse/**` and asserts on its text, so a reintroduced mechanism
 * fails the suite even when every behavioural test still passes.
 *
 * The checks are deliberately textual and blunt, and they read COMMENTS
 * as well as code — there is no parser here. If a rule fires on a
 * comment, reword the comment; do not weaken the rule and do not add an
 * exemption for one file. (That is why the prose in `grammar.ts` and
 * `lines/tokens.ts` says "parser-state gate" rather than spelling the
 * Chevrotain keyword next to a colon.) A false positive costs a
 * rewording; a false negative is the thing we are trying to prevent.
 *
 * Nothing here is pinned to a file name except the deletion list: every
 * textual rule runs over EVERY file under `src/parse`, so splitting a
 * module at the line limit cannot move code out from under a rule.
 *
 * The import-graph rules at the bottom are not textual at all: they
 * come from dependency-cruiser, via the same helper the metrics script
 * uses (Ruling 34).
 */
const PARSE_DIR = "src/parse";

/**
 * Lint suppressions in `src/parse` after the deletion of the old block
 * path, as a CEILING. Every one of them carries a `--` reason and is
 * either Chevrotain-forced (`require-unicode-regexp` on a file of token
 * patterns, `unicorn/no-null` where a CustomPatternMatcherFunc must
 * return null) or about the visitor's untyped dispatch.
 */
const SRC_PARSE_ESLINT_DISABLES = 21;

/**
 * Every `.ts` file under a directory, recursively, in posix spelling.
 * @param directory - directory to walk, relative to the repository root
 * @returns paths of every TypeScript file below it
 */
function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const full = path.posix.join(directory, name);
    return statSync(full).isDirectory()
      ? walk(full)
      : full.endsWith(".ts")
        ? [full]
        : [];
  });
}

const files = walk(PARSE_DIR);

/**
 * Textual signatures of context reconstruction, each with the mechanism
 * it stands for. Applied to every file under `src/parse`, the reader
 * included — the reader reads its OWN frame stack, which is not what
 * any of these match (see the `stack`/`frames` exemption below).
 */
const FORBIDDEN: Array<[string, RegExp]> = [
  // Chevrotain hands a CustomPatternMatcherFunc the tokens matched so
  // far, as its THIRD parameter. A pattern that takes that parameter is
  // deriving block context from the token history instead of being told
  // it. Two spellings, because the type may be named or inferred:
  [
    "custom token pattern reading the token history",
    /exec:\s*\([^\)]*\btokens\b/v,
  ],
  // ...and the function-signature form, which catches a matcher written
  // as a standalone `const m: CustomPatternMatcherFunc = (text, offset,
  // tokens) => …` and assigned to `exec` elsewhere. Keyed on the
  // POSITION (third parameter named `tokens`), not on the type name, so
  // it fires whether or not the type is spelled out. The inline layer's
  // legitimate `tokens` parameters (inline-node-builder, ast-builder,
  // token-builders) are all first or second, so this is precise by
  // construction rather than by exemption.
  [
    "function signature taking the token history as its third parameter",
    /\([^\(\),]*,[^\(\),]*,\s*tokens\b/v,
  ],
  // The same history under its Chevrotain name.
  ["matchedTokens access", /matchedTokens/v],
  // A backwards search over an emitted token array is the token-history
  // walk `delimiter-patterns.ts` used to find its opening delimiter.
  // Searching the reader's OWN stack (`this.stack`, a frame array) is
  // the sanctioned way to answer the same question, so a receiver whose
  // WHOLE identifier is `stack` or `frames` is exempt — the lookbehind
  // requires a non-word character (or start of line) in front, so
  // `tokenStack.findLast(` and `openFrames.findLastIndex(` are not.
  [
    "backwards search over a token array (the reader's frame stack is exempt)",
    /(?<!(?:^|[^A-Za-z0-9_])(?:stack|frames))\.findLast(?:Index)?\(/v,
  ],
  // Two lexer modes meant two classification systems. There is one
  // vocabulary now and the reader emits the block half itself.
  ["Chevrotain lexer mode switching", /push_mode|pop_mode/v],
  // `GATE` is the only way a Chevrotain rule can consult parser state,
  // and a context-carrying OPTION is spelled `OPTION({ GATE, DEF })` —
  // so one check covers both of the spec's grammar metrics. (A bare
  // `OPTION2` is not one: Chevrotain requires the numeric suffix
  // whenever a rule has two OPTIONs, and `listItem`'s two are each a
  // single distinct token.) `BACKTRACK` and `LA` are the other two
  // escape hatches out of LL(1) into "decide by looking around".
  //
  // Run over every file, not just today's `grammar.ts`: this repository
  // splits modules at the line limit, and a rule moved into
  // `grammar-lists.ts` must stay under the same ban.
  ["a parser-state gate", /GATE:/v],
  ["parser backtracking", /BACKTRACK\(/v],
  ["raw parser lookahead", /this\.LA\(/v],
];

/**
 * Suppression lines in one file that switch a rule off without saying
 * why (the repository spells the reason after `--`).
 * @param file - path of a TypeScript file under `src/parse`
 * @returns one `path: line` string per unexplained suppression
 */
function unexplainedDisables(file: string): string[] {
  const lines = readFileSync(file, "utf8").split("\n");
  const bare = lines.filter(
    (line) => line.includes("eslint-disable") && !line.includes("--"),
  );
  return bare.map((line) => `${file}: ${line.trim()}`);
}

/**
 * Every lint suppression in one file, tagged with where it is, so a
 * failure of the ceiling below names the offender instead of printing
 * a bare count.
 * @param file - path of a TypeScript file under `src/parse`
 * @returns one `path:line: text` string per suppression
 */
function disableSites(file: string): string[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .flatMap((line, index) =>
      line.includes("eslint-disable")
        ? [`${file}:${String(index + 1)}: ${line.trim()}`]
        : [],
    );
}

describe("parse-layer architecture", () => {
  describe.each(files.map((file) => [file] as const))("%s", (file) => {
    const source = readFileSync(file, "utf8");
    test.each(FORBIDDEN)("has no %s", (_name, pattern) => {
      expect(source).not.toMatch(pattern);
    });
  });

  // A custom token pattern sees `(text, offset)` — the whole document
  // and where it is. Scanning backwards from `offset` for the previous
  // newline is how `paragraph-tokens.ts` rebuilt "am I at the start of
  // a line, and what was the line before?". Files that slice the source
  // by an AST node's recorded position (paragraph-form.ts) are not
  // token patterns and are not in this set.
  //
  // The filter takes the type name OR the `exec:` shape, so a pattern
  // written inline as `pattern: { exec: (text, offset) => … }` without
  // ever naming CustomPatternMatcherFunc is still covered.
  describe.each(
    files
      .filter((file) =>
        /CustomPatternMatcher|exec:\s*\(/v.test(readFileSync(file, "utf8")),
      )
      .map((file) => [file] as const),
  )("%s defines custom token patterns, so it", (file) => {
    test("does not scan the source backwards", () => {
      expect(readFileSync(file, "utf8")).not.toMatch(/lastIndexOf\(/v);
    });
  });

  // The post-hoc repair passes and the machinery that fed them.
  //
  // WHAT THIS PROVES: those specific modules are gone and cannot come
  // back under their old names.
  //
  // WHAT IT DOES NOT PROVE: that no post-parse AST repair pass exists.
  // A new one under a new name trips nothing here. There is no precise
  // textual signature for the category — `paragraph-form.ts` exports
  // `convertParagraphFormBlocks(blocks: BlockNode[], …): BlockNode[]`,
  // which has exactly the shape a repair pass would have and is
  // legitimate (style-driven conversion, not classification repair) —
  // so banning the signature would fire on correct code. Reviewing a
  // new `BlockNode[] -> BlockNode[]` export is a human judgement; the
  // metric "post-hoc repair passes = 0" must be re-established by
  // reading, not by citing this test.
  test.each([
    "paragraph-tokens.ts",
    "delimiter-patterns.ts",
    "continuation-absorber.ts",
    "continuation-builder.ts",
    "continuation-markers.ts",
    "inline-fragment-lexer.ts",
    "section-builder.ts",
    "discrete-heading.ts",
    "list-builder.ts",
  ])("%s stays deleted", (name) => {
    expect(existsSync(path.posix.join(PARSE_DIR, name))).toBe(false);
  });

  // The plan's constraint: no lint suppressions beyond the ones
  // Chevrotain forces (`require-unicode-regexp` where a token pattern
  // cannot use the `v` flag, `unicorn/no-null` where a
  // CustomPatternMatcherFunc must return null) and the visitor-shape
  // ones. This is the count after the deletions above; it is a
  // CEILING, so removing a suppression needs no edit here, and adding
  // one needs an argument in review. Asserted over the SITES so a
  // failure prints which suppressions are there, not just how many.
  test("adds no eslint-disable to src/parse", () => {
    const sites = files.flatMap(disableSites);
    expect(sites.length, sites.join("\n")).toBeLessThanOrEqual(
      SRC_PARSE_ESLINT_DISABLES,
    );
  });

  // Every surviving suppression names its reason after `--`. A bare
  // `eslint-disable` is how a rule gets switched off without anyone
  // having to defend it.
  test("every eslint-disable in src/parse states a reason", () => {
    expect(files.flatMap(unexplainedDisables)).toEqual([]);
  });
});

// The cycle count is zero, permanently: a cyclic module group has no
// reading order, so nobody can say where the group starts. The first
// cycle here ran reader -> list-reader -> list-frames -> reader and was
// closed by moving `Item` out to its own leaf module, list-item.ts.
//
// The detection is dependency-cruiser's, not a hand-rolled Tarjan pass
// in this file — the same `cruiseImports` call `bun run metrics` gates
// on, so the suite and the scorecard can never disagree about what the
// graph is.
describe("import graph", () => {
  test("has no import cycle", async () => {
    const { cycles } = await cruiseImports(process.cwd());
    expect(
      cycles,
      cycles.map((cycle) => cycle.join(" -> ")).join("\n"),
    ).toEqual([]);
  });

  test("has no file that imports itself", async () => {
    const { selfImports } = await cruiseImports(process.cwd());
    expect(selfImports, selfImports.join("\n")).toEqual([]);
  });

  // dependency-cruiser reports a specifier it cannot resolve rather
  // than dropping it, so this is the same fact from the same source as
  // the two rules above: a relative import pointing at nothing would
  // otherwise be a hole neither the cycle rule nor the reader can see
  // through.
  test("every relative import resolves", async () => {
    const { unresolved } = await cruiseImports(process.cwd());
    expect(unresolved, unresolved.join("\n")).toEqual([]);
  });
});
