#!/usr/bin/env bun
/* eslint-disable no-console -- runner script, not library code */

/**
 * The CROSS-CHECKOUT differential: one document domain, formatted by
 * up to three trees, compared on BYTES and on ORACLE RENDERS.
 *
 *   bun run migration-diff -- --domain directive --word-loss
 *   bun run migration-diff -- --domain directive --reference /path/to/export
 *   bun run migration-diff -- --domain population --baseline 97945c68
 *
 * The three trees, and why there are three: the CANDIDATE is this
 * checkout; the REFERENCE is a materialized directory holding another
 * implementation of the same formatter; the BASELINE is a revision of
 * this repository, or a checkout of one. Candidate-against-baseline
 * says what THIS work changed. Candidate-against-reference says how
 * far this tree is from the other implementation. Neither question
 * answers the other, and a two-tree tool makes the pair look like one
 * number.
 *
 * Running it with a baseline and no local edits is also the tool's
 * own self-check: the same tree down two different paths - in-process
 * here, through a child process there - must report no divergence at
 * all. A bucket that is non-empty in that configuration is the
 * harness's bug, not the formatter's.
 *
 * Every render happens here, under one normalizer
 * (`tests/helpers.ts`), from bytes the other trees hand back - see
 * `scripts/lib/tree-format.ts` on why the child never renders.
 *
 * Divergences are grouped into FAMILIES by the reading diff between
 * the two outputs, with a few witnesses kept per family, because a
 * flat list of several thousand differing documents is a number
 * rather than a finding.
 *
 * Exit codes (`scripts/lib/cli.ts`): 0 the differential ran, 1 a
 * directional bucket was non-empty under `--gate`, 2 it could not run
 * - an unknown domain or reference, a tree that answered short, or a
 * domain that spelled fewer documents than it is pinned at.
 */
import { existsSync, rmSync } from "node:fs";
import { formatAdoc, renderedHtml } from "../tests/helpers.js";
import { materialize } from "./lib/checkout.js";
import { cannotRun, GATE_FAILED, printUsage, wantsHelp } from "./lib/cli.js";
import {
  DIRECTIVE_PRODUCT_SIZE,
  directiveProduct,
} from "./lib/directive-product.js";
import { DLIST_PRODUCT_SIZE, dlistProduct } from "./lib/dlist-product.js";
import { population, populationLine } from "./lib/population.js";
import { formatInCheckout, type FormattedPair } from "./lib/tree-format.js";
import {
  byteBucket,
  familiesOf,
  losesWords,
  renderBucket,
  type Bucket,
  type TreeReport,
} from "./lib/differential.js";

const USAGE = `usage: bun run migration-diff -- --domain <name> [options]

  --domain <name>    directive, dlist, or population
  --reference <dir>  a materialized checkout to compare against
  --baseline <ref>   a revision of this repository, or a checkout of one
  --word-loss        also count documents that lose words, source to pass 2
  --gate             exit 1 when another tree renders a document this one does not
  --help             this text

exit: 0 it ran, 1 a gated bucket was non-empty, 2 it could not run`;

/** How many witnesses a family's report block keeps. */
const WITNESSES_PER_FAMILY = 5;

/** Column widths of the summary table, so the numbers line up. */
const NAME_WIDTH = 12;
const COUNT_WIDTH = 11;
const SHORT_WIDTH = 8;
const BYTES_WIDTH = 15;

/** The domains whose size is pinned, each with the set it spells. */
const DOMAINS = new Map<string, { documents: () => string[]; size: number }>([
  ["directive", { documents: directiveProduct, size: DIRECTIVE_PRODUCT_SIZE }],
  ["dlist", { documents: dlistProduct, size: DLIST_PRODUCT_SIZE }],
]);

/** What the command line asked for. */
interface Request {
  /** The domain name. */
  readonly domain: string;
  /** A materialized checkout, or undefined for no reference tree. */
  readonly reference: string | undefined;
  /** A revision or checkout, or undefined for no baseline tree. */
  readonly baseline: string | undefined;
  /** Whether to count word loss. */
  readonly wordLoss: boolean;
  /** Whether a non-empty directional bucket fails the run. */
  readonly gate: boolean;
}

