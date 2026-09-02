/**
 * The comparison vocabulary of the cross-checkout differential: the
 * pure half, so it can be tested without formatting a document.
 *
 * Everything here is a function of values the runner has already
 * gathered - the trees' outputs and their render verdicts. Nothing in
 * this module formats, renders, spawns or reads a file, which is what
 * lets the parts that decide what a divergence IS carry test rows of
 * their own while the run that produces the inputs takes minutes.
 */
import { ASCII_WHITESPACE } from "../../src/parse/line-shapes.js";
import { diffSignature, readingOf } from "../../tests/lib/reading.js";
import type { FormattedPair } from "./tree-format.js";

/** One tree's measurements over a whole domain. */
export interface TreeReport {
  /** What the tree is called in the report. */
  readonly name: string;
  /** Per document, what the tree made of it. */
  readonly pairs: readonly FormattedPair[];
  /** Per document, whether pass 1 rendered the same as the source. */
  readonly renders: readonly boolean[];
  /** How many documents lose a word between source and pass 2. */
  readonly wordLoss: number;
  /** How many documents the formatter threw on. */
  readonly threw: number;
  /** How many documents pass 2 changed after pass 1. */
  readonly unstable: number;
}

/** One document in a bucket, with the family it belongs to. */
export interface BucketRow {
  /** The source document. */
  readonly document: string;
  /** The reading diff between the two outputs, or why there is none. */
  readonly signature: string;
}

/** A set of documents two trees disagree about, and what it asserts. */
export interface Bucket {
  /** What the bucket asserts, for the report. */
  readonly what: string;
  /** The documents in it. */
  readonly rows: readonly BucketRow[];
}

/**
 * The words of a text, split on the six ASCII whitespace characters
 * the registry names.
 *
 * Empty pieces are dropped: a run of whitespace is one separator, and
 * counting the gap between two spaces as a lost word would report
 * every reflow as a loss.
 * @param text - the text to split
 * @returns its words, in order, duplicates kept
 */
export function words(text: string): string[] {
  return text.split(ASCII_WHITESPACE).filter((word) => word !== "");
}

/**
 * Does formatting this document twice lose any word?
 *
 * The operational definition the migration is stated in: the multiset
 * of the source's words minus the multiset of the twice-formatted
 * output's words is non-empty. Counted for every document, with no
 * instability precondition - a formatter that is perfectly stable and
 * drops a word every time must still count.
 *
 * A formatter that THREW loses nothing here. There is no output to
 * take a multiset of, and "it crashed" is a different report from "it
 * dropped a word", counted in its own column.
 * @param source - the document
 * @param pair - what the tree made of it
 * @returns whether a word went missing
 */
export function losesWords(source: string, pair: FormattedPair): boolean {
  if (pair.kind === "threw") {
    return false;
  }
  const left = new Map<string, number>();
  for (const word of words(source)) {
    left.set(word, (left.get(word) ?? 0) + 1);
  }
  for (const word of words(pair.twice)) {
    const seen = left.get(word);
    if (seen !== undefined) {
      left.set(word, seen - 1);
    }
  }
  return [...left.values()].some((count) => count > 0);
}

/**
 * The reading diff between two trees' first-pass outputs.
 * @param mine - what this tree made of the document
 * @param theirs - what the other tree made of it
 * @returns the signature, or why there is not one
 */
function signatureOf(mine: FormattedPair, theirs: FormattedPair): string {
  return mine.kind === "formatted" && theirs.kind === "formatted"
    ? diffSignature(readingOf(mine.once), readingOf(theirs.once))
    : "a formatter threw";
}

/**
 * The documents `other` renders as its source where `mine` does not.
 * @param what - what the bucket asserts
 * @param mine - the tree that fails to render them
 * @param other - the tree that renders them
 * @param documents - the domain, in report order
 * @returns the bucket
 */
export function renderBucket(
  what: string,
  mine: TreeReport,
  other: TreeReport,
  documents: readonly string[],
): Bucket {
  const rows: BucketRow[] = [];
  for (const [index, source] of documents.entries()) {
    if (mine.renders[index] || !other.renders[index]) {
      continue;
    }
    rows.push({
      document: source,
      signature: signatureOf(mine.pairs[index], other.pairs[index]),
    });
  }
  return { what, rows };
}

/**
 * The documents two trees PRINT DIFFERENTLY, whatever they render.
 *
 * The render buckets cannot see this class and it is not a small one:
 * a document both trees render as its source, printed two different
 * ways, produces no render row at all. Byte agreement is the stricter
 * property and the one a spelling claim is stated in, so it gets its
 * own bucket rather than being inferred from the absence of a render
 * row.
 *
 * A document either tree threw on is NOT here: there is no output to
 * compare, and the throw is already counted in its own column. Only
 * the second pass is ignored - two trees that print the same pass-1
 * bytes and then diverge on pass 2 differ in stability, which
 * `TreeReport.unstable` reports per tree.
 * @param what - what the bucket asserts
 * @param mine - one tree
 * @param other - the other tree
 * @param documents - the domain, in report order
 * @returns the bucket
 */
export function byteBucket(
  what: string,
  mine: TreeReport,
  other: TreeReport,
  documents: readonly string[],
): Bucket {
  const rows: BucketRow[] = [];
  for (const [index, source] of documents.entries()) {
    const ours = mine.pairs[index];
    const theirs = other.pairs[index];
    if (ours.kind !== "formatted" || theirs.kind !== "formatted") {
      continue;
    }
    if (ours.once === theirs.once) {
      continue;
    }
    rows.push({ document: source, signature: signatureOf(ours, theirs) });
  }
  return { what, rows };
}

/**
 * Group a bucket's rows by family, largest family first.
 *
 * The grouping is the report: several thousand differing documents
 * listed flat is a number, and the same set cut by the reading diff
 * between the two outputs is a handful of mechanisms a person can
 * actually go and look at.
 * @param bucket - the bucket to group
 * @returns the families, each with its rows, largest first
 */
export function familiesOf(bucket: Bucket): Array<[string, BucketRow[]]> {
  const families = new Map<string, BucketRow[]>();
  for (const row of bucket.rows) {
    const found = families.get(row.signature) ?? [];
    found.push(row);
    families.set(row.signature, found);
  }
  return [...families].toSorted(([, a], [, b]) => b.length - a.length);
}
