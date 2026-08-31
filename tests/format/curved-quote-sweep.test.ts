import { describe, expect, test } from "vitest";
import { formatAdoc, renderedHtml } from "../helpers.js";
import { CURVED_SHAPES } from "./curved-quote-sweep.js";

/**
 * The rendered HTML with runs of whitespace collapsed, so a reflow line
 * break is not read as a render difference.
 *
 * `renderedHtml` (tests/helpers.ts) is async - Asciidoctor.js 4.x has no
 * synchronous entry point - so every cell awaits both renders.
 * @param source - one AsciiDoc document
 * @returns its rendered HTML, whitespace-normalized
 */
async function rendered(source: string): Promise<string> {
  const html = await renderedHtml(source);
  return html.replaceAll(/\s+/gv, " ").trim();
}

describe("the curved-quote shape matrix (issue #74)", () => {
  test("the matrix is the size this suite was written against", () => {
    expect(CURVED_SHAPES).toHaveLength(61);
  });

  test.each(CURVED_SHAPES.map((shape) => [shape.id, shape.source] as const))(
    "%s",
    async (id, source) => {
      const formatted = await formatAdoc(source);
      expect(await rendered(formatted)).toBe(await rendered(source));
      expect(await formatAdoc(formatted)).toBe(formatted);
    },
  );
});
