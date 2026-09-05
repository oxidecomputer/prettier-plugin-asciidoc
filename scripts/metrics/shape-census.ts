/**
 * The shape-registry completeness census: a `bun run
 * metrics` gate in the same idiom as the node-kind census, housed with
 * the design budgets. Rule (i): every `DELIMITER_KINDS` entry has a
 * registry dimension. Rule (ii): every RUNTIME EXPORT NAME of every
 * registry module (line-shapes.ts and each `line-shapes-*.ts` it is
 * split over) is either covered by a dimension's `covers` or named in
 * the EXEMPT map below; neither list may go stale, and neither may the
 * module list itself. Rule (iii):
 * the container, perturbation and byte-operator dimensions match the
 * rosters below in BOTH directions. Rule (iv): every construct
 * dimension either reaches a realized grid or is named in GRID_EXEMPT
 * with its reason. Rule
 * (v): the realized grids are exactly the sizes pinned below,
 * `pairGrid()` included. A pure set difference over runtime values,
 * never a parse.
 *
 * The pair grid runs its own rule (iv) analog
 * (`pairAlphabetCoverageFailures`): every pair-alphabet member,
 * `CONSTRUCTS`' bodies and near misses again, this time squared, must
 * reach a realized `pairGrid()` input. It has no GRID_EXEMPT twin
 * because the pair alphabet has no leaf-line carve-out: every member
 * pairs with every other member, so an unreached one names a wrong
 * body, not a construct outside grid surface.
 *
 * Rules (iii)–(v) exist because rules (i)–(ii) reach only
 * `CONSTRUCTS`: deleting one container and one perturbation once
 * shrank the standing grid from 2,810 to 2,433 — discarding a
 * confined-extent coordinate — with `metrics`, `lint` and `test` all
 * green. A realized size that merely prints with every run is visible
 * only to a human who remembers the number, so the size is pinned
 * where the shrink fails.
 *
 * HONEST BOUNDS, all three: this is NAME coverage, not
 * behavior coverage — a pattern added INSIDE an existing exported
 * rule, or a widening of an existing pattern's alternation, stays
 * invisible; CONSTRUCT coverage, not INTERACTION coverage — a novel
 * failure AXIS (a new kind of nesting, a new boundary) still requires
 * a human to add a dimension; and REGISTRY-scoped: the enumeration
 * covers line-shapes.ts and each `line-shapes-*.ts` sibling it is
 * split over, and nothing else. That list is no longer a hand-written
 * one that can go stale: `registryModuleFailures` reads the directory
 * and fails until the census imports every module it finds, so a
 * family moved into a new sibling cannot slip past rule (ii). It
 * reads it through the SAME derivation the pattern-import rule in
 * tests/parser/architecture.test.ts uses
 * (scripts/metrics/registry-modules.ts), so the two rules cannot
 * disagree about which files they are holding. What
 * stays outside is a pattern defined somewhere else entirely ("no
 * patterns outside the registry" is NOT promotable to a standing
 * gate: six src files define one regex each; the narrower guard that
 * exists is the diff-grep floor).
 * Rule (iv) adds a fourth: a dimension "reaches a grid" when its
 * canonical spelling appears in a realized input, which says the net
 * FEEDS the construct to the formatter — not that it varies it.
 */
import * as lineShapes from "../../src/parse/line-shapes.js";
import * as descriptionShapes from "../../src/parse/line-shapes-description.js";
import * as interruptionShapes from "../../src/parse/line-shapes-interruption.js";
import { DELIMITER_KINDS } from "../../src/parse/line-shapes.js";
import { listRunGrid } from "../shape-registry-list-run.js";
import { REGISTRY_DIRECTORY, registryModuleNames } from "./registry-modules.js";
import {
  BYTE_OPERATORS,
  CONSTRUCTS,
  CONTAINERS,
  headingAdjacencyGrid,
  pairAlphabet,
  pairGrid,
  PERTURBATIONS,
  standingGrid,
} from "../shape-registry.js";

