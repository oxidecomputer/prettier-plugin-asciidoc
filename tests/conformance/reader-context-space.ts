/**
 * Which {@link ReaderContext} states the reader can actually hand the
 * classifier, and the document shape that realizes each one.
 *
 * The three fields (src/parse/line-shapes.ts) span 9 x 23 x 2 = 414
 * combinations: eight paragraph contexts or none, twenty-two
 * confinement styles or none, and the two line positions. Most of
 * those combinations no site can build. This module derives the ones
 * that can be, from the FIVE places that construct a ReaderContext:
 *
 * 1. `BLOCK_START_CONTEXT` (src/parse/line-shapes.ts) - the default
 *    argument of `interruptsParagraph` and `isRawParagraphLine`; all
 *    three fields fixed.
 * 2. `blockStartContextIn` (src/parse/lines/scope.ts) - what
 *    `BlockReader#run` classifies a block's opening line with:
 *    `openParagraph` undefined, `firstLineAfterStart` false, and the
 *    style from `openListStyleIn`.
 * 3. `HEADER_CONTEXT` (src/parse/lines/header-reader.ts) - the same
 *    three values as (1); a header line is a block start with no list
 *    around it.
 * 4. The `Paragraph` scan's per-line literal
 *    (src/parse/lines/paragraph-reader.ts) - a definite context, the
 *    scan's own `openListStyle`, and the flag that is true for the
 *    line after the block's opening line and false afterwards.
 * 5. `verbatimRunExtent` (same file) - a definite context, the scan's
 *    `openListStyle`, and `firstLineAfterStart` fixed false, because
 *    a verbatim run's opening line is taken without being classified.
 *
 * The style half of (2), (4) and (5) is `openListStyleIn`, which is
 * the confinement's own style for an item-confined reader and
 * undefined for the document reader and for a compound block's
 * interior. Two callers construct an item confinement: `interiorOfItem`
 * passes a MARKER style and `interiorOfDescription` passes the
 * description list's DELIMITER (src/parse/lines/list-read.ts).
 *
 * The excluded combinations, each from a write site rather than from
 * an absence of evidence, are spelled at the arms of
 * {@link deriveReachableContexts}.
 */
import type { DescriptionDelimiter } from "../../src/ast.js";
import {
  CALLOUT_STYLE,
  type ParagraphContext,
  type ReaderContext,
} from "../../src/parse/line-shapes.js";

/**
 * Every style key `listMarkerStyle` can return, which is the whole
 * domain of `ParsedMarker.style` and so of an item confinement built
 * by `interiorOfItem`: the seven unordered markers
 * (`\*{1,5}|-|\u{2022}`), the ten ordered families
 * `orderedMarkerStyle` collapses onto (a dot run of each length, then
 * arabic, loweralpha, upperalpha, lowerroman, upperroman), and the
 * one style every callout marker shares.
 */
export const LIST_MARKER_STYLES: readonly string[] = [
  "*",
  "**",
  "***",
  "****",
  "*****",
  "-",
  "\u{2022}",
  ".",
  "..",
  "...",
  "....",
  ".....",
  "1.",
  "a.",
  "A.",
  "i)",
  "I)",
  CALLOUT_STYLE,
];

/**
 * The four term delimiters (src/ast.ts, `DescriptionDelimiter`). A
 * description item's confinement carries one of these INSTEAD of a
 * marker style: no marker line can spell it, so every marker line
 * inside the item's buffer is foreign to the list that is open
 * (`interiorOfDescription`, src/parse/lines/list-read.ts).
 */
export const DESCRIPTION_DELIMITERS: readonly DescriptionDelimiter[] = [
  "::",
  ":::",
  "::::",
  ";;",
];

/**
 * Every value `openListStyleIn` can return besides undefined: the
 * union of the two confinement kinds' styles. Twenty-two, which is
 * why the unconstrained state space is 8 x 23 x 2 rather than the
 * 8 x 19 x 2 that counting marker styles alone gives.
 */
export const CONFINEMENT_STYLES: readonly string[] = [
  ...LIST_MARKER_STYLES,
  ...DESCRIPTION_DELIMITERS,
];

