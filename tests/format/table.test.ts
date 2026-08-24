import { describe, expect, test } from "vitest";
import { formatAdoc, renderedHtml } from "../helpers.js";

/**
 * Passthrough contract: line-for-line with each line's
 * rstripped bytes exact, render-equal (the oracle's reader rstrips
 * every line before parsing — prepare_source_string), idempotent.
 * @param input - the document
 * @param expected - the exact formatted bytes
 */
async function expectTableFormat(
  input: string,
  expected: string,
): Promise<void> {
  const output = await formatAdoc(input);
  expect(output).toBe(expected);
  expect(await renderedHtml(output)).toBe(await renderedHtml(input));
  expect(await formatAdoc(output)).toBe(output);
}

describe("tables pass through line-for-line (issue #10 interim fix)", () => {
  test("the #10 corruption shape survives", async () => {
    const input = "|===\n|a |b\n\n|c |d\n|===\n";
    await expectTableFormat(input, input);
  });

  test.each([
    [",===\na,b\n,===\n"],
    [":===\na:b\n:===\n"],
    ["!===\n!a\n!===\n"],
  ])("%j passes through", async (input) => {
    await expectTableFormat(input, input);
  });

  test("blank lines inside a table are preserved", async () => {
    const input = "|===\n|a\n\n\n|b\n|===\n";
    await expectTableFormat(input, input);
  });

  test("|==== inside an open |=== table is content, to EOF", async () => {
    const input = "|===\n|a\n|====\n\nafter\n";
    await expectTableFormat(input, input);
  });

  test("an unterminated table runs to EOF", async () => {
    const input = "|===\n|a |b\n";
    await expectTableFormat(input, input);
  });

  test("a table attached inside a list item via + survives", async () => {
    const input = "* item\n+\n|===\n|a\n|===\n";
    await expectTableFormat(input, input);
  });

  test("a paragraph before a table stays a paragraph", async () => {
    // The blank line is the printer's STANDING block separation, not
    // anything table-specific: `para\n----\ncode\n----` and
    // `para\n====\nex\n====` normalize the same way at baseline. What
    // this row pins is that the paragraph does not swallow the table
    // (the #10 corruption) — the delimiter interrupts it.
    await expectTableFormat(
      "para\n|===\n|a\n|===\n",
      "para\n\n|===\n|a\n|===\n",
    );
  });

  test("trailing whitespace on an interior line and on the closing line formats to the rstripped spelling", async () => {
    await expectTableFormat(
      "|===\n|a \n|=== \nafter\n",
      "|===\n|a\n|===\n\nafter\n",
    );
  });

  test("held metadata stacks above the table", async () => {
    const input = '[cols="1,1"]\n.Title\n|===\n|a\n|===\n';
    await expectTableFormat(input, input);
  });

  test("reflow never forms a table delimiter at line start", async () => {
    // A wrappable word shaped like a table delimiter must not land at
    // column 0 (the registry union guard, src/print/reflow.ts).
    const input = `${"word ".repeat(15)}|=== tail\n`;
    const output = await formatAdoc(input);
    expect(await renderedHtml(output)).toBe(await renderedHtml(input));
    expect(await formatAdoc(output)).toBe(output);
    expect(
      // `\|` is not a useless escape: under `v` a bare `|` inside a
      // character class is reserved syntax (a SyntaxError).
      output.split("\n").some((line) => /^[\|,:!]={3,}[ \t]*$/v.test(line)),
    ).toBe(false);
  });
});
