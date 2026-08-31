/**
 * Parser tests for bibliography anchors: `[[[id]]]` and
 * `[[[id, reftext]]]` (InlineBiblioAnchorRx, rx.rb l.457). Issue #8.
 *
 * The construct shares its AST node with the ordinary two-bracket
 * anchor (`InlineAnchorNode`, `form: "bibliography"` vs
 * `form: "inline"`) - see tests/parser/inline-links.test.ts for the
 * `form: "inline"` sibling's own tests.
 *
 * The tokenizer recognises the three-bracket form ONLY at the start
 * of the fragment `tokenizeInline` was handed (rules.ts's
 * `InlineBiblioAnchor` row) - the "start of the list item's text"
 * half of Ruby's own guard (`@context == :list_item &&
 * \@parent.style == 'bibliography'`, substitutors.rb l.714), measured
 * against the oracle (`@asciidoctor/core` 4.0.11) rather than read off
 * an assumption. The block-style half is deliberately NOT modelled
 * (the inline layer has no way to ask it without smuggling block
 * context, which tests/parser/architecture.test.ts forbids), so this
 * suite also pins the documented divergence: the shape is recognised
 * at the start of ANY paragraph or list item, not only inside a
 * `[bibliography]`-styled list.
 */
import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import type { InlineNode } from "../../src/ast.js";
import { narrow } from "../../src/narrow.js";

/**
 * Parses AsciiDoc input and returns the inline nodes of its first
 * paragraph.
 * @param input - AsciiDoc source containing one paragraph
 * @returns the inline children of the first paragraph
 */
function paragraphNodes(input: string): InlineNode[] {
  const document = parse(input);
  const [block] = document.children;
  narrow(block, "paragraph");
  return block.children;
}

/**
 * Parses AsciiDoc input and returns the principal-text inline nodes
 * of the first item of the document's first list.
 *
 * Finds the list by TYPE rather than assuming `children[0]`: a
 * `[bibliography]` attribute line above the list is its own sibling
 * block (`blockAttributeList`), not folded into the list node, in
 * every row this suite uses it.
 * @param input - AsciiDoc source containing one list
 * @returns the first list item's principal-text inline nodes
 */
function firstItemNodes(input: string): InlineNode[] {
  const { children } = parse(input);
  const list = children.find((block) => block.type === "list");
  narrow(list, "list");
  const [item] = list.children;
  return item.text;
}

describe("bibliography anchors - list item, the typical usage", () => {
  test("[[[id]]] at the start of a list item becomes a bibliography anchor", () => {
    const nodes = firstItemNodes(
      '[bibliography]\n* [[[gof]]] Gamma, et al. "Design Patterns."\n',
    );
    const [node0, node1] = nodes;
    narrow(node0, "inlineAnchor");
    expect(node0.form).toBe("bibliography");
    expect(node0.id).toBe("gof");
    expect(node0.reftext).toBeUndefined();
    narrow(node1, "text");
    expect(node1.value).toBe(' Gamma, et al. "Design Patterns."');
  });

  test("[[[id, reftext]]] becomes bibliography anchor with verbatim reftext", () => {
    const nodes = firstItemNodes(
      "[bibliography]\n* [[[gof, 1]]] Gamma, et al.\n",
    );
    const [node0] = nodes;
    narrow(node0, "inlineAnchor");
    expect(node0.form).toBe("bibliography");
    expect(node0.id).toBe("gof");
    // The post-comma spelling is captured VERBATIM, the author's
    // separating space included, and the printer replays it unchanged
    // (bibliographyAnchorToSource, serialize-inline.ts, never
    // normalizes - see tests/format/bibliography-anchor.test.ts for
    // why the reftext contract differs from the two-bracket form's).
    expect(node0.reftext).toBe(" 1");
  });

  test("no separating space means no captured space", () => {
    const [node0] = firstItemNodes("[bibliography]\n* [[[gof,1]]] Text\n");
    narrow(node0, "inlineAnchor");
    expect(node0.reftext).toBe("1");
  });

  test("a list item with only the anchor, no trailing text", () => {
    const nodes = firstItemNodes("[bibliography]\n* [[[gof]]]\n");
    expect(nodes).toHaveLength(1);
    const [node0] = nodes;
    narrow(node0, "inlineAnchor");
    expect(node0.form).toBe("bibliography");
    expect(node0.id).toBe("gof");
  });
});

