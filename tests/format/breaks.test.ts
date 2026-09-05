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

// Issue #23. The three Markdown rules normalize to the AsciiDoc
// spelling, which is what a break already does for its own run
// (`''''` becomes `'''`), and the render is the same `<hr>` either
// way. Red before the classifier read them: `---` next to prose was
// reflow-joined into it and the `<hr>` left the render, and `***`
// joined fabricated a list from the packed line.
describe("markdown thematic break formatting", () => {
  test.each([
    ["hyphens", "---\n"],
    ["asterisks", "***\n"],
    ["underscores", "___\n"],
    ["an indented rule", "  ---\n"],
    // The one SPACED spelling the registry reads: `_` is no
    // unordered marker, so no open list can claim the line.
    ["spaced underscores", "_ _ _\n"],
  ])("a rule of %s normalizes to the AsciiDoc break", async (_n, input) => {
    const out = await formatAdoc(input);
    expect(out).toBe("'''\n");
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  // The fold may not MANUFACTURE the rule out of text (#179). Every
  // row below is a line of three marks the oracle reads as text
  // because its gaps disagree; folding them to single spaces spells
  // the rule, and the render moved on the first pass. Red before the
  // fix: `- -   -` and `* *   *` printed `- - -` and `* * *`, and
  // every `_` row printed `_ _ _` and then normalized to `'''` on a
  // second pass. The remedy is the author's own bytes, so each row
  // asserts them.
  test.each([
    // Behind a `-` or `*` marker the line is a list item to us and to
    // the oracle both, and the marker writes the rule's first mark.
    ["a dash marker's own text", "- -   -\n"],
    ["a star marker's own text", "* *   *\n"],
    // `_` is no marker, so these are paragraphs.
    ["an interior run", "_ _  _\n"],
    ["an interior run on the other side", "_  _ _\n"],
    ["a longer interior run", "_ _   _\n"],
    ["a tab, which no rule's gap may be", "_ _\t_\n"],
    // Gaps that AGREE, so the equality half of the source's own
    // reading says nothing and the SPACES-only half is what answers:
    // both rx spell the gap `( *)`, so a line of uniform TABS is a
    // paragraph to the oracle. Folding it would move the render and
    // then normalize to `'''`; the row above never reaches that half,
    // because its two gaps already differ.
    ["uniform tabs, which agree and are still no rule", "_\t_\t_\n"],
    // No interior run to keep at all: the fold JOINS two source
    // lines, and the break the author wrote is what holds them apart.
    ["a two-line join", "_ _\n_\n"],
    ["a two-line join behind a marker", "- -\n-\n"],
  ])("%s keeps its bytes rather than spelling a rule", async (_n, input) => {
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  // The other side of the same rule: a line whose gaps AGREE is the
  // author's own rule, and the fold still normalizes it. Red if the
  // refusal above were written without the source's own gaps - the
  // printer writes one space after a marker, so keeping `-  -` there
  // would print `- -  -`, which is neither the source's line nor a
  // rule.
  test.each([
    ["a spaced dash rule", "-  -  -\n", "- - -\n"],
    ["a spaced star rule", "*  *  *\n", "* * *\n"],
    ["a tight dash rule", "- - -\n", "- - -\n"],
  ])("%s still normalizes", async (_n, input, expected) => {
    const out = await formatAdoc(input);
    expect(out).toBe(expected);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  // The marks are only a rule when they are the WHOLE line and there
  // are exactly THREE of them, so a marker of another kind, a fourth
  // mark, a word beside them or an inline sibling leaves the fold
  // alone. Red the other way: an over-wide refusal would freeze the
  // author's whitespace here for nothing.
  test.each([
    ["a marker of another mark", "* -  -\n", "* - -\n"],
    ["an ordered marker", ". -  -\n", ". - -\n"],
    ["a word behind the marks", "_ _  _ x\n", "_ _ _ x\n"],
    ["a word in front of them", "x _ _  _\n", "x _ _ _\n"],
    ["a marker line of three marks", "* _ _  _\n", "* _ _ _\n"],
    // A FOURTH mark is not the spelling: both rx want three and stop.
    // The rows above differ from the marks in what a word HOLDS; this
    // one differs only in how many there are.
    ["a fourth mark", "_ _  _ _\n", "_ _ _ _\n"],
    // A real inline SIBLING on the line, which the rows above have
    // not got - each of them is one text node whose word count
    // already answers. Here the marks are the whole of their own
    // node and the span beside them is what makes the line longer.
    ["an inline sibling on the line", "*b*\n_ _  _\n", "*b* _ _ _\n"],
  ])("%s folds as usual", async (_n, input, expected) => {
    const out = await formatAdoc(input);
    expect(out).toBe(expected);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  // The same fold, met at a block start that is not the document's:
  // inside a list item's continuation and inside a delimited block.
  test.each([
    ["a list item's continuation", "* a\n+\n_ _  _\n"],
    ["a list inside one", "* a\n+\n- -   -\n"],
    ["a quote block", "[quote]\n____\n_ _  _\n____\n"],
    ["an attribute line above it", ":attr: x\n\n_ _  _\n"],
  ])("%s keeps its bytes too", async (_n, input) => {
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  // WHAT THE KEPT BREAK COSTS when the item is nested, recorded
  // rather than asserted correct: the break is rebuilt at COLUMN 0,
  // so the author's indented rest line comes back flush left. The
  // reading is unchanged and so is the render - a lone mark at column
  // 0 is no marker, `UnorderedListRx` wanting whitespace AND text
  // (rx.rb l.284), and the line is the item's text either way - and
  // the output is a fixed point, so nothing walks it further. Pinned
  // so the de-indent is a choice with a witness.
  test.each([
    ["one level", "* a\n  - -\n  -\n", "* a\n  - -\n-\n"],
    ["two levels", "* a\n** b\n   - -\n   -\n", "* a\n** b\n   - -\n-\n"],
  ])(
    "a kept break under a nested item de-indents its line, %s",
    async (_n, input, expected) => {
      const out = await formatAdoc(input);
      expect(out).toBe(expected);
      expect(await renderedHtml(out)).toBe(await renderedHtml(input));
      expect(await formatAdoc(out)).toBe(out);
    },
  );

  // The corruption the issue measured: the rule and the prose beside
  // it were one paragraph, so the break left the render and its
  // characters became inline markup in the joined line.
  test.each([
    ["a rule above prose", "___\nb c\n", "'''\n\nb c\n"],
    ["a rule below prose", "b c\n\n---\n", "b c\n\n'''\n"],
    ["a rule between paragraphs", "a\n\n***\n\nb\n", "a\n\n'''\n\nb\n"],
  ])("%s keeps its own block", async (_name, input, expected) => {
    const out = await formatAdoc(input);
    expect(out).toBe(expected);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
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
  // leading break (`hardBreakOwnsItsLine`'s `index <= 0` arm,
  // src/print/inline.ts) and the paragraph round-trips
  // byte-identically. Spelled in full because `Atom.ownsItsLine`
  // (src/print/reflow.ts) is a different fact about raw lines.
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

// Issue #101. A description-list item that carries its own text is
// the one item whose folded first block Asciidoctor reads WITHOUT
// skipping line comments: `parse_list_item` passes
// `text_only: has_text ? nil : true` and keeps `has_text` for a dlist
// (parser.rb l.1367-74), and the literal branch passes that value
// straight on as `read_paragraph_lines ... skip_line_comments:
// text_only` (parser.rb l.754). So a `//` line inside such a
// description is CONTENT: it reaches `adjust_indentation!`, its
// indent counts in the common indent, and the ` +` line above it
// keeps the space that makes it a hard break. ORACLE: `t:: item` /
// ` +` / `// c` renders `item <br> // c`; dropping either the break
// or the comment line drops rendered content.
describe("a comment line inside a dlist description is content", () => {
  test.each([
    ["one comment line", "t:: item\n +\n// c\n"],
    ["two comment lines", "t:: item\n +\n// c\n// d\n"],
    ["a comment with nothing after the slashes", "t:: item\n +\n//\n"],
    ["a ` +` the comment still outdents", "t:: item\n  +\n// c\n"],
    ["a paragraph after the item", "t:: item\n +\n// c\n\nafter\n"],
    ["the item nested in a list item", "* a\nt:: item\n +\n// c\n"],
  ])("with %s, the break and the comment both survive", async (_n, input) => {
    const out = await formatAdoc(input);
    const html = await renderedHtml(out);
    expect(html).toBe(await renderedHtml(input));
    expect(html.includes("<br>")).toBe(true);
    expect(out.includes("//")).toBe(true);
    expect(await formatAdoc(out)).toBe(out);
  });

  // The issue's own repro, byte for byte: both lines stand where the
  // source put them, so the reformatted document reads back as the
  // same one (`t:: item {plus}` / `// c` used to lose the break and,
  // with it, the reading that makes the comment line content).
  test("the repro keeps its bytes", async () => {
    const input = "t:: item\n +\n// c\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // The reading is the dlist's alone, and only where the item carries
  // its own text. A ulist or olist item's content-adjacent fold is
  // read with `text_only` true (`has_text = nil unless dlist`), and a
  // dlist item with no inline text has `has_text` false, so both
  // SKIP the comment: the ` +` line is then the only line the common
  // indent is taken over, its space goes, and the bare `+` that
  // reaches `HardLineBreakRx` is plain text. ORACLE: none of the
  // three renders a `<br>`.
  test.each([
    ["a ulist item", "* item\n +\n// c\n"],
    ["an olist item", ". item\n +\n// c\n"],
    ["a dlist item with no text of its own", "t::\n +\n// c\n"],
  ])("in %s the comment is a comment", async (_name, input) => {
    const out = await formatAdoc(input);
    const html = await renderedHtml(out);
    expect(html).toBe(await renderedHtml(input));
    expect(html.includes("<br>")).toBe(false);
    expect(await formatAdoc(out)).toBe(out);
  });
});

// Issue #105. Which arm of `next_block` a dlist description folds
// down is decided by the first NON-COMMENT line after the term line,
// and only the indented arm reads the caller's answer for `//` lines:
// `read_paragraph_lines ... skip_line_comments: text_only`
// (parser.rb l.753-754) against `skip_line_comments: true` in the arm
// beside it (parser.rb l.764). Under the indented arm a `//` line is
// text like any other, and the loss the issue records was a reflow
// that left it standing at column 0 under a description folded onto
// the term line, where the second read hands it to
// `skip_comment_lines` and the render loses it. A description item
// REPLAYS its recorded lines, so the comment stands where the author
// wrote it, inside the description, and no join can move it anywhere.
// ORACLE: `t:: item` / `  x` / `// c` renders `item x // c`, which is
// what the input renders and therefore what the output renders.
describe("a content comment line stays inside the description", () => {
  test.each([
    ["the issue's first repro", "t:: item\n  x\n// c\n"],
    ["the issue's second repro", "t:: item\n  a\n// c\n  b\n"],
    ["two comment lines", "t:: item\n  x\n// c\n// d\n"],
    ["nothing after the slashes", "t:: item\n  x\n//\n"],
    ["a tab for the indent", "t:: item\n\tx\n// c\n"],
    ["the item nested in a list item", "* a\nt:: item\n  x\n// c\n"],
    ["a paragraph after the item", "t:: item\n  x\n// c\n\nafter\n"],
  ])("with %s the comment stays inside", async (_name, input) => {
    const out = await formatAdoc(input);
    // A ROUND TRIP: the item replays, so the comment keeps the line
    // and the column the author gave it, which is the one position
    // whose reading the render already agrees with.
    expect(out).toBe(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  // The indented arm is the only one whose `//` lines the oracle reads
  // as content, so a description whose first non-comment rest line is
  // NOT indented reads its comment as the comment it looks like. The
  // printer leaves it on the line of its own that keeps that reading
  // either way, which is what a replay does. The first two rows
  // reduce lists_test.rb cases (`folds text from inline description
  // and line following comment line`, `should not match comment line
  // that looks like sibling description list term`); the other two are
  // this file's own. The comment is gone from every one of these
  // renders.
  test.each([
    ["the first rest line is the comment", "t:: def1\n// c\ncontinued\n"],
    ["the comment looks like a sibling term", "foo:: bar\n//yin:: yang\n"],
    ["the term carries no text of its own", "t::\n  x\n// c\n"],
    ["a ulist item, whose `text_only` is set", "* item\n  x\n// c\n"],
  ])("where %s, the comment keeps its own line", async (_name, input) => {
    const out = await formatAdoc(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(out.split("\n").some((line) => line.startsWith("//"))).toBe(true);
    expect(await formatAdoc(out)).toBe(out);
  });
});

// How many description-list terms a render carries. Counting `<dt`
// rather than comparing whole renders keeps the row's own subject in
// view: what may never change is the list STRUCTURE, whatever the
// comment line does.
const termCount = (html: string): number => (html.match(/<dt/gv) ?? []).length;

// Issue #105, and the shape that shows why a description is replayed
// rather than joined. A `//` line's own `term::` words are inert
// twice over: `DescriptionListRx` refuses a line whose head is `//`
// (rx.rb:336), and inside a description's text the term the source
// wrote binds first, because Ruby's term group is non-greedy. A join
// spends the first of those, and the joined line is then read by the
// ENCLOSING list's sibling pattern (`is_sibling_list_item?`,
// parser.rb:1430, :2281), where the word IS a sibling term (ORACLE:
// `t:: item` / `x // x:: y` renders a second `<dt>`). So the item
// replays: every line keeps its own place, and no list item is
// invented. What issue #119 leaves standing is the refused JOIN, not
// a lost render: measured, these rows round-trip and both sides
// render the comment inside the description. It is recorded as a
// standing divergence in docs/coding-standards.md.
describe("a comment carrying a dlist separator is not folded", () => {
  test.each([
    ["one term", "t:: item\n  x\n// x:: y\n"],
    ["two terms", "t:: item\n  x\n// a:: b:: c\n"],
    ["a tab for the indent", "t:: item\n\tx\n// x:: y\n"],
    ["a second comment head in front of it", "t:: item\n  x\n// // x:: y\n"],
    ["the `;;` separator", "t:: item\n  x\n// x;; y\n"],
  ])("with %s, the comment keeps its line", async (_name, source) => {
    const out = await formatAdoc(source);
    expect(out).toBe(source);
    // Nothing invented: the reformatted document carries exactly the
    // terms the source's own render does.
    const before = await renderedHtml(source);
    const after = await renderedHtml(out);
    expect(termCount(after)).toBe(termCount(before));
    expect(await formatAdoc(out)).toBe(out);
  });

  // Where the separator ends no word the line is ordinary text and
  // folds like any other comment, and where the description's own
  // first rest line is a ` +` the refusal costs nothing at all: the
  // indent still counts (that is the #101 rule, which asks a
  // different question), so the break holds its line and the comment
  // stays inside the description by standing under it.
  test.each([
    ["a `::` inside a word", "t:: item\n  x\n// a x::y\n"],
    ["a ` +` above it", "t:: item\n +\n// x:: y\n"],
  ])("with %s the render is unchanged", async (_name, source) => {
    const out = await formatAdoc(source);
    expect(out).toBe(source);
    expect(await renderedHtml(out)).toBe(await renderedHtml(source));
    expect(await formatAdoc(out)).toBe(out);
  });
});

// Issue #106. A TAB-indented lone `+` in a description was said to be
// respelled `{plus}` because `adjust_indentation!` expands tabs before
// the common-indent scan while our accounting reads raw columns. It
// does not: the literal arm calls `adjust_indentation! lines` with no
// arguments (parser.rb l.755) and the expansion is gated on the
// `tab_size` that call leaves at its default 0 (parser.rb l.2679).
// Nothing expands, so a tab-indented `+` never reaches
// `HardLineBreakRx` (rx.rb:627, `^(.*) \+$`) with the SPACE that pattern
// wants, and the oracle renders a literal `+` where a space-indented
// `+` renders a break. The formatter agreed about the plus all along;
// what it lost was the comment line behind it, by the route issue #105
// names, and the rows below are that family with a tab for the indent.
// Every one of them is a ROUND TRIP now: the description replays, so
// the tab, the plus and the comment all stand where they were
// written.
describe("a tab-indented `+` in a dlist description keeps its comment", () => {
  test.each([
    ["one tab", "t:: item\n\t+\n// c\n"],
    ["a space then a tab", "t:: item\n \t+\n// c\n"],
    ["two tabs", "t:: item\n\t\t+\n// c\n"],
    ["a text line after the comment", "t:: item\n\t+\n// c\n  b\n"],
  ])("with %s, the plus is text and so is the comment", async (_n, source) => {
    const out = await formatAdoc(source);
    expect(out).toBe(source);
    const html = await renderedHtml(out);
    expect(html).toBe(await renderedHtml(source));
    // The oracle's own answer, and the reason the output may spell the
    // plus inline: no break was ever there to keep.
    expect(html.includes("<br>")).toBe(false);
    expect(await formatAdoc(out)).toBe(out);
  });

  // The contrast the issue rests on, and the #101 rows it must not
  // disturb: one SPACE in the same position is a hard break, the
  // break holds its line, and the comment stays inside the
  // description by standing under an indented line rather than by
  // reflowing into it.
  test("a space in the same position is still a break", async () => {
    const input = "t:: item\n +\n// c\n";
    expect(await formatAdoc(input)).toBe(input);
    const html = await renderedHtml(input);
    expect(html.includes("<br>")).toBe(true);
  });
});

// Issue #107, the marker-item witness. A dlist item REPLAYS its own
// recorded lines (tests/format/description-list.test.ts:430), so the
// divergence the issue first named there never reaches the output. A
// MARKER item has no replay: its rest lines are read by this same
// paragraph reader, and an unresolved `include::` line used to count
// for nothing in `adjustsIndentation`, while to the oracle it is a
// flush-left message line that takes `adjust_indentation!`'s common
// indent to zero (parser.rb l.2723-2732; the message comes from
// `replace_next_line`, reader.rb l.258-262). That kept the space, and
// so the break, on the ` +` line above it for the oracle and lost
// both here: the ` +` retyped to a literal `{plus}` and the include
// line joined onto the item's own. RED before the fix: every row
// below formatted to `* item {plus}` (or `.`/`<1>`) with no `<br>` in
// its render.
describe("an include under a marker item keeps its break (#107)", () => {
  test.each([
    ["a ulist item", "* item\n +\ninclude::x[]\n"],
    ["an olist item", ". item\n +\ninclude::x[]\n"],
    ["a callout item", "<1> item\n +\ninclude::x[]\n"],
  ])("with %s, the include keeps the ` +` a break", async (_name, input) => {
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    const html = await renderedHtml(out);
    expect(html).toBe(await renderedHtml(input));
    expect(html.includes("<br>")).toBe(true);
    expect(await formatAdoc(out)).toBe(out);
  });

  // Controls: the shapes the fix must leave exactly as they were.
  //
  // A plain paragraph's lines never reach `adjust_indentation!` at
  // all (that call is `parse_list_item`'s alone, parser.rb l.755,
  // l.1053-55), so an include below one was never inside this rule
  // and keeps its break either way.
  test("a plain paragraph's include keeps its break regardless", async () => {
    const input = "para\n +\ninclude::x[]\n";
    expect(await formatAdoc(input)).toBe(input);
    const html = await renderedHtml(input);
    expect(html.includes("<br>")).toBe(true);
  });

  // An INDENTED include never matches `INCLUDE_DIRECTIVE` (the
  // pattern requires column 0), so the classifier never reads it as
  // `raw`/`include`: it is ordinary text, already counted in
  // `adjustsIndentation` before this fix, and this shape is
  // unaffected by it.
  test("an indented include is text, not a preprocessor line", async () => {
    const input = "* item\n +\n  include::x[]\n";
    const out = await formatAdoc(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  // An `ifdef::` line is a CONDITIONAL, not an include, and the
  // preprocessor removes it (and the block it guards) before either
  // reader ever sees a paragraph, so there is no flush-left line here
  // for the two sides to disagree about: both read `* item` / ` +`
  // with nothing after it and land on the same literal plus.
  test("an ifdef line is gone before either side reads it", async () => {
    const input = "* item\n +\nifdef::flag[]\nmore\nendif::[]\n";
    const out = await formatAdoc(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});
