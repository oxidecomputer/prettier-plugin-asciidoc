import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import { firstList, narrow } from "../helpers.js";

describe("checklist parsing", () => {
  // `[*]` is an alternative checked marker, semantically identical
  // to `[x]`.
  test("[*] parses as checked", () => {
    const { children } = parse("* [*] Also done\n");
    const list = firstList(children);
    expect(list.children[0].checkbox).toBe("checked");
  });

  // Items without a checkbox marker have `checkbox: undefined`.
  test("no checkbox means undefined", () => {
    const { children } = parse("* Normal item\n");
    const list = firstList(children);
    expect(list.children[0].checkbox).toBeUndefined();
  });

  // The checkbox prefix is stripped from the text node value.
  test("checkbox text excludes marker", () => {
    const { children } = parse("* [x] Task text here\n");
    const list = firstList(children);
    const textNode = list.children[0].text.find((c) => c.type === "text");
    narrow(textNode, "text");
    expect(textNode.value).toBe("Task text here");
  });
});