// The line that opens a list of each marker style, in the spelling
// `listMarkerStyle` resolves back to that same key (the reachability
// test asserts the round trip, so a mis-keyed row here fails rather
// than silently probing another list).
const MARKER_OPENER: Readonly<Record<string, string>> = {
  "*": "* item",
  "**": "** item",
  "***": "*** item",
  "****": "**** item",
  "*****": "***** item",
  "-": "- item",
  "\u{2022}": "\u{2022} item",
  ".": ". item",
  "..": ".. item",
  "...": "... item",
  "....": ".... item",
  ".....": "..... item",
  "1.": "1. item",
  "a.": "a. item",
  "A.": "A. item",
  "i)": "i) item",
  "I)": "I) item",
  [CALLOUT_STYLE]: "<1> item",
};

// The term line that opens a description list of each delimiter. The
// term carries an inline description for the reason
// tests/conformance/interruption.test.ts states: after a BARE term
// there is no open paragraph for a block count to grow out of.
const DELIMITER_OPENER: Readonly<Record<DescriptionDelimiter, string>> = {
  "::": "term1:: desc",
  ":::": "term1::: desc",
  "::::": "term1:::: desc",
  ";;": "term1;; desc",
};

// The bare term line that opens a TEXTLESS description item of each
// delimiter - no inline description, matching how `dlistItemTextOnly`
// itself is opened (`interiorOfDescription`,
// src/parse/lines/list-read.ts, when the term line carries no text of
// its own).
const DELIMITER_OPENER_TEXT_ONLY: Readonly<
  Record<DescriptionDelimiter, string>
> = {
  "::": "term1::",
  ":::": "term1:::",
  "::::": "term1::::",
  ";;": "term1;;",
};

// The two rows above under one lookup, which is what every consumer
// wants: a confinement style is a marker style OR a delimiter, and
// nothing downstream cares which kind it was handed.
const OPENER: Readonly<Record<string, string>> = {
  ...MARKER_OPENER,
  ...DELIMITER_OPENER,
};

// The text-only openers under the same string-keyed lookup as OPENER,
// for `prefixFor`'s `dlistItemTextOnly` arm.
const OPENER_TEXT_ONLY: Readonly<Record<string, string>> = {
  ...DELIMITER_OPENER_TEXT_ONLY,
};

/**
 * The line that opens a list whose style is `style` - a marker line
 * for a marker style, a term line for a delimiter.
 * @param style - a member of {@link CONFINEMENT_STYLES}
 * @returns the opening line, or undefined when no row spells it
 */
export function openerFor(style: string): string | undefined {
  return OPENER[style];
}

/**
 * The bare term line that opens a TEXTLESS description item whose
 * delimiter is `style`.
 * @param style - a member of {@link DESCRIPTION_DELIMITERS}
 * @returns the opening line, or undefined for a marker style
 */
export function textOnlyOpenerFor(style: string): string | undefined {
  return OPENER_TEXT_ONLY[style];
}

/**
 * A reachable state with a paragraph definitely open - what every
 * probe carries, so a consumer that asks which context a probe is
 * for gets a definite answer instead of a case it has to defend
 * against.
 */
interface OpenParagraphContext extends ReaderContext {
  /** The paragraph-shaped block being read. */
  readonly openParagraph: ParagraphContext;
}

/**
 * One reachable state and the document text that puts a following
 * line inside it.
 */
export interface ContextProbe {
  /** The state the reader reaches. */
  readonly reader: OpenParagraphContext;
  /**
   * The document lines that open the block, ending WITHOUT a newline:
   * the probed line goes on the line after (plus a filler line first,
   * where the state's `firstLineAfterStart` is false).
   */
  readonly prefix: string;
}

// How each paragraph context is opened around a list of a given style
// (or none). Each shape is the one tests/conformance/interruption.test.ts
// already probes, generalized over the style: `listItem` must spend
// the item's first block before it opens a second (a block macro does
// it - `fold_first` folds a paragraph alone), `listContinuation` is
// the paragraph a `+` attaches, and the two verbatim contexts are
// opened the only ways they can be, an indented line and a held
// verbatim style.
const PARAGRAPH_BODY: Readonly<Record<ParagraphContext, string>> = {
  paragraph: "first line",
  listItemText: "",
  listItem: "image::a.png[]\npara line",
  listContinuation: "+\npara line",
  dlistItem: "",
  // The bare term line IS the whole opening, same as `dlistItem`'s -
  // there is no inline description for a body to follow.
  dlistItemTextOnly: "",
  literalParagraph: "  indented first",
  verbatimStyled: "[source]\nfirst content line",
};

