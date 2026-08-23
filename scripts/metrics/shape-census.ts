/**
 * The shape-registry completeness census (spec D7.1): a `bun run
 * metrics` gate in the same idiom as the node-kind census, housed with
 * the design budgets. Rule (i): every `DELIMITER_KINDS` entry has a
 * registry dimension. Rule (ii): every RUNTIME EXPORT NAME of
 * line-shapes.ts is either covered by a dimension's `covers` or named
 * in the EXEMPT map below, and neither list may go stale. Rule (iii):
 * the container and perturbation dimensions match the rosters below in
 * BOTH directions. Rule (iv): every construct dimension either reaches
 * a realized grid or is named in GRID_EXEMPT with its reason. Rule
 * (v): the realized grids are exactly the sizes every later task
 * cites. A pure set difference over runtime values, never a parse.
 *
 * Rules (iii)–(v) are review M2/m3 (2026-08-23). Rules (i)–(ii) reach
 * only `CONSTRUCTS`, so deleting one container and one perturbation
 * shrank the standing grid 2810 -> 2433 — discarding a
 * `b44-confined-extent` coordinate — with `metrics`, `lint` and `test`
 * all green. The plan's only defence was "the realized grid size
 * prints with every run so a shrink is visible", which is visible only
 * to a human who remembers the number. Five downstream tasks cite
 * 2,810; the number is now pinned where it fails.
 *
 * HONEST BOUNDS, all three (spec D7.1): this is NAME coverage, not
 * behavior coverage — a pattern added INSIDE an existing exported
 * rule, or a widening of an existing pattern's alternation, stays
 * invisible; CONSTRUCT coverage, not INTERACTION coverage — a novel
 * failure AXIS (a new kind of nesting, a new boundary) still requires
 * a human to add a dimension; and MODULE-scoped — the enumeration
 * names line-shapes.ts alone, so a new `line-shapes-*.ts` would be
 * invisible to it ("no patterns outside line-shapes.ts" is NOT
 * promotable to a standing gate: six src files define one regex each;
 * the narrower guard that exists is the β diff-grep floor, spec D5).
 * Rule (iv) adds a fourth: a dimension "reaches a grid" when its
 * canonical spelling appears in a realized input, which says the net
 * FEEDS the construct to the formatter — not that it varies it.
 */
import * as lineShapes from "../../src/parse/line-shapes.js";
import { DELIMITER_KINDS } from "../../src/parse/line-shapes.js";
import {
  CONSTRUCTS,
  CONTAINERS,
  headingAdjacencyGrid,
  PERTURBATIONS,
  standingGrid,
} from "../shape-registry.js";

