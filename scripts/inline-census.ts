/**
 * The inline-registry completeness census, in the idiom
 * `scripts/metrics/shape-census.ts` holds the line registry to.
 *
 * WHAT HOLDS A NEW KIND IS THE COMPILER, not this file. The registry
 * spells its constructs as a `Record<InlineKind, ...>`, so a kind
 * added to the inline vocabulary is a `tsc` error - `bun run check` -
 * before any of these rules run, and the rules below can take it as
 * given that every kind has a dimension. That is why rule (i) here
 * reads in ONE direction only: a dimension whose rule row went away
 * is the case a type cannot see.
 *
 * Six rules. (i) Every construct dimension is an `INLINE_RULES` row,
 * or the one named fallback kind the table has no row for. (ii)
 * Every valid spelling in the registry tokenizes to the kind it is
 * filed under. (iii) Every RUNTIME EXPORT NAME of
 * `src/parse/inline/rules.ts` is either the enumeration source or
 * named in the exemption map below, and neither list may go stale.
 * (iv) The neighbourhood, context, pair-context and pair-join rosters
 * match the lists below in BOTH directions. (v) Every alphabet member
 * reaches a realized standing input, reaches a realized pair input,
 * and fits the reflow-edge body budget. (vi) The realized grids are
 * exactly the sizes pinned below.
 *
 * Rule (ii) is what makes this census stronger than a name
 * comparison. A dimension can name a kind and spell it wrongly - a
 * body that no rule reads as the construct it claims to be feeds the
 * formatter a document, passes every set-difference rule, and
 * exercises nothing. Asking the TOKENIZER closes that: the registry's
 * spelling for `BoldMark` has to actually produce a `BoldMark` token.
 *
 * HONEST BOUNDS, three of them, the same three the line-shape census
 * states in its own words. This is NAME coverage, not BEHAVIOR
 * coverage: a pattern widened INSIDE an existing rule is invisible
 * here, and so is a second `INLINE_RULES` row added for a kind that
 * already has a dimension. It is CONSTRUCT coverage, not INTERACTION
 * coverage: a novel failure axis - a new neighbourhood, a new context
 * - still needs a human to add a dimension. And it is MODULE-scoped
 * to `src/parse/inline/rules.ts`: the whole-fragment scans that
 * decide the curved-quote, doubled-mark, super/sub and
 * character-reference rows live in sibling modules whose exports this
 * census never reads, so a spelling those modules learn reaches the
 * grid only when somebody writes it down here.
 *
 * A LIBRARY module, not a command: the always-on gate
 * (`tests/conformance/inline-sweep-census.test.ts`) imports it. A
 * pure set difference over runtime values, never a parse.
 */
import * as inlineRules from "../src/parse/inline/rules.js";
import { INLINE_RULES } from "../src/parse/inline/rules.js";
import { tokenizeInline } from "../src/parse/inline/tokenize.js";
import type { InlineKind } from "../src/parse/inline/tokens.js";
import type { CensusPin } from "./metrics/shape-census.js";
import {
  CONTEXTS,
  FILLER_EDGE,
  INLINE_CONSTRUCTS,
  inlineAlphabet,
  inlinePairGrid,
  inlineStandingGrid,
  NEIGHBOURHOODS,
  PAIR_CONTEXT_IDS,
  PAIR_JOIN_IDS,
  REFLOW_EDGE_BODY_BUDGET,
} from "./inline-registry.js";

// The one kind the registry carries that `INLINE_RULES` has no row
// for: `InlineChar` is the tokenizer's else branch for a position no
// rule claimed (src/parse/inline/tokens.ts), and its spellings are
// still grid surface, so rule (i) names it rather than reconciling it
// away.
const TABLELESS_KIND: InlineKind = "InlineChar";

// Rule (iii)'s exemptions: runtime export names of rules.ts that are
// deliberately not the enumeration source, each with its reason. A
// RULE TABLE may never be exempted here; it gets read.
const EXEMPT = new Map<string, string>([
  [
    "markFlags",
    "the open/close boundary facts a mark token carries, read by the tokenizer for a token an INLINE_RULES row has already matched, not a construct of its own",
  ],
]);