/**
 * Parse the command line.
 * @param argv - the arguments after the script name
 * @returns the request
 * @throws {Error} when an argument is unrecognised or a value missing
 */
function parseArguments(argv: readonly string[]): Request {
  let domain = "";
  let reference: string | undefined = undefined;
  let baseline: string | undefined = undefined;
  let wordLoss = false;
  let gate = false;
  // The value of a flag is the next argument, and it has to EXIST:
  // `--domain` at the end of the line would otherwise read the
  // undefined past the end as a domain name and report it as unknown.
  const value = (index: number, flag: string): string => {
    if (index + 1 >= argv.length) {
      throw new Error(`migration-diff: ${flag} needs a value`);
    }
    return argv[index + 1];
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--domain": {
        domain = value(index, argument);
        index += 1;
        break;
      }
      case "--reference": {
        reference = value(index, argument);
        index += 1;
        break;
      }
      case "--baseline": {
        baseline = value(index, argument);
        index += 1;
        break;
      }
      case "--word-loss": {
        wordLoss = true;
        break;
      }
      case "--gate": {
        gate = true;
        break;
      }
      default: {
        throw new Error(`migration-diff: unrecognised argument ${argument}`);
      }
    }
  }
  if (domain === "") {
    throw new Error("migration-diff: --domain <name> is required");
  }
  return { domain, reference, baseline, wordLoss, gate };
}

/**
 * The documents one domain spells, and the size it is pinned at.
 *
 * `population` is not in the domain table because its size is
 * measured rather than pinned - the corpus grows - so it reports its
 * own line and pins itself.
 * @param domain - the domain name
 * @returns the documents and the pinned size, or undefined for an
 *   unknown domain
 */
function documentsOf(
  domain: string,
): { documents: string[]; size: number } | undefined {
  if (domain === "population") {
    const walked = population();
    console.log(populationLine(walked));
    return { documents: [...walked.documents], size: walked.documents.length };
  }
  const found = DOMAINS.get(domain);
  return found === undefined
    ? undefined
    : { documents: found.documents(), size: found.size };
}

/**
 * Render a text once, remembering the answer.
 *
 * The three trees agree on most documents, so the same bytes arrive
 * for rendering several times over; the oracle is the wall time here
 * and this cache is what makes a three-tree run cost little more
 * than a one-tree run.
 * @param cache - the memo, keyed by the exact bytes rendered
 * @param text - the text to render
 * @returns the normalized HTML
 */
async function renderOnce(
  cache: Map<string, string>,
  text: string,
): Promise<string> {
  const found = cache.get(text);
  if (found !== undefined) {
    return found;
  }
  const html = await renderedHtml(text);
  cache.set(text, html);
  return html;
}

/** What {@link measure} needs. One object, because it is five things. */
interface Measurement {
  /** What to call the tree in the report. */
  readonly name: string;
  /** What the tree made of each document. */
  readonly pairs: readonly FormattedPair[];
  /** The domain, in the same order. */
  readonly documents: readonly string[];
  /** The render memo, shared across trees. */
  readonly cache: Map<string, string>;
  /** Whether to count word loss. */
  readonly wordLoss: boolean;
}

/**
 * Measure one tree over the domain.
 *
 * The per-document render verdicts are kept, not just summed: the
 * counts answer "how many", and the directional buckets below need
 * to know WHICH.
 * @param what - the tree, its outputs, and the domain
 * @returns the tree's report
 */
