#!/usr/bin/env bun
/**
 * The shape-differential harness, consumption mode (1) of the shape
 * registry (spec D7.1): a DETERMINISTIC exhaustive product over
 * selected registry sub-grids, formatted under a base revision and
 * under this checkout, with per-diff proofs. No randomness anywhere.
 *
 *   bun scripts/shape-diff.ts --base 14ea1199 --task task-2b
 *   bun scripts/shape-diff.ts --base 14ea1199 --task task-1 --noise
 *   bun scripts/shape-diff.ts --base 14ea1199 --task task-4 --grid heading-adjacency
 *   bun scripts/shape-diff.ts --base 14ea1199 --task task-2 --grid list-run
 *
 * Per differing shape: render(input) vs render(headOut) (fidelity),
 * render(baseOut) vs render(headOut) (neutrality, REPORTED — a
 * corruption-fix family is expected to fail it), head idempotence,
 * and a REQUIRED family annotation from the registry's closed enum —
 * a differing shape with no family FAILS the run. Render-BLIND rows
 * (the registry's two stated exceptions: comment blocks, whose render
 * equality is vacuous — the base's broken output also render-equals
 * the input — and the setext-pinned P16/P18 spellings, where byte
 * equality is the whole pin) omit their render fields; a differing
 * comment-block family row gates on idempotence alone, its byte/AST
 * proof living in the named fixtures and invariant (xii). The report
 * is JSONL (one row per shape) plus a
 * summary; the realized grid size prints with every run so a shrink
 * is visible. The base is materialized per G1's read-only exception
 * into a fresh, per-task-NAMED directory every run.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { formatAdoc, renderedHtml } from "../tests/helpers.js";
import { listRunGrid } from "./shape-registry-list-run.js";
import {
  headingAdjacencyGrid,
  standingGrid,
  type Shape,
} from "./shape-registry.js";

const ARGUMENT_START = 2;
const FAILURE = 1;
const MAX_BUFFER = 268_435_456;

/** One report row (spec D7.1's exact keys). */
interface ReportRow {
  /** `kind/container/perturbation`. */
  id: string;
  /** The whole input document. */
  input: string;
  /** The base revision's formatted output. */
  baseOut: string;
  /** This checkout's formatted output. */
  headOut: string;
  /** Whether the two agree byte for byte. */
  byteEqual: boolean;
  /** The family explaining a difference, when the row differs. */
  family?: string;
  /** render(headOut) === render(input) — the corruption-fix proof. */
  headRenderEqualsInput?: boolean;
  /** render(headOut) === render(baseOut) — reported, not gated. */
  renderNeutral?: boolean;
  /** format(headOut) === headOut. */
  headIdempotent?: boolean;
  /**
   * Why a per-diff proof could not be run — a throw from the
   * formatter or the oracle. Recorded rather than propagated so one
   * bad row cannot destroy the whole report (review m1); a row
   * carrying this ALWAYS fails the run.
   */
  proofError?: string;
}

/**
 * Validate `--grid`'s argument. Split out of {@link parseArguments} to
 * stay under the complexity ceiling, the same way parity-ledger.ts
 * splits `--limit`'s parse out of its own argument loop.
 * @param raw - the word after `--grid`, or undefined at the end
 * @returns the grid name
 * @throws {Error} when the word names no grid
 */
function parseGrid(
  raw: string | undefined,
): "standing" | "heading-adjacency" | "list-run" {
  if (raw !== "standing" && raw !== "heading-adjacency" && raw !== "list-run") {
    throw new Error(`shape-diff: unknown grid ${String(raw)}`);
  }
  return raw;
}

/**
 * Parse the command line.
 * @param argv - the arguments after the script name
 * @returns the base revision, the task name, the grid, the noise flag
 * @throws {Error} when an argument is unrecognised or required ones
 *   are missing
 */
