/**
 * Format tests for `+` list continuations (issues #2 and #6).
 *
 * A line containing only `+` directly after a list item's text
 * attaches the following paragraph to the item as a separate
 * block. The formatter must keep the `+` alone on its line and
 * print the attached paragraph flush left — folding them into
 * the item's principal paragraph destroys the document
 * structure (the item renders as one paragraph with stray `+`
 * characters).
 */
import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import {
  asParagraph,
  expectFormatted,
  expectStableRender,
  firstList,
  formatAdoc,
  renderedHtml,
} from "../helpers.js";

describe("list continuation formatting", () => {
  // The blank line before the second item is dropped: a blank line
  // between two items of one list separates nothing (Asciidoctor's
  // `parse_list` skips it before reading the next item), so the list
  // prints as one run of items. Rendering is unchanged.
  test("continuation paragraphs survive round-trip", async () => {
    const input =
      "* first item text.\n" +
      "+\n" +
      "First continuation paragraph.\n" +
      "+\n" +
      "Second continuation paragraph.\n" +
      "\n" +
      "* second item.\n";
    await expectFormatted(input, input.replace("\n\n* second", "\n* second"));
  });

  test("issue #2 repro is preserved and idempotent", async () => {
    const input =
      "* first item: a paragraph that is part of a bulleted list, long enough to wrap\n" +
      "  across more than one line in the source.\n" +
      "+\n" +
      "A continuation paragraph attached to the first item with a `+` line. It should\n" +
      "render as a second paragraph of the same list item.\n" +
      "+\n" +
      "A second continuation paragraph, also attached.\n" +
      "\n" +
      "* second item, unrelated.\n";
    const first = await formatAdoc(input);
    // The `+` lines survive as continuations: alone on their
    // lines, with the attached paragraphs flush left. The blank
    // line before the second item goes (same list, see above).
    expect(first).toBe(input.replace("\n\n* second", "\n* second"));
    await expectStableRender(input);
  });

  test("attached paragraph reflows flush left", async () => {
    const input =
      "* item text.\n" +
      "+\n" +
      "This attached paragraph is long enough that the formatter needs to wrap it across more than one line.\n";
    const result = await formatAdoc(input);
    const lines = result.trimEnd().split("\n");
    expect(lines[0]).toBe("* item text.");
    expect(lines[1]).toBe("+");
    // Attached paragraph lines are flush left (no continuation
    // indent — they belong to the attached block, not to the
    // item's principal paragraph).
    for (const line of lines.slice(2)) {
      expect(line).toMatch(/^\S/v);
    }
    await expectStableRender(input);
  });

  test("continuation works on ordered list items", async () => {
    const input = ". item text.\n+\nAttached paragraph.\n";
    await expectFormatted(input, input);
  });

  test("continuation attaches to a nested item", async () => {
    const input = "* parent\n** nested item.\n+\nAttached to nested.\n";
    await expectFormatted(input, input);
  });

  test("inline code span containing + is not escaped", async () => {
    const input = "* item with a `+` code span.\n";
    await expectFormatted(input, input);
  });

  test("plus code span in continuation paragraph is not escaped", async () => {
    const input = "* item text.\n+\nAttached with a `+` span.\n";
    await expectFormatted(input, input);
  });

  // A `+` line at the very end of an item (no block follows
  // inside the item) attaches nothing here, but Asciidoctor
  // attaches whatever block comes NEXT — even across a blank
  // line. The bare `+` line is therefore re-emitted verbatim so
  // the rendered document is unchanged.
  test("a + reaches across one blank line and attaches the paragraph", async () => {
    const input = "* item text\n+\n\nA separate paragraph.\n";
    // `read_lines_for_list_item` buffers ONE blank line after a `+`
    // as content, so the paragraph attaches (the oracle puts it
    // inside the item); the printer replays the recorded gap
    // VERBATIM — collapsing the blank could change what a
    // later `+` means, and the byte round-trip is idempotent by
    // construction. Two blank lines would end the list.
    await expectFormatted(input, input);
  });

  // Asciidoctor renders `+` after `+` at the end of an item as
  // nothing at all: the FIRST `+` is erased the moment the second
  // line arrives (`buffer[-1] = ListContinuationPlaceholder`,
  // parser.rb l.1439 — an empty String TAGGED with
  // `ListContinuationMarker`, where 2.0.20 wrote a plain `''`) and the
  // second is popped as the optional trailing continuation
  // (l.1580-82). Neither byte reaches the rendering, so the run
  // leaves the item exactly as it found it. Both bytes are written
  // back (issue #181): the erased byte stands right behind the popped
  // one with nowhere else to print, so it rides along on the same
  // fact, and a re-read pops the SECOND of the pair again and erases
  // the first the same way.
  test("a trailing + run writes both bytes the source held", async () => {
    const input = "* item\n+\n+\n";
    await expectFormatted(input, "* item\n+\n+\n");
  });

  // A lone `+` line inside a plain (non-list) paragraph terminates
  // the paragraph there: the oracle renders two paragraphs, the
  // second reading "+ para two" (the `+` is text, not consumed).
  // This used to be merged into one paragraph — issue #17, fixed
  // when paragraph reading moved into the reader.
  //
  // The `+` KEEPS the line the source gave it (issue #43). Rendering
  // is the same either way — the oracle joins the two lines back into
  // one paragraph — but `+ para two` is a line our own reader no
  // longer reads as a continuation, and one alphabet symbol away
  // (`+` then `term:: def`) the same join manufactures a
  // description-list term.
  test("plus line between plain paragraphs splits the paragraph", async () => {
    const input = "para one\n+\npara two\n";
    await expectFormatted(input, "para one\n\n+\npara two\n");
  });

  // Asciidoctor right-trims lines before matching the
  // continuation marker, so `+ ` (trailing space) must attach
  // exactly like `+`. The output normalizes it to a bare `+`.
  test("+ line with trailing whitespace attaches", async () => {
    const input = "* item text.\n+ \nAttached paragraph.\n";
    await expectFormatted(input, "* item text.\n+\nAttached paragraph.\n");
    // A `+` line with trailing whitespace is still a marker —
    // Asciidoctor right-trims lines before matching, so one
    // invisible trailing space must not resurrect the folding
    // corruption.
    const { children } = parse(input);
    const {
      children: [item],
    } = firstList(children);
    expect(item.blocks).toHaveLength(1);
    expect(item.text[0]).toMatchObject({
      type: "text",
      value: "item text.",
    });
  });

  // A `+` line directly after a marker is content of the
  // attached paragraph (Asciidoctor renders `+ Attached`); it
  // must not be swallowed as a second marker.
  test("consecutive + lines do not delete content", async () => {
    const input = "* item\n+\n+\nAttached\n";
    // The second `+` is content (Asciidoctor renders `+ Attached`);
    // it is kept on its own line rather than folded into the
    // paragraph text, because a `+` that lands at the end of an
    // output line would become a hard break and one folded into a
    // `{plus}` would render new text.
    await expectFormatted(input, input);
    // A `+` line DIRECTLY after a marker is content of the
    // attached paragraph, not a second marker — treating it as a
    // marker would silently delete the `+` from the rendered
    // document (Asciidoctor renders `+ Attached` here). The frozen
    // `+` heads ONE folded paragraph — non-content-adjacent, so the
    // text after it folds in (parser.js l.1065) — with the `+` on a
    // verbatim raw line of its own, so the byte is printed back
    // exactly where it was written.
    expect(await renderedHtml(input)).toContain("<p>+ Attached</p>");
    const { children } = parse(input);
    const {
      children: [item],
    } = firstList(children);
    expect(item.blocks).toHaveLength(1);
    const [first, second] = asParagraph(item.blocks[0].block).children;
    expect(first).toMatchObject({ type: "rawLine", value: "+" });
    expect(second).toMatchObject({ type: "text", value: "Attached" });
  });

  // Indented content after `+` is a literal block: whitespace
  // is significant and must survive byte-for-byte (no reflow,
  // no re-indentation — a tab must stay a tab).
  test("indented content after + is preserved as a literal block", async () => {
    const input = "* item\n+\n  literal line\n";
    await expectFormatted(input, input);
    // Indented content after `+` is a literal block in
    // Asciidoctor — whitespace is significant and must not be
    // reflowed into a paragraph.
    const { children } = parse(input);
    const {
      children: [item],
    } = firstList(children);
    expect(item.blocks).toHaveLength(1);
    expect(item.blocks[0].block).toMatchObject({
      type: "delimitedBlock",
      variant: "literal",
      form: "indented",
      content: "  literal line",
    });
  });

  test("tab-indented content after + is preserved and idempotent", async () => {
    const input = "* item\n+\n\tliteral tab line\n";
    await expectFormatted(input, input);
  });

  test("continuation works on callout list items", async () => {
    const input = "<1> note text.\n+\nAttached paragraph.\n";
    await expectFormatted(input, input);
  });

  // Reflow must never break directly after a `+` inside a
  // formatting span: ` +` at end of line is a hard line break,
  // which both inserts a break and swallows the `+` from the
  // rendered text. The `+` glues forward to the next inline
  // sibling so fill() can only break before it.
  test("plus inside a span never lands at end of line", async () => {
    const input = "words `code + {attr}` after\n";
    const result = await formatAdoc(input, { printWidth: 14 });
    for (const outputLine of result.trimEnd().split("\n")) {
      expect(outputLine).not.toMatch(/ \+$/v);
    }
    await expectStableRender(input, { printWidth: 14 });
  });

  // The same rule OUTSIDE a monospace span, on the ordinary
  // (non-literal) text path: `code` above went through
  // appendLiteralText once #32 gave monospace content its own atom
  // path, which had stopped exercising the "space" glue arm of
  // src/print/inline.ts's trailingBoundary (a dangling `+` glued
  // forward to a following sibling). This row has no backticks, so
  // it stays on appendText and keeps that arm covered.
  test("plus outside a span never lands at end of line", async () => {
    const input = "words code + {attr} after\n";
    const result = await formatAdoc(input, { printWidth: 14 });
    for (const outputLine of result.trimEnd().split("\n")) {
      expect(outputLine).not.toMatch(/ \+$/v);
    }
    await expectStableRender(input, { printWidth: 14 });
  });

  // A bare `+` word inside an attached paragraph must survive
  // narrow-width reflow without becoming continuation syntax or
  // a hard break.
  test("attached paragraph with + word reflows safely", async () => {
    const input =
      "* item text.\n+\nAttached words + more attached words here.\n";
    const result = await formatAdoc(input, { printWidth: 20 });
    for (const outputLine of result.trimEnd().split("\n")) {
      expect(outputLine).not.toMatch(/ \+$/v);
    }
    // Exactly one bare `+` line: the continuation marker. If
    // reflow ever isolated the paragraph's `+` word on its own
    // line, re-parsing would see a second marker.
    const bareMarkers = result
      .trimEnd()
      .split("\n")
      .filter((outputLine) => outputLine === "+");
    expect(bareMarkers).toHaveLength(1);
    await expectStableRender(input, { printWidth: 20 });
  });
});

