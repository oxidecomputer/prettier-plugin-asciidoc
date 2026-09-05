/**
 * The confluence gate's machinery: where a spelling variant is
 * placed, and what is asked of each pair.
 *
 * THE PROPERTY. Two sources that render the same and differ only in a
 * spelling the formatter does not claim as content must format to the
 * same bytes. Idempotence - formatting twice changes nothing - is
 * strictly weaker: it permits the output to be a function of the
 * input's accidents. Nothing goes red today when that happens, which
 * is what this module is for.
 *
 * WHERE VARIANTS STAND. The placements are the reader's own reachable
 * states rather than an invented sample. A block-shaped variant is
 * placed at each of the 23 states `blockStartContexts()`
 * (reader-context-space.ts) derives - document level, and one per
 * confinement style an item can open - because those are every state
 * a block start can be read in. A join-axis variant is placed at each
 * open-paragraph state, minus the two verbatim ones, because reflow
 * is what the axis asks about and a verbatim run is replayed rather
 * than reflowed.
 *
 * WHAT IT COVERS AND WHAT IT DOES NOT. The state axis is exhaustive
 * over that enumeration. The SPELLING axis is the roster in
 * confluence-variants.ts: an axis nobody wrote a row for is checked
 * nowhere, and the rosters that derive from a registry
 * (`DELIMITER_KINDS`) say so at the row. Render equality is decided by
 * {@link renderedHtml}, which folds source line breaks and whitespace
 * runs outside `<pre>`/`<code>`, so a difference only those bytes
 * carry reads as equal here; the divergences that answer to that fold
 * are declared with it as their reason (confluence-exceptions.ts).
 * Content the oracle drops entirely - comment text, an excluded
 * `ifdef` region - would be render-equal to anything, so no axis
 * varies it. And a placement's NAME is the state its document is
 * built to realize, not an instrumented observation of the state the
 * reader reached: reader-context-grid.test.ts asks the classifier
 * before it claims a cell, and this gate does not. A mislabelled
 * placement is still a real document and a real pair, so the
 * property holds either way; what it would cost is the reading of
 * WHICH state a divergence lives in.
 *
 * RENDER EQUALITY IS ASKED FIRST, and a pair the oracle does not hold
 * equal is never a finding: it is two different documents, and the
 * formatter keeping them apart says nothing about confluence. Those
 * pairs are counted under their own key and declared in
 * `OUTSIDE_DOMAIN` (confluence-exceptions.ts) rather than dropped, so
 * a generator that quietly stopped asking a question - a variant
 * table that claims an equivalence the oracle refuses, a placement
 * that changes the reading - fails here instead of shrinking the
 * claim in silence.
 */
import { formatAdoc, renderedHtml } from "../helpers.js";
import type { ParagraphContext } from "../../src/parse/line-shapes.js";
import {
  type ClusterFacts,
  factsOfBuckets,
} from "./registry-sweep-clusters.js";
import {
  blockStartContexts,
  contextKey,
  openerFor,
  openParagraphProbes,
  spellingOf,
  textOnlyOpenerFor,
} from "./reader-context-space.js";
import {
  BLOCK_VARIANTS,
  JOIN_SEEDS,
  type Variant,
} from "./confluence-variants.js";

/** One render-equal pair of whole documents, with the id it reports under. */
export interface ConfluencePair {
  /** `axis/variant@placement`, unique across the whole run. */
  readonly id: string;
  /** The axis the variant came from; the report groups on it. */
  readonly axis: string;
  /**
   * The declaration key: the pair id without its PLACEMENT. The
   * exception tables declare at this granularity, so one mechanism is
   * one reviewed row rather than a placement's worth of them, and a
   * row still names the exact spelling difference it excuses.
   */
  readonly key: string;
  /** One spelling, as a whole document. */
  readonly left: string;
  /** The other spelling of the same content. */
  readonly right: string;
}

/** What asking the oracle and the formatter about one pair answered. */
type PairOutcome =
  | {
      /** The two spellings formatted to the same bytes. */
      readonly kind: "converged";
    }
  | {
      /** The two spellings formatted to different bytes. */
      readonly kind: "diverged";
      /** What the left spelling formatted to. */
      readonly leftOut: string;
      /** What the right spelling formatted to. */
      readonly rightOut: string;
    }
  | {
      /** The oracle did not hold the two spellings equal. */
      readonly kind: "notRenderEqual";
    };

/** One pair whose two spellings formatted to different bytes. */
export interface Divergence {
  /** The pair, with its sources and its declaration key. */
  readonly pair: ConfluencePair;
  /** What the left spelling formatted to. */
  readonly leftOut: string;
  /** What the right spelling formatted to. */
  readonly rightOut: string;
}

/** Where a variant is placed, and the document that puts it there. */
interface Placement {
  /** Unique within the placement set; the tail of a pair id. */
  readonly id: string;
  /** Wraps a fragment into the document that places it. */
  readonly wrap: (fragment: string) => string;
}

