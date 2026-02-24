import { describe, test, expect } from "vitest";
import fc from "fast-check";
import Asciidoctor from "@asciidoctor/core";
import { formatAdoc } from "../helpers.js";
import { adocDocument, adocDocumentNoIncludes } from "../fuzz/arbitraries.js";
import { fuzzParameters } from "../fuzz/config.js";

// Single shared instance — Asciidoctor's convert() is stateless
// so one instance is safe across all property runs. The null
// logger suppresses warnings/errors on stderr from random input.
const asciidoctor = Asciidoctor();
const nullLogger = asciidoctor.NullLogger.create();

/**
 * Converts AsciiDoc input to HTML via Asciidoctor in safe mode
 * with logging suppressed.
 *
 * Asciidoctor.convert() returns string when not writing to a
 * file, but the type signature is `string | Document`. This
 * helper avoids unsafe `as string` casts.
 * @param input - AsciiDoc source text
 * @returns HTML string produced by Asciidoctor
 */
function convertToHtml(input: string): string {
  const result = asciidoctor.convert(input, {
    safe: "safe",
    logger: nullLogger,
  });
  if (typeof result !== "string") {
    throw new TypeError("expected convert() to return a string");
  }
  return result;
}

/**
 * Normalizes HTML for comparison by collapsing newlines to spaces
 * outside of `<pre>` blocks. Asciidoctor preserves source newlines
 * in paragraph text (`<p>word1\nword2</p>`), but the formatter
 * reflows lines — this whitespace difference is visually identical
 * and not a semantic change.
 * @param html - HTML string from Asciidoctor
 * @returns HTML with text-node newlines replaced by spaces
 */
function normalizeHtml(html: string): string {
  // Split around <pre>...</pre> blocks, normalize newlines only
  // in the non-pre segments. Asciidoctor never nests <pre> tags.
  const preBlocks: string[] = [];
  const withPlaceholders = html.replaceAll(
    /<pre[^>]*>[\s\S]*?<\/pre>/gv,
    (match) => {
      preBlocks.push(match);
      return `\0PRE${String(preBlocks.length - 1)}\0`;
    },
  );
  return withPlaceholders
    .replaceAll("\n", " ")
    .replaceAll(
      /\0PRE(?<index>\d+)\0/gv,
      (_, _1, _2, groups: { index: string }) => preBlocks[Number(groups.index)],
    );
}

describe("formatter fuzz", () => {
  // Property-based fuzz test for the formatter. Verifies that
  // formatting is idempotent: format(format(x)) === format(x).
  // Uses the AsciiDoc line-soup generator (tier 2) because
  // purely random strings rarely exercise the printer. See
  // docs/plans/2026-02-22-parser-fuzzing-design.md for design.
  // TODO: When removing test.fails, also review numRuns — 10k iterations
  // means 20k format calls (~40s), which is close to the vitest timeout.
  // Consider reducing to 1_000 for CI and using the FUZZ env var for
  // longer continuous runs.
  test.fails("formatting is idempotent on AsciiDoc line soup", async () => {
    await fc.assert(
      fc.asyncProperty(adocDocument, async (input) => {
        const first = await formatAdoc(input);
        const second = await formatAdoc(first);
        expect(second).toBe(first);
      }),
      fuzzParameters({ numRuns: 10_000 }),
    );
  });

  // Semantic preservation: the HTML that Asciidoctor produces
  // from the original input must be identical to the HTML it
  // produces from the formatted output. Any difference means
  // the formatter changed the document's meaning. Uses the
  // no-includes arbitrary because include directives can't be
  // resolved in synthetic input (see arbitraries.ts).
  // TODO: When removing test.fails, review numRuns for CI timing.
  test.fails("formatting preserves Asciidoctor HTML output", async () => {
    await fc.assert(
      fc.asyncProperty(adocDocumentNoIncludes, async (input) => {
        const htmlBefore = normalizeHtml(convertToHtml(input));
        const formatted = await formatAdoc(input);
        const htmlAfter = normalizeHtml(convertToHtml(formatted));
        expect(htmlAfter).toBe(htmlBefore);
      }),
      fuzzParameters({ numRuns: 100 }),
    );
  });
});
