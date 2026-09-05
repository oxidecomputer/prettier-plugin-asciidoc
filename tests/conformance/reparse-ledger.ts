/**
 * The REPARSE LEDGER: every document in the standing populations
 * whose formatted output re-reads as a different document
 * (tests/conformance/reparse.ts), grouped by the mechanism that
 * produces it and the issue that owns the fix.
 *
 * WHY A PIN. The measurement is only useful if it can be DIFFED. A
 * predicate deleted from `src/print` is safe exactly when this set
 * does not grow, and unnecessary exactly when the set does not shrink
 * without it; neither statement can be made against a number printed
 * on a terminal. So the red list is checked in, the way the sweep
 * quarantines and the reading ledger are, and a commit that changes
 * it says which family it moved and why.
 *
 * MEMBERSHIP IS A CLAIM. Every row carries a family, and a family is
 * a mechanism with an issue behind it - never "this one is known to
 * fail". A row whose mechanism nobody has named is
 * {@link UNCLASSIFIED}, and the generator refuses to write it.
 *
 * Refresh it with `bun run reparse-ledger --write`
 * (scripts/reparse-ledger.ts).
 */
import { readFileSync } from "node:fs";
import { inlineStandingGrid } from "../../scripts/inline-registry.js";
import { pairGrid, standingGrid } from "../../scripts/shape-registry.js";
import { loadCorpus } from "./loader.js";
import { reparseOutcomeOf } from "./reparse.js";

/** Repo-relative ledger path; `scripts/reparse-ledger.ts` writes it. */
export const REPARSE_LEDGER_PATH = "tests/conformance/reparse-ledger.json";

/** One document to assess, and the name it is reported under. */
export interface ReparseCase {
  /**
   * The case id. Namespaced by population, because the three id
   * spaces are independent: a corpus id names a vendored case, a
   * grid id names a registry coordinate, and one file mixing them
   * would let a rename in either space excuse a row in the other.
   */
  readonly id: string;
  /** The document, verbatim. */
  readonly source: string;
}

/**
 * The cases an always-on suite measures: the vendored corpus.
 *
 * Real documents, and cheap - about a second for all 1,614. It is the
 * population whose breaches a contributor most needs to see on the
 * run they do on every save, and the only one where a new breach
 * means "this happens to documents people wrote".
 * @returns the default-tier cases, in a stable order
 */
export function defaultTierCases(): ReparseCase[] {
  return loadCorpus().flatMap((group) =>
    group.cases.map((one) => ({
      id: `corpus/${group.name}/${one.id}`,
      source: one.input,
    })),
  );
}

/**
 * Every case: the corpus, and both registries' realized shapes.
 *
 * The line registry's grids reach block coordinates no corpus
 * contains, and its PAIR grid is where the mechanisms this check
 * exists to find actually live - a join, a de-indent and a dropped
 * blank all need an ADJACENCY, and nothing else enumerates
 * adjacencies. The inline registry's standing grid reaches mark
 * boundaries, attrlists in front of spans and reflow edges the line
 * registry never varies.
 *
 * Deep because it is 87,145 documents formatted twice, which is more
 * than a suite run on every save can carry and well inside what the
 * blocking deep step can. Every deep case is one the default tier
 * would measure if it were free.
 *
 * Two products are deliberately out. The BYTE OPERATORS multiply the
 * row count by nine for a dimension this measurement does not vary
 * along: a trailing form feed does not change what a line re-reads
 * as, and the sweep quarantines already carry the crossing for the
 * properties that do. The INLINE pair grid is a budget ruling and
 * nothing else - it is an order of magnitude past the line pair grid,
 * for the dimension the inline standing grid already crosses.
 * @returns the deep-tier cases, in a stable order
 */
export function deepTierCases(): ReparseCase[] {
  const cases = defaultTierCases();
  for (const row of [...standingGrid(), ...pairGrid()]) {
    cases.push({ id: `line/${row.id}`, source: row.input });
  }
  for (const shape of inlineStandingGrid()) {
    cases.push({ id: `inline/${shape.id}`, source: shape.input });
  }
  return cases;
}