/**
 * The document that realizes one state: the opener for its style,
 * then the lines that open the paragraph context inside it.
 *
 * A context whose body is empty IS the opener (a marker item's first
 * block is its own text; a description IS the term line's tail), and
 * a state with no style is opened at document level, so the opener
 * is left out.
 * @param context - the open paragraph's context
 * @param style - the enclosing list's style, or undefined
 * @returns the prefix lines, or undefined when no opener spells the
 *   style
 */
function prefixFor(
  context: ParagraphContext,
  style: string | undefined,
): string | undefined {
  const { [context]: body } = PARAGRAPH_BODY;
  if (style === undefined) {
    return body;
  }
  // `dlistItemTextOnly` needs the BARE term line, not `dlistItem`'s
  // own opener - the two contexts share a delimiter but not a
  // spelling, since only one of them carries an inline description.
  const opener =
    context === "dlistItemTextOnly"
      ? textOnlyOpenerFor(style)
      : openerFor(style);
  if (opener === undefined) {
    return undefined;
  }
  // A verbatim context inside an item is reached across a `+`: the
  // continuation attaches the indented run or the styled block to the
  // item, and the item's confined reader opens it with the item's own
  // style in hand.
  const attached =
    context === "literalParagraph" || context === "verbatimStyled";
  return body === "" ? opener : `${opener}\n${attached ? "+\n" : ""}${body}`;
}

// Every paragraph context, spelled as a list so the derivation can
// be walked in a fixed order. `CONTEXT_DOMAIN` below is keyed by the
// same type, so a new context is a compile error there and a missing
// row here would show up as a state count that does not match.
const ALL_CONTEXTS: readonly ParagraphContext[] = [
  "paragraph",
  "listItemText",
  "listItem",
  "listContinuation",
  "dlistItem",
  "dlistItemTextOnly",
  "literalParagraph",
  "verbatimStyled",
];

// Both line positions, for the contexts that reach both.
const BOTH_POSITIONS: readonly boolean[] = [true, false];

// The one position a verbatim run ever classifies in.
const LATER_ONLY: readonly boolean[] = [false];

/**
 * Which styles each paragraph context can be open under, and which
 * positions it reaches - the derivation this module exists for.
 *
 * EXCLUSIONS, one write-site argument each:
 *
 * - `paragraph` with any style. `bodyContextIn` returns `"paragraph"`
 *   exactly when `directlyInItem` is false, and `openListStyleIn`
 *   returns undefined on exactly that condition (scope.ts). The one
 *   other site that names the context, `continuationLine`'s top-level
 *   arm (reader.ts), stands behind the same `!directlyInItem` test.
 * - `listItemText` with a delimiter, or with no style. Only
 *   `interiorOfItem` opens that context, and it passes
 *   `marker.style` into an item confinement, so the style is a marker
 *   style and is never absent.
 * - `dlistItem` and `dlistItemTextOnly` with a marker style, or with
 *   no style. Only `interiorOfDescription` opens either - the same
 *   call, choosing between them by whether the term line carried an
 *   inline description - and it passes the list's `delimiter` either
 *   way.
 * - `listItem` and `listContinuation` with no style. Both come from
 *   `bodyContextIn`'s in-item arm, which `directlyInItem` guards, so
 *   the confinement is an item confinement and carries a
 *   `style: string`. (Either kind of style: an item confinement is
 *   built for a marker item and for a description item alike.)
 * - `literalParagraph` and `verbatimStyled` on the first line after
 *   the block start. Their only producer is `verbatimRunExtent`,
 *   which spells `firstLineAfterStart: false` for the whole loop;
 *   `paragraphExtent`, the only site that ever passes true, is never
 *   called with either context (reader.ts passes `this.body` or the
 *   literal `"paragraph"`, list-read.ts passes `"listItemText"` or
 *   `"dlistItem"`).
 * - No open paragraph on the first line after the block start. All
 *   three block-start sites - `BLOCK_START_CONTEXT`,
 *   `blockStartContextIn` and `HEADER_CONTEXT` - spell false, and the
 *   only producer of true carries a definite context (the `Paragraph`
 *   scan's field).
 */