// The census reads VALUES, so it must import each registry module
// statically; registryModuleNames() is what stops that hand-written
// list from going stale, and it is the SAME answer the pattern-import
// rule in tests/parser/architecture.test.ts works from.
// Every module the registry is spread over, by the basename the
// directory spells. Rule (ii) enumerates the exports of ALL of them:
// the registry is a set of tables, not a file, and a family split out
// of line-shapes.ts to stay under `max-lines` must not thereby leave
// the coverage rule. `registryModuleFailures` holds this map to the
// directory in both directions, so the next split fails the census
// until it is named here.
const REGISTRY_MODULES: ReadonlyMap<string, readonly string[]> = new Map([
  ["line-shapes", Object.keys(lineShapes)],
  ["line-shapes-description", Object.keys(descriptionShapes)],
  ["line-shapes-interruption", Object.keys(interruptionShapes)],
]);

// The per-context interrupting sets, exported from the registry so
// the tables in line-shapes-interruption.ts can be spelled FROM the
// patterns instead of beside them. Each is a composition of patterns
// that already have dimensions of their own (delimiter lines, block
// attribute line, block anchor, continuation line, list markers,
// block macro, admonition label, thematic break, page break), and a
// composition of dimensions is not itself a line shape.
const INTERRUPTER_SET_REASON =
  "one context's interrupting set, a composition of covered patterns";

const INTERRUPTER_SETS: ReadonlyArray<readonly [string, string]> = [
  "PARAGRAPH_INTERRUPTERS",
  "LIST_ITEM_INTERRUPTERS",
  "LIST_ITEM_FIRST_LINE_INTERRUPTERS",
  "LIST_ITEM_LATER_BLOCK_INTERRUPTERS",
  "DLIST_FIRST_LINE_INTERRUPTERS",
  "DLIST_ITEM_ANY_LINE_INTERRUPTERS",
].map((name) => [name, INTERRUPTER_SET_REASON]);