/**
 * Is this ledger row inside the default tier?
 *
 * Read off the id namespace rather than by re-deriving the
 * population, so the two entries can never disagree about which rows
 * belong to which.
 * @param row - a ledger row
 * @returns whether the default tier measures it
 */
export function isDefaultTier(row: ReparseLedgerRow): boolean {
  return row.id.startsWith("corpus/");
}

/**
 * The measured-nothing floor over {@link deepTierCases}, which is the
 * population the generator sweeps. A population this short is a
 * population that did not load, and with `--write` it would rewrite
 * the ledger to empty - every pin deleted by a green run. Measured:
 * 87,145 cases.
 */
export const MINIMUM_POPULATION = 80_000;

/**
 * The same floor over {@link defaultTierCases}. Measured: 1,614
 * vendored cases plus whatever `tests/conformance/corpus/` holds, so
 * 1,500 is clear of the count today and still red for the two ways
 * the corpus goes missing - a vendor directory that did not extract,
 * and a run whose cwd is not the repository root.
 *
 * Both floors exist because set equality against a pin is GREEN when
 * both sides are empty, so a population that failed to load would
 * pass this gate loudest of all.
 */
export const MINIMUM_DEFAULT_POPULATION = 1500;

/** One mechanism: what it does, and the issue that owns the fix. */
export interface ReparseFamily {
  /** The issue whose fix removes this family's rows. */
  readonly issue: string;
  /** What the mechanism is, in one sentence. */
  readonly what: string;
}

/**
 * The closed family enumeration.
 *
 * Four of the mechanisms are open issues in the
 * "Formatting is render-safe" milestone, reproduced from the OUTSIDE
 * by a check that knows nothing about them: no predicate in
 * `src/print` is consulted, no hazard is modelled, and the rows
 * arrive from populations that were built for other purposes. The
 * other three are gaps this measurement found (#169, #170, #171),
 * two of them tier-1 render losses that every other gate is green
 * on.
 */
export const REPARSE_FAMILIES: Readonly<Record<string, ReparseFamily>> = {
  "indent-dropped": {
    issue: "#121",
    what: "a line's leading indentation is dropped, and the de-indented line reads as a block where the indented one was prose",
  },
  "blank-dropped": {
    issue: "#73",
    what: "the blank line between a metadata-shaped line and the block under it is dropped, so the line stacks as that block's metadata and annotates something it cannot annotate",
  },
  "join-changes-reading": {
    issue: "#124",
    what: "two source lines are joined and the joined text no longer reads as what it read as: line one ends with an opening bracket or a marker that line two completes, or the break the join removed was INSIDE content - a monospace span, a passthrough, a `pass` macro - where the narrowed lens (issue #32) can see the fold. The second face is render-equal on every row of it measured here and is the divergence closed issue #78 accepted, but it is not a family of its own: the two are one mechanism, the rows are told apart only by whether the oracle also read the join as safe, and that is a question this check has no oracle to ask. Filing the benign ones under an accepted normalization would have absolved the render-changing ones with them",
  },
  "plus-respelled": {
    issue: "#116",
    what: "a lone `+` line is folded onto the line above it and comes back spelled `{plus}`, so the hard break the author wrote is an attribute reference on the re-read",
  },
  "gap-line-lost": {
    issue: "#171",
    what: "the `+` line inside a description item's term gap is not written back, and where that `+` was what made the line above it the description, the description leaves the render with it",
  },
  "fence-style-detached": {
    issue: "#170",
    what: "the `[source]` line the fenced-block normalization emits lands where the item's region takes it rather than beside the listing block it annotates, so the re-read block carries no style",
  },
  "xref-across-a-break": {
    issue: "#169",
    what: "a shorthand xref whose bracket text spans a source line break is invisible to our inline reader and visible to the oracle, so the reflow join that closes the break does not change the render but does change what we read; the breach is in the SOURCE reading, not in the output",
  },
};

/**
 * The family a row matching no mechanism is tagged with. Never legal
 * IN the ledger - {@link loadReparseLedger} rejects it - so a
 * mechanism nobody has named cannot be written into the file. It
 * exists so the measured side can carry the tag and the report can
 * print it.
 */
export const UNCLASSIFIED = "unclassified";

