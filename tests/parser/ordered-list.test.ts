import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import { firstList, narrow, renderedHtml } from "../helpers.js";

describe("ordered list parsing", () => {
  // A list item can span multiple lines. A flush (non-indented)
  // continuation line — one that is not a list marker and not
  // blank — is absorbed into the preceding item's text content.
  // Indented continuation lines reach the item by a different route
  // through the reader; see "indented continuation lines in ordered
  // list".
  test("list item with continuation line", () => {
    const { children } = parse(". First line\nsecond line\n");
    expect(children).toHaveLength(1);
    const list = firstList(children);
    expect(list.children).toHaveLength(1);
    // toContain (not toBe) because continuation merges lines
    // with a newline character; exact whitespace is tested in
    // "indented continuation lines in ordered list".
    const {
      children: [item],
    } = list;
    const textNode = item.text.find((c) => c.type === "text");
    narrow(textNode, "text");
    expect(textNode.value).toContain("First line");
    expect(textNode.value).toContain("second line");
  });

  // A blank line between two items does NOT split the list (see the
  // unordered-list suite for the Ruby). ORACLE: one `<ol>`.
  test("two ordered items separated by a blank line are one list", async () => {
    const input = ". List A\n\n. List B\n";
    const html = await renderedHtml(input);
    expect(html.match(/<ol/gv)).toHaveLength(1);
    const { children } = parse(input);
    expect(children).toHaveLength(1);
    expect(firstList(children).children).toHaveLength(2);
  });

  // Position tracking: the list starts at the first `.` marker.
  test("correct start position", () => {
    const { children } = parse(". Item\n");
    expect(children[0].position.start.offset).toBe(0);
    expect(children[0].position.start.line).toBe(1);
    expect(children[0].position.start.column).toBe(1);
  });

  // List item text does not include the marker or the space
  // after it.
  test("item text excludes marker", () => {
    const { children } = parse(". Hello world\n");
    const list = firstList(children);
    const {
      children: [item],
    } = list;
    const textNode = item.text.find((c) => c.type === "text");
    narrow(textNode, "text");
    expect(textNode.value).toBe("Hello world");
  });

  // After nesting three levels deep (. → .. → ...), a subsequent
  // single-dot item must land as a sibling of the first — the
  // extent-first read keeps the root list's marker, not a nesting
  // stack, as the sibling test.
  test("return to root after deep nesting", () => {
    const { children } = parse(". L1\n.. L2\n... L3\n. Back to L1\n");
    const list = firstList(children);
    expect(list.children).toHaveLength(2);
    const {
      children: [first, second],
    } = list;
    expect(first.type).toBe("listItem");
    expect(second.type).toBe("listItem");
    expect(list.marker).toBe(".");
  });

  // A line with leading whitespace that immediately follows a list
  // item continues the item's text rather than starting a literal
  // paragraph. The indentation stays in the text node's value (the
  // printer splits on whitespace, so it never reaches the output).
  // This covers the real-world style of aligning wrapped text under
  // a marker, e.g. ". First line\n  continuation line".
  test("indented continuation lines in ordered list", () => {
    const input = ". First line\n  continuation line\n";
    const { children } = parse(input);
    expect(children).toHaveLength(1);
    const list = firstList(children);
    expect(list.children).toHaveLength(1);
    const {
      children: [item],
    } = list;
    const textNode = item.text.find((c) => c.type === "text");
    narrow(textNode, "text");
    expect(textNode.value).toBe("First line\n  continuation line");
  });
});
