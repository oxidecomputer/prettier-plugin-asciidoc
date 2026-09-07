/**
 * Format tests for admonition blocks.
 *
 * Tests both paragraph-form (`NOTE: text`) and block-form
 * (`[NOTE]\n====\n...\n====`) admonitions. Paragraph-form
 * admonitions reflow text to printWidth with hanging indent.
 * Block-form admonitions preserve their delimiter structure.
 */
import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import {
  admonitionAt,
  expectFormatted,
  expectStableRender,
  formatAdoc,
  renderedHtml,
} from "../helpers.js";
import { astShape } from "../parser/reader-helpers.js";

describe("paragraph-form admonition formatting", () => {
  // An admonition's content is reflowed like a paragraph, so it
  // needs the same dlist guard: joining these two lines would put
  // `term::` on the block's first line and Asciidoctor would render
  // a description list instead of the admonition.
  test("keeps a `::` word off the first line", async () => {
    const input = "NOTE: a line\nterm:: x\n";
    await expectStableRender(input);
  });

  test("NOTE: text round-trips", async () => {
    const input = "NOTE: This is a note.\n";
    await expectFormatted(input, input);
    const { children } = parse(input);
    expect(children).toHaveLength(1);
    const node = admonitionAt(children, 0);
    expect(node.variant).toBe("note");
    expect(node.form).toBe("paragraph");
    expect(node.text).toMatchObject([
      { type: "text", value: "This is a note." },
    ]);
    expect(node.children).toHaveLength(0);
  });

  test("TIP: text round-trips", async () => {
    const input = "TIP: Here is a tip.\n";
    await expectFormatted(input, input);
    const { children } = parse(input);
    const node = admonitionAt(children, 0);
    expect(node.variant).toBe("tip");
    expect(node.form).toBe("paragraph");
    expect(node.text).toMatchObject([
      { type: "text", value: "Here is a tip." },
    ]);
  });

  test("IMPORTANT: text round-trips", async () => {
    const input = "IMPORTANT: Do not forget.\n";
    await expectFormatted(input, input);
    const { children } = parse(input);
    const node = admonitionAt(children, 0);
    expect(node.variant).toBe("important");
    expect(node.form).toBe("paragraph");
    expect(node.text).toMatchObject([
      { type: "text", value: "Do not forget." },
    ]);
  });

  test("CAUTION: text round-trips", async () => {
    const input = "CAUTION: Watch out.\n";
    await expectFormatted(input, input);
    const { children } = parse(input);
    const node = admonitionAt(children, 0);
    expect(node.variant).toBe("caution");
    expect(node.form).toBe("paragraph");
    expect(node.text).toMatchObject([{ type: "text", value: "Watch out." }]);
  });

  test("WARNING: text round-trips", async () => {
    const input = "WARNING: Be careful.\n";
    await expectFormatted(input, input);
    const { children } = parse(input);
    const node = admonitionAt(children, 0);
    expect(node.variant).toBe("warning");
    expect(node.form).toBe("paragraph");
    expect(node.text).toMatchObject([{ type: "text", value: "Be careful." }]);
  });

  test("long text reflows to printWidth", async () => {
    const input =
      "NOTE: This is a very long note that should be reflowed when it exceeds the print width boundary.\n";
    const expected =
      "NOTE: This is a very long note that should be reflowed when it exceeds the print\nwidth boundary.\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  test("continuation lines start at column 0", async () => {
    // Leading spaces in AsciiDoc denote an indented literal
    // block, so continuation lines must start at column 0.
    const input =
      "WARNING: First word second word third word fourth word fifth word sixth word.\n";
    const result = await formatAdoc(input, { printWidth: 40 });
    const lines = result.trimEnd().split("\n");
    expect(lines.length).toBeGreaterThan(1);
    for (const continuationLine of lines.slice(1)) {
      expect(continuationLine).toMatch(/^\S/v);
    }
  });

  test("multi-line paragraph-form text is reflowed", async () => {
    const input = "NOTE: First line\nsecond line\nthird line\n";
    const expected = "NOTE: First line second line third line\n";
    expect(await formatAdoc(input)).toBe(expected);
    // Continuation lines (no blank line between them) are one text
    // child whose value keeps the \n separators — the same inline
    // children a regular paragraph gets.
    const { children } = parse(input);
    expect(children).toHaveLength(1);
    const node = admonitionAt(children, 0);
    expect(node.variant).toBe("note");
    expect(node.text).toMatchObject([
      { type: "text", value: "First line\nsecond line\nthird line" },
    ]);
  });

  // An admonition's content is read by read_paragraph_lines like any
  // paragraph, so a `.word` on a later line is TEXT there too — the
  // block-title shape only means anything on a block's first line.
  // Reflow may therefore wrap in front of it, and the rendering must
  // not move when it does.
  test("admonition reflow may wrap before a .word", async () => {
    const input = "NOTE: aaa bbb .title\n";
    const options = { printWidth: 16 };
    await expectFormatted(input, "NOTE: aaa bbb\n.title\n", options);
  });
});