// Rule (iv)'s rosters, written down rather than derived, for the
// reason the line-shape census writes its own down: deriving them
// from the registry is the tautology that lets a deletion pass
// unnoticed. This is the second copy a deletion has to agree with,
// and adding a dimension is a deliberate two-file edit.
const NEIGHBOURHOOD_IDS: readonly string[] = [
  "bare",
  "in-word",
  "spaced",
  "escaped",
  "bracketed",
  "role-head",
  "open-bracket",
  "bracket-backslash",
  "close-bracket",
  "repeated",
  "in-bold",
  "in-mono",
  "trailing-mark",
  "reflow",
  "reflow-edge",
];

const CONTEXT_IDS: readonly string[] = [
  "para",
  "para-tail",
  "item",
  "dlist-desc",
  "section-title",
  "block-title",
  "admonition",
  "cell",
];

const PAIR_JOINS: readonly string[] = [
  "adjacent",
  "spaced",
  "bracket",
  "comment",
  "tab-dash",
];

const PAIR_CONTEXTS: readonly string[] = ["para", "item", "cell"];

// The width the sweep formats at. `formatAdoc` passes no override, so
// Prettier's own default is what decides where a reflowed line breaks
// - which is what makes the reflow-edge arithmetic below a fact and
// not a guess.
const PRINT_WIDTH = 80;

// Rule (vi): the realized grid sizes, pinned. The standing grid is a
// 146-member alphabet x 15 neighbourhoods x 8 contexts, less the
// realizations two coordinates spell the same way; the pair grid is
// that whole alphabet squared, x 5 joins x 3 contexts, less the same
// kind of collision. A grid extension moves its pin DELIBERATELY, in
// the same change, to the count the new source lists produce; it is
// not a number to discover from a red gate and paste back.
//
// The pair pin last moved for the `tab-dash` join, the only
// coordinate either grid has for a construct on BOTH sides of a
// reference: 254,965 rows to 318,767. That is one whole alphabet
// squared in three contexts (63,948) less 146, the same collision
// the `comment` join loses the same number of rows to - a first
// member spelled `* b*` makes the `para` context spell the `item`
// context of the member spelled `b*`.
const STANDING_GRID_SIZE = 17_349;
const PAIR_GRID_SIZE = 318_767;

/**
 * Rule (i): every construct dimension is still a row of the rule
 * table, or the one fallback kind the table has no row for.
 *
 * ONE DIRECTION, and the missing one is not an oversight. The other
 * direction - a rule row with no dimension - cannot be reached: the
 * registry builds its dimensions from a `Record` over `InlineKind`,
 * so a new kind fails `tsc` and an existing kind already has a
 * dimension. A loop for it here would be a branch nothing can take.
 * @returns one message per dimension whose rule row is gone
 */
function ruleRowFailures(): string[] {
  const tableKinds = new Set(INLINE_RULES.map((rule) => rule.type));
  return INLINE_CONSTRUCTS.flatMap((entry) =>
    tableKinds.has(entry.kind) || entry.kind === TABLELESS_KIND
      ? []
      : [
          `inline census: construct dimension ${entry.kind} is no longer an INLINE_RULES row (rule (i)) - delete the dimension, or say in scripts/inline-census.ts why the kind survives without a row`,
        ],
  );
}

/**
 * Rule (ii): every valid spelling tokenizes to the kind it is filed
 * under. Asked of the tokenizer rather than of a name list, so a
 * dimension cannot claim a construct it does not spell.
 * @returns one message per spelling that reaches no such token
 */
function spellingFailures(): string[] {
  return INLINE_CONSTRUCTS.flatMap((entry) =>
    entry.spellings.flatMap((spelling) =>
      tokenizeInline(spelling, 0).some((token) => token.type === entry.kind)
        ? []
        : [
            `inline census: ${entry.kind}'s spelling ${JSON.stringify(spelling)} produces no ${entry.kind} token (rule (ii)) - the dimension names a construct it does not spell, so its rows exercise something else`,
          ],
    ),
  );
}