async function measure(what: Measurement): Promise<TreeReport> {
  const renders: boolean[] = [];
  let wordLoss = 0;
  let threw = 0;
  let unstable = 0;
  for (const [index, source] of what.documents.entries()) {
    const pair = what.pairs[index];
    if (pair.kind === "threw") {
      threw += 1;
      renders.push(false);
      continue;
    }
    if (pair.twice !== pair.once) {
      unstable += 1;
    }
    if (what.wordLoss && losesWords(source, pair)) {
      wordLoss += 1;
    }
    // Byte-identical output renders identically by definition, so the
    // oracle is consulted only where the formatter moved bytes.
    if (pair.once === source) {
      renders.push(true);
      continue;
    }
    // eslint-disable-next-line no-await-in-loop -- sequential on purpose: the oracle is the wall time
    const [after, before] = await Promise.all([
      renderOnce(what.cache, pair.once),
      renderOnce(what.cache, source),
    ]);
    renders.push(after === before);
  }
  return {
    name: what.name,
    pairs: what.pairs,
    renders,
    wordLoss,
    threw,
    unstable,
  };
}

/**
 * Print one bucket, grouped into families with a few witnesses each.
 * @param bucket - the bucket to print
 */
function printBucket(bucket: Bucket): void {
  console.log(`\n${bucket.what}: ${String(bucket.rows.length)} document(s)`);
  for (const [signature, rows] of familiesOf(bucket)) {
    // An empty signature means the two outputs READ alike, not that
    // they are byte-equal: whatever changed the render sits below what
    // the reading projection can see - a blank line, an indent, a
    // spelling the tokens deliberately fold away.
    const named =
      signature === ""
        ? "(readings equal; the difference is below the projection)"
        : signature;
    console.log(`  [${String(rows.length)}x] ${named}`);
    for (const row of rows.slice(0, WITNESSES_PER_FAMILY)) {
      console.log(`      ${JSON.stringify(row.document)}`);
    }
  }
}

/** One line of the summary table. */
interface SummaryRow {
  /** The tree the line reports on. */
  readonly report: TreeReport;
  /**
   * How many documents this tree printed differently from the
   * candidate, or undefined for the candidate itself - whose own
   * column would be zero by construction and reads as a dash.
   */
  readonly bytesDiffer: number | undefined;
}

/**
 * Print the per-tree summary table.
 *
 * The byte counts arrive already measured rather than being taken
 * here: every row of a byte bucket carries a reading diff, which is
 * two parses, and the caller needs the same buckets to print their
 * families. Building them here as well would pay for all of it twice.
 * @param rows - one line per tree, candidate first
 * @param wordLoss - whether the word-loss column was measured
 */
function printSummary(rows: readonly SummaryRow[], wordLoss: boolean): void {
  const head = `\ntree        renders-as-source   unstable   threw   bytes-differ`;
  console.log(wordLoss ? `${head}   word-loss` : head);
  for (const { report, bytesDiffer } of rows) {
    const row =
      report.name.padEnd(NAME_WIDTH) +
      String(report.renders.filter(Boolean).length).padStart(COUNT_WIDTH) +
      String(report.unstable).padStart(COUNT_WIDTH) +
      String(report.threw).padStart(SHORT_WIDTH) +
      (bytesDiffer === undefined ? "-" : String(bytesDiffer)).padStart(
        BYTES_WIDTH,
      );
    console.log(
      wordLoss ? row + String(report.wordLoss).padStart(NAME_WIDTH) : row,
    );
  }
}

/**
 * Format the domain under this checkout.
 * @param documents - the domain
 * @returns one result per document, in order
 */
async function formatHere(
  documents: readonly string[],
): Promise<FormattedPair[]> {
  const pairs: FormattedPair[] = [];
  for (const source of documents) {
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential on purpose: thousands of concurrent runs exhaust memory
      const once = await formatAdoc(source);
      // eslint-disable-next-line no-await-in-loop -- sequential on purpose
      pairs.push({ kind: "formatted", once, twice: await formatAdoc(once) });
    } catch (error) {
      pairs.push({ kind: "threw", message: String(error) });
    }
  }
  return pairs;
}

/**
 * Measure every tree the request named.
 * @param request - what was asked for
 * @param documents - the domain
 * @returns the reports, candidate first
 */