function parseArguments(argv: readonly string[]): {
  base: string;
  task: string;
  grid: "standing" | "heading-adjacency" | "list-run";
  noise: boolean;
} {
  let base: string | undefined = undefined;
  let task: string | undefined = undefined;
  let grid: "standing" | "heading-adjacency" | "list-run" = "standing";
  let noise = false;
  const rest = [...argv];
  while (rest.length > 0) {
    const argument = rest.shift() ?? "";
    if (argument === "--base") {
      base = rest.shift();
      continue;
    }
    if (argument === "--task") {
      task = rest.shift();
      continue;
    }
    if (argument === "--grid") {
      grid = parseGrid(rest.shift());
      continue;
    }
    if (argument === "--noise") {
      noise = true;
      continue;
    }
    throw new Error(`shape-diff: unrecognised argument ${argument}`);
  }
  if (base === undefined || task === undefined) {
    throw new Error("shape-diff: --base <rev> and --task <name> are required");
  }
  return { base, task, grid, noise };
}

/**
 * Materialize a revision (G1's read-only exception) and install its
 * dependencies — a fresh, per-task-NAMED directory every run, never a
 * shared "base" dir.
 * @param revision - anything `git archive` accepts
 * @param task - the task name, for the directory prefix
 * @returns the temp directory holding the installed checkout
 */
function materialize(revision: string, task: string): string {
  const directory = mkdtempSync(
    path.join(tmpdir(), `shape-diff-${task}-base-`),
  );
  const archive = path.join(directory, "revision.tar");
  try {
    execFileSync(
      "git",
      ["archive", "--format=tar", "--output", archive, revision],
      { maxBuffer: MAX_BUFFER },
    );
    execFileSync("tar", ["-xf", archive, "-C", directory]);
    rmSync(archive, { force: true });
    execFileSync("bun", ["install", "--frozen-lockfile"], {
      cwd: directory,
      maxBuffer: MAX_BUFFER,
      stdio: ["ignore", "ignore", "inherit"],
    });
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  return directory;
}

// The dumper written into the BASE checkout: it may only use what the
// base already has (tests/helpers.js). One JSON line per shape.
const DUMPER = String.raw`
import { readFileSync } from "node:fs";
import { formatAdoc } from "./tests/helpers.js";
const shapes = JSON.parse(readFileSync(process.argv[2], "utf8"));
for (const shape of shapes) {
  let out;
  try {
    out = await formatAdoc(shape.input);
  } catch (error) {
    out = "<<THREW>> " + String(error);
  }
  process.stdout.write(JSON.stringify({ id: shape.id, out }) + "\n");
}
`;

/**
 * Format every shape inside one checkout, via the dumper.
 * @param root - the checkout to run in
 * @param shapes - the shapes to format
 * @returns formatted output by shape id
 */
function dumpBase(root: string, shapes: readonly Shape[]): Map<string, string> {
  const script = path.join(root, "shape-dump.mjs");
  const inputs = path.join(root, "shape-inputs.json");
  writeFileSync(script, DUMPER);
  writeFileSync(
    inputs,
    JSON.stringify(shapes.map(({ id, input }) => ({ id, input }))),
  );
  try {
    const stdout = execFileSync("bun", [script, inputs], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
    });
    const rows = new Map<string, string>();
    for (const line of stdout.split("\n")) {
      if (line === "") continue;
      const parsed: unknown = JSON.parse(line);
      // `instanceof Object` rather than `!== null`: `unicorn/no-null`
      // bans the literal outside tests (same spelling as parity.ts's
      // isRecordLike).
      if (
        parsed instanceof Object &&
        "id" in parsed &&
        "out" in parsed &&
        typeof parsed.id === "string" &&
        typeof parsed.out === "string"
      ) {
        rows.set(parsed.id, parsed.out);
      }
    }
    return rows;
  } finally {
    rmSync(script, { force: true });
    rmSync(inputs, { force: true });
  }
}

/**
 * Build one report row, running the per-diff proofs only when the
 * bytes differ (the oracle is invoked only on differing rows).
 * @param shape - the generated shape
 * @param baseOut - the base's formatted output
 * @param headOut - this checkout's formatted output
 * @returns the row
 */
