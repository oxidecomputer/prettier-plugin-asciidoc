/**
 * Confinement characterization rows (spec D2): the flavor bit and the
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
  expect(renderedHtml(output)).toBe(renderedHtml(input));
}

describe("the confinement flavor bit (spec D2, preservation condition 4)", () => {
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

describe("metadata flush order inside interiors (spec D2, condition 3)", () => {
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

describe("the block child's tailSafe disjunct (spec D2/D3)", () => {
  // `closed || enclosing` at the compound open. The OUTER item's own
  // tail is UNSAFE — a blank line and a paragraph follow it — so an
  // interior that inherited only the enclosing half would report
  // false and the inner item's trailing `+` would be dropped. The
  // `====` CLOSED, so its printed terminator lands on the very next
  // output line and pops the `+` there: the left half of the
  // disjunct is the whole reason these bytes survive. Mutating
  // `extent.close !== undefined || this.tailSafe` (openDelimited) to
  // `this.tailSafe` drops the `+` from every row below, and nothing
  // else in the suite, parity or the standing grid notices.
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