const CONTEXT_DOMAIN: Readonly<
  Record<
    ParagraphContext,
    {
      styles: ReadonlyArray<string | undefined>;
      positions: readonly boolean[];
    }
  >
> = {
  paragraph: { styles: [undefined], positions: BOTH_POSITIONS },
  listItemText: { styles: LIST_MARKER_STYLES, positions: BOTH_POSITIONS },
  listItem: { styles: CONFINEMENT_STYLES, positions: BOTH_POSITIONS },
  listContinuation: { styles: CONFINEMENT_STYLES, positions: BOTH_POSITIONS },
  dlistItem: { styles: DESCRIPTION_DELIMITERS, positions: BOTH_POSITIONS },
  dlistItemTextOnly: {
    styles: DESCRIPTION_DELIMITERS,
    positions: BOTH_POSITIONS,
  },
  literalParagraph: {
    styles: [undefined, ...CONFINEMENT_STYLES],
    positions: LATER_ONLY,
  },
  verbatimStyled: {
    styles: [undefined, ...CONFINEMENT_STYLES],
    positions: LATER_ONLY,
  },
};

/**
 * Every state the reader can hand `classifyLine` while a paragraph is
 * OPEN, with the document that realizes it.
 *
 * These are the states an interruption question can be asked in: the
 * probed line stands inside a block that a shape can end. The states
 * with no open paragraph are enumerated separately
 * ({@link blockStartContexts}) because the question is vacuous
 * there - every line at a block start opens something.
 * @returns one probe per reachable open-paragraph state
 */
export function openParagraphProbes(): ContextProbe[] {
  const probes: ContextProbe[] = [];
  for (const context of ALL_CONTEXTS) {
    const { [context]: domain } = CONTEXT_DOMAIN;
    for (const openListStyle of domain.styles) {
      const prefix = prefixFor(context, openListStyle);
      if (prefix === undefined) {
        continue;
      }
      for (const firstLineAfterStart of domain.positions) {
        probes.push({
          reader: {
            openParagraph: context,
            openListStyle,
            firstLineAfterStart,
            // Every open-paragraph state has it undefined - the
            // setext title is read only at a section's own block
            // start (see ReaderContext.nextLine).
            nextLine: undefined,
          },
          prefix,
        });
      }
    }
  }
  return probes;
}

/**
 * The reachable states with NO open paragraph: one per style
 * `openListStyleIn` can return, all on a later line.
 *
 * `classifyLine` reads neither of the other two fields once
 * `openParagraph` is undefined - it goes straight to
 * `classifyBlockStart`, a function of the line alone - so these
 * twenty-three states are one equivalence class to the classifier.
 * The grid test (reader-context-grid.test.ts) pins that over every
 * construct rather than assuming it, which is why the grid itself
 * carries no block-start rows.
 * @returns the block-start states, in style order
 */
export function blockStartContexts(): ReaderContext[] {
  return [undefined, ...CONFINEMENT_STYLES].map((openListStyle) => ({
    openParagraph: undefined,
    openListStyle,
    firstLineAfterStart: false,
    // Real at a document-level block start (`nextLine` is read there
    // for the setext-title branch), but fixed undefined here: these
    // states pin the STYLE equivalence class, a claim `nextLine`
    // does not bear on.
    nextLine: undefined,
  }));
}

/**
 * Every reachable state: the block-start ones and the open-paragraph
 * ones together. This is the set the empirical cross-check tests
 * observed states against.
 * @returns the derived-reachable states
 */
export function deriveReachableContexts(): ReaderContext[] {
  return [
    ...blockStartContexts(),
    ...openParagraphProbes().map((probe) => probe.reader),
  ];
}

/**
 * A state as one comparable string, so two sets of states can be
 * compared and sorted without a deep-equality walk.
 *
 * `JSON.stringify` will not do: it drops a field whose value is
 * undefined, so `{openParagraph: undefined, openListStyle: "*"}` and
 * `{openParagraph: "*"...}` could collide on spelling. Each field is
 * spelled explicitly, with a sentinel for absent.
 * @param reader - the state
 * @returns a key unique to the state
 */
export function contextKey(reader: ReaderContext): string {
  const style = reader.openListStyle ?? "(none)";
  return `${reader.openParagraph ?? "(none)"}|${style}|${String(reader.firstLineAfterStart)}`;
}
