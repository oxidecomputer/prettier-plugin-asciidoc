/**
 * The block-structure comparison's two ledgers: the closed family
 * enumeration, the file shapes, the gate each one runs, and the floors
 * a run has to clear before any of that means anything.
 *
 * The floors and the refused-case pin live here rather than in either
 * caller because BOTH callers enforce them - `scripts/block-structure.ts`
 * and `tests/conformance/structure.test.ts` - and two independent
 * declarations of the same floor is a half-enforced floor.
 *
 * TWO ledgers, because the two corpora have different id economics.
 * The corpus half is keyed BY CASE ID and pins a signature, so a fix
 * that turns one divergence into a different one fails until somebody
 * rewrites or deletes the entry. The sweep half is keyed BY SIGNATURE
 * and pins a count plus a canonical example, because per-id is not an
 * option - the depth-5 product alone diverges on 12,645 generated
 * documents - and a count that moves is the same forcing function.
 *
 * Split out of `scripts/block-structure.ts` to keep that file under
 * the project's `max-lines` ceiling, the same way `scripts/parity.ts`
 * and `scripts/parity-ledger.ts` are split. Nothing here imports from
 * `block-structure.ts`, so the pair stays acyclic.
 */
import { readFileSync, writeFileSync } from "node:fs";

/** Where the per-id corpus ledger lives. */
export const CORPUS_LEDGER_PATH = "scripts/block-structure-corpus.json";

/** Where the per-signature sweep ledger lives. */
export const SWEEP_LEDGER_PATH = "scripts/block-structure-sweep.json";

/**
 * The floor below which a corpus "pass" is meaningless: every case the
 * loader finds today. Re-derive it with
 * `loadCorpus().flatMap((group) => group.cases).length` before moving
 * it. A wrong cwd or a `vendor/` regression makes the loop compare
 * nothing, and without this the gate would pass silently on nothing.
 */
export const MINIMUM_CASES = 1614;

/**
 * The floor for the sweep half: the depth-4 product's size. Depths
 * above 4 spell strictly more documents, so one floor covers them all
 * - and depths BELOW 4 spell fewer, so this floor refuses them.
 */
export const MINIMUM_SWEEP_DOCUMENTS = 11_128;

/**
 * The one corpus case Asciidoctor's own `load()` refuses: it sets
 * `:backend: docbook5`, and the JavaScript build ships no converter
 * for that backend, so loading aborts before any block exists.
 *
 * Pinned by IDENTITY rather than counted, because a count of one is
 * satisfied by any one document: a corpus re-fetch that dropped this
 * case while some other document started failing to load would keep
 * the count at one and drop that other document from the comparison
 * unremarked.
 */
const ORACLE_REFUSES =
  "attributes_test.rb#backend attributes are updated if backend attribute " +
  "is defined in document and safe mode is less than SERVER#0";

/**
 * Whether the documents the oracle refused are exactly the pinned one.
 * A refusal the pin does not name shrinks the comparison invisibly; a
 * pin nothing refuses any more is stale and hides the next refusal
 * behind an expectation nobody rechecks.
 * @param refused - every case id whose `load()` threw, in corpus order
 * @returns the complaint, or undefined when the set is exactly the pin
 */
export function refusalComplaint(
  refused: readonly string[],
): string | undefined {
  const unexpected = refused.filter((id) => id !== ORACLE_REFUSES);
  if (unexpected.length > 0) {
    const more =
      unexpected.length > 1
        ? ` (and ${String(unexpected.length - 1)} more)`
        : "";
    return `block-structure: the oracle refused ${JSON.stringify(unexpected[0])}${more}, which ORACLE_REFUSES does not name - the comparison shrank`;
  }
  if (!refused.includes(ORACLE_REFUSES)) {
    return `block-structure: the oracle no longer refuses ${JSON.stringify(ORACLE_REFUSES)} - delete ORACLE_REFUSES and the check that reads it, or the next refusal rides in under a stale expectation`;
  }
  return undefined;
}

/**
 * The family a generated entry carries until a human names it. NOT in
 * {@link BLOCK_STRUCTURE_FAMILIES}, so the gate fails on it by the
 * same rule that rejects a typo: `--write` records what is there, a person says
 * what it means.
 */
const UNTRIAGED = "UNTRIAGED";

