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
