/**
 * The confined-extent family's byte proofs (issue #44): every
 * fixed spelling is asserted exactly, is IDEMPOTENT, and — proof
 * direction for a CORRUPTION FIX — renders equal to the ORIGINAL
 * INPUT (comparing against the base's output would prove nothing: the
 * base was wrong). EXCEPTION, the taxonomy's third arm: comment
 * blocks render nothing, so render equality is vacuous there
 * (review-measured: the base's BROKEN output also render-equals the
 * input) — those rows prove bytes + idempotence here and content/(xii)
 * at the AST level (tests/parser/confined-extent.test.ts).
 */
import { describe, expect, test } from "vitest";
import { formatAdoc, renderedHtml } from "../helpers.js";

/**
 * Assert the fixed spelling, its idempotence, and render fidelity to
 * the ORIGINAL input.
 * @param input - the corrupting shape
 * @param expected - the fixed bytes
 */
async function expectFixed(input: string, expected: string): Promise<void> {
  const output = await formatAdoc(input);
  expect(output).toBe(expected);
  expect(await formatAdoc(output)).toBe(output);
  expect(await renderedHtml(output)).toBe(await renderedHtml(input));
}

/**
 * The render-vacuous variant (comment blocks): bytes + idempotence.
 * @param input - the corrupting shape
 * @param expected - the fixed bytes
 */
async function expectFixedBytes(
  input: string,
  expected: string,
): Promise<void> {
  const output = await formatAdoc(input);
  expect(output).toBe(expected);
  expect(await formatAdoc(output)).toBe(output);
}

describe("confined-extent: every measured shape is byte-lossless", () => {
  test.each([
    [
      "listing / item",
      "* item\n+\n----\nfoo\n\nafter\n",
      "* item\n+\n----\nfoo\n\nafter\n----\n",
    ],
    [
      "listing / nested item",
      "* a\n** b\n+\n----\nfoo\n\nafter\n",
      "* a\n** b\n+\n----\nfoo\n\nafter\n----\n",
    ],
    [
      "listing / item -> unterminated compound",
      "* item\n+\n====\n----\nfoo\n",
      "* item\n+\n====\n----\nfoo\n----\n====\n",
    ],
    [
      "literal / item",
      "* item\n+\n....\nfoo\n\nafter\n",
      "* item\n+\n....\nfoo\n\nafter\n....\n",
    ],
    [
      "literal / nested item",
      "* a\n** b\n+\n....\nfoo\n\nafter\n",
      "* a\n** b\n+\n....\nfoo\n\nafter\n....\n",
    ],
    [
      "literal / item -> unterminated compound",
      "* item\n+\n====\n....\nfoo\n",
      "* item\n+\n====\n....\nfoo\n....\n====\n",
    ],
    [
      "pass / item",
      "* item\n+\n++++\nfoo\n\nafter\n",
      "* item\n+\n++++\nfoo\n\nafter\n++++\n",
    ],
    [
      "pass / nested item",
      "* a\n** b\n+\n++++\nfoo\n\nafter\n",
      "* a\n** b\n+\n++++\nfoo\n\nafter\n++++\n",
    ],
    [
      "pass / item -> unterminated compound",
      "* item\n+\n====\n++++\nfoo\n",
      "* item\n+\n====\n++++\nfoo\n++++\n====\n",
    ],
    [
      "fence / item (P23)",
      "* item\n+\n```\nfoo\n\nafter\n",
      "* item\n+\n[source]\n----\nfoo\n\nafter\n----\n",
    ],
    [
      "fence / nested item",
      "* a\n** b\n+\n```\nfoo\n\nafter\n",
      "* a\n** b\n+\n[source]\n----\nfoo\n\nafter\n----\n",
    ],
    [
      "fence / item -> unterminated compound",
      "* item\n+\n====\n```\nfoo\n",
      "* item\n+\n====\n[source]\n----\nfoo\n----\n====\n",
    ],
    [
      "table / item (P22: the fixed replay IS the input)",
      "* item\n+\n|===\n|a\n\nafter\n",
      "* item\n+\n|===\n|a\n\nafter\n",
    ],
    [
      "table / nested item",
      "* a\n** b\n+\n|===\n|a\n\nafter\n",
      "* a\n** b\n+\n|===\n|a\n\nafter\n",
    ],
    [
      "table / item -> unterminated compound",
      "* item\n+\n====\n|===\n|a\n",
      "* item\n+\n====\n|===\n|a\n====\n",
    ],
  ])("%s", async (_name, input, expected) => {
    await expectFixed(input, expected);
  });

  test.each([
    [
      "comment block / item",
      "* item\n+\n////\nx\n\nafter\n",
      "* item\n+\n////\nx\n\nafter\n////\n",
    ],
    [
      "comment block / nested item",
      "* a\n** b\n+\n////\nx\n\nafter\n",
      "* a\n** b\n+\n////\nx\n\nafter\n////\n",
    ],
    [
      "comment block / item -> unterminated compound",
      "* item\n+\n====\n////\nx\n",
      "* item\n+\n====\n////\nx\n////\n====\n",
    ],
  ])("%s (render-vacuous, third arm)", async (_name, input, expected) => {
    await expectFixedBytes(input, expected);
  });

  // The FOURTH coordinate, deliberately in the family: the three
  // rows above per flavor enumerate the item sites, but the healing
  // is keyed to a CONFINED stream end, not to those sites. Here the
  // unterminated verbatim sits inside an item inside a CLOSED
  // example — the confining terminator is the example's, not EOF's —
  // and its content survives (594dc598 emitted `----\n----`, losing
  // the line).
  test("closed example -> item -> unterminated verbatim keeps its content", async () => {
    await expectFixed(
      "====\n* a\n+\n----\nu\n====\n",
      "====\n* a\n+\n----\nu\n----\n====\n",
    );
  });

  // The must-not-change byte controls, base-measured at 594dc598.
  test.each([
    ["document-level EOF", "----\nfoo\n", "----\nfoo\n----\n"],
    [
      "outer-terminator forced close",
      "====\n----\nfoo\n====\n",
      "====\n----\nfoo\n----\n====\n",
    ],
    [
      "table in a closed example (byte-identical)",
      "====\n|===\n|a\n====\n",
      "====\n|===\n|a\n====\n",
    ],
  ])("%s keeps the base bytes", async (_name, input, expected) => {
    await expectFixed(input, expected);
  });
});