describe("bibliography anchors - false-positive control", () => {
  // The issue's own false-positive control: triple brackets that do
  // NOT open the list item's text are not a bibliography anchor. This
  // is unchanged, pre-existing behaviour (the two-bracket InlineAnchor
  // row still matches the first two brackets there, which is also
  // what real Ruby does OUTSIDE bibliography context - measured) and
  // this test pins it as a regression control rather than a new
  // capability.
  test("triple brackets mid-item stay the two-bracket misparse", () => {
    const nodes = firstItemNodes(
      "[bibliography]\n* See [[[gof]]] for details.\n",
    );
    const anchor = nodes.find((node) => node.type === "inlineAnchor");
    narrow(anchor, "inlineAnchor");
    expect(anchor.form).toBe("inline");
    // The id absorbs the stray third opening bracket (documented
    // issue #8 misparse, unaffected outside fragment-start).
    expect(anchor.id).toBe("[gof");
  });

  test("triple brackets mid-paragraph are the same misparse", () => {
    const nodes = paragraphNodes("Some text [[[gof]]] more text.\n");
    const anchor = nodes.find((node) => node.type === "inlineAnchor");
    narrow(anchor, "inlineAnchor");
    expect(anchor.form).toBe("inline");
  });
});

describe("bibliography anchors - divergence from Ruby's block-style guard", () => {
  // Ruby's own guard additionally requires `@context == :list_item &&
  // @parent.style == 'bibliography'` (substitutors.rb l.714); outside
  // that block context the oracle falls back to the two-bracket
  // misparse (measured: `[[[gof]]] x` in a plain paragraph renders
  // `[<a id="gof"></a>] x`, the stray-bracket shape). The inline
  // tokenizer cannot see block style, so this row is recognised as a
  // bibliography anchor here too - a documented, deliberate widening
  // that costs nothing a real document renders differently by, since
  // the formatter only replays source bytes.
  test("[[[id]]] at the start of an ORDINARY paragraph is still recognised", () => {
    const nodes = paragraphNodes(
      '[[[gof]]] Gamma, et al. "Design Patterns."\n',
    );
    const [node0] = nodes;
    narrow(node0, "inlineAnchor");
    expect(node0.form).toBe("bibliography");
    expect(node0.id).toBe("gof");
  });

  test("[[[id]]] at the start of an ordinary (non-bibliography) list item", () => {
    const nodes = firstItemNodes(
      '* [[[gof]]] Gamma, et al. "Design Patterns."\n',
    );
    const [node0] = nodes;
    narrow(node0, "inlineAnchor");
    expect(node0.form).toBe("bibliography");
  });
});

describe("bibliography anchors - comma edge cases (mirrors the two-bracket form)", () => {
  test.each([
    ["[[[id,]]]", ""],
    ["[[[id, ]]]", " "],
  ])("%s becomes anchor with the verbatim blank reftext", (anchor, reftext) => {
    const nodes = firstItemNodes(`[bibliography]\n* ${anchor} text\n`);
    const [node0] = nodes;
    narrow(node0, "inlineAnchor");
    expect(node0.form).toBe("bibliography");
    expect(node0.id).toBe("id");
    expect(node0.reftext).toBe(reftext);
  });
});

describe("xref resolving to a bibliography anchor", () => {
  // The issue's "already works - just verify" case: `<<id>>` is an
  // ordinary XrefShorthand token regardless of what it targets, so no
  // parser change was needed for it. This pins that it still produces
  // a plain xref node once bibliography anchors exist alongside it.
  test("<<id>> parses as an ordinary xref, unaffected by the anchor form", () => {
    const document = parse(
      "[bibliography]\n* [[[gof]]] Gamma, et al.\n\nSee <<gof>> for details.\n",
    );
    const paragraph = document.children.find(
      (block) => block.type === "paragraph",
    );
    narrow(paragraph, "paragraph");
    const xref = paragraph.children.find((node) => node.type === "xref");
    narrow(xref, "xref");
    expect(xref.target).toBe("gof");
    expect(xref.form).toBe("shorthand");
  });
});