describe("block-form admonition formatting (example block)", () => {
  test("[NOTE] + example block round-trips", async () => {
    const input = "[NOTE]\n====\nContent.\n====\n";
    await expectFormatted(input, input);
    const { children } = parse(input);
    expect(children).toHaveLength(2);
    expect(children[0].type).toBe("blockAttributeList");
    const node = admonitionAt(children, 1);
    expect(node.variant).toBe("note");
    expect(node.form).toBe("example");
    expect(node.text).toEqual([]);
    expect(node.children.length).toBeGreaterThan(0);
  });

  test("[TIP] + example block round-trips", async () => {
    const input = "[TIP]\n====\nA tip.\n====\n";
    await expectFormatted(input, input);
    const { children } = parse(input);
    expect(children).toHaveLength(2);
    const node = admonitionAt(children, 1);
    expect(node.variant).toBe("tip");
    expect(node.form).toBe("example");
  });

  test("[IMPORTANT] + example block round-trips", async () => {
    const input = "[IMPORTANT]\n====\nDo not forget.\n====\n";
    await expectFormatted(input, input);
    const { children } = parse(input);
    const node = admonitionAt(children, 1);
    expect(node.variant).toBe("important");
  });

  test("[CAUTION] + example block round-trips", async () => {
    const input = "[CAUTION]\n====\nWatch out.\n====\n";
    await expectFormatted(input, input);
    const { children } = parse(input);
    const node = admonitionAt(children, 1);
    expect(node.variant).toBe("caution");
  });

  test("[WARNING] + example block round-trips", async () => {
    const input = "[WARNING]\n====\nBe careful.\n====\n";
    await expectFormatted(input, input);
    const { children } = parse(input);
    const node = admonitionAt(children, 1);
    expect(node.variant).toBe("warning");
  });

  test("block-form with multiple paragraphs round-trips", async () => {
    const input = "[NOTE]\n====\nFirst paragraph.\n\nSecond paragraph.\n====\n";
    await expectFormatted(input, input);
    const { children } = parse(input);
    expect(children).toHaveLength(2);
    const node = admonitionAt(children, 1);
    expect(node.variant).toBe("note");
    expect(node.children).toHaveLength(2);
    expect(node.children[0].type).toBe("paragraph");
    expect(node.children[1].type).toBe("paragraph");
  });
});

describe("block-form admonition formatting (open block)", () => {
  test("[CAUTION] + open block round-trips", async () => {
    const input = "[CAUTION]\n--\nContent.\n--\n";
    await expectFormatted(input, input);
    const { children } = parse(input);
    expect(children).toHaveLength(2);
    expect(children[0].type).toBe("blockAttributeList");
    const node = admonitionAt(children, 1);
    expect(node.variant).toBe("caution");
    expect(node.form).toBe("open");
  });

  test("[NOTE] + open block round-trips", async () => {
    const input = "[NOTE]\n--\nA note in an open block.\n--\n";
    await expectFormatted(input, input);
  });

  test("open block with multiple paragraphs round-trips", async () => {
    const input = "[WARNING]\n--\nFirst.\n\nSecond.\n--\n";
    await expectFormatted(input, input);
  });
});