/**
 * The block-start placements: document level, then one per style an
 * item confinement can carry.
 *
 * A style's placement opens a list of that style and attaches the
 * fragment to the item with a continuation, which is the only way a
 * block stands inside an item that has already spent its text. Both
 * spellings get the identical wrapper, so the wrapper cannot make a
 * pair unequal on its own.
 * @returns one placement per reachable block-start state
 */
function blockPlacements(): Placement[] {
  return blockStartContexts().flatMap((reader): Placement[] => {
    const { openList } = reader;
    if (openList === undefined) {
      return [{ id: "document", wrap: (fragment) => `${fragment}\n` }];
    }
    const style = spellingOf(openList);
    // Every confinement style is a marker style or a description
    // delimiter, and reader-context-space.ts spells an opener for
    // each; a style with none would silently SHRINK the grid, so it
    // stops the run instead.
    const opener = openerFor(style) ?? textOnlyOpenerFor(style);
    if (opener === undefined) {
      throw new Error(`no opener spells the confinement style ${style}`);
    }
    return [
      {
        id: `style:${style}`,
        wrap: (fragment) => `${opener}\n+\n${fragment}\n`,
      },
    ];
  });
}

// The paragraph contexts a verbatim run owns. Their lines are
// replayed byte for byte rather than reflowed, so a break moved
// inside one is content and the two spellings are not render-equal -
// the join question is not asked there at all.
const VERBATIM_CONTEXTS: ReadonlySet<ParagraphContext> =
  new Set<ParagraphContext>(["literalParagraph", "verbatimStyled"]);

/**
 * The join placements: every reachable open-paragraph state whose
 * block is reflowed.
 *
 * The probe's prefix opens the block; the seed's words continue it,
 * after a filler line wherever the state's `firstLineAfterStart` is
 * false (the same rule reader-context-grid.test.ts uses to realize
 * that half of the state).
 * @returns one placement per reflowed open-paragraph state
 */
function joinPlacements(): Placement[] {
  return openParagraphProbes()
    .filter((probe) => !VERBATIM_CONTEXTS.has(probe.reader.openParagraph))
    .map((probe) => {
      const filler = probe.reader.firstLineAfterStart ? "" : "filler line\n";
      return {
        id: contextKey(probe.reader),
        wrap: (fragment: string) => `${probe.prefix}\n${filler}${fragment}\n`,
      };
    });
}

/**
 * Every block-shaped pair: each variant crossed with the placements
 * it may stand in.
 *
 * A variant whose `stands` is `document` is placed at document level
 * only; its own row says which reading a placement would change.
 * @returns the block-axis pairs, in table order
 */
function blockPairs(): ConfluencePair[] {
  const placements = blockPlacements();
  const pairs: ConfluencePair[] = [];
  for (const [axis, variants] of Object.entries(BLOCK_VARIANTS)) {
    for (const variant of variants) {
      const where =
        variant.stands === "document"
          ? placements.filter((placement) => placement.id === "document")
          : placements;
      for (const placement of where) {
        pairs.push(pairOf(axis, variant, placement));
      }
    }
  }
  return pairs;
}

/**
 * One pair from a variant and a placement.
 * @param axis - the axis the variant belongs to
 * @param variant - the render-equal spelling pair
 * @param placement - where the fragment stands
 * @returns the pair, with its id and declaration key
 */
function pairOf(
  axis: string,
  variant: Variant,
  placement: Placement,
): ConfluencePair {
  return {
    id: `${axis}/${variant.id}@${placement.id}`,
    axis,
    key: `${axis}/${variant.id}`,
    left: placement.wrap(variant.left),
    right: placement.wrap(variant.right),
  };
}

// The axis name the join pairs report and declare under.
const JOIN_AXIS = "lineJoin";

/**
 * Every join-axis pair: each seed's words on one line against the
 * same words broken after each internal word, in each reflowed
 * open-paragraph state.
 *
 * The one-line spelling is the left side throughout, so a divergence
 * always reads as "this break placement did not join back".
 * @returns the join pairs, in seed order
 */
function joinPairs(): ConfluencePair[] {
  const placements = joinPlacements();
  const pairs: ConfluencePair[] = [];
  for (const seed of JOIN_SEEDS) {
    const words = seed.words.split(" ");
    for (let at = 1; at < words.length; at += 1) {
      const broken = `${words.slice(0, at).join(" ")}\n${words.slice(at).join(" ")}`;
      for (const placement of placements) {
        pairs.push({
          id: `${JOIN_AXIS}/${seed.id}@${String(at)}@${placement.id}`,
          axis: JOIN_AXIS,
          key: `${JOIN_AXIS}/${seed.id}@${String(at)}`,
          left: placement.wrap(seed.words),
          right: placement.wrap(broken),
        });
      }
    }
  }
  return pairs;
}

/**
 * Every pair the gate checks.
 * @returns the block-axis pairs then the join-axis pairs
 */
export function confluencePairs(): ConfluencePair[] {
  return [...blockPairs(), ...joinPairs()];
}