/** One ledgered document: what breached, on which pass, and why. */
export interface ReparseLedgerRow {
  /** The case id, as {@link reparsePopulation} spells it. */
  readonly id: string;
  /** `p1` is source versus once-formatted; `p2` is once versus twice. */
  readonly pass: "p1" | "p2";
  /** The projection diff, as tests/conformance/reparse.ts spells it. */
  readonly signature: string;
  /** The mechanism, a key of {@link REPARSE_FAMILIES}. */
  readonly family: string;
}

/**
 * The lines of a document that carry something, with their leading
 * whitespace kept: the sequence a rewrite is read against.
 * @param text - the document
 * @returns its non-blank lines, in order
 */
function contentLines(text: string): string[] {
  return text.split("\n").filter((line) => line.trim() !== "");
}

/**
 * Everything a document says, with every line break and run of
 * whitespace spelled the same way. Two texts that agree here hold the
 * same words in the same order, however they are laid out.
 * @param text - the document
 * @returns the words, blank-separated
 */
function words(text: string): string {
  return text.trim().replaceAll(/\s+/gv, " ");
}

/**
 * Did the printer take the indent off a line it otherwise kept?
 * @param source - the document as written
 * @param once - the formatted output
 * @returns whether some line lost its leading whitespace and nothing else
 */
function droppedAnIndent(source: string, once: string): boolean {
  const before = contentLines(source);
  const after = contentLines(once);
  if (before.length !== after.length) {
    return false;
  }
  // "and nothing else", spelled out: every line either stands byte
  // for byte or differs ONLY in its leading whitespace, and at least
  // one does the second. A `some` alone would claim the mechanism for
  // a document that also rewrote a line's words.
  const shifted = before.filter(
    (line, index) =>
      line !== after[index] && line.trimStart() === after[index].trimStart(),
  );
  const kept = before.filter((line, index) => line === after[index]);
  return shifted.length > 0 && shifted.length + kept.length === before.length;
}

/**
 * Did the printer close a blank line that stood between two lines it
 * otherwise kept?
 * @param source - the document as written
 * @param once - the formatted output
 * @returns whether a blank went and every other line stayed
 */
function droppedABlank(source: string, once: string): boolean {
  const before = source.split("\n").filter((line) => line.trim() === "").length;
  const after = once.split("\n").filter((line) => line.trim() === "").length;
  return (
    after < before &&
    contentLines(source).join("\n") === contentLines(once).join("\n")
  );
}

/**
 * Did the printer join two lines, keeping every word?
 * @param source - the document as written
 * @param once - the formatted output
 * @returns whether the line count fell with the words intact
 */
function joinedLines(source: string, once: string): boolean {
  return (
    contentLines(once).length < contentLines(source).length &&
    words(source) === words(once)
  );
}

/**
 * Did a line go without its words arriving anywhere?
 * @param source - the document as written
 * @param once - the formatted output
 * @returns whether the output holds fewer lines AND fewer words
 */
function lostALine(source: string, once: string): boolean {
  return (
    contentLines(once).length < contentLines(source).length &&
    words(source) !== words(once)
  );
}

/**
 * Was the construct the after side mints already spelled in the
 * SOURCE, across a line break?
 *
 * What separates a reader gap from a printer defect. `<<a,b\nc>>` is
 * a cross reference to the oracle and two lines of prose to us; the
 * join changes no render and changes our reading. A join that built a
 * reference out of two unrelated lines has no such pair in the source
 * and is a printer defect instead.
 * @param source - the document as written
 * @param open - the construct's opening bytes
 * @param close - its closing bytes
 * @returns whether the source spells the pair across a break
 */
function spansABreak(source: string, open: string, close: string): boolean {
  const at = source.indexOf(open);
  if (at === -1) {
    return false;
  }
  const rest = source.slice(at + open.length);
  const end = rest.indexOf(close);
  return end !== -1 && rest.slice(0, end).includes("\n");
}

/**
 * Does the after side of a signature mint a token the before side has
 * none of?
 * @param signature - the projection diff
 * @param token - the token prefix to look for
 * @returns whether the token appears only after the arrow
 */
