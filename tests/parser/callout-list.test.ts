import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import { firstList, renderedHtml } from "../helpers.js";
import { narrow } from "../../src/unreachable.js";

describe("callout list parsing", () => {
  // The simplest case: a single `<1> item` line is a one-item
  // callout list.
  test("single callout item", () => {
    const { children } = parse("<1> First item\n");
    expect(children).toHaveLength(1);
    const list = firstList(children);
    expect(list.variant).toBe("callout");
    expect(list.children).toHaveLength(1);
    expect(list.children[0].calloutNumber).toBe(1);
  });

  // Multiple callout items in succession form a single list.
  test("multi-item callout list", () => {
    const { children } = parse("<1> First\n<2> Second\n<3> Third\n");
    expect(children).toHaveLength(1);
    const list = firstList(children);
    expect(list.variant).toBe("callout");
    expect(list.children).toHaveLength(3);
    expect(list.children[0].calloutNumber).toBe(1);
    expect(list.children[1].calloutNumber).toBe(2);
    expect(list.children[2].calloutNumber).toBe(3);
  });

  // `<.>` is the auto-numbering marker. We store it as
  // calloutNumber 0 to distinguish it from explicit numbers.
  test("auto-numbered callout", () => {
    const { children } = parse("<.> Auto item\n");
    const list = firstList(children);
    expect(list.children[0].calloutNumber).toBe(0);
  });

  // Item text does not include the `<N> ` marker or the
  // space after it.
  test("callout item text excludes marker", () => {
    const { children } = parse("<1> Hello world\n");
    const list = firstList(children);
    const textNode = list.children[0].text.find((c) => c.type === "text");
    narrow(textNode, "text");
    expect(textNode.value).toBe("Hello world");
  });

  // Callout lists are always flat — no nesting. Every callout
  // marker resolves to the one sentinel style `<>`, which is what
  // `is_sibling_list_item?` compares, so `<2>` continues `<1>`'s
  // list instead of opening a level.
  test("callout list items are flat (one shared marker)", () => {
    const { children } = parse("<1> A\n<2> B\n");
    const list = firstList(children);
    expect(list.marker).toBe("<>");
    expect(list.children).toHaveLength(2);
  });

  // A blank line between two callout items does NOT split the list
  // (`parse_list` skips blank lines before `next_list` looks for the
  // next sibling, for every list kind). ORACLE: one `colist`.
  test("two callout items separated by a blank line are one list", async () => {
    const input = "<1> List A\n\n<1> List B\n";
    const html = await renderedHtml(input);
    expect(html.match(/class="colist/gv)).toHaveLength(1);
    const { children } = parse(input);
    expect(children).toHaveLength(1);
    expect(firstList(children).children).toHaveLength(2);
  });

  // Position tracking: the list starts at the `<` of the
  // first marker.
  test("correct start position", () => {
    const { children } = parse("<1> Item\n");
    expect(children[0].position.start.offset).toBe(0);
    expect(children[0].position.start.line).toBe(1);
    expect(children[0].position.start.column).toBe(1);
  });

  // A callout item can span multiple lines. Continuation
  // lines (lines that don't start with a callout marker) are
  // part of the preceding item's text content.
  test("callout list item with continuation line", () => {
    const { children } = parse("<1> First line\nsecond line\n");
    const list = firstList(children);
    expect(list.children).toHaveLength(1);
    const textNode = list.children[0].text.find((c) => c.type === "text");
    narrow(textNode, "text");
    expect(textNode.value).toContain("First line");
    expect(textNode.value).toContain("second line");
  });

  // Callout numbers can be multi-digit.
  test("multi-digit callout number", () => {
    const { children } = parse("<12> Twelfth item\n");
    const list = firstList(children);
    expect(list.children[0].calloutNumber).toBe(12);
  });

  // Non-callout list items have `calloutNumber: undefined`.
  test("non-callout list items have no calloutNumber", () => {
    const { children } = parse("* Regular item\n");
    const list = firstList(children);
    expect(list.children[0].calloutNumber).toBeUndefined();
  });
});
