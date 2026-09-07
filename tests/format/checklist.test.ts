import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import {
  expectFormatted,
  expectStableRender,
  firstList,
  formatAdoc,
  narrow,
} from "../helpers.js";

describe("checklist formatting", () => {
  // Canonical checked marker passes through unchanged.
  test("checked item preserved", async () => {
    const input = "* [x] Done\n";
    await expectFormatted(input, input);
    // `[x]` is the canonical checked marker.
    const { children } = parse(input);
    const list = firstList(children);
    expect(list.children[0].checkbox).toBe("checked");
    const textNode = list.children[0].text.find((c) => c.type === "text");
    narrow(textNode, "text");
    expect(textNode.value).toBe("Done");
  });

  // Unchecked marker passes through unchanged.
  test("unchecked item preserved", async () => {
    const input = "* [ ] Not done\n";
    await expectFormatted(input, input);
    // `[ ]` (space inside brackets) means unchecked.
    const { children } = parse(input);
    const list = firstList(children);
    expect(list.children[0].checkbox).toBe("unchecked");
  });

  // `[*]` is normalized to `[x]` (both mean checked, `[x]` is
  // the canonical form).
  test("[*] normalized to [x]", async () => {
    const input = "* [*] Done\n";
    const expected = "* [x] Done\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Mixed checklist and normal items are all preserved.
  test("mixed checklist items preserved", async () => {
    const input = "* [x] Done\n* Normal\n* [ ] Todo\n";
    await expectFormatted(input, input);
    // A list can mix checklist and non-checklist items.
    const { children } = parse(input);
    const list = firstList(children);
    expect(list.children[0].checkbox).toBe("checked");
    expect(list.children[1].checkbox).toBeUndefined();
    expect(list.children[2].checkbox).toBe("unchecked");
  });

  // Nested checklists preserved with correct markers.
  test("nested checklist preserved", async () => {
    const input = "* [x] Parent\n** [ ] Child\n";
    await expectFormatted(input, input);
    // Checklist markers work at any nesting depth.
    const { children } = parse(input);
    const list = firstList(children);
    expect(list.children[0].checkbox).toBe("checked");
    const nested = list.children[0].blocks.find(
      ({ block }) => block.type === "list",
    )?.block;
    narrow(nested, "list");
    expect(nested.children[0].checkbox).toBe("unchecked");
  });

  // A checklist after a paragraph has one blank line separator.
  test("checklist after paragraph", async () => {
    const input = "Some text.\n\n* [x] Done\n";
    await expectFormatted(input, input);
  });

  // Long checklist item text is reflowed like regular list items.
  test("long checklist item reflowed", async () => {
    const input =
      "* [x] This is a very long checklist item that should be reflowed because it exceeds the default print width of eighty characters total\n";
    const result = await formatAdoc(input);
    const lines = result.split("\n");
    expect(lines[0].startsWith("* [x] ")).toBe(true);
    expect(lines.length).toBeGreaterThan(2);
  });

  // Ordered list items with `[x]` in the text are not treated
  // as checklists — the text is preserved verbatim.
  test("ordered list [x] is not treated as checkbox", async () => {
    const input = ". [x] Not a checkbox\n";
    await expectFormatted(input, input);
    // AsciiDoc checklists only apply to unordered list items.
    // Ordered list items with `[x]` in the text are not checklists.
    const { children } = parse(input);
    const list = firstList(children);
    expect(list.children[0].checkbox).toBeUndefined();
  });

  // ONE printed space after the checkbox, whatever the item's text
  // opens with. A text that starts with an inline construct rather than
  // a word gives the item an empty leading text node
  // (`[text "", inlineAnchor, text " a"]`), and an empty text node is
  // whitespace the checkbox prefix already carries — it contributes no
  // second space of its own. A doubled space is NOT read the same:
  // Asciidoctor keeps it in the rendered HTML, so the single space is
  // the spelling that renders like the input, and the render assert
  // below proves it.
  // The plain-text control rows are at the top of this file.
  test.each([
    ["a formatting span", "* [x] *b* c\n"],
    ["an inline anchor", "* [ ] [[anc]] a\n"],
    ["an attribute reference", "** [ ] {attr}\n"],
  ])(
    "one space after the checkbox when the text opens with %s",
    async (_name, input) => {
      await expectFormatted(input, input);
    },
  );

  // A marker is a checkbox only when the item's FIRST LINE carries
  // something after it. Asciidoctor tests the prefix against that one
  // line (`item_text` is group 2 of the marker row,
  // parser.rb l.1316, and the test is
  // `item_text.start_with?('[ ] ', '[x] ', '[*] ')`,
  // parser.rb l.1330), and the reader has already taken that line's
  // trailing whitespace off (`prepare_lines`, reader.rb l.582), so
  // `* [*] ` is the literal text `[*]`
  // and text that only arrives on a continuation line arrives too
  // late. Before the first line was read this way, `* [*] ` formatted
  // to `* [x]`, respelling literal text as a checkbox glyph.
  test.each([
    ["a checked marker alone on its line", "* [*] \n"],
    ["an x marker alone on its line", "* [x] \n"],
    ["an unchecked marker alone on its line", "* [ ] \n"],
    ["a marker followed only by more spaces", "* [*]   \n"],
    ["a marker followed only by a tab", "* [*] \t\n"],
  ])("no checkbox for %s", async (_name, input) => {
    await expectStableRender(input);
  });

  // The literal bytes matter for the checked spelling: `[*]` is only
  // respelled `[x]` where it really is a checkbox, so a `[*]` the
  // oracle reads as text must survive verbatim.
  test("a marker the oracle reads as text keeps its spelling", async () => {
    expect(await formatAdoc("* [*] \n")).toBe("* [*]\n");
  });

  // The fourth character of each prefix is a literal SPACE, so a
  // bracket the source separated from its text by anything else is
  // TEXT to the oracle and the run that separates them is syntax.
  // Red before the tab row (issue #140): every row here formatted its
  // run to one space and the output rendered a checkbox glyph where
  // the input rendered the bracket - `* [x]<TAB>a` came out
  // `* [x] a`. A run holding a TAB keeps its bytes now (`factOfRun`,
  // src/whitespace-fact.ts, which reads the run alone and asks nothing
  // about the head), so the bytes, the render and a second format all
  // hold.
  test.each([
    ["a tab after the bracket", "* [x]\ta\n"],
    ["a tab after an unchecked bracket", "* [ ]\ta\n"],
    ["a tab after the `[*]` spelling", "* [*]\ta\n"],
    ["a tab and then a space", "* [x]\t a\n"],
    // The unchecked bracket's own space splits it in two, so the run
    // INSIDE it is the one that decides the spelling here.
    ["a tab inside the bracket", "* [\t] a\n"],
    ["two tabs after the bracket", "* [ ]\t\ta\n"],
    ["more text after the first word", "* [ ]\ta b\n"],
    ["a nested item", "** [x]\ta\n"],
    ["the other unordered marker", "- [x]\ta\n"],
    // Two rows where nothing reads a checklist prefix at all: an
    // ordered item (`parse_list_item` asks only of a ulist) and a
    // paragraph. The run keeps its bytes there too, because the
    // splitter has no block to ask about - which costs the author's
    // own bytes and no meaning.
    ["an ordered item, which has no checkbox", ". [x]\ta\n"],
    ["a paragraph, which has no checkbox", "[x]\ta\n"],
  ])("the run keeps its bytes with %s", async (_name, input) => {
    await expectFormatted(input, input);
  });

  // NOT PROTECTED BY DESIGN: a run at the head of an item's text that
  // is neither a tab nor a single space. A rule of its own used to
  // hold such a run's bytes so the fold could not spell a prefix the
  // source had not written. What is left once the tab row and the
  // marker-line guard have taken their share is a run of two or more
  // SPACES inside an unchecked bracket, and the two control
  // characters: no editor and no export from Word, Markdown, HTML or
  // a wiki writes a U+000B or a U+000C into a text file.
  //
  // The spaces row is render-equal, and the marker-line guard is why:
  // the fold writes `[ ]` alone on the marker line, where the four
  // character prefix has no trailing space to match, so the re-read
  // finds no checkbox and the text folds back in. Only the author's
  // bytes move.
  test("a wider bracket than the prefix spells loses its width", async () => {
    await expectFormatted("* [  ] a\n", "* [ ]\n  a\n");
  });

  // The control characters DO cost the render, which is what makes
  // this a characterization row and not a pin. What is lost is the
  // RUN's own bytes and not the reading: the marker-line guard holds
  // the break here as it does for the spaces row above, so `[x]` ends
  // up alone on the marker line, the four-character prefix has no
  // trailing space to match, and NEITHER program reads the output as
  // a checkbox. Measured on `* [x]<VT>more text`, whose output is
  // `* [x]` over an indented `more text`: `@asciidoctor/core` 4.0.11
  // renders `<p>[x]more text</p>` for the input and
  // `<p>[x] more text</p>` for the output, folding the control
  // character to a space, and Ruby 2.0.26 renders
  // `<p>[x]more text</p>` and `<p>[x]\nmore text</p>`, keeping the
  // line break. Both agree the item is not a checkbox on either side.
  // Nobody writes the input: no editor and no export from Word,
  // Markdown, HTML or a wiki puts a U+000B or a U+000C in a text
  // file.
  test.each([
    ["a vertical tab", "\u000B"],
    ["a form feed", "\u000C"],
  ])("%s after the bracket folds to a space", async (_name, control) => {
    expect(await formatAdoc(`* [x]${control}more text\n`)).toBe(
      "* [x]\n  more text\n",
    );
  });

  // A tab elsewhere in an item's text is kept as well, but by a
  // different rule: the whitespace record's tab row
  // (`factOfRun`, src/whitespace-fact.ts) reads the run alone and
  // asks nothing about the head. What the checklist rule adds is the
  // rows above, where the run is a SPACE and only the prefix reads
  // it. Red before the tab row, this formatted to `* a b`.
  test("a tab elsewhere in the item text is kept by the record", async () => {
    await expectFormatted("* a\tb\n", "* a\tb\n");
  });

  // The one run the fold refusal cannot keep is a LINE BREAK: an atom
  // is newline-free by construction, so there is nothing to keep the
  // break inside. The printer holds it instead
  // ({@link markerLineGuard}), and the marker line comes back carrying
  // the bracket alone, exactly as the source wrote it. The
  // continuation line takes the item's own indent, which the reader
  // folds back into the item's text.
  //
  // Red before that break (issue #139): every row here packed its
  // second line onto the marker line and formatted to `* [x] more`, a
  // checkbox glyph rendered where the input renders the bracket. 420
  // of the 1,225 shapes in the continuation-line grid this issue was
  // found on failed that way.
  test.each([
    ["a bracket alone on the marker line", "* [x]\nmore\n", "* [x]\n  more\n"],
    ["a trailing space after it", "* [x] \nmore\n", "* [x]\n  more\n"],
    ["an unchecked bracket", "* [ ]\nmore\n", "* [ ]\n  more\n"],
    ["an unchecked bracket and a space", "* [ ] \nmore\n", "* [ ]\n  more\n"],
    // The `[*]` spelling is only respelled `[x]` where it really is a
    // checkbox, so this row is the byte claim as well as the break one.
    ["the `[*]` spelling", "* [*] \nmore\n", "* [*]\n  more\n"],
    ["an indented continuation", "* [x]\n more\n", "* [x]\n  more\n"],
    [
      "several words below",
      "* [x]\nmore and more\n",
      "* [x]\n  more and more\n",
    ],
    ["a nested item", "** [ ] \nmore\n", "** [ ]\n   more\n"],
    ["the other unordered marker", "- [x]\nmore\n", "- [x]\n  more\n"],
  ])("the marker line keeps the break with %s", async (_name, input, want) => {
    await expectFormatted(input, want);
  });

  // The narrowness of the held break, one row per reason the marker
  // line spells no prefix: an ordered item reads no checkbox at all
  // (`parse_list_item` asks only of a ulist), and an item that DOES
  // carry one already spelled it on its own first line. Both keep
  // packing their continuation line up, which is what reflow is for.
  test.each([
    ["an ordered item", ". [x]\nmore\n", ". [x] more\n"],
    [
      "an item that really is a checklist item",
      "* [x] a\nmore\n",
      "* [x] a more\n",
    ],
  ])("the continuation still packs up for %s", async (_name, input, want) => {
    await expectFormatted(input, want);
  });

  // Where the line under the bracket already keeps a line of its own
  // there is nothing to hold, and the marker line already ends at the
  // bracket: a `//` comment and a `[role]` line are raw lines the
  // printer replays at column 0. These are the shapes that reach the
  // held break's "a break already stands there" arm.
  test.each([
    ["a line comment under the bracket", "* [x]\n// c\nmore\n"],
    ["a block attribute line under it", "* [x]\n[role]\nmore\n"],
  ])("nothing is held for %s", async (_name, input) => {
    await expectFormatted(input, input);
  });

  // A REFUSAL, recorded rather than hidden, in the one shape that
  // reaches it: BLOCK SYNTAX under the bracket. Reflow has already
  // fused the word backwards because it would open a block at the
  // start of a line (a section title, an admonition label, a bracketed
  // attribute line), and a break demanded in front of a fused atom is
  // lifted to the front of its whole run - in front of the bracket,
  // which spells the same marker line again.
  //
  // Every row is the bytes the base tree wrote, so nothing here is a
  // regression, and every row is a fixed point: where the packed line
  // is going to read as a CHECKED item, the head is written the way
  // that reading is written back, which is why the `[*]` rows come out
  // `[x]`. Before the head was canonicalised, `* [*] ` over `== h`
  // printed `* [*] == h` and the NEXT format moved it to `* [x] == h`.
  //
  // The rows assert bytes and idempotence only: these documents still
  // render a checkbox their input does not, and saying so out loud is
  // what makes the refusal visible instead of silent. Widening the
  // hold to clear the fusion is a separate question: the item's
  // continuation indent is stripped back off by `adjust_indentation!`
  // (parser.rb l.753-755), so an admonition label held one line down
  // can still arrive at column 0.
  test.each([
    ["a section title under the bracket", "* [x]\n== h\n", "* [x] == h\n"],
    ["an admonition label under it", "* [x]\nNOTE: a\n", "* [x] NOTE: a\n"],
    ["a bracketed line under it", "* [x]\n[x] b\n", "* [x] [x] b\n"],
    ["a section title under `[*]`", "* [*] \n== h\n", "* [x] == h\n"],
    ["a label under `[*]`", "* [*] \nNOTE: a\n", "* [x] NOTE: a\n"],
    ["a bracketed line under `[*]`", "* [*] \n[x] b\n", "* [x] [x] b\n"],
    ["`[*]` with no trailing space", "* [*]\n== h\n", "* [x] == h\n"],
  ])("the marker line keeps its packing for %s", async (_name, input, want) => {
    // Bytes and the fixed point, no render-equality: packing the word
    // onto the marker line is what MAKES the item a checkbox, so the
    // output renders a checklist where the two-line input renders a
    // plain list. That difference is the refusal these rows record,
    // and expectFormatted would assert it away.
    const out = await formatAdoc(input);
    expect(out).toBe(want);
    // eslint-disable-next-line test-assertions/no-hand-spelled-format-trailer -- the row's subject is a render the formatter deliberately changes
    expect(await formatAdoc(out)).toBe(out);
  });

  // A DESCRIPTION-LIST separator on the item's own first line. Ruby's
  // checkbox prefix is `item_text.start_with?('[ ] ', '[x] ', '[*] ')`
  // (parser.rb l.1330), a literal SPACE, so no run here spells one and
  // no output may write one. Two things keep the bytes: a run the
  // whitespace record calls syntax rides inside the word, and where it
  // does not (a form feed, a vertical tab) the words arrive apart and
  // the break is HELD in front of the separator - which puts the block
  // on its own source lines rather than on a line of its own, because
  // the item is one line and the hold has nothing to pack.
  //
  // Red before both: every row folded its run to the prefix space and
  // rendered a checked box the input does not.
  //
  // Byte-faithful and render-equal, unlike the refusal group above,
  // so these rows take the three-way helper.
  test.each([
    ["a separator on the marker line", "* [x]\ta:: b\n"],
    ["an unchecked bracket before one", "* [ ]\ta:: b\n"],
    ["`[*]` before one", "* [*]\ta:: b\n"],
    ["the `;;` separator", "* [x]\ta;; b\n"],
    ["the `:::` separator", "* [x]\ta::: b\n"],
    ["the `::::` separator", "* [x]\ta:::: b\n"],
    ["a bare separator word", "* [x]\t:: b\n"],
    ["a separator ending the line", "* [x]\ta::\n"],
    ["a term-shaped word", "* [x]\tterm:: def\n"],
    ["a nested item", "** [ ]\t\ta:: b\n"],
    ["the other unordered marker", "- [x]\t a:: b\n"],
    ["a form feed before one", "* [x]\fa:: b\n"],
    ["a vertical tab before one", "* [x]\va:: b\n"],
  ])("the run in front of %s keeps its bytes", async (_name, input) => {
    await expectFormatted(input, input);
  });

  // The run rides where the source wrote it and the words behind it
  // still reflow: only the run's own bytes are held, not the line.
  test("a definition past the print width still wraps behind the run", async () => {
    await expectFormatted(
      "* [x]\tterm:: a very long definition that will certainly go past the eighty column print width\n",
      "* [x]\tterm:: a very long definition that will certainly go past the eighty column\n  print width\n",
    );
  });

  // The separator refusal above is about a word on the item's own
  // first line. A separator the SOURCE already put on a line of its
  // own is a different case and needs no refusal: reflow's dlist guard
  // has marked it with a break of its own, so the marker line already
  // ends at the bracket and nothing is manufactured in either
  // direction. Byte-faithful and render-equal, unlike every row above.
  test.each([
    ["a separator alone under the bracket", "* [x]\na:: b\n"],
    ["a separator later on that line", "* [x]\nb a:: c\n"],
  ])("nothing is manufactured for %s", async (_name, input) => {
    await expectFormatted(input, input);
  });

  // A DIVERGENCE the printer accepts, recorded here as a row because
  // the source comment cannot show it costs nothing. Ruby takes the
  // bibliography arm before the checkbox test (parser.rb l.1321-1323),
  // so a `[bibliography]` list reads no checkbox and needs no held
  // break; the reader records no list style for the printer to ask
  // about, so the break is held anyway. What that costs is bytes
  // frozen: the render is unchanged and the document is a fixed point.
  test("a bibliography list holds a break it does not need", async () => {
    const input = "[bibliography]\n* [x]\nmore\n";
    await expectFormatted(input, "[bibliography]\n* [x]\n  more\n");
  });

  // The checked marker's own `*` is a bold delimiter too, so where a
  // second `*` stands later on the line the tokenizer pairs them and
  // the item's leading text node holds only `[`. There is no
  // four-character prefix to take off that node, so the item carries
  // no checkbox and keeps every byte the author wrote. The oracle
  // does read a checked item there, so this is a divergence, and the
  // rows below prove it costs nothing: the bytes replay, and the
  // replayed bytes read back as the same document.
  test.each([
    ["the text is one span", "* [*] *b*\n"],
    ["a span follows a word", "* [*] a *b*\n"],
  ])("the marker keeps its bytes when %s", async (_name, input) => {
    await expectFormatted(input, input);
  });

  // Continuation lines of a checklist item should align under
  // the text content, not under the checkbox bracket. The full
  // prefix is "* [x] " = 6 characters, so continuations need
  // a 6-space indent.
  test("checklist continuation aligns under text, not checkbox", async () => {
    const input =
      "* [x] This is a very long checklist item that definitely needs to be reflowed to multiple lines for proper formatting\n";
    const result = await formatAdoc(input, { printWidth: 40 });
    const lines = result.trimEnd().split("\n");
    // First line starts with "* [x] "
    expect(lines[0]).toMatch(/^\* \[x\] /v);
    // Continuation lines: 6-space indent ("* " + "[x] " = 6)
    for (const continuation of lines.slice(1)) {
      expect(continuation).toMatch(/^ {6}\S/v);
    }
  });
});
