#!/usr/bin/env bun
/**
 * The generated-domain differential: four exhaustive document domains
 * the list-shape sweep cannot spell, swept under this checkout and
 * under a base revision, reported as SET DIFFERENCES.
 *
 *   bun run probe-domains
 *   bun run probe-domains -- --base 3689870e
 *   bun run probe-domains -- --base 3689870e --domain indented-two-line
 *
 * Counts are not the report. A domain whose failing count is the same
 * on both trees can have fixed eleven documents and broken eleven
 * others, and the two numbers agree while the tree got worse; only
 * the difference of the two SETS says which. So every cell is fixed /
 * regressed / unchanged, and the gate is stated in the regressed set
 * alone.
 *
 * Two measures, both reported, because a document can trade one for
 * the other: FAILING (the sweep's own verdict - the formatter threw,
 * its output is not a fixed point, or the oracle renders it unlike
 * its source) and RENDER-UNEQUAL alone, which is the one that says
 * the text stopped meaning what it meant.
 *
 * What a failure IS comes from `tests/format/list-shape-sweep.ts` and
 * is the same definition the sweep entries gate on. Only the
 * FORMATTING moves between trees: the base's outputs come back from a
 * child process running that revision's own formatter
 * (`scripts/lib/tree-format.ts`) and every render happens here, under
 * one normalizer, so a difference belongs to the formatters rather
 * than to two harnesses.
 *
 * Exit codes (`scripts/lib/cli.ts`): 0 nothing regressed, 1 a
 * regressed set is non-empty, 2 the harness could not run - a bad
 * argument, an unknown `--base`, or a base tree that answered about a
 * different number of documents. Two measured-nothing floors exit 2
 * as well: a domain that spelled a different number of documents than
 * it is pinned at, and a base tree that threw on every document of a
 * domain, which is the configuration in which every set difference
 * comes back all-fixed and nothing-regressed.
 */
import { existsSync, rmSync } from "node:fs";
import {
  sweepVerdict,
  verdictFails,
  verdictOfOutputs,
  verdictRenderUnequal,
  type SweepVerdict,
} from "../tests/format/list-shape-sweep.js";
import { materialize } from "./lib/checkout.js";
import { cannotRun, GATE_FAILED, printUsage, wantsHelp } from "./lib/cli.js";
import {
  PROBE_DOMAINS,
  probeDocuments,
  probeDomain,
  type ProbeDomain,
} from "./lib/probe-domains.js";
import { formatInCheckout } from "./lib/tree-format.js";

const ARGUMENT_START = 2;

/** How many documents of a regressed set the report prints. */
const WITNESSES_SHOWN = 5;

/** Column widths of the difference table, so the numbers line up. */
const MEASURE_WIDTH = 16;
const COUNT_WIDTH = 10;

/** What `--help` prints. */
const USAGE = `usage: bun run probe-domains -- [options]

  --base <rev>     the revision to take the set difference against, or
                   a directory holding a checkout of one; without it
                   the run reports head counts and gates nothing
  --domain <name>  ${[...PROBE_DOMAINS.map((domain) => domain.name), "all"].join(", ")} (default all)
  --help           this text

exit: 0 nothing regressed, 1 a regressed set is non-empty, 2 could not
run`;

/** One of the two questions a domain is reported on. */
interface Measure {
  /** What the report calls it. */
  readonly name: string;
  /** Whether one verdict puts its document in this measure's set. */
  readonly holds: (verdict: SweepVerdict) => boolean;
}

/**
 * The two measures, in report order.
 *
 * RENDER-UNEQUAL is a subset of FAILING by construction, and it is
 * reported separately rather than derived from the difference because
 * a fix that turns a render-unequal document into a merely unstable
 * one moves it out of the second set and not the first.
 */
const MEASURES: readonly Measure[] = [
  { name: "failing", holds: verdictFails },
  { name: "render-unequal", holds: verdictRenderUnequal },
];

/** What the command line asked for. */
interface Request {
  /** The revision to compare against, or undefined for head only. */
  readonly base: string | undefined;
  /** The domains to sweep, in report order. */
  readonly domains: readonly ProbeDomain[];
}

