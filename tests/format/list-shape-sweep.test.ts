/**
 * Render-equality and idempotence over the spec's list-shape alphabet
 * (spec D4): ≥ 6,000 seeded, DETERMINISTIC documents — 6,110 generated
 * plus 30 traced, 5,821 unique after dedupe — no resident
 * randomness (Ruling 50); the same list on every run. The test pins
 * the exact failing set: a NEW failure is a regression, a shape
 * leaving the list is progress that must be moved out of the
 * allowlist deliberately (and named in the task report that does it).
 */
import { describe, expect, test } from "vitest";
import { formatAdoc, renderedHtml } from "../helpers.js";

const ALPHABET = [
  "* a",
  "** b",
  "+",
  "",
  "para",
  "  lit",
  "// c",
  "[role]",
  "[[anc]]",
  ".T",
] as const;

/**
 * Deterministic PRNG (mulberry32): seeded, never Math.random.
 * @param seed - the seed; the same seed always yields the same stream
 * @returns a generator of numbers in [0, 1)
 */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    // `| 0` is mulberry32's 32-bit WRAP, not a truncation: Math.trunc
    // would let `state` grow past 2^31 and the stream would stop being
    // the algorithm (and stop matching the measured allowlist).
    // eslint-disable-next-line unicorn/prefer-math-trunc -- int32 wrap, not truncation
    state = (state + 0x6d_2b_79_f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    // `^=` rather than the reference implementation's `t = (t + …) ^ t`:
    // XOR is commutative and both operands read the OLD t, so the value
    // is identical.
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

// Named shapes, unioned in explicitly because the generator's sampling
// is not a pin: its exhaustive part stops at suffix length 3 and its
// seeded part draws 5,000 of the length-4/5 space, so whole families
// can go unsampled (review round 1 proved it three times). First the
// Task-1 traced shapes (nine attachment shapes + four trailing-+
// shapes; F1 is the tier-1 bug this plan existed to fix), then one
// named row per review blocker and per cut-over fix rule — each a
// shape that regressed, or would regress under a one-line mutation of
// its rule, while the generated sweep stayed green.
const TRACED_SHAPES: readonly string[] = [
  "* a\n+\npara\n",
  "* a\n+\n\npara\n",
  "* a\n+\n\n\npara\n",
  "* a\n+\n+\npara\n",
  "* a\n** b\n+\npara\n",
  "* a\n** b\n\n+\npara\n",
  "* a\n** b\n\n+\n\n+\npara\n",
  "* a\n+\n\n+\npara\n",
  "* a\n** b\n+\n\n+\npara\n",
  "* a\n+\n",
  "* a\n+\n\n",
  "* a\n** b\n+\n",
  "* a\n\n+\n",
  // Review round 1, blocker B1: a popped trailing `+` whose stream-end
  // was an INNER buffer re-armed mid-document — the whole verified
  // family, one shape per stopper kind.
  "* a\n** b\n+\n+\n\npara\n",
  "* a\n** b\n*** c\n+\n+\n\npara\n",
  ". a\n.. b\n+\n+\n\npara\n",
  "* a\n** b\n+\n+\n\n----\nx\n----\n",
  "* a\n** b\n+\n+\n\n== Sec\n",
  "* a\n** b\n  lit\n+\n+\n\npara\n",
  "* a\n** b\n+\n+\n\n[role]\npara\n",
  // B1's flat cousin, found during the fix: a pop directly before a
  // delimiter (no blank) also armed the listing across the joiner's
  // blank line.
  "* a\n+\n+\n----\nx\n----\n",
  // Review round 1, blocker B2: `+`-run spellings must be FIXED POINTS
  // — the triple-`+` family lost one `+` per pass.
  "* a\n+\n+\n+\n\npara\n",
  "* a\n+\n+\n+\n\n* a\n",
  "* a\n\n+\n+\n+\n\n* a\n",
  "* a\n// c\n+\n+\n+\n\npara\n",
  // Review round 1, blocker B3: the baseline's invented blank before an
  // in-item nested list was load-bearing against the literal slurp.
  "* a\n\n  lit\n[role]\n** b\n\n* a\n",
  // The fold-protection family the introduced `+` needs the same blank
  // for (Task 4's own en-route fix, previously pinned by sampling only).
  "* a\n.T\n[role]\npara\n** b\n",
  "* a\n.T\n.T\n[role]\npara\n** b\n",
  "* a\npara\n[[anc]]\npara\n** b\n  lit\n",
  "* a\npara\n[role]\n[[anc]]\npara\n** b\n",
];

/**
 * Every suffix of length 1–3 exhaustively + 5,000 seeded of 4–5.
 * @returns the deduped document list, TRACED_SHAPES first
 */
function sweepDocuments(): string[] {
  const documents: string[] = [...TRACED_SHAPES];
  const grow = (lines: string[], depth: number): void => {
    for (const symbol of ALPHABET) {
      const next = [...lines, symbol];
      documents.push(`* a\n${next.join("\n")}\n`);
      if (depth > 1) grow(next, depth - 1);
    }
  };
  grow([], 3);
  const random = mulberry32(0x5e_ed_04);
  // No `?? ""`: tsconfig has no noUncheckedIndexedAccess, so the
  // indexed access is a plain string and a fallback would trip
  // @typescript-eslint/no-unnecessary-condition.
  const pick = (): string => ALPHABET[Math.floor(random() * ALPHABET.length)];
  for (let index = 0; index < 5000; index += 1) {
    const length = 4 + Math.floor(random() * 2);
    documents.push(`* a\n${Array.from({ length }, pick).join("\n")}\n`);
  }
  return [...new Set(documents)];
}

// TODAY's failing shapes, MEASURED over the union of the generator's
// documents and TRACED_SHAPES: 14 of 5,821 after the extent-first
// cut-over, every one a render-equality failure — no throw and no
// idempotence failure anywhere in the sweep.
//
// The cut-over removed 13 of the baseline's 27: F1 itself
// ("* a\n** b\n+\n\n+\npara\n" — the tier-1 corruption the plan
// existed to fix), the whole frozen-+ family (adjacent `+` chains
// before a nested marker, 8 shapes), and four literal/metadata
// spellings the verbatim gap replay now reproduces. What remains is
// the literal-indent family (`  lit` runs the reader re-shapes) and
// trailing-metadata reflow shapes — pre-existing, tracked by the
// conformance issues, none introduced here.
const FAILING_TODAY: readonly string[] = [
  "* a\n\npara\n* a\n  lit\n* a\n",
  "* a\n\npara\n** b\n* a\n** b\n",
  "* a\n\npara\n** b\n** b\n",
  "* a\n  lit\n// c\n[[anc]]\n.T\n",
  "* a\n  lit\n[[anc]]\n  lit\n** b\n",
  "* a\n  lit\n[role]\n  lit\npara\n** b\n",
  "* a\n+\n[role]\n\n\npara\n",
  "* a\n.T\n// c\n[[anc]]\n[role]\n.T\n",
  "* a\n.T\n// c\n[role]\n.T\n",
  "* a\n.T\n// c\n[role]\n.T\n+\n",
  "* a\n.T\n[[anc]]\n  lit\npara\n** b\n",
  "* a\n.T\n[role]\n  lit\n[role]\n* a\n",
  "* a\n[role]\npara\n[[anc]]\n  lit\n[role]\n",
  "* a\npara\n[role]\n  lit\n** b\n.T\n",
];

/**
 * Format a document, then format the result — or nothing at all when
 * either call threw. A helper rather than two `let`s in the loop: the
 * lint rules want every binding initialized on declaration, and this
 * keeps the `try` around exactly the two formatter calls (a throw from
 * the ORACLE below must not be swallowed as a formatter failure).
 * @param source - the document to format
 * @returns the once- and twice-formatted texts, or undefined on a throw
 */
async function formatTwice(
  source: string,
): Promise<{ once: string; twice: string } | undefined> {
  try {
    const once = await formatAdoc(source);
    return { once, twice: await formatAdoc(once) };
  } catch {
    return undefined;
  }
}

describe("list-shape sweep", () => {
  test("the render-equality/idempotence failing set is exactly the allowlist", async () => {
    const failing: string[] = [];
    for (const source of sweepDocuments()) {
      // Sequential on purpose: ~5,800 concurrent Prettier runs would
      // exhaust memory, and the sweep is ~3 s serial anyway.
      // eslint-disable-next-line no-await-in-loop -- sequential on purpose
      const pair = await formatTwice(source);
      if (pair === undefined) {
        failing.push(source);
        continue;
      }
      const { once, twice } = pair;
      if (twice !== once) {
        failing.push(source);
        continue;
      }
      // Byte-identical output is render-equal by definition — the
      // oracle is only consulted when the formatter changed bytes,
      // which keeps the sweep's wall time proportional to the
      // interesting shapes.
      if (once === source) continue;
      if (renderedHtml(once) !== renderedHtml(source)) failing.push(source);
    }
    expect(failing.toSorted()).toEqual([...FAILING_TODAY].toSorted());
  }, 300_000);
});
