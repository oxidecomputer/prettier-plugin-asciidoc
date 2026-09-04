import { describe, test, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { cruiseImports } from "../../scripts/metrics/graph.js";
import { registryModuleNames } from "../../scripts/metrics/registry-modules.js";
import { optionalGroup } from "../../src/parse/line-shapes.js";

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
 * Every `.ts` file under a directory, recursively - {@link walk} under
 * a name the rows below share with their own prose ("filesUnder the
 * reading core").
 * @param directory - directory to walk, relative to the repository root
 * @returns paths of every TypeScript file below it
 */
function filesUnder(directory: string): string[] {
  return walk(directory);
}

/**
 * Registry exports that are NOT a pattern despite the ALL-CAPS
 * spelling every pattern export also carries: three plain string
 * constants (`CALLOUT_STYLE`, `LINE_COMMENT_HEAD`,
 * `FRONT_MATTER_FENCE`), one array of kind names (`DELIMITER_KINDS`)
 * and one reader-state value (`BLOCK_START_CONTEXT`). The convention
 * is the signal; this is its short exception list, checked once here
 * rather than reasoned about at each call site.
 */
const NOT_A_PATTERN = new Set([
  "CALLOUT_STYLE",
  "LINE_COMMENT_HEAD",
  "FRONT_MATTER_FENCE",
  "DELIMITER_KINDS",
  "BLOCK_START_CONTEXT",
]);

/**
 * Whether an imported NAME names a pattern in the registry, by the
 * registry's own convention: every `RegExp`, `RegExp[]` or
 * `Record<_, RegExp>` export is ALL-CAPS, and {@link NOT_A_PATTERN}
 * is the convention's only exceptions.
 * @param name - an imported binding's name
 * @returns true when the name is a pattern, not a function or a type
 */
function isPatternName(name: string): boolean {
  return /^[A-Z][A-Z0-9_]*$/v.test(name) && !NOT_A_PATTERN.has(name);
}

/**
 * The value names one `{ ... }` import body names, dropping every
 * per-specifier `type` name and any `as` alias tail.
 * @param body - the text between an import's braces
 * @returns the value-imported names, in the body's own order
 */
function valueNamesFrom(body: string): string[] {
  const names: string[] = [];
  for (const raw of body.split(",")) {
    const name = raw.trim();
    if (name.length === 0 || name.startsWith("type ")) {
      continue;
    }
    const [first] = name.split(/\s+as\s+/v);
    names.push(first);
  }
  return names;
}

/**
 * Every module the registry is spread over, DERIVED from the tree
 * rather than listed: line-shapes.ts and each `line-shapes-*.ts`
 * family split out of it to keep that file under `max-lines`. Derived
 * so the rule below cannot be evaded by the next split - a family
 * moved into a new sibling is guarded the moment the file exists,
 * with no test edit to remember.
 *
 * The SAME derivation the completeness census works from
 * (scripts/metrics/registry-modules.ts), and shared rather than
 * spelled twice: this rule and rule (ii) of that census guard the
 * same set of files, and two walks that agree today are two walks
 * that can drift into a module one of them cannot see.
 */
const REGISTRY_MODULES = new Set(registryModuleNames(PARSE_DIR));

/**
 * Whether a file imports a PATTERN - a registry export
 * {@link isPatternName} recognizes as one - from one of the registry's
 * modules, as a value (not a `type`-only import).
 * @param file - path of a TypeScript file
 * @param modules - the module filenames to guard, without extensions;
 *   {@link REGISTRY_MODULES}
 * @returns true when the file takes a pattern from one of them
 */
function importsPatternFrom(
  file: string,
  modules: ReadonlySet<string>,
): boolean {
  const source = readFileSync(file, "utf8");
  const valueNames: string[] = [];
  for (const match of source.matchAll(
    /import\s+(?<wholeType>type\s+)?\{(?<body>[^\}]*)\}\s+from\s+"(?<specifier>[^"]+)"/gv,
  )) {
    const { groups } = match;
    if (groups === undefined) {
      continue;
    }
    if (!modules.has(path.basename(groups.specifier, ".js"))) {
      continue;
    }
    if (optionalGroup(groups.wholeType) === undefined) {
      valueNames.push(...valueNamesFrom(groups.body));
    }
  }
  return valueNames.some(isPatternName);
}

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

