/**
 * The D10(d) containment-byte characterization fixtures: the two
 * facts the section container used to enforce invisibly, kept as
 * visible pairwise stacking rules and byte-frozen here. The corpus
 * cannot adjudicate ANY of this (zero flatten-created sibling pairs
 * on either arm over all 1,614 cases — spec D10(d)), so these rows
 * and the shape-diff heading-adjacency matrix are the ONLY nets.
 * Every input's expectation is 594dc598's measured output except the
 * two recorded divergences (R1, R2), whose comments carry the
 * rulings.
 */
import { describe, expect, test } from "vitest";
import { formatAdoc, renderedHtml } from "../helpers.js";

/**
 * Assert exact bytes and idempotence.
 * @param input - the source document
 * @param expected - the expected formatted bytes
 */
async function expectBytes(input: string, expected: string): Promise<void> {
  const output = await formatAdoc(input);
  expect(output).toBe(expected);
  expect(await formatAdoc(output)).toBe(output);
}

describe("keep-blank rows: the post-heading blank is FROZEN SPELLING at level >= 1", () => {
  // The old section printer forced a blank between the heading and
  // its first child unconditionally; flat-naive, the reader-eaten arm
  // would stack these. The suppression (previous is a level >= 1
  // heading) keeps today's bytes.
  test.each([
    ["comment after a heading", "== T\n// c\n", "== T\n\n// c\n"],
    ["directive after a heading", "== T\nifdef::x[]\n", "== T\n\nifdef::x[]\n"],
    ["attribute entry after a heading", "== T\n:a: 1\n", "== T\n\n:a: 1\n"],
    ["heading directly after a heading", "== A\n== B\n", "== A\n\n== B\n"],
  ])("%s", async (_name, input, expected) => {
    await expectBytes(input, expected);
  });

  test("the A1 row: a pseudo-anchor paragraph blank-separated before a heading KEEPS its blank", async () => {
    // Section A's LAST CHILD is a pseudo-anchor paragraph
    // ([[3-blind-mice]] fails the id grammar); the flatten CREATES
    // the sibling pair, and unguarded stacksAsMetadata would stack it
    // — the stacked spelling re-parses as ONE line and section B is
    // DESTROYED (render-inequal AND idempotence-broken). Byte-
    // identical today; the pseudo-anchor suppression keeps it so.
    const input = "== A\n\n[[3-blind-mice]]\n\n== B\n";
    await expectBytes(input, input);
    expect(renderedHtml(await formatAdoc(input))).toBe(renderedHtml(input));
  });
});

describe("keep-stacking rows: level 0 is SEMANTIC (the document header) and genuine metadata stacks", () => {
  test.each([
    ["block title before a heading", ".T\n== B\n", ".T\n== B\n"],
    ["block anchor before a heading", "[[id]]\n== B\n", "[[id]]\n== B\n"],
    [
      "a metadata run before a heading",
      "[[id]]\n.T\n== B\n",
      "[[id]]\n.T\n== B\n",
    ],
    [
      "genuine metadata blank-separated before a heading still stacks",
      ".T\n\n== B\n",
      ".T\n== B\n",
    ],
    [
      "comment after the doc title stays stacked (level 0)",
      "= T\n// c\n",
      "= T\n// c\n",
    ],
    [
      "directive after the doc title stays stacked (level 0)",
      "= T\nifdef::x[]\n",
      "= T\nifdef::x[]\n",
    ],
    [
      "the header run: title + attribute entries",
      "= T\n:a: 1\n\npara\n",
      "= T\n:a: 1\n\npara\n",
    ],
  ])("%s", async (_name, input, expected) => {
    await expectBytes(input, expected);
  });

  test("a pseudo-anchor before `= T` still stacks (the guard is keyed level >= 1)", async () => {
    // First-pass bytes only, deliberately: the stacked spelling's
    // SECOND pass joins to "[[3-blind-mice]] = T" — a PRE-EXISTING
    // non-idempotence at 594dc598 (G8(b)), out of β's scope. What
    // this row pins is that the pseudo-anchor suppression does NOT
    // fire at level 0.
    const output = await formatAdoc("[[3-blind-mice]]\n\n= T\n");
    expect(output).toBe("[[3-blind-mice]]\n= T\n");
  });
});

describe("STILL-STACK rows: the reader-eaten suppression is ONE-SIDED (previous-is-heading only)", () => {
  // The heading-as-CURRENT direction is not flatten-created — it
  // exists and STACKS today (rev 6's one blocking defect was a
  // current-side arm that would have changed these bytes).
  test.each([
    [
      "comment directly before a heading",
      "// c\n== B\nbody\n",
      "// c\n== B\n\nbody\n",
    ],
    [
      "directive directly before a heading",
      "ifdef::x[]\n== B\n",
      "ifdef::x[]\n== B\n",
    ],
    [
      "raw lines around a body keep their sides",
      "== A\n\npara\n\n// c\n== B\n",
      "== A\n\npara\n\n// c\n== B\n",
    ],
    [
      "directive before a closing heading",
      "== A\n\npara\n\nifdef::x[]\n== B\n",
      "== A\n\npara\n\nifdef::x[]\n== B\n",
    ],
  ])("%s", async (_name, input, expected) => {
    await expectBytes(input, expected);
  });
});

