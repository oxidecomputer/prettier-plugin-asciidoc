/**
 * The confluence gate (issue #174): render-equal spellings of the
 * same content must format to the same bytes.
 *
 * Idempotence is the property this repo already had, and it is
 * strictly weaker - it lets the output be a function of the input's
 * accidents, which is exactly the complaint #174 states as a
 * property. Nothing went red when that happened before this suite.
 *
 * The claim, with its domain named: over the spelling axes in
 * confluence-variants.ts, placed in every reader state
 * reader-context-space.ts derives (exhaustive on the STATE axis,
 * the roster's own breadth on the SPELLING axis), every pair the
 * pinned oracle holds render-equal formats to identical bytes, except
 * the pairs confluence-exceptions.ts declares with a cited reason and
 * an exact count.
 *
 * Both directions are exact. An undeclared divergence fails with the
 * two sources and the two outputs; a declared divergence that has
 * been fixed fails too, until its row goes. The same holds for the
 * pairs the oracle puts outside the property, so a generator that
 * quietly stopped asking cannot pass.
 */
import { beforeAll, describe, expect, test } from "vitest";
import { formatAdoc, renderedHtml } from "../helpers.js";
import {
  DELIMITER_KINDS,
  type DelimiterKind,
} from "../../src/parse/line-shapes.js";
import {
  confluencePairs,
  describeDigestMoves,
  describeDivergence,
  divergenceFacts,
  itemTextDocuments,
  runConfluence,
  type ConfluenceRun,
} from "./confluence.js";
import {
  BLOCK_VARIANTS,
  FIXED_LENGTH_DELIMITERS,
  RENDER_RELEVANT,
} from "./confluence-variants.js";
import {
  CONFLUENCE_EXCEPTIONS,
  MECHANISM_REASONS,
  OUTSIDE_DOMAIN,
} from "./confluence-exceptions.js";

// The whole grid, measured once: the spelling roster crossed with the
// reachable reader states. Pinned so that a placement set or a
// variant table that silently shrank is a failure rather than a
// quieter pass.
const EXPECTED_PAIRS = 6352;

// How many pairs of each key came out apart, as a plain object so a
// failure prints the whole table diff rather than a Map's identity.
const countsByKey = (keys: readonly string[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const key of keys) {
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
};

// The declared tables reduced to the same shape as the measurement.
const declaredCounts = (
  table: Readonly<Record<string, { pairs: number }>>,
): Record<string, number> =>
  Object.fromEntries(
    Object.entries(table).map(([key, row]) => [key, row.pairs]),
  );

// The two facts a divergence row pins, as one comparable object: how
// many pairs the key covers and the digest of exactly which ones. A
// count alone lets a fixed placement pay for a regressed sibling
// inside the same key, which is the ordinary shape of a bug in the
// per-style branches these mechanisms run through.
const pinned = (
  table: Readonly<Record<string, { pairs: number; sha256: string }>>,
): Record<string, { pairs: number; sha256: string }> =>
  Object.fromEntries(
    Object.entries(table).map(([key, row]) => [
      key,
      { pairs: row.pairs, sha256: row.sha256 },
    ]),
  );

describe("confluence", () => {
  // eslint-disable-next-line @typescript-eslint/init-declarations -- beforeAll fills it; a placeholder run would be a lie the tests could pass against
  let run: ConfluenceRun;

  beforeAll(async () => {
    run = await runConfluence(confluencePairs());
  }, 120_000);

  test("the grid is the whole spelling roster in every reachable state", () => {
    expect(run.checked).toBe(EXPECTED_PAIRS);
  });

  test("every divergence is declared, with the outputs that caused it", () => {
    const undeclared = run.diverged
      .filter((entry) => !(entry.pair.key in CONFLUENCE_EXCEPTIONS))
      .map((entry) => describeDivergence(entry));
    expect(undeclared).toEqual([]);
  });

  test("the divergent set is exactly the declared exceptions", () => {
    const measured = Object.fromEntries(
      [...divergenceFacts(run)].map(([key, facts]) => [
        key,
        { pairs: facts.count, sha256: facts.sha256 },
      ]),
    );
    // The hint carries the ids behind any digest that moved, so a
    // membership change says WHICH pair moved rather than only that
    // the hash did.
    expect(measured, describeDigestMoves(run, CONFLUENCE_EXCEPTIONS)).toEqual(
      pinned(CONFLUENCE_EXCEPTIONS),
    );
  });

  test("the pairs outside the property are exactly the declared ones", () => {
    expect(countsByKey(run.notRenderEqual.map((pair) => pair.key))).toEqual(
      declaredCounts(OUTSIDE_DOMAIN),
    );
  });

  test("every declared mechanism carries a reason", () => {
    for (const row of Object.values(CONFLUENCE_EXCEPTIONS)) {
      expect(MECHANISM_REASONS[row.mechanism].length).toBeGreaterThan(0);
    }
  });
});

describe("confluence domain", () => {
  // The other side of the same line: a candidate variation that
  // CHANGES the render is not an exception to confluence, it is
  // outside the property. Each row is measured here rather than
  // asserted in prose, so an exclusion whose argument stopped being
  // true fails instead of quietly standing.
  test.each(RENDER_RELEVANT)(
    "$id is render-relevant, not an exception: $reason",
    async ({ left, right }) => {
      expect(await renderedHtml(left)).not.toBe(await renderedHtml(right));
    },
  );

  // What the confluence property CANNOT say. A pair the oracle holds
  // apart is dropped before the formatter is asked anything, so a
  // respelling that moves one member's own render is invisible to
  // every assertion above. In item-text position most of these pairs
  // ARE held apart, which is precisely where a block-form respelling
  // can move a block out of the position it was written in - so the
  // axis that reaches that position asserts the weaker property
  // directly, over each document rather than over the pair.
  test("formatting an item-text document does not change what it renders", async () => {
    const moved: string[] = [];
    for (const source of itemTextDocuments()) {
      // eslint-disable-next-line no-await-in-loop -- sequential on purpose: the renders exhaust memory in parallel, as runConfluence explains
      const formatted = await formatAdoc(source);
      // eslint-disable-next-line no-await-in-loop -- same reason
      const [before, after] = await Promise.all([
        renderedHtml(source),
        renderedHtml(formatted),
      ]);
      if (before !== after) {
        moved.push(`${JSON.stringify(source)} -> ${JSON.stringify(formatted)}`);
      }
    }
    expect(moved, moved.join("\n")).toEqual([]);
  });

  test("every delimiter kind either varies its length or declares itself fixed", () => {
    const { delimiterLength = [] } = BLOCK_VARIANTS;
    const varied = new Set(delimiterLength.map((variant) => variant.id));
    const covered: DelimiterKind[] = DELIMITER_KINDS.filter(
      (kind) => varied.has(kind) || FIXED_LENGTH_DELIMITERS.has(kind),
    );
    expect(covered).toEqual([...DELIMITER_KINDS]);
  });
});