// Semantic fidelity: byte-level round-trips can still lie about
// meaning (a `+` folded into text may LOOK harmless), so assert
// that Asciidoctor renders the formatted output to the same HTML
// as the input for the whole continuation corpus. Entries the
// formatter normalizes are the load-bearing ones (they prove the
// rewrite preserved meaning); entries the formatter leaves
// byte-identical only guard against future output changes.
describe("list continuation formatting preserves rendered HTML", () => {
  const corpus: Record<string, string> = {
    "paragraph continuation": "* item text.\n+\nAttached paragraph.\n",
    "chained continuations":
      "* item.\n+\nFirst attached.\n+\nSecond attached.\n",
    "trailing-whitespace marker": "* item text.\n+ \nAttached paragraph.\n",
    "consecutive + lines": "* item\n+\n+\nAttached\n",
    "trailing consecutive + markers": "* item\n+\n+\n",
    "indented literal after +": "* item\n+\n  literal line\n",
    "mixed indented-then-flush segment":
      "* item\n+\n  literal line\nflush paragraph line\n",
    "alternating indented and flush lines": "* item\n+\n  lit\nflush\n  lit2\n",
    "tab-indented literal after +": "* item\n+\n\tliteral tab line\n",
    "dangling + before paragraph": "* item text\n+\n\nA separate paragraph.\n",
    "ordered list continuation": ". item text.\n+\nAttached paragraph.\n",
    "callout continuation": "<1> note text.\n+\nAttached paragraph.\n",
    "nested item continuation":
      "* parent\n** nested item.\n+\nAttached to nested.\n",
    "code span with plus": "* item with a `+` code span.\n",
    "attached literal block":
      "* item:\n+\n....\nliteral block content\n....\n+\nafter the block.\n\n* item two.\n",
    "attached listing block": "* item:\n+\n----\ncode here\n----\n",
    "attached parent block": "* item:\n+\n====\nexample text\n====\n",
    "block then split paragraphs":
      "* item:\n+\n----\ncode\n----\n+\npara one\n+\npara two\n",
    "block paragraph block chain":
      "* item:\n+\n----\none\n----\n+\npara\n+\n----\ntwo\n----\n",
    "dangling + before block across blank line":
      "* item\n+\n\n....\nliteral\n....\n",
    "attached [NOTE] admonition block":
      "** {empty}\n+\n[NOTE]\n====\nAre these examples sufficient?\n====\n",
    "attached [source] listing":
      "* item:\n+\n[source,ruby]\n----\ncode\n----\n",
    "attached titled block": "* item:\n+\n.Title\n----\ncode\n----\n",
    "attached anchored block": "* item:\n+\n[[id]]\n----\ncode\n----\n",
    "attached [NOTE] paragraph": "* item:\n+\n[NOTE]\nnote paragraph\n",
    "attached block macro": "* item:\n+\nimage::diagram.png[]\n",
    "attached thematic break": "* item:\n+\n'''\n",
    "metadata block then + paragraph":
      "* i:\n+\n[source]\n----\na\n----\n+\nafter para\n",
    "+ before section heading": "* i:\n+\n== Heading\n",
    "metadata without adjacent anchor": "* i:\n+\n[NOTE]\n\n====\nx\n====\n",
    "markers inside metadata-anchored paragraph":
      "* i\n+\n[NOTE]\npara one\n+\npara two\n",
    "trailing marker after [NOTE] paragraph":
      "* i\n+\n[NOTE]\npara\n+\n----\nc\n----\n",
  };

  for (const [name, input] of Object.entries(corpus)) {
    test(`renders identically: ${name}`, async () => {
      await expectStableRender(input);
    });
  }
});