/**
 * The closed family enum, in two prefixes, because a block-structure
 * entry means one of two very different things.
 *
 * `gap:*` - our model is wrong or incomplete: a real conformance gap,
 * mapped to an issue, and it MUST SHRINK.
 *
 * `oracle:*` - the oracle RESOLVED something a formatter must not
 * resolve (an attribute value, a conditional, a doctype's semantics).
 * PERMANENT BY DESIGN. The split is not cosmetic: without it the
 * corpus ledger reads as 412 bugs when 71 of its rows are statements
 * about what a formatter is.
 *
 * The `oracle:*` rows are LEDGERED rather than excluded on purpose. An
 * exclusion rule is a silent filter that can grow; 71 rows with a
 * stated family are reviewable.
 */
export const BLOCK_STRUCTURE_FAMILIES: ReadonlySet<string> = new Set([
  // `term::` lines are paragraphs to us; we have no dlist node at all,
  // so every oracle `dlist` context is unmatched. The largest single
  // family, and that is the correct outcome - it makes #9's shape
  // claim explicit.
  "gap:dlist",
  // `Title\n=====` two-line titles (#16): a heading plus a list to the
  // oracle, while the `====` opens an EXAMPLE block for us that
  // swallows the rest of the document. The bytes round-trip and the
  // HTML matches, so the idempotency and fidelity properties see
  // nothing.
  "gap:setext-title",
  // `1.`, `A.`, `i)`, `IV)` explicit markers (#12).
  "gap:ordered-marker",
  // `> quoted` blocks (#22).
  "gap:md-quote",
  // `---` / `***` Markdown thematic breaks (#23).
  "gap:md-thematic-break",
  // YAML front matter (#21).
  "gap:front-matter",
  // `## Section One`, `## Section One ##` (#63).
  "gap:md-atx-heading",
  // `~~~~ javascript` - a fenced block to the oracle, not to us (#64).
  "gap:md-fence-edge",
  // A style RE-MODELS the block (#61): `[abstract]`/`[partintro]`/
  // `[sidebar]`/`[example]`/`[quote]` on a paragraph, `[NOTE]` on an
  // undelimited paragraph, `[source]` on `....`, `[normal]` on an
  // indented run, `[verse.epigraph]` on `____`.
  "gap:styled-block-remodel",
  // `"...quote..."` followed by `-- Attribution` is a quote block to
  // the oracle (#62).
  "gap:quoted-paragraph",
  // A leading U+FEFF makes us read `= Title` as a paragraph; the
  // oracle's reader strips the BOM (#60).
  "gap:utf8-bom",
  // `foo::bar[]` for a name Ruby registered as an extension and we
  // accept generically (#51-adjacent).
  "gap:block-macro-name",
  // A metadata run plus a tail at the end of an item is FOLDED INTO
  // THE ITEM'S PRINCIPAL TEXT by the oracle; we attach it as a child
  // block (#27). The largest sweep family.
  "gap:lazy-continuation",
  // Ruby's literal-paragraph branch is `if (indented && !style)`, so
  // `[role]` before an indented run makes a PARAGRAPH; we make a
  // literal regardless. #61-adjacent - the same style rule, met on the
  // sweep's side rather than the corpus's.
  "gap:indent-literal-style",
  // A nested list behind an attributed indented run is lost: the
  // oracle sees `item(list(item))` where we see `item(literal)`
  // (#35 / #50).
  "gap:nested-list-lost",
  // The oracle EVALUATES `ifdef`/`ifndef`/`ifeval` and drops or keeps
  // the body. A formatter must not.
  "oracle:conditional",
  // Under `:doctype: manpage` the NAME section is consumed into
  // `manname`/`manpurpose`.
  "oracle:manpage-doctype",
  // Under `:doctype: book` the oracle wraps a part's paragraphs in a
  // `partintro` open block.
  "oracle:book-partintro",
  // A `[comment]`-styled block is dropped by the oracle entirely.
  "oracle:comment-style",
  // `:attribute-missing: drop-line` makes the oracle drop a line.
  "oracle:attribute-missing",
  // `:doctitle:` creates a document title with no `=` line.
  "oracle:doctitle-attribute",
  // `:leveloffset:` arithmetic and `[appendix]` promotion under
  // `:doctype: book`. Only reachable under `--levels`, which is off by
  // default precisely because its whole population is this family.
  "oracle:leveloffset",
]);

/** One corpus ledger entry: a diverging case, and what its shape is. */
interface CorpusEntry {
  /** The family, from {@link BLOCK_STRUCTURE_FAMILIES}. */
  family: string;
  /** The divergence signature this case is pinned to. */
  signature: string;
}

