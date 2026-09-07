/**
 * The list-shape sweep's machinery: the alphabet, the named shapes,
 * the document product and the per-document verdict, consumed by
 * `list-shape-sweep.test.ts` in the DEFAULT suite (`bun run test`)
 * and by `bun run reading-ledger`, which regenerates the ledger that
 * entry gates against.
 *
 * ONE product at ONE depth ({@link DEEP_DEPTH}). The sweep used to run
 * as two entries at two depths, the shallower one filtered to the
 * documents it spelled; they converged on the same depth, so the
 * filtered comparison and the whole-file comparison are now two gates
 * of one entry, and a shape cannot be pinned by one and spelled
 * differently by the other. So nothing here takes a depth: every
 * verdict is about THE product. {@link sweepDocuments} keeps its
 * parameter because `bun run block-structure` spells the same product
 * at whatever `--depth` it is given, which is a survey and not a gate.
 *
 * NOTHING HERE SAMPLES. The sweep used to grow exhaustively and then
 * DRAW 5,000 of the 100,000 length-5 documents, and a review found
 * four render-corrupting shapes inside this very alphabet that the
 * seeded draw simply missed. A 5% sample is not a pin.
 */
import { formatAdoc, renderedHtml } from "../helpers.js";
import { readingBreachesOf } from "../lib/reading.js";
import {
  compareLedgerRows,
  loadReadingLedger,
  readingFamily,
  UNCLASSIFIED,
  type ReadingLedgerRow,
} from "../lib/reading-ledger.js";
import { FAILING_TODAY } from "./list-shape-allowlist.js";

/** The eleven symbols every generated body is spelled from. */
const ALPHABET = [
  "* a",
  "** b",
  "+",
  "",
  "para",
  "  lit",
  "  ** z",
  "// c",
  "[role]",
  "[[anc]]",
  ".T",
] as const;

/**
 * How deep the product runs.
 *
 * FOUR, and both directions were measured rather than guessed.
 *
 * Not three: depth 3 costs 305ms and allowlists nothing (every shape
 * on the sweep's list has a body of length 4), but it also kills fewer
 * MUTANTS. A seeded `list-hazard.ts` mutant (`startsWith` to
 * `endsWith` on the comment head) survives depth 3 and DIES at depth
 * 4, so 4 is the shallowest depth that kills it.
 *
 * Not five: depth 5 spells eleven times the documents, and the only
 * thing it reached that depth 4 does not was one reading signature of
 * the continuation-dropped family, on a single five-line document
 * (`* a` / blank / `+` / `* a` / blank / `+`). That shape is outside
 * sweep coverage now, and #17, the issue it came from, is closed:
 * tests/conformance/properties.test.ts is what pins its reading.
 *
 * What the product COSTS is deliberately not restated here, because
 * every figure of it moves when the alphabet does: `bun run
 * block-structure` spells the same product and prints its size on its
 * sweep line, and vitest prints the wall time.
 */
export const DEEP_DEPTH = 4;

// Named shapes, unioned in explicitly. They earn their place two
// ways: the ones with bodies longer than the depth in force are
// outside the product altogether, and the rest carry a name. First
// the traced shapes (nine attachment shapes + four trailing-`+`
// shapes; F1 is the tier-1 bug the extent-first reader fixed), then
// one named row per review blocker and per cut-over fix rule, each a
// shape that regressed or would regress under a one-line mutation of
// its rule.
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
  // Blocker B1: a popped trailing `+` whose stream-end
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
  // Blocker B2: `+`-run spellings must be FIXED POINTS
  // — the triple-`+` family lost one `+` per pass.
  "* a\n+\n+\n+\n\npara\n",
  "* a\n+\n+\n+\n\n* a\n",
  "* a\n\n+\n+\n+\n\n* a\n",
  "* a\n// c\n+\n+\n+\n\npara\n",
  // Blocker B3: the baseline's invented blank before an
  // in-item nested list was load-bearing against the literal slurp.
  "* a\n\n  lit\n[role]\n** b\n\n* a\n",
  // The fold-protection family the introduced `+` needs the same blank
  // for (previously pinned by sampling only).
  "* a\n.T\n[role]\npara\n** b\n",
  "* a\n.T\n.T\n[role]\npara\n** b\n",
  "* a\npara\n[[anc]]\npara\n** b\n  lit\n",
  "* a\npara\n[role]\n[[anc]]\npara\n** b\n",
];

/**
 * Every body of length 1 to `depth` over the alphabet, exhaustively,
 * plus the named shapes.
 * @param depth - the longest body the product spells
 * @returns the deduped document list, TRACED_SHAPES first
 */
export function sweepDocuments(depth: number): string[] {
  const documents: string[] = [...TRACED_SHAPES];
  const grow = (lines: string[], remaining: number): void => {
    for (const symbol of ALPHABET) {
      const next = [...lines, symbol];
      documents.push(`* a\n${next.join("\n")}\n`);
      if (remaining > 1) {
        grow(next, remaining - 1);
      }
    }
  };
  grow([], depth);
  return [...new Set(documents)];
}

