/**
 * Format a document list inside ANOTHER checkout.
 *
 * The differential compares three trees, and only one of them is the
 * one running. The other two format through this: a small script
 * written into the target checkout and run there, so each tree's
 * output is produced by its own parser, printer and Prettier.
 *
 * The child FORMATS ONLY. It never renders and never compares,
 * because the oracle's HTML is normalized before comparison and the
 * normalizer is part of the measurement - three trees normalizing
 * three ways would report differences that are the harnesses'
 * rather than the formatters'. So bytes cross the process boundary
 * and every render happens on this side, under one normalizer.
 *
 * The child may use only what the target checkout already has, which
 * is `tests/helpers.js` and nothing of this revision's.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CHILD_MAX_BUFFER } from "./checkout.js";

/**
 * One document's two formatting passes, or the throw that stopped
 * them. A formatter that throws has no output to compare, and saying
 * so is different from saying it produced the source unchanged.
 */
export type FormattedPair =
  | {
      /** Both passes ran. */
      readonly kind: "formatted";
      /** `format(source)`. */
      readonly once: string;
      /** `format(format(source))`. */
      readonly twice: string;
    }
  | {
      /** A pass threw. */
      readonly kind: "threw";
      /** What the formatter said, for the report. */
      readonly message: string;
    };

// Run against the target checkout, from a directory of its OWN.
//
// It is deliberately not written into the checkout it measures. The
// reference is a digest-verified export the migration otherwise treats
// as immutable, and a harness that drops two files into its root -
// even briefly, even under a `finally` - is a harness that can leave
// them there, and two concurrent runs would race on the names. So the
// script and its input file live in a fresh temp directory and the
// checkout is named by ARGUMENT.
//
// The import is therefore dynamic and absolute: a static
// `./tests/helpers.js` would resolve beside the script rather than
// inside the tree under measurement. Resolving the URL from the
// checkout root keeps that tree's own `node_modules` - its Prettier,
// its parser, its pinned oracle - which is the entire point of
// running there.
//
// One JSON array, in input order, so the caller can zip the results
// back without matching ids.
const DUMPER = String.raw`
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const [, , root, inputsFile] = process.argv;
const helpers = new URL("tests/helpers.js", pathToFileURL(root + "/"));
const { formatAdoc } = await import(helpers.href);
const documents = JSON.parse(readFileSync(inputsFile, "utf8"));
const out = [];
for (const source of documents) {
  try {
    const once = await formatAdoc(source);
    out.push({ kind: "formatted", once, twice: await formatAdoc(once) });
  } catch (error) {
    out.push({ kind: "threw", message: String(error) });
  }
}
process.stdout.write(JSON.stringify(out));
`;

/**
 * Read back one row of the child's report.
 * @param raw - one parsed array element
 * @returns the pair, or a `threw` row when the child's row is not one
 */
function pairOf(raw: unknown): FormattedPair {
  // `instanceof Object` rather than `!== null`: `unicorn/no-null`
  // bans the literal outside tests, the same spelling shape-diff.ts
  // uses when it reads its own child's rows back.
  if (!(raw instanceof Object)) {
    return unknownRow;
  }
  const { kind, once, twice, message } = fields(raw);
  if (
    kind === "formatted" &&
    typeof once === "string" &&
    typeof twice === "string"
  ) {
    return { kind, once, twice };
  }
  if (kind === "threw" && typeof message === "string") {
    return { kind, message };
  }
  return unknownRow;
}

// What a row that parses but says nothing recognisable becomes. A
// constant rather than three copies of the same object literal.
const unknownRow: FormattedPair = {
  kind: "threw",
  message: "the child returned a row of no known shape",
};

/**
 * One parsed row as a field bag whose values are still unknown.
 *
 * The annotated return type is the point: `Object.entries` hands back
 * `any` values, and reading them straight into a destructure is how
 * an unchecked `any` gets into a typed program.
 * @param raw - one parsed object
 * @returns its fields
 */
function fields(raw: object): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(raw));
}

/**
 * Format every document inside one checkout, twice each.
 * @param root - the checkout to run in, absolute
 * @param documents - the documents to format, in order
 * @returns one result per document, in the same order
 * @throws {Error} when the child could not run, or answered with a
 *   different number of rows than it was asked about - a short answer
 *   silently zipped against the inputs would misattribute every row
 *   after the gap
 */
export function formatInCheckout(
  root: string,
  documents: readonly string[],
): FormattedPair[] {
  const scratch = mkdtempSync(path.join(tmpdir(), "migration-diff-dump-"));
  const script = path.join(scratch, "dump.mjs");
  const inputs = path.join(scratch, "inputs.json");
  writeFileSync(script, DUMPER);
  writeFileSync(inputs, JSON.stringify(documents));
  try {
    // `cwd` is still the checkout: nothing here reads a repo-relative
    // path, but a tree that grows one should find its own files.
    const stdout = execFileSync("bun", [script, root, inputs], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: CHILD_MAX_BUFFER,
    });
    const parsed: unknown = JSON.parse(stdout);
    if (!Array.isArray(parsed) || parsed.length !== documents.length) {
      throw new Error(
        `${root}: asked about ${String(documents.length)} document(s), heard back about ${Array.isArray(parsed) ? String(parsed.length) : "a non-array"}`,
      );
    }
    return parsed.map((raw) => pairOf(raw));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
