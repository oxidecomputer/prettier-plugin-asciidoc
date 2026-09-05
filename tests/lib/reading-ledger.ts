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
 * The closed family enumeration. Named mechanisms, each with an issue
 * behind it, rather than issues' worth of unknowns - which is the
 * measurement issue #58 was filed to produce.
 *
 * A signature that classifies to none of them is UNCLASSIFIED, and
 * the generator refuses to write it: a ledger row nobody can name a
 * mechanism for is an allowlist entry wearing a registry's clothes.
 */
export const READING_FAMILIES: Readonly<Record<string, ReadingFamily>> = {
  "lone-plus-join": {
    issue: "#43",
    what: "a lone `+` line leaves the reading, so the continuation dissolves. #43 is CLOSED and the issue field is provenance, not an open bug: what #43 tracked was the CORRUPTING variant, where a JOIN landed on a dlist-shaped line and manufactured a description list, and that was fixed. What is left is not joins at all - measured over a systematic sample of the rows, no output holds a `+` joined into a text line. Every remaining row DELETES the byte, by one of three routes; classified by shape, each row counted once in the first class it matches. A RUN OF THREE OR MORE (253 rows): its third and later `+` lines are read and dropped without buffering (parser.rb l.1443-44). An ERASED `+` (2,540 of the rest, the plurality): the first of an adjacent pair (l.1439) or one standing under a blank line (l.1576). Erasure alone does not lose the byte - where such a `+` ATTACHED a block it comes back as that block's gap - but in every row of this class it attached nothing, and there its one route back is the shield `ListItemNode.detachedTail` writes, which needs a trailing `+`-paragraph to shield, so an item with nothing to shield loses the byte - an item whose `+` stands directly under the marker line keeps it, the same `+` with a blank above it does not. A TAIL THAT IS NOT INERT (the remaining 100): the pop takes the byte, but it would be printed above a blank line, where a re-read ERASES and arms it instead of popping it. All three are render-equal - the oracle renders the output as the source - and no rows appeared here at all until every lone `+` gained a token",
  },
  "continuation-dropped": {
    issue: "#17",
    what: "continuation lines go away and the list structure beside them does not: the `+` lines vanish from the reading while the markers, comments, anchors and attribute lines around them survive unchanged - the trailing-marker collapse #17 tracks, seen from the reading side",
  },
  "tail-reading-flip": {
    issue: "#65",
    what: "a prose join flips the reading of the line AFTER it: a trailing `.T` from block title to text, or a trailing indented line from literal-paragraph start to text",
  },
  "admonition-colon-run": {
    issue: "#45",
    what: "an admonition label split keeps surplus whitespace, and the re-read takes the residue as a description-list delimiter",
  },
  "prose-reads-as-marker": {
    issue: "#121",
    what: "a line the printer emits without its leading indent re-reads as a LIST MARKER where the indented line read as prose. Two spellings of the one reading, and which one appears depends only on where the de-indented line lands: at a block start it is a marker line outright, and inside a paragraph an earlier `+` attached it is the unreflowable foreign-marker text this projection spells `textv` (src/parse/lines/classify.ts keeps its column because the column decides what a later `+` means). The flip lands on the de-indented line itself, or on a line below it whose enclosing block the de-indent changed. This is #121's reading face: the indent is not carried through the AST, so the printer cannot put it back",
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
 * Is this signature the continuation-dropped mechanism?
 *
 * A separate predicate rather than another arm inline, because the
 * claim it makes is a conjunction of three things and reads better
 * named: a continuation was lost; the losing side carries something
 * that is neither a continuation nor prose (which is what keeps it
 * disjoint from lone-plus-join); and taking the continuations out of
 * both sides leaves them equal, so the continuations are the ONLY
 * thing that moved.
 * @param before - the earlier reading's differing tokens
 * @param after - the later reading's differing tokens
 * @returns whether the signature is that mechanism
 */
function isContinuationDropped(
  before: readonly string[],
  after: readonly string[],
): boolean {
  return (
    continuations(before) > continuations(after) &&
    before.some(isStructural) &&
    withoutContinuations(before) === withoutContinuations(after)
  );
}

/**
 * Is this token neither a continuation nor prose?
 *
 * What tells the two continuation-losing families apart:
 * lone-plus-join's losing side is only `cont` and `text`, and this
 * asks for the token that makes a side something else.
 * @param token - one projected token
 * @returns whether it is structure rather than prose or a `+`
 */
function isStructural(token: string): boolean {
  return token !== "cont" && token !== "text";
}

/**
 * One side with its continuation tokens taken out, as a comparable
 * string.
 *
 * The device that lets continuation-dropped ask whether the
 * continuations are the ONLY thing that moved: if both sides agree
 * once the `cont`s are gone, nothing else did.
 * @param side - one side's tokens
 * @returns the remaining tokens, space-joined, order kept
 */
function withoutContinuations(side: readonly string[]): string {
  return side.filter((token) => token !== "cont").join(" ");
}

/**
 * Is this signature the lone-plus-join mechanism?
 *
 * A continuation is lost and the ONLY other thing on the losing side
 * is the prose it was joined into - see {@link readingFamily} on why
 * the test asks for the mechanism rather than the arithmetic.
 * @param before - the earlier reading's differing tokens
 * @param after - the later reading's differing tokens
 * @returns whether the signature is that mechanism
 */
function isLonePlusJoin(
  before: readonly string[],
  after: readonly string[],
): boolean {
  return (
    continuations(before) > continuations(after) && !before.some(isStructural)
  );
}

/**
 * Is this token a line the reader took for a LIST MARKER?
 *
 * Two spellings, one reading, which is why the predicate below asks
 * for either. `marker:` is a marker line met at a block start.
 * `textv` is the same shape met inside an open paragraph, where the
 * reader keeps it as text it may not reflow because the column it
 * stands in decides what a later `+` means
 * (`classifyInParagraph`, src/parse/lines/classify.ts, and the
 * `textv` note in tests/lib/reading.ts).
 * @param token - one projected token
 * @returns whether it reads as a list marker
 */
function isMarkerReading(token: string): boolean {
  return token === "textv" || token.startsWith("marker:");
}

/**
 * Is this side the prose a de-indented line displaces - nothing at
 * all, or the single `text` token it read as?
 *
 * Nothing at all is not an absence of evidence here: a `text` line
 * that FOLDS into the run above it (tests/lib/reading.ts, `append`)
 * contributes no token of its own, so a folded prose line gaining a
 * marker reading spells an empty left side.
 * @param side - the earlier reading's differing tokens
 * @returns whether it is prose, folded or not
 */
function isDisplacedProse(side: readonly string[]): boolean {
  return side.length === 0 || (side.length === 1 && side[0] === "text");
}

/**
 * Is this signature the prose-reads-as-marker mechanism?
 *
 * Prose on the losing side, one marker reading on the winning side,
 * and nothing else on either. The narrowness is the claim: #121 drops
 * leading indent from lines of every shape, and only the ones that
 * come back as a MARKER are this family - a de-indented line that
 * comes back as a delimiter or a section title reached that by the
 * same byte change but re-reads as something else, and it must be
 * named and counted separately rather than folded in here.
 *
 * Disjoint from the other four BY CONSTRUCTION rather than by arm
 * order: both continuation families need a `cont` on the losing side
 * and admonition-colon-run needs an `admon:` there, where this one
 * allows only `text` or nothing; and tail-reading-flip's winning side
 * is `text`, which is never a marker reading.
 * @param before - the earlier reading's differing tokens
 * @param after - the later reading's differing tokens
 * @returns whether the signature is that mechanism
 */
function isProseReadAsMarker(
  before: readonly string[],
  after: readonly string[],
): boolean {
  return (
    after.length === 1 && isMarkerReading(after[0]) && isDisplacedProse(before)
  );
}

/**
 * Is this signature the admonition-colon-run mechanism?
 *
 * An admonition label on the losing side and a description-list
 * delimiter on the winning one: the surplus whitespace a label split
 * leaves behind, read back as a term's `::`.
 * @param before - the earlier reading's differing tokens
 * @param after - the later reading's differing tokens
 * @returns whether the signature is that mechanism
 */
function isAdmonitionColonRun(
  before: readonly string[],
  after: readonly string[],
): boolean {
  return (
    before.some((token) => token.startsWith("admon:")) &&
    after.some((token) => token.startsWith("dlist:"))
  );
}

/**
 * Is this signature the tail-reading-flip mechanism?
 *
 * One token each side: a block title or a literal-paragraph start
 * that a prose join below it turns into ordinary text.
 * @param before - the earlier reading's differing tokens
 * @param after - the later reading's differing tokens
 * @returns whether the signature is that mechanism
 */
function isTailReadingFlip(
  before: readonly string[],
  after: readonly string[],
): boolean {
  const [only] = before;
  return (
    before.length === 1 &&
    after.length === 1 &&
    after[0] === "text" &&
    (only === "indented" || only === "title")
  );
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
 * The tests are read off the measured inventory and are deliberately
 * narrow - a widened test would silently absorb a NEW mechanism into
 * an existing issue's row count, which is the one thing this
 * classification exists to prevent.
 *
 * So lone-plus-join asks for the MECHANISM, not merely for its
 * arithmetic: a `cont` is lost, and the only other thing on the
 * losing side is the prose the lone `+` was joined into. A signature
 * that drops a `cont` alongside anything else - an admonition label,
 * a marker, a delimiter - reached that loss by some other path and
 * must not be counted against #43.
 *
 * Where it goes instead is continuation-dropped, and the two are
 * disjoint by construction: lone-plus-join needs a losing side of
 * nothing but `cont` and `text`, this one needs at least one token
 * that is neither. Its own test is the stronger claim - that the
 * ONLY thing that changed is the disappearance of continuations, so
 * removing them from the losing side leaves exactly the winning side.
 * A signature where the surrounding structure also moved fails that
 * equality and falls through to UNCLASSIFIED, where the generator
 * refuses to write it and asks for a name.
 *
 * prose-reads-as-marker is the same kind of construction, and its
 * position in this sequence carries no weight either: it allows the
 * losing side only `text` or nothing, where the two continuation
 * families need a `cont` there and admonition-colon-run needs an
 * `admon:`, and it needs a marker on the winning side, where
 * tail-reading-flip needs `text`. No signature can reach it and
 * another arm both.
 * @param signature - the reading diff
 * @returns the family key, or undefined for an unclassified signature
 */
export function readingFamily(signature: string): string | undefined {
  const { before, after } = sidesOf(signature);
  if (isLonePlusJoin(before, after)) {
    return "lone-plus-join";
  }
  if (isContinuationDropped(before, after)) {
    return "continuation-dropped";
  }
  if (isAdmonitionColonRun(before, after)) {
    return "admonition-colon-run";
  }
  if (isProseReadAsMarker(before, after)) {
    return "prose-reads-as-marker";
  }
  if (isTailReadingFlip(before, after)) {
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
  if (left.pass === right.pass) {
    return 0;
  }
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
    if (row === undefined) {
      throw new Error(fault ?? `${file}: malformed`);
    }
    return row;
  });
}
