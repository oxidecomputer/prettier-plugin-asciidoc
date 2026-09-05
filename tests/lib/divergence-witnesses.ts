/**
 * The DIVERGENCE WITNESSES: documents that once told two readers
 * apart, carried forward as fixtures.
 *
 * They come from the sealed line-reading revision 24240b2e - its
 * `cutover-allowlist.json` (the families' witnesses and the named
 * documents) and its depth-5 known-failure list. That revision is a
 * digest-verified export outside this repository and will not be
 * there forever; the documents are the part worth keeping, so they
 * are checked in here where the suite can reach them.
 *
 * WHAT A WITNESS ASSERTS TODAY: nothing about how this tree reads it.
 * Every claim of that kind belongs to the task that makes it, as a
 * fail-then-pass fixture of its own. What this file pins is that the
 * DOCUMENTS survive - so a later task cannot quietly lose the input
 * that would have caught it - and what each one was a witness FOR.
 *
 * A corpus witness carries no source. Its id resolves through
 * `vendor/asciidoctor-corpus`, and re-committing those bytes would be
 * a second copy of a document this repository already has, free to
 * disagree with the first.
 */
import { readFileSync } from "node:fs";
import { loadCorpus } from "../conformance/loader.js";

/** Repo-relative path of the checked-in witness file. */
export const WITNESS_PATH = "tests/format/divergence-witnesses.json";

/**
 * Where the two readers differed on a witness: in the bytes they
 * printed, in the reading they took, or in both.
 */
type WitnessScope = "bytes" | "readings" | "both";

/** The scopes a row may name, for validation. */
const SCOPES = new Set<string>(["bytes", "readings", "both"]);

/**
 * A witness whose bytes live in this file: either hand-authored for
 * the divergence it shows, or spelled by the list-shape sweep's
 * product.
 */
interface WitnessDocument {
  /** Where the document came from. */
  readonly origin: "authored" | "generated";
  /** The witness's name, as the sealed revision recorded it. */
  readonly id: string;
  /** Where the two readers differed. */
  readonly scope: WitnessScope;
  /** The family the sealed revision filed this divergence under. */
  readonly family: string;
  /** The document, verbatim. */
  readonly source: string;
}

/**
 * A witness that is a corpus case, named by id rather than copied.
 * Its bytes come from `vendor/asciidoctor-corpus` at load time.
 */
interface WitnessCorpusCase {
  /** Where the document came from. */
  readonly origin: "corpus";
  /** `corpus/<group>/<case id>`, resolvable through `loadCorpus`. */
  readonly id: string;
  /** Where the two readers differed. */
  readonly scope: WitnessScope;
  /** The family the sealed revision filed this divergence under. */
  readonly family: string;
}

/**
 * One witness. The union is what keeps "a corpus row has no source"
 * unrepresentable rather than merely untrue.
 */
type Witness = WitnessDocument | WitnessCorpusCase;

/**
 * One shape the sealed revision still failed at depth 5, with the
 * mechanism family it failed under.
 *
 * The SET is the claim, not any single row. A shape recorded here
 * that a later tree also fails is a shape that was already failing
 * before the work started; a shape OUTSIDE it that fails is a new
 * mechanism somebody has to name. Keeping the set is what makes that
 * distinction available at all - without it, both look alike.
 */
interface DepthFiveFailure {
  /** The sweep document, verbatim. */
  readonly document: string;
  /** The mechanism, as the sealed revision's allowlist grouped it. */
  readonly family: string;
}

/** The whole file: the witnesses and the depth-5 failing set. */
export interface WitnessFile {
  /** Every witness, ordered by id. */
  readonly witnesses: readonly Witness[];
  /** The sealed revision's depth-5 failing set, ordered by document. */
  readonly depthFiveKnownFailures: readonly DepthFiveFailure[];
}

/**
 * Validate one witness row.
 *
 * Strict, for the reason `tests/lib/reading-ledger.ts` gives about
 * its own rows: a malformed row that is merely skipped takes the
 * file's length down with it, and a shorter file reads as progress.
 * @param raw - one parsed array element
 * @param at - where it sits, for the message
 * @returns the witness
 * @throws {Error} when the row is not a witness
 */