// Whether a list is still OPEN at a `+` line decides whether that
// `+` attaches a block to an item or is just the first word of an
// ordinary paragraph. Asciidoctor's rule
// (`read_lines_for_list_item`): after a blank line an item keeps
// reading only for a `+`, a nested marker, or a literal paragraph —
// anything else ends the list.
describe("whether a list is still open at a + line", () => {
  const cases: Array<[string, string]> = [
    // The blank line is followed by ordinary text, so the list is
    // closed by the time the `+` appears: two paragraphs, the second
    // reading "+ second".
    [
      "a + in a paragraph after a closed list",
      "* item\n\nfirst para\n+\nsecond\n",
    ],
    // A blank line BETWEEN items does not close the list.
    ["a blank line between items", "* one\n\n* two\n+\npara\n* three\n"],
    // A `+` chain that resumes after a delimited block: the scan has
    // to step over the block, whose content may contain blank lines.
    [
      "a + chain after a delimited block",
      "* item\n+\n----\ncode\n\nmore code\n----\n+\nattached\n* next\n",
    ],
    // A detached continuation: the `+` directly after the blank line
    // keeps the list open.
    ["a detached continuation", "* item\n\n+\npara\n* next\n"],
  ];
  for (const [name, input] of cases) {
    test(`${name} round-trips`, async () => {
      await expectStableRender(input);
    });
  }
});