describe("insurance rows", () => {
  test("discreteHeading is untouched: its comment still stacks", async () => {
    const input = "[discrete]\n== D\n// c\n";
    await expectBytes(input, input);
  });

  test("the level jump is CARRIED, not interpreted: `= D` then `=== C`", async () => {
    const input = "= D\n\n=== C\n";
    await expectBytes(input, input);
  });

  test("a list ending in a reader-eaten line ABSORBS the next heading (no pair arises)", async () => {
    // Audit context (spec D10(d)): `== B` is INSIDE the item for
    // Asciidoctor, because the reader never sees the directive — so
    // no list-boundary pair exists in either direction.
    const input = "== A\n* a\n+\nifdef::x[]\n== B\n";
    await expectBytes(input, "== A\n\n* a\n+\nifdef::x[]\n== B\n");
  });
});

describe("recorded divergence R1 (plan G8(d)): the TOP-LEVEL pseudo-anchor pair", () => {
  test("a top-level pseudo-anchor blank-separated before a heading keeps its blank (byte change vs base, by ruling)", async () => {
    // At 594dc598 this pair — with NO preceding section — already
    // stacks and DESTROYS the heading: base output is
    // "[[3-blind-mice]]\n== B\n", whose second pass joins to
    // "[[3-blind-mice]] == B\n". Post-flatten it is pairwise
    // INDISTINGUISHABLE from the A1 row above, so the owner-mandated
    // guard fires here too. The new bytes are a strict improvement —
    // render fidelity AND idempotence newly hold — and this row is
    // the divergence's named net (it is excluded from the shape-diff
    // product; plan ruling R1, reported as a spec-gap finding).
    const input = "[[3-blind-mice]]\n\n== B\n";
    await expectBytes(input, input);
    expect(renderedHtml(await formatAdoc(input))).toBe(renderedHtml(input));
  });
});

describe("recorded divergence R2: the HOISTED-RAW-LINE heading pair", () => {
  // The rule these rows pin: a level >= 1 heading followed by held
  // raw line(s) — a comment, a conditional, an include — and then a
  // heading of the SAME OR SHALLOWER level prints a blank between
  // the first heading and the raw run. A DEEPER following heading
  // and level 0 do not: those rows are the base's bytes, unchanged.
  //
  // 594dc598 printed no blank in the same-or-shallower case alone,
  // and only there: the raw line was flushed OUTSIDE the closing
  // section, so the section printer's forced blank — which reaches a
  // section's FIRST CHILD — never saw it, while every other shape in
  // this file already got the blank. The suppression is pairwise
  // (previous is a level >= 1 heading), so the spelling is now
  // uniform across the class. The new bytes are render-equal to the
  // input and idempotent — asserted on every row below — and the
  // corpus has no instance of the shape.
  test.each([
    [
      "comment between same-level headings",
      "== T\n// c\n== U\n",
      "== T\n\n// c\n== U\n",
    ],
    [
      "conditional between same-level headings",
      "== T\nifdef::x[]\n== U\n",
      "== T\n\nifdef::x[]\n== U\n",
    ],
    [
      "include between same-level headings",
      "== T\ninclude::p[]\n== U\n",
      "== T\n\ninclude::p[]\n== U\n",
    ],
    [
      "the raw line already blank-separated from the second heading",
      "== T\n// c\n\n== U\n",
      "== T\n\n// c\n\n== U\n",
    ],
    [
      "a SHALLOWER following heading",
      "=== T\n// c\n== U\n",
      "=== T\n\n// c\n== U\n",
    ],
  ])("%s gains the separating blank", async (_name, input, expected) => {
    await expectBytes(input, expected);
    expect(renderedHtml(await formatAdoc(input))).toBe(renderedHtml(input));
  });

  test.each([
    [
      "a DEEPER following heading (the raw line is the section's first child)",
      "== T\n// c\n=== V\n",
      "== T\n\n// c\n=== V\n",
    ],
    [
      "level 0 on both sides stays stacked",
      "= T\n// c\n= U\n",
      "= T\n// c\n= U\n",
    ],
  ])("%s keeps the base bytes", async (_name, input, expected) => {
    await expectBytes(input, expected);
    expect(renderedHtml(await formatAdoc(input))).toBe(renderedHtml(input));
  });
});