async function reportRow(
  shape: Shape,
  baseOut: string,
  headOut: string,
): Promise<ReportRow> {
  const byteEqual = baseOut === headOut;
  const row: ReportRow = {
    id: shape.id,
    input: shape.input,
    baseOut,
    headOut,
    byteEqual,
  };
  if (byteEqual) return row;
  if (shape.family !== undefined) row.family = shape.family;
  try {
    row.headIdempotent = (await formatAdoc(headOut)) === headOut;
  } catch (error) {
    row.proofError = `the idempotence proof threw: ${String(error)}`;
    return row;
  }
  if (shape.renderBlind) return row;
  try {
    const inputHtml = renderedHtml(shape.input);
    const headHtml = renderedHtml(headOut);
    row.headRenderEqualsInput = headHtml === inputHtml;
    row.renderNeutral = headHtml === renderedHtml(baseOut);
  } catch (error) {
    row.proofError = `a render proof threw: ${String(error)}`;
  }
  return row;
}

/**
 * One differing row's own gate failure, if any: a proof that threw, no
 * family, a failed idempotence proof, or a failed fidelity proof on a
 * render-checked family row. Render NEUTRALITY is reported, never
 * gated — β's one family is a corruption fix and is expected to change
 * the render relative to the broken base.
 * @param row - a differing report row
 * @returns the failure message, or undefined
 */
function rowFailure(row: ReportRow): string | undefined {
  if (row.proofError !== undefined) {
    return `row ${row.id}: ${row.proofError}`;
  }
  if (row.family === undefined) {
    return `unexplained diff: ${row.id} differs and no family covers its coordinates`;
  }
  if (row.headIdempotent === false) {
    return `family row ${row.id}: head output is not idempotent`;
  }
  if (row.headRenderEqualsInput === false) {
    return `family row ${row.id}: head output does not render-equal the ORIGINAL input (the corruption-fix proof, spec D7.6)`;
  }
  return undefined;
}

/**
 * The ids a dump failed to produce a row for.
 *
 * A dump that emitted NOTHING must never read as agreement (review
 * M1): both `Map.get` calls return undefined, the `!==` filter comes
 * back empty, and the noise proof — which the plan makes G4(h)'s
 * invalidation criterion — passes having measured nothing. The
 * criterion has to be unsatisfiable by an empty measurement or it is
 * a rubber stamp.
 * @param dumped - the dump, by shape id
 * @param shapes - the grid the dump was asked for
 * @returns the missing ids, in grid order
 */
function missingIds(
  dumped: ReadonlyMap<string, string>,
  shapes: readonly Shape[],
): string[] {
  return shapes.flatMap((shape) => (dumped.has(shape.id) ? [] : [shape.id]));
}

/**
 * Say that a dump came back short, and fail the run.
 * @param dumped - the dump, by shape id
 * @param shapes - the grid the dump was asked for
 * @param missing - the ids it failed to produce
 */
function reportShortDump(
  dumped: ReadonlyMap<string, string>,
  shapes: readonly Shape[],
  missing: readonly string[],
): void {
  process.stdout.write(
    `shape-diff: the base dump produced ${String(dumped.size)} of ${String(shapes.length)} rows — ${String(missing.length)} missing, first ${missing[0]}: the run measured nothing for those shapes and CANNOT stand (review M1)\n`,
  );
  process.exitCode = FAILURE;
}

/**
 * The base-vs-base noise proof: the same checkout dumped twice must
 * agree on every row, or the harness itself is noisy (Task 1's proof).
 * Both dumps must be COMPLETE first — see {@link missingIds}.
 * @param baseRoot - the materialized base checkout
 * @param shapes - the grid
 */
