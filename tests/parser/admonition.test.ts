/**
 * Parser tests for admonition blocks.
 *
 * AsciiDoc has five admonition types: NOTE, TIP, IMPORTANT,
 * CAUTION, WARNING. They appear in two forms:
 *
 * **Paragraph form** — a label prefix on a paragraph:
 *   `NOTE: This is a note.`
 *
 * **Block form** — an attribute list on a parent block:
 *   `[NOTE]\n====\nContent.\n====`
 *
 * Paragraph-form admonitions produce `AdmonitionNode` directly
 * from the reader (`BlockReader.admonition`). Block-form
 * admonitions resolve at OPEN: the held style selects
 * the admonition variant (`resolveDelimitedOpen` in
 * lines/open-style.ts) and `openDelimited` builds the whole node
 * right there, through `buildDelimitedAdmonition`, from the extent
 * the open collected — no frame carries the decision and nothing
 * is renamed at close. Its `form` is the wrapper delimiter variant
 * The original `blockAttributeList` node is retained as
 * a preceding sibling so attribute metadata is not lost.
 */
import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import type { AdmonitionNode } from "../../src/ast.js";
import { narrow } from "../../src/unreachable.js";
import { serializedKeys } from "./reader-helpers.js";

/**
 * Extracts the child at the given index as an
 * AdmonitionNode. Throws if the node at that position is
 * not an admonition, surfacing test setup errors early.
 * @param children - parsed document children array
 * @param index - position of the expected admonition
 * @returns the child narrowed to AdmonitionNode
 */
function admonitionAt(
  children: ReturnType<typeof parse>["children"],
  index: number,
): AdmonitionNode {
  const { [index]: block } = children;
  narrow(block, "admonition");
  return block;
}

describe("paragraph-form admonitions", () => {
  test("NOTE: produces admonition with variant note", () => {
    const { children } = parse("NOTE: This is a note.\n");
    expect(children).toHaveLength(1);
    const node = admonitionAt(children, 0);
    expect(node.variant).toBe("note");
    expect(node.form).toBe("paragraph");
    expect(node.text).toMatchObject([
      { type: "text", value: "This is a note." },
    ]);
    expect(node.children).toHaveLength(0);
  });

  test("TIP: produces admonition with variant tip", () => {
    const { children } = parse("TIP: Here is a tip.\n");
    const node = admonitionAt(children, 0);
    expect(node.variant).toBe("tip");
    expect(node.form).toBe("paragraph");
    expect(node.text).toMatchObject([
      { type: "text", value: "Here is a tip." },
    ]);
  });

  test("IMPORTANT: produces admonition with variant important", () => {
    const { children } = parse("IMPORTANT: Do not forget.\n");
    const node = admonitionAt(children, 0);
    expect(node.variant).toBe("important");
    expect(node.form).toBe("paragraph");
    expect(node.text).toMatchObject([
      { type: "text", value: "Do not forget." },
    ]);
  });

  test("CAUTION: produces admonition with variant caution", () => {
    const { children } = parse("CAUTION: Watch out.\n");
    const node = admonitionAt(children, 0);
    expect(node.variant).toBe("caution");
    expect(node.form).toBe("paragraph");
    expect(node.text).toMatchObject([{ type: "text", value: "Watch out." }]);
  });

  test("WARNING: produces admonition with variant warning", () => {
    const { children } = parse("WARNING: Be careful.\n");
    const node = admonitionAt(children, 0);
    expect(node.variant).toBe("warning");
    expect(node.form).toBe("paragraph");
    expect(node.text).toMatchObject([{ type: "text", value: "Be careful." }]);
  });

  // Continuation lines (no blank line between them) are one text
  // child whose value keeps the \n separators — the same inline
  // children a regular paragraph gets.
  test("multi-line paragraph-form admonition", () => {
    const { children } = parse("NOTE: First line\nsecond line\nthird line\n");
    expect(children).toHaveLength(1);
    const node = admonitionAt(children, 0);
    expect(node.variant).toBe("note");
    expect(node.text).toMatchObject([
      { type: "text", value: "First line\nsecond line\nthird line" },
    ]);
  });

  test("position tracking for paragraph-form admonition", () => {
    const { children } = parse("NOTE: Hello.\n");
    const node = admonitionAt(children, 0);
    expect(node.position.start.line).toBe(1);
    expect(node.position.start.column).toBe(1);
    expect(node.position.start.offset).toBe(0);
    // "NOTE: Hello." is 12 chars; end offset is exclusive
    expect(node.position.end.line).toBe(1);
    expect(node.position.end.column).toBe(13);
    expect(node.position.end.offset).toBe(12);
  });

  test("paragraph-form admonition between paragraphs", () => {
    const { children } = parse("Before.\n\nNOTE: A note.\n\nAfter.\n");
    expect(children).toHaveLength(3);
    expect(children[0].type).toBe("paragraph");
    expect(children[1].type).toBe("admonition");
    expect(children[2].type).toBe("paragraph");
  });
});