// Runtime export names that are deliberately NOT dimensions, each with
// its reason. Helpers and enumeration sources only — a LINE SHAPE may
// never be exempted here; it gets a dimension.
const EXEMPT = new Map<string, string>([
  ["rstrip", "line-normalization helper, not a line shape"],
  [
    "ASCII_WHITESPACE",
    String.raw`Ruby's \s spelled as a regex class, a whitespace-classification helper shared by src/print, not a line shape`,
  ],
  [
    "ASCII_HORIZONTAL_WHITESPACE",
    "ASCII_WHITESPACE minus the newline, a whitespace-classification helper shared by src/print, not a line shape",
  ],
  [
    "ASCII_NON_WHITESPACE",
    "the negation of ASCII_WHITESPACE, a whitespace-classification helper shared by src/print, not a line shape",
  ],
  [
    "startsSectionTitle",
    "reflow's refusal predicate over the section-title shapes, whose one pattern spells both marker forms and already has a dimension of its own; a composition of dimensions is not itself a line shape",
  ],
  [
    "startsBlockAtLineStart",
    "the line-start refusal that composes three existing dimensions (interruptsByLineShape, startsSectionTitle, isRawParagraphLine) over two probe spellings; every shape it asks about already has a dimension of its own, and a composition of dimensions is not itself a line shape",
  ],
  [
    "startsItemBlockLine",
    "the line-START refusal a description's item asks: startsBlockAtLineStart widened by the three shapes an item's confined read drains (block title, attribute entry, line comment), so six shape questions in all; every shape it asks about already has a dimension of its own, and a composition of dimensions is not itself a line shape",
  ],
  [
    "endsDescriptionLine",
    "the line-END refusal a description's item asks, composing three of those same six dimensions (interruptsByLineShape, startsSectionTitle, isRawParagraphLine) over two probe spellings, one bare and one carrying the item's term head; the shapes it can report, the block macro above all, each have a dimension already. It asks FEWER than its line-start twin because the three it omits are decided by a line's head, which a probe PREFIX overwrites and a probe SUFFIX cannot supply. A shape that constrains both ends of a line is therefore invisible to both, and those are carried as word-pair clauses by the run predicate that reads these two (src/parse/lines/description-list.ts), not by either predicate here",
  ],
  [
    "BLOCK_START_CONTEXT",
    "the reader-state value every line rule is asked against at a block start, not a line shape",
  ],
  [
    "ATTRLIST_LEADING_CHARACTER",
    "the class BLOCK_ATTRIBUTE_LINE (its own dimension, covers: BLOCK_ATTRIBUTE_LINE) already requires of the byte right after `[` - re-exported for src/parse/attrlist.ts's printer-side canonicalField, which asks it before unquoting an interior's first field, never for reading a line; a helper shared across the boundary, not a second line shape",
  ],
  [
    "ATTRIBUTE_CONTINUATION",
    "matches the two-character suffix of an attribute entry's VALUE, not a line: it is the one export here that is not a whole-line rule, and the line it belongs to is covered by the attribute-entry dimension",
  ],
  [
    "FRONT_MATTER_FENCE",
    "the `---` line a document's YAML front matter opens and closes with, and the one whole-line spelling here that is not a line SHAPE: what makes it a fence is the POSITION plus a second fence below (src/parse/lines/front-matter.ts), so a dimension - which spells its construct into every container the grids wrap - would spell a line that is ordinary text in all of them",
  ],
  [
    "optionalGroup",
    "named-group reading helper shared by the parse functions, not a line shape",
  ],
  [
    "isDelimiterLine",
    "pure predicate over DELIMITED_BLOCK_PATTERNS; rule (i) covers the shapes",
  ],
  [
    "listMarkerStyle",
    "pure predicate over LIST_MARKER_LINE; the list-marker dimension covers the shape",
  ],
  [
    "orderedMarkerStyle",
    "resolve_ordered_list_marker over an ordered marker the registry already matched; the list-marker dimension covers the shape",
  ],
  [
    "conditionalDirective",
    "pure reading over CONDITIONAL_DIRECTIVE, which the conditional-directive dimension already covers; this one answers what the line does to the reader's conditional stack, not what shape it is",
  ],
  [
    "continuationMetadataKind",
    "names which of four metadata shapes a live list continuation plays out across; each of the four (block title, block attribute line, block anchor, attribute entry) already has its own dimension",
  ],
  [
    "isDescriptionListLine",
    "pure predicate over the dlist patterns; the dlist-term dimension covers the shape",
  ],
  [
    "interruptsParagraph",
    "context dispatcher over the interrupting sets, not a shape",
  ],
  [
    "interruptsByLineShape",
    "context dispatcher over the interrupting sets, not a shape",
  ],
  [
    "isRawParagraphLine",
    "context dispatcher over the raw-shape rules, not a shape",
  ],
  [
    "rawLineForm",
    "names which of the three context-free raw patterns matched; each has its own dimension",
  ],
  [
    "DELIMITER_KINDS",
    "enumeration source consumed by rule (i), not a rule of its own",
  ],
  [
    "DELIMITED_BLOCK_PATTERNS",
    "enumeration source consumed by rule (i), not a rule of its own",
  ],
  [
    "LINE_COMMENT_HEAD",
    "string head shared by skip_line_comments consumers; the line-comment dimension covers the shape",
  ],
  ...INTERRUPTER_SETS,
  [
    "isDescriptionSiblingLine",
    "pure predicate over the dlist SIBLING patterns, which are DescriptionListRx keyed by delimiter; the dlist-term dimension covers the shape",
  ],
  [
    "isSingleWordLine",
    "whitespace-classification predicate in the ASCII_* family's dialect - 'this line holds one word' names no AsciiDoc construct, and the shapes a one-word line can spell (a marker, a delimiter, a section title) each have their own dimension already",
  ],
]);

// Rule (iii)'s rosters: the container and perturbation dimensions the
// standing grid is BUILT from. Written down here rather than derived,
// because deriving them from the registry is exactly the tautology
// that let a deletion pass: this is the second copy a deletion has to
// agree with, and adding a dimension is a deliberate two-file edit.
const CONTAINER_IDS: readonly string[] = [
  "doc",
  "item",
  "nested-item",
  "item-unterminated-example",
  "under-title",
  "under-attrlist",
  "in-example",
  "in-open",
  "in-sidebar",
  "in-quote",
  "after-fence",
  "after-h0-adjacent",
  "after-h0-blank",
  "after-h1-adjacent",
  "after-h1-blank",
  "after-h2-adjacent",
  "before-h1-adjacent",
  "before-h1-blank",
  "under-note-attrlist",
  "dlist-desc",
  "dlist-desc-line",
];

