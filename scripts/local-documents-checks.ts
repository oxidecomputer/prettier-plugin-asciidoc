/**
 * The local-documents runner (issue #13): walk a directory of real
 * AsciiDoc documents and say, per document, what the formatter did to
 * it.
 *
 * The corpus this exists for is somebody's own working documents -
 * long, unpublishable, and nothing like the vendored Asciidoctor
 * corpus, whose cases are mostly a handful of lines each. Real
 * documents are where a formatter meets combinations no generated
 * product spells and no test author thought to write down.
 *
 * The checks are issue #7's differential properties, asked of a file
 * on disk instead of a corpus case:
 *
 * - **format** - formatting must not throw;
 * - **reformat** - formatting our own output must not throw either,
 *   because output we cannot re-parse is a crash with an extra step;
 * - **idempotence** - `format(format(d))` must equal `format(d)`;
 * - **render** - Asciidoctor must render `format(d)` exactly the way
 *   it renders `d`.
 *
 * The render comparison is the conformance suite's own
 * (`tests/helpers.ts`): the oracle is `@asciidoctor/core` and the
 * strings must be EQUAL, under that helper's two normalizations - a
 * line break outside `<pre>` folds to a space, and a whitespace run
 * outside `<pre>` and `<code>` folds to one space. Both of those are
 * reflow, which is what a formatter is for; whitespace a reader can
 * see is inside `<pre>` or `<code>`, where the helper touches
 * nothing (issue #32).
 *
 * THE REPORT CARRIES NO DOCUMENT TEXT, and that is a contract rather
 * than an accident: every detail string here is a fixed sentence,
 * except where a THROWN MESSAGE is interpolated (`format threw: ...`,
 * `the oracle refused the input: ...`). Nothing redacts those, so a
 * parser or an oracle that ever quoted its input in an error message
 * would put document text into a report. If that day comes, redact
 * here, at the interpolation.
 *
 * {@link verdicts} is pure and is where the failed/unassessed
 * decision lives; everything around it is I/O. What a whole corpus's
 * results MEAN is `local-documents-report.ts`.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { formatAdoc, renderedHtml } from "../tests/helpers.js";

/** The extension a document must carry to be checked at all. */
const DOCUMENT_EXTENSION = ".adoc";

/**
 * One of the four checks a document can fail, in the order they run.
 * A later check is unassessable when an earlier one failed - there is
 * no output to compare - and the result says so rather than counting
 * it as a pass.
 */
export type CheckName = "format" | "reformat" | "idempotence" | "render";

/**
 * One attempt at producing a string: it worked, or it threw. A
 * discriminated union rather than two optionals, so "no value and no
 * error" cannot be spelled at all.
 */
export type Attempt =
  | {
      /** The attempt produced a value. */
      readonly ok: true;
      /** What it produced. */
      readonly value: string;
    }
  | {
      /** The attempt threw. */
      readonly ok: false;
      /** The message it threw, for the detail. */
      readonly error: string;
    };

/**
 * What was attempted for one document. An `undefined` member means
 * the attempt was never MADE, which is a different thing from an
 * attempt that threw: nothing was learned either way, so the verdict
 * says `unassessed` rather than counting a pass.
 */
export interface Attempts {
  /** Formatting the document. */
  readonly format: Attempt;
  /** Formatting the formatter's own output. */
  readonly reformat: Attempt | undefined;
  /** Rendering the document through the oracle. */
  readonly renderInput: Attempt | undefined;
  /** Rendering the formatted output through the oracle. */
  readonly renderOutput: Attempt | undefined;
}

/** How the four checks came out for one document. */
export interface Verdict {
  /** Every check that FAILED, in the order the checks run. */
  readonly failures: readonly CheckName[];
  /** Every check nothing could be said about, in the same order. */
  readonly unassessed: readonly CheckName[];
  /** One clause per failure or skip, joined; empty when clean. */
  readonly detail: string;
}

/** What running the four checks over one document measured. */
export interface CheckResult extends Verdict {
  /** The document's id: its path under the corpus root, posix-spelled. */
  readonly id: string;
  /** How many characters the document holds. */
  readonly size: number;
  /** Wall time spent on this document, milliseconds. */
  readonly elapsed: number;
}