/**
 * Rule (iii): every rules.ts runtime export is the enumeration source
 * or exempt, and neither list may go stale.
 * @returns one message per disagreement
 */
function exportNameFailures(): string[] {
  const failures: string[] = [];
  const exportNames = new Set(Object.keys(inlineRules));
  for (const name of exportNames) {
    if (name !== "INLINE_RULES" && !EXEMPT.has(name)) {
      failures.push(
        `inline census: rules.ts export ${name} is neither the enumeration source nor exempted (rule (iii)) - give the construct a dimension in scripts/inline-registry.ts, or write the exemption down in scripts/inline-census.ts`,
      );
    }
  }
  for (const name of EXEMPT.keys()) {
    if (!exportNames.has(name)) {
      failures.push(
        `inline census: EXEMPT names ${name}, which rules.ts no longer exports (stale exemption)`,
      );
    }
  }
  return failures;
}

/**
 * Rule (iv) for one dimension class: the registry's ids and the
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
        `inline census: ${dimension} dimension ${id} is gone from scripts/inline-registry.ts (rule (iv)) - a dimension the grid shrinks by; delete it from the roster in scripts/inline-census.ts in the same change if the removal is deliberate`,
      );
    }
  }
  for (const id of declared) {
    if (!expected.has(id)) {
      failures.push(
        `inline census: ${dimension} dimension ${id} is new (rule (iv)) - add it to the roster in scripts/inline-census.ts, and move the grid-size pin with it`,
      );
    }
  }
  return failures;
}

/**
 * Rule (v): every alphabet member reaches a realized standing input,
 * reaches a realized pair input, and fits the reflow-edge body
 * budget.
 *
 * "Reaches" is the same test the line-shape census runs: the member's
 * body appears in a realized input. That says the net FEEDS the
 * spelling to the formatter, not that any row varies it.
 *
 * The pair half is unconditional because the pair grid takes the
 * whole alphabet: every member pairs with every other, so an
 * unreached one names a wrong body. A filter placed in front of that
 * grid is caught by rule (vi), which sees the realized count shrink.
 * @param standingInputs - every realized standing-grid input
 * @param pairInputs - every realized pair-grid input
 * @returns one message per disagreement
 */
function alphabetCoverageFailures(
  standingInputs: readonly string[],
  pairInputs: readonly string[],
): string[] {
  const failures: string[] = [];
  for (const member of inlineAlphabet()) {
    if (!standingInputs.some((input) => input.includes(member.body))) {
      failures.push(
        `inline census: alphabet member ${member.id} reaches no realized standing input (rule (v)): its body never appears in one; check the spelling in scripts/inline-registry.ts`,
      );
    }
    // A body longer than the budget gets the reflow-edge line
    // boundary in FRONT of it rather than behind it, which is the
    // opposite coordinate from the one that dimension is named for.
    // Reflow joins the body's own newlines away first, so the width
    // that matters is the JOINED length.
    const width = member.body.replaceAll("\n", " ").length;
    if (width > REFLOW_EDGE_BODY_BUDGET) {
      failures.push(
        `inline census: alphabet member ${member.id} is ${String(width)} characters, past the reflow-edge budget of ${String(REFLOW_EDGE_BODY_BUDGET)} (rule (v)): its reflow-edge rows put the line boundary in front of the construct instead of behind it; shorten the spelling, or shorten FILLER_EDGE and move both numbers together`,
      );
    }
    if (!pairInputs.some((input) => input.includes(member.body))) {
      failures.push(
        `inline census: alphabet member ${member.id} reaches no realized pair input (rule (v)): every member pairs with every other, so an unreached one names a wrong body`,
      );
    }
  }
  return failures;
}

/**
 * Rule (iv)'s cross-check: every context the pair grid filters for is
 * a context that exists.
 *
 * The two rosters above would each notice their own side of a
 * deliberate rename, but a rename carried through `CONTEXTS` and its
 * roster while `PAIR_CONTEXT_IDS` kept the old spelling drops a
 * context out of the pair filter, and the only gate left is the
 * grid-size pin, whose message points at the grid rather than at the
 * name.
 * @returns one message per pair context that names no context
 */