function reportNoise(baseRoot: string, shapes: readonly Shape[]): void {
  const first = dumpBase(baseRoot, shapes);
  const shortFirst = missingIds(first, shapes);
  if (shortFirst.length > 0) {
    reportShortDump(first, shapes, shortFirst);
    return;
  }
  const again = dumpBase(baseRoot, shapes);
  const shortAgain = missingIds(again, shapes);
  if (shortAgain.length > 0) {
    reportShortDump(again, shapes, shortAgain);
    return;
  }
  const noisy = shapes.filter(
    (shape) => first.get(shape.id) !== again.get(shape.id),
  );
  process.stdout.write(
    `shape-diff: base-vs-base differing rows: ${String(noisy.length)}\n`,
  );
  if (noisy.length > 0) process.exitCode = FAILURE;
}

/**
 * Write the JSONL report, print the summary, and set the exit code.
 * @param rows - one row per shape
 * @param task - the task name, for the report's file name
 */
function reportRows(rows: readonly ReportRow[], task: string): void {
  const report = path.join(
    tmpdir(),
    `shape-diff-${task}-${String(Date.now())}.jsonl`,
  );
  writeFileSync(
    report,
    `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
  );
  const differing = rows.filter((row) => !row.byteEqual);
  const failures = differing.flatMap((row) => {
    const failure = rowFailure(row);
    return failure === undefined ? [] : [failure];
  });
  const byFamily = new Map<string, number>();
  for (const row of differing) {
    const family = row.family ?? "<unexplained>";
    byFamily.set(family, (byFamily.get(family) ?? 0) + 1);
  }
  process.stdout.write(`shape-diff: report ${report}\n`);
  process.stdout.write(
    `shape-diff: ${String(differing.length)} differing of ${String(rows.length)}\n`,
  );
  for (const [family, count] of byFamily) {
    process.stdout.write(`  ${family}: ${String(count)}\n`);
  }
  for (const failure of failures) process.stdout.write(`${failure}\n`);
  const unexplained = differing.filter((row) => row.family === undefined);
  process.stdout.write(
    `shape-diff: unexplained-diff count: ${String(unexplained.length)}\n`,
  );
  if (failures.length > 0) process.exitCode = FAILURE;
}

/**
 * Run the harness and set the exit code.
 * @param argv - the arguments after the script name
 */
async function main(argv: readonly string[]): Promise<void> {
  const { base, task, grid, noise } = parseArguments(argv);
  const shapes =
    grid === "standing"
      ? standingGrid()
      : grid === "heading-adjacency"
        ? headingAdjacencyGrid()
        : listRunGrid();
  process.stdout.write(
    `shape-diff: ${String(shapes.length)} shapes in the ${grid} grid (task ${task})\n`,
  );
  const baseRoot = materialize(base, task);
  try {
    if (noise) {
      reportNoise(baseRoot, shapes);
      return;
    }
    const baseOut = dumpBase(baseRoot, shapes);
    // Defense in depth: `<<MISSING>>` below already turns an absent
    // base row into a diff, so the primary run cannot pass on an
    // empty measurement — but it would report it as 2,810 unexplained
    // diffs rather than as what it is. Name it, and keep going so the
    // JSONL is still written.
    const missing = missingIds(baseOut, shapes);
    if (missing.length > 0) reportShortDump(baseOut, shapes, missing);
    const rows: ReportRow[] = [];
    for (const shape of shapes) {
      const fromBase = baseOut.get(shape.id) ?? "<<MISSING>>";
      // Sequential on purpose: thousands of concurrent Prettier runs
      // would exhaust memory, and the whole grid is seconds serial —
      // same stance as scripts/conformance-triage.ts.
      // eslint-disable-next-line no-await-in-loop -- sequential on purpose
      const headOut = await formatAdoc(shape.input).catch(
        (error: unknown) => `<<THREW>> ${String(error)}`,
      );
      // eslint-disable-next-line no-await-in-loop -- sequential on purpose
      rows.push(await reportRow(shape, fromBase, headOut));
    }
    reportRows(rows, task);
  } finally {
    rmSync(baseRoot, { recursive: true, force: true });
  }
}

if (import.meta.main) await main(process.argv.slice(ARGUMENT_START));
