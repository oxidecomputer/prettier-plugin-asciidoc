/**
 * Format tests for block attribute lists, anchors, and titles.
 *
 * The formatter preserves block metadata lines as-is:
 * - `[source,ruby]` — block attribute list
 * - `[[anchor-id]]` — block anchor (a `blockAnchor` node)
 * - `.Block Title` — block title
 *
 * Block metadata lines stack with the following block (no blank
 * line between them), matching idiomatic AsciiDoc style, and their
 * bracket interior gets ONE spacing: `[a,b,c]`.
 */
import { describe, test, expect } from "vitest";
import { formatAdoc, renderedHtml } from "../helpers.js";

describe("block attribute list formatting", () => {
  // A canonical attribute list must pass through
  // unchanged.
  test("attribute list preserved as-is", async () => {
    const input = "[source,ruby]\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Shorthand ID preserved.
  test("[#myid] preserved as-is", async () => {
    const input = "[#myid]\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Shorthand role preserved.
  test("[.role] preserved as-is", async () => {
    const input = "[.role]\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Attribute list stacks with following block (single newline,
  // no blank line between them).
  test("attribute list stacks with listing block", async () => {
    const input = "[source,ruby]\n----\nputs 'hello'\n----\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Multiple attribute lists stack together.
  test("multiple attribute lists stack together", async () => {
    const input = "[source,ruby]\n[#myid]\n----\nputs 'hello'\n----\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Attribute list with blank line before a block should have
  // the blank line removed (stacking behavior).
  test("blank line between attribute list and block is removed", async () => {
    const input = "[source,ruby]\n\n----\nputs 'hello'\n----\n";
    const expected = "[source,ruby]\n----\nputs 'hello'\n----\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Attribute list between paragraphs should get blank-line
  // treatment: one blank line between each.
  test("attribute list between paragraphs", async () => {
    const input =
      "Before.\n\n[source,ruby]\n----\nputs 'hello'\n----\n\nAfter.\n";
    expect(await formatAdoc(input)).toBe(input);
  });
});

describe("standalone anchor formatting", () => {
  // Anchor passes through unchanged.
  test("standalone anchor preserved as-is", async () => {
    const input = "[[anchor-id]]\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Anchor on its own line before text is a block-level anchor: the
  // reader holds the line back as metadata and it becomes its own
  // `blockAnchor` node, so the paragraph after it is a separate
  // block. The printer then refuses to stack the two
  // (wouldMergeWithAnchor) — stacked, a re-parse would absorb the
  // anchor into the paragraph's text — so the output gains a blank
  // line.
  test("anchor before text splits with blank line", async () => {
    const input = "[[my-anchor]]\nSome text.\n";
    expect(await formatAdoc(input)).toBe("[[my-anchor]]\n\nSome text.\n");
  });

  // Anchor followed by a blank line stays separate — the blank line
  // is preserved because closing it would merge the two on re-parse
  // (wouldMergeWithAnchor).
  test("anchor preserves blank line before next block", async () => {
    const input = "[[my-anchor]]\n\nSome text.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Anchor with reftext: normalizes to a space after the comma.
  test("anchor with reftext preserved", async () => {
    const input = "[[my-id,My Reference Text]]\n";
    const expected = "[[my-id, My Reference Text]]\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Anchor with reftext that already has a space after the comma
  // round-trips unchanged.
  test("anchor with reftext round-trips with space", async () => {
    const input = "[[my-id, My Reference Text]]\n";
    expect(await formatAdoc(input)).toBe(input);
  });
});

describe("block anchors with include", () => {
  test("two anchors then include", async () => {
    const input = "[[A]]\n\n[[a]]\ninclude::A[]\n";
    expect(await formatAdoc(input)).toBe("[[A]]\n\n[[a]]\ninclude::A[]\n");
  });

  // Stacked block anchors must stay on separate lines —
  // collapsing onto one line turns block anchors into inline
  // anchors, which Asciidoctor renders differently.
  test("stacked anchors stay on separate lines", async () => {
    const input = "[[A]]\n[[a]]\nsome text\n";
    expect(await formatAdoc(input)).toBe("[[A]]\n\n[[a]]\n\nsome text\n");
  });
});

describe("block title formatting", () => {
  // Title passes through unchanged.
  test("block title preserved as-is", async () => {
    const input = ".My Title\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Title stacks with following listing block.
  test("title stacks with listing block", async () => {
    const input = ".Example Code\n----\nputs 'hello'\n----\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Title stacks with following paragraph.
  test("title stacks with paragraph", async () => {
    const input = ".Important Note\nThis is the note text.\n";
    expect(await formatAdoc(input)).toBe(input);
  });
});

describe("combined block metadata formatting", () => {
  // A block anchor is block metadata — it stacks with the following
  // title and attribute list. The entire metadata chain stacks with
  // the block.
  test("anchor + title + attribute list + block", async () => {
    const input =
      "[[my-id]]\n.My Title\n[source,ruby]\n----\nputs 'hello'\n----\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Title + attribute list before a paragraph.
  test("title + attribute list before paragraph stacks", async () => {
    const input = ".Important\n[#note]\nSome paragraph text.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Attribute list before a section stacks.
  test("attribute list before section stacks", async () => {
    const input = "[appendix]\n== Appendix A\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Metadata with blank lines between them should collapse.
  test("blank lines between metadata lines are removed", async () => {
    const input = ".My Title\n\n[source,ruby]\n\n----\nputs 'hello'\n----\n";
    const expected = ".My Title\n[source,ruby]\n----\nputs 'hello'\n----\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Block metadata after a paragraph gets blank-line separation.
  test("paragraph then metadata then block", async () => {
    const input = "Some text.\n\n[source,ruby]\n----\nputs 'hello'\n----\n";
    expect(await formatAdoc(input)).toBe(input);
  });
});

describe("block anchor spelling and idempotence: byte-identical across the node change", () => {
  test("a bare anchor keeps its spelling", async () => {
    const input = "[[my-id]]\n\npara\n";
    const output = await formatAdoc(input);
    expect(output).toBe(input);
    expect(await formatAdoc(output)).toBe(output);
    expect(await renderedHtml(output)).toBe(await renderedHtml(input));
  });

  test("an anchor with reftext keeps today's normalized spelling", async () => {
    const input = "[[my-id,Ref Text]]\n\npara\n";
    const output = await formatAdoc(input);
    expect(output).toBe("[[my-id, Ref Text]]\n\npara\n");
    expect(await formatAdoc(output)).toBe(output);
    expect(await renderedHtml(output)).toBe(await renderedHtml(input));
  });

  test("anchor over a block stacks; anchor over a paragraph keeps its blank line", async () => {
    const stacked = "[[a]]\n----\nx\n----\n";
    expect(await formatAdoc(stacked)).toBe(stacked);
    const merged = "[[a]]\n\npara\n";
    expect(await formatAdoc(merged)).toBe(merged);
  });
});

// A `[[…]]` line is a block ANCHOR only when it matches the
// block-anchor grammar (BLOCK_ANCHOR_SOURCE, parse/line-shapes.ts;
// behavior is Ruby's `BlockAnchorRx`). When the id fails it, or the
// reftext alternative does not, Asciidoctor reads the line as an
// ordinary PARAGRAPH — and so does the reader. It still prints as
// `[[…]]` alone on a line, so the printer keeps it stacked with the
// block below (`anchorLineShape`, src/block-metadata.ts — the shared
// record both printer-side rules consult): the author's
// bytes survive and re-parsing our output gains no blank line.
//
// The class the suites missed before `blockAnchor` became its own node
// kind: every anchor alphabet in
// the repo (fuzz `/[A-Za-z_][\w-]{0,14}/`, the sweep's `[[anc]]`, the
// hand-written `[[my-id]]`) generates a VALID id, so only the corpus
// reached it — `blocks_test.rb#should not recognize block anchor that
// starts with digit#0` and `#should not recognize block anchor with
// illegal id characters#0`, which parity holds byte-identical.
describe("pseudo-anchor lines: a `[[…]]` line that is not a block anchor", () => {
  test("a digit-leading id stacks with the block below, unchanged", async () => {
    const input = "[[3-blind-mice]]\n----\nx\n----\n";
    const output = await formatAdoc(input);
    expect(output).toBe(input);
    expect(await formatAdoc(output)).toBe(output);
    expect(await renderedHtml(output)).toBe(await renderedHtml(input));
  });

  test("an illegal-character id stacks with the block below, unchanged", async () => {
    const input = "[[illegal$id]]\n----\nx\n----\n";
    const output = await formatAdoc(input);
    expect(output).toBe(input);
    expect(await formatAdoc(output)).toBe(output);
    expect(await renderedHtml(output)).toBe(await renderedHtml(input));
  });

  // The corpus row's own spelling, and the fidelity fix that freed it
  // from quarantine. This line is TEXT to the reader — the id fails
  // the grammar — so respelling its interior changes the rendered
  // characters. `anchorToSource` therefore prints the author's
  // post-comma bytes verbatim here. Counterfactual: the output used to
  // be `[[illegal$id, Reference Text]]\n----\ncontent\n----\n`, whose
  // paragraph rendered with an injected space; if that spelling comes
  // back, the always-normalize arm is back with it. The LINE structure
  // this row has always pinned is unmoved — the anchor stays on the
  // delimiter's line.
  test("the reftext form keeps its stacking, and its bytes", async () => {
    const input = "[[illegal$id,Reference Text]]\n----\ncontent\n----\n";
    const output = await formatAdoc(input);
    expect(output).toBe(input);
    expect(await formatAdoc(output)).toBe(output);
    expect(await renderedHtml(output)).toBe(await renderedHtml(input));
  });

  // `[[id,]]` is not a block-anchor line either: the grammar's reftext
  // alternative needs a character after the comma. Since #53's
  // faithful replay it PRINTS verbatim too - the empty reftext is
  // captured as `""` and anchorToSource's verbatim test fails on the
  // author's spelling - so the line stays TEXT on re-read, the
  // render check this row could never carry before is restored, and
  // pass 1 is trivially the fixed point. (The old normalization
  // printed `[[id]]`, a LIVE anchor where the author wrote literal
  // text.)
  test("`[[id,]]` before a block: verbatim, render-equal, fixed", async () => {
    const input = "[[id,]]\n----\nx\n----\n";
    const output = await formatAdoc(input);
    expect(output).toBe(input);
    expect(await formatAdoc(output)).toBe(output);
    expect(await renderedHtml(output)).toBe(await renderedHtml(input));
  });

  // Issue #46's second shape: the SAME line with trailing whitespace.
  // The reader rstrips before classifying, so the line reads exactly
  // as it does without the blanks - but a paragraph's inline body is a
  // source SLICE that ends at the raw line's end
  // (src/parse/lines/paragraph-reader.ts), so the stripped blanks come
  // back as a second child that prints nothing. The stacking record
  // counted CHILDREN, found two, and the printer wrote a blank line
  // that pass 2 took straight back out - a pure idempotency wobble,
  // since the blank changes nothing about how the pair renders. The
  // record now asks what the printer will EMIT (`anchorLineShape`,
  // src/block-metadata.ts), so pass 1 is the fixed point.
  //
  // One row per block the anchor can sit above, because the wobble
  // needs a following block that does NOT merge with an anchor: a
  // paragraph reflows onto the anchor's own line instead, and the
  // blank-keeping arms are pinned below.
  test.each([
    ["a listing block", "----\nx\n----\n"],
    ["an example block", "====\nx\n====\n"],
    ["an open block", "--\nx\n--\n"],
    ["a table", "|===\n|a\n|===\n"],
    ["an attribute line above a block", "[source]\n----\nx\n----\n"],
  ])("a rejected id with trailing blanks stacks above %s", async (_n, rest) => {
    const input = `[[3-bad]]  \n${rest}`;
    const output = await formatAdoc(input);
    expect(output).toBe(`[[3-bad]]\n${rest}`);
    expect(await formatAdoc(output)).toBe(output);
    expect(await renderedHtml(output)).toBe(await renderedHtml(input));
  });

  // The tail is whatever the rstrip took, and the rstrip set is the
  // six ASCII whitespace characters: tab, vertical tab and form feed
  // are in it exactly as the space is, which is what pins that the
  // packer's split and the reader's rstrip agree on those six. The
  // reftext form's bytes still replay verbatim, and so does the
  // serializer's empty-reftext arm, whose spelling the record's own
  // doc comment names.
  test.each([
    ["a tab", "[[3-bad]]\t\n----\nx\n----\n", "[[3-bad]]\n----\nx\n----\n"],
    [
      "a vertical tab",
      "[[3-bad]]\v\n----\nx\n----\n",
      "[[3-bad]]\n----\nx\n----\n",
    ],
    [
      "a form feed",
      "[[3-bad]]\f\n----\nx\n----\n",
      "[[3-bad]]\n----\nx\n----\n",
    ],
    [
      "a reftext the grammar rejects",
      "[[3-bad,Ref]]  \n----\nx\n----\n",
      "[[3-bad,Ref]]\n----\nx\n----\n",
    ],
    [
      "an empty reftext",
      "[[id,]] \n----\nx\n----\n",
      "[[id,]]\n----\nx\n----\n",
    ],
  ])("%s after the line stacks too", async (_n, input, expected) => {
    const output = await formatAdoc(input);
    expect(output).toBe(expected);
    expect(await formatAdoc(output)).toBe(output);
    expect(await renderedHtml(output)).toBe(await renderedHtml(input));
  });

  // The two arms that KEEP the blank line take the trailing-blank
  // spelling exactly as they take the bare one: a paragraph would
  // merge into the anchor on re-read, and a heading stacked under a
  // paragraph that prints `[[...]]` re-parses as one joined line. Both
  // were already stable before the fix; they are pinned here so
  // widening the record cannot quietly switch them off.
  test.each([
    ["a paragraph", "[[3-bad]]  \n\npara\n", "[[3-bad]]\n\npara\n"],
    ["a section heading", "[[3-bad]]  \n\n== S\n", "[[3-bad]]\n\n== S\n"],
  ])(
    "the blank line before %s survives the trailing blanks",
    async (_n, input, expected) => {
      const output = await formatAdoc(input);
      expect(output).toBe(expected);
      expect(await formatAdoc(output)).toBe(output);
      expect(await renderedHtml(output)).toBe(await renderedHtml(input));
    },
  );

  // A character the rstrip does NOT take is content, and the printer's
  // own word split is what decides: a NUL survives it, so the line the
  // re-reader sees is `[[3-bad]]` plus a NUL - text, not an anchor
  // line - and the blank line stays.
  //
  // Before issue #75, a no-break space, a thin space, an ideographic
  // space and a byte-order mark were the OPPOSITE case: JavaScript's
  // `\s` (splitWords, src/print/reflow.ts) matched them, so the
  // packer's own word split erased one of those as trailing
  // whitespace while the reader's ASCII-only rstrip kept it and read
  // the line as a paragraph - the one shape in the tree where a
  // paragraph printed a LIVE block anchor. splitWords is ASCII-only
  // now (Ruby's `\s`), so all five behave alike: outside both sets,
  // kept by both, the blank line stays and the tail survives.
  test.each([
    ["a NUL", String.fromCodePoint(0)],
    ["a no-break space", "\u00A0"],
    ["a thin space", "\u2009"],
    ["an ideographic space", "\u3000"],
    ["a byte-order mark", "\uFEFF"],
  ])("a trailing %s is content, and keeps the blank", async (_n, tail) => {
    const input = `[[3-bad]]${tail}\n----\nx\n----\n`;
    const output = await formatAdoc(input);
    expect(output).toBe(`[[3-bad]]${tail}\n\n----\nx\n----\n`);
    expect(await formatAdoc(output)).toBe(output);
    expect(await renderedHtml(output)).toBe(await renderedHtml(input));
  });

  // The VALID-id shape, which is the one issue #75 actually changed:
  // at main, `[[anc]]` (a perfectly valid id) plus a no-break space
  // formatted to a LIVE anchor line (`[[anc]]\n----\nx\n----\n`, tail
  // dropped, blank line lost, and the render changed to a listing
  // block with id="anc"). Pinned separately from the `[[3-bad]]` rows
  // above because THIS is the id the bug used to reach.
  test("a no-break space after a VALID id is content, and keeps the blank", async () => {
    const input = "[[anc]]\u00A0\n----\nx\n----\n";
    const output = await formatAdoc(input);
    expect(output).toBe("[[anc]]\u00A0\n\n----\nx\n----\n");
    expect(await formatAdoc(output)).toBe(output);
    expect(await renderedHtml(output)).toBe(await renderedHtml(input));
  });

  // The `blockAnchor` node's own arm, after it was made to ask the
  // grammar the way the paragraph arm does. `[[ok]]` plus two spaces
  // parses to a blockAnchor whose id is `ok]]` - issue #69, where the
  // builder slices the RAW line - so the printed line is `[[ok]]]]`,
  // which is TEXT on re-read and which the record now calls a
  // lookalike instead of asserting an anchor about.
  //
  // What that did NOT do is settle the bytes: every consumer of the
  // record reaches a blockAnchor node through `isBlockMetadata` first,
  // which answers on the node KIND and short-circuits, so pass 1 is
  // unchanged and still not the fixed point. Measured and pinned as
  // it stands, with no render check: both faults are #69's, and this
  // row is what will fail when #69 lands and force it to be rewritten.
  test("issue #69's corrupted anchor is a lookalike, and still wobbles", async () => {
    const input = "[[ok]]  \n----\nx\n----\n";
    const pass1 = await formatAdoc(input);
    expect(pass1).toBe("[[ok]]]]\n----\nx\n----\n");
    const pass2 = await formatAdoc(pass1);
    expect(pass2).toBe("[[ok]]]]\n\n----\nx\n----\n");
    expect(await formatAdoc(pass2)).toBe(pass2);
  });
});

// ONE spacing rule for every bracket interior Asciidoctor hands to
// `AttributeList`: no blank around a comma, none at the edges. Those
// blanks are what `skip_blank` and `BoundaryRx[',']`
// (attribute_list.rb l.30-34, l.200-202) throw away before the
// document ever sees them. Blanks INSIDE an attribute stay, and so
// does everything between a value's quotes.
describe("an attrlist interior gets one spacing", () => {
  test.each([
    [
      "a block attribute list",
      "[source, ruby]\n----\nx\n----\n",
      "[source,ruby]\n----\nx\n----\n",
    ],
    [
      "an attribution list keeps the blanks inside its attributes",
      "[quote, Famous Person, A Book (2001)]\n____\nx\n____\n",
      "[quote,Famous Person,A Book (2001)]\n____\nx\n____\n",
    ],
    [
      "a quoted value keeps its comma and its blanks",
      '[quote, "A, B", c]\n____\nx\n____\n',
      '[quote,"A, B",c]\n____\nx\n____\n',
    ],
    [
      "named values with commas inside quotes",
      '[cols="1,2", options="header"]\n|===\n|a |b\n|===\n',
      '[cols="1,2",options="header"]\n|===\n|a |b\n|===\n',
    ],
    [
      "a trailing blank inside the brackets",
      "[source ]\n----\nx\n----\n",
      "[source]\n----\nx\n----\n",
    ],
    ["a block macro", "image::a.png[alt, 10]\n", "image::a.png[alt,10]\n"],
    [
      "a block macro with named attributes",
      "video::a.mp4[width=100, height=50]\n",
      "video::a.mp4[width=100,height=50]\n",
    ],
    [
      "an inline image",
      "x image:a.png[alt, 10] y\n",
      "x image:a.png[alt,10] y\n",
    ],
    // The fence's info string is an attrlist the printer SYNTHESIZES,
    // and it takes the same rule — otherwise pass two, reading it
    // back as a real attribute list, spelled it differently.
    [
      "a synthesized [source,lang] from a fence",
      "``` javascript, numbered\nx\n```\n",
      "[source,javascript,numbered]\n----\nx\n----\n",
    ],
    // DECLINED: an unclosed quote is replayed byte for byte, because
    // Ruby reads that quote as literal and the scan will not guess.
    [
      "an unclosed quote is left alone",
      '[quote, "A B, c]\n____\nx\n____\n',
      '[quote, "A B, c]\n____\nx\n____\n',
    ],
  ])("%s", async (_name, input, expected) => {
    const out = await formatAdoc(input);
    expect(out).toBe(expected);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  // The other inline macros put TEXT between the brackets, and text is
  // content: each of these renders the comma-space, so the rule does
  // not reach them. Measured against the oracle, one row each.
  test.each([
    ["link", "x link:http://e.com[Read, now] y\n"],
    // `icon:` IS an attribute list to Asciidoctor, but the tokenizer
    // does not know the name, so the text never becomes a macro node
    // and nothing rewrites it.
    ["icon", ":icons: font\n\nx icon:tags[role, red] y\n"],
    ["xref", "x xref:t[the, text] y\n\n[[t]]z\n"],
    ["pass", "x pass:[a, b] y\n"],
    ["footnote", "x footnote:[a, b] y\n"],
    [":experimental: kbd", ":experimental:\n\nx kbd:[Ctrl, T] y\n"],
    [":experimental: btn", ":experimental:\n\nx btn:[OK, now] y\n"],
  ])("%s keeps its bracket text verbatim", async (_name, input) => {
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
  });
});
