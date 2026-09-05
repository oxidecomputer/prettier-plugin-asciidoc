/**
 * Format tests for inline links, cross-references, and inline
 * anchors — verifies that the printer produces correct output
 * and that these constructs round-trip cleanly.
 */
import { describe, test, expect } from "vitest";
import { formatAdoc, oracleHtml, renderedHtml } from "../helpers.js";
import { shapes } from "../parser/inline-shape.js";

describe("inline links — format output", () => {
  test("bare URL is preserved", async () => {
    const input = "https://example.com\n";
    expect(await formatAdoc(input)).toBe("https://example.com\n");
  });

  test("URL with text is preserved", async () => {
    const input = "https://example.com[Example Site]\n";
    expect(await formatAdoc(input)).toBe("https://example.com[Example Site]\n");
  });

  test("http URL is preserved", async () => {
    const input = "http://example.com/path\n";
    expect(await formatAdoc(input)).toBe("http://example.com/path\n");
  });

  test("link macro is preserved", async () => {
    const input = "link:path/to/file.html[Link Text]\n";
    expect(await formatAdoc(input)).toBe("link:path/to/file.html[Link Text]\n");
  });

  test("mailto link is preserved", async () => {
    const input = "mailto:user@example.com[Email]\n";
    expect(await formatAdoc(input)).toBe("mailto:user@example.com[Email]\n");
  });

  test("link macro with empty brackets is preserved", async () => {
    const input = "link:path/to/file.html[]\n";
    expect(await formatAdoc(input)).toBe("link:path/to/file.html[]\n");
  });

  test("mailto with empty brackets is preserved", async () => {
    const input = "mailto:user@example.com[]\n";
    expect(await formatAdoc(input)).toBe("mailto:user@example.com[]\n");
  });

  test("URL in text is preserved", async () => {
    const input = "See https://example.com[here] for details.\n";
    expect(await formatAdoc(input)).toBe(
      "See https://example.com[here] for details.\n",
    );
  });

  test("bare URL in text is preserved", async () => {
    const input = "Visit https://example.com today.\n";
    expect(await formatAdoc(input)).toBe("Visit https://example.com today.\n");
  });
});

describe("inline xrefs — format output", () => {
  test("<<ref>> is preserved", async () => {
    const input = "<<section-id>>\n";
    expect(await formatAdoc(input)).toBe("<<section-id>>\n");
  });

  test("<<ref,text>> is preserved", async () => {
    const input = "<<section-id,Custom Text>>\n";
    expect(await formatAdoc(input)).toBe("<<section-id,Custom Text>>\n");
  });

  test("xref macro is preserved", async () => {
    const input = "xref:other-doc.adoc#anchor[Text]\n";
    expect(await formatAdoc(input)).toBe("xref:other-doc.adoc#anchor[Text]\n");
  });

  test("xref macro with simple ID preserves macro form", async () => {
    const input = "xref:simple-id[Custom Text]\n";
    expect(await formatAdoc(input)).toBe("xref:simple-id[Custom Text]\n");
  });

  test("xref macro with empty brackets is preserved", async () => {
    const input = "xref:guide.adoc#setup[]\n";
    expect(await formatAdoc(input)).toBe("xref:guide.adoc#setup[]\n");
  });

  test("<<ref,text with commas>> is preserved", async () => {
    const input = "<<section-id,text with, commas>>\n";
    expect(await formatAdoc(input)).toBe("<<section-id,text with, commas>>\n");
  });

  test("xref in text is preserved", async () => {
    const input = "See <<section-id>> for details.\n";
    expect(await formatAdoc(input)).toBe("See <<section-id>> for details.\n");
  });
});

describe("inline anchors — format output", () => {
  test("[[id]] in text is preserved", async () => {
    const input = "text [[anchor-id]] more\n";
    expect(await formatAdoc(input)).toBe("text [[anchor-id]] more\n");
  });

  test("[[id, reftext]] in text is preserved", async () => {
    const input = "text [[term-id, Term Display Text]] more\n";
    expect(await formatAdoc(input)).toBe(
      "text [[term-id, Term Display Text]] more\n",
    );
  });

  test("inline anchor in text is preserved", async () => {
    const input = "This is [[anchor-here]]some anchored text.\n";
    expect(await formatAdoc(input)).toBe(
      "This is [[anchor-here]]some anchored text.\n",
    );
  });
});