function witnessOf(raw: unknown, at: string): Witness {
  const row = fields(raw, at);
  const { origin, id, scope, family, source } = row;
  if (typeof id !== "string" || typeof family !== "string") {
    throw new TypeError(`${at}: malformed row`);
  }
  const known = scopeOf(scope, at);
  if (origin === "corpus") {
    if (source !== undefined) {
      throw new TypeError(`${at}: a corpus witness carries no source`);
    }
    return { origin, id, scope: known, family };
  }
  if (
    (origin !== "authored" && origin !== "generated") ||
    typeof source !== "string"
  ) {
    throw new TypeError(`${at}: malformed row`);
  }
  return { origin, id, scope: known, family, source };
}

/**
 * One parsed element as a plain field bag.
 *
 * A narrowing helper rather than an assertion at each use site: the
 * validators below read four or five fields each, and asserting the
 * shape once is what keeps them free of casts.
 * @param raw - one parsed array element
 * @param at - where it sits, for the message
 * @returns its fields, each still unknown
 * @throws {TypeError} when it is not an object
 */
function fields(raw: unknown, at: string): Readonly<Record<string, unknown>> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new TypeError(`${at}: not an object`);
  }
  return Object.fromEntries(Object.entries(raw));
}

/**
 * Narrow a parsed scope to the union.
 * @param scope - the parsed value
 * @param at - where it sits, for the message
 * @returns the scope
 * @throws {TypeError} when it names no scope
 */
function scopeOf(scope: unknown, at: string): WitnessScope {
  if (scope === "bytes" || scope === "readings" || scope === "both") {
    return scope;
  }
  throw new TypeError(`${at}: scope must be one of ${[...SCOPES].join(" | ")}`);
}

/**
 * Validate one depth-5 row.
 * @param raw - one parsed array element
 * @param at - where it sits, for the message
 * @returns the failing shape
 * @throws {Error} when the row is not one
 */
function failureOf(raw: unknown, at: string): DepthFiveFailure {
  const { document, family } = fields(raw, at);
  if (typeof document !== "string" || typeof family !== "string") {
    throw new TypeError(`${at}: malformed row`);
  }
  return { document, family };
}

/**
 * Read and validate the witness file.
 * @param file - the path; defaults to the checked-in one, overridable
 *   only so tests can exercise the validation paths
 * @returns the witnesses and the depth-5 failing set
 * @throws {TypeError} when the file is not a witness file
 */
export function loadWitnesses(file: string = WITNESS_PATH): WitnessFile {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  const { witnesses, depthFiveKnownFailures } = fields(parsed, file);
  if (!Array.isArray(witnesses) || !Array.isArray(depthFiveKnownFailures)) {
    throw new TypeError(
      `${file}: expected "witnesses" and "depthFiveKnownFailures" arrays`,
    );
  }
  return {
    witnesses: witnesses.map((raw, index) =>
      witnessOf(raw, `${file}[${String(index)}]`),
    ),
    depthFiveKnownFailures: depthFiveKnownFailures.map((raw, index) =>
      failureOf(raw, `${file} depthFive[${String(index)}]`),
    ),
  };
}

/**
 * Every witness document's TEXT, corpus rows resolved through the
 * loaded corpus.
 *
 * A corpus id that no longer resolves throws rather than being
 * skipped: a witness that quietly stopped being part of the
 * population is exactly the loss this file exists to prevent.
 * @returns the document texts, in witness order
 * @throws {Error} when a corpus witness names a case the corpus lacks
 */
export function witnessDocuments(): string[] {
  const cases = new Map<string, string>();
  for (const group of loadCorpus()) {
    for (const one of group.cases) {
      cases.set(`corpus/${group.name}/${one.id}`, one.input);
    }
  }
  return loadWitnesses().witnesses.map((witness) => {
    if (witness.origin !== "corpus") {
      return witness.source;
    }
    const found = cases.get(witness.id);
    if (found === undefined) {
      throw new Error(
        `${WITNESS_PATH}: corpus witness ${JSON.stringify(witness.id)} resolves to no case`,
      );
    }
    return found;
  });
}