const PERTURBATION_IDS: readonly string[] = [
  "closed",
  "unterminated",
  "unterminated-then-blank-text",
  "terminator-trailing-ws",
  "closed-then-text-adjacent",
  "trailing-plus-after-close",
  "metadata-above-close",
  "heading-inside",
  "foreign-marker-inside",
  "longer-delimiter-inside",
  "minimum-delimiter-inside",
  "near-miss-terminator-inside",
  "closed-no-final-newline",
];

const BYTE_OPERATOR_IDS: readonly string[] = [
  "trailing-space",
  "trailing-tab",
  "trailing-vt",
  "trailing-ff",
  "trailing-space-first-line",
  "crlf",
  "no-final-newline",
  "bom",
];

// Rule (iv)'s exemptions: construct dimensions whose canonical
// spelling reaches NO realized grid, each with the reason it is
// honest to leave outside the differential net. The grids that exist
// are the delimited-block ones, so a construct that is neither a
// delimiter nor a heading-adjacency neighbour is census surface, not
// grid surface — and saying so here is the point: census-green must
// not read as grid-coverage.
const GRID_EXEMPT = new Map<string, string>([
  [
    "attribute-entry",
    "the heading-adjacency grid DOES exercise an attribute entry, but spells it `:a: 1` in its own inline list rather than reading this dimension's `:a: v`",
  ],
  [
    "dlist-term",
    "description lists are neither a delimited block nor a heading neighbour; they have no grid of their own",
  ],
  [
    "admonition-label",
    "the label form is a paragraph shape never realized by these grids; the DELIMITED-admonition path (buildDelimitedAdmonition) IS grid-covered — the under-note-attrlist container puts a [NOTE] attrlist over every compound delimiter kind",
  ],
  [
    "block-macro",
    "a leaf line with no interaction with block ends or headings in these grids",
  ],
  ["thematic-break", "a leaf line, as block-macro"],
  ["page-break", "a leaf line, as block-macro"],
  [
    "include",
    "preprocessor directive; the conditional dimension carries the adjacency coordinate for that class",
  ],
  [
    "styled-verbatim-opener",
    "the style is decided at open and the delimiter grid already varies every verbatim role; the bare `[source]` opener adds no ENDING coordinate",
  ],
  [
    "styled-paragraph-opener",
    "as styled-verbatim-opener, for the compound roles",
  ],
  [
    "indented-continuation",
    "the shape only MEANS anything on the line after a list item's marker line, where the dedent that can turn it into a bare `+` runs; none of these grids puts a construct there, so the coordinate lives in the item-text rows of tests/format/breaks.test.ts instead",
  ],
]);

// Rule (v): the realized grid sizes, pinned. The
// standing grid is 14 kinds x 21 containers x 13 perturbations plus
// the three setext pins (the roster grew by the dlist-desc and
// dlist-desc-line containers, and by a fourteenth kind,
// openBlockTilde, issue #64; the thirteenth perturbation is
// minimum-delimiter-inside, the reverse of longer-delimiter-inside,
// issue #162); the adjacency grid is 10 constructs x 7
// positions plus 9 named explicit rows (the original 4 + the 5 R2
// rows); the
// list-run grid is a standing selection (its arithmetic is
// spelled at listRunGrid()); the pair grid is a 111-member alphabet
// (every CONSTRUCTS body plus every near miss - a delimiter kind
// contributes 4: its body and its three generic near misses) squared,
// x 2 joins (adjacent, blank) x 3 containers (doc, item,
// dlist-desc-line) = 73,926, with no realized duplicates to dedupe
// away at that size (openBlockTilde's own 4 alphabet members, added
// by issue #64, raised the 107-member alphabet this pin last measured
// to 111). New
// rows are realizable against any
// base — shape-diff hands head-generated inputs to the base dumper —
// so a grid extension moves its pin DELIBERATELY, in the same commit,
// to the count the new source list produces; it is not a number to
// discover from a red gate and paste back.
const STANDING_GRID_SIZE = 3825;
const HEADING_ADJACENCY_GRID_SIZE = 79;
const LIST_RUN_GRID_SIZE = 104;
const PAIR_GRID_SIZE = 73_926;