/** The per-id corpus ledger, header included. */
export interface CorpusLedger {
  /** The oracle that measured these entries, name and version. */
  oracle: string;
  /** When and why the entries are regenerated. */
  regenerate: string;
  /** Every diverging corpus case, keyed by case id. */
  cases: Record<string, CorpusEntry>;
}

/** One sweep ledger row: a signature, how often, and one instance. */
interface SweepRow {
  /** The family, from {@link BLOCK_STRUCTURE_FAMILIES}. */
  family: string;
  /** Exactly how many sweep documents carry this signature. */
  count: number;
  /** One document that carries it, checked to still carry it. */
  example: string;
}

/** The per-signature sweep ledger, header included. */
export interface SweepLedger {
  /** The oracle that measured these rows, name and version. */
  oracle: string;
  /** The sweep depth the counts were measured at. */
  depth: number;
  /** When and why the rows are regenerated. */
  regenerate: string;
  /** Every diverging signature, keyed by the signature itself. */
  signatures: Record<string, SweepRow>;
}

/**
 * The regeneration policy, written into both ledger headers so it is
 * read where the numbers are.
 */
const REGENERATE_POLICY =
  "Measured, not authored: regenerate with `bun run block-structure " +
  "--write` whenever the oracle pin or the parser moves, then read the " +
  "diff - it is the artifact that says what a change did to our " +
  "conformance.";

/**
 * The oracle that ran, as a string for the ledger header. Read from
 * the INSTALLED package rather than the dependency range, because the
 * installed one is what produced the numbers.
 * @returns e.g. `@asciidoctor/core 4.0.11`
 */
export function oracleVersion(): string {
  const parsed: unknown = JSON.parse(
    readFileSync("node_modules/@asciidoctor/core/package.json", "utf8"),
  );
  const version =
    parsed instanceof Object && "version" in parsed
      ? parsed.version
      : undefined;
  return `@asciidoctor/core ${typeof version === "string" ? version : "unknown"}`;
}

/**
 * Whether both ledgers were measured against the oracle that is
 * installed now. The header exists to make the oracle boundary
 * auditable, and a header nothing compares audits nothing: a bumped
 * pin leaves every count in both files describing a different parser,
 * so a gate run against them measured nothing meaningful.
 * @param corpus - the loaded corpus ledger
 * @param sweep - the loaded sweep ledger
 * @returns the complaint, or undefined when both headers match
 */
export function staleOracleComplaint(
  corpus: CorpusLedger,
  sweep: SweepLedger,
): string | undefined {
  const installed = oracleVersion();
  const recorded = new Map([
    [CORPUS_LEDGER_PATH, corpus.oracle],
    [SWEEP_LEDGER_PATH, sweep.oracle],
  ]);
  for (const [file, was] of recorded) {
    if (was === installed) {
      continue;
    }
    return `block-structure: ${file} was measured against ${JSON.stringify(was)} and ${JSON.stringify(installed)} is installed - regenerate with \`bun run block-structure --write\` and read the diff`;
  }
  return undefined;
}

/**
 * Compare strings by UTF-16 code units, not locale - the ledgers must
 * serialize identically on every contributor's machine.
 * @param a - left-hand string
 * @param b - right-hand string
 * @returns negative, zero, or positive per the usual sort contract
 */
function byCodeUnit(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

/**
 * Narrow an unknown value to a plain object with string keys.
 * @param value - anything parsed from a ledger file
 * @returns whether its properties can be read by name
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value instanceof Object;
}

/**
 * Read and validate the corpus ledger. Strict on purpose: a malformed
 * ledger that silently excused everything would turn the gate off.
 * @param file - path to the ledger
 * @returns the ledger
 * @throws {TypeError} when the file is not a corpus ledger
 */
export function loadCorpusLedger(file: string): CorpusLedger {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!isRecord(parsed) || !isRecord(parsed.cases)) {
    throw new TypeError(
      `block-structure: ${file} is not { oracle, regenerate, cases }`,
    );
  }
  const cases: Record<string, CorpusEntry> = {};
  for (const [id, value] of Object.entries(parsed.cases)) {
    if (
      !isRecord(value) ||
      typeof value.family !== "string" ||
      typeof value.signature !== "string"
    ) {
      throw new TypeError(
        `block-structure: ${file}: malformed entry for ${id}`,
      );
    }
    cases[id] = { family: value.family, signature: value.signature };
  }
  return {
    oracle: typeof parsed.oracle === "string" ? parsed.oracle : "unknown",
    regenerate: REGENERATE_POLICY,
    cases,
  };
}

