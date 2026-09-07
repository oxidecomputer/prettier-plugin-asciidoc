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

describe("an escaped [[ is not a live anchor (issue #214)", () => {
  // `InlineAnchorRx` (rx.rb l.443) carries its own `(\\)?` group: a
  // backslash directly in front of `[[` makes the WHOLE match text
  // Ruby's escape drops the backslash and renders (oracle: `\[[a,R]]`
  // renders `[[a,R]]`, not an anchor). Our tokenizer used to read the
  // backslash and the anchor as two independent tokens, so the
  // printer still normalized the comma inside a construct the oracle
  // never treats as an attrlist at all - the printed `, ` became
  // visible text (`\[[a, R]]` renders `[[a, R]]`, an extra byte no
  // author wrote).
  test.each([
    ["with reftext", "\\[[a,R]]\n"],
    ["id only, no comma to respell", "\\[[a]]\n"],
    // A second backslash is STILL an escape to the oracle: the regex
    // always binds the closest backslash to `[[`, whatever stands in
    // front of it (measured: `\\[[a,R]]` renders `\[[a,R]]` literal,
    // one backslash and the brackets, never a live anchor).
    ["doubled backslash, still escaped", "\\\\[[a,R]]\n"],
  ])("%s stays byte for byte", async (_name, input) => {
    await expectFormatted(input, input);
  });
  test("the same shape in a marker item's text", async () => {
    const input = "* \\[[a,R]]\n";
    await expectFormatted(input, input);
  });
  // CONTROL: an anchor glued to ordinary text with NO backslash is a
  // live anchor to the oracle regardless of the missing whitespace
  // (measured: `word[[a,R]]` renders identically whether the comma
  // carries a space or not), so the fix may not over-refuse this
  // shape into a needless verbatim replay.
  test("an anchor glued to plain text still normalizes (control)", async () => {
    await expectFormatted("word[[a,R]]\n", "word[[a, R]]\n");
  });
  // A DISCLOSED SIDE EFFECT of the lookbehind, not a second bug:
  // `InlineBiblioAnchor` only matches at index 0 (rules.ts), so a
  // leading backslash already pushes it out of the running whether
  // this fix exists or not. Before this fix, `InlineAnchor` matched
  // at index 1 - `\[[[a,R]]]`'s SECOND character - consuming
  // `[[a,R]]` (the "two-bracket misparse" its own doc comment names)
  // and the printer replayed that verbatim. Now the lookbehind refuses
  // index 1 too (still preceded by `\`), so the rule matches at index
  // 2 instead: a plain, unescaped `[[a,R]]` one character later, which
  // IS a live anchor to the oracle - `\[<a id="a"></a>]`, the same
  // render as before - so `anchorToSource` normalizes its comma. The
  // reftext is dead either way (`InlineAnchorScanRx` refuses a
  // `[`-preceded anchor), so this is render-equal, not a regression.
  test.each([
    ["standalone", "\\[[[a,R]]]\n", "\\[[[a, R]]]\n"],
    [
      "with reftext prose",
      "\\[[[Fowler_1997,1]]] x\n",
      "\\[[[Fowler_1997, 1]]] x\n",
    ],
    ["in a marker item", "* \\[[[a,R]]] x\n", "* \\[[[a, R]]] x\n"],
  ])(
    "an escaped [[[ moves the live anchor to the inner pair, which still normalizes",
    async (_name, input, expected) => {
      await expectFormatted(input, expected);
    },
  );
});

describe("the comma pads only where both authorities read the id", () => {
  // The serializer's grammar is the INTERSECTION of the two
  // authorities' id classes (BLOCK_ANCHOR_BOTH_PROGRAMS,
  // src/parse/line-shapes.ts), not the reader's own class, because
  // padding the comma moves the id into a spelling this printer
  // chose. Where both read it, the pad is the normalization above and
  // costs nothing: the reftext feeds `xreflabel` and never the HTML.
  test.each([
    ["inline", "para [[café,Réf]] tail\n", "para [[café, Réf]] tail\n"],
    ["block", "[[café,Réf]]\npara\n", "[[café, Réf]]\n\npara\n"],
  ])(
    "a non-ASCII id both programs read pads: %s",
    async (_name, input, out) => {
      await expectFormatted(input, out);
    },
  );

  // Red before that gate: the serializer asked the reader's own
  // class and padded here too, which injects a space into text the
  // reference renders literally. `a` then U+2460 is a non-decimal
  // number: an id character to the oracle, prose to the Ruby, so
  // `[[a①,R]]` is a live anchor to one program and visible text to
  // the other. Only the author's bytes are safe.
  test.each([
    "para [[a①,R]] tail\n",
    "para [[a①, R]] tail\n",
    "[[a①,R]]\n\npara\n",
  ])("%j keeps the author's interior", async (input) => {
    await expectFormatted(input, input);
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