describe("block-form admonitions (example block)", () => {
  test("[NOTE] + example block produces delimited admonition", () => {
    const { children } = parse("[NOTE]\n====\nContent.\n====\n");
    expect(children).toHaveLength(2);
    expect(children[0].type).toBe("blockAttributeList");
    const node = admonitionAt(children, 1);
    expect(node.variant).toBe("note");
    expect(node.form).toBe("example");
    expect(node.text).toEqual([]);
    expect(node.children.length).toBeGreaterThan(0);
  });

  test("[TIP] + example block", () => {
    const { children } = parse("[TIP]\n====\nA tip.\n====\n");
    expect(children).toHaveLength(2);
    const node = admonitionAt(children, 1);
    expect(node.variant).toBe("tip");
    expect(node.form).toBe("example");
  });

  test("[IMPORTANT] + example block", () => {
    const { children } = parse("[IMPORTANT]\n====\nDo not forget.\n====\n");
    const node = admonitionAt(children, 1);
    expect(node.variant).toBe("important");
  });

  test("[CAUTION] + example block", () => {
    const { children } = parse("[CAUTION]\n====\nWatch out.\n====\n");
    const node = admonitionAt(children, 1);
    expect(node.variant).toBe("caution");
  });

  test("[WARNING] + example block", () => {
    const { children } = parse("[WARNING]\n====\nBe careful.\n====\n");
    const node = admonitionAt(children, 1);
    expect(node.variant).toBe("warning");
  });

  test("block-form admonition with multiple paragraphs", () => {
    const { children } = parse(
      "[NOTE]\n====\nFirst paragraph.\n\nSecond paragraph.\n====\n",
    );
    expect(children).toHaveLength(2);
    const node = admonitionAt(children, 1);
    expect(node.variant).toBe("note");
    expect(node.children).toHaveLength(2);
    expect(node.children[0].type).toBe("paragraph");
    expect(node.children[1].type).toBe("paragraph");
  });
});

describe("block-form admonitions (open block)", () => {
  test("[CAUTION] + open block", () => {
    const { children } = parse("[CAUTION]\n--\nContent.\n--\n");
    expect(children).toHaveLength(2);
    expect(children[0].type).toBe("blockAttributeList");
    const node = admonitionAt(children, 1);
    expect(node.variant).toBe("caution");
    expect(node.form).toBe("open");
  });

  test("[NOTE] + open block with multiple paragraphs", () => {
    const { children } = parse("[NOTE]\n--\nFirst.\n\nSecond.\n--\n");
    expect(children).toHaveLength(2);
    const node = admonitionAt(children, 1);
    expect(node.variant).toBe("note");
    expect(node.form).toBe("open");
    expect(node.children).toHaveLength(2);
  });
});