/**
 * The allowlist RESTRICTED to one depth's product: a derivation, not
 * a second hand-kept list.
 *
 * The sweep gate compares its failing set against this, and a SECOND
 * gate compares this against the whole of `FAILING_TODAY`, so the two
 * failure modes stay apart. A shape that regressed or got quietly
 * fixed reddens the sweep; a row for a document the product does not
 * spell reddens the cheap gate instead, in milliseconds, and cannot
 * sit in the file unreported.
 * @returns the allowlisted documents the product actually spells
 */
export function allowlistFor(): string[] {
  const spelled = new Set(sweepDocuments(DEEP_DEPTH));
  return FAILING_TODAY.filter((document_) => spelled.has(document_));
}

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

/**
 * Whether Asciidoctor renders a formatted output differently from the
 * document it came from.
 * @param source - the document that was formatted
 * @param once - what one formatting pass made of it
 * @returns true when the two renders differ
 */
async function rendersDifferently(
  source: string,
  once: string,
): Promise<boolean> {
  // Byte-identical output is render-equal by definition — the
  // oracle is only consulted when the formatter changed bytes,
  // which keeps the sweep's wall time proportional to the
  // interesting shapes.
  if (once === source) {
    return false;
  }
  const [formatted, original] = await Promise.all([
    renderedHtml(once),
    renderedHtml(source),
  ]);
  return formatted !== original;
}

/**
 * Whether one document fails the sweep: the formatter threw, its
 * output is not idempotent, or Asciidoctor renders the formatted text
 * differently. One helper rather than the loop body it replaces so the
 * loop holds a single `await` — the oracle is async, and every one of
 * its calls would otherwise need its own sequential-on-purpose waiver.
 *
 * The short circuits are load-bearing: an unstable document is
 * already failing, and asking the oracle about it anyway would put
 * tens of thousands of renders the sweep's verdict cannot use into
 * the default suite's wall time.
 * @param source - one generated document
 * @returns true when the document belongs in the failing set
 */
async function sweepFails(source: string): Promise<boolean> {
  const pair = await formatTwice(source);
  if (pair === undefined) {
    return true;
  }
  const { once, twice } = pair;
  if (twice !== once) {
    return true;
  }
  return await rendersDifferently(source, once);
}

/**
 * Sweep the whole product and report what failed.
 * @returns the failing documents, sorted
 */
export async function sweepFailures(): Promise<string[]> {
  const failing: string[] = [];
  for (const source of sweepDocuments(DEEP_DEPTH)) {
    // Sequential on purpose: thousands of concurrent Prettier runs
    // would exhaust memory, and the oracle is the wall time here.
    // eslint-disable-next-line no-await-in-loop -- sequential on purpose
    if (await sweepFails(source)) {
      failing.push(source);
    }
  }
  return failing.toSorted();
}

/**
 * The reading ledger RESTRICTED to the product, the same derivation
 * {@link allowlistFor} makes over the render/idempotence allowlist
 * and paired the same way: the reading gate compares its violating
 * set against this, and a cheap gate beside it compares this against
 * the whole ledger file, so a row whose document the product does not
 * spell has nowhere to hide.
 * @returns the ledgered rows the product actually spells, in
 *   canonical order
 */
export function readingLedgerFor(): ReadingLedgerRow[] {
  const spelled = new Set(sweepDocuments(DEEP_DEPTH));
  return loadReadingLedger()
    .filter((row) => spelled.has(row.document))
    .toSorted(compareLedgerRows);
}

/**
 * Sweep the product for REFLOW RE-CLASSIFICATION violations
 * (issue #58) and report what it found.
 *
 * A PARALLEL gate to {@link sweepFailures}, deliberately not folded
 * into `sweepFails`. The allowlist's families are render/idempotence
 * mechanism claims; this ledger's are reading mechanisms, and the
 * handful of documents that sit in both are there for two different
 * reasons. Mixing the verdicts would blur what each entry asserts.
 *
 * It consults no oracle, which is what makes it affordable over the
 * whole product at all: the render sweep beside it is oracle-bound,
 * this one is two parses and a format per document.
 * @returns one row per violating (document, pass), in canonical order
 */
export async function readingFailures(): Promise<ReadingLedgerRow[]> {
  const rows: ReadingLedgerRow[] = [];
  for (const document_ of sweepDocuments(DEEP_DEPTH)) {
    // Sequential on purpose, for {@link sweepFailures}'s reason.
    // eslint-disable-next-line no-await-in-loop -- sequential on purpose
    const breaches = await readingBreachesOf(document_);
    for (const { pass, signature } of breaches) {
      rows.push({
        document: document_,
        pass,
        signature,
        family: readingFamily(signature) ?? UNCLASSIFIED,
      });
    }
  }
  return rows.toSorted(compareLedgerRows);
}