/**
 * The domains one `--domain` word selects.
 * @param name - the word after `--domain`
 * @returns the domains, in report order
 * @throws {Error} when the word names no domain - a run that swept a
 *   domain the caller did not ask for proves nothing they wanted
 */
function domainsOf(name: string): readonly ProbeDomain[] {
  if (name === "all") {
    return PROBE_DOMAINS;
  }
  const found = probeDomain(name);
  if (found === undefined) {
    throw new Error(`probe-domains: unknown domain ${name}`);
  }
  return [found];
}

/**
 * Parse the command line.
 * @param argv - the arguments after the script name
 * @returns the request
 * @throws {Error} when an argument is unrecognised or a value missing
 */
function parseArguments(argv: readonly string[]): Request {
  let base: string | undefined = undefined;
  let domains: readonly ProbeDomain[] = PROBE_DOMAINS;
  const rest = [...argv];
  // The flag is recognised BEFORE its value is demanded, so a word
  // that names no flag is reported as the word it is rather than as a
  // flag whose value went missing.
  while (rest.length > 0) {
    const argument = rest.shift() ?? "";
    if (argument !== "--base" && argument !== "--domain") {
      throw new Error(`probe-domains: unrecognised argument ${argument}`);
    }
    const value = rest.shift();
    if (value === undefined) {
      throw new Error(`probe-domains: ${argument} needs a value`);
    }
    if (argument === "--base") {
      base = value;
      continue;
    }
    domains = domainsOf(value);
  }
  return { base, domains };
}

/**
 * Sweep one domain under this checkout.
 * @param documents - the domain, in report order
 * @returns one verdict per document, in the same order
 */
async function verdictsHere(
  documents: readonly string[],
): Promise<SweepVerdict[]> {
  const verdicts: SweepVerdict[] = [];
  for (const source of documents) {
    // Sequential on purpose: thousands of concurrent Prettier runs
    // would exhaust memory, and the oracle is the wall time here.
    // eslint-disable-next-line no-await-in-loop -- sequential on purpose
    verdicts.push(await sweepVerdict(source));
  }
  return verdicts;
}

/**
 * Sweep one domain under a materialized checkout.
 *
 * The other tree FORMATS and nothing else; the verdict is reached
 * here, from the bytes it hands back, so both sides of every set
 * difference are judged by one definition and rendered by one
 * normalizer.
 * @param root - the checkout to format in, absolute
 * @param documents - the domain, in report order
 * @returns one verdict per document, in the same order
 * @throws {Error} when the tree answered about a different number of
 *   documents than it was asked about
 */
async function verdictsIn(
  root: string,
  documents: readonly string[],
): Promise<SweepVerdict[]> {
  const pairs = formatInCheckout(root, documents);
  const verdicts: SweepVerdict[] = [];
  for (const [index, source] of documents.entries()) {
    const pair = pairs[index];
    if (pair.kind === "threw") {
      verdicts.push({ kind: "threw" });
      continue;
    }
    // eslint-disable-next-line no-await-in-loop -- sequential on purpose: the oracle is the wall time
    verdicts.push(await verdictOfOutputs(source, pair.once, pair.twice));
  }
  return verdicts;
}

/**
 * The documents one measure holds of, as a set.
 * @param documents - the domain, in report order
 * @param verdicts - one verdict per document, in the same order
 * @param measure - the question being asked
 * @returns the documents in that measure's set
 */
function setOf(
  documents: readonly string[],
  verdicts: readonly SweepVerdict[],
  measure: Measure,
): Set<string> {
  return new Set(
    documents.filter((source, index) => measure.holds(verdicts[index])),
  );
}

/** One measure's set difference between two trees. */
interface Difference {
  /** In the base's set and not in this checkout's. */
  readonly fixed: string[];
  /** In this checkout's set and not in the base's. */
  readonly regressed: string[];
  /** In both. */
  readonly unchanged: number;
  /** How many the base's set held. */
  readonly base: number;
}

