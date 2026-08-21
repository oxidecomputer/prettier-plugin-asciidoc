import { describe, test, expect } from "vitest";
import fc from "fast-check";
import { formatAdoc, renderedHtml } from "../helpers.js";
import { adocDocument, adocDocumentNoIncludes } from "../fuzz/arbitraries.js";
import { fuzzParameters } from "../fuzz/config.js";

// HTML conversion and normalization live in ../helpers.ts
// (renderedHtml) so other semantic-fidelity tests share them.

describe("formatter fuzz", () => {
  // Property-based fuzz test for the formatter. Verifies that
  // formatting is idempotent: format(format(x)) === format(x).
  // Uses the AsciiDoc line-soup generator (tier 2) because
  // purely random strings rarely exercise the printer.
  // The run is SEEDED (see tests/fuzz/config.ts): `test.fails`
  // inverts the result, so an unseeded search that found nothing
  // would fail the suite by accident.
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
  // resolved in synthetic input (see arbitraries.ts). Seeded for the
  // same reason as the idempotency property above.
  // TODO: When removing test.fails, review numRuns for CI timing.
  test.fails("formatting preserves Asciidoctor HTML output", async () => {
    await fc.assert(
      fc.asyncProperty(adocDocumentNoIncludes, async (input) => {
        const htmlBefore = renderedHtml(input);
        const formatted = await formatAdoc(input);
        const htmlAfter = renderedHtml(formatted);
        expect(htmlAfter).toBe(htmlBefore);
      }),
      fuzzParameters({ numRuns: 100 }),
    );
  });
});
