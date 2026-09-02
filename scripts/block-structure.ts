#!/usr/bin/env bun
/**
 * Block structure against the oracle (issue #30): does our AST model
 * block STRUCTURE the way Asciidoctor does?
 *
 * Runs the canonical-tree comparison in `tests/conformance/structure.ts`
 * over both corpora and gates each against its own ledger:
 *
 * - the conformance corpus, per case id, against
 *   `scripts/block-structure-corpus.json`;
 * - the list-shape sweep product at `--depth` (4 by default), per
 *   signature, against `scripts/block-structure-sweep.json`.
 *
 * BOTH, because they are blind to different things. Over 1,614 corpus
 * documents just FIVE divergences have a path inside a list item; over
 * the depth-4 sweep product 932 documents diverge, and the existing
 * crash, idempotency and fidelity nets know one of them. The
 * list-structure material lives in the sweep, and the real-document
 * material lives in the corpus.
 *
 * WHAT IT DOES NOT PROVE: node identity is the KIND ALONE - see the
 * header of `tests/conformance/structure.ts`, which states the
 * false-comfort risk in full. A green run says the block skeleton
 * agrees, never that the parse is right.
 *
 * Exit codes (`scripts/lib/cli.ts`): 0 both ledgers exactly right, 1 a
 * ledger gate or the mapping census FAILED, 2 the harness could not
 * run - a bad argument, a corpus below its floor, an oracle refusal
 * the pin does not name, or ledgers measured against another oracle.
 */
import { readFileSync } from "node:fs";
import { loadCorpus } from "../tests/conformance/loader.js";
import {
  AST_KIND_CENSUS,
  divergences,
  oracleTree,
  ourTree,
  render,
  signature,
  tryOracleTree,
  unmappedKinds,
  type Shape,
} from "../tests/conformance/structure.js";
import { sweepDocuments } from "../tests/format/list-shape-sweep.js";
import { cannotRun, GATE_FAILED, printUsage, wantsHelp } from "./lib/cli.js";
import {
  corpusFailures,
  loadCorpusLedger,
  loadSweepLedger,
  oracleVersion,
  refusalComplaint,
  staleOracleComplaint,
  sweepFailures,
  writeCorpusLedger,
  writeSweepLedger,
  CORPUS_LEDGER_PATH,
  MINIMUM_CASES,
  MINIMUM_SWEEP_DOCUMENTS,
  SWEEP_LEDGER_PATH,
  type CorpusLedger,
  type SweepLedger,
  type SweepObservation,
} from "./block-structure-ledger.js";

const ARGUMENT_START = 2;
const DEFAULT_LIMIT = 20;
const DEFAULT_DEPTH = 4;
const DECIMAL = 10;

/** Column width the per-family report right-aligns its counts to. */
const COUNT_WIDTH = 5;

/** What `--help` prints. */
const USAGE = `usage: bun run block-structure [options]

  --depth <n>   sweep depth, 4 or deeper (a shallower product is
                below the sweep floor and the run refuses it); the
                ledger pins the depth it was written at, and any
                other depth is report-only
  --write       rewrite both ledgers from this run, keeping named
                families; new entries are recorded as UNTRIAGED
  --limit <n>   how many failure lines to print (default 20)
  --levels      put the heading LEVEL in a heading's identity; the
                ledgers are level-blind, so this is report-only
  --help        this text

exit: 0 both ledgers exactly right, 1 a gate failed, 2 could not run`;

/** The command line, parsed. */
interface Options {
  /** The sweep depth to run. */
  depth: number;
  /** Whether to rewrite both ledgers from this run. */
  write: boolean;
  /** How many failure lines to print. */
  limit: number;
  /** Whether heading levels are part of a heading's identity. */
  levels: boolean;
}

/**
 * Parse the command line. An unrecognized argument is an error, not a
 * shrug: a silently dropped `--write` would print a passing report
 * while writing nothing.
 * @param argv - the arguments after the script name
 * @returns the options
 * @throws {TypeError} on an unknown argument or a missing value
 */