// How the reader reports a verdict to the classifier's trace hook, and
// the shape that spelling has when the line is nothing else: the call
// as its own statement. A line that names the hook and does not match
// the second is reading the hook's answer.
const TRACE_CALL = "classifyTrace.observer?.(";
const TRACE_STATEMENT = /^\s*classifyTrace\.observer\?\.\(/v;

/**
 * Sites in one file where the trace hook's answer is READ rather than
 * the hook simply being told: a condition, an assignment, a return, a
 * conjunct.
 * @param file - path of a TypeScript file under `src/parse`
 * @returns one `path:line: text` string per site
 */
function traceReadSites(file: string): string[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .flatMap((line, index) =>
      line.includes(TRACE_CALL) && !TRACE_STATEMENT.test(line)
        ? [`${file}:${String(index + 1)}: ${line.trim()}`]
        : [],
    );
}

/** The two files whose arms record what a separator line turned out to be. */
const ROLE_WRITERS = [
  "src/parse/lines/list-reader.ts",
  "src/parse/lines/item-tail.ts",
];

/**
 * Every separator role literal one file's arms write, one entry per
 * WRITE and not per line: a line carrying two writes yields two, so
 * the "exactly one" half of the row below is an assertion the check
 * can actually make.
 * @param file - path of a file whose arms record roles
 * @returns `path:line role` per write site, in file order
 */
function roleWrites(file: string): string[] {
  const write = /(?:this\.role|roles\.set)\([^;]*?, "(?<role>[a-z]+)"\);/gv;
  return readFileSync(file, "utf8")
    .split("\n")
    .flatMap((line, index) =>
      [...line.matchAll(write)].map(
        (match) => `${file}:${String(index + 1)} ${match.groups?.role ?? "?"}`,
      ),
    );
}

/**
 * The separator roles item-tail.ts declares, read off the declaration
 * so this row cannot fall out of step with the type.
 * @returns the union's members, as written
 */
function declaredRoles(): string[] {
  const source = readFileSync("src/parse/lines/item-tail.ts", "utf8");
  const union = /export type GapRole =(?<members>[^;]+);/v.exec(source);
  const members = union?.groups?.members ?? "";
  return [...members.matchAll(/"(?<role>[a-z]+)"/gv)].map(
    (match) => match.groups?.role ?? "",
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
  // src/ast.ts, and a GATE rather than prose: a 45th fails this row
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
  //
  // 46, moved up from 43 with TABLE STRUCTURE (issue #10): `table`,
  // `tableRow` and `tableCell` join the file, three discriminants for
  // the modeled table a builder can now assemble. None of the three
  // was a `BlockNode` or `DelimitedBlockNode` member when they
  // landed - `|===` still resolved to the opaque passthrough - so
  // this row moved before the reader and printer dispatch that would
  // reach the three, and before the wire that dispatch moves. Both
  // arrived two rows below.
  //
  // 47, moved up from 46 with the ESCAPED MARK (issue #84): `\*`,
  // `\_`, `` \` `` and `\#` become one leaf holding both bytes. ONE
  // kind and not four, unlike the pairs above, because the four
  // spellings answer every question identically - the node replays
  // its own two characters and holds no children - and the mark it
  // carries is already in the value. It moves the wire wherever a
  // document spelled one: a text run that held an escape now
  // serializes as a run, a node and a run.
  //
  // NO OUTPUT BYTE MOVES over the domain measured: the 1,614-document
  // corpus at printWidth 80 and 40, and two directed sweeps over the
  // four marks (1,052 inputs, widths 80 down to 14). OUTSIDE it one
  // does, and the witness is worth carrying: `aaa **` plus an escaped
  // backtick plus `abc` at printWidth 8 wrapped after `aaa` before
  // this kind existed and now stays on one 11-column line, because
  // the escape is an atom of its own and returns glue, so the packer
  // commits to the two-character `**` run in front of it and has
  // nowhere left to break. That is the behaviour every other verbatim
  // leaf in that position already had - `aaa **{attr}abc` is one
  // over-width line with or without this change - so it is an
  // existing class joined rather than a new one, and both spellings
  // render the same.
  // 48, moved up from 47 with FRONT MATTER (issue #21): `frontMatter`
  // joins as one leaf holding the whole block's bytes, opening fence
  // to closing fence. One kind with no children: under either of the
  // oracle's two readings the only correct output is the author's own
  // bytes, so the node replays them and the printer asks nothing else.
  //
  // 47, moved DOWN from 48 with the TABLE DISPATCH (issue #10):
  // `|===` now resolves to the `table` node the three rows above
  // added, the reader and printer reach it, and
  // the opaque passthrough that stood in for it - one more
  // `"delimitedBlock"` literal - is deleted. The count falls while
  // the tree gains a level of structure, which is the row above's
  // "directionless" said out loud: nothing was removed from the
  // language, one node kind replaced another and brought its rows and
  // cells with it. It moves the wire wherever a document holds a
  // table: what serialized as a `delimitedBlock` carrying its own
  // delimiter lines as text now serializes as a `table` carrying
  // cells. NOT ONE OUTPUT BYTE moves with it - the printer replays
  // the same partition the passthrough replayed.
  //
  // 50, moved up from 47 with DESCRIPTION LISTS (issue #9):
  // `descriptionList`, `descriptionListItem` and `descriptionTerm`
  // join the file. Three discriminants and not one, because a list, an
  // item and a term answer different questions - a list carries the
  // delimiter that decides structure, an item carries terms and the
  // body every list-like item has, and a term carries inline children
  // and nothing else: no marker, no blocks, no continuation state, so
  // none of those fields exists on it to be wrong. Unlike the table
  // kinds above them, the three arrive already dispatched:
  // `descriptionList` is a `BlockNode` member, a term line opens one
  // in the reader, and the printer has an arm for it. They move the
  // wire wherever a document spells a term line: what serialized as
  // one `paragraph` per term line now serializes as a
  // `descriptionList` with items, terms and a body.
  test("the node-kind census is 50", () => {
    const source = readFileSync("src/ast.ts", "utf8");
    const kinds = source.match(/^ {2}type: "[a-zA-Z]+";$/gmv) ?? [];
    expect(kinds).toHaveLength(50);
  });

  test("only the classification pass imports a pattern from the registry", () => {
    // NARROWER than the principle it enforces: a hand-rolled string test
    // bypasses it, so the residue is enforcement by review. What it does
    // catch is a consumer re-testing a line the classification pass
    // already classified.
    //
    // The pass is ONE file here, classify.ts, which is what makes the
    // set a one-name exemption rather than a list: every other module
    // under the reading core consumes a VERDICT. The two that used to
    // test patterns of their own ask classify.ts instead -
    // `metadataLineKind` for the item scan's four metadata shapes and
    // `isLiteralLine` / `isIndentedContinuationLine` for the two
    // indentation questions.
    //
    // "The registry" is every module of it, not the main table alone:
    // {@link REGISTRY_MODULES} is derived from the tree, so splitting a
    // pattern family into a `line-shapes-*.ts` sibling to stay under
    // `max-lines` does not move it out of this rule's reach.
    // Vacuity backstop: a derivation that found NO registry module
    // would pass this row by guarding nothing.
    expect(REGISTRY_MODULES.has("line-shapes")).toBe(true);
    const CLASSIFICATION_PASS = new Set(["classify.ts"]);
    const offenders = filesUnder("src/parse/lines")
      .filter((file) => !CLASSIFICATION_PASS.has(path.basename(file)))
      .filter((file) => importsPatternFrom(file, REGISTRY_MODULES));
    expect(offenders).toEqual([]);
  });

  // The classifier's trace hook is a REPORT, never an input: the reader
  // tells the observer what it decided and reads nothing back. A hook
  // whose answer entered a condition or an assignment would make the
  // installed harness able to change what the reader does, which is
  // exactly the derivation this layer is built to forbid.
  //
  // Textual and blunt, like the rows above: the call is pinned to its
  // own STATEMENT line, so `if (classifyTrace...`, `= classifyTrace...`,
  // `return classifyTrace...` and `x && classifyTrace...` all fail. A
  // legitimate future call site spells it the same way the four
  // existing ones do.
  //
  // ITS DOMAIN, stated so nobody reads more into a green run: ONE-LINE
  // spellings. Two bypasses are measured - an assignment long enough
  // that the printer puts the call on a line of its own, and a local
  // alias (`const seen = classifyTrace.observer;` then `seen?.(...)`)
  // - and neither is caught. That is the residue review covers, the
  // same trade the containment row above makes.
  test("the classify trace is called as a statement, never read", () => {
    const sites = filesUnder("src/parse").flatMap(traceReadSites);
    expect(sites, sites.join("\n")).toEqual([]);
  });

  // The item scan's separator vocabulary, checked against the arms
  // that speak it: every member of `GapRole` is written by some arm,
  // and every write names exactly one member.
  //
  // Why it is worth a row: the roles are what the post-loop's pop switch
  // reads (`popTakes`, item-tail.ts), and that switch is exhaustive,
  // so a role NOTHING writes would look answered-for while standing
  // for a fate no line ever gets - a vocabulary entry with no
  // producer, which is exactly the drift the classification rows
  // above watch for in the other direction. Six of the seven are the
  // loop's arms (list-reader.ts) and one is item-tail.ts's own
  // write over the `detached_continuation` slot (parser.rb l.1576).
  //
  // The seven come from the declaration itself rather than a list
  // here, so the row cannot fall out of step with the type. Textual
  // and blunt, like the rows above: it reads the two files' source.
  //
  // ITS DOMAIN, stated so nobody reads more into a green run: it
  // proves each write site names ONE role and that the seven are all
  // written SOMEWHERE. It does not prove the arm that writes a role
  // is the arm Ruby decides it in - that is what the cited parser.rb
  // line beside each write is for, and what review covers.
  test("every arm that writes a separator role writes exactly one", () => {
    const declared = declaredRoles();
    expect(declared).toHaveLength(7);
    const sites = ROLE_WRITERS.flatMap(roleWrites);
    // EXACTLY one: a line that writes two roles is two sites at the
    // same coordinate, and a coordinate seen twice is the offender.
    const seen = new Set<string>();
    const twice: string[] = [];
    for (const site of sites) {
      const [where] = site.split(" ");
      if (seen.has(where)) {
        twice.push(site);
      }
      seen.add(where);
    }
    expect(twice, twice.join("\n")).toEqual([]);
    const written = new Set(sites.map((site) => site.split(" ")[1]));
    expect([...written].toSorted()).toEqual(declared.toSorted());
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