// The ancestry scan steps over a delimited block in one move, which
// means finding the block's OPENER from its closing line. A Markdown
// fence breaks string equality — ```` ```ruby ```` is closed by
// ```` ``` ```` — and losing the opener lost the whole ancestry, so
// the sibling marker after the block stopped ending the item.
/**
 * Count the list items in rendered HTML — the structure the
 * ancestry scan exists to preserve.
 * @param html - rendered HTML from the oracle
 * @returns the number of `<li>` elements
 */
function listItemCount(html: string): number {
  return (html.match(/<li>/gv) ?? []).length;
}

describe("a + chain resumes after any delimited block", () => {
  const blocks: Array<[string, string]> = [
    ["fence with a language hint", "```ruby\ncode\n```"],
    ["listing", "----\ncode\n----"],
    ["open block", "--\nob\n--"],
    ["example", "====\nex\n===="],
    ["comment block", "////\nc\n////"],
  ];
  for (const [name, block] of blocks) {
    test(`${name} keeps the list ancestry`, async () => {
      const input = `* item\n+\n${block}\n+\npara\n* next\n`;
      await expectStableRender(input);
    });
  }

  // A fence with NO language hint still implies the `source` style,
  // so normalizing it to `----` has to carry a bare `[source]` with
  // it or Asciidoctor renders a plain `<pre>` instead of
  // `<pre class="highlight"><code>`. Full rendering equality, not
  // just the item count, is what pins that.
  test("a fence with no language hint keeps the list structure", async () => {
    const input = "* item\n+\n```\ncode\n```\n+\npara\n* next\n";
    const out = await formatAdoc(input);
    await expectStableRender(input);
    expect(listItemCount(await renderedHtml(out))).toBe(
      listItemCount(await renderedHtml(input)),
    );
  });
});