/**
 * Rule (i): every delimiter kind has a registry dimension.
 * @returns one message per uncovered kind
 */
function delimiterKindFailures(): string[] {
  const dimensionKinds = new Set(
    CONSTRUCTS.flatMap((entry) =>
      entry.delimiter === undefined ? [] : [entry.delimiter],
    ),
  );
  return DELIMITER_KINDS.flatMap((kind) =>
    dimensionKinds.has(kind)
      ? []
      : [
          `shape census: DELIMITER_KINDS entry ${kind} has no registry dimension (rule (i)) — add one to scripts/shape-registry.ts`,
        ],
  );
}

/**
 * Rule (ii): every line-shapes runtime export is covered or exempt,
 * and neither list may go stale.
 * @returns one message per disagreement
 */
function exportNameFailures(): string[] {
  const failures: string[] = [];
  const modules = [...REGISTRY_MODULES].flatMap(([module, names]) =>
    names.map((name) => ({ module, name })),
  );
  const exportNames = new Set(modules.map((entry) => entry.name));
  const covered = new Set(CONSTRUCTS.flatMap((entry) => entry.covers ?? []));
  for (const { module, name } of modules) {
    if (!covered.has(name) && !EXEMPT.has(name)) {
      failures.push(
        `shape census: ${module}.ts export ${name} is neither covered by a registry dimension nor exempted (rule (ii)); teach scripts/shape-registry.ts the construct, or write the exemption down in scripts/metrics/shape-census.ts`,
      );
    }
  }
  for (const name of covered) {
    if (!exportNames.has(name)) {
      failures.push(
        `shape census: registry dimension covers ${name}, which no registry module exports any more (stale covers entry)`,
      );
    }
  }
  for (const name of EXEMPT.keys()) {
    if (!exportNames.has(name)) {
      failures.push(
        `shape census: EXEMPT names ${name}, which no registry module exports any more (stale exemption)`,
      );
    }
  }
  return failures;
}

/**
 * Rule (ii)'s own premise: the modules the census enumerates are
 * exactly the registry modules on disk. Checked in both directions,
 * because the failure this catches is silent - a family split into a
 * new `line-shapes-*.ts` that nothing imports here would leave rule
 * (ii) passing while covering nothing.
 * @returns one message per disagreement
 */
function registryModuleFailures(): string[] {
  const onDisk = new Set(registryModuleNames());
  return [
    ...[...onDisk]
      .filter((name) => !REGISTRY_MODULES.has(name))
      .map(
        (name) =>
          `shape census: ${REGISTRY_DIRECTORY}/${name}.ts is a registry module the census does not enumerate (rule (ii)). Import it in scripts/metrics/shape-census.ts and name it in REGISTRY_MODULES, or its exports are covered by nothing`,
      ),
    ...[...REGISTRY_MODULES.keys()]
      .filter((name) => !onDisk.has(name))
      .map(
        (name) =>
          `shape census: REGISTRY_MODULES names ${name}, which ${REGISTRY_DIRECTORY}/ no longer holds (stale module entry)`,
      ),
  ];
}

/**
 * Rule (iii) for one dimension class: the registry's ids and the
 * roster above must agree in both directions.
 * @param dimension - the class's name, for the message
 * @param actual - the ids the registry declares
 * @param roster - the ids this census expects
 * @returns one message per disagreement
 */
function rosterFailures(
  dimension: string,
  actual: readonly string[],
  roster: readonly string[],
): string[] {
  const failures: string[] = [];
  const declared = new Set(actual);
  const expected = new Set(roster);
  for (const id of expected) {
    if (!declared.has(id)) {
      failures.push(
        `shape census: ${dimension} dimension ${id} is gone from scripts/shape-registry.ts (rule (iii)) — a dimension the grid shrinks by; delete it from the roster in scripts/metrics/shape-census.ts in the same commit if the removal is deliberate`,
      );
    }
  }
  for (const id of declared) {
    if (!expected.has(id)) {
      failures.push(
        `shape census: ${dimension} dimension ${id} is new (rule (iii)) — add it to the roster in scripts/metrics/shape-census.ts, and move the grid-size pin with it`,
      );
    }
  }
  return failures;
}