/**
 * Read and validate the sweep ledger.
 * @param file - path to the ledger
 * @returns the ledger
 * @throws {TypeError} when the file is not a sweep ledger
 */
export function loadSweepLedger(file: string): SweepLedger {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (
    !isRecord(parsed) ||
    !isRecord(parsed.signatures) ||
    typeof parsed.depth !== "number"
  ) {
    throw new TypeError(
      `block-structure: ${file} is not { oracle, depth, signatures }`,
    );
  }
  const signatures: Record<string, SweepRow> = {};
  for (const [sign, value] of Object.entries(parsed.signatures)) {
    if (
      !isRecord(value) ||
      typeof value.family !== "string" ||
      typeof value.count !== "number" ||
      typeof value.example !== "string"
    ) {
      throw new TypeError(
        `block-structure: ${file}: malformed row for ${sign}`,
      );
    }
    signatures[sign] = {
      family: value.family,
      count: value.count,
      example: value.example,
    };
  }
  return {
    oracle: typeof parsed.oracle === "string" ? parsed.oracle : "unknown",
    depth: parsed.depth,
    regenerate: REGENERATE_POLICY,
    signatures,
  };
}

/**
 * One corpus entry's own failure, if any. Split out of
 * {@link corpusFailures} to stay under the complexity ceiling; each
 * entry produces at most one failure, so returning a single value
 * keeps the caller's ordering identical.
 * @param id - the case the entry claims
 * @param entry - the entry
 * @param observed - the signature every diverging case actually has
 * @param corpusIds - every id the corpus loaded
 * @returns the failure message, or undefined when the entry is clean
 */
function corpusEntryFailure(
  id: string,
  entry: CorpusEntry,
  observed: ReadonlyMap<string, string>,
  corpusIds: ReadonlySet<string>,
): string | undefined {
  if (!BLOCK_STRUCTURE_FAMILIES.has(entry.family)) {
    const hint =
      entry.family === UNTRIAGED
        ? " - `--write` recorded it; name its family"
        : "";
    return `block-structure: unknown family ${JSON.stringify(entry.family)} on ${id}${hint}`;
  }
  if (!corpusIds.has(id)) {
    return `block-structure: ${id} is not in the corpus (vanished id, stale entry - delete it)`;
  }
  const signature = observed.get(id);
  if (signature === undefined) {
    return `block-structure: ${id} no longer diverges (fixed - delete the entry to pin it)`;
  }
  if (signature !== entry.signature) {
    return `block-structure: ${id} now diverges as ${JSON.stringify(signature)}, ledgered as ${JSON.stringify(entry.signature)}`;
  }
  return undefined;
}

/**
 * The corpus gate: every way the ledger and the run can disagree.
 * Every returned line is a failure; an empty result is a pass.
 * @param ledger - the loaded corpus ledger
 * @param observed - the signature every diverging case actually has
 * @param corpusIds - every id the corpus loaded
 * @returns one message per failure
 */
export function corpusFailures(
  ledger: CorpusLedger,
  observed: ReadonlyMap<string, string>,
  corpusIds: ReadonlySet<string>,
): string[] {
  const failures: string[] = [];
  for (const [id, entry] of Object.entries(ledger.cases)) {
    const failure = corpusEntryFailure(id, entry, observed, corpusIds);
    if (failure !== undefined) {
      failures.push(failure);
    }
  }
  for (const [id, signature] of observed) {
    if (id in ledger.cases) {
      continue;
    }
    failures.push(
      `block-structure: ${id} diverges as ${JSON.stringify(signature)} and is not in ${CORPUS_LEDGER_PATH}`,
    );
  }
  return failures;
}

/** What the run measured for one sweep signature. */
export interface SweepObservation {
  /** How many documents carried it. */
  count: number;
  /** The first document that carried it, in product order. */
  example: string;
}

/**
 * One sweep row's own failure, if any.
 * @param sign - the signature the row claims
 * @param row - the row
 * @param observed - what the run measured, per signature
 * @param exampleSignatures - each ledgered example's signature TODAY
 *   (absent when that document no longer diverges at all)
 * @returns the failure message, or undefined when the row is clean
 */