// Asciidoctor's reader rstrips every line before the parser sees it
// (`Helpers.prepare_source_string`), so a delimiter with trailing
// spaces is still a delimiter. The formatter emits it trimmed: the
// spaces were never part of the document Asciidoctor read.
describe("delimiters with trailing whitespace", () => {
  const cases: Array<[string, string]> = [
    ["listing", "----  \ncode\n----\n"],
    ["example", "====  \nex\n====\n"],
    ["comment block", "////  \nc\n////\n"],
    ["open block", "--  \nob\n--\n"],
    ["listing after a list item", "* item\n----  \ncode\n----\n"],
  ];
  for (const [name, input] of cases) {
    test(`${name} is still a delimiter`, async () => {
      const out = await formatAdoc(input);
      await expectStableRender(input);
      expect(out.includes("  \n")).toBe(false);
    });
  }
});

// A `+` does not have to touch the block it attaches. Asciidoctor's
// `read_lines_for_list_item` lets block metadata (a block title, an
// attribute list, an anchor, an attribute entry), the lines the
// reader eats (comments, directives), and ONE blank line play out
// between the marker and the block's first content line. Every one
// of those lines used to hide the `+` from the paragraph classifier,
// which then read the paragraph with the plain-paragraph rule set
// and swallowed the next sibling item.
describe("a + continuation reaches across block metadata", () => {
  const cases: Array<[string, string]> = [
    ["a block title", "* a\n+\n.Title\npara\n* b\n"],
    ["an admonition attribute list", "* a\n+\n[NOTE]\nnote text\n* b\n"],
    ["a role attribute list", "* a\n+\n[.role]\npara\n* b\n"],
    ["a block anchor", "* a\n+\n[[x]]\npara\n* b\n"],
    ["an attribute entry", "* a\n+\n:x: y\npara\n* b\n"],
    ["two metadata lines", "* a\n+\n[.lead]\n.Title\npara\n* b\n"],
    ["a line comment", "* a\n+\n// c\npara\n* b\n"],
    ["one blank line", "* a\n+\n\npara\n* b\n"],
    ["an ordered list's numbering", ". a\n+\n.Title\npara\n. b\n. c\n"],
  ];
  for (const [name, input] of cases) {
    test(`${name} keeps the sibling item`, async () => {
      await expectStableRender(input);
    });
  }

  // Comment lines and blank lines are NOT interchangeable, and the
  // order decides. `read_lines_for_list_item` reads comment lines
  // like any other content (it calls `reader.read_line`, with no
  // comment skipping of its own), so a comment resets `continuation`
  // from `:active` to `:inactive`; a blank line does not. Once
  // inactive, the next blank line makes the following content line
  // hit the `prev_line.empty?` branch, which breaks. Conditional
  // directives stay transparent — `PreprocessorReader` eats them
  // before the parser sees a line at all.
  const orders: Array<[string, string]> = [
    ["blank then content", "* a\n+\n\npara\n* b\n"],
    ["comment then content", "* a\n+\n// c\npara\n* b\n"],
    ["comment then blank", "* a\n+\n// c\n\npara\n* b\n"],
    ["blank then comment", "* a\n+\n\n// c\npara\n* b\n"],
    ["blank, metadata, blank", "* a\n+\n\n.T\n\npara\n* b\n"],
    ["metadata then blank", "* a\n+\n.T\n\npara\n* b\n"],
    ["two blanks then metadata", "* a\n+\n\n\n.T\npara\n* b\n"],
  ];
  for (const [name, input] of orders) {
    test(`${name} matches the oracle`, async () => {
      await expectStableRender(input);
    });
  }

  // Was a known gap: the pair's two lines fell on either side of the
  // list boundary, a blank landed between the `endif` and the
  // paragraph, and the continuation was abandoned. It closed when the
  // item scan stopped spending the `+` on a directive line
  // (`activeContent`, list-reader.ts): the pair now stays inside the
  // item with the block the `+` attached.
  test("a conditional then blank keeps the item", async () => {
    const input = "* a\n+\nifdef::x[]\nendif::[]\n\npara\n* b\n";
    await expectStableRender(input);
  });

  // TWO blank lines DO end the list: `read_lines_for_list_item`
  // stops at the second one, so the paragraph is a top-level
  // sibling and `* b` starts a brand new list.
  test("two blank lines end the list", async () => {
    const input = "* a\n+\n\n\npara\n* b\n";
    await expectStableRender(input);
  });

  // …and when what follows the two blanks is a NESTED MARKER, the
  // item keeps the nested list but the `+` is ERASED. The formatted
  // bytes are the loudest witness: Asciidoctor renders `* a` / `+` /
  // `** b` and `* a` / `** b` identically, so an oracle comparison
  // cannot see a `+` written back. This is the assertion the reader
  // row "+ then TWO blanks then a nested marker" cannot make on its
  // own (tests/parser/reader-lists.test.ts).
  test("two blanks then a nested marker keeps the dead + verbatim", async () => {
    const input = "* a\n+\n\n\n** b\n* c\n";
    // The `+` is dead to Ruby (two blanks erased it) and the old
    // printer dropped the whole run; the gap is now replayed VERBATIM
    // (the bytes are the author's), and the byte
    // round-trip is idempotent by construction. Rendering unchanged
    // either way.
    await expectFormatted(input, input);
  });
});

