/**
 * `build/section.ts` — heading lines to nodes.
 *
 * Table-driven because the whole module is `(span, index) → node`
 * with no context: the rows are the specification, and they state
 * the two things prose cannot pin, the level arithmetic and the
 * exclusive-end convention.
 */
import { describe, expect, test } from "vitest";
import {
  buildDiscreteHeading,
  buildDocumentTitle,
  buildSection,
} from "../../../src/parse/build/section.js";
import { makeLocationIndex } from "../../../src/parse/positions.js";

describe("buildSection", () => {
  test.each([
    ["== One", 1, "One"],
    ["=== Two", 2, "Two"],
    ["====== Six", 5, "Six"],
    ["==   padded", 1, "padded"],
    ["== trailing spaces   ", 1, "trailing spaces"],
  ])("%j → level %i, %j", (line, level, heading) => {
    const at = makeLocationIndex(line);
    const node = buildSection({ image: line, offset: 0 }, at);
    expect(node.type).toBe("section");
    expect(node.level).toBe(level);
    expect(node.heading).toBe(heading);
    expect(node.children).toEqual([]);
  });

  test("the position is the heading LINE, end exclusive", () => {
    const source = "para\n== One\n";
    const at = makeLocationIndex(source);
    const node = buildSection({ image: "== One", offset: 5 }, at);
    expect(node.position).toEqual({
      start: { offset: 5, line: 2, column: 1 },
      end: { offset: 11, line: 2, column: 7 },
    });
  });
});

describe("buildDiscreteHeading", () => {
  test("has the level and text a section would have, and no children", () => {
    const node = buildDiscreteHeading(
      { image: "=== D", offset: 0 },
      makeLocationIndex("=== D"),
    );
    expect(node).toMatchObject({
      type: "discreteHeading",
      level: 2,
      heading: "D",
    });
    expect("children" in node).toBe(false);
  });

  test("the position is the heading LINE, end exclusive", () => {
    const source = "para\n=== D\n";
    const node = buildDiscreteHeading(
      { image: "=== D", offset: 5 },
      makeLocationIndex(source),
    );
    expect(node.position).toEqual({
      start: { offset: 5, line: 2, column: 1 },
      end: { offset: 10, line: 2, column: 6 },
    });
  });
});

describe("buildDocumentTitle", () => {
  test.each([
    ["= Title", "Title"],
    ["=   Title", "Title"],
  ])("%j → %j", (line, title) => {
    expect(
      buildDocumentTitle({ image: line, offset: 0 }, makeLocationIndex(line))
        .title,
    ).toBe(title);
  });

  test("the position is the title LINE, end exclusive", () => {
    const source = "= Title\n";
    expect(
      buildDocumentTitle(
        { image: "= Title", offset: 0 },
        makeLocationIndex(source),
      ).position,
    ).toEqual({
      start: { offset: 0, line: 1, column: 1 },
      end: { offset: 7, line: 1, column: 8 },
    });
  });
});
