/**
 * The two byte-changing families, probed as bytes: the printer never
 * invents a `+`, so a leading metadata run under reflowable item text
 * is held back by keeping the text's last source break instead.
 *
 * `the pseudo-run fold classes` are CORRUPTION fixes — the old bytes
 * folded the metadata onto the item's first rest line and the
 * re-reader's drain swallowed the run — so their proof direction is
 * head output against the ORIGINAL INPUT. `the author-plus classes`
 * are render-neutral respellings of a `+` the old printer invented;
 * they are proved against the input too, which is the stronger claim.
 * The controls below them must not move at all.
 *
 * Split out of list-item-blocks.test.ts for the 450-line ceiling; the
 * two files pin one contract.
 */
import { describe, expect, test } from "vitest";
import { formatAdoc, renderedHtml } from "../helpers.js";

describe("the pseudo-run fold classes render like the input", () => {
  // Corruption fixes: the base FOLDED these (metadata onto the first
  // rest line; the drain then read the pseudo paragraph into the item
  // text). Proof direction: head output vs the ORIGINAL INPUT.
  test.each([
    [
      "3-line text",
      "* a\nb\nc\n[role]\n[[3-bad]]\n",
      "* a b\n  c\n[role]\n[[3-bad]]\n",
    ],
    [
      "comment-transparent",
      "* a\npara\n[role]\n// c\n[[3-bad]]\n",
      "* a\n  para\n[role]\n// c\n[[3-bad]]\n",
    ],
    [
      "+-separated pseudo",
      "* a\npara\n[role]\n+\n[[3-bad]]\n",
      "* a\n  para\n[role]\n+\n[[3-bad]]\n",
    ],
    [
      "bare-digit id",
      "* a\npara\n[role]\n[[9]]\n",
      "* a\n  para\n[role]\n[[9]]\n",
    ],
    [
      "rejected id with reftext",
      "* a\npara\n[role]\n[[3-bad,Ref]]\n",
      "* a\n  para\n[role]\n[[3-bad,Ref]]\n",
    ],
    [
      "nested item's own run",
      "* t\n** a\npara\n[role]\n[[3-bad]]\n",
      "* t\n** a\n   para\n[role]\n[[3-bad]]\n",
    ],
    [
      "rejected reftext behind a +",
      "* a\npara\n[role]\n+\n[[3-bad,Ref]]\n",
      "* a\n  para\n[role]\n+\n[[3-bad,Ref]]\n",
    ],
    [
      "3-line text, rejected reftext behind a +",
      "* a\nb\nc\n[role]\n+\n[[3-bad,Ref]]\n",
      "* a b\n  c\n[role]\n+\n[[3-bad,Ref]]\n",
    ],
    [
      "two lookalikes, one behind a +",
      "* a\npara\n[role]\n[[3-bad,Ref]]\n+\n[[3-bad]]\n",
      "* a\n  para\n[role]\n[[3-bad,Ref]]\n+\n[[3-bad]]\n",
    ],
  ])("%s", async (_name, input, expected) => {
    const out = await formatAdoc(input);
    expect(out).toBe(expected);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});

describe("the author-plus classes respell render-neutrally", () => {
  // Respellings: the base's invented `+` was render-neutral; the
  // keepBreak spelling is proved equal to the input as well.
  test.each([
    [
      "+-listing after the run",
      "* a\nb\nc\n[role]\n+\n----\nx\n----\n",
      "* a b\n  c\n[role]\n+\n----\nx\n----\n",
    ],
    [
      "pseudo in the run, + block after",
      "* a\npara\n[role]\n[[3-bad]]\n+\npara\n",
      "* a\n  para\n[role]\n[[3-bad]]\n+\npara\n",
    ],
    [
      "nested list after the run",
      "* a\npara\n[role]\n** b\n",
      "* a\n  para\n[role]\n** b\n",
    ],
    [
      "adjacent indented literal",
      "* a\npara\n[role]\n  lit\n",
      "* a\n  para\n[role]\n  lit\n",
    ],
    [
      "+-literal after the run",
      "* a\npara\n[role]\n+\n  lit\n",
      "* a\n  para\n[role]\n+\n  lit\n",
    ],
    [
      "+-attrlist after the run",
      "* a\npara\n[role]\n+\n[role2]\n",
      "* a\n  para\n[role]\n+\n[role2]\n",
    ],
    [
      "+-anchor after the run",
      "* a\npara\n[role]\n+\n[[anc]]\n",
      "* a\n  para\n[role]\n+\n[[anc]]\n",
    ],
    [
      "through a transparent comment",
      "* a\npara\n[role]\n+\n// c\n+\n[role2]\n",
      "* a\n  para\n[role]\n+\n// c\n+\n[role2]\n",
    ],
  ])("%s", async (_name, input, expected) => {
    const out = await formatAdoc(input);
    expect(out).toBe(expected);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});

describe("byte-stable controls (the two-answer hazard must NOT move these)", () => {
  // A `+` above the run (the gap speaks); the title control the base
  // already spelled with a kept break; the harmless folds; and the
  // `[[id,]]` narrowing, whose printed `[[id]]` keeps the run.
  test.each([
    [
      "a + above the run",
      "* a\n+\n[role]\n----\nx\n----\n",
      "* a\n+\n[role]\n----\nx\n----\n",
    ],
    [
      "a +-separated title",
      "* a\npara\n[role]\n+\n.T\n",
      "* a\n  para\n[role]\n+\n.T\n",
    ],
    ["a trailing run", "* a\npara\n[role]\n", "* a para\n[role]\n"],
    [
      "a trailing run ending in a valid anchor",
      "* a\npara\n[role]\n[[anc]]\n",
      "* a para\n[role]\n[[anc]]\n",
    ],
    [
      "a lookalike as item text",
      "* a\npara\n[[3-bad]]\n",
      "* a para [[3-bad]]\n",
    ],
  ])("%s round-trips to its recorded bytes", async (_name, input, expected) => {
    const out = await formatAdoc(input);
    expect(out).toBe(expected);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  // The `[[id,]]` narrowing is byte-stable here too — its printed
  // `[[id]]` re-reads as an anchor, so the line stays in the run and
  // the hazard still answers "none". No render assert, and the
  // omission is not incidental: the narrowing itself diverges
  // (`[[id,]]` is literal text to Asciidoctor, `[[id]]` a live anchor
  // on the block below), a pre-existing condition this suite freezes
  // rather than fixes.
  test("the [[id,]] narrowing keeps the run", async () => {
    const out = await formatAdoc("* a\npara\n[role]\n[[id,]]\n");
    expect(out).toBe("* a para\n[role]\n[[id]]\n");
    expect(await formatAdoc(out)).toBe(out);
  });
});

describe("the wrap-direction idempotence repair", () => {
  test("pass 2 no longer invents a +; pass 1 is the fixed point", async () => {
    const input =
      "* aaaaaaaa bbbbbbbb cccccccc dddddddd eeeeeeee ffffffff gggggggg hhhhhhhh iiiiiiii\n[role]\npara\n";
    const p1 = await formatAdoc(input);
    const p2 = await formatAdoc(p1);
    // The render half of this class (pass 1 reads unlike the input,
    // because the width-wrap moved the author's first-rest-line
    // metadata) is a recorded pre-existing divergence — deliberately
    // NOT asserted here.
    expect(p2).toBe(p1);
    expect(p1).not.toContain("\n+\n");
  });
});

describe("the whitespace-reftext lookalike: bytes move, the respell stays fenced", () => {
  // The whitespace-reftext lookalike leaves the run (keepBreak) but
  // still prints [[3-bad]] — the `[[id,]]` narrowing's rejected-id
  // cousin, a pre-existing corruption. First-pass bytes and
  // idempotence are the whole pin; NO render assert on purpose.
  test("* a/para/[role]/[[3-bad, ]] keeps break and the frozen spelling", async () => {
    const out = await formatAdoc("* a\npara\n[role]\n[[3-bad, ]]\n");
    expect(out).toBe("* a\n  para\n[role]\n[[3-bad]]\n");
    expect(await formatAdoc(out)).toBe(out);
  });
});