/**
 * Rule (iv): every construct dimension either reaches a realized grid
 * or is exempted with a reason, and no exemption may go stale.
 * @param inputs - every realized shape's input document
 * @returns one message per disagreement
 */
function gridCoverageFailures(inputs: readonly string[]): string[] {
  const failures: string[] = [];
  const reaches = (body: string): boolean =>
    inputs.some((input) => input.includes(body));
  const ids = new Set(CONSTRUCTS.map((entry) => entry.id));
  for (const entry of CONSTRUCTS) {
    if (reaches(entry.body)) {
      const reason = GRID_EXEMPT.get(entry.id);
      if (reason !== undefined) {
        failures.push(
          `shape census: construct ${entry.id} now reaches a grid, so its GRID_EXEMPT reason is stale (rule (iv)): ${reason}`,
        );
      }
      continue;
    }
    const reason = GRID_EXEMPT.get(entry.id);
    if (reason === undefined) {
      failures.push(
        `shape census: construct ${entry.id} generates no shape — its spelling ${JSON.stringify(entry.body)} appears in no realized input (rule (iv)). Give it a grid row, or write the exemption down in scripts/metrics/shape-census.ts so census-green is not read as grid coverage`,
      );
    }
  }
  for (const id of GRID_EXEMPT.keys()) {
    if (!ids.has(id)) {
      failures.push(
        `shape census: GRID_EXEMPT names construct ${id}, which the registry no longer declares (stale exemption)`,
      );
    }
  }
  return failures;
}

/**
 * The pair grid's rule (iv) analog: every pair-alphabet member (a
 * construct body or one of its near misses) must reach at least one
 * realized `pairGrid()` input, the same "canonical spelling appears in
 * a realized input" test rule (iv) runs for `CONSTRUCTS`. Unlike rule
 * (iv), this has no exemption map: `PAIR_CONTAINER_IDS` is a fixed
 * three-container subset, but every alphabet member pairs with every
 * other member, so an unreached member means the member's own body is
 * wrong (empty, or a substring of something else), not that the
 * dimension is legitimately outside grid surface.
 * @param pairInputs - every realized pairGrid() shape's input document
 * @returns one message per alphabet member that reaches no pair row
 */
function pairAlphabetCoverageFailures(pairInputs: readonly string[]): string[] {
  const reaches = (body: string): boolean =>
    pairInputs.some((input) => input.includes(body));
  return pairAlphabet().flatMap((member) =>
    reaches(member.body)
      ? []
      : [
          `shape census: pair alphabet member ${member.id} reaches no realized pairGrid() input (rule (iv) analog): its body never appears inside a realized pair; check the alphabet entry in scripts/shape-registry-pairs.ts`,
        ],
  );
}

/**
 * Rule (v): the realized grids are the sizes pinned in this module.
 * @param standing - the standing grid's realized length
 * @param adjacency - the heading-adjacency grid's realized length
 * @param listRun - the list-run grid's realized length
 * @param pair - the pair grid's realized length
 * @returns one message per shrunk or grown grid
 */
