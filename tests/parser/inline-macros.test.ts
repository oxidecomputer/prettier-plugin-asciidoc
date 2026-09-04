/**
 * Parser tests for inline macros: image, icon, kbd, btn, menu,
 * footnote, footnoteref, pass, stem, latexmath, and asciimath.
 * Verifies that the inline parser produces the correct
 * InlineMacroNode for each type.
 */
import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import type { InlineNode } from "../../src/ast.js";
import { asParagraph, narrow } from "../helpers.js";

/**
 * Parses AsciiDoc input and returns the inline nodes of
 * its first paragraph.
 * @param input - AsciiDoc source containing one paragraph
 * @returns the inline children of the first paragraph
 */
function inlineNodes(input: string): InlineNode[] {
  const document = parse(input);
  return asParagraph(document.children[0]).children;
}

// ── Inline image ────────────────────────────────────────────

describe("inline image", () => {
  test("image:target[alt] → inlineMacro node", () => {
    const nodes = inlineNodes("image:sunset.jpg[Sunset]\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "inlineMacro");
    expect(node0.name).toBe("image");
    expect(node0.target).toBe("sunset.jpg");
    expect(node0.attrlist).toBe("Sunset");
  });

  // The whole macro is one span — `name:target[attrlist]` — so the
  // node ends past the closing bracket, not at the target.
  test("the node spans the whole macro, brackets included", () => {
    const [node0] = inlineNodes("image:a.png[x]\n");
    narrow(node0, "inlineMacro");
    expect(node0.position).toEqual({
      start: { offset: 0, line: 1, column: 1 },
      end: { offset: 14, line: 1, column: 15 },
    });
  });

  test("image with empty alt text", () => {
    const nodes = inlineNodes("image:logo.png[]\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "inlineMacro");
    expect(node0.name).toBe("image");
    expect(node0.target).toBe("logo.png");
    expect(node0.attrlist).toBe("");
  });

  test("image in surrounding text", () => {
    const nodes = inlineNodes("See image:icon.svg[Icon] here.\n");
    expect(nodes).toHaveLength(3);
    const [node0, node1, node2] = nodes;
    narrow(node0, "text");
    narrow(node1, "inlineMacro");
    narrow(node2, "text");
    expect(node0.value).toBe("See ");
    expect(node1.name).toBe("image");
    expect(node1.target).toBe("icon.svg");
    expect(node1.attrlist).toBe("Icon");
    expect(node2.value).toBe(" here.");
  });

  test("image with path target", () => {
    const nodes = inlineNodes("image:images/photo.jpg[A photo]\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "inlineMacro");
    expect(node0.name).toBe("image");
    expect(node0.target).toBe("images/photo.jpg");
    expect(node0.attrlist).toBe("A photo");
  });
});

// ── Keyboard macro ──────────────────────────────────────────

describe("kbd macro", () => {
  test("kbd:[keys] → inlineMacro node", () => {
    const nodes = inlineNodes("kbd:[Ctrl+C]\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "inlineMacro");
    expect(node0.name).toBe("kbd");
    expect(node0.attrlist).toBe("Ctrl+C");
  });

  test("kbd in surrounding text", () => {
    const nodes = inlineNodes("Press kbd:[Enter] to continue.\n");
    expect(nodes).toHaveLength(3);
    const [node0, node1, node2] = nodes;
    narrow(node0, "text");
    narrow(node1, "inlineMacro");
    narrow(node2, "text");
    expect(node1.name).toBe("kbd");
    expect(node1.attrlist).toBe("Enter");
  });

  test("kbd with multi-key combo", () => {
    const nodes = inlineNodes("kbd:[Ctrl+Shift+T]\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "inlineMacro");
    expect(node0.name).toBe("kbd");
    expect(node0.attrlist).toBe("Ctrl+Shift+T");
  });
});

// ── Button macro ────────────────────────────────────────────

describe("btn macro", () => {
  test("btn:[label] → inlineMacro node", () => {
    const nodes = inlineNodes("btn:[OK]\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "inlineMacro");
    expect(node0.name).toBe("btn");
    expect(node0.attrlist).toBe("OK");
  });

  test("btn in surrounding text", () => {
    const nodes = inlineNodes("Click btn:[Save] to apply.\n");
    expect(nodes).toHaveLength(3);
    const [node0, node1, node2] = nodes;
    narrow(node0, "text");
    narrow(node1, "inlineMacro");
    narrow(node2, "text");
    expect(node1.name).toBe("btn");
    expect(node1.attrlist).toBe("Save");
  });
});

// ── Menu macro ──────────────────────────────────────────────

describe("menu macro", () => {
  test("menu:path[item] → inlineMacro node", () => {
    const nodes = inlineNodes("menu:File[Save]\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "inlineMacro");
    expect(node0.name).toBe("menu");
    expect(node0.target).toBe("File");
    expect(node0.attrlist).toBe("Save");
  });

  test("menu in surrounding text", () => {
    const nodes = inlineNodes("Select menu:Edit[Paste] now.\n");
    expect(nodes).toHaveLength(3);
    const [node0, node1, node2] = nodes;
    narrow(node0, "text");
    narrow(node1, "inlineMacro");
    narrow(node2, "text");
    expect(node1.name).toBe("menu");
    expect(node1.target).toBe("Edit");
    expect(node1.attrlist).toBe("Paste");
  });

  test("menu with submenu path", () => {
    const nodes = inlineNodes("menu:View[Zoom > Reset]\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "inlineMacro");
    expect(node0.name).toBe("menu");
    expect(node0.target).toBe("View");
    expect(node0.attrlist).toBe("Zoom > Reset");
  });
});

// ── Footnote macro ──────────────────────────────────────────

describe("footnote macro", () => {
  test("footnote:[text] → inlineMacro node", () => {
    const nodes = inlineNodes("Textfootnote:[A note.]\n");
    expect(nodes).toHaveLength(2);
    const [node0, node1] = nodes;
    narrow(node0, "text");
    narrow(node1, "inlineMacro");
    expect(node1.name).toBe("footnote");
    expect(node1.attrlist).toBe("A note.");
  });

  test("footnoteref:[id,text] → inlineMacro node with ref name", () => {
    const nodes = inlineNodes("Textfootnoteref:[fn1,A note.]\n");
    expect(nodes).toHaveLength(2);
    const [node0, node1] = nodes;
    narrow(node0, "text");
    narrow(node1, "inlineMacro");
    expect(node1.name).toBe("footnoteref");
    expect(node1.attrlist).toBe("fn1,A note.");
  });
});

// -- Icon macro ----------------------------------------------

describe("icon macro", () => {
  test("icon:name[] -> inlineMacro node", () => {
    const nodes = inlineNodes("icon:heart[]\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "inlineMacro");
    expect(node0.name).toBe("icon");
    expect(node0.target).toBe("heart");
    expect(node0.attrlist).toBe("");
  });

  test("icon with size attribute", () => {
    const nodes = inlineNodes("icon:heart[2x]\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "inlineMacro");
    expect(node0.name).toBe("icon");
    expect(node0.target).toBe("heart");
    expect(node0.attrlist).toBe("2x");
  });

  test("icon in surrounding text", () => {
    const nodes = inlineNodes("Click the icon:heart[] to save it.\n");
    expect(nodes).toHaveLength(3);
    const [node0, node1, node2] = nodes;
    narrow(node0, "text");
    narrow(node1, "inlineMacro");
    narrow(node2, "text");
    expect(node0.value).toBe("Click the ");
    expect(node1.name).toBe("icon");
    expect(node1.target).toBe("heart");
    expect(node1.attrlist).toBe("");
    expect(node2.value).toBe(" to save it.");
  });

  test("icon adjacent to punctuation", () => {
    const nodes = inlineNodes("A icon:heart[], then more.\n");
    expect(nodes).toHaveLength(3);
    const [node0, node1, node2] = nodes;
    narrow(node0, "text");
    narrow(node1, "inlineMacro");
    narrow(node2, "text");
    expect(node1.name).toBe("icon");
    expect(node1.target).toBe("heart");
    expect(node2.value).toBe(", then more.");
  });

  // Ruby's InlineImageMacroRx (`i(?:mage|con):...`) carries no leading
  // boundary, so `icon:` matches wherever it starts, even mid-word -
  // the same way `footnote:` does in `Textfootnote:[x]` below. Verified
  // against the oracle: `microicon:x[]` renders
  // `micro<span class="icon">...`.
  test("icon matches mid-word, like footnote", () => {
    const nodes = inlineNodes("microicon:x[]\n");
    expect(nodes).toHaveLength(2);
    const [node0, node1] = nodes;
    narrow(node0, "text");
    narrow(node1, "inlineMacro");
    expect(node0.value).toBe("micro");
    expect(node1.name).toBe("icon");
    expect(node1.target).toBe("x");
    expect(node1.attrlist).toBe("");
  });
});

// ── Pass macro ──────────────────────────────────────────────

describe("pass macro", () => {
  test("pass:[content] → inlineMacro node", () => {
    const nodes = inlineNodes("pass:[<b>bold</b>]\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "inlineMacro");
    expect(node0.name).toBe("pass");
    expect(node0.attrlist).toBe("<b>bold</b>");
  });

  test("pass in surrounding text", () => {
    const nodes = inlineNodes("See pass:[<em>this</em>] here.\n");
    expect(nodes).toHaveLength(3);
    const [node0, node1, node2] = nodes;
    narrow(node0, "text");
    narrow(node1, "inlineMacro");
    narrow(node2, "text");
    expect(node1.name).toBe("pass");
    expect(node1.attrlist).toBe("<em>this</em>");
  });

  test("pass with empty content", () => {
    const nodes = inlineNodes("pass:[]\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "inlineMacro");
    expect(node0.name).toBe("pass");
    expect(node0.attrlist).toBe("");
  });
});

// -- STEM macro ----------------------------------------------

describe("stem macro", () => {
  test("stem:[expression] -> inlineMacro node", () => {
    const nodes = inlineNodes("stem:[x < y]\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "inlineMacro");
    expect(node0.name).toBe("stem");
    expect(node0.target).toBe("");
    expect(node0.attrlist).toBe("x < y");
  });

  // Formatting characters inside the expression are not inline marks
  // (verified against the oracle: `stem:[a**b**]` renders `$a**b**$`,
  // the `**` untouched) - the whole bracketed body is the macro's
  // attrlist, one token, not text the mark rules can see into.
  test("formatting characters inside stem survive as literal text", () => {
    const nodes = inlineNodes("stem:[a**b**]\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "inlineMacro");
    expect(node0.name).toBe("stem");
    expect(node0.attrlist).toBe("a**b**");
  });

  test("stem mid-paragraph", () => {
    const nodes = inlineNodes("Given the equation stem:[x < y] we conclude.\n");
    expect(nodes).toHaveLength(3);
    const [node0, node1, node2] = nodes;
    narrow(node0, "text");
    narrow(node1, "inlineMacro");
    narrow(node2, "text");
    expect(node0.value).toBe("Given the equation ");
    expect(node1.name).toBe("stem");
    expect(node1.attrlist).toBe("x < y");
    expect(node2.value).toBe(" we conclude.");
  });

  test("stem adjacent to punctuation", () => {
    const nodes = inlineNodes("See stem:[a+b], next.\n");
    expect(nodes).toHaveLength(3);
    const [node0, node1, node2] = nodes;
    narrow(node0, "text");
    narrow(node1, "inlineMacro");
    narrow(node2, "text");
    expect(node1.name).toBe("stem");
    expect(node1.attrlist).toBe("a+b");
    expect(node2.value).toBe(", next.");
  });

  // `stem:` with a space before the bracket is not a macro at all -
  // the pattern requires the `[` immediately after the target, and
  // `[^\s\[]*` cannot cross the space. Verified against the oracle:
  // "stem: not a macro" renders unchanged, as plain text.
  test("stem: followed by a space is plain text, not a macro", () => {
    const nodes = inlineNodes("stem: not a macro\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "text");
    expect(node0.value).toBe("stem: not a macro");
  });
});

// -- Math macros (latexmath, asciimath) -----------------------
//
// InlineStemMacroRx (rx.rb l.551) is one pattern for `stem`,
// `latexmath` and `asciimath` - issue #19 added `stem`, issue #76
// adds the other two names the same pattern covers. Both take the
// same node shape as `stem:` above (empty target, whole bracket body
// as attrlist), since it is the same rule row.

describe("latexmath macro", () => {
  test("latexmath:[expression] -> inlineMacro node", () => {
    const nodes = inlineNodes("latexmath:[\\sqrt{4} = 2]\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "inlineMacro");
    expect(node0.name).toBe("latexmath");
    expect(node0.target).toBe("");
    expect(node0.attrlist).toBe(String.raw`\sqrt{4} = 2`);
  });

  // Formatting characters inside the expression are not inline marks
  // (verified against the oracle: `latexmath:[a**b**]` renders
  // `\(a**b**\)`, the `**` untouched) - the whole bracketed body is
  // the macro's attrlist, one token, not text the mark rules can see
  // into.
  test("formatting characters inside latexmath survive as literal text", () => {
    const nodes = inlineNodes("latexmath:[a**b**]\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "inlineMacro");
    expect(node0.name).toBe("latexmath");
    expect(node0.attrlist).toBe("a**b**");
  });

  test("latexmath mid-paragraph", () => {
    const nodes = inlineNodes(
      "Given the equation latexmath:[x < y] we conclude.\n",
    );
    expect(nodes).toHaveLength(3);
    const [node0, node1, node2] = nodes;
    narrow(node0, "text");
    narrow(node1, "inlineMacro");
    narrow(node2, "text");
    expect(node0.value).toBe("Given the equation ");
    expect(node1.name).toBe("latexmath");
    expect(node1.attrlist).toBe("x < y");
    expect(node2.value).toBe(" we conclude.");
  });

  // The optional subs list between the colon and the bracket
  // (rx.rb l.551's `([a-z]+(?:,[a-z-]+)*)?` group) lands in `target`,
  // the same generic split every macro row gets - no separate
  // handling needed. Verified against the oracle: the subs list
  // changes which substitutions apply to the content, not its bytes.
  test("latexmath with a subs list populates target", () => {
    const nodes = inlineNodes("latexmath:specialchars[a < b]\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "inlineMacro");
    expect(node0.name).toBe("latexmath");
    expect(node0.target).toBe("specialchars");
    expect(node0.attrlist).toBe("a < b");
  });

  // `latexmath:` with a space before the bracket is not a macro at
  // all - the pattern requires the `[` immediately after the target.
  // Verified against the oracle: "latexmath: not a macro" renders
  // unchanged, as plain text.
  test("latexmath: followed by a space is plain text, not a macro", () => {
    const nodes = inlineNodes("latexmath: not a macro\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "text");
    expect(node0.value).toBe("latexmath: not a macro");
  });
});

describe("asciimath macro", () => {
  test("asciimath:[expression] -> inlineMacro node", () => {
    const nodes = inlineNodes("asciimath:[x != 0]\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "inlineMacro");
    expect(node0.name).toBe("asciimath");
    expect(node0.target).toBe("");
    expect(node0.attrlist).toBe("x != 0");
  });

  test("asciimath mid-paragraph", () => {
    const nodes = inlineNodes(
      "Given the equation asciimath:[x < y] we conclude.\n",
    );
    expect(nodes).toHaveLength(3);
    const [node0, node1, node2] = nodes;
    narrow(node0, "text");
    narrow(node1, "inlineMacro");
    narrow(node2, "text");
    expect(node1.name).toBe("asciimath");
    expect(node1.attrlist).toBe("x < y");
    expect(node2.value).toBe(" we conclude.");
  });

  test("asciimath: followed by a space is plain text, not a macro", () => {
    const nodes = inlineNodes("asciimath: not a macro\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "text");
    expect(node0.value).toBe("asciimath: not a macro");
  });
});
