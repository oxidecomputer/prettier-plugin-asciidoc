import { describe, test, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { cruiseImports } from "../../scripts/metrics/graph.js";

/**
 * The architectural rule of the parse layer, enforced by the suite
 * rather than by reviewer memory: block-level context comes from the
 * BlockReader — its read position and the extents it collects — and
 * from nowhere else. "Where does this block end?" is answered once,
 * where the lines are read; nothing reconstructs it afterwards.
 *
 * Two textual rows stand for the two ways that reconstruction comes
 * back, both spelled without naming any library:
 *
 * - a function whose THIRD parameter is the token history, which is
 *   how a matcher is handed the tokens matched so far and derives
 *   context from them instead of being told it;
 * - a BACKWARDS search over an emitted array, which is how a walk
 *   finds its own opening delimiter in what it has already produced.
 *
 * Both run over EVERY file under `src/parse`, the reader included —
 * splitting a module at the line limit cannot move code out from
 * under a rule — and neither takes an exemption.
 *
 * The checks are deliberately textual and blunt, and they read
 * COMMENTS as well as code: there is no parser here. Prose under
 * `src/parse` therefore states mechanisms in its OWN words rather
 * than borrowing an identifier a rule watches for. If a rule ever
 * fires on a comment, reword the comment; do not weaken the rule and
 * do not add an exemption for one file. A false positive costs a
 * rewording; a false negative is the thing we are trying to prevent.
 *
 * The deletion list and the node-kind budget are the two rows
 * pinned to file names; the deletion list is deliberately short,
 * holding only the modules whose temptation window is still open.
 *
 * The import-graph rules at the bottom are not textual at all: they
 * come from dependency-cruiser, via the same call `bun run metrics`
 * gates on, so the suite and the scorecard can never disagree about
 * what the graph is.
 */
const PARSE_DIR = "src/parse";

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
  // A matcher handed the tokens matched so far takes them as its
  // THIRD parameter. Keyed on the POSITION (third parameter named
  // `tokens`), not on any type name, so it fires whether or not a
  // type is spelled out. Every legitimate `tokens` parameter in the
  // tree today (inline-node-builder, build/paragraph) is first or
  // second, so this is precise by construction rather than by
  // exemption.
  [
    "function signature taking the token history as its third parameter",
    /\([^\(\),]*,[^\(\),]*,\s*tokens\b/v,
  ],
  // A backwards search over an emitted array is the token-history
  // walk this layer was restructured to make unnecessary: the reader
  // is told its context and reads it forward from the line it is on.
  // TOTAL under src/parse — the old exemption for a receiver named
  // `stack`/`frames` retired with the stack itself.
  ["backwards search over an emitted array", /\.findLast(?:Index)?\(/v],
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

  // The simplification program's own deletions: the string-body
  // admonition engine's flattener and the style-driven post-parse
  // rewrite. Their temptation window is this program — the rows
  // retire when it ends, not in its middle. (The earlier
  // toolkit-era filename list is gone: its temptation window closed
  // with the toolkit, and knip + `bun run check` already fail on a
  // resurrected dependency.)
  //
  // WHAT THIS PROVES: those two modules are gone and cannot come back
  // under their old names.
  //
  // WHAT IT DOES NOT PROVE: that no post-parse AST repair pass
  // exists. A new one under a new name trips nothing here. There is
  // no precise textual signature for the category — the deleted
  // `paragraph-form.ts` exported `convertParagraphFormBlocks(blocks:
  // BlockNode[], …): BlockNode[]`, exactly the shape a repair pass
  // has, and a legitimate future pass could too — so banning the
  // signature would fire on correct code. Reviewing a new
  // `BlockNode[] -> BlockNode[]` export is a human judgement.
  test.each(["paragraph-form.ts", "inline/text-lines.ts"])(
    "%s stays deleted",
    (name) => {
      expect(existsSync(path.posix.join(PARSE_DIR, name))).toBe(false);
    },
  );

  // A CENSUS of the `type: "…"` discriminant literals declared in
  // src/ast.ts, and a GATE rather than prose: a 44th fails this row
  // until it is deliberately updated. The count is DIRECTIONLESS — it
  // is neither a budget nor a score, so a rise is not a cost and a
  // fall is not progress; what the row buys is that no declaration
  // appears or disappears without someone saying why here.
  //
  // 35, moved up from 30 with the DelimitedBlockNode split: that one
  // interface became six members — a leaf-delimited block, a fence, a
  // masqueraded parent block, a table, an indented literal paragraph
  // and a paragraph-form block — each declaring the discriminant
  // itself, so the census counts six where it counted one. The number
  // of node kinds ON THE WIRE did not move: all six serialize
  // `type: "delimitedBlock"`, which is what the parity runs and the
  // key-order rows in tests/parser/block-masquerade.test.ts hold. The
  // literal is what this file can see, so it is what the row counts.
  //
  // 36, moved up from 35 with PassthroughNode: `+text+` and its
  // doubled and tripled spellings are ONE leaf carrying their own
  // bytes, because Asciidoctor removes them from the line before it
  // substitutes anything else and nothing downstream may read inside
  // them (issue #25).
  //
  // 39, moved up from 36 with the DOCUMENT HEADER (issue #18): the
  // header node itself, plus the author line and the revision line it
  // can hold. Three kinds and not one, deliberately - the header is a
  // composite whose lines belong to it (that ownership IS the fix: it
  // leaves the printer no blank line to insert after the title), and
  // the two attribution lines are two constructs in the language,
  // with two patterns in rx.rb and two sets of attributes, so naming
  // them apart is what lets the shape invariant say "at most one of
  // each, author first". Unlike the delimited-block split, these DO
  // move the wire: a titled document that used to serialize a level-0
  // `heading` now serializes a `documentHeader`, which is the AST
  // half of the parity diff this change declares.
  //
  // 43, moved up from 40 with SUPER/SUBSCRIPT AND CHARACTER
  // REFERENCES (issue #14): the last two `QUOTE_SUBS` rows become two
  // span kinds of their own, and the `REPLACEMENTS` table becomes one
  // leaf. Three kinds and not one, because a formatter has to ask them
  // different questions - a super/sub span holds CHILDREN the printer
  // recurses into and a reference holds BYTES it replays - and because
  // superscript and subscript are two rows in Ruby's table with two
  // patterns, the same reason the author and revision lines above are
  // named apart. They move the wire wherever a document already spelled
  // one: text that used to serialize as one `text` run now serializes
  // as a run, a node and a run. Not one output BYTE moves with them
  // (the corpus, the three shape grids and four directed sweeps all
  // measured zero), which is the point - the tree gains the structure
  // and the printer replays the same characters.
  test("the node-kind census is 43", () => {
    const source = readFileSync("src/ast.ts", "utf8");
    const kinds = source.match(/^ {2}type: "[a-zA-Z]+";$/gmv) ?? [];
    expect(kinds).toHaveLength(43);
  });

  // The constraint: no lint suppressions beyond
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

  // The layers are a DAG, and the DAG is enforced: `ast` <-
  // `constants`/`positions` <- `line-shapes` <- `inline/` <- `build/`
  // <- `lines/`, with `print/` reaching into `parse/` at exactly one
  // documented address and `parse/` never reaching into `print/`. The
  // rules are DIRECTIONS, written in LAYER_RULES
  // (scripts/metrics/graph.ts) and evaluated by dependency-cruiser's
  // own rule engine on this same cruise. The fix for a failure here is
  // always to move the declaration to the layer that owns it — never
  // to add an exemption.
  test("breaks no layer rule", async () => {
    const { layerViolations } = await cruiseImports(process.cwd());
    expect(layerViolations, layerViolations.join("\n")).toEqual([]);
  });
});
