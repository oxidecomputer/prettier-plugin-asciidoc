/**
 * Driving `scripts/lib/asciidoctor-reference.rb` from TypeScript.
 *
 * The reference is a Ruby program and every harness in this
 * repository is not, so every measurement against it crosses a
 * process boundary. It crosses it ONCE per run, with the whole case
 * list in a file: the gem takes a fifth of a second to render the
 * entire vendored corpus in one process and about that long to boot,
 * so a per-case process would be three orders of magnitude slower and
 * would measure the boot, not the render.
 *
 * The reference is a developer prerequisite, not a CI dependency. A
 * machine without it cannot run these harnesses at all, which is why
 * every entry point here reports its absence as "could not run"
 * rather than as a failure: `undefined` from {@link referenceVersion}
 * is the caller's cue to exit 2.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** The Ruby driver, relative to the repository root. */
const DRIVER = "scripts/lib/asciidoctor-reference.rb";

/** How much diagnostic output from the driver is read back. */
const DIAGNOSTIC_BUFFER = 1_048_576;

/** One document for the reference to render. */
export interface ReferenceCase {
  /** The case's id, echoed back on its result. */
  readonly id: string;
  /** The whole document. */
  readonly src: string;
  /** Attributes set from outside the document; usually empty. */
  readonly attrs: Readonly<Record<string, string>>;
}

/** What the reference produced, keyed by case id. */
export type ReferenceRenders = ReadonlyMap<string, string>;

/**
 * Runs one mode of the driver over a temporary input file.
 * @param mode - the driver mode: `render`, `lens` or `fold`
 * @param input - what to write as the driver's input JSON
 * @returns the driver's output text, or undefined when it could not
 *   run (the gem is not installed)
 */
function drive(mode: string, input: unknown): string | undefined {
  const directory = mkdtempSync(path.join(tmpdir(), "asciidoctor-reference-"));
  try {
    const inputPath = path.join(directory, "input.json");
    const outputPath = path.join(directory, "output");
    writeFileSync(inputPath, JSON.stringify(input));
    const run = spawnSync("ruby", [DRIVER, mode, inputPath, outputPath], {
      encoding: "utf8",
      // Only diagnostics come back through the pipe: the renders
      // themselves are written to a file, because a population is
      // tens of thousands of documents and a pipe that large is a
      // second failure mode nobody needs.
      maxBuffer: DIAGNOSTIC_BUFFER,
    });
    if (run.status !== 0) {
      return undefined;
    }
    return readFileSync(outputPath, "utf8");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/**
 * The installed reference's version.
 *
 * Every ledger names the version it was measured against, because a
 * gem bump moves rows and a ledger compared against a different
 * program measures nothing.
 * @returns the version string, or undefined when the gem is missing
 */
export function referenceVersion(): string | undefined {
  const run = spawnSync("ruby", [DRIVER, "version"], { encoding: "utf8" });
  if (run.status !== 0) {
    return undefined;
  }
  return run.stdout.trim();
}

/**
 * Renders every case through the reference.
 * @param cases - the documents to render, with their ids
 * @param mode - `lens` for the conformance fold, `render` for the raw
 *   HTML two converters have to be compared through their own way
 * @returns the renders keyed by case id, or undefined when the gem
 *   is missing or the driver failed
 */
export function referenceRenders(
  cases: readonly ReferenceCase[],
  mode: "lens" | "render",
): ReferenceRenders | undefined {
  const output = drive(mode, cases);
  if (output === undefined) {
    return undefined;
  }
  const renders = new Map<string, string>();
  for (const line of output.split("\n")) {
    if (line === "") {
      continue;
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the driver in this directory writes these two shapes and nothing else
    const record = JSON.parse(line) as {
      id: string;
      html?: string;
      lens?: string;
    };
    renders.set(record.id, record.html ?? record.lens ?? "");
  }
  return renders;
}

/**
 * Applies the reference's PORT of the conformance fold to raw HTML.
 *
 * The port exists so the reference's HTML can be read through the
 * same lens the oracle's is read through. It is checked against the
 * TypeScript fold over committed samples rather than trusted; this is
 * the entry point that check calls.
 * @param samples - raw HTML strings
 * @returns the folded strings in the same order, or undefined when
 *   the gem is missing
 */
export function referenceFold(
  samples: readonly string[],
): string[] | undefined {
  const output = drive("fold", samples);
  if (output === undefined) {
    return undefined;
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the driver's fold mode writes an array of strings
  return JSON.parse(output) as string[];
}
