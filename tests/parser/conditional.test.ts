import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import { narrow } from "../../src/unreachable.js";

describe("conditional directive parsing", () => {
  // Basic ifdef with empty content brackets.
  test("ifdef with empty brackets", () => {
    const { children } = parse("ifdef::backend[]\n");
    expect(children).toHaveLength(1);
    const [node] = children;
    narrow(node, "conditionalDirective");
    expect(node.directive).toBe("ifdef");
    expect(node.target).toBe("backend");
    expect(node.attrlist).toBe("");
  });

  // Single-line form with content inside brackets.
  test("ifdef with content inside brackets", () => {
    const { children } = parse(
      "ifdef::backend[Content here]\n",
    );
    expect(children).toHaveLength(1);
    const [node] = children;
    narrow(node, "conditionalDirective");
    expect(node.directive).toBe("ifdef");
    expect(node.target).toBe("backend");
    expect(node.attrlist).toBe("Content here");
  });

  // ifndef directive.
  test("ifndef directive", () => {
    const { children } = parse("ifndef::attr[]\n");
    expect(children).toHaveLength(1);
    const [node] = children;
    narrow(node, "conditionalDirective");
    expect(node.directive).toBe("ifndef");
    expect(node.target).toBe("attr");
    expect(node.attrlist).toBe("");
  });

  // ifeval with expression inside brackets.
  test("ifeval with expression", () => {
    const { children } = parse(
      'ifeval::[{version} > 1]\n',
    );
    expect(children).toHaveLength(1);
    const [node] = children;
    narrow(node, "conditionalDirective");
    expect(node.directive).toBe("ifeval");
    expect(node.target).toBe("");
    expect(node.attrlist).toBe("{version} > 1");
  });

  // endif directive.
  test("endif directive", () => {
    const { children } = parse("endif::[]\n");
    expect(children).toHaveLength(1);
    const [node] = children;
    narrow(node, "conditionalDirective");
    expect(node.directive).toBe("endif");
    expect(node.target).toBe("");
    expect(node.attrlist).toBe("");
  });

  // Comma-separated attribute names.
  test("ifdef with comma-separated attributes", () => {
    const { children } = parse("ifdef::attr1,attr2[]\n");
    expect(children).toHaveLength(1);
    const [node] = children;
    narrow(node, "conditionalDirective");
    expect(node.directive).toBe("ifdef");
    expect(node.target).toBe("attr1,attr2");
    expect(node.attrlist).toBe("");
  });

  // Plus-separated attributes mean "all of" in AsciiDoc.
  // The parser treats the target as opaque text, so plus
  // works the same as comma — verify it round-trips.
  test("plus-separated attributes", () => {
    const { children } = parse("ifdef::attr1+attr2[]\n");
    expect(children).toHaveLength(1);
    const [node] = children;
    narrow(node, "conditionalDirective");
    expect(node.directive).toBe("ifdef");
    expect(node.target).toBe("attr1+attr2");
  });

  // Between paragraphs.
  test("between paragraphs", () => {
    const { children } = parse(
      "Before.\n\nifdef::backend[]\n\nAfter.\n",
    );
    expect(children).toHaveLength(3);
    expect(children[0].type).toBe("paragraph");
    expect(children[1].type).toBe("conditionalDirective");
    expect(children[2].type).toBe("paragraph");
  });

  // Position tracking.
  test("position tracking", () => {
    const { children } = parse("ifdef::backend[]\n");
    const [node] = children;
    expect(node.type).toBe("conditionalDirective");
    expect(node.position.start.line).toBe(1);
    expect(node.position.start.column).toBe(1);
    expect(node.position.start.offset).toBe(0);
  });

  // Trailing text after closing bracket rejects the match.
  // The (?![^\n]) lookahead ensures the token only matches
  // when it occupies the entire line.
  test("trailing text prevents match", () => {
    const { children } = parse(
      "ifdef::backend[] extra\n",
    );
    expect(children).toHaveLength(1);
    expect(children[0].type).toBe("paragraph");
  });

  // endif with attribute name (valid but unusual).
  test("endif with attribute name", () => {
    const { children } = parse("endif::backend[]\n");
    expect(children).toHaveLength(1);
    const [node] = children;
    narrow(node, "conditionalDirective");
    expect(node.directive).toBe("endif");
    expect(node.target).toBe("backend");
    expect(node.attrlist).toBe("");
  });
});
