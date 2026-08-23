import { describe, test, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { cruiseImports } from "../../scripts/metrics/graph.js";

/**
 * The architectural rule of the parse layer, enforced by the suite
 * rather than by reviewer memory: block-level context comes from the
 * BlockReader — its read position and the extents it collects — and
 * from nowhere else.
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
 * exemption for one file. (That is why prose under `src/parse` says
 * "parser-state gate" rather than spelling the toolkit keyword next to
 * a colon, and "parser toolkit" rather than the import specifier.) A
 * false positive costs a rewording; a false negative is the thing we
 * are trying to prevent.
 *
 * Nothing here is pinned to a file name except the deletion list: every
 * textual rule runs over EVERY file under `src/parse` — and the
 * parser-toolkit import rule over every file under `src` — so splitting
 * a module at the line limit cannot move code out from under a rule.
 *
 * The import-graph rules at the bottom are not textual at all: they
 * come from dependency-cruiser, via the same helper the metrics script
 * uses (Ruling 34).
 */
const PARSE_DIR = "src/parse";

// The whole package: the scope of the parser-toolkit import rule.
const SRC_DIR = "src";

/**
 * Lint suppressions in `src/parse`, as a CEILING. Nothing the parser
 * toolkit forced survives: no token pattern needs `null`, no regex is
 * barred from the `v` flag, and there is no visitor whose dispatch
 * returns `unknown`. What is left is six `prefer-destructuring` in
 * inline/inline-node-builder.ts, each an indexed array access in the
 * pairing loop.
 */
const SRC_PARSE_ESLINT_DISABLES = 6;

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
 * included: the reader is told its context, and reads it forward from
 * the line it is on, so nothing here needs an exemption.
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
  // it fires whether or not the type is spelled out. Every legitimate
  // `tokens` parameter in the tree today (inline-node-builder,
  // build/paragraph) is first or second, so this is precise by
  // construction rather than by exemption.
  [
    "function signature taking the token history as its third parameter",
    /\([^\(\),]*,[^\(\),]*,\s*tokens\b/v,
  ],
  // The same history under its Chevrotain name.
  ["matchedTokens access", /matchedTokens/v],
  // A backwards search over an emitted token array is the token-history
  // walk `delimiter-patterns.ts` used to find its opening delimiter.
  // The ban is total under `src/parse` today: the reader keeps no
  // stack to search, so the lookbehind's exemption for a receiver
  // whose WHOLE identifier is `stack` or `frames` has no users left.
  // It is kept rather than tightened because tightening it would be a
  // change of rule, not of fact — and it never exempted a
  // token-history walk anyway (`tokenStack.findLast(` and
  // `openFrames.findLastIndex(` do not match the lookbehind, which
  // requires a non-word character or start of line in front).
  [
    "backwards search over a token array (no exempt receiver remains)",
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
  // Run over every file, not just the grammar's: this repository
  // splits modules at the line limit, and a rule moved into
  // `grammar-lists.ts` must stay under the same ban.
  ["a parser-state gate", /GATE:/v],
  ["parser backtracking", /BACKTRACK\(/v],
  ["raw parser lookahead", /this\.LA\(/v],
  // There are no custom token patterns any more: the inline rules are
  // plain `match(text, index) => length` functions in
  // src/parse/inline/rules.ts. `exec:` with a paren is the object-literal
  // pattern form; `regex.exec(text)` in rules.ts has a DOT, not a colon,
  // so this does not fire on it.
  ["a custom token pattern", /CustomPatternMatcher|exec:\s*\(/v],
];

// The parser toolkit's import specifier. Not in FORBIDDEN because
// FORBIDDEN runs over `src/parse` only and the plan's Deleted section
// is about the whole package: this one gets its own walk over `src`
// (see the test below). It reads comments too — prose under `src`
// says "parser toolkit", never the specifier.
const TOOLKIT_IMPORT = /from "chevrotain"/v;

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

  // The one rule that is about the whole package rather than the parse
  // layer. It covers the SOURCE text; the dependency itself is covered
  // elsewhere and does not need a rule here — package.json no longer
  // lists chevrotain, knip fails on a dependency nothing imports, and
  // `bun run check` fails on an import that resolves to nothing.
  describe.each(walk(SRC_DIR).map((file) => [file] as const))("%s", (file) => {
    test("does not import the parser toolkit", () => {
      expect(readFileSync(file, "utf8")).not.toMatch(TOOLKIT_IMPORT);
    });
  });

  // The post-hoc repair passes and the machinery that fed them.
  //
  // WHAT THIS PROVES: those specific modules are gone and cannot come
  // back under their old names.
  //
  // WHAT IT DOES NOT PROVE: that no post-parse AST repair pass exists.
  // A new one under a new name trips nothing here. There is no precise
  // textual signature for the category — the deleted
  // `paragraph-form.ts` exported `convertParagraphFormBlocks(blocks:
  // BlockNode[], …): BlockNode[]`, exactly the shape a repair pass
  // has, and a legitimate future pass could too — so banning the
  // signature would fire on correct code. Reviewing a new
  // `BlockNode[] -> BlockNode[]` export is a human judgement; the
  // metric "post-hoc repair passes = 0" (true since spec D4) must be
  // re-established by reading, not by citing this test.
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
    "tokens.ts",
    "inline-link-tokens.ts",
    "inline-mark-pattern.ts",
    // These two still exist, one directory down: the list is keyed on
    // the OLD path, and "stays deleted" here means `src/parse/<name>`
    // is gone for good — the inline builders live under `inline/`.
    "inline-node-builder.ts",
    "inline-link-builder.ts",
    // The CST-era node constructors. Their contents live on under
    // `build/`, one file per node family, as pure `(span, index) ->
    // node` functions with no CST in the signature.
    "token-builders.ts",
    "block-helpers.ts",
    // The parser toolkit's layer: the grammar, the CST types, the
    // visitor, the block token vocabulary and factory, and the inline
    // token bridge. The reader builds the AST itself now, one node
    // per construct as it reads it.
    "grammar.ts",
    "cst-types.ts",
    "ast-builder.ts",
    "inline-tokens.ts",
    "lines/tokens.ts",
    "lines/token-factory.ts",
    "inline-bridge.ts",
    // The frame-based list layer, replaced by extent-first reading
    // (list-reader.ts's readList over the itemExtent port): the
    // per-item state machine, the list frame helpers, and the
    // standalone extent module (folded into list-reader.ts).
    "lines/list-item.ts",
    "lines/list-frames.ts",
    "lines/item-extent.ts",
    // The style-driven post-parse rewrite: folded into the reader's
    // open dispatch (spec D4) — masquerades and admonition renames
    // resolve in lines/open-style.ts, and verbatim-styled and
    // paragraph-form blocks are built by the reader at open.
    "paragraph-form.ts",
    // The per-line token flattener that fed the string-body
    // admonition engine; both died with spec D7 (one prose
    // representation).
    "inline/text-lines.ts",
  ])("%s stays deleted", (name) => {
    expect(existsSync(path.posix.join(PARSE_DIR, name))).toBe(false);
  });

  // The node-kind budget is a GATE, not prose (spec D6, owner): 30 —
  // plan β RETURNS the budget to plan-4's number while deleting a
  // container kind (`section` and `documentTitle` out, `heading` in;
  // spec D10(a)). A 31st kind fails this row until it is deliberately
  // updated — which is what a budget means. Counted off the
  // `type: "…"` discriminant literals declared in src/ast.ts, one per
  // node kind.
  test("the node-kind budget is 30", () => {
    const source = readFileSync("src/ast.ts", "utf8");
    const kinds = source.match(/^ {2}type: "[a-zA-Z]+";$/gmv) ?? [];
    expect(kinds).toHaveLength(30);
  });

  // The plan's constraint: no lint suppressions beyond
  // `prefer-destructuring` on indexed access in the inline layer. This
  // is the count after the deletions above; it is a CEILING, so removing a
  // suppression needs no edit here, and adding one needs an argument in
  // review. Asserted over the SITES so a failure prints which
  // suppressions are there, not just how many.
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
