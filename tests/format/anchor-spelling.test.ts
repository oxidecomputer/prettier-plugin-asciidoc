/**
 * The anchor serializer's spelling contract: a VALID id
 * keeps the normalized `[[id, reftext]]` spelling byte-for-byte; a
 * grammar-REJECTED id prints the author's captured bytes verbatim.
 * A whitespace-only post-comma reftext is captured verbatim too
 * (issue #53): `[[id, ]]` keeps its comma and space, and the
 * rejected-id twin `[[3-bad, ]]` round-trips the author's exact
 * bytes. The gP names in row comments are opaque probe ids, kept
 * stable so the conformance backlog can cite rows.
 */
import { describe, expect, test } from "vitest";
import { expectFormatted, formatAdoc, renderedHtml } from "../helpers.js";

describe("rejected ids print the author's bytes (corruption fix, pseudo-run-fold)", () => {
  // gP42: the pure serializer corruption — the base printed
  // "[[3-bad, Ref]]\n" for this input, which renders DIFFERENT text.
  test("[[3-bad,Ref]] stays comma-tight", async () => {
    const input = "[[3-bad,Ref]]\n";
    await expectFormatted(input, input);
  });
  // gP43: the with-space twin — the row that adjudicated the repair
  // variant ("drop the injected space" would have corrupted it).
  test("[[3-bad, Ref]] keeps its space", async () => {
    const input = "[[3-bad, Ref]]\n";
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
  });
  // The inline (mid-text) member of the same class.
  test("a rejected id in running text keeps the author's interior", async () => {
    const input = "x [[3-bad,Ref]] y\n";
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
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
    await expectFormatted(input, expected);
  });
});

describe("a whitespace-only reftext replays faithfully (issue #53)", () => {
  // gP46: valid id. The parse keeps the post-comma bytes verbatim
  // (makeInlineAnchor no longer narrows a whitespace-only reftext to
  // undefined), and the serializer's valid-id arm spells them as the
  // normalized `[[id, ]]` - the trailing space is inside Ruby's own
  // grammar (`BlockAnchorRx`/`InlineAnchorRx` tolerate it), so the
  // anchor stays live and render-equal on both sides.
  test.each([
    ["block form", "[[id, ]]\n----\nx\n----\n", "[[id, ]]\n----\nx\n----\n"],
    ["standalone", "[[id, ]]\n", "[[id, ]]\n"],
  ])(
    "[[id, ]] %s keeps its comma and space",
    async (_name, input, expected) => {
      await expectFormatted(input, expected);
    },
  );
  // gP47: rejected id. To the oracle this line is TEXT, so the only
  // render-equal spelling is the author's own bytes - which the
  // rejected-id arm of anchorToSource now receives intact. The
  // render assert this row used to run WITHOUT is restored: the old
  // `[[3-bad]]` respell rendered different characters, a live
  // corruption this fix closes.
  test("[[3-bad, ]] keeps the author's bytes", async () => {
    const input = "[[3-bad, ]]\n";
    await expectFormatted(input, input);
  });

  // The oracle sweep of the whitespace-reftext spelling
  // neighbourhood, recorded as rows because #53's claimed
  // render-divergent list-item shape did NOT reproduce under probe:
  // `* x [[id, ]] y` is render-equal (InlineAnchorRx, rx.rb l.443,
  // tolerates the trailing space). A tab or a run of spaces
  // normalizes to the one-space spelling through the valid-id arm's
  // trim - measured render-equal against the oracle in every frame.
  test.each([
    ["inline, one space", "x [[id, ]] y\n", "x [[id, ]] y\n"],
    ["inline, tab", "x [[id,\t]] y\n", "x [[id, ]] y\n"],
    ["inline, two spaces", "x [[id,  ]] y\n", "x [[id, ]] y\n"],
    ["item-leading", "* x [[id, ]] y\n", "* x [[id, ]] y\n"],
    ["block, tab", "[[id,\t]]\n", "[[id, ]]\n"],
    ["block, two spaces", "[[id,  ]]\n", "[[id, ]]\n"],
    // The EMPTY reftext is the one member the normalized spelling may
    // not touch: `[[id,]]` is literal TEXT to the oracle (the
    // grammar's reftext needs a character after the comma), while
    // `[[id, ]]` is a live anchor - so only the verbatim bytes are
    // render-equal, and anchorToSource's verbatim test keeps them.
    ["inline, comma-tight empty", "x [[id,]] y\n", "x [[id,]] y\n"],
    ["standalone, comma-tight empty", "[[id,]]\n", "[[id,]]\n"],
    ["rejected id, comma-tight empty", "[[3-bad,]]\n", "[[3-bad,]]\n"],
  ])("%s", async (_name, input, expected) => {
    await expectFormatted(input, expected);
  });
});

describe("bibliography anchors print the author's interior verbatim", () => {
  // `[[[id,reftext]]]` keeps the author's interior even for a VALID
  // id — no `, ` is injected after the comma, unlike the
  // `[[id,reftext]]` normalization above.
  test("[[[Fowler_1997,1]]] stays comma-tight", async () => {
    const input = "* [[[Fowler_1997,1]]] x\n";
    await expectFormatted(input, input);
  });
});
