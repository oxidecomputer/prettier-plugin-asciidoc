import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import { firstList } from "../helpers.js";
import { narrow } from "../../src/unreachable.js";

describe("checklist parsing", () => {
  // `[x]` is the canonical checked marker.
  test("[x] parses as checked", () => {
    const { children } = parse("* [x] Done\n");
    const list = firstList(children);
    expect(list.children[0].checkbox).toBe("checked");
    const textNode = list.children[0].text.find((c) => c.type === "text");
    narrow(textNode, "text");
    expect(textNode.value).toBe("Done");
  });

  // `[*]` is an alternative checked marker, semantically identical
  // to `[x]`.
  test("[*] parses as checked", () => {
    const { children } = parse("* [*] Also done\n");
    const list = firstList(children);
    expect(list.children[0].checkbox).toBe("checked");
  });

  // `[ ]` (space inside brackets) means unchecked.
  test("[ ] parses as unchecked", () => {
    const { children } = parse("* [ ] Not done\n");
    const list = firstList(children);
    expect(list.children[0].checkbox).toBe("unchecked");
  });

  // Items without a checkbox marker have `checkbox: undefined`.
  test("no checkbox means undefined", () => {
    const { children } = parse("* Normal item\n");
    const list = firstList(children);
    expect(list.children[0].checkbox).toBeUndefined();
  });

  // A list can mix checklist and non-checklist items.
  test("mixed checklist and normal items", () => {
    const { children } = parse("* [x] Done\n* Normal\n* [ ] Todo\n");
    const list = firstList(children);
    expect(list.children[0].checkbox).toBe("checked");
    expect(list.children[1].checkbox).toBeUndefined();
    expect(list.children[2].checkbox).toBe("unchecked");
  });

  // The checkbox prefix is stripped from the text node value.
  test("checkbox text excludes marker", () => {
    const { children } = parse("* [x] Task text here\n");
    const list = firstList(children);
    const textNode = list.children[0].text.find((c) => c.type === "text");
    narrow(textNode, "text");
    expect(textNode.value).toBe("Task text here");
  });

  // Checklist markers work at any nesting depth.
  test("nested checklist items", () => {
    const { children } = parse("* [x] Parent\n** [ ] Child\n");
    const list = firstList(children);
    expect(list.children[0].checkbox).toBe("checked");
    const nested = list.children[0].blocks.find(
      ({ block }) => block.type === "list",
    )?.block;
    narrow(nested, "list");
    expect(nested.children[0].checkbox).toBe("unchecked");
  });

  // AsciiDoc checklists only apply to unordered list items.
  // Ordered list items with `[x]` in the text are not checklists.
  test("ordered list items never have checkbox", () => {
    const { children } = parse(". [x] Not a checkbox\n");
    const list = firstList(children);
    expect(list.children[0].checkbox).toBeUndefined();
  });
});
