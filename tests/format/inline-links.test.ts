/**
 * Format tests for inline links, cross-references, and inline
 * anchors — verifies that the printer produces correct output
 * and that these constructs round-trip cleanly.
 */
import { describe, test, expect } from "vitest";
import { formatAdoc } from "../helpers.js";

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
});