describe("admonition formatting in context", () => {
  test("paragraph-form admonition between paragraphs", async () => {
    const input = "Before.\n\nNOTE: A note.\n\nAfter.\n";
    await expectFormatted(input, input);
    const { children } = parse(input);
    expect(children).toHaveLength(3);
    expect(children[0].type).toBe("paragraph");
    expect(children[1].type).toBe("admonition");
    expect(children[2].type).toBe("paragraph");
  });

  test("block-form admonition between paragraphs", async () => {
    const input = "Before.\n\n[NOTE]\n====\nA note.\n====\n\nAfter.\n";
    await expectFormatted(input, input);
  });

  test("block title + block-form admonition stacks", async () => {
    const input = ".My Note\n[NOTE]\n====\nContent.\n====\n";
    await expectFormatted(input, input);
  });

  test("anchor + block-form admonition", async () => {
    const input = "[[my-note]]\n[TIP]\n====\nContent.\n====\n";
    await expectFormatted(input, input);
  });

  // Block title stacks with paragraph-form admonition.
  test("block title + paragraph-form admonition", async () => {
    const input = ".My Note\nNOTE: This is a note.\n";
    await expectFormatted(input, input);
  });

  // A block anchor gets blank-line separation from a paragraph-form
  // admonition: stacked, the label line would be absorbed into the
  // anchor's paragraph on re-parse (wouldMergeWithAnchor).
  test("anchor + paragraph-form admonition", async () => {
    const input = "[[my-note]]\nNOTE: This is a note.\n";
    const expected = "[[my-note]]\n\nNOTE: This is a note.\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Custom admonition type round-trips.
  test("custom admonition [EXERCISE] round-trips", async () => {
    const input = "[EXERCISE]\n====\nDo this exercise.\n====\n";
    await expectFormatted(input, input);
  });

  // Regression: a delimited admonition wrapping a same-variant
  // parent block must use a longer delimiter to preserve nesting.
  // Without this, both delimiters normalize to `****`, collapsing
  // the nesting on re-parse.
  test("admonition delimiter longer than nested same-variant block", async () => {
    const input = "[M]\n\n******\n****\n//////\n///////\n//////";
    // The 7-slash line is CONTENT of the 6-slash comment block, not a
    // delimiter: `read_lines_until terminator:` matches whole lines
    // against the opening delimiter, so only `//////` closes it. The
    // comment block normalises to `////`, which its content cannot
    // close either.
    await expectFormatted(
      input,
      "[M]\n*****\n****\n////\n///////\n////\n****\n*****\n",
    );
  });
});

// An admonition body is one reflowable string, but a comment or
// preprocessor line inside it is not text: Asciidoctor drops a
// comment and CONSUMES a directive while reading. Deleting them
// (which the first version of the paragraph lexer mode did) loses
// the author's bytes and — for a conditional — renders guarded text
// unconditionally. The printer keeps each on its own line at column
// 0 and reflows the runs around it.
describe("raw lines inside a paragraph-form admonition", () => {
  const cases: Array<[string, string]> = [
    ["a comment line", "NOTE: a\n// c\nb\n"],
    [
      "a conditional directive",
      "NOTE: a\nifdef::flag[]\nhidden\nendif::[]\nb\n",
    ],
    ["an include directive", "NOTE: a\ninclude::nope.adoc[]\nb\n"],
  ];
  for (const [name, input] of cases) {
    test(`${name} survives verbatim`, async () => {
      await expectFormatted(input, input);
    });
  }

  test("text on both sides of a raw line still reflows", async () => {
    const words = "word ".repeat(20);
    const input = `NOTE: ${words}\n// c\n${words}\n`;
    const out = await formatAdoc(input);
    // The comment owns a line of its own, at column 0, with
    // reflowed text above and below it.
    const lines = out.split("\n");
    expect(lines).toContain("// c");
    expect(lines.filter((l) => l.length > 0).length).toBeGreaterThan(3);
    await expectStableRender(input);
  });
});

// Pinned BEFORE the admonition printer rewrite: the
// BASELINE render-broke both shapes (it
// invented a blank line and pulled the [NOTE] line out of the
// listing), while the current tree reads `foo\n[NOTE]\nbar` as ONE
// three-line listing — byte-faithful, idempotent and oracle-matching.
// That rewrite is adjacent to this territory, so
// the tree, the bytes, render-equality and idempotence are pinned
// here first and must stay green through it.
describe("a [source] paragraph keeps a [NOTE] line as content", () => {
  test.each([
    [
      "inside an example block",
      "====\n[source]\nfoo\n[NOTE]\nbar\n====\n",
      "example(attrs listing[3])",
    ],
    [
      "inside a section",
      "== S\n\n[source]\nfoo\n[NOTE]\nbar\n",
      "h1 attrs listing[3]",
    ],
  ])("%s stays one nested listing", async (_name, input, shape) => {
    expect(astShape(input)).toBe(shape);
    await expectFormatted(input, input);
  });
});

describe("the admonition body rides the paragraph engine", () => {
  test("a body reflows exactly as a paragraph body does", async () => {
    const input = `NOTE: ${"word ".repeat(30)}end\n`;
    await expectStableRender(input);
  });

  test("the dlist first-line guard has one home and still holds", async () => {
    const input = "NOTE: a line\nterm:: x\n";
    // The `term::` word must not land at the start of an output line.
    await expectStableRender(input);
  });

  test("raw lines keep their own output lines through the shared engine", async () => {
    const input = "NOTE: alpha\nifdef::x[]\nbeta\n";
    await expectFormatted(input, input);
    const [node] = parse(input).children;
    if (node.type !== "admonition") {
      throw new Error(`got ${node.type}`);
    }
    expect(node.text.some((child) => child.type === "rawLine")).toBe(true);
  });
});

// The hard-line-break body classes the engine swap repaired (the
// admonition body moved onto the shared block-body engine): the
// string engine word-split ` +`, so it joined a label-line break away
// (`NOTE: alpha + beta`), dropped a mid-body break's `+` to column 0
// (a list-continuation line), and rewrote a trailing break to
// `{plus}` — all three render-corrupting at the baseline. The shared
// inline engine prints the break as the atom it is; these rows turn
// that accidental repair into a guarded one (F1).
describe("hard line breaks in a paragraph-form admonition body", () => {
  test.each([
    ["on the label line", "NOTE: alpha +\nbeta\n"],
    ["mid-body", "NOTE: one two three alpha +\nbeta four five six\n"],
    ["trailing", "NOTE: alpha beta +\n"],
  ])("a %s ` +` survives verbatim", async (_name, input) => {
    await expectFormatted(input, input);
  });
});

// Issue #45. `AdmonitionParagraphRx` separates the label from the
// text with `[ \t]+` - one blank or many - and the label span the
// reader hands the builder is that whole prefix. Cutting a fixed two
// characters off its end left every surplus blank in the variant, and
// the printer then wrote a colon after it: `NOTE:    text` came back
// as `NOTE:  : text`, whose second colon run re-reads as a
// description-list term on the next pass. The variant is now cut at
// the colon, so the label carries exactly one colon run whatever the
// source spelled.
describe("an admonition label keeps exactly one colon run", () => {
  test.each([
    ["four spaces", "NOTE:    text\n"],
    ["a tab", "WARNING:\ttext\n"],
    ["one space, the ordinary spelling", "TIP: text\n"],
  ])("%s", async (_name, input) => {
    const out = await formatAdoc(input);
    expect(out.split(":").length - 1).toBe(1);
    await expectStableRender(input);
  });
});

// `[NOTE]` over a paragraph and `NOTE: ` in front of it are the same
// admonition to Asciidoctor (ADMONITION_STYLES, parser.rb:730), so
// which one the author typed is a spelling and the printer writes one
// of them. RED before the reader folded the style line into the node
// (buildParagraphNode, src/parse/build/paragraph.ts): the style
// spelling came back as an attribute line over a plain paragraph, and
// the two spellings of one admonition formatted to different bytes.
describe("a bare admonition style over a paragraph is the label form", () => {
  test.each(["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"])(
    "[%s] over prose formats to the label",
    async (label) => {
      const styled = `[${label}]\ntext here\n`;
      const labelled = `${label}: text here\n`;
      expect(await formatAdoc(styled)).toBe(labelled);
      await expectFormatted(labelled, labelled);
      // The two SPELLINGS of one admonition, not an output against its
      // own input: neither helper compares two documents.
      // eslint-disable-next-line test-assertions/no-hand-spelled-format-trailer -- two documents, not a format row's own input and output
      expect(await renderedHtml(styled)).toBe(await renderedHtml(labelled));
    },
  );

  // The blank between the style line and its paragraph is not a
  // boundary: Asciidoctor's metadata loop skips blank lines and goes
  // on collecting (parser.rb:2018), so this is the same admonition.
  test("a blank line under the style line changes nothing", async () => {
    expect(await formatAdoc("[NOTE]\n\ntext here\n")).toBe("NOTE: text here\n");
  });

  // The narrowness, from the other side. Each of these keeps the
  // author's bytes because folding it would change what renders: a
  // style Ruby does not count as an admonition, a style carrying more
  // than its own name, a second attribute line whose values would be
  // left standing over a released label, and a style line whose block
  // is not a paragraph at all.
  test.each([
    "[note]\ntext here\n",
    "[Note]\ntext here\n",
    "[NOTE,role=x]\ntext here\n",
    "[NOTE#id]\ntext here\n",
    "[source]\n[NOTE]\ntext here\n",
    "[NOTE]\n// c\ntext here\n",
    "[NOTE]\n* item\n",
    "[NOTE]\n.a title\ntext here\n",
    "[NOTE]\n====\ntext here\n====\n",
  ])("%j keeps its own spelling", async (input) => {
    await expectFormatted(input, input);
  });
});

// WHERE the style line stands decides whether it may be respelled at
// all. A `[NAME]` bracket line opens a block from any position; a
// `NAME: ` label does not, so in item-TEXT position the label is more
// of the item's text and the admonition is destroyed. RED before
// {@link admonitionLabelOpensABlock}: each of these formatted to a
// label line, the render moved on the first pass, and all but the last
// were not even idempotent afterwards.
describe("a style line only becomes a label where a label opens a block", () => {
  test.each([
    ["ulist item text", "* item\n[NOTE]\nbody text\n"],
    ["olist item text", ". item\n[NOTE]\nbody text\n"],
    ["a dash item's text", "- item\n[NOTE]\nbody text\n"],
    ["a nested item's text", "* a\n** b\n[NOTE]\nbody text\n"],
    ["colist item text", "<1> c\n[NOTE]\nbody text\n"],
    ["an item block reached with no marker", "* item\n+\npara\n[NOTE]\nbody\n"],
    ["before a sibling marker", "* item\n[NOTE]\nbody\n* next\n"],
    // The one that was already idempotent, and so the worst: a
    // term-only item takes whatever is written under it as its
    // description, so the blank the printer writes in the style
    // line's place hands the admonition's text to the term.
    ["under a term that spent no text", "term::\n[NOTE]\nbody text\n"],
  ])("%s keeps the style line", async (_name, input) => {
    const output = await formatAdoc(input);
    expect(output).toContain("[NOTE]");
    await expectStableRender(input);
  });

  // The positions where a label DOES open a block still fold, so the
  // guard is a position test and not a retreat from the mechanism.
  test.each([
    [
      "a continuation inside an item",
      "* item\n+\n[NOTE]\nbody\n",
      "* item\n+\nNOTE: body\n",
    ],
    [
      "a blank line below a list",
      "* item\n\n[NOTE]\nbody\n",
      "* item\n\nNOTE: body\n",
    ],
    [
      "a term that spent its own text",
      "term:: def\n[NOTE]\nbody\n",
      "term:: def\n\nNOTE: body\n",
    ],
    ["document level", "[NOTE]\nbody\n", "NOTE: body\n"],
  ])("%s still folds", async (_name, input, expected) => {
    await expectFormatted(input, expected);
  });
});
