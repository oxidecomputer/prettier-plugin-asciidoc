/**
 * THE POPULATION, defined once.
 *
 * Every differential that says "the population" means this set: the
 * conformance corpus, the depth-5 list-shape product, and the
 * divergence witnesses. It lives in one module because the number
 * has to be one number - a harness that walks a slightly different
 * set and reports "the population" turns two measurements that
 * disagree into two measurements nobody can compare.
 *
 * The three parts OVERLAP by construction: most witnesses are corpus
 * cases or sweep documents, and they are here anyway so a witness
 * cannot fall out of the walked set by being deduplicated away
 * somewhere upstream. The set is deduplicated once, at the end, and
 * every count below is stated against a named domain rather than
 * left to be inferred.
 */
import {
  DEEP_DEPTH,
  sweepDocuments,
} from "../../tests/format/list-shape-sweep.js";
import { loadCorpus } from "../../tests/conformance/loader.js";
import { witnessDocuments } from "../../tests/lib/divergence-witnesses.js";

/** Turning a ratio into the percentage the summary line prints. */
const PERCENT = 100;

/** The population, with the provenance of what went into it. */
export interface Population {
  /** The distinct documents, corpus first, then sweep, then witnesses. */
  readonly documents: readonly string[];
  /** How many corpus cases were contributed, before deduplication. */
  readonly corpus: number;
  /** How many sweep documents were contributed, before deduplication. */
  readonly generated: number;
  /** How many witnesses were contributed, before deduplication. */
  readonly witnesses: number;
}

/**
 * Walk the population.
 *
 * Order is corpus, then sweep, then witnesses, and first mention
 * wins the slot - so a witness that is also a corpus case is walked
 * once, in the corpus's position, and the totals below still record
 * that it was contributed twice.
 * @returns the distinct documents and the per-part contribution counts
 */
export function population(): Population {
  const corpus = loadCorpus().flatMap((group) =>
    group.cases.map((one) => one.input),
  );
  const generated = sweepDocuments(DEEP_DEPTH);
  const witnesses = witnessDocuments();
  return {
    documents: [...new Set([...corpus, ...generated, ...witnesses])],
    corpus: corpus.length,
    generated: generated.length,
    witnesses: witnesses.length,
  };
}

/**
 * The one line every tool prints about the set it walked.
 *
 * Printed rather than merely returned because the walked count is
 * the claim: a harness that silently swept a smaller set reports the
 * same green as one that swept all of it, and this line is what
 * tells them apart in a log.
 * @param walked - the population that was walked
 * @returns the summary line, without a trailing newline
 */
export function populationLine(walked: Population): string {
  const distinct = walked.documents.length;
  const share = ((PERCENT * walked.generated) / distinct).toFixed(1);
  return `population: ${String(distinct)} distinct document(s) - ${String(walked.corpus)} corpus + ${String(walked.generated)} generated + ${String(walked.witnesses)} witness (${share}% generated, parts overlap)`;
}
