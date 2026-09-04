/**
 * Parser tests for inline links, cross-references, and inline
 * anchors. Verifies that the inline parser produces the correct
 * AST nodes for URLs, link macros, xrefs, and anchors.
 */
import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import type { InlineNode } from "../../src/ast.js";
import { asParagraph, narrow } from "../helpers.js";

/**
 * Parses AsciiDoc input and returns the inline nodes of
 * its first paragraph. Shorthand for the common test
 * pattern of inspecting inline link/xref results.
 * @param input - AsciiDoc source containing one paragraph
 * @returns the inline children of the first paragraph
 */
function inlineNodes(input: string): InlineNode[] {
  const document = parse(input);
  return asParagraph(document.children[0]).children;
}

describe("inline links — bare URLs", () => {
  test("bare https URL → link node with no text", () => {
    const nodes = inlineNodes("https://example.com\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "link");
    expect(node0.target).toBe("https://example.com");
    expect(node0.text).toBeUndefined();
  });

  test("bare http URL → link node", () => {
    const nodes = inlineNodes("http://example.com\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "link");
    expect(node0.target).toBe("http://example.com");
    expect(node0.text).toBeUndefined();
  });

  test("bare URL with path → link node", () => {
    const nodes = inlineNodes("https://example.com/path/to/page\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "link");
    expect(node0.target).toBe("https://example.com/path/to/page");
  });

  test("bare URL in text → text + link + text", () => {
    const nodes = inlineNodes("Visit https://example.com today\n");
    expect(nodes).toHaveLength(3);
    const [node0, node1, node2] = nodes;
    narrow(node0, "text");
    narrow(node1, "link");
    narrow(node2, "text");
    expect(node0.value).toBe("Visit ");
    expect(node1.target).toBe("https://example.com");
    expect(node1.text).toBeUndefined();
    expect(node2.value).toBe(" today");
  });

  // `form` is what tells the printer to write the bare URL back rather
  // than a `link:` macro; only an InlineMacroNode spells the macro.
  test("a bare URL records the `url` form it was written in", () => {
    const [node0] = inlineNodes("https://example.com\n");
    narrow(node0, "link");
    expect(node0.form).toBe("url");
  });
});

describe("inline links — URLs with display text", () => {
  // Empty brackets are not display text, but they ARE the group that
  // ends the target's run of characters (InlineLinkRx, rx.rb l.524),
  // so the node holds an empty string and the printer writes the
  // brackets back. Undefined is reserved for a URL that never wrote
  // any group at all. This used to be undefined for both, which let
  // the printer drop the `[]` and the target swallow whatever stood
  // behind it.
  test("URL with EMPTY brackets keeps an empty text on the node", () => {
    const nodes = inlineNodes("https://example.com[]\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "link");
    expect(node0.target).toBe("https://example.com");
    expect(node0.text).toBe("");
  });

  // A bare URL with no bracket group at all: nothing to write back.
  test("URL with NO brackets has no text on the node", () => {
    const nodes = inlineNodes("https://example.com\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "link");
    expect(node0.text).toBeUndefined();
  });

  test("https URL with text → link node with text", () => {
    const nodes = inlineNodes("https://example.com[Example Site]\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "link");
    expect(node0.target).toBe("https://example.com");
    expect(node0.text).toBe("Example Site");
  });

  test("URL with text in surrounding text", () => {
    const nodes = inlineNodes("See https://example.com[here] for details\n");
    expect(nodes).toHaveLength(3);
    expect(nodes[0].type).toBe("text");
    const [, node1] = nodes;
    narrow(node1, "link");
    expect(nodes[2].type).toBe("text");
    expect(node1.target).toBe("https://example.com");
    expect(node1.text).toBe("here");
  });
});

describe("inline links — link macro", () => {
  test("link:path[text] → inlineMacro node", () => {
    const nodes = inlineNodes("link:path/to/file.html[Link Text]\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "inlineMacro");
    expect(node0.name).toBe("link");
    expect(node0.target).toBe("path/to/file.html");
    expect(node0.attrlist).toBe("Link Text");
  });

  test("link macro in text", () => {
    const nodes = inlineNodes("See link:docs/guide.html[the guide] for help\n");
    expect(nodes).toHaveLength(3);
    expect(nodes[0].type).toBe("text");
    const [, node1] = nodes;
    narrow(node1, "inlineMacro");
    expect(nodes[2].type).toBe("text");
    expect(node1.name).toBe("link");
    expect(node1.target).toBe("docs/guide.html");
    expect(node1.attrlist).toBe("the guide");
  });

  test("link:path[] (empty brackets) → inlineMacro with empty attrlist", () => {
    const nodes = inlineNodes("link:path/to/file.html[]\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "inlineMacro");
    expect(node0.name).toBe("link");
    expect(node0.target).toBe("path/to/file.html");
    expect(node0.attrlist).toBe("");
  });
});

describe("inline links — mailto", () => {
  test("mailto:user@example.com[Email] → inlineMacro node", () => {
    const nodes = inlineNodes("mailto:user@example.com[Email]\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "inlineMacro");
    expect(node0.name).toBe("mailto");
    expect(node0.target).toBe("user@example.com");
    expect(node0.attrlist).toBe("Email");
  });

  test("mailto:addr[] (empty brackets) → inlineMacro with empty attrlist", () => {
    const nodes = inlineNodes("mailto:user@example.com[]\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "inlineMacro");
    expect(node0.name).toBe("mailto");
    expect(node0.target).toBe("user@example.com");
    expect(node0.attrlist).toBe("");
  });
});

describe("inline links - bare email addresses", () => {
  test("a bare address alone is one link node, form `email`", () => {
    const nodes = inlineNodes("user@example.com\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "link");
    expect(node0.form).toBe("email");
    expect(node0.target).toBe("user@example.com");
    expect(node0.text).toBeUndefined();
  });

  test("an address mid-sentence splits the run into text + link + text", () => {
    const nodes = inlineNodes("Write to user@example.com today\n");
    expect(nodes).toHaveLength(3);
    const [node0, node1, node2] = nodes;
    narrow(node0, "text");
    narrow(node1, "link");
    narrow(node2, "text");
    expect(node0.value).toBe("Write to ");
    expect(node1.target).toBe("user@example.com");
    expect(node2.value).toBe(" today");
  });

  // The `_` inside the local part is a WORD character to Ruby
  // (`CC_WORD` is `\p{Alphabetic}\p{N}\p{Pc}`), so it belongs to the
  // address. Before the address was a construct, the tokenizer broke
  // this run into `Write to dan`, a stray `_`, and `rosen@example.com`.
  test("an underscore in the local part stays inside the address", () => {
    const nodes = inlineNodes("Write to dan_rosen@example.com today\n");
    expect(nodes).toHaveLength(3);
    const [, node1] = nodes;
    narrow(node1, "link");
    expect(node1.target).toBe("dan_rosen@example.com");
  });

  // Ruby's InlineEmailRx has no left word boundary: it scans left to
  // right and matches at the first position that works, so the whole
  // glued word is the address (measured on the oracle).
  test("a word character glued in front joins the address", () => {
    const nodes = inlineNodes("xuser@example.com here\n");
    const [node0] = nodes;
    narrow(node0, "link");
    expect(node0.target).toBe("xuser@example.com");
  });

  test("the address stops before trailing punctuation", () => {
    const nodes = inlineNodes("Write to user@example.com, then wait\n");
    const [, node1, node2] = nodes;
    narrow(node1, "link");
    narrow(node2, "text");
    expect(node1.target).toBe("user@example.com");
    expect(node2.value).toBe(", then wait");
  });

  test.each([
    // Ruby's guard capture `([\\>:/])?`: where one of these stands in
    // front, substitutors.rb's email arm returns the match unlinked.
    ["a backslash escape", "Write to \\user@example.com today\n"],
    ["a slash in front", "Write to a/user@example.com today\n"],
    ["a colon in front", "Write to a:user@example.com today\n"],
    // The domain's TLD is `[a-zA-Z]{2,5}`; six letters is not one.
    ["a six-letter TLD", "Write to user@example.museum today\n"],
    ["a one-letter TLD", "Write to user@example.c today\n"],
    ["no TLD at all", "Write to user@localhost today\n"],
    // The domain must open with an alphanumeric and end in a
    // dot-plus-letters TLD, so a bare IPv4 host is not an address.
    ["a numeric host", "Write to user@192.168.1.1 today\n"],
    ["no local part", "Write to @example.com today\n"],
  ])("%s is not an address", (_name, source) => {
    const nodes = inlineNodes(source);
    expect(nodes.map((node) => node.type)).not.toContain("link");
  });

  test.each([
    ["a plus-addressed local", "user+tag@example.com"],
    ["a dotted local", "doc.writer@example.com"],
    ["a percent in the local", "user%x@example.com"],
    ["a hyphen in the local", "a-b@example.com"],
    // `&` stands where the oracle sees `&amp;`: its email arm runs
    // after sub_specialchars, the tokenizer reads the author's bytes.
    ["an ampersand in the local", "a&b@example.com"],
    ["a subdomain", "user@mail.corp.example.com"],
    ["mixed case", "User@Example.COM"],
    ["a trailing dot in the local", "user.@example.com"],
  ])("%s is part of the address", (_name, address) => {
    const nodes = inlineNodes(`Write to ${address} today\n`);
    const [, node1] = nodes;
    narrow(node1, "link");
    expect(node1.target).toBe(address);
  });

  test("a `mailto:` macro still wins over the bare address in it", () => {
    const nodes = inlineNodes("mailto:user@example.com[Email]\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "inlineMacro");
    expect(node0.name).toBe("mailto");
  });

  test("a URL carrying an `@` stays one URL link", () => {
    const nodes = inlineNodes("See https://example.com/a@b.com now\n");
    const [, node1] = nodes;
    narrow(node1, "link");
    expect(node1.form).toBe("url");
    expect(node1.target).toBe("https://example.com/a@b.com");
  });

  test("two addresses on one line are two link nodes", () => {
    const nodes = inlineNodes("Mail a@example.com and b@example.org now\n");
    const links = nodes.filter((node) => node.type === "link");
    expect(links).toHaveLength(2);
  });
});

describe("inline cross-references", () => {
  test("<<section-id>> → xref node with target", () => {
    const nodes = inlineNodes("<<section-id>>\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "xref");
    expect(node0.target).toBe("section-id");
    expect(node0.text).toBeUndefined();
  });

  // The counterpart of the link `form` row above: `shorthand` is what
  // tells the printer to write the angle brackets back.
  test("a `<<…>>` xref records the `shorthand` form it was written in", () => {
    const [node0] = inlineNodes("<<section-id>>\n");
    narrow(node0, "xref");
    expect(node0.form).toBe("shorthand");
  });

  test("<<section-id,Custom Text>> → xref with text", () => {
    const nodes = inlineNodes("<<section-id,Custom Text>>\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "xref");
    expect(node0.target).toBe("section-id");
    expect(node0.text).toBe("Custom Text");
  });

  test("xref in text → text + xref + text", () => {
    const nodes = inlineNodes("See <<section-id>> for details\n");
    expect(nodes).toHaveLength(3);
    expect(nodes[0].type).toBe("text");
    const [, node1] = nodes;
    narrow(node1, "xref");
    expect(nodes[2].type).toBe("text");
    expect(node1.target).toBe("section-id");
  });

  test("xref:doc#anchor[Text] → inlineMacro node", () => {
    const nodes = inlineNodes("xref:other-doc.adoc#anchor[Text]\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "inlineMacro");
    expect(node0.name).toBe("xref");
    expect(node0.target).toBe("other-doc.adoc#anchor");
    expect(node0.attrlist).toBe("Text");
  });

  test("xref macro in text", () => {
    const nodes = inlineNodes(
      "Read xref:guide.adoc#setup[the setup guide] first\n",
    );
    expect(nodes).toHaveLength(3);
    expect(nodes[0].type).toBe("text");
    const [, node1] = nodes;
    narrow(node1, "inlineMacro");
    expect(nodes[2].type).toBe("text");
    expect(node1.name).toBe("xref");
    expect(node1.target).toBe("guide.adoc#setup");
    expect(node1.attrlist).toBe("the setup guide");
  });

  test("xref:target[] (empty brackets) → inlineMacro with empty attrlist", () => {
    const nodes = inlineNodes("xref:guide.adoc#setup[]\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "inlineMacro");
    expect(node0.name).toBe("xref");
    expect(node0.target).toBe("guide.adoc#setup");
    expect(node0.attrlist).toBe("");
  });

  test("<<id,text with commas>> → first comma splits", () => {
    // Only the first comma delimits id from text; any subsequent
    // commas are part of the display text. This mirrors the ASG
    // rule: `text` captures everything after the first comma.
    const nodes = inlineNodes("<<section-id,text with, commas>>\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "xref");
    expect(node0.target).toBe("section-id");
    expect(node0.text).toBe("text with, commas");
    expect(node0.form).toBe("shorthand");
  });
});

describe("inline anchors", () => {
  test("[[id]] → inline anchor node", () => {
    // `[[id]]` is parsed as an inline anchor wherever it appears
    // inside inline content. This test confirms the node is
    // correctly extracted when surrounded by text.
    const nodes = inlineNodes("text [[inline-anchor]] more\n");
    expect(nodes).toHaveLength(3);
    expect(nodes[0].type).toBe("text");
    const [, node1] = nodes;
    narrow(node1, "inlineAnchor");
    expect(nodes[2].type).toBe("text");
    expect(node1.id).toBe("inline-anchor");
    expect(node1.reftext).toBeUndefined();
  });

  test("[[id, reftext]] → anchor with the VERBATIM post-comma bytes", () => {
    // The two-argument form `[[id, reftext]]` captures the post-comma
    // spelling byte-for-byte — the author's separating space
    // INCLUDED — so a grammar-rejected id can print back faithfully.
    // The trimmed view is the printer's, taken at serialize time on
    // the valid-id arm only (anchorToSource, serialize-inline.ts).
    const nodes = inlineNodes("text [[term-id, Term Display Text]] more\n");
    expect(nodes).toHaveLength(3);
    expect(nodes[0].type).toBe("text");
    const [, node1] = nodes;
    narrow(node1, "inlineAnchor");
    expect(nodes[2].type).toBe("text");
    expect(node1.id).toBe("term-id");
    expect(node1.reftext).toBe(" Term Display Text");
  });

  test("no separating space means no captured space", () => {
    const [, node1] = inlineNodes("x [[term-id,Term]]\n");
    narrow(node1, "inlineAnchor");
    expect(node1.reftext).toBe("Term");
  });

  // A comma with nothing (or only blanks) after it is captured
  // VERBATIM like every other post-comma spelling (issue #53): the
  // empty string for `[[id,]]`, the lone space for `[[id, ]]`. The
  // difference is load-bearing at print time - the oracle reads
  // `[[id, ]]` as a live anchor and `[[id,]]` as literal TEXT
  // (InlineAnchorRx's reftext needs a character after the comma), so
  // anchorToSource replays the first normalized and the second
  // byte-verbatim. Both spellings sit INSIDE text so that one rule
  // covers both: `[[id, ]]` alone on a line IS a block-anchor line
  // and would reach the block layer instead.
  test.each([
    ["[[id,]]", ""],
    ["[[id, ]]", " "],
  ])("%s → anchor with the verbatim blank reftext", (anchor, reftext) => {
    const [, node1] = inlineNodes(`x ${anchor}\n`);
    narrow(node1, "inlineAnchor");
    expect(node1.id).toBe("id");
    expect(node1.reftext).toBe(reftext);
  });

  test("inline anchor in text", () => {
    const nodes = inlineNodes("This is [[anchor-here]]some anchored text\n");
    expect(nodes).toHaveLength(3);
    expect(nodes[0].type).toBe("text");
    const [, node1] = nodes;
    narrow(node1, "inlineAnchor");
    expect(nodes[2].type).toBe("text");
    expect(node1.id).toBe("anchor-here");
  });
});

describe("inline links — mixed with formatting", () => {
  test("*bold https://example.com[link]* → bold containing text + link", () => {
    const nodes = inlineNodes("*bold https://example.com[link]*\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "bold");
    expect(node0.children).toHaveLength(2);
    const {
      children: [textChild, linkChild],
    } = node0;
    expect(textChild.type).toBe("text");
    narrow(linkChild, "link");
    expect(linkChild.target).toBe("https://example.com");
    expect(linkChild.text).toBe("link");
  });

  test("xref inside italic: _see <<ref>>_ → italic with text + xref", () => {
    const nodes = inlineNodes("_see <<ref>>_\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "italic");
    expect(node0.children).toHaveLength(2);
    expect(node0.children[0].type).toBe("text");
    expect(node0.children[1].type).toBe("xref");
  });
});