async function everyTree(
  request: Request,
  documents: readonly string[],
): Promise<TreeReport[]> {
  const cache = new Map<string, string>();
  const of = async (
    name: string,
    pairs: readonly FormattedPair[],
  ): Promise<TreeReport> =>
    await measure({
      name,
      pairs,
      documents,
      cache,
      wordLoss: request.wordLoss,
    });
  const reports = [await of("candidate", await formatHere(documents))];
  if (request.reference !== undefined) {
    reports.push(
      await of("reference", formatInCheckout(request.reference, documents)),
    );
  }
  if (request.baseline === undefined) {
    return reports;
  }
  // A baseline may be named either way, because the two spellings are
  // the same tree by different routes and only one of them works
  // everywhere: `git archive` needs a colocated `.git`, which a jj
  // workspace of this repository does not have, and an export
  // directory is what the reference already is.
  const named = request.baseline;
  let materialized: string | undefined = undefined;
  try {
    const root = existsSync(named)
      ? named
      : (materialized = materialize({
          revision: named,
          prefix: "migration-diff-base-",
          install: true,
        }));
    reports.push(await of("baseline", formatInCheckout(root, documents)));
  } finally {
    if (materialized !== undefined) {
      rmSync(materialized, { recursive: true, force: true });
    }
  }
  return reports;
}

/**
 * Run the differential.
 * @param request - what was asked for
 * @returns whether a bucket the gate cares about was non-empty
 */
async function run(request: Request): Promise<boolean> {
  const domain = documentsOf(request.domain);
  if (domain === undefined) {
    cannotRun(
      `migration-diff: unknown domain ${JSON.stringify(request.domain)} - ${[...DOMAINS.keys()].join(", ")}, population`,
    );
    return false;
  }
  const { documents, size } = domain;
  if (documents.length !== size) {
    cannotRun(
      `migration-diff: the ${request.domain} domain spelled ${String(documents.length)} document(s), not the ${String(size)} it is pinned at`,
    );
    return false;
  }
  console.log(
    `domain ${request.domain}: ${String(documents.length)} document(s)`,
  );
  const reports = await everyTree(request, documents);
  const [candidate] = reports;
  // ONCE per pair. The summary's byte column and the bucket printed
  // below are the same measurement, and it is not a cheap one: a row
  // per differing document, each carrying a reading diff of two
  // parses - about 21,000 of them on the largest domain.
  const compared = reports.slice(1).map((other) => ({
    other,
    bytes: byteBucket(
      `candidate and ${other.name} print different bytes`,
      candidate,
      other,
      documents,
    ),
  }));
  printSummary(
    [
      { report: candidate, bytesDiffer: undefined },
      ...compared.map(({ other, bytes }) => ({
        report: other,
        bytesDiffer: bytes.rows.length,
      })),
    ],
    request.wordLoss,
  );
  let gated = false;
  for (const { other, bytes } of compared) {
    const lost = renderBucket(
      `${other.name} renders as source and candidate does not`,
      candidate,
      other,
      documents,
    );
    printBucket(lost);
    printBucket(
      renderBucket(
        `candidate renders as source and ${other.name} does not`,
        other,
        candidate,
        documents,
      ),
    );
    // The byte bucket is REPORTED, never gated. Two trees printing a
    // document differently is what a migration does; the gate is
    // stated in renders, and a byte difference is the thing a person
    // reads the families of to find out which.
    printBucket(bytes);
    if (lost.rows.length > 0) {
      gated = true;
    }
  }
  return gated;
}

const ARGUMENT_START = 2;
const argv = process.argv.slice(ARGUMENT_START);
if (wantsHelp(argv)) {
  printUsage(USAGE);
} else {
  try {
    const request = parseArguments(argv);
    if (request.reference !== undefined && !existsSync(request.reference)) {
      cannotRun(
        `migration-diff: no reference checkout at ${request.reference}`,
      );
    } else if ((await run(request)) && request.gate) {
      process.exitCode = GATE_FAILED;
    }
  } catch (error) {
    cannotRun(error instanceof Error ? error.message : String(error));
  }
}