export function parseArguments(argv: readonly string[]): Options {
  const options: Options = {
    depth: DEFAULT_DEPTH,
    write: false,
    limit: DEFAULT_LIMIT,
    levels: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const numeric = (): number => {
      // Digits and nothing else: `Number.parseInt` reads `4x` as 4,
      // and a script that calls an unknown argument an error must not
      // shrug at a mistyped value for a known one.
      const spelling = argv[index + 1] ?? "";
      const value = /^\d+$/v.test(spelling)
        ? Number.parseInt(spelling, DECIMAL)
        : Number.NaN;
      if (Number.isNaN(value)) {
        throw new TypeError(`block-structure: ${argument} needs a number`);
      }
      index += 1;
      return value;
    };
    switch (argument) {
      case "--write": {
        options.write = true;
        break;
      }
      case "--levels": {
        options.levels = true;
        break;
      }
      case "--depth": {
        options.depth = numeric();
        break;
      }
      case "--limit": {
        options.limit = numeric();
        break;
      }
      default: {
        throw new TypeError(`block-structure: unknown argument ${argument}`);
      }
    }
  }
  return options;
}

/** What one corpus run measured. */
interface CorpusRun {
  /** How many cases the loader produced. */
  cases: number;
  /** Every case id the oracle refused to load, in corpus order. */
  refused: string[];
  /** Every diverging case's signature, keyed by case id. */
  observed: Map<string, string>;
  /** Every id the corpus loaded, for the stale-entry check. */
  ids: Set<string>;
  /** Kinds neither side's mapping named, and where they were seen. */
  unmapped: Map<string, string>;
  /** Wall time, milliseconds. */
  elapsed: number;
}

/**
 * Collect the kinds the mapping did not name from a pair of trees,
 * each against the first tree that carried it - a bare kind name says
 * nothing about where it came from, and this failure is exactly the
 * one a reader has no other handle on.
 * @param into - the accumulating map, kind to the tree it was seen in
 * @param trees - the trees to walk
 */
function collectUnmapped(
  into: Map<string, string>,
  trees: readonly Shape[],
): void {
  for (const tree of trees) {
    const kinds = unmappedKinds(tree);
    if (kinds.length === 0) {
      continue;
    }
    const where = render(tree);
    for (const kind of kinds) {
      if (!into.has(kind)) {
        into.set(kind, where);
      }
    }
  }
}

/**
 * Run the comparison over the conformance corpus.
 * @param levels - whether heading levels are part of the identity
 * @returns what it measured
 */
async function runCorpus(levels: boolean): Promise<CorpusRun> {
  const cases = loadCorpus().flatMap((group) => group.cases);
  const started = performance.now();
  const observed = new Map<string, string>();
  const unmapped = new Map<string, string>();
  const refused: string[] = [];
  for (const one of cases) {
    // eslint-disable-next-line no-await-in-loop -- sequential on purpose: unbounded concurrency over ~1,600 documents would exhaust memory
    const oracle = await tryOracleTree(one.input, levels);
    if (oracle === undefined) {
      refused.push(one.id);
      continue;
    }
    const ours = ourTree(one.input, levels);
    collectUnmapped(unmapped, [ours, oracle]);
    const events = divergences(ours, oracle);
    if (events.length > 0) {
      observed.set(one.id, signature(events));
    }
  }
  return {
    cases: cases.length,
    refused,
    observed,
    ids: new Set(cases.map((one) => one.id)),
    unmapped,
    elapsed: Math.round(performance.now() - started),
  };
}

/** What one sweep run measured. */
interface SweepRun {
  /** How many documents the product spelled. */
  documents: number;
  /** How many diverged, over all signatures. */
  diverging: number;
  /** Every diverging signature's count and first example. */
  observed: Map<string, SweepObservation>;
  /** Each ledgered example's signature TODAY, for the example check. */
  exampleSignatures: Map<string, string>;
  /** Kinds neither side's mapping named, and where they were seen. */
  unmapped: Map<string, string>;
  /** Wall time, milliseconds. */
  elapsed: number;
}

/**
 * Run the comparison over the list-shape sweep product.
 * @param depth - the depth to spell the product at
 * @param levels - whether heading levels are part of the identity
 * @param examples - the ledger's example documents, whose current
 *   signature the gate needs even when they no longer diverge
 * @returns what it measured
 */