/**
 * Take one measure's difference between the two trees' sets.
 * @param head - this checkout's set
 * @param base - the base revision's set
 * @returns the difference, with the two directional sets themselves
 */
function differenceOf(head: Set<string>, base: Set<string>): Difference {
  return {
    fixed: [...base].filter((source) => !head.has(source)),
    regressed: [...head].filter((source) => !base.has(source)),
    unchanged: [...head].filter((source) => base.has(source)).length,
    base: base.size,
  };
}

/**
 * Print one measure's row, and its regressed documents when it has
 * any - the count says a gate failed, the documents are what somebody
 * can go and look at.
 * @param measure - the question the row reports on
 * @param head - how many documents this checkout's set holds
 * @param difference - the difference against the base, if there is one
 */
function printMeasure(
  measure: Measure,
  head: number,
  difference: Difference | undefined,
): void {
  const cells =
    difference === undefined
      ? ""
      : String(difference.base).padStart(COUNT_WIDTH) +
        String(difference.fixed.length).padStart(COUNT_WIDTH) +
        String(difference.regressed.length).padStart(COUNT_WIDTH) +
        String(difference.unchanged).padStart(COUNT_WIDTH);
  process.stdout.write(
    `  ${measure.name.padEnd(MEASURE_WIDTH)}${String(head).padStart(COUNT_WIDTH)}${cells}\n`,
  );
  for (const source of difference?.regressed.slice(0, WITNESSES_SHOWN) ?? []) {
    process.stdout.write(`      ${JSON.stringify(source)}\n`);
  }
}

/** What sweeping one domain settled. */
type DomainOutcome =
  | {
      /** Both trees answered about the domain. */
      readonly kind: "measured";
      /** Whether any measure's regressed set was non-empty. */
      readonly regressed: boolean;
    }
  | {
      /** The base tree answered about nothing. */
      readonly kind: "unmeasured";
      /** One line saying what it failed to answer, for the report. */
      readonly why: string;
    };

/**
 * Whether a base tree answered about NOTHING in one domain.
 *
 * A base that threw on every document has been asked and has said
 * nothing: its failing set is the whole domain, so every set
 * difference reports the domain as entirely fixed with nothing
 * regressed - the shape of a green tick over a tree that could not
 * format at all. A base one revision either side of a rename, or one
 * whose install did not take, produces exactly that.
 *
 * The floor is stated as "every document", not "most": a base that
 * threw on some documents and formatted others HAS measured the
 * domain, and its throws are a real part of its failing set.
 * @param base - the base tree's verdicts over the whole domain
 * @returns true when not one document came back formatted
 */
function measuredNothing(base: readonly SweepVerdict[]): boolean {
  return base.every((verdict) => verdict.kind === "threw");
}

/**
 * Sweep one domain on both trees and print its block.
 * @param domain - the domain to sweep
 * @param baseRoot - the base checkout, or undefined for head only
 * @returns what the domain settled
 */
async function reportDomain(
  domain: ProbeDomain,
  baseRoot: string | undefined,
): Promise<DomainOutcome> {
  const documents = probeDocuments(domain);
  const head = await verdictsHere(documents);
  const base =
    baseRoot === undefined ? undefined : await verdictsIn(baseRoot, documents);
  process.stdout.write(
    `\n${domain.name}: ${String(documents.length)} document(s) - ${domain.what}\n`,
  );
  if (base !== undefined && measuredNothing(base)) {
    return {
      kind: "unmeasured",
      why: `probe-domains: the base threw on all ${String(documents.length)} document(s) of the ${domain.name} domain - it measured nothing there, and a set difference against nothing reports the whole domain as fixed`,
    };
  }
  process.stdout.write(
    `  ${"measure".padEnd(MEASURE_WIDTH)}${"head".padStart(COUNT_WIDTH)}${base === undefined ? "" : ["base", "fixed", "regressed", "unchanged"].map((column) => column.padStart(COUNT_WIDTH)).join("")}\n`,
  );
  let regressed = false;
  for (const measure of MEASURES) {
    const here = setOf(documents, head, measure);
    const difference =
      base === undefined
        ? undefined
        : differenceOf(here, setOf(documents, base, measure));
    printMeasure(measure, here.size, difference);
    if (difference !== undefined && difference.regressed.length > 0) {
      regressed = true;
    }
  }
  return { kind: "measured", regressed };
}

