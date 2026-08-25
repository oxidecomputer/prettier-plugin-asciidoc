import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import type { InlineNode } from "../../src/ast.js";
import { asParagraph } from "../helpers.js";
import { narrow } from "../../src/narrow.js";

/**
 * Parses AsciiDoc input and returns the inline nodes of
 * its first paragraph. Shorthand for the common test
 * pattern of inspecting inline formatting results.
 * @param input - AsciiDoc source containing one paragraph
 * @returns the inline children of the first paragraph
 */
function inlineNodes(input: string): InlineNode[] {
  const document = parse(input);
  return asParagraph(document.children[0]).children;
}

describe("inline formatting — bold", () => {
  test("*bold* → bold node containing text", () => {
    const nodes = inlineNodes("*bold*\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "bold");
    expect(node0.children).toHaveLength(1);
    const {
      children: [inner0],
    } = node0;
    narrow(inner0, "text");
    expect(inner0.value).toBe("bold");
  });

  test("**unconstrained bold** mid-word", () => {
    const nodes = inlineNodes("un**bold**ed\n");
    expect(nodes).toHaveLength(3);
    const [node0, node1, node2] = nodes;
    narrow(node0, "text");
    narrow(node1, "bold");
    narrow(node2, "text");
    expect(node0.value).toBe("un");
    expect(node1.children).toHaveLength(1);
    const {
      children: [boldChild],
    } = node1;
    narrow(boldChild, "text");
    expect(boldChild.value).toBe("bold");
    expect(node2.value).toBe("ed");
  });
});

describe("inline formatting — italic", () => {
  test("_italic_ → italic node", () => {
    const nodes = inlineNodes("_italic_\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "italic");
    expect(node0.children).toHaveLength(1);
    const {
      children: [inner0],
    } = node0;
    narrow(inner0, "text");
    expect(inner0.value).toBe("italic");
  });

  test("__unconstrained italic__", () => {
    // Intentionally shallow — mirrors the bold unconstrained
    // test above. The boundary behavior of unconstrained marks
    // is covered by the bold variant; here we only confirm the
    // mid-word case produces an italic node.
    const nodes = inlineNodes("un__italic__ed\n");
    expect(nodes).toHaveLength(3);
    expect(nodes[1].type).toBe("italic");
  });
});

describe("inline formatting — monospace", () => {
  test("`mono` → monospace node", () => {
    const nodes = inlineNodes("`mono`\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "monospace");
    expect(node0.children).toHaveLength(1);
    const {
      children: [inner0],
    } = node0;
    narrow(inner0, "text");
    expect(inner0.value).toBe("mono");
  });

  test("``unconstrained mono``", () => {
    // Shallow by design — see the bold unconstrained test for
    // full node-structure coverage. This confirms the mark
    // produces a monospace node mid-word.
    const nodes = inlineNodes("un``mono``ed\n");
    expect(nodes).toHaveLength(3);
    expect(nodes[1].type).toBe("monospace");
  });
});

describe("inline formatting — highlight", () => {
  test("#highlight# → highlight node", () => {
    const nodes = inlineNodes("#highlight#\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "highlight");
    expect(node0.children).toHaveLength(1);
    const {
      children: [inner0],
    } = node0;
    narrow(inner0, "text");
    expect(inner0.value).toBe("highlight");
  });

  test("##unconstrained highlight##", () => {
    // Shallow by design — see the bold unconstrained test for
    // full node-structure coverage. This confirms the mark
    // produces a highlight node mid-word.
    const nodes = inlineNodes("un##highlight##ed\n");
    expect(nodes).toHaveLength(3);
    expect(nodes[1].type).toBe("highlight");
  });
});

describe("inline formatting — mixed", () => {
  test("text + bold + text + italic", () => {
    const nodes = inlineNodes("This is *bold* and _italic_\n");
    expect(nodes).toHaveLength(4);
    const [node0, , node2] = nodes;
    narrow(node0, "text");
    expect(nodes[1].type).toBe("bold");
    narrow(node2, "text");
    expect(nodes[3].type).toBe("italic");
    expect(node0.value).toBe("This is ");
    expect(node2.value).toBe(" and ");
  });

  test("nested: *_bold italic_*", () => {
    const nodes = inlineNodes("*_bold italic_*\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "bold");
    expect(node0.children).toHaveLength(1);
    const {
      children: [italicChild],
    } = node0;
    narrow(italicChild, "italic");
    expect(italicChild.children).toHaveLength(1);
    const {
      children: [textChild],
    } = italicChild;
    narrow(textChild, "text");
    expect(textChild.value).toBe("bold italic");
  });
});

// Backslash escapes are tokenised by the `BackslashEscape` rule in
// src/parse/inline/rules.ts and converted to text nodes by
// inline-node-builder.ts. The backslash is preserved in the
// value so the printer can round-trip the escape.
describe("inline formatting — backslash escapes", () => {
  test("backslash before * prevents bold — produces literal text", () => {
    const nodes = inlineNodes(`${String.raw`\*not bold*`}\n`);
    // The escaped mark should produce text, not a bold node.
    // The backslash is preserved in the value for round-trip
    // safety — the formatter re-emits it so re-parsing
    // produces the same AST.
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "text");
    expect(node0.value).toBe(String.raw`\*not bold*`);
  });

  // Same principle as the \* test above: the backslash escape
  // prevents the _ from opening an italic span.
  test("backslash before _ prevents italic — produces literal text", () => {
    const nodes = inlineNodes(`${String.raw`\_not italic_`}\n`);
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "text");
    expect(node0.value).toBe(String.raw`\_not italic_`);
  });

  test("backslash before unconstrained ** — escape prevents bold", () => {
    // The backslash escape pattern /\\[*_`#]/ matches \* (one
    // char after backslash). So \** → BackslashEscape(\*) then
    // the second * begins an unmatched constrained mark that
    // falls through as text together with the rest.
    const nodes = inlineNodes(`${String.raw`\**not bold**`}\n`);
    // After the escape token, the remaining sequence *not bold**
    // is: one * (potential constrained open) + "not bold" + **
    // (unconstrained close). A constrained open cannot pair with
    // an unconstrained close, and the constrained close would
    // require the char after it to be non-word — here it's *,
    // which satisfies that, but the token already emitted as
    // BackslashEscape means the subsequent marks lose pairing
    // context. In any case the result is all plain text.
    expect(nodes.length).toBeGreaterThanOrEqual(1);
    // Regardless of how many text nodes, the full image must be
    // reconstructable and contain the backslash.
    const fullText = nodes
      .map((n) => {
        if (n.type === "text") return n.value;
        return "";
      })
      .join("");
    expect(fullText).toContain(String.raw`\*`);
    // Must NOT produce a bold node — the escape prevents it.
    for (const node of nodes) {
      expect(node.type).not.toBe("bold");
    }
  });
});

describe("inline formatting — role/style attributes", () => {
  test("[red]#styled text# → highlight with role", () => {
    const nodes = inlineNodes("[red]#styled text#\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "highlight");
    expect(node0.role).toBe("red");
    expect(node0.children).toHaveLength(1);
    const {
      children: [inner0],
    } = node0;
    narrow(inner0, "text");
    expect(inner0.value).toBe("styled text");
  });

  test("[.role]#text# — dot-prefixed role", () => {
    const nodes = inlineNodes("[.role]#text#\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "highlight");
    expect(node0.role).toBe(".role");
  });

  test("[underline]#text# — underline role", () => {
    const nodes = inlineNodes("[underline]#text#\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "highlight");
    expect(node0.role).toBe("underline");
  });

  // The role attribute is part of the span: the node starts at the
  // `[` and ends past the closing `#`, not at the `#` that opens it.
  test("the node spans the role attribute AND the marks", () => {
    const [node0] = inlineNodes("[red]#t#\n");
    narrow(node0, "highlight");
    expect(node0.position).toEqual({
      start: { offset: 0, line: 1, column: 1 },
      end: { offset: 8, line: 1, column: 9 },
    });
  });
});

describe("inline formatting — attribute references", () => {
  test("{name} → attribute reference node", () => {
    const nodes = inlineNodes("{name}\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "attributeReference");
    expect(node0.name).toBe("name");
  });

  // The braces are part of the span even though they are not part of
  // the name: the printer writes them back from the position, not the
  // name.
  test("the node spans the braces, not just the name", () => {
    const [node0] = inlineNodes("{name}\n");
    narrow(node0, "attributeReference");
    expect(node0.position).toEqual({
      start: { offset: 0, line: 1, column: 1 },
      end: { offset: 6, line: 1, column: 7 },
    });
  });

  test("text + attrRef + text", () => {
    const nodes = inlineNodes("See {project-name} for details\n");
    expect(nodes).toHaveLength(3);
    const [node0, node1, node2] = nodes;
    narrow(node0, "text");
    narrow(node1, "attributeReference");
    narrow(node2, "text");
    expect(node0.value).toBe("See ");
    expect(node1.name).toBe("project-name");
    expect(node2.value).toBe(" for details");
  });

  test("{authors} as entire paragraph", () => {
    const nodes = inlineNodes("{authors}\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "attributeReference");
    expect(node0.name).toBe("authors");
  });

  test("{counter:name} → attribute reference", () => {
    const nodes = inlineNodes("{counter:name}\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "attributeReference");
    expect(node0.name).toBe("counter:name");
  });

  test("{counter2:name} → attribute reference", () => {
    const nodes = inlineNodes("{counter2:name}\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "attributeReference");
    expect(node0.name).toBe("counter2:name");
  });
});

describe("inline formatting — stray/unmatched marks", () => {
  test("lone * in text is plain text", () => {
    const nodes = inlineNodes("a * b\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "text");
    expect(node0.value).toBe("a * b");
  });

  test("unmatched opening * is plain text", () => {
    // At start of line, * also looks like a list marker in
    // block context, but in inline context an unmatched *
    // must fall back to plain text rather than crashing or
    // producing a partial bold node.
    const nodes = inlineNodes("*no closing mark\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "text");
    expect(node0.value).toBe("*no closing mark");
  });

  test("mid-word * without boundary is plain text", () => {
    const nodes = inlineNodes("a*b*c\n");
    // Constrained marks need word boundaries — a*b*c
    // has no boundary before the first * or after the
    // second *, so both are plain text.
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "text");
    expect(node0.value).toBe("a*b*c");
  });
});

describe("inline formatting — interleaved marks", () => {
  test("*_foo*_ — misnested bold/italic", () => {
    // The bold pair closes around `_foo`, and the trailing
    // `_` becomes plain text (no matching open mark).
    const nodes = inlineNodes("*_foo*_\n");
    expect(nodes).toHaveLength(2);
    const [node0] = nodes;
    narrow(node0, "bold");
    expect(node0.children).toHaveLength(1);
    const {
      children: [boldInner],
    } = node0;
    narrow(boldInner, "text");
    expect(boldInner.value).toBe("_foo");
    expect(nodes[1].type).toBe("text");
  });
});

describe("inline formatting — adjacent spans", () => {
  test("*bold*_italic_ — consecutive constrained marks", () => {
    // Adjacent constrained marks with no space between the
    // closing and opening marks. Mark characters are word
    // boundaries for each other, so *bold*_italic_ parses
    // as two separate formatting spans.
    const nodes = inlineNodes("*bold*_italic_\n");
    expect(nodes).toHaveLength(2);
    expect(nodes[0].type).toBe("bold");
    expect(nodes[1].type).toBe("italic");
  });
});

describe("inline formatting — deep nesting", () => {
  test("*_`code`_* — three levels", () => {
    const nodes = inlineNodes("*_`code`_*\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "bold");
    expect(node0.children).toHaveLength(1);
    const {
      children: [italicNode],
    } = node0;
    narrow(italicNode, "italic");
    expect(italicNode.children).toHaveLength(1);
    const {
      children: [monoNode],
    } = italicNode;
    narrow(monoNode, "monospace");
    expect(monoNode.children).toHaveLength(1);
    const {
      children: [textNode],
    } = monoNode;
    narrow(textNode, "text");
    expect(textNode.value).toBe("code");
  });
});

describe("inline formatting — unconstrained role highlight", () => {
  test("[role]##text## — role with unconstrained highlight", () => {
    // `constrained` distinguishes # (constrained, needs word
    // boundaries) from ## (unconstrained, works anywhere).
    // The role/style tests above use single # — this test
    // confirms the AST node correctly records constrained=false
    // for the ## form, which matters for the printer to
    // re-emit the right number of # characters.
    const nodes = inlineNodes("[role]##text##\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "highlight");
    expect(node0.role).toBe("role");
    expect(node0.constrained).toBe(false);
  });
});

describe("inline formatting — cross-line spans", () => {
  test("*bold spanning two lines* merges across InlineNewline", () => {
    // The tokenizer emits an InlineNewline for every \n rather than
    // ending the run there, and buildInlineNodes pairs marks across
    // those newlines, so a bold span opened on one line still closes
    // on the next.
    const nodes = inlineNodes("*bold\nspanning two lines* here.\n");
    expect(nodes).toHaveLength(2);
    const [node0] = nodes;
    narrow(node0, "bold");
    expect(node0.children).toHaveLength(1);
    const {
      children: [boldText],
    } = node0;
    narrow(boldText, "text");
    expect(boldText.value).toBe("bold\nspanning two lines");
    const [, node1] = nodes;
    narrow(node1, "text");
    expect(node1.value).toBe(" here.");
  });
});

describe("inline formatting — InlineChar fallback", () => {
  test("stray [ is consumed as plain text", () => {
    const nodes = inlineNodes("text [ more text\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "text");
    expect(node0.value).toBe("text [ more text");
  });

  test("stray { is consumed as plain text", () => {
    const nodes = inlineNodes("text { more text\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "text");
    expect(node0.value).toBe("text { more text");
  });

  test("[not-a-role] without # is plain text", () => {
    // RoleAttribute requires a # to follow the ].
    // Without it, the brackets are consumed by InlineChar
    // and InlineText as plain text.
    const nodes = inlineNodes("[not-a-role] more\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "text");
    expect(node0.value).toBe("[not-a-role] more");
  });
});

describe("inline formatting — empty paragraph edge case", () => {
  test("paragraph with only ** produces valid AST, not a crash", () => {
    // A paragraph of just `**` has formatting marks but no
    // text content. The AST builder's paragraph() method has
    // a contentTokens.length > EMPTY guard that falls back to
    // a synthetic position. Verify this produces a valid
    // paragraph, not an error.
    const document = parse("**\n");
    // Use asParagraph to avoid destructuring lint rule
    // (parse guarantees at least one child for non-empty input).
    const paragraph = asParagraph(document.children[0]);
    // The ** tokens are unmatched marks — they become text.
    expect(paragraph.children.length).toBeGreaterThanOrEqual(1);
    expect(paragraph.position).toBeDefined();
  });
});
