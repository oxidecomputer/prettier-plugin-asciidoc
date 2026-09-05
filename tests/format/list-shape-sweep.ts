/**
 * The list-shape sweep's machinery — the alphabet, the named shapes,
 * the document product and the per-document verdict — shared by the
 * two entries that consume it:
 *
 * - `list-shape-sweep.test.ts`, exhaustive to depth 4, in the DEFAULT
 *   suite (`bun run test`);
 * - `list-shape-sweep.deep.test.ts`, exhaustive to depth 5, run by
 *   `bun run test:deeply-nested-lists`, by CI's blocking job, and as the prelude to
 *   every mutation run.
 *
 * ONE module because the two must not disagree about what a sweep
 * document IS. A shape the deep entry pins and the default entry
 * spells differently is a shape neither pins, and the split exists
 * only to move wall time — 25.6 s of a 26.1 s suite lived in the
 * depth-5 product — not to weaken what is checked.
 *
 * NOTHING HERE SAMPLES, at either depth. The sweep used to grow
 * exhaustively and then DRAW 5,000 of the 100,000 length-5 documents,
 * and a review found four render-corrupting shapes inside this very
 * alphabet that the seeded draw simply missed. A 5% sample is not a
 * pin.
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

/** The ten symbols every generated body is spelled from. */
export const ALPHABET = [
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
 * How deep the DEFAULT suite's product runs.
 *
 * FOUR, not three, and the difference was measured rather than
 * guessed. Depth 3 costs 305ms and allowlists nothing — every shape on
 * the deep sweep's list has a body of length 4 or 5 — but it also
 * kills fewer MUTANTS than the sweep did before the split, and the
 * mutation harness runs the default suite, not `test:deeply-nested-lists`. A seeded
 * `list-hazard.ts` mutant (`startsWith` → `endsWith` on the comment
 * head) survives depth 3 and DIES at depth 4. Depth 4 is 11,128
 * documents in 1.6s, it carries 4 live allowlist entries, and it keeps
 * the suite inside the 3.5s the sweep cost before the depth-5 raise.
 */
export const SHALLOW_DEPTH = 4;

/** How deep the `test:deeply-nested-lists` product runs. */
export const DEEP_DEPTH = 5;

// Named shapes, unioned in explicitly at BOTH depths. They earn their
// place two ways: the ones with bodies longer than the depth in force
// are outside the product altogether, and the rest carry a name —
// first the traced shapes (nine attachment shapes + four trailing-`+`
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
 * The allowlist RESTRICTED to one depth's product — a derivation, not
 * a second hand-kept list. The default suite pins a subset of the same
 * 26 entries, and deriving it here means a shape can never be
 * allowlisted at one depth and not the other.
 * @param depth - the depth whose product the caller sweeps
 * @returns the allowlisted documents that product actually spells
 */
export function allowlistFor(depth: number): string[] {
  const spelled = new Set(sweepDocuments(depth));
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
 * What one document did under the sweep's three questions.
 *
 * A document the formatter threw on carries no other answer: there is
 * no output to format again and none to render, and "it crashed" is a
 * different report from "it came back unchanged".
 */
export type SweepVerdict =
  | {
      /** The formatter threw on one of the two passes. */
      readonly kind: "threw";
    }
  | {
      /** Both passes ran. */
      readonly kind: "formatted";
      /** Whether the second pass changed the first pass's output. */
      readonly unstable: boolean;
      /** Whether the oracle renders the output unlike the source. */
      readonly renderUnequal: boolean;
    };

/**
 * Whether a verdict belongs in the failing set: the three questions
 * are one gate, and this is where they are joined.
 * @param verdict - one document's verdict
 * @returns true when the document failed any of the three
 */
export function verdictFails(verdict: SweepVerdict): boolean {
  return verdict.kind === "threw" || verdict.unstable || verdict.renderUnequal;
}

/**
 * Whether a verdict's document is one whose formatted text no longer
 * renders like its source - the measure a caller reads on its own,
 * beside {@link verdictFails}, because a document can trade a bad
 * render for instability and back while the joined answer stays true.
 * @param verdict - one document's verdict
 * @returns true when the oracle rendered the output unlike the source
 */
export function verdictRenderUnequal(verdict: SweepVerdict): boolean {
  return verdict.kind === "formatted" && verdict.renderUnequal;
}

/**
 * The verdict on outputs somebody else produced.
 *
 * Split from {@link sweepVerdict} for the one caller that formats
 * elsewhere - under another revision, in another process - and must
 * still be judged by THIS definition of failing. Only the formatting
 * may move between trees; what a failure IS may not, or the two sides
 * of a comparison are measuring different things.
 * @param source - the document that was formatted
 * @param once - what one formatting pass made of it
 * @param twice - what a second pass made of that
 * @returns the verdict
 */
export async function verdictOfOutputs(
  source: string,
  once: string,
  twice: string,
): Promise<SweepVerdict> {
  return {
    kind: "formatted",
    unstable: twice !== once,
    renderUnequal: await rendersDifferently(source, once),
  };
}

/**
 * Format one document here and judge it on all three questions.
 *
 * Unlike {@link sweepFails} this asks the oracle even about an
 * unstable output, because a caller comparing two revisions needs the
 * render answer on its own: a document can trade instability for a
 * bad render and back, and a single boolean hides the trade.
 * @param source - one generated document
 * @returns the verdict
 */
export async function sweepVerdict(source: string): Promise<SweepVerdict> {
  const pair = await formatTwice(source);
  return pair === undefined
    ? { kind: "threw" }
    : await verdictOfOutputs(source, pair.once, pair.twice);
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
 * Sweep one depth's whole product and report what failed.
 * @param depth - the depth to spell the product at
 * @returns the failing documents, sorted
 */
export async function sweepFailures(depth: number): Promise<string[]> {
  const failing: string[] = [];
  for (const source of sweepDocuments(depth)) {
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
 * The reading ledger RESTRICTED to one depth's product - the same
 * derivation {@link allowlistFor} makes over the render/idempotence
 * allowlist, and for the same reason: one ledger serves both depths,
 * so a document can never be ledgered at one and not the other.
 *
 * For the SHALLOW entry only. The deep entry compares against the
 * whole file, because it sweeps the product the ledger was generated
 * from: filtering there would let a row whose document the product no
 * longer spells sit in the file forever, unreported at either depth.
 * @param depth - the depth whose product the caller sweeps
 * @returns the ledgered rows that product actually spells, in
 *   canonical order
 */
export function readingLedgerFor(depth: number): ReadingLedgerRow[] {
  const spelled = new Set(sweepDocuments(depth));
  return loadReadingLedger()
    .filter((row) => spelled.has(row.document))
    .toSorted(compareLedgerRows);
}

/**
 * Sweep one depth's product for REFLOW RE-CLASSIFICATION violations
 * (issue #58) and report what it found.
 *
 * A PARALLEL gate to {@link sweepFailures}, deliberately not folded
 * into `sweepFails`. The allowlist's families are render/idempotence
 * mechanism claims; this ledger's are reading mechanisms, and the
 * handful of documents that sit in both are there for two different
 * reasons. Mixing the verdicts would blur what each entry asserts.
 *
 * It consults no oracle, which is what makes it affordable over the
 * depth-5 product at all: the render sweep beside it is oracle-bound,
 * this one is two parses and a format per document.
 * @param depth - the depth to spell the product at
 * @returns one row per violating (document, pass), in canonical order
 */
export async function readingFailures(
  depth: number,
): Promise<ReadingLedgerRow[]> {
  const rows: ReadingLedgerRow[] = [];
  for (const document_ of sweepDocuments(depth)) {
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
