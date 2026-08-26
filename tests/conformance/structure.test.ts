import { beforeAll, describe, expect, test } from "vitest";
import {
  BLOCK_STRUCTURE_FAMILIES,
  CORPUS_LEDGER_PATH,
  MINIMUM_CASES,
  loadCorpusLedger,
  refusalComplaint,
} from "../../scripts/block-structure-ledger.js";
import { loadCorpus } from "./loader.js";
import { divergences, ourTree, signature, tryOracleTree } from "./structure.js";

// Block structure against the oracle (issue #30), the corpus half:
// does our AST model each corpus document's BLOCK STRUCTURE the way
// Asciidoctor does? Same exact agreement rule the quarantine manifest
// runs under, against a ledger of its own - a diverging case with no
// entry is a newly discovered modelling gap, and a ledgered case that
// now agrees is a fix that must be pinned by deleting its entry.
//
// It is in the DEFAULT suite (0.3 s over 1,614 documents) so a
// regression fails `bun run test` rather than waiting for somebody to
// run the harness. The SWEEP half - where 931 of the 932 divergences
// no other net knows about live - runs in `bun run block-structure`,
// which CI blocks on; it is 11,128 more documents and belongs in a
// harness.
//
// What this does NOT prove is stated in tests/conformance/structure.ts:
// node identity is the KIND ALONE, so a document can agree here while
// its titles, ids, roles, styles and verbatim text are all wrong.

const HINT =
  `run \`bun run block-structure --write\` to rewrite ${CORPUS_LEDGER_PATH}, ` +
  "then name the family of every entry it recorded as UNTRIAGED";

const cases = loadCorpus().flatMap((group) => group.cases);
const ledger = loadCorpusLedger(CORPUS_LEDGER_PATH);

/** What the run measured, filled in by `beforeAll`. */
interface Run {
  /** Every diverging case's signature, keyed by case id. */
  observed: Record<string, string>;
  /** Every case id the oracle refused to load, in corpus order. */
  refused: string[];
}

const run: Run = { observed: {}, refused: [] };

beforeAll(async () => {
  for (const one of cases) {
    // eslint-disable-next-line no-await-in-loop -- sequential on purpose: unbounded concurrency over ~1,600 documents would exhaust memory
    const oracle = await tryOracleTree(one.input);
    if (oracle === undefined) {
      run.refused.push(one.id);
      continue;
    }
    const events = divergences(ourTree(one.input), oracle);
    if (events.length > 0) run.observed[one.id] = signature(events);
  }
});

describe("block structure against Asciidoctor", () => {
  // Same floor and same refusal predicate the harness runs, imported
  // rather than restated: two independent copies of a floor are a
  // floor that can be half-enforced.
  test("the corpus cleared its floor and the oracle refused exactly the pinned document", () => {
    expect(cases.length).toBeGreaterThanOrEqual(MINIMUM_CASES);
    expect(refusalComplaint(run.refused)).toBeUndefined();
  });

  test("every diverging case is ledgered, with the signature it has", () => {
    const ledgered = Object.fromEntries(
      Object.entries(ledger.cases).map(([id, entry]) => [id, entry.signature]),
    );
    expect(run.observed, HINT).toEqual(ledgered);
  });

  test("every ledgered family is in the closed enum", () => {
    const unknown = [
      ...new Set(
        Object.values(ledger.cases)
          .map((entry) => entry.family)
          .filter((family) => !BLOCK_STRUCTURE_FAMILIES.has(family)),
      ),
    ];
    expect(unknown, HINT).toEqual([]);
  });

  test("no ledger entry names a case the corpus no longer has", () => {
    const ids = new Set(cases.map((one) => one.id));
    const stale = Object.keys(ledger.cases).filter((id) => !ids.has(id));
    expect(stale, HINT).toEqual([]);
  });
});
