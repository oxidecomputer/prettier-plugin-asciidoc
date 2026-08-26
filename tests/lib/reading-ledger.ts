/**
 * The READING LEDGER: every sweep document whose formatted output
 * re-reads differently from its source (see tests/lib/reading.ts),
 * grouped by the mechanism that produces it and the issue that owns
 * the fix.
 *
 * WHY A GENERATED FILE rather than a hand-kept string list like
 * `tests/format/list-shape-allowlist.ts`. There are 716 of them at
 * depth 5, which is past what a person maintains by hand and well
 * inside what a person REVIEWS as a diff. The ledger keeps that
 * file's two virtues:
 *
 * - LEAVING IS DELIBERATE. Both sweep entries assert set equality
 *   against it, so the commit that fixes a mechanism shrinks the
 *   ledger and has to say so.
 * - MEMBERSHIP IS A CLAIM. Every row carries a family, and a family
 *   is a mechanism with an issue behind it - not "this one is known
 *   to fail".
 *
 * The full document list is kept rather than per-family counts,
 * because counts cannot tell "one fixed, one regressed" from "no
 * change".
 *
 * ONE ledger serves BOTH depths: the depth-4 entry gates against its
 * rows restricted to the depth-4 product, the same derivation
 * `allowlistFor` makes over the render/idempotence allowlist, so a
 * document can never be ledgered at one depth and not the other.
 *
 * Refresh it with `bun run reading-ledger --write`
 * (scripts/reading-ledger.ts).
 */
import { readFileSync } from "node:fs";

/** Repo-relative ledger path; `scripts/reading-ledger.ts` writes it. */
export const READING_LEDGER_PATH = "tests/format/reading-ledger.json";

/** One mechanism: what it does, and the issue that owns the fix. */
export interface ReadingFamily {
  /** The gap issue whose fix removes this family's rows. */
  readonly issue: string;
  /** What the mechanism is, in one sentence. */
  readonly what: string;
}

/**
 * The closed family enumeration. Three mechanisms, not five issues'
 * worth of unknowns - which is the measurement issue #58 was filed to
 * produce.
 *
 * A signature that classifies to none of them is UNCLASSIFIED, and
 * the generator refuses to write it: a ledger row nobody can name a
 * mechanism for is an allowlist entry wearing a registry's clothes.
 */
export const READING_FAMILIES: Readonly<Record<string, ReadingFamily>> = {
  "lone-plus-join": {
    issue: "#43",
    what: "a lone `+` line is joined with adjacent prose, so the continuation dissolves - and one alphabet symbol away the same join manufactures a description-list term",
  },
  "tail-reading-flip": {
    issue: "#65",
    what: "a prose join flips the reading of the line AFTER it: a trailing `.T` from block title to text, or a trailing indented line from literal-paragraph start to text",
  },
  "admonition-colon-run": {
    issue: "#45",
    what: "an admonition label split keeps surplus whitespace, and the re-read takes the residue as a description-list delimiter",
  },
};

/**
 * The family a signature matching no mechanism is tagged with.
 *
 * Never legal IN the ledger - {@link loadReadingLedger} rejects it -
 * so a mechanism nobody has named cannot be written into the file as
 * a row. It exists so the measured side can carry the tag and the
 * failure can print it.
 */
export const UNCLASSIFIED = "unclassified";

// Exactly the keys a row may carry. An unknown key is REJECTED rather
// than ignored, because that is the shape a typo takes: a `"famly"`
// row that is merely dropped takes the ledger's length down with it,
// and a shorter ledger reads as progress.
const ROW_KEYS = new Set(["document", "pass", "signature", "family"]);

/** One ledgered document: what fails, on which pass, and why. */
export interface ReadingLedgerRow {
  /** The sweep document, verbatim. */
  readonly document: string;
  /** `p1` is source versus once-formatted; `p2` is once versus twice. */
  readonly pass: "p1" | "p2";
  /** The reading diff, as `tests/lib/reading.ts` spells it. */
  readonly signature: string;
  /** The mechanism, a key of {@link READING_FAMILIES}. */
  readonly family: string;
}

/**
 * How many `cont` tokens one side of a signature spells.
 * @param side - one side's tokens
 * @returns the count
 */
function continuations(side: readonly string[]): number {
  return side.filter((token) => token === "cont").length;
}

/**
 * The tokens of one bracketed side.
 * @param side - the text between the brackets
 * @returns its tokens, empty for an empty side
 */
function tokensOf(side: string): string[] {
  return side === "" ? [] : side.split(" ");
}

/**
 * Split a signature back into its two token sides.
 * @param signature - `[a b] -> [c]`, as diffSignature spells it
 * @returns the before and after token lists, empty when unparseable
 */
function sidesOf(signature: string): {
  before: string[];
  after: string[];
} {
  const match = /^\[(?<before>.*)\] -> \[(?<after>.*)\]$/v.exec(signature);
  const { before = "", after = "" } = match?.groups ?? {};
  return { before: tokensOf(before), after: tokensOf(after) };
}