// Runtime export names that are deliberately NOT dimensions, each with
// its reason. Helpers and enumeration sources only — a LINE SHAPE may
// never be exempted here; it gets a dimension.
const EXEMPT = new Map<string, string>([
  ["rstrip", "line-normalization helper, not a line shape"],
  [
    "isDelimiterLine",
    "pure predicate over DELIMITED_BLOCK_PATTERNS; rule (i) covers the shapes",
  ],
  [
    "listMarkerStyle",
    "pure predicate over LIST_MARKER_LINE; the list-marker dimension covers the shape",
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
    "DELIMITER_KINDS",
    "enumeration source consumed by rule (i), not a rule of its own",
  ],
  [
    "DELIMITED_BLOCK_PATTERNS",
    "enumeration source consumed by rule (i), not a rule of its own",
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
  "near-miss-terminator-inside",
  "closed-no-final-newline",
];

// Rule (iv)'s exemptions: construct dimensions whose canonical
// spelling reaches NO realized grid, each with the reason it is
// honest to leave outside the differential net. β ships the
// delimited-block grids only, so a construct that is neither a
// delimiter nor a heading-adjacency neighbour is census surface, not
// grid surface — and saying so here is the point: census-green must
// not read as grid-coverage (review m3).
const GRID_EXEMPT = new Map<string, string>([
  [
    "attribute-entry",
    "the heading-adjacency grid DOES exercise an attribute entry, but spells it `:a: 1` in its own inline list rather than reading this dimension's `:a: v`",
  ],
  [
    "callout",
    "callouts are a verbatim-interior concern; the delimited grids vary the block's ENDING, not its interior lines",
  ],
  [
    "dlist-term",
    "description lists are neither a delimited block nor a heading neighbour; their own grid is out of β (spec D9)",
  ],
  [
    "admonition-label",
    "the label form is a paragraph shape; the DELIMITED-admonition path (buildDelimitedAdmonition) is NOT grid-covered — no realized grid input carries a `[NOTE]` attrlist, so no row reaches it; the compound delimiter kinds exercise the delimiter, never the admonition variant",
  ],
  [
    "block-macro",
    "a leaf line with no interaction with block ends or headings in β's grids",
  ],
  ["thematic-break", "a leaf line, as block-macro"],
  ["page-break", "a leaf line, as block-macro"],
  [
    "indented-line",
    "the literal-indent family is a LIST-item concern tracked by the sweep's FAILING_TODAY allowlist, not by these grids",
  ],
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
]);

// Rule (v): the realized grid sizes every later task cites. The
// standing grid is 13 kinds x 18 containers x 12 perturbations plus
// the two setext pins; the adjacency grid is 10 constructs x 7
// positions plus 4 named explicit rows.
//
// TASK 4 does NOT add rows: the D10(d) containment coordinates are
// covered by named fixture expectations in
// tests/format/heading-adjacency.test.ts, because a row added at HEAD
// has no counterpart in the differential base dump this plan compares
// against. If a later task DOES extend headingAdjacencyGrid()'s
// source list, HEADING_ADJACENCY_GRID_SIZE below moves DELIBERATELY,
// in the same commit, to the count the new list produces — it is not
// a number to discover from a red gate and paste back.
const STANDING_GRID_SIZE = 2810;
const HEADING_ADJACENCY_GRID_SIZE = 74;

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
  const exportNames = new Set(Object.keys(lineShapes));
  const covered = new Set(CONSTRUCTS.flatMap((entry) => entry.covers ?? []));
  for (const name of exportNames) {
    if (!covered.has(name) && !EXEMPT.has(name)) {
      failures.push(
        `shape census: line-shapes.ts export ${name} is neither covered by a registry dimension nor exempted (rule (ii)) — teach scripts/shape-registry.ts the construct, or write the exemption down in scripts/metrics/shape-census.ts`,
      );
    }
  }
  for (const name of covered) {
    if (!exportNames.has(name)) {
      failures.push(
        `shape census: registry dimension covers ${name}, which line-shapes.ts no longer exports (stale covers entry)`,
      );
    }
  }
  for (const name of EXEMPT.keys()) {
    if (!exportNames.has(name)) {
      failures.push(
        `shape census: EXEMPT names ${name}, which line-shapes.ts no longer exports (stale exemption)`,
      );
    }
  }
  return failures;
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
 * Rule (v): the realized grids are the sizes every later task cites.
 * @param standing - the standing grid's realized length
 * @param adjacency - the heading-adjacency grid's realized length
 * @returns one message per shrunk or grown grid
 */
function gridSizeFailures(standing: number, adjacency: number): string[] {
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
  return failures;
}

/**
 * Every way the registry and the line-shapes module disagree.
 * @returns one message per failure; empty means the census is green
 */
export function shapeCensusFailures(): string[] {
  const standing = standingGrid();
  const adjacency = headingAdjacencyGrid();
  const inputs = [...standing, ...adjacency].map((shape) => shape.input);
  return [
    ...delimiterKindFailures(),
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
    ...gridCoverageFailures(inputs),
    ...gridSizeFailures(standing.length, adjacency.length),
  ];
}