/** One document found on disk. */
export interface FoundDocument {
  /** Its id: the path under the corpus root, posix-spelled. */
  readonly id: string;
  /** Its path on disk, as the walk spelled it. */
  readonly file: string;
}

/**
 * Order two ids by CODE POINT.
 *
 * Not `localeCompare`: that is ICU- and locale-dependent, around
 * punctuation especially, so two machines can order the same corpus
 * differently - and "a stable order so a report is diffable" is the
 * only reason the walk sorts at all.
 * @param left - one id
 * @param right - the other
 * @returns negative, zero or positive, as a comparator wants
 */
function byCodePoint(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * Every `.adoc` file under a directory, recursively, sorted by id.
 *
 * Everything else is ignored rather than reported: a real corpus
 * directory carries images, diagram sources and READMEs, and a walker
 * that complained about them would be unusable on the corpus it was
 * written for.
 *
 * SYMLINKS are skipped, and so are dot-directories. This harness is
 * pointed at arbitrary directories by design, which is where symlink
 * loops (an infinite recursion) and dangling symlinks (an `ENOENT`
 * that discards a run already paid for) live; and pointed at a
 * working copy, a walk that descended `.git` would stat every object
 * in it.
 * @param root - the corpus directory to walk
 * @returns the documents, in a stable order so a report is diffable
 * @throws {Error} when the root is not a readable directory - the
 *   caller turns that into "the harness could not run"
 */
export function findDocuments(root: string): FoundDocument[] {
  return walk(root, "").toSorted((left, right) =>
    byCodePoint(left.id, right.id),
  );
}

/**
 * One level of {@link findDocuments}.
 * @param root - the corpus directory
 * @param prefix - where we are, relative to it, posix-spelled
 * @returns the documents below this level
 */
function walk(root: string, prefix: string): FoundDocument[] {
  const here = prefix === "" ? root : path.join(root, prefix);
  return readdirSync(here, { withFileTypes: true }).flatMap((entry) => {
    const { name } = entry;
    if (entry.isSymbolicLink() || name.startsWith(".")) return [];
    const id = prefix === "" ? name : path.posix.join(prefix, name);
    if (entry.isDirectory()) return walk(root, id);
    if (!entry.isFile() || !name.endsWith(DOCUMENT_EXTENSION)) return [];
    return [{ id, file: path.join(root, id) }];
  });
}

/**
 * Turn what was attempted into what it means.
 *
 * Pure, and exported for exactly that: the crash arms and the two
 * oracle-refusal arms are unreachable from any input anybody has
 * managed to write (a formatter crash needs a formatter bug), so
 * without a seam here they would rest on inspection alone. With it
 * they are literal-value table tests like every other failure path in
 * this harness.
 *
 * The asymmetry worth stating: an oracle that refuses the INPUT
 * leaves nothing to compare against, so `render` is UNASSESSED - that
 * document said nothing about our formatter. An oracle that refuses
 * our OUTPUT having accepted the input is a FAILURE however you read
 * it: the document rendered before we touched it.
 * @param attempts - what was attempted, and what came back
 * @returns the failures, the unassessed checks, and the detail
 */
export function verdicts(attempts: Attempts): Verdict {
  const { format } = attempts;
  if (!format.ok) {
    // Nothing downstream of a crash was learned, whatever else the
    // caller managed to attempt: there is no output to re-format, to
    // settle, or to render.
    return {
      failures: ["format"],
      unassessed: ["reformat", "idempotence", "render"],
      detail: `format threw: ${format.error}`,
    };
  }
  const into: Accumulator = { failures: [], unassessed: [], details: [] };
  settled(attempts.reformat, format.value, into);
  rendered(attempts, into);
  return {
    failures: into.failures,
    unassessed: into.unassessed,
    detail: into.details.join("; "),
  };
}

/** Where the arms of {@link verdicts} accumulate their answer. */
interface Accumulator {
  /** The checks that failed, appended to in check order. */
  readonly failures: CheckName[];
  /** The checks that could not be assessed. */
  readonly unassessed: CheckName[];
  /** The clauses that become the verdict's detail. */
  readonly details: string[];
}

/**
 * The `reformat` and `idempotence` arms.
 * @param reformat - the second pass, or undefined when it was not
 *   attempted
 * @param first - what the first pass produced
 * @param into - where to record the verdict
 */
function settled(
  reformat: Attempt | undefined,
  first: string,
  into: Accumulator,
): void {
  if (reformat === undefined) {
    into.unassessed.push("reformat", "idempotence");
    return;
  }
  if (!reformat.ok) {
    into.failures.push("reformat");
    into.details.push(`reformat threw: ${reformat.error}`);
    into.unassessed.push("idempotence");
    return;
  }
  if (reformat.value === first) return;
  into.failures.push("idempotence");
  into.details.push("the second format pass changed the output");
}

/**
 * The `render` arm.
 * @param attempts - what was attempted, and what came back
 * @param into - where to record the verdict
 */
function rendered(attempts: Attempts, into: Accumulator): void {
  const { renderInput, renderOutput } = attempts;
  if (renderInput === undefined) {
    into.unassessed.push("render");
    return;
  }
  if (!renderInput.ok) {
    into.unassessed.push("render");
    into.details.push(`the oracle refused the input: ${renderInput.error}`);
    return;
  }
  if (renderOutput === undefined) {
    into.unassessed.push("render");
    return;
  }
  if (!renderOutput.ok) {
    into.failures.push("render");
    into.details.push(
      `the oracle refused the formatted output: ${renderOutput.error}`,
    );
    return;
  }
  if (renderOutput.value === renderInput.value) return;
  into.failures.push("render");
  into.details.push("Asciidoctor renders the formatted output differently");
}

/**
 * Run the four checks over one document's source.
 *
 * Takes the source rather than a path so the checks are a function of
 * their input alone: the same call runs over a file, over a fixture,
 * and over a string a test wrote.
 * @param id - what to call this document in the result
 * @param source - the document's text
 * @returns what the four checks measured
 */
export async function checkDocument(
  id: string,
  source: string,
): Promise<CheckResult> {
  const started = performance.now();
  const verdict = verdicts(await attempt(source));
  return {
    id,
    size: source.length,
    elapsed: Math.round(performance.now() - started),
    failures: verdict.failures,
    unassessed: verdict.unassessed,
    detail: verdict.detail,
  };
}

/**
 * Do the I/O the four checks need, stopping as soon as an answer
 * cannot depend on the rest: a crash leaves nothing to re-format or
 * to render, and an oracle that refuses the input leaves nothing to
 * compare a rendering against.
 * @param source - the document's text
 * @returns what was attempted, and what came back
 */
async function attempt(source: string): Promise<Attempts> {
  const format = await tryFormat(source);
  if (!format.ok) {
    return {
      format,
      reformat: undefined,
      renderInput: undefined,
      renderOutput: undefined,
    };
  }
  const reformat = await tryFormat(format.value);
  const renderInput = await tryRender(source);
  return {
    format,
    reformat,
    renderInput,
    renderOutput: renderInput.ok ? await tryRender(format.value) : undefined,
  };
}

/**
 * Format one string, reporting a throw instead of propagating it.
 * @param source - what to format
 * @returns the output, or the message the throw carried
 */
async function tryFormat(source: string): Promise<Attempt> {
  try {
    return { ok: true, value: await formatAdoc(source) };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}

/**
 * Render one string through the oracle, reporting a throw instead of
 * propagating it.
 * @param source - what to render
 * @returns the HTML, or the message the throw carried
 */
async function tryRender(source: string): Promise<Attempt> {
  try {
    return { ok: true, value: await renderedHtml(source) };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}

/**
 * One line for a thrown value, whatever it turned out to be.
 * @param error - what was thrown
 * @returns its message, or its spelling when it is not an Error
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Run the four checks over every document under a corpus root.
 *
 * Sequential on purpose: these are real documents, some of them
 * hundreds of kilobytes, and unbounded concurrency over a whole
 * corpus buys wall time with memory the machine may not have.
 * @param root - the corpus directory to walk
 * @param onResult - called as each document finishes, so a long run
 *   can print progress instead of going quiet for a minute
 * @returns one result per document, in id order
 */
export async function checkCorpus(
  root: string,
  onResult?: (result: CheckResult) => void,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const document of findDocuments(root)) {
    const source = readFileSync(document.file, "utf8");
    // eslint-disable-next-line no-await-in-loop -- sequential on purpose: see the doc comment
    const result = await checkDocument(document.id, source);
    results.push(result);
    onResult?.(result);
  }
  return results;
}