function mintedAfter(signature: string, token: string): boolean {
  const arrow = signature.lastIndexOf("] -> [");
  if (arrow === -1) {
    return false;
  }
  return (
    !signature.slice(0, arrow).includes(token) &&
    signature.slice(arrow).includes(token)
  );
}

/** What a mechanism is read from: both texts, and what changed. */
export interface ReparseEvidence {
  /** The document as written. */
  readonly source: string;
  /** `format(source)`. */
  readonly once: string;
  /** The projection diff. */
  readonly signature: string;
}

/**
 * Did a join close a break that the ORACLE had already read through?
 *
 * The one shape where a breach is evidence about our READER rather
 * than about the printer: the construct is spelled in the source
 * across a line break, we mint no node for it and Asciidoctor does,
 * so the join changes no render and changes our reading. Shared by
 * the two arms it separates, so neither can drift from the other.
 * @param evidence - both texts and the diff
 * @returns whether the breach is that shape
 */
function readerGapJoin(evidence: ReparseEvidence): boolean {
  return (
    mintedAfter(evidence.signature, "xref(") &&
    spansABreak(evidence.source, "<<", ">>")
  );
}

/** One family's name and the test that recognizes its mechanism. */
interface FamilyArm {
  /** The family key, a key of {@link REPARSE_FAMILIES}. */
  readonly family: string;
  /**
   * Does this breach show that mechanism? Read from the two TEXTS
   * first and the signature second, because a mechanism is something
   * the printer DID - it joined, it de-indented, it closed a blank -
   * and the signature only says what that cost.
   */
  readonly matches: (evidence: ReparseEvidence) => boolean;
}

/**
 * The arms, in the order {@link reparseFamily} reads them.
 *
 * Each arm tests its OWN mechanism rather than relying on an earlier
 * arm to have taken the row: a reader can check any line of this
 * table against the family text beside it without holding the six
 * lines above it in mind, and
 * tests/conformance/reparse.test.ts asserts that at most one arm
 * claims any ledgered row - with ONE documented exception. A respelt
 * `+` is also a shorter document, so `plus-respelled` and
 * `gap-line-lost` both claim those rows; order settles it, and the
 * test asserts that pair specifically rather than waving the overlap
 * through.
 */
const FAMILY_ARMS: readonly FamilyArm[] = [
  {
    family: "plus-respelled",
    matches: ({ signature }) =>
      mintedAfter(signature, 'attributeReference(name="plus")'),
  },
  {
    family: "xref-across-a-break",
    matches: readerGapJoin,
  },
  {
    family: "indent-dropped",
    matches: ({ source, once }) => droppedAnIndent(source, once),
  },
  {
    family: "blank-dropped",
    matches: ({ source, once }) => droppedABlank(source, once),
  },
  {
    family: "join-changes-reading",
    // NOT a reader gap, stated here rather than left to arm order: a
    // join that merely closed a break the oracle had already read
    // through is #169's mechanism and not this one, and a table whose
    // rows are told apart by which line comes first is a table whose
    // distinctions a reader cannot check.
    matches: (evidence) =>
      joinedLines(evidence.source, evidence.once) && !readerGapJoin(evidence),
  },
  {
    family: "fence-style-detached",
    matches: ({ signature }) => mintedAfter(signature, "blockAttributeList("),
  },
  {
    family: "gap-line-lost",
    matches: ({ source, once }) => lostALine(source, once),
  },
];

/**
 * Every family whose mechanism this breach shows.
 *
 * Exported for the test that holds the arms apart: a row two arms
 * both claim is a table whose distinctions are carried by the order
 * of its lines rather than by what its lines say.
 * @param evidence - both texts and the diff
 * @returns the family keys, in arm order
 */
export function matchingFamilies(evidence: ReparseEvidence): string[] {
  return FAMILY_ARMS.filter((arm) => arm.matches(evidence)).map(
    (arm) => arm.family,
  );
}

/**
 * The mechanism a breach belongs to.
 * @param evidence - both texts and the diff
 * @returns the family key, or undefined when no arm claims it
 */
export function reparseFamily(evidence: ReparseEvidence): string | undefined {
  return matchingFamilies(evidence)[0];
}