function gridSizeFailures(
  standing: number,
  adjacency: number,
  listRun: number,
  pair: number,
): string[] {
  const failures: string[] = [];
  if (standing !== STANDING_GRID_SIZE) {
    failures.push(
      `shape census: standingGrid() realized ${String(standing)} shapes, not the pinned ${String(STANDING_GRID_SIZE)} (rule (v)) — the realized grid no longer matches the pin, and a shrink narrows the net silently; move the pin in scripts/metrics/shape-census.ts only when the change is deliberate`,
    );
  }
  if (adjacency !== HEADING_ADJACENCY_GRID_SIZE) {
    failures.push(
      `shape census: headingAdjacencyGrid() realized ${String(adjacency)} shapes, not the pinned ${String(HEADING_ADJACENCY_GRID_SIZE)} (rule (v)) — the realized grid no longer matches the pin, and a shrink narrows the net silently; move the pin in scripts/metrics/shape-census.ts only when the change is deliberate`,
    );
  }
  if (listRun !== LIST_RUN_GRID_SIZE) {
    failures.push(
      `shape census: listRunGrid() realized ${String(listRun)} shapes, not the pinned ${String(LIST_RUN_GRID_SIZE)} (rule (v)) — the realized grid no longer matches the pin, and a shrink narrows the net silently; move the pin in scripts/metrics/shape-census.ts only when the change is deliberate`,
    );
  }
  if (pair !== PAIR_GRID_SIZE) {
    failures.push(
      `shape census: pairGrid() realized ${String(pair)} shapes, not the pinned ${String(PAIR_GRID_SIZE)} (rule (v)): the realized grid no longer matches the pin, and a shrink narrows the net silently; move the pin in scripts/metrics/shape-census.ts only when the change is deliberate`,
    );
  }
  return failures;
}

/**
 * One pinned census: what this checkout realizes, against the number
 * written down for it.
 *
 * Reported, not ratcheted, and the wording of every field here is
 * deliberate. A census is NOT a minimize-budget — "as simple as
 * possible, but not simpler"; one more node kind than the last count
 * is fine, and a grid of 3,000 shapes is not worse than one of 2,966.
 * It is an
 * EQUALITY PIN whose contract is "move the pin only when deliberate",
 * so neither direction is a win and neither is a loss. What the row
 * buys is that a human SEES the move — the standing grid once shrank
 * from 2,810 to 2,433 with `metrics`, `lint` and `test` all green,
 * because the number printed nowhere and nobody remembered it.
 */
export interface CensusPin {
  /** What is being counted, in the reader's words. */
  readonly what: string;
  /** What this checkout realizes. */
  readonly realized: number;
  /** The number written down for it. */
  readonly pinned: number;
}

/**
 * The pinned censuses, for the scorecard to print.
 *
 * The node-kind census is NOT here: it is pinned in
 * `tests/parser/architecture.test.ts`, which owns both the count and
 * the pin, and lifting the number into a second file would create the
 * one thing a pin cannot survive — two spellings that can disagree.
 * It is directionless for the same reason these are, and says so in
 * its own words there.
 * @returns one entry per pinned census, in report order
 */
export function censusPins(): CensusPin[] {
  return [
    {
      what: "standing grid",
      realized: standingGrid().length,
      pinned: STANDING_GRID_SIZE,
    },
    {
      what: "heading-adjacency grid",
      realized: headingAdjacencyGrid().length,
      pinned: HEADING_ADJACENCY_GRID_SIZE,
    },
    {
      what: "list-run grid",
      realized: listRunGrid().length,
      pinned: LIST_RUN_GRID_SIZE,
    },
    {
      what: "pair grid",
      realized: pairGrid().length,
      pinned: PAIR_GRID_SIZE,
    },
  ];
}

/**
 * Every way the registry and the line-shapes module disagree.
 * @returns one message per failure; empty means the census is green
 */
export function shapeCensusFailures(): string[] {
  const standing = standingGrid();
  const adjacency = headingAdjacencyGrid();
  const listRun = listRunGrid();
  const pair = pairGrid();
  const inputs = [...standing, ...adjacency, ...listRun].map(
    (shape) => shape.input,
  );
  const pairInputs = pair.map((shape) => shape.input);
  return [
    ...delimiterKindFailures(),
    ...registryModuleFailures(),
    ...exportNameFailures(),
    ...rosterFailures(
      "container",
      CONTAINERS.map((entry) => entry.id),
      CONTAINER_IDS,
    ),
    ...rosterFailures(
      "perturbation",
      PERTURBATIONS.map((entry) => entry.id),
      PERTURBATION_IDS,
    ),
    ...rosterFailures(
      "byte-operator",
      BYTE_OPERATORS.map((entry) => entry.id),
      BYTE_OPERATOR_IDS,
    ),
    ...gridCoverageFailures(inputs),
    ...pairAlphabetCoverageFailures(pairInputs),
    ...gridSizeFailures(
      standing.length,
      adjacency.length,
      listRun.length,
      pair.length,
    ),
  ];
}