describe("block-form admonitions (sidebar and quote wrappers)", () => {
  // The widened `form` type says sidebar and quote wrappers exist;
  // these rows are the reader outputs saying so (F7 — the baseline
  // pinned only the example and open spellings).
  test("[NOTE] + sidebar block carries form sidebar", () => {
    const { children } = parse("[NOTE]\n****\nContent.\n****\n");
    const node = admonitionAt(children, 1);
    expect(node.variant).toBe("note");
    expect(node.form).toBe("sidebar");
    expect(node.children).toHaveLength(1);
  });

  test("[NOTE] + quote block carries form quote", () => {
    const { children } = parse("[NOTE]\n____\nContent.\n____\n");
    const node = admonitionAt(children, 1);
    expect(node.variant).toBe("note");
    expect(node.form).toBe("quote");
    expect(node.children).toHaveLength(1);
  });
});

describe("admonition edge cases", () => {
  // Non-admonition attribute lists followed by parent blocks
  // should remain as regular parent blocks.
  test("[#myid] + example block is NOT an admonition", () => {
    const { children } = parse("[#myid]\n====\nContent.\n====\n");
    expect(children).toHaveLength(2);
    expect(children[0].type).toBe("blockAttributeList");
    expect(children[1].type).toBe("parentBlock");
  });

  // Lowercase admonition types in attribute lists should also
  // be recognized (AsciiDoc typically uses uppercase, but the
  // held style is normalized to uppercase before matching, so
  // [note] and [NOTE] are equivalent).
  test("[note] lowercase in attribute list is recognized", () => {
    const { children } = parse("[note]\n====\nContent.\n====\n");
    expect(children).toHaveLength(2);
    const node = admonitionAt(children, 1);
    expect(node.variant).toBe("note");
  });

  // Any single uppercase alphabetic word in an attribute list
  // becomes a custom admonition variant. The pattern matching the
  // held style is anchored, uppercase letters only, so hyphenated
  // names (e.g. MY-TYPE) do not match. This mirrors AsciiDoc's
  // convention for custom admonition types.
  test("[EXERCISE] + example block is a custom admonition", () => {
    const { children } = parse("[EXERCISE]\n====\nContent.\n====\n");
    expect(children).toHaveLength(2);
    expect(children[0].type).toBe("blockAttributeList");
    const [, child1] = children;
    narrow(child1, "admonition");
    expect(child1.variant).toBe("exercise");
    expect(child1.form).toBe("example");
  });
});

describe("one prose representation", () => {
  test("a paragraph-form body is inline children", () => {
    const [node] = parse("NOTE: alpha beta\n").children;
    if (node.type !== "admonition") throw new Error(`got ${node.type}`);
    expect(node.form).toBe("paragraph");
    expect(node.children).toEqual([]);
    expect(node.text.length).toBeGreaterThan(0);
    expect(node.text[0].type).toBe("text");
  });

  test("a delimited form carries its wrapper in `form`", () => {
    const [, node] = parse("[NOTE]\n====\nbody\n====\n").children;
    if (node.type !== "admonition") throw new Error(`got ${node.type}`);
    expect(node.form).toBe("example");
    expect(node.text).toEqual([]);
    expect(node.children).toHaveLength(1);
  });

  test("a raw line in the body is a rawLine inline child", () => {
    const [node] = parse("NOTE: alpha\nifdef::x[]\nbeta\n").children;
    if (node.type !== "admonition") throw new Error(`got ${node.type}`);
    expect(node.text.some((child) => child.type === "rawLine")).toBe(true);
  });

  // KEY ORDER is part of the shape contract: the parity fold
  // (foldAnchorAndAdmonitionShapes, scripts/parity.ts) and its string-equality
  // pins in tests/scripts/parity-ledger.test.ts spell the admonition
  // with exactly this serialized order. The fold replaces
  // every admonition before digesting, so a moved field could not
  // reach parity — this row keeps the constructed nodes aligned with
  // the encoding those pins wrote down. Measured, not assumed.
  test("both forms serialize their keys in the contract order", () => {
    const [paragraphForm] = parse("NOTE: alpha\n").children;
    const [, delimitedForm] = parse("[NOTE]\n====\nbody\n====\n").children;
    const order = ["type", "variant", "form", "text", "children", "position"];
    expect(serializedKeys(paragraphForm)).toEqual(order);
    expect(serializedKeys(delimitedForm)).toEqual(order);
  });
});