async function runSweep(
  depth: number,
  levels: boolean,
  examples: ReadonlySet<string>,
): Promise<SweepRun> {
  const documents = sweepDocuments(depth);
  const spelled = new Set(documents);
  const started = performance.now();
  const observed = new Map<string, SweepObservation>();
  const exampleSignatures = new Map<string, string>();
  const unmapped = new Map<string, string>();
  let diverging = 0;
  // The ledger's examples are compared too, even at a depth whose
  // product does not spell them: the example check asks whether THAT
  // document still carries THAT signature, and a shape can leave the
  // product without being fixed.
  for (const source of new Set([...documents, ...examples])) {
    const ours = ourTree(source, levels);
    // eslint-disable-next-line no-await-in-loop -- sequential on purpose: the product is tens of thousands of documents
    const oracle = await oracleTree(source, levels);
    collectUnmapped(unmapped, [ours, oracle]);
    const events = divergences(ours, oracle);
    const sign = events.length === 0 ? "" : signature(events);
    if (examples.has(source) && sign !== "") {
      exampleSignatures.set(source, sign);
    }
    if (sign === "" || !spelled.has(source)) {
      continue;
    }
    diverging += 1;
    const seen = observed.get(sign);
    if (seen === undefined) {
      observed.set(sign, { count: 1, example: source });
    } else {
      seen.count += 1;
    }
  }
  return {
    documents: documents.length,
    diverging,
    observed,
    exampleSignatures,
    unmapped,
    elapsed: Math.round(performance.now() - started),
  };
}

/**
 * The census's static half: every `type:` discriminant `src/ast.ts`
 * declares must be named in {@link AST_KIND_CENSUS}, and every name in
 * the census must still be declared. A node kind added to the AST that
 * never reaches the corpus would otherwise slip past the `?kind`
 * fallback unseen.
 * @returns one message per unnamed or stale kind
 */
function censusFailures(): string[] {
  const source = readFileSync("src/ast.ts", "utf8");
  const declared = new Set(
    [...source.matchAll(/^ {2}type: "(?<kind>[A-Za-z]+)";$/gmv)].map(
      (match) => match.groups?.kind ?? "",
    ),
  );
  const failures: string[] = [];
  for (const kind of declared) {
    if (AST_KIND_CENSUS.has(kind)) {
      continue;
    }
    failures.push(
      `block-structure: src/ast.ts declares node kind ${JSON.stringify(kind)} and the block-structure mapping does not name it`,
    );
  }
  for (const kind of AST_KIND_CENSUS.keys()) {
    if (declared.has(kind)) {
      continue;
    }
    failures.push(
      `block-structure: the block-structure mapping names node kind ${JSON.stringify(kind)} and src/ast.ts no longer declares it`,
    );
  }
  return failures;
}

/**
 * Everything wrong with the MAPPING rather than with the parse: a
 * kind the census does not name, and a kind the comparison actually
 * met and could only spell `?kind`.
 *
 * Checked before `--write` may return, because both failures poison a
 * regenerated ledger: an unnamed kind bakes into the signatures the
 * reviewer is then told to read as the record of what a change did.
 * The two runs' unmapped maps are merged rather than concatenated, so
 * a kind seen in both halves is one failure and not two.
 * @param corpus - what the corpus run measured
 * @param sweep - what the sweep run measured
 * @returns one message per unnamed, stale or unmapped kind
 */
function mappingFailures(corpus: CorpusRun, sweep: SweepRun): string[] {
  const unmapped = new Map([...corpus.unmapped, ...sweep.unmapped]);
  return [
    ...censusFailures(),
    ...[...unmapped].map(
      ([kind, where]) =>
        `block-structure: the comparison met unmapped kind ${JSON.stringify(kind)} in ${where} - name it in the mapping`,
    ),
  ];
}

/**
 * The measured-nothing floors. Every one of them exits 2: a run that
 * compared nothing proves nothing, and a green tick on it is the
 * expensive failure.
 * @param corpus - what the corpus run measured
 * @param sweep - what the sweep run measured
 * @returns the complaint, or undefined when both cleared their floors
 */
function floorComplaint(
  corpus: CorpusRun,
  sweep: SweepRun,
): string | undefined {
  if (corpus.cases < MINIMUM_CASES) {
    return `block-structure: only ${String(corpus.cases)} corpus cases loaded, expected at least ${String(MINIMUM_CASES)} - the corpus did not load`;
  }
  const refusal = refusalComplaint(corpus.refused);
  if (refusal !== undefined) {
    return refusal;
  }
  if (sweep.documents < MINIMUM_SWEEP_DOCUMENTS) {
    return `block-structure: only ${String(sweep.documents)} sweep documents spelled, expected at least ${String(MINIMUM_SWEEP_DOCUMENTS)}`;
  }
  return undefined;
}