/**
 * Asks the oracle and the formatter about one pair, render equality
 * FIRST: a pair the oracle does not hold equal says nothing about the
 * formatter, so it never reaches the byte comparison.
 * @param pair - the pair to check
 * @returns what the pair answered
 */
async function checkPair(pair: ConfluencePair): Promise<PairOutcome> {
  const [leftRender, rightRender] = await Promise.all([
    renderedHtml(pair.left),
    renderedHtml(pair.right),
  ]);
  if (leftRender !== rightRender) {
    return { kind: "notRenderEqual" };
  }
  const [leftOut, rightOut] = await Promise.all([
    formatAdoc(pair.left),
    formatAdoc(pair.right),
  ]);
  return leftOut === rightOut
    ? { kind: "converged" }
    : { kind: "diverged", leftOut, rightOut };
}

/** What one whole run of the gate measured. */
export interface ConfluenceRun {
  /** How many pairs were checked. */
  readonly checked: number;
  /** Pairs the oracle did not hold render-equal, so outside the claim. */
  readonly notRenderEqual: readonly ConfluencePair[];
  /** Pairs whose two spellings formatted to different bytes. */
  readonly diverged: readonly Divergence[];
}

/**
 * Runs every pair and collects what diverged.
 * @param pairs - the pairs to check; defaults to the whole roster
 * @returns the run's counts and its divergences
 */
export async function runConfluence(
  pairs: readonly ConfluencePair[] = confluencePairs(),
): Promise<ConfluenceRun> {
  const notRenderEqual: ConfluencePair[] = [];
  const diverged: Divergence[] = [];
  for (const pair of pairs) {
    // eslint-disable-next-line no-await-in-loop -- sequential on purpose: six thousand concurrent renders exhaust memory
    const outcome = await checkPair(pair);
    switch (outcome.kind) {
      case "notRenderEqual": {
        notRenderEqual.push(pair);
        break;
      }
      case "diverged": {
        diverged.push({
          pair,
          leftOut: outcome.leftOut,
          rightOut: outcome.rightOut,
        });
        break;
      }
      case "converged": {
        break;
      }
    }
  }
  return { checked: pairs.length, notRenderEqual, diverged };
}

/**
 * One divergence as the line a failing gate prints: the pair id, the
 * two sources and the two outputs, so the reader can see what the
 * formatter did without re-running anything.
 * @param entry - a divergence from {@link runConfluence}
 * @returns a multi-line description
 */
export function describeDivergence(entry: Divergence): string {
  return [
    entry.pair.id,
    `  left  in  ${JSON.stringify(entry.pair.left)}`,
    `  left  out ${JSON.stringify(entry.leftOut)}`,
    `  right in  ${JSON.stringify(entry.pair.right)}`,
    `  right out ${JSON.stringify(entry.rightOut)}`,
  ].join("\n");
}

/**
 * The declared facts about each key's divergent pairs: how many, and
 * the digest of the whole sorted id list.
 *
 * A COUNT alone lets a bucket absorb a change by luck - a placement
 * fixed and a sibling placement regressed inside the same key keeps
 * the total, and every mechanism here runs through per-style branches
 * where exactly that is the ordinary shape of a bug. The digest is
 * the same third fact registry-sweep-clusters.ts records for the deep
 * sweep's clusters, computed by that module's own
 * {@link factsOfBuckets} so the two manifests cannot disagree about
 * what a hash is over.
 * @param run - a finished run
 * @returns each key's count, first ids and digest, ordered by key
 */
export function divergenceFacts(run: ConfluenceRun): Map<string, ClusterFacts> {
  const ids = new Map<string, string[]>();
  for (const entry of run.diverged) {
    const bucket = ids.get(entry.pair.key) ?? [];
    bucket.push(entry.pair.id);
    ids.set(entry.pair.key, bucket);
  }
  return factsOfBuckets(ids);
}

/**
 * The ids under each key whose digest does not match its declaration,
 * as the hint a failing gate prints.
 *
 * A digest says THAT the membership moved and nothing about which
 * pair moved, so the ids that produced it travel with the failure
 * rather than waiting for a rerun. Keys whose digest agrees are left
 * out, so the hint is empty on the ordinary count mismatch.
 * @param run - a finished run
 * @param declared - the exception table's digest per key; a key with
 *   no row has no digest to agree with and always reports
 * @returns a multi-line hint, empty when every digest agrees
 */
export function describeDigestMoves(
  run: ConfluenceRun,
  declared: Readonly<Record<string, { sha256: string } | undefined>>,
): string {
  const facts = divergenceFacts(run);
  const moved: string[] = [];
  for (const [key, fact] of facts) {
    if (declared[key]?.sha256 === fact.sha256) {
      continue;
    }
    const ids = run.diverged
      .filter((entry) => entry.pair.key === key)
      .map((entry) => entry.pair.id)
      .toSorted();
    moved.push(`${key} now covers:\n  ${ids.join("\n  ")}`);
  }
  return moved.join("\n");
}
