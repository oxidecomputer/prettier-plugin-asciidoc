/**
 * The anchor serializer's spelling contract: a VALID id
 * keeps the normalized `[[id, reftext]]` spelling byte-for-byte; a
 * grammar-REJECTED id prints the author's captured bytes verbatim.
 * The `[[id,]]`-class narrowing (empty-or-whitespace post-comma →
 * reftext undefined → `[[id]]`) is the one recorded divergence that
 * remains, pinned frozen here so it cannot move silently. The gP
 * names in row comments are opaque probe ids, kept stable so the
 * conformance backlog can cite rows.
 */
import { describe, expect, test } from "vitest";
import { formatAdoc, renderedHtml } from "../helpers.js";

describe("rejected ids print the author's bytes (corruption fix, g1-pseudo-run-fold)", () => {
  // gP42: the pure serializer corruption — the base printed
  // "[[3-bad, Ref]]\n" for this input, which renders DIFFERENT text.
  test("[[3-bad,Ref]] stays comma-tight", async () => {
    const input = "[[3-bad,Ref]]\n";
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    expect(renderedHtml(out)).toBe(renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
  // gP43: the with-space twin — the row that adjudicated the repair
  // variant ("drop the injected space" would have corrupted it).
  test("[[3-bad, Ref]] keeps its space", async () => {
    const input = "[[3-bad, Ref]]\n";
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    expect(renderedHtml(out)).toBe(renderedHtml(input));
  });
  // The inline (mid-text) member of the same class.
  test("a rejected id in running text keeps the author's interior", async () => {
    const input = "x [[3-bad,Ref]] y\n";
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    expect(renderedHtml(out)).toBe(renderedHtml(input));
  });
});

describe("valid ids keep today's normalized spelling (controls — no byte movement)", () => {
  // gP44/gP45: the immovable controls. These rows pass BEFORE the
  // repair too; they exist so the repair cannot widen.
  test.each([
    ["inline", "x [[anc,Ref]] y\n", "x [[anc, Ref]] y\n"],
    ["block", "[[anc,Ref]]\n----\nx\n----\n", "[[anc, Ref]]\n----\nx\n----\n"],
    [
      "already normalized",
      "[[anc, Ref]]\n----\nx\n----\n",
      "[[anc, Ref]]\n----\nx\n----\n",
    ],
  ])("%s [[anc,Ref]] prints [[anc, Ref]]", async (_name, input, expected) => {
    const out = await formatAdoc(input);
    expect(out).toBe(expected);
    expect(renderedHtml(out)).toBe(renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});

describe("the whitespace-reftext narrowing stays FROZEN", () => {
  // gP46: valid id — render-neutral narrowing, bytes must not move.
  test.each([
    ["block form", "[[id, ]]\n----\nx\n----\n", "[[id]]\n----\nx\n----\n"],
    ["standalone", "[[id, ]]\n", "[[id]]\n"],
  ])("[[id, ]] %s narrows to [[id]]", async (_name, input, expected) => {
    const out = await formatAdoc(input);
    expect(out).toBe(expected);
    expect(renderedHtml(out)).toBe(renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
  // gP47: rejected id — a PRE-EXISTING live corruption (the output
  // renders "[[3-bad]]" where the input rendered "[[3-bad, ]]"),
  // byte-frozen here and carried as close-out backlog material, NOT
  // absorbed into a family. No render assert on purpose.
  test("[[3-bad, ]] keeps today's [[3-bad]] bytes", async () => {
    const out = await formatAdoc("[[3-bad, ]]\n");
    expect(out).toBe("[[3-bad]]\n");
    expect(await formatAdoc(out)).toBe(out);
  });
});

describe("bibliography anchors print the author's interior verbatim", () => {
  // `[[[id,reftext]]]` keeps the author's interior even for a VALID
  // id — no `, ` is injected after the comma, unlike the
  // `[[id,reftext]]` normalization above.
  test("[[[Fowler_1997,1]]] stays comma-tight", async () => {
    const input = "* [[[Fowler_1997,1]]] x\n";
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    expect(renderedHtml(out)).toBe(renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});