/**
 * Which mechanism a signature is, or undefined when it is none of
 * them.
 *
 * The three tests are read off the measured inventory and are
 * deliberately narrow - a widened test would silently absorb a NEW
 * mechanism into an existing issue's row count, which is the one
 * thing this classification exists to prevent.
 *
 * So lone-plus-join asks for the MECHANISM, not merely for its
 * arithmetic: a `cont` is lost, and the only other thing on the
 * losing side is the prose the lone `+` was joined into. A signature
 * that drops a `cont` alongside anything else - an admonition label,
 * a marker, a delimiter - reached that loss by some other path and
 * must not be counted against #43; it falls through to the tests
 * below and, failing those, to UNCLASSIFIED, where the generator
 * refuses to write it and asks for a name.
 * @param signature - the reading diff
 * @returns the family key, or undefined for an unclassified signature
 */
export function readingFamily(signature: string): string | undefined {
  const { before, after } = sidesOf(signature);
  if (
    continuations(before) > continuations(after) &&
    before.every((token) => token === "cont" || token === "text")
  ) {
    return "lone-plus-join";
  }
  if (
    before.some((token) => token.startsWith("admon:")) &&
    after.some((token) => token.startsWith("dlist:"))
  ) {
    return "admonition-colon-run";
  }
  const [only] = before;
  if (
    before.length === 1 &&
    after.length === 1 &&
    after[0] === "text" &&
    (only === "indented" || only === "title")
  ) {
    return "tail-reading-flip";
  }
  return undefined;
}

/**
 * The ledger's canonical row order: by document, by code point.
 *
 * An order rule rather than a taste, for the reason the crossings
 * registry has one: rows that may sit anywhere turn a three-row
 * change into a whole-file diff, and a generated diff nobody can read
 * by eye is a generated file nobody reviews.
 * @param left - one row
 * @param right - another row
 * @returns the comparison, for `toSorted`
 */
export function compareLedgerRows(
  left: ReadingLedgerRow,
  right: ReadingLedgerRow,
): number {
  if (left.document !== right.document) {
    return left.document < right.document ? -1 : 1;
  }
  if (left.pass === right.pass) return 0;
  return left.pass < right.pass ? -1 : 1;
}

/**
 * Validate one parsed row, STRICTLY.
 *
 * Strict because a malformed row silently excusing everything would
 * turn the gate off: an unknown key is how a typo takes a row out of
 * the ledger, and a shorter ledger reads as progress.
 * @param raw - one parsed array element
 * @param at - where it sits, for the message
 * @returns the row, or the reason it is not one
 */
function validateRow(
  raw: unknown,
  at: string,
): { row: ReadingLedgerRow | undefined; fault: string | undefined } {
  if (typeof raw !== "object" || raw === null) {
    return { row: undefined, fault: `${at}: not an object` };
  }
  const extra = Object.keys(raw).filter((key) => !ROW_KEYS.has(key));
  if (extra.length > 0) {
    return {
      row: undefined,
      fault: `${at}: unknown key(s) ${extra.join(", ")}`,
    };
  }
  const { document, pass, signature, family } = raw as {
    document?: unknown;
    pass?: unknown;
    signature?: unknown;
    family?: unknown;
  };
  if (
    typeof document !== "string" ||
    typeof signature !== "string" ||
    typeof family !== "string" ||
    (pass !== "p1" && pass !== "p2")
  ) {
    return { row: undefined, fault: `${at}: malformed row` };
  }
  return classifiedRow({ document, pass, signature, family }, at);
}

/**
 * Cross-check one well-shaped row against the family enumeration.
 *
 * BOTH directions, like every registry here: a family the enum does
 * not declare fails, and so does a row whose signature classifies to
 * a different mechanism than the one it claims. A ledger whose family
 * column has gone stale reads as an audit.
 * @param row - a row whose fields are the right types
 * @param at - where it sits, for the message
 * @returns the row, or the reason its family is wrong
 */
function classifiedRow(
  row: ReadingLedgerRow,
  at: string,
): { row: ReadingLedgerRow | undefined; fault: string | undefined } {
  if (!Object.hasOwn(READING_FAMILIES, row.family)) {
    return {
      row: undefined,
      fault: `${at}: unknown family ${JSON.stringify(row.family)} - the enum is ${Object.keys(READING_FAMILIES).join(" | ")}`,
    };
  }
  const classified = readingFamily(row.signature);
  if (classified !== row.family) {
    return {
      row: undefined,
      fault: `${at}: signature ${JSON.stringify(row.signature)} classifies as ${classified ?? "unclassified"}, not ${row.family}`,
    };
  }
  return { row, fault: undefined };
}

/**
 * Read and validate the ledger.
 * @param file - the ledger path; defaults to the checked-in one,
 *   overridable only so tests can exercise the validation paths
 * @returns the rows, in file order
 * @throws {TypeError} when the file is not a valid ledger
 */
export function loadReadingLedger(
  file: string = READING_LEDGER_PATH,
): ReadingLedgerRow[] {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError(`${file}: expected an object`);
  }
  const { rows } = parsed as { rows?: unknown };
  if (!Array.isArray(rows)) {
    throw new TypeError(`${file}: expected a "rows" array`);
  }
  return rows.map((raw, index) => {
    const { row, fault } = validateRow(raw, `${file}[${String(index)}]`);
    if (row === undefined) throw new Error(fault ?? `${file}: malformed`);
    return row;
  });
}