function sweepRowFailure(
  sign: string,
  row: SweepRow,
  observed: ReadonlyMap<string, SweepObservation>,
  exampleSignatures: ReadonlyMap<string, string>,
): string | undefined {
  if (!BLOCK_STRUCTURE_FAMILIES.has(row.family)) {
    const hint =
      row.family === UNTRIAGED
        ? " - `--write` recorded it; name its family"
        : "";
    return `block-structure: unknown family ${JSON.stringify(row.family)} on sweep ${JSON.stringify(sign)}${hint}`;
  }
  const seen = observed.get(sign);
  if (seen === undefined) {
    return `block-structure: sweep signature ${JSON.stringify(sign)} no longer occurs (fixed - delete the row to pin it)`;
  }
  if (seen.count !== row.count) {
    return `block-structure: sweep signature ${JSON.stringify(sign)} now covers ${String(seen.count)} documents, ledgered as ${String(row.count)}`;
  }
  // The count alone says nothing about WHICH documents diverge, so a
  // fix could repair five and break five. The named example is the
  // cheap half of that hole: it must still carry this very signature.
  const current = exampleSignatures.get(row.example);
  if (current !== sign) {
    return `block-structure: sweep example ${JSON.stringify(row.example)} now diverges as ${JSON.stringify(current ?? "")}, ledgered under ${JSON.stringify(sign)}`;
  }
  return undefined;
}

/**
 * The sweep gate: every way the ledger and the run can disagree.
 * @param ledger - the loaded sweep ledger
 * @param observed - what the run measured, per signature
 * @param exampleSignatures - each ledgered example's signature today
 * @returns one message per failure
 */
export function sweepFailures(
  ledger: SweepLedger,
  observed: ReadonlyMap<string, SweepObservation>,
  exampleSignatures: ReadonlyMap<string, string>,
): string[] {
  const failures: string[] = [];
  for (const [sign, row] of Object.entries(ledger.signatures)) {
    const failure = sweepRowFailure(sign, row, observed, exampleSignatures);
    if (failure !== undefined) {
      failures.push(failure);
    }
  }
  for (const [sign, seen] of observed) {
    if (sign in ledger.signatures) {
      continue;
    }
    failures.push(
      `block-structure: sweep signature ${JSON.stringify(sign)} covers ${String(seen.count)} documents and is not in ${SWEEP_LEDGER_PATH}`,
    );
  }
  return failures;
}

/**
 * Rewrite the corpus ledger from a run, keeping the family a human
 * already named for an id that still diverges. Same discipline as
 * `bun run triage --write`: the tool records what is there, a person
 * says what it means.
 * @param file - path to the ledger
 * @param observed - the signature every diverging case actually has
 * @param previous - the ledger as it stands
 */
export function writeCorpusLedger(
  file: string,
  observed: ReadonlyMap<string, string>,
  previous: CorpusLedger,
): void {
  const named = new Map(Object.entries(previous.cases));
  const cases: Record<string, CorpusEntry> = {};
  for (const [id, sign] of [...observed].toSorted((a, b) =>
    byCodeUnit(a[0], b[0]),
  )) {
    cases[id] = { family: named.get(id)?.family ?? UNTRIAGED, signature: sign };
  }
  const ledger: CorpusLedger = {
    oracle: oracleVersion(),
    regenerate: REGENERATE_POLICY,
    cases,
  };
  writeFileSync(file, `${JSON.stringify(ledger, undefined, 2)}\n`);
}

/**
 * Rewrite the sweep ledger from a run, keeping named families.
 * @param file - path to the ledger
 * @param observed - what the run measured, per signature
 * @param depth - the sweep depth the counts were measured at
 * @param previous - the ledger as it stands
 */
export function writeSweepLedger(
  file: string,
  observed: ReadonlyMap<string, SweepObservation>,
  depth: number,
  previous: SweepLedger,
): void {
  const named = new Map(Object.entries(previous.signatures));
  const signatures: Record<string, SweepRow> = {};
  for (const [sign, seen] of [...observed].toSorted((a, b) =>
    byCodeUnit(a[0], b[0]),
  )) {
    signatures[sign] = {
      family: named.get(sign)?.family ?? UNTRIAGED,
      count: seen.count,
      example: seen.example,
    };
  }
  const ledger: SweepLedger = {
    oracle: oracleVersion(),
    depth,
    regenerate: REGENERATE_POLICY,
    signatures,
  };
  writeFileSync(file, `${JSON.stringify(ledger, undefined, 2)}\n`);
}