// A marker-shaped line inside a `+`-attached paragraph is plain
// TEXT — the oracle renders `more ** b` as one paragraph — but its
// POSITION is load-bearing: `read_lines_for_list_item` flips
// `within_nested_list` on any line matching a nestable list marker,
// and that flag decides whether the NEXT `+` line is erased (a real
// continuation) or kept as text. Reflowing the marker off column 0
// turned the following `+` from literal text into a continuation.
describe("a foreign list marker keeps its own line", () => {
  const cases: Array<[string, string]> = [
    ["a nested marker before a second +", "* a\n+\nmore\n** b\n+\npara\n* c\n"],
    ["an ordered marker in a * list", "* a\n+\nmore\n. b\nlast\n"],
    [
      "a dlist term before a second +",
      "* a\n+\nmore\nterm:: def\n+\npara\n* c\n",
    ],
    // A TOP-LEVEL `+` has no list around it, so `within_nested_list`
    // — a local of `read_lines_for_list_item` — never exists and the
    // rule must not fire: the marker-shaped line is ordinary text
    // that reflow may join like any other.
    ["no list is open at all", "+\npara\n* item\nmore\n"],
    ["a top-level + after a paragraph", "first\n\n+\npara\n* b\nmore\n"],
  ];
  for (const [name, input] of cases) {
    test(`${name} round-trips`, async () => {
      await expectStableRender(input);
    });
  }
});

// The same rule reached through a TAB gap. `ListRxMap`'s patterns
// take `[ \t]+` between marker and text, but the registry's style
// extractors once looked ahead for a single SPACE, so a tab-gapped
// marker line resolved to NO style, matched no open list, and was
// joined into the `+`-attached paragraph, while `interruptsByLineShape`
// went on calling the same line block syntax. Measured over 1,408
// continuation shapes: 316 render-breaks under the space-only
// spelling, 0 under `[ \t]`, 0 regressions. The hole was never the
// ordered families': the `*`, `-` and `.` rows below broke
// identically before the fix.
describe("a tab-gapped marker line is seen like a space-gapped one", () => {
  test.each([
    ["a sibling star", "* a\n+\npara\n*\tnext\n"],
    ["a nested star", "* a\n+\npara\n**\tnext\n"],
    ["a dash sibling", "- a\n+\npara\n-\tnext\n"],
    ["an implicit ordered sibling", ". a\n+\npara\n.\tnext\n"],
    ["a foreign ordered marker in a star list", "* a\n+\npara\n.\tnext\n"],
    ["an explicit arabic sibling", "1. a\n+\npara\n2.\tnext\n"],
    ["an explicit alpha sibling", "a. a\n+\npara\nb.\tnext\n"],
    ["an explicit roman sibling", "i) a\n+\npara\nii)\tnext\n"],
    ["a foreign explicit marker in a star list", "* a\n+\npara\n1.\tnext\n"],
    ["a callout sibling", "<1> a\n+\npara\n<2>\tnext\n"],
  ])("%s round-trips", async (_name, input) => {
    await expectStableRender(input);
  });
});