function pairContextSubsetFailures(): string[] {
  const contextIds = new Set(CONTEXTS.map((entry) => entry.id));
  return [...PAIR_CONTEXT_IDS].flatMap((id) =>
    contextIds.has(id)
      ? []
      : [
          `inline census: PAIR_CONTEXT_IDS names ${id}, which is not a CONTEXTS dimension (rule (iv)) - the pair grid silently drops it; fix the name in scripts/inline-registry.ts`,
        ],
  );
}

/**
 * Rule (v)'s arithmetic half: the reflow-edge filler and the body
 * budget still add up to the width the sweep formats at.
 *
 * Held rather than trusted because both numbers are measured, and a
 * filler one column longer moves the line boundary in FRONT of the
 * longest bodies without changing any count the other rules watch.
 * @returns one message when the two constants no longer agree
 */
function reflowEdgeArithmeticFailures(): string[] {
  const first = FILLER_EDGE.length + 1 + REFLOW_EDGE_BODY_BUDGET;
  return first === PRINT_WIDTH
    ? []
    : [
        `inline census: FILLER_EDGE (${String(FILLER_EDGE.length)}) plus a space plus the ${String(REFLOW_EDGE_BODY_BUDGET)}-character budget is ${String(first)} columns, not the ${String(PRINT_WIDTH)} the sweep formats at (rule (v)) - the reflow-edge boundary no longer lands where scripts/inline-registry.ts says it does`,
      ];
}

/**
 * Rule (vi): the realized grids are the sizes pinned in this module.
 * @param standing - the standing grid's realized length
 * @param pair - the pair grid's realized length
 * @returns one message per shrunk or grown grid
 */
function gridSizeFailures(standing: number, pair: number): string[] {
  const failures: string[] = [];
  if (standing !== STANDING_GRID_SIZE) {
    failures.push(
      `inline census: inlineStandingGrid() realized ${String(standing)} shapes, not the pinned ${String(STANDING_GRID_SIZE)} (rule (vi)) - a shrink narrows the net silently; move the pin in scripts/inline-census.ts only when the change is deliberate`,
    );
  }
  if (pair !== PAIR_GRID_SIZE) {
    failures.push(
      `inline census: inlinePairGrid() realized ${String(pair)} shapes, not the pinned ${String(PAIR_GRID_SIZE)} (rule (vi)) - a shrink narrows the net silently; move the pin in scripts/inline-census.ts only when the change is deliberate`,
    );
  }
  return failures;
}

/**
 * The two realized grid sizes beside their pins, for the scorecard's
 * census section (the same numbers rule (vi) fails on when they move).
 * @returns one row per pinned grid
 */
export function inlineCensusPins(): CensusPin[] {
  return [
    {
      what: "inline standing grid",
      realized: inlineStandingGrid().length,
      pinned: STANDING_GRID_SIZE,
    },
    {
      what: "inline pair grid",
      realized: inlinePairGrid().length,
      pinned: PAIR_GRID_SIZE,
    },
  ];
}

/**
 * Every way the inline registry and the rule table disagree.
 * @returns one message per failure; empty means the census is green
 */
export function inlineCensusFailures(): string[] {
  const standing = inlineStandingGrid();
  const pair = inlinePairGrid();
  return [
    ...ruleRowFailures(),
    ...spellingFailures(),
    ...exportNameFailures(),
    ...rosterFailures(
      "neighbourhood",
      NEIGHBOURHOODS.map((entry) => entry.id),
      NEIGHBOURHOOD_IDS,
    ),
    ...rosterFailures(
      "context",
      CONTEXTS.map((entry) => entry.id),
      CONTEXT_IDS,
    ),
    ...rosterFailures("pair-join", PAIR_JOIN_IDS, PAIR_JOINS),
    ...rosterFailures("pair-context", [...PAIR_CONTEXT_IDS], PAIR_CONTEXTS),
    ...pairContextSubsetFailures(),
    ...reflowEdgeArithmeticFailures(),
    ...alphabetCoverageFailures(
      standing.map((shape) => shape.input),
      pair.map((shape) => shape.input),
    ),
    ...gridSizeFailures(standing.length, pair.length),
  ];
}
