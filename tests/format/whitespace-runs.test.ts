/**
 * Issue #32: a whitespace RUN the reader can see.
 *
 * Reflowing prose is what a formatter is for, and two spaces after a
 * full stop mean nothing. Inside a verbatim block, an inline code
 * span or a passthrough they are CONTENT, and collapsing them is
 * corruption.
 *
 * Half of that is true today and half is not, so this file holds both
 * halves by BYTES:
 *
 * - verbatim blocks, indented literal paragraphs, verse blocks,
 *   literal table cells and the `pass:[]` macro keep their runs -
 *   these rows are regression guards;
 * - inline spans and the `+`/`+++` passthroughs do NOT - these rows
 *   pin today's WRONG bytes with issue #32 on them, and the day #32
 *   is fixed they fail and are rewritten to the input.
 *
 * Bytes rather than a render comparison, and that is the point of the
 * file. `tests/helpers.ts`'s `renderedHtml` folds whitespace runs
 * outside `<pre>` and `<code>`, so the shared comparison sees the
 * inline-span half (a code span renders as `<code>`) and CANNOT see
 * the passthrough half: a passthrough renders as bare text with no
 * wrapping element, so the collapse is invisible to every harness
 * that compares renderings. Each group below asserts which of the two
 * it is, so neither the formatter nor the normalizer can move without
 * a row failing.
 */
import { describe, expect, test } from "vitest";
import { formatAdoc, renderedHtml } from "../helpers.js";

/**
 * Byte-identical, render-equal, idempotent - the run survived.
 * @param input - the document
 */
async function expectByteFaithful(input: string): Promise<void> {
  const output = await formatAdoc(input);
  expect(output).toBe(input);
  expect(await renderedHtml(output)).toBe(await renderedHtml(input));
  expect(await formatAdoc(output)).toBe(output);
}

/**
 * Today's bytes, whatever they are, plus idempotence. Used for the
 * rows where today's bytes are WRONG: the expectation is the pin, and
 * changing the formatter has to change this file.
 * @param input - the document
 * @param expected - the bytes the formatter produces today
 */
async function expectBytes(input: string, expected: string): Promise<void> {
  const output = await formatAdoc(input);
  expect(output).toBe(expected);
  expect(await formatAdoc(output)).toBe(output);
}

describe("a run inside a verbatim construct keeps its bytes", () => {
  test.each([
    ["a literal block", "....\na  b\n....\n"],
    ["a listing block", "----\na  b\n----\n"],
    ["a source block", "[source,ruby]\n----\na  b\n----\n"],
    ["an indented literal paragraph", " a  b\n"],
    ["a verse block", "[verse]\n____\na  b\n____\n"],
    ["a literal table cell", "|===\nl|a  b\n|===\n"],
    ["the pass:[] macro", "Text pass:[a  b] more.\n"],
  ])("%s", async (_name, input) => {
    await expectByteFaithful(input);
  });
});

describe("a run inside an inline span is collapsed today (issue #32)", () => {
  // Each row pins the WRONG bytes. When #32 is fixed these rows fail,
  // and the fix is to make each expectation the input.
  test.each([
    [
      "constrained monospace",
      "A sentence with `a  b` in it.\n",
      "A sentence with `a b` in it.\n",
    ],
    [
      // The unconstrained-to-constrained rewrite is a separate,
      // deliberate normalization; what #32 owns here is the run.
      "unconstrained monospace",
      "A sentence with ``a  b`` in it.\n",
      "A sentence with `a b` in it.\n",
    ],
    [
      "monospace around an inline literal",
      "A sentence with `+a  b+` in it.\n",
      "A sentence with `+a b+` in it.\n",
    ],
  ])("%s", async (_name, input, expected) => {
    await expectBytes(input, expected);
  });

  test("the shared render comparison still sees it", async () => {
    // A code span renders as <code>, which `renderedHtml` leaves
    // alone - so this half of #32 is caught by every harness that
    // compares renderings, and these rows are the belt to that brace.
    const input = "A sentence with `a  b` in it.\n";
    expect(await renderedHtml(await formatAdoc(input))).not.toBe(
      await renderedHtml(input),
    );
  });
});

describe("a run inside a passthrough is collapsed today, and only bytes can see it (issue #32)", () => {
  // The masked class. A passthrough renders as bare text inside the
  // paragraph that carries it, so `renderedHtml`'s run fold hides the
  // collapse from the conformance properties, the local-documents
  // harness and every other render comparison. These rows are the
  // ONLY thing holding it.
  //
  // Issue #25's stream makes `+++` passthroughs atomic byte-replayed
  // nodes; when it lands, these expectations become their inputs and
  // the rows below turn into ordinary byte-faithful guards.
  test.each([
    [
      "a triple-plus passthrough",
      "Text +++a  b+++ more.\n",
      "Text +++a b+++ more.\n",
    ],
    ["a single-plus passthrough", "Text +a  b+ more.\n", "Text +a b+ more.\n"],
  ])("%s", async (_name, input, expected) => {
    await expectBytes(input, expected);
  });

  test("the shared render comparison cannot see it", async () => {
    // Asserted, not merely disclosed: if this ever starts failing,
    // either the formatter was fixed or the normalizer changed, and
    // both are things somebody has to notice.
    const input = "Text +++a  b+++ more.\n";
    expect(await renderedHtml(await formatAdoc(input))).toBe(
      await renderedHtml(input),
    );
  });
});

describe("a run in ordinary prose is reflow, not corruption", () => {
  test("it collapses, and that is the intended behavior", async () => {
    expect(await formatAdoc("a  b\n")).toBe("a b\n");
  });
});