describe("inline links — mixed formatting round-trips", () => {
  test("*bold link* round-trips", async () => {
    const input = "*bold https://example.com[link]*\n";
    expect(await formatAdoc(input)).toBe("*bold https://example.com[link]*\n");
  });

  test("link + formatting round-trips", async () => {
    const input = "See https://example.com[here] and *bold*.\n";
    expect(await formatAdoc(input)).toBe(
      "See https://example.com[here] and *bold*.\n",
    );
  });

  test("formatting round-trips", async () => {
    const input = "See https://example.com[here] and <<ref,text>>.\n";
    expect(await formatAdoc(input)).toBe(input);
  });
});

describe("inline links — reflow", () => {
  test("reflow wraps around link", async () => {
    const input =
      "Some text before https://example.com[link text] and after that more words.\n";
    const result = await formatAdoc(input, { printWidth: 30 });
    // Link is atomic (not broken), wrapping happens
    // around it.
    expect(result).toContain("https://example.com[link text]");
  });

  test("reflow wraps around xref", async () => {
    const input = "Some text before <<section-id,display text>> and after.\n";
    const result = await formatAdoc(input, { printWidth: 30 });
    expect(result).toContain("<<section-id,display text>>");
  });
});

describe("inline links — edge cases", () => {
  test("triple angle bracket xref", async () => {
    const input = "see <<a, >>\nsee <<<a,>>\n";
    const first = await formatAdoc(input);
    const second = await formatAdoc(first);
    expect(second).toBe(first);
  });

  test("inline url with special chars", async () => {
    const input = "see https://a.example.com for info\nsee xref:a[text]\n";
    const first = await formatAdoc(input);
    const second = await formatAdoc(first);
    expect(second).toBe(first);
  });

  // An EMPTY attrlist is what ENDS a bare URL. InlineLinkRx (rx.rb
  // l.524) takes the target up to a bracket group whose interior is
  // allowed to be empty, and only the group that follows stops the
  // target's own run of characters. So the `[]` is not decoration:
  // without it the URL keeps eating, and the bytes behind it land
  // inside the href. Dropping it turned `https://e.com[]*b*` into
  // `https://e.com*b*`, which renders one link whose target is
  // `https://e.com*b*` where the input renders a link and a bold `b`.
  test.each([
    ["a bold span", "https://e.com[]*b*\n"],
    ["an italic span", "https://e.com[]_b_\n"],
    ["a monospace span", "https://e.com[]`b`\n"],
    ["a bare word", "https://e.com[]x\n"],
    ["another bracket group", "https://e.com[][c]\n"],
    ["nothing at all", "https://e.com[]\n"],
  ])("the empty attrlist survives in front of %s", async (_name, input) => {
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});

// Issue #1: bracketed inline constructs can span source lines —
// the InlineUrl and InlineMacro token patterns match `[...]` text
// across newlines. The printer must not re-emit the raw newline:
// a multi-line token makes the output layout depend on the input
// layout, breaking idempotency, and the embedded newline corrupts
// fill() width accounting.
describe("inline links — source newlines normalized on output", () => {
  test("link text spanning source lines is joined", async () => {
    const input = "See https://example.com[some link\ntext] end.\n";
    const result = await formatAdoc(input);
    expect(result).toContain("https://example.com[some link text]");
  });

  // Characterization, not a bug pin: the XrefShorthand and
  // InlineAnchor token patterns exclude `\n`, so their text can
  // never span lines — a multi-line "xref" parses as plain text
  // and is joined by ordinary reflow. The printer-side newline
  // collapse for xrefs/anchors is defense-in-depth only.
  test("xref text spanning source lines is joined", async () => {
    const input = "See <<section-id,some xref\ntext>> end.\n";
    const result = await formatAdoc(input);
    expect(result).toContain("<<section-id,some xref text>>");
  });

  // Exception to the joining rule: a line ending in ` +` inside
  // the bracketed text is an AsciiDoc hard line break. Joining
  // it would turn the break into a literal mid-text `+`
  // (dropping the <br>), so such links keep their source layout.
  test("hard line break inside link text is preserved", async () => {
    const input = "See https://example.com[text +\nmore] end.\n";
    const first = await formatAdoc(input);
    expect(first).toBe(input);
    expect(await formatAdoc(first)).toBe(first);
  });

  test("macro attrlist spanning source lines is joined", async () => {
    const input = "See link:file.html[some link\ntext] end.\n";
    const result = await formatAdoc(input);
    expect(result).toContain("link:file.html[some link text]");
  });
});

// The shorthand's post-comma bytes reach the link as
// `link_text.lstrip` (substitutors.rb l.746), so a blank after the
// comma is not data. A TRAILING blank is: nothing strips it, and it
// renders inside the anchor. The inline-anchor serializer has always
// trimmed the same edge and only that edge.
describe("a shorthand xref's text loses its leading blank, not its trailing one", () => {
  test.each([
    [
      "a blank after the comma",
      "<<a, b>> x\n\n[[a]]y\n",
      "<<a,b>> x\n\n[[a]]y\n",
    ],
    ["several blanks", "<<a,   b>> x\n\n[[a]]y\n", "<<a,b>> x\n\n[[a]]y\n"],
    ["a tab", "<<a,\tb>> x\n\n[[a]]y\n", "<<a,b>> x\n\n[[a]]y\n"],
    [
      "blanks on BOTH sides — only the leading one goes",
      "<<a, b >> x\n\n[[a]]y\n",
      "<<a,b >> x\n\n[[a]]y\n",
    ],
    [
      "text that is nothing but blanks",
      "<<a,   >> x\n\n[[a]]y\n",
      "<<a,>> x\n\n[[a]]y\n",
    ],
    [
      "no text at all is untouched",
      "<<a>> x\n\n[[a]]y\n",
      "<<a>> x\n\n[[a]]y\n",
    ],
  ])("%s", async (_name, input, expected) => {
    const out = await formatAdoc(input);
    expect(out).toBe(expected);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});

/**
 * A bare URL never takes the delimiter that closes a span (issue
 * #150).
 *
 * `sub_quotes` runs BEFORE `sub_macros` (`NORMAL_SUBS`,
 * substitutors.rb l.16, the list `apply_subs` walks in order), so the
 * quote pass has already paired its delimiters by the time
 * `InlineLinkRx` (rx.rb l.526) reads what is left: the link is built
 * from the text INSIDE the span, and a mark standing at the end of a
 * URL run belongs to the span, not to the address.
 *
 * Reading the URL through the delimiter instead lost the span
 * outright, and with it the shelter its interior stands in: the tab
 * in each row below rendered inside `<code>`/`<strong>` and folded to
 * a space once the span was gone. The URL is still read WHOLE
 * wherever no span wants its last character - src/parse/inline/
 * rules.ts's SuperscriptMark row says why that divergence from Ruby's
 * pass order is deliberate and what it buys.
 */
describe("a URL stops at the delimiter that closes a span", () => {
  const MONOSPACE = "`a\thttps://e.com`";
  const BOLD = "**a\thttps://e.com/x**";

  test.each([
    [MONOSPACE, String.raw`monospacec["a\t",link]`],
    [BOLD, String.raw`boldu["a\t",link]`],
  ])("%j is a span holding the address", (source, shape) => {
    expect(shapes(source)).toEqual([shape]);
  });

  test.each([
    [MONOSPACE, '<code>a\t<a href="https://e.com" class="bare">'],
    [BOLD, '<strong>a\t<a href="https://e.com/x" class="bare">'],
  ])("%j is what the oracle renders", async (source, html) => {
    expect(await oracleHtml(source)).toContain(html);
  });

  // Only the monospace row can carry a BYTE claim about the tab: the
  // render lens folds whitespace everywhere but `<pre>` and `<code>`
  // (tests/helpers.ts), so the bold row's tab is invisible to it and
  // the row above is what holds that span's extent.
  test("the sheltered tab survives the round trip", async () => {
    const formatted = await formatAdoc(MONOSPACE);
    expect(formatted).toBe(`${MONOSPACE}\n`);
    expect(await renderedHtml(formatted)).toBe(await renderedHtml(MONOSPACE));
    expect(await formatAdoc(formatted)).toBe(formatted);
  });
});

/**
 * A delimiter standing INSIDE a bare URL's match still closes the
 * span (issue #152).
 *
 * The section above pins the case where the delimiter is the match's
 * LAST characters. The address does not stop there of its own accord,
 * though - `InlineLinkRx` (rx.rb l.526) runs on for as long as its
 * character class allows, so a URL followed by punctuation swallows
 * the delimiter whole and ends somewhere behind it. The quote pass
 * ran first all the same, and its row closes at the first delimiter
 * after its content, wherever in the URL's match that lands.
 *
 * Red before the fix, measured: no span at all, because a close had
 * to be the END of a token's image. The tab then stood in ordinary
 * prose and folded to a space INSIDE what the oracle renders as
 * `<code>`, which is whitespace-significant - the tier-1 shape #150
 * was filed for, reached by the half of the family that fix left
 * standing.
 *
 * Only an UNCONSTRAINED row reads a delimiter at an interior offset:
 * those rows test no boundary, so where the characters stand is the
 * whole question. A constrained row has a right lookahead to answer
 * and the only offset the token measured it for is its own end,
 * which is why `` `a https://e.com`, b` `` is not in this table.
 */
describe("a URL stops at a delimiter standing inside its match", () => {
  const MONOSPACE = "``a\thttps://e.com``, b``";
  const BOLD = "**a\thttps://e.com/x**, b**";

  test.each([
    [MONOSPACE, String.raw`monospaceu["a\t",link]`, '", b``"'],
    [BOLD, String.raw`boldu["a\t",link]`, '", b**"'],
  ])("%j is a span holding the address", (source, span, rest) => {
    expect(shapes(source)).toEqual([span, rest]);
  });

  test.each([
    [MONOSPACE, '<code>a\t<a href="https://e.com" class="bare">'],
    [BOLD, '<strong>a\t<a href="https://e.com/x" class="bare">'],
  ])("%j is what the oracle renders", async (source, html) => {
    expect(await oracleHtml(source)).toContain(html);
  });

  // The bytes behind the delimiter are the URL match's own, and they
  // belong OUTSIDE the span: the tail is text the printer writes back
  // where the source put it.
  test("the tail behind the delimiter is kept as text", async () => {
    const formatted = await formatAdoc(MONOSPACE);
    expect(formatted).toBe(`${MONOSPACE}\n`);
    expect(await renderedHtml(formatted)).toBe(await renderedHtml(MONOSPACE));
    expect(await formatAdoc(formatted)).toBe(formatted);
  });

  // The same close one level down, where the recursion has to rebase
  // it: the bold row resolves first, so the code span and its
  // interior close are INSIDE it and their indices are shifted by the
  // slice the recursion walks.
  test("an interior close survives being nested", async () => {
    const source = "**x ``a\thttps://e.com``, b`` y**";
    expect(shapes(source)).toEqual([
      'boldu["x ",monospaceu["a\\t",link],", b`` y"]',
    ]);
    expect(await renderedHtml(await formatAdoc(source))).toBe(
      await renderedHtml(source),
    );
  });

  // The narrowness, stated as a row: the constrained spelling of the
  // same document reads no interior delimiter at all, so its row runs
  // on to the backtick at the very end and takes the URL match whole
  // as content. That is the behaviour this document already had, and
  // it is unchanged.
  test("a constrained row reads no interior delimiter", async () => {
    const source = "`a\thttps://e.com`, b`";
    expect(shapes(source)).toEqual([String.raw`monospacec["a\t",link," b"]`]);
    expect(await formatAdoc(source)).toBe(`${source}\n`);
  });
});

/**
 * A match carrying TWO delimiters, and the spans on either side of
 * the cut (issue #152).
 *
 * `sub_quotes` runs over text and its gsub resumes immediately behind
 * the match it just wrote, so a second delimiter in the same URL run
 * OPENS the next span: `` ``a http://e.com``b``c<TAB>d`` `` is a code
 * span around the address, a literal `b`, and a second code span
 * around `c<TAB>d`. Reading the close as an offset inside a token
 * could not say that - the row would have to resume inside a token it
 * had already stepped over - so the stream is cut at the delimiter
 * instead and both spans are ordinary token pairs.
 *
 * Red before the fix: one span and a text run holding the rest, whose
 * tab then folded inside what the oracle renders as `<code>`.
 *
 * The rows below also hold the arithmetic a cut costs: every span
 * already resolved keeps its own tokens, whether it stands in front of
 * the cut, behind it, or carries a `[role]` of its own.
 */
describe("a match carrying two delimiters is cut at both", () => {
  const TWO_SPANS = "``a http://e.com``b``c<TAB>d``".replace("<TAB>", "\t");

  test("both spans are built, and the tab keeps its shelter", async () => {
    const source = TWO_SPANS;
    expect(shapes(source)).toEqual([
      String.raw`monospaceu["a ",link]`,
      '"b"',
      String.raw`monospaceu["c\td"]`,
    ]);
    expect(await oracleHtml(source)).toContain("<code>c\td</code>");
    const formatted = await formatAdoc(source);
    expect(formatted).toBe(`${source}\n`);
    expect(await renderedHtml(formatted)).toBe(await renderedHtml(source));
    expect(await formatAdoc(formatted)).toBe(formatted);
  });

  test.each([
    ["a span behind the cut", `${TWO_SPANS} **q**`, `${TWO_SPANS} *q*`],
    ["a role behind the cut", `${TWO_SPANS} [r]**q**`, `${TWO_SPANS} [r]*q*`],
    ["a span in front of the cut", `**q** ${TWO_SPANS}`, `*q* ${TWO_SPANS}`],
    // A role in FRONT of the cut stays where it is. Its span's own
    // tokens are all ahead of the splice, so shifting the role with
    // the ones behind would point it at a token that is not its
    // bracket group.
    [
      "a role in front of the cut",
      `[r]**q** ${TWO_SPANS}`,
      `[r]*q* ${TWO_SPANS}`,
    ],
  ])("%s", async (_name, input, expected) => {
    const output = await formatAdoc(input);
    expect(output).toBe(`${expected}\n`);
    expect(await renderedHtml(output)).toBe(await renderedHtml(input));
    expect(await formatAdoc(output)).toBe(output);
  });
});

/**
 * What the cut leaves for the row to go on reading (issues #150,
 * #152).
 *
 * Ruby's gsub resumes at the character BEHIND the match it wrote, so
 * two delimiters that abut are two delimiters and the content the next
 * match needs comes from whatever follows - the rest of this match or
 * the tokens behind it. Resuming one character further on made the
 * abutting pair invisible and cost the second span the tab it
 * sheltered.
 *
 * An ESCAPED delimiter is the other half. Every unconstrained row
 * carries the escape inside its own pattern, and `convert_quoted_text`
 * answers a match whose first character is that backslash by writing
 * the match back without it (substitutors.rb l.1420): no span, and the
 * bytes go on to the rows that run after. So an escaped delimiter may
 * CLOSE - nothing looks at what stands in front of a closer - and may
 * not OPEN, and a match whose later delimiters are escaped takes the
 * close it had before interior cuts existed, because the span those
 * bytes really carry is one a single pass cannot find.
 */
describe("the cut resumes where the gsub does", () => {
  test.each([
    // Two delimiters with nothing between them: the address stops at
    // the first and the second opens the span behind it.
    [
      "delimiters that abut",
      "``a http://e.com````b\t``",
      [String.raw`monospaceu["a ",link]`, String.raw`monospaceu["b\t"]`],
    ],
    // Three pairs, so the middle one is content of the second span
    // rather than a delimiter the scan re-reads.
    [
      "three pairs in one match",
      "``a http://e.com``````b\t``",
      [String.raw`monospaceu["a ",link]`, 'monospaceu["``b\\t"]'],
    ],
  ])("%s", async (_name, source, shape) => {
    expect(shapes(source)).toEqual(shape);
    const formatted = await formatAdoc(source);
    expect(formatted).toBe(`${source}\n`);
    expect(await renderedHtml(formatted)).toBe(await renderedHtml(source));
    expect(await formatAdoc(formatted)).toBe(formatted);
  });

  // The escape neighbourhood. Every row keeps the author's bytes: the
  // escaped delimiter behind the cut, the escaped delimiter AT the cut
  // (which closes, because a closer answers no escape), a doubled
  // backslash (the row's own `\\?` takes one, so the match still opens
  // with a backslash), and an escape a character further on.
  test.each([
    "``a http://e.com``\\``b``",
    "``a http://e.com\\``b``",
    "``a http://e.com``\\\\``b``",
    "``a http://e.com``x\\``b``",
    "``a http://e.com``\\``b\t``",
  ])("%j keeps its bytes around the escape", async (source) => {
    const formatted = await formatAdoc(source);
    expect(formatted).toBe(`${source}\n`);
    expect(await renderedHtml(formatted)).toBe(await renderedHtml(source));
    expect(await formatAdoc(formatted)).toBe(formatted);
  });

  // The printer's own half. A bare address at the end of a span's
  // content would swallow a SHORTENED closing mark, so the span keeps
  // its doubled spelling - without that, this document's second code
  // span is gone on the next pass and the tab it sheltered folds.
  // Asserted through TWO passes, because one pass looked right.
  test("a span behind an address keeps its doubled spelling", async () => {
    const source = "``a http://e.com``,``\t``";
    const first = await formatAdoc(source);
    expect(first).toBe(`${source}\n`);
    expect(await renderedHtml(first)).toBe(await renderedHtml(source));
    const second = await formatAdoc(first);
    expect(second).toBe(first);
  });
});

/**
 * The mark a bare address would SWALLOW (issues #150, #152).
 *
 * A bare URL's match runs on through every character its class admits
 * (`bareAddressRunsPast`, src/parse/inline/rules.ts), so a mark that
 * stands inside it when the document is read again is one the reader
 * has to cut the match at - and an unconstrained row is cut wherever
 * the delimiter stands, a constrained one only at the match's end. So
 * behind an address the two spellings are not interchangeable, and the
 * span keeps the doubled one.
 *
 * Both marks are asked about. The CLOSING one stands in the match
 * where the span's own content ends with an address; the OPENING one
 * does where the address stands earlier and nothing between them
 * writes whitespace or a bracket. Red before the fix, measured: the
 * second row's span was shortened and its code span was gone on the
 * next pass, taking the tab it sheltered with it.
 */
describe("a span keeps its doubled spelling behind an address", () => {
  test.each([
    ["the address ends the content", "See ``a http://e.com`` now."],
    ["the address stands earlier in the block", "``a http://e.com``,``b\tb``"],
    ["the address stands beside the mark", "See https://e.com``b`` now."],
  ])("%s", async (_name, source) => {
    const first = await formatAdoc(source);
    expect(first).toBe(`${source}\n`);
    expect(await renderedHtml(first)).toBe(await renderedHtml(source));
    expect(await formatAdoc(first)).toBe(first);
  });

  // The narrowness, and it is the address's own class that draws it: a
  // bracket ends the match, so a span behind one is shortened as any
  // other is. The pin "an address with a span behind it still respells
  // the span" (email-autolink.test.ts) is the same statement for
  // whitespace.
  test.each([
    // Between the address and the mark.
    [
      "an anchor",
      "See https://e.com[[a]]``b`` now.",
      "See https://e.com[[a]]`b` now.",
    ],
    // The address's OWN bracket group, which ends its match at the `]`
    // before the closing mark is reached at all.
    [
      "the address's own attrlist",
      "See ``a https://e.com[t]`` now.",
      "See `a https://e.com[t]` now.",
    ],
  ])("%s ends the match", async (_name, source, expected) => {
    expect(await formatAdoc(source)).toBe(`${expected}\n`);
    expect(await renderedHtml(await formatAdoc(source))).toBe(
      await renderedHtml(source),
    );
  });
});