/**
 * Print how the diverging corpus documents split across families -
 * the report a reviewer reads a ledger diff against.
 * @param families - each case's family, keyed by case id
 */
function reportFamilies(families: ReadonlyMap<string, string>): void {
  const counts = new Map<string, number>();
  for (const family of families.values()) {
    counts.set(family, (counts.get(family) ?? 0) + 1);
  }
  let gaps = 0;
  let permanent = 0;
  for (const [family, count] of counts) {
    if (family.startsWith("gap:")) {
      gaps += count;
    }
    if (family.startsWith("oracle:")) {
      permanent += count;
    }
  }
  // The third bucket is named rather than folded into either: an
  // UNLEDGERED document has no family yet, and counting it as
  // permanent would understate the gap the run just found.
  const unledgered = families.size - gaps - permanent;
  process.stdout.write(
    `block-structure: corpus families: gap:* ${String(gaps)} documents (must shrink), oracle:* ${String(permanent)} documents (permanent), unledgered ${String(unledgered)}\n`,
  );
  for (const [family, count] of [...counts].toSorted((a, b) => b[1] - a[1])) {
    process.stdout.write(
      `  ${String(count).padStart(COUNT_WIDTH)} ${family}\n`,
    );
  }
}

/**
 * Print every failure the run found and set the exit code.
 * @param failures - the gate's messages, in report order
 * @param limit - how many of them to print
 * @param what - what kind of failure they are, for the header line;
 *   a mapping failure is a statement about this HARNESS and a ledger
 *   failure is a statement about the PARSER, and one header for both
 *   sends the reader to the wrong file
 */
function reportFailures(
  failures: readonly string[],
  limit: number,
  what: string,
): void {
  if (failures.length === 0) {
    return;
  }
  process.stdout.write(`block-structure: ${String(failures.length)} ${what}\n`);
  for (const line of failures.slice(0, limit)) {
    process.stdout.write(`  ${line}\n`);
  }
  process.exitCode = GATE_FAILED;
}

/**
 * Which halves this run may render a VERDICT on. A run whose identity
 * is not the ledgers' is a report and nothing more: `--levels` asks a
 * different question of every heading, and a depth other than the
 * pinned one measures a different product. Both cases print why.
 * @param options - the parsed command line
 * @param pinnedDepth - the depth the sweep ledger was written at
 * @returns whether the corpus half and the sweep half are gated
 */
function gatedHalves(
  options: Options,
  pinnedDepth: number,
): { corpus: boolean; sweep: boolean } {
  if (options.levels) {
    process.stdout.write(
      "block-structure: --levels is REPORT-ONLY - both ledgers pin the level-blind identity\n",
    );
    return { corpus: false, sweep: false };
  }
  if (options.depth !== pinnedDepth) {
    process.stdout.write(
      `block-structure: sweep depth ${String(options.depth)} is REPORT-ONLY - the ledger pins depth ${String(pinnedDepth)}\n`,
    );
    return { corpus: true, sweep: false };
  }
  return { corpus: true, sweep: true };
}

/**
 * Print what a clean run proved, naming the halves that were gated so
 * a report-only run cannot read as a pass.
 * @param gated - which halves rendered a verdict
 * @param gated.corpus - whether the corpus half was gated
 * @param gated.sweep - whether the sweep half was gated
 * @param entries - how many corpus entries the ledger holds
 * @param rows - how many sweep rows the ledger holds
 */
function reportClean(
  gated: { corpus: boolean; sweep: boolean },
  entries: number,
  rows: number,
): void {
  const corpus = gated.corpus
    ? `corpus ledger exactly right (${String(entries)} entries)`
    : "corpus half report-only";
  const sweep = gated.sweep
    ? `sweep ledger exactly right (${String(rows)} rows)`
    : "sweep half report-only";
  process.stdout.write(`block-structure: ${corpus}, ${sweep}\n`);
}

/**
 * Rewrite both ledgers from a run.
 * @param options - the parsed command line
 * @param corpus - what the corpus run measured
 * @param sweep - what the sweep run measured
 * @param previous - the ledgers as they stand, for their named families
 * @param previous.corpus - the corpus ledger as it stands
 * @param previous.sweep - the sweep ledger as it stands
 */
