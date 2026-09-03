/**
 * Paragraph reflow tests — verifies that prose text is wrapped to
 * printWidth using Prettier's fill command.
 *
 * Plain-text subset only. Inline markup and hard line break tests
 * will be added when those features land (Tasks 14-16).
 */
import { describe, test, expect } from "vitest";
import { formatAdoc, renderedHtml } from "../helpers.js";

describe("paragraph reflow", () => {
  // A short paragraph that fits within printWidth should remain
  // on a single line — no wrapping needed.
  test("short paragraph stays on one line", async () => {
    const input = "Hello world.\n";
    expect(await formatAdoc(input)).toBe("Hello world.\n");
  });

  // A long paragraph exceeding printWidth should be wrapped.
  // Prettier's fill packs words greedily — "three four" (10 chars)
  // fits in printWidth=10, so they share a line.
  test("long paragraph wraps at printWidth", async () => {
    const input = "one two three four five six seven\n";
    const expected = "one two\nthree four\nfive six\nseven\n";
    expect(await formatAdoc(input, { printWidth: 10 })).toBe(expected);
  });

  // Multiple short words that fit on one line should stay together.
  test("multiple short words kept on one line", async () => {
    const input = "a b c d e\n";
    expect(await formatAdoc(input, { printWidth: 80 })).toBe("a b c d e\n");
  });

  // Existing line breaks within a paragraph are NOT preserved —
  // the formatter reflows text to fill each line optimally.
  test("existing line breaks are reflowed", async () => {
    const input = "Line one.\nLine two.\nLine three.\n";
    const expected = "Line one. Line two. Line three.\n";
    expect(await formatAdoc(input, { printWidth: 80 })).toBe(expected);
  });

  // Comment content must NOT be reflowed — it is verbatim.
  test("comment content is not reflowed", async () => {
    const input = "// This is a comment that should stay on one line\n";
    expect(await formatAdoc(input)).toBe(
      "// This is a comment that should stay on one line\n",
    );
  });

  // Block comment content must stay verbatim.
  test("block comment content is not reflowed", async () => {
    const input = "////\nShort line.\nAnother short line.\n////\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Reflow with a realistic printWidth: a paragraph that spans
  // well beyond 80 columns should be wrapped.
  test("wraps long prose at default printWidth", async () => {
    // Build a paragraph of ~120 characters.
    const words = Array.from(
      { length: 20 },
      (_, index) => `word${String(index)}`,
    );
    const input = `${words.join(" ")}\n`;
    const result = await formatAdoc(input, { printWidth: 40 });
    // Every output line (except possibly the last) should be
    // at most 40 characters.
    const lines = result.trimEnd().split("\n");
    for (const line of lines.slice(0, -1)) {
      expect(line.length).toBeLessThanOrEqual(40);
    }
  });

  // Edge case: single word longer than printWidth — it can't be
  // broken, so it stays on its own line.
  test("single long word is not broken", async () => {
    const input = "supercalifragilisticexpialidocious\n";
    expect(await formatAdoc(input, { printWidth: 10 })).toBe(input);
  });

  // Multiple paragraphs should each be reflowed independently,
  // separated by blank lines.
  test("multiple paragraphs are reflowed independently", async () => {
    const input = "one two three four five\n\nsix seven eight nine ten\n";
    const expected =
      "one two\nthree four\nfive\n\nsix seven\neight nine\nten\n";
    expect(await formatAdoc(input, { printWidth: 10 })).toBe(expected);
  });

  // Tabs in paragraph text are treated as whitespace by the reflow
  // logic (`split(/\s+/)`). This guards against regressions where
  // tab-separated words might be collapsed incorrectly or left
  // un-split during reflow.
  test("tabs between words are treated as whitespace", async () => {
    const input = "one\ttwo\tthree\n";
    expect(await formatAdoc(input)).toBe("one two three\n");
  });

  // A paragraph containing only whitespace (spaces and tabs) should
  // collapse to nothing after reflow since `split(/\s+/)` produces
  // only empty strings from whitespace-only input. Prettier treats
  // this as empty content and returns an empty string.
  test("whitespace-only paragraph produces empty output", async () => {
    const input = "   \t  \n";
    const result = await formatAdoc(input);
    expect(result).toBe("");
  });

  // Paragraph reflow must not place words at the start of a line
  // where they would be re-parsed as AsciiDoc block syntax — but the
  // set of such words is exactly the line-shape registry's, and no
  // wider. A `.word` is a block TITLE only on the first line of a block.
  // Mid-paragraph Asciidoctor reads it as text — and so does the
  // reader, in its paragraph context — so fill() may break in front
  // of it and reflow must not waste a line preventing that.
  test("lets a .word start a later line of a paragraph", async () => {
    const input = "aaa bbb .title\n";
    const options = { printWidth: 10 };
    const out = await formatAdoc(input, options);
    expect(out).toBe("aaa bbb\n.title\n");
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out, options)).toBe(out);
  });

  test("lets consecutive .words wrap freely", async () => {
    const input = "aaa .foo .bar\n";
    const options = { printWidth: 10 };
    const out = await formatAdoc(input, options);
    expect(out).toBe("aaa .foo\n.bar\n");
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out, options)).toBe(out);
  });

  // Delimiter-char words like `*` and `-` are dangerous at line
  // start (unordered list markers). The reflow must keep them
  // off column 0.
  test("reflow prevents list marker words at line start", async () => {
    const input = "result is 10 - 5\n";
    const result = await formatAdoc(input, { printWidth: 12 });
    for (const line of result.split("\n")) {
      // Line must not start with `- ` (list marker) or `* `.
      expect(line).not.toMatch(/^[*\u002D] /v);
    }
  });

  // An attribute entry is block metadata only where a block can
  // start; mid-paragraph `:toc:` is text to Asciidoctor, and it is
  // absent from every interrupting set in the registry, so reflow
  // leaves it alone.
  test("lets an attribute-entry-shaped word start a later line", async () => {
    const input = "use the :toc: attribute\n";
    const options = { printWidth: 10 };
    const out = await formatAdoc(input, options);
    expect(out).toBe("use the\n:toc:\nattribute\n");
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out, options)).toBe(out);
  });

  // Fenced code prefix ``` at line start would open a code block.
  test("reflow prevents fenced code fence at line start", async () => {
    const input = "use the ```ruby syntax\n";
    const result = await formatAdoc(input, { printWidth: 10 });
    for (const line of result.split("\n")) {
      expect(line).not.toMatch(/^```/v);
    }
  });

  // Callout list marker `<1>` at line start would be re-parsed
  // as a callout list item.
  test("reflow prevents callout marker at line start", async () => {
    const input = "item number <1> here\n";
    const result = await formatAdoc(input, { printWidth: 10 });
    for (const line of result.split("\n")) {
      expect(line).not.toMatch(/^<\d/v);
    }
  });

  // A list item with an indented continuation line containing
  // just `+` must not produce ` +\n` at end of line after
  // reflow — that would be re-parsed as a hard line break.
  // Asciidoctor's `adjust_indentation!` strips the item's common
  // indent first, so the ` +` is a literal plus, not a break; the
  // reader re-types that one HardLineBreak (see retypeLiteralPlus).
  test("reflow does not place + at end of line in list item", async () => {
    const input = ". item\n +\n";
    const result = await formatAdoc(input);
    for (const outputLine of result.split("\n")) {
      expect(outputLine).not.toMatch(/ \+$/v);
    }
  });

  // Fuzz counterexample: the INDENTED ` +` continuation line is
  // absorbed into the list item text (an indented `+` is not a
  // continuation marker), and the trailing `+` is rewritten to
  // `{plus}` so reflow cannot create an accidental hard line
  // break. `{plus}` (not `\+`) because backslash is not a
  // recognized escape for `+` in Asciidoctor — `\+` rendered a
  // literal backslash, while `{plus}` renders `+`.
  test("reflow escapes + continuation that would create hard break", async () => {
    const input = ". item\n +\n// c\n";
    const out = await formatAdoc(input);
    expect(out).toBe(". item {plus}\n// c\n");
    // The oracle makes a literal `+` of a whitespace-only ` +` line
    // (NOT a hard line break — Asciidoctor strips the item's indent
    // first, leaving a bare `+`). `{plus}` is the formatter's escape
    // for that character and Asciidoctor renders it as the numeric
    // reference for the very same one, which `renderedHtml` reads as
    // that character.
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});

describe("inline emphasis reflow", () => {
  // Emphasis spans should reflow like normal text — breaking
  // only where needed to fit printWidth, not on every space.
  test("italic emphasis reflows without over-breaking", async () => {
    const input = "_word word word word_\n";
    const result = await formatAdoc(input, { printWidth: 15 });
    // Should break only where needed, not on every space.
    // With printWidth=15, "_word word" (10 chars) fits,
    // then "word word_" (10 chars) fits on the next line.
    expect(result).toBe("_word word word\nword_\n");
  });

  test("bold emphasis reflows without over-breaking", async () => {
    const input = "*word word word word word*\n";
    const result = await formatAdoc(input, { printWidth: 15 });
    expect(result).toBe("*word word word\nword word*\n");
  });
});

// fill() alignment: when inline formatting nodes (italic, bold,
// xref, monospace) are adjacent to text without whitespace
// (e.g. `_word_,`), the fill() content/separator alternation
// must be preserved so that line breaks happen correctly.
describe("inline formatting respects printWidth", () => {
  // Italic followed by comma: `_bravo_,` has no space at
  // the junction. Without alignment-aware flattening, the
  // comma lands in a fill() separator slot and breaks all
  // subsequent line-break decisions.
  test("italic followed by punctuation does not overflow", async () => {
    const input =
      "alpha _bravo_, charlie delta echo foxtrot " +
      "golf hotel india juliet kilo lima mike.\n";
    const result = await formatAdoc(input, { printWidth: 40 });
    for (const line of result.trimEnd().split("\n")) {
      expect(line.length).toBeLessThanOrEqual(40);
    }
  });

  // Xref in parentheses: `(<<target,label>>)` — three
  // children (text "(", xref, text ")") all lack whitespace
  // at boundaries, so fill() alignment shifts twice.
  test("xref in parentheses does not overflow", async () => {
    const input =
      "see the spec (<<rfc1234,RFC 1234>>) " +
      "for more detail on this topic.\n";
    const result = await formatAdoc(input, { printWidth: 30 });
    for (const line of result.trimEnd().split("\n")) {
      expect(line.length).toBeLessThanOrEqual(30);
    }
  });

  // Bold span in a list item followed by a colon: the
  // list item printer assembles fill() parts the same way
  // paragraphs do, so it needs the same alignment fix.
  test("bold in list item does not overflow", async () => {
    const input =
      "* **Term one** (see <<ref>>): alpha bravo " +
      "charlie delta echo foxtrot golf hotel.\n";
    const result = await formatAdoc(input, { printWidth: 40 });
    for (const line of result.trimEnd().split("\n")) {
      expect(line.length).toBeLessThanOrEqual(40);
    }
  });

  // Monospace followed by punctuation: same pattern as
  // italic — closing backtick directly before comma.
  test("monospace followed by punctuation does not overflow", async () => {
    const input =
      "run `deploy`, then check the logs " +
      "for errors in the output stream.\n";
    const result = await formatAdoc(input, { printWidth: 30 });
    for (const line of result.trimEnd().split("\n")) {
      expect(line.length).toBeLessThanOrEqual(30);
    }
  });
});

// Reflow inside list items with inline macros must be
// idempotent — the same line breaks on first and second pass.
describe("list item reflow idempotency", () => {
  test("callout list with bold and mailto", async () => {
    const input =
      "<.> item\n" +
      "some **x** text\n" +
      "email mailto:a @example.com[]\n" +
      "see <<a, >>\n";
    const first = await formatAdoc(input);
    const second = await formatAdoc(first);
    expect(second).toBe(first);
  });

  test("unordered list with attr entry and mono", async () => {
    const input = "- item\n:a: value\nsome ``x`` text\n- item\n";
    const first = await formatAdoc(input);
    const second = await formatAdoc(first);
    expect(second).toBe(first);
  });

  test("ordered list with inline url", async () => {
    const input =
      ". item\n" +
      "see https://a.example.com[text] here\n" +
      "some `x` text\n" +
      ". item\n";
    const first = await formatAdoc(input);
    const second = await formatAdoc(first);
    expect(second).toBe(first);
  });

  test("callout list with mailto and role", async () => {
    const input =
      "<1> item\n" +
      "email mailto:a@example.com[]\n" +
      "[.role]#text#\n" +
      "<.> item\n";
    const first = await formatAdoc(input);
    const second = await formatAdoc(first);
    expect(second).toBe(first);
  });
});

describe("dlist separator join hazard", () => {
  // `first line\nterm:: definition` is ONE paragraph to Asciidoctor (a
  // dlist cannot interrupt a paragraph). Joining the lines would put
  // `term::` on the block's first line, which IS a dlist. The reflow
  // must keep a break before the separator word.
  test("keeps the break before a `::` word that was not on line 1", async () => {
    const input = "first line\nterm:: definition\nlast line\n";
    const out = await formatAdoc(input);
    expect(out).toBe("first line\nterm:: definition last line\n");
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  test("hazard word inside a later inline sibling is still guarded", async () => {
    const input = "a line\n*bold* term:: x\n";
    const out = await formatAdoc(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  test("a `::` word already on line 1 is left alone", async () => {
    // Not a dlist only because the word is mid-line; reflow may join
    // freely and the rendering must stay identical.
    const input = "see foo:: here\nand more\n";
    const out = await formatAdoc(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
  });

  // A hazard word can be GLUED to the preceding inline sibling —
  // here `)::` has no whitespace before it, so it belongs to the
  // link's fused run. The break has to land in front of the whole
  // run; breaking between the link and `)::` would insert a space
  // the source never had and change the rendered text.
  test("breaks before a run the hazard word is glued to", async () => {
    const input = "first line\nsee https://example.com[x]):: def\n";
    const out = await formatAdoc(input);
    expect(out).toBe("first line see\nhttps://example.com[x]):: def\n");
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  // A hard line break already forces a break before the hazard
  // word, so the guard must harden nothing and add nothing — a
  // second separator here would emit a blank line and split the
  // paragraph in two.
  test("adds no blank line after a hard line break", async () => {
    const input = "a +\nterm:: x\n";
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  // Rule 3 must not override the bare-`+` rule: breaking right
  // after `+` would put ` +` at end of line, which Asciidoctor
  // re-parses as a hard line break. The break has to go in front of
  // the whole `+ c::` run instead.
  test("does not break between a bare `+` and a hazard word", async () => {
    const input = "a line\nb + c:: d\n";
    const out = await formatAdoc(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  // Same rule where the paragraph is long enough that fill() would
  // otherwise pack the `+` onto the first output line.
  test("keeps a bare `+` off a line end when a hazard follows", async () => {
    const input = `${"word ".repeat(14)}\nalpha + bravo:: charlie\n`;
    const out = await formatAdoc(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  // A hazard word inside a formatting span belongs to the
  // PARAGRAPH's line numbering, not the span's. Stopping the lookup
  // at the span would disable the guard and turn the paragraph into
  // a description list.
  test.each([
    ["bold", "a line\n*term:: x*\n"],
    ["italic", "a line\n_term:: x_\n"],
    ["a nested span", "a line\n*_term:: x_*\n"],
    ["a span carrying the newline", "*a\nterm:: x*\n"],
  ])("guards a hazard word inside %s", async (_name, input) => {
    const out = await formatAdoc(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  // A hazard word that is ALSO block syntax at column 0. Breaking
  // in front of it would trade a description list for a listing
  // block, so it has to fuse to the preceding inline sibling and
  // the break goes in front of the whole run.
  test.each([
    ["a fenced-code prefix", "a line\n*b* ```js:: x\n"],
    ["a listing delimiter", "a line\n*b* ----:: x\n"],
    ["a block title", "a line\n*b* .Title:: x\n"],
  ])("fuses %s to the preceding sibling", async (_name, input) => {
    const out = await formatAdoc(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  // The same boundary for a RAW word: a comment marker that opens a
  // text node must fuse onto the preceding inline sibling, or fill()
  // could start a line with `//` and comment out everything it
  // packed after it.
  test("never starts a line with a comment from a following sibling", async () => {
    const input = "aaaa *b* // comment cc dd\n";
    const options = { printWidth: 12 };
    const out = await formatAdoc(input, options);
    expect(out.split("\n").some((l) => l.startsWith("//"))).toBe(false);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out, options)).toBe(out);
  });

  // Same fusing without any hazard word: a narrow printWidth would
  // otherwise let fill() break right before the fence word.
  test("never starts a line with a word from a following sibling", async () => {
    const input = "aaaa *b* ```js cc\n";
    const options = { printWidth: 12 };
    const out = await formatAdoc(input, options);
    expect(out.split("\n").some((l) => l.startsWith("```"))).toBe(false);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out, options)).toBe(out);
  });

  // Ruby's DescriptionListRx anchors its term group to the LINE, not
  // to a word, so a separator that stands alone still opens a dlist
  // once anything precedes it on the line (`<dt>bar </dt>`). Joining
  // such a line onto the block's first output line would invent one.
  test.each([
    ["a bare separator word", "foo\nbar :: baz\n"],
    ["a separator glued to an inline span", "foo\nbar `code`:: baz\n"],
  ])("guards %s on a later line", async (_name, input) => {
    const out = await formatAdoc(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  // The other three separator spellings and a multi-word term are
  // separate code paths through DLIST_SEPARATOR_WORD's alternation,
  // so each gets its own oracle check rather than trusting `::`.
  test.each([
    ["`:::`", "first line\nfoo::: x\n"],
    ["`::::`", "first line\nfoo:::: x\n"],
    ["`;;`", "first line\nfoo;; x\n"],
    ["a multi-word term", "first line\nmulti word term:: def\n"],
  ])("guards %s on a later line", async (_name, input) => {
    const out = await formatAdoc(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});

describe("reflow safety is driven by the line-shape registry", () => {
  test("a block-title-shaped word may land at column 0 mid-paragraph", async () => {
    // Inside a paragraph a `.gitignore`-shaped line is TEXT, to
    // Asciidoctor and to us: the reader classifies every line in the
    // context it arrives in, and a block title cannot start on a
    // paragraph's continuation line. So reflow may wrap right before
    // the word and needs no glue for it. Width 20 forces that wrap.
    const input = "aaaa bbbb cccc dddd .gitignore eeee\n";
    const out = await formatAdoc(input, { printWidth: 20 });
    expect(out).toBe("aaaa bbbb cccc dddd\n.gitignore eeee\n");
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
  });

  test("an interrupting shape is still glued away from column 0", async () => {
    const input = "aaaa bbbb cccc dddd [x] eeee\n";
    const out = await formatAdoc(input, { printWidth: 20 });
    expect(out.split("\n").some((l) => l.startsWith("[x]"))).toBe(false);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
  });

  // A bare list-marker word carries no trailing text, so the registry's
  // marker patterns (`^\* `, `^\. `, `^<1> `) do not match it on its
  // own. Reflow must still keep it off column 0 inside a list item,
  // where the very next word would supply that trailing text and split
  // the item into two. Hence the word-plus-text probe in
  // isBlockSyntaxAtLineStart.
  test.each([
    ["an unordered marker", "*"],
    ["a dash marker", "-"],
    ["an ordered marker", "."],
    ["a callout marker", "<1>"],
  ])("never starts a list-item line with %s", async (_name, hazard) => {
    const input = `* aaaa bbbb cccc dddd ${hazard} eeee ffff\n`;
    const options = { printWidth: 20 };
    const out = await formatAdoc(input, options);
    // Continuation lines are indented, and AnyListRx allows leading
    // whitespace, so the marker is just as dangerous at column 2.
    const [, ...rest] = out.split("\n");
    expect(rest.some((l) => l.trimStart().startsWith(hazard))).toBe(false);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out, options)).toBe(out);
  });

  // A raw line is not an interrupter — the reader consumes a comment
  // or preprocessor directive before block structure exists — but it
  // is every bit as destructive at column 0, where it swallows the
  // words fill() packed after it. Reflow therefore asks the registry
  // for these shapes too (see isBlockSyntaxAtLineStart).
  test.each([
    ["a bare comment marker", "//"],
    ["a comment", "//foo"],
    ["a conditional directive", "ifdef::x[]"],
  ])("never starts a line with %s", async (_name, hazard) => {
    const input = `aaaa bbbb cccc dddd ${hazard} eeee ffff\n`;
    const options = { printWidth: 20 };
    const out = await formatAdoc(input, options);
    expect(out.split("\n").some((l) => l.startsWith(hazard))).toBe(false);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out, options)).toBe(out);
  });

  // A `term::` word is NOT part of this rule, and the omission is
  // deliberate: it interrupts from ANY column of a list-item line, so
  // keeping it off column 0 would buy nothing, and adding it here
  // would fight the DLIST_HAZARD_BREAK guard (fusing the hazard word
  // backwards puts the whole run on the very line that guard exists
  // to keep it off — it turned `*a\nterm:: x*` into a description
  // list). That guard covers only one case: a hazard word reaching a
  // PARAGRAPH's first output line. In a list item nothing guards it,
  // and on a paragraph's first SOURCE line nothing guards the reverse
  // direction either. Both are recorded below.

  // KNOWN GAP (dlist support, tracked with #9 / follow-up issue TBD).
  // `read_lines_for_list_item` matches DescriptionListRx against the
  // whole line, so any continuation line of a list item that carries
  // a `::` word opens a nested description list, wherever the word
  // sits. Wrapping an item whose text contains one therefore changes
  // the rendering, and no line-START rule can prevent it: the fix is
  // to keep such a word on the item's first output line (or to parse
  // and print the dlist properly). Predates this task.
  test.fails(
    "wrapping a list item never invents a description list",
    async () => {
      const input = "* aa bb cc dd ee ff term:: gg\n";
      const options = { printWidth: 20 };
      const out = await formatAdoc(input, options);
      expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    },
  );

  // The same rule seen from the LINE the term sits on: in a list
  // item Asciidoctor matches DescriptionListRx against the whole
  // source line, so `cccc term:: dddd` is one dlist item whose term
  // is "cccc term". The BlockReader reads that line as a dlist item
  // of its own (the `dlistTerm` kind ends the item's text), so it is
  // printed as a line of its own and never wrapped — which is what
  // keeps the whole term.
  test("wrapping keeps a list item's whole dlist term", async () => {
    const input = "* aaaa bbbb\ncccc term:: dddd\n";
    const options = { printWidth: 14 };
    const out = await formatAdoc(input, options);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
  });

  // KNOWN GAP (dlist support, tracked with #9 / follow-up issue TBD).
  // The mirror case: a `::` word on a paragraph's FIRST source line
  // makes the block a description list to Asciidoctor. We parse it as
  // a paragraph instead, so fill() is free to wrap in front of the
  // word — and the dlist the source described disappears. The guard
  // above only pushes hazard words OFF the first line; nothing keeps
  // one that started there in place. Predates this task.
  test.fails("wrapping never dissolves a description list", async () => {
    const input = "aaaa bbbb cccc dddd term:: eeee ffff\n";
    const options = { printWidth: 20 };
    const out = await formatAdoc(input, options);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
  });

  // The mirror image: shapes that only classify as block syntax on a
  // block's FIRST line are plain text on line 2 of a paragraph, so
  // whether reflow glues them or not the rendering must not move.
  test.each([
    ["a block title", ".gitignore"],
    ["an admonition label", "NOTE:"],
    ["a section marker", "=="],
    ["a block macro", "image::x[]"],
  ])("leaves the rendering untouched for %s", async (_name, shape) => {
    const input = `aaaa bbbb cccc dddd ${shape} eeee ffff\n`;
    const options = { printWidth: 20 };
    const out = await formatAdoc(input, options);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out, options)).toBe(out);
  });
});

// A `term::` line ends a list item's text (the oracle nests a dlist in
// the `<li>`), but dlists are not modelled as nodes yet (issue #9), so
// the reader reads the description as an ordinary paragraph attached to
// the item. It reads the SAME way whether the term line is flush left
// or indented, which is what makes these converge: the old block lexer
// let the line's indentation pick the branch — flush left it came back
// as inline text, indented (which is how the printer had just emitted
// it) it became an attached block. Two passes, two answers.
describe("a description-list term inside a list item", () => {
  test.each([
    ["a sibling item follows", "* a\nterm:: def\n* b\n"],
    ["the printer's own output", "* a\n  term:: def\n* b\n"],
    ["nothing follows", "* a\nterm:: def\n"],
  ])("converges when %s", async (_name, input) => {
    const out = await formatAdoc(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});