/**
 * Measure a population and spell each breach as a ledger key.
 *
 * Shared by both tier entries and written once, so the two cannot
 * disagree about how a measured breach is named.
 * @param population - the cases to assess
 * @returns one key per breach, in population order
 */
export async function measuredKeys(
  population: readonly ReparseCase[],
): Promise<string[]> {
  const keys: string[] = [];
  for (const one of population) {
    // eslint-disable-next-line no-await-in-loop -- one document at a time, as scripts/reparse-ledger.ts explains
    const outcome = await reparseOutcomeOf(one.source);
    for (const breach of outcome.breaches) {
      keys.push(
        ledgerKey({
          id: one.id,
          pass: breach.pass,
          signature: breach.signature,
          family:
            reparseFamily({
              source: one.source,
              once: outcome.once,
              signature: breach.signature,
            }) ?? UNCLASSIFIED,
        }),
      );
    }
  }
  return keys;
}

/** Exactly the keys a ledger row may carry. */
const ROW_KEYS = new Set(["id", "pass", "signature", "family"]);

/**
 * Read and validate the pinned ledger.
 *
 * An unknown key is REJECTED rather than ignored, because that is the
 * shape a typo takes: a `"famly"` row merely dropped takes the
 * ledger's length down with it, and a shorter ledger reads as
 * progress.
 * @returns the rows, in file order
 */
export function loadReparseLedger(): ReparseLedgerRow[] {
  const parsed: unknown = JSON.parse(readFileSync(REPARSE_LEDGER_PATH, "utf8"));
  const rows = isRecord(parsed) ? parsed.rows : undefined;
  if (!Array.isArray(rows)) {
    throw new TypeError(`${REPARSE_LEDGER_PATH}: expected {note, rows}`);
  }
  return rows.map((row, index) => validRow(row, index));
}

/**
 * One row, checked.
 * @param row - the parsed value
 * @param index - its position, for the message
 * @returns the row
 */
function validRow(row: unknown, index: number): ReparseLedgerRow {
  const where = `${REPARSE_LEDGER_PATH}[${String(index)}]`;
  if (!isRecord(row)) {
    throw new TypeError(`${where}: expected an object`);
  }
  for (const key of Object.keys(row)) {
    if (!ROW_KEYS.has(key)) {
      throw new TypeError(`${where}: unknown key ${JSON.stringify(key)}`);
    }
  }
  if (!isRowShaped(row)) {
    throw new TypeError(`${where}: expected {id, pass, signature, family}`);
  }
  if (!Object.hasOwn(REPARSE_FAMILIES, row.family)) {
    throw new TypeError(
      `${where}: ${JSON.stringify(row.family)} is not a declared family`,
    );
  }
  return row;
}

/**
 * Is this value a plain object? A type PREDICATE rather than an
 * assertion, so reading a hand-edited ledger stays checked.
 * @param value - the parsed JSON value
 * @returns whether it can be read as a record
 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

/**
 * Does this value carry the four values a row carries, each with the
 * type it must have?
 * @param row - the value read out of the ledger
 * @returns whether it is a well typed row
 */
function isRowShaped(row: unknown): row is ReparseLedgerRow {
  return (
    isRecord(row) &&
    typeof row.id === "string" &&
    typeof row.signature === "string" &&
    typeof row.family === "string" &&
    (row.pass === "p1" || row.pass === "p2")
  );
}

/**
 * One row's key, for set comparison. The signature rides along: a row
 * that starts failing for a DIFFERENT reason at the same coordinate
 * is a change the pin must show.
 * @param row - the row
 * @returns its key
 */
export function ledgerKey(row: ReparseLedgerRow): string {
  return `${row.id} :: ${row.pass} :: ${row.family} :: ${row.signature}`;
}

/**
 * Rows in the ledger's canonical order: by id, then pass. The
 * generator and the gate both sort, so a population reordering moves
 * no line of the file.
 * @param rows - the rows to order
 * @returns a sorted copy
 */
export function sortedRows(
  rows: readonly ReparseLedgerRow[],
): ReparseLedgerRow[] {
  return [...rows].toSorted((left, right) =>
    ledgerKey(left) < ledgerKey(right)
      ? -1
      : Number(ledgerKey(left) > ledgerKey(right)),
  );
}
