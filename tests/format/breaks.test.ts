import { describe, test, expect } from "vitest";
import {
  asParagraph,
  firstList,
  formatAdoc,
  renderedHtml,
} from "../helpers.js";
import { parse } from "../../src/parser.js";

describe("thematic break formatting", () => {
  // Basic thematic break preserved.
  test("basic thematic break preserved", async () => {
    const input = "'''\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Extended thematic break normalized to three quotes.
  test("extended thematic break normalized", async () => {
    expect(await formatAdoc("''''\n")).toBe("'''\n");
    expect(await formatAdoc("'''''\n")).toBe("'''\n");
  });

  // Thematic break with surrounding paragraphs has blank
  // line separation.
  test("thematic break between paragraphs", async () => {
    const input = "Before.\n\n'''\n\nAfter.\n";
    expect(await formatAdoc(input)).toBe(input);
  });
});

describe("page break formatting", () => {
  // Basic page break preserved.
  test("basic page break preserved", async () => {
    const input = "<<<\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Extended page break normalized to three less-than signs.
  test("extended page break normalized", async () => {
    expect(await formatAdoc("<<<<\n")).toBe("<<<\n");
    expect(await formatAdoc("<<<<<\n")).toBe("<<<\n");
  });

  // Page break with surrounding paragraphs has blank
  // line separation.
  test("page break between paragraphs", async () => {
    const input = "Before.\n\n<<<\n\nAfter.\n";
    expect(await formatAdoc(input)).toBe(input);
  });
});

describe("hard line break formatting", () => {
  // A hard line break (` +` at end of line) in a paragraph
  // must survive formatting. The ` +\n` is semantic — it
  // forces a line break in the rendered output.
  test("hard line break in paragraph is preserved", async () => {
    const input = "First line +\nsecond line.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Hard line break in a list item must also be preserved.
  test("hard line break in list item is preserved", async () => {
    const input = "* First line +\nsecond line.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // A hard break as the block's FIRST inline node: there is nothing
  // in front of it to break away from, so it does not demand a
  // leading break (ownsItsLine's first-node arm, src/print/inline.ts)
  // and the paragraph round-trips byte-identically.
  test("a hard break opening the paragraph is preserved", async () => {
    const input = " +\nx\n";
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    expect(await formatAdoc(out)).toBe(out);
  });

  // Multiple hard line breaks in sequence.
  test("multiple hard line breaks preserved", async () => {
    const input = "Line one +\nline two +\nline three.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // A ` +` ALONE on its line is still a hard line break:
  // `LineBreakRx` (`^(.*)[ \t]\+$`) only needs a space before the
  // `+`, and an empty capture is a legal one. Asciidoctor takes the
  // break away in exactly one shape — see the literal-plus test
  // below — and the formatter used to lose it in all of them,
  // joining the lines into `text + more`.
  test.each([
    ["a paragraph", "text\n +\nmore\n"],
    ["a list item", ". item\n +\nmore\n"],
    ["a dlist description", "t:: desc\n +\nmore\n"],
    ["the block's last line", "text\nfoo\n +\nbar\n"],
  ])("a ` +` alone on its line breaks in %s", async (_name, input) => {
    const out = await formatAdoc(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(out.includes(" +\n")).toBe(true);
    expect(await formatAdoc(out)).toBe(out);
  });

  // "Alone on its line" is a WHITESPACE-only prefix, not column 1:
  // the ` +` token starts at the space, so an extra indent moves it
  // right without giving the line any content. Both spellings render
  // the same `<br>`, and both must keep the ` +` on its own output
  // line — joining it onto the text above renders `text<br>` where
  // the source renders `text <br>`.
  test.each([
    ["one leading space", "text\n +\nmore\n"],
    ["a deeper indent", "text\n  +\nmore\n"],
    ["a preceding formatting span", "*b*\n +\nmore\n"],
  ])("a ` +` after %s owns its line", async (_name, input) => {
    const out = await formatAdoc(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(out.split("\n")).toContain(" +");
    expect(await formatAdoc(out)).toBe(out);
  });

  // Where it is NOT a break: `adjust_indentation!` strips the common
  // indent of a list item's continuation block BEFORE `LineBreakRx`
  // runs, so a ` +` no less indented than every other line of that
  // block loses its space and becomes a bare `+` — plain text. The
  // four cases below share one source shape and differ only in what
  // follows the ` +`, which is what decides the common indent.
  test.each([
    // Nothing follows: the block is the ` +` line, indent 1.
    [". item\n +\n", true],
    // `more` is unindented, so the common indent is 0 and the space
    // survives.
    [". item\n +\nmore\n", false],
    // ` more` is indented EXACTLY as much as the ` +` line, so the
    // common indent is 1 and the space goes: the boundary case, and
    // the one that says the comparison is `>=` and not `>`.
    [". item\n +\n more\n", true],
    // `  more` is indented further, so the common indent is still 1.
    [". item\n +\n  more\n", true],
  ])("%j reads its ` +` as literal: %s", async (input, literal) => {
    const out = await formatAdoc(input);
    // `{plus}` is the formatter's escape for a trailing literal `+`,
    // and Asciidoctor renders it as the numeric reference for the very
    // same character, which `renderedHtml` reads as that character.
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    const html = await renderedHtml(out);
    expect(html.includes("<br>")).toBe(!literal);
    expect(await formatAdoc(out)).toBe(out);
  });

  // The reader's literal-plus decision retypes the ` +` token as
  // text. The newline that ENDS that line must stay a newline: retype
  // it too and it lands inside the item's text value, where nothing
  // downstream can tell it from content. Only the AST shows it — the
  // printer drops a trailing newline, so every rendering check above
  // passes either way.
  test("a literal ` +` leaves its newline out of the item's text", () => {
    const { children } = parse(". item\n +\n");
    const {
      children: [item],
    } = firstList(children);
    const {
      text: [text],
    } = item;
    expect(text).toMatchObject({ type: "text", value: "item\n +" });
  });

  // And it belongs to the FIRST line after the marker alone. `next_block`
  // hands `parse_list_item` the marker line plus the lines adjacent to
  // it, and `adjust_indentation!` runs over that buffer once; a ` +`
  // that arrives on a LATER line of the item's text is past the point
  // where the common indent is taken, so it stays an ordinary hard
  // break. Asserted on the AST rather than on formatted bytes: the
  // reflow that joins `a` and `a` moves the ` +` onto the first rest
  // line, where a second format pass reads it as literal — a
  // round-trip wobble that predates this suite and is not pinned
  // here.
  test("a ` +` on a LATER line of the item's text is still a hard break", () => {
    const { children } = parse("* a\na\n +\n");
    const {
      children: [item],
    } = firstList(children);
    expect(item.text.map(({ type }) => type)).toEqual([
      "text",
      "hardLineBreak",
    ]);
  });

  // The literal reading belongs to ITEM TEXT alone: `adjust_indentation!`
  // runs on a list item's lines and on nothing else, so the very same
  // shape — a ` +` line with nothing after it — is an ordinary hard
  // break in a plain paragraph.
  test("the same trailing ` +` in a PLAIN paragraph is a hard break", () => {
    const { children } = parse("a\n +\n");
    expect(asParagraph(children[0]).children.map(({ type }) => type)).toEqual([
      "text",
      "hardLineBreak",
    ]);
  });
});

describe("a hard break survives trailing whitespace and EOF", () => {
  // Ruby matches HardLineBreakRx against the RSTRIPPED line, so
  // trailing blanks and a missing final newline are invisible to the
  // oracle: "a +  " IS a hard break. The tokenizer sees raw bytes and
  // must speak the same dialect (issues #70, #33 shape 3).
  test.each([
    ["a +  \nb\n", "a +\nb\n"],
    ["a +\t\nb\n", "a +\nb\n"],
    ["a +", "a +\n"],
  ])("%j formats to %j", async (input, expected) => {
    expect(await formatAdoc(input)).toBe(expected);
  });

  test.each(["a +  \nb\n", "a +"])(
    "%j renders the same formatted",
    async (input) => {
      expect(await renderedHtml(await formatAdoc(input))).toBe(
        await renderedHtml(input),
      );
    },
  );
});

describe("a lone indented ` +` is the literal the oracle reads", () => {
  // `adjust_indentation!` takes the common indent of ALL the item's
  // rest lines, the ` +` line included. With no content line after
  // it, the ` +` line is the only line that indent is taken over: its
  // own indent IS the common one, the space always goes, and the bare
  // `+` that reaches `HardLineBreakRx` (`^(.*) \+$`, which needs the
  // space) is plain text. ORACLE: `. item` / ` +` / `. next` renders
  // `item +`, with no break anywhere.
  //
  // The formatter escapes that `+` as `{plus}`, which Asciidoctor
  // renders as the numeric reference for the very same character, and
  // `renderedHtml` reads a reference as the character it names. Only
  // the READING is pinned here. The spelling is a print-side question
  // of its own (issue #33): pinning the bytes would settle it by
  // accident.
  test.each([
    ["a following item", ". item\n +\n. next\n"],
    // The same line with trailing blanks. Every line is rstripped
    // before INDENTED_PLUS (`/^[ \t]+\+$/v`) is asked about it, so
    // the blanks change nothing and the oracle agrees.
    ["trailing blanks and nothing else", ". item\n +  \n"],
  ])("with %s, the ` +` reads as a literal plus", async (_name, input) => {
    const out = await formatAdoc(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  // The two faces of the family that keep their bytes: a ` +` on a
  // LATER line of an item's text is past the point where the common
  // indent is taken, so it stays a break, and a ` +` that OPENS a
  // literal block is inside `<pre>`, where nothing is re-indented at
  // all. (A ` +` at EOF with no newline is the third; it is pinned
  // with the rstripped-dialect rows above.)
  test.each([
    ["a later line of an item's text", "* a\na\n +\n"],
    ["the first line of a literal block", " +\nmore\n"],
  ])("%s keeps its bytes", async (_name, input) => {
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  // The retype reaches the ` +` LINE and no other break in the
  // paragraph. The item's own marker line ends in a hard break and
  // the indented content line after the ` +` ends in another; both
  // must survive while the ` +` between them goes literal.
  test("the retype reaches the ` +` line and no break outside it", async () => {
    const input = ". item +\n +\n  more +\n  tail\n";
    const out = await formatAdoc(input);
    expect(out).toBe(". item +\n+ more +\ntail\n");
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  // And the reading belongs to ITEM TEXT alone. The same shape in a
  // plain paragraph, which `adjust_indentation!` never runs over,
  // keeps its break even though the line after the ` +` is indented
  // past it.
  test("the same shape in a plain paragraph keeps its break", async () => {
    const input = "text\n +\n  more\n";
    const out = await formatAdoc(input);
    expect(out).toBe("text\n +\nmore\n");
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});