function write(
  options: Options,
  corpus: CorpusRun,
  sweep: SweepRun,
  previous: { corpus: CorpusLedger; sweep: SweepLedger },
): void {
  writeCorpusLedger(CORPUS_LEDGER_PATH, corpus.observed, previous.corpus);
  writeSweepLedger(
    SWEEP_LEDGER_PATH,
    sweep.observed,
    options.depth,
    previous.sweep,
  );
  process.stdout.write(
    `block-structure: wrote ${CORPUS_LEDGER_PATH} (${String(corpus.observed.size)} entries) and ${SWEEP_LEDGER_PATH} (${String(sweep.observed.size)} rows)\n`,
  );
}

/**
 * Run both halves, gate them, and print the report.
 * @param options - the parsed command line
 */
async function main(options: Options): Promise<void> {
  const corpusLedger = loadCorpusLedger(CORPUS_LEDGER_PATH);
  const sweepLedger = loadSweepLedger(SWEEP_LEDGER_PATH);
  // `--write` is how a stale header is FIXED, so the check runs on
  // every other run: gating today's parse against counts measured by
  // another oracle proves nothing about either.
  const stale = options.write
    ? undefined
    : staleOracleComplaint(corpusLedger, sweepLedger);
  if (stale !== undefined) {
    cannotRun(stale);
    return;
  }
  const examples = new Set(
    Object.values(sweepLedger.signatures).map((row) => row.example),
  );
  const corpus = await runCorpus(options.levels);
  const sweep = await runSweep(options.depth, options.levels, examples);
  process.stdout.write(`block-structure: oracle ${oracleVersion()}\n`);
  process.stdout.write(
    `block-structure: corpus ${String(corpus.cases)} cases, ${String(corpus.refused.length)} oracle throw, ${String(corpus.observed.size)} diverging (${String(corpus.elapsed)} ms)\n`,
  );
  process.stdout.write(
    `block-structure: sweep depth ${String(options.depth)}: ${String(sweep.documents)} documents, ${String(sweep.diverging)} diverging in ${String(sweep.observed.size)} signatures (${String(sweep.elapsed)} ms)\n`,
  );
  const complaint = floorComplaint(corpus, sweep);
  if (complaint !== undefined) {
    cannotRun(complaint);
    return;
  }
  const mapping = mappingFailures(corpus, sweep);
  if (mapping.length > 0) {
    reportFailures(mapping, options.limit, "mapping failures");
    return;
  }
  if (options.write) {
    // Both ledgers were measured with the LEVEL-BLIND heading
    // identity; writing under `--levels` would pin a different
    // question against the same two file names.
    if (options.levels) {
      cannotRun(
        "block-structure: --write and --levels together would pin the level-bearing identity; the ledgers are level-blind",
      );
      return;
    }
    write(options, corpus, sweep, { corpus: corpusLedger, sweep: sweepLedger });
    return;
  }
  const gated = gatedHalves(options, sweepLedger.depth);
  const ledgered = new Map(Object.entries(corpusLedger.cases));
  reportFamilies(
    new Map(
      [...corpus.observed.keys()].map((id) => [
        id,
        ledgered.get(id)?.family ?? "UNLEDGERED",
      ]),
    ),
  );
  const failures = [
    ...(gated.corpus
      ? corpusFailures(corpusLedger, corpus.observed, corpus.ids)
      : []),
    ...(gated.sweep
      ? sweepFailures(sweepLedger, sweep.observed, sweep.exampleSignatures)
      : []),
  ];
  reportFailures(failures, options.limit, "ledger failures");
  if (failures.length === 0) {
    reportClean(
      gated,
      Object.keys(corpusLedger.cases).length,
      Object.keys(sweepLedger.signatures).length,
    );
  }
}

if (import.meta.main) {
  try {
    const argv = process.argv.slice(ARGUMENT_START);
    if (wantsHelp(argv)) {
      printUsage(USAGE);
    } else {
      await main(parseArguments(argv));
    }
  } catch (error) {
    // A bad argument, an unreadable ledger, a corpus that did not
    // load: none of them compared anything, so none of them is a 1.
    cannotRun(error instanceof Error ? error.message : String(error));
  }
}
