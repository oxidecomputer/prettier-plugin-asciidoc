/**
 * Parser tests for inline macros: image, kbd, btn, menu,
 * footnote, footnoteref, and pass. Verifies that the inline
 * parser produces the correct InlineMacroNode for each type.
 */
import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import type { InlineNode } from "../../src/ast.js";
import { asParagraph } from "../helpers.js";
import { narrow } from "../../src/unreachable.js";

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