/**
 * The domain that spelled a different number of documents than it is
 * pinned at, if any.
 *
 * The measured-nothing floor. Every count this tool prints is a count
 * out of a domain, so a generator that spelled a smaller set - or
 * none at all - would report a smaller failing set as an improvement.
 * Checked for every selected domain BEFORE the base is materialized,
 * since nothing about the base can repair it.
 * @param domains - the selected domains
 * @returns the message naming the first bad domain, or undefined
 */
function shortDomain(domains: readonly ProbeDomain[]): string | undefined {
  for (const domain of domains) {
    const spelled = probeDocuments(domain).length;
    if (spelled !== domain.size) {
      return `probe-domains: the ${domain.name} domain spelled ${String(spelled)} document(s), not the ${String(domain.size)} it is pinned at - nothing it counts is comparable with anything`;
    }
  }
  return undefined;
}

/** What a whole run settled, over every domain it was asked about. */
interface RunOutcome {
  /** Whether any domain regressed on any measure. */
  readonly regressed: boolean;
  /** One line per domain the base tree measured nothing in. */
  readonly unmeasured: readonly string[];
}

/**
 * Sweep every selected domain and print each one's block.
 * @param domains - the selected domains, in report order
 * @param baseRoot - the base checkout, or undefined for head only
 * @returns what the run settled
 */
async function sweepAll(
  domains: readonly ProbeDomain[],
  baseRoot: string | undefined,
): Promise<RunOutcome> {
  let regressed = false;
  const unmeasured: string[] = [];
  for (const domain of domains) {
    // Sequential on purpose: one domain at a time keeps the memory of
    // a run proportional to one domain rather than to four.
    // eslint-disable-next-line no-await-in-loop -- sequential on purpose
    const outcome = await reportDomain(domain, baseRoot);
    if (outcome.kind === "unmeasured") {
      unmeasured.push(outcome.why);
      continue;
    }
    regressed = outcome.regressed || regressed;
  }
  return { regressed, unmeasured };
}

/**
 * Run the harness and set the exit code.
 * @param argv - the arguments after the script name
 */
async function main(argv: readonly string[]): Promise<void> {
  if (wantsHelp(argv)) {
    printUsage(USAGE);
    return;
  }
  const { base, domains } = parseArguments(argv);
  const short = shortDomain(domains);
  if (short !== undefined) {
    cannotRun(short);
    return;
  }
  // A base may be named either way, because the two spellings are the
  // same tree by different routes and only one of them works
  // everywhere: `git archive` needs a colocated `.git`, which a
  // workspace of this repository does not always have.
  let materialized: string | undefined = undefined;
  const baseRoot =
    base === undefined || existsSync(base)
      ? base
      : (materialized = materialize({
          revision: base,
          prefix: "probe-domains-base-",
          install: true,
        }));
  try {
    const { regressed, unmeasured } = await sweepAll(domains, baseRoot);
    if (regressed) {
      process.stdout.write(
        "probe-domains: a regressed set is non-empty - documents this checkout fails and the base does not\n",
      );
      process.exitCode = GATE_FAILED;
    }
    // LAST, so an unmeasured domain wins over a gate verdict taken
    // from the domains that did measure: a run that could not compare
    // part of what it was asked about proved nothing about that part,
    // and 2 is the code that says so.
    for (const why of unmeasured) {
      cannotRun(why);
    }
  } finally {
    if (materialized !== undefined) {
      rmSync(materialized, { recursive: true, force: true });
    }
  }
}

if (import.meta.main) {
  try {
    await main(process.argv.slice(ARGUMENT_START));
  } catch (error) {
    // An unrecognised argument, an unknown domain, a revision `git
    // archive` refuses, a base tree that answered short: none of them
    // swept a single document.
    cannotRun(error instanceof Error ? error.message : String(error));
  }
}
