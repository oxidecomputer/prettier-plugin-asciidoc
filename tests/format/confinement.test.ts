/**
 * Confinement characterization rows: the flavor bit and the
 * metadata flush order, byte-pinned. These are TODAY'S bytes — the
 * Confinement record must reproduce them exactly; a change here means
 * a flavor or flush-order regression, never a row to update.
 */
import { describe, expect, test } from "vitest";
import { formatAdoc, renderedHtml } from "../helpers.js";

/**
 * Assert exact bytes, idempotence, and render equality to the input.
 * @param input - the source document
 * @param expected - the expected formatted bytes
 */
async function expectBytes(input: string, expected: string): Promise<void> {
  const output = await formatAdoc(input);
  expect(output).toBe(expected);
  expect(await formatAdoc(output)).toBe(output);
  expect(await renderedHtml(output)).toBe(await renderedHtml(input));
}

describe("the confinement flavor bit", () => {
  test("a compound interior inside an item is NOT an item interior", async () => {
    // The one shape where openListStyle would matter if a block
    // child ever reported the item's style: inside `====` the
    // paragraph context is "paragraph", where a foreign marker
    // neither interrupts nor keeps its own line — `para . other`
    // reflow into ONE line. An item-flavored context would keep
    // `. other` on its own line instead.
    await expectBytes(
      "* item\n+\n====\npara\n. other\n====\n",
      "* item\n+\n====\npara . other\n====\n",
    );
  });
});

describe("metadata flush order inside interiors", () => {
  test("held metadata inside an interior lands in the INNERMOST container (P19)", async () => {
    // The title lands inside the EXAMPLE (the child reader's own
    // closeAll releases it into the child's root), and the example's
    // synthesized terminator follows it.
    await expectBytes("--\n====\n.Title\n--\n", "--\n====\n.Title\n====\n--\n");
  });
  test("a dangling title before the terminator stays inside (P8)", async () => {
    await expectBytes(
      "====\nfoo\n\n.Title\n====\n",
      "====\nfoo\n\n.Title\n====\n",
    );
  });
});

describe("a trailing + inside a confined interior", () => {
  // The `+` at the inner item's end attaches nothing wherever the
  // item sits: inside an example, inside an open block nested in one,
  // at any marker depth. It is popped (parser.rb l.1580-82) and the
  // byte is written back, because the interior's own terminator
  // follows the item on the very next output line: the `+` pops
  // again there rather than erasing above a blank. That terminator is
  // what the confinement's tail-safety bit reports (`closeOffset` and
  // `tailSafe`, src/parse/lines/reader.ts), and it is the whole of
  // what decides here.
  test.each([
    [
      "a closed example directly in the item",
      "* outer\n+\n====\n* inner\n+\n====\n\npara\n",
    ],
    [
      "a closed open block nested in the example",
      "* outer\n+\n====\n--\n* inner\n+\n--\n====\n\npara\n",
    ],
    ["a deeper inner marker", "* outer\n+\n====\n** inner\n+\n====\n\npara\n"],
  ])("%s keeps the inner item's trailing +", async (_name, source) => {
    await expectBytes(source, source);
  });
});
