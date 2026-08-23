/**
 * `build/heading.ts` — heading lines to nodes.
 *
 * Table-driven because the whole module is `(span, level, index) →
 * node` with no context: the rows state the two things prose cannot
 * pin — the slice arithmetic against the CLASSIFIER's level (the one
 * derivation; the module's own pattern and agreement guard are gone,
 * spec D10(c)) — and the exclusive-end convention.
 */
import { describe, expect, test } from "vitest";
import {
  buildDiscreteHeading,
  buildHeading,
} from "../../../src/parse/build/heading.js";
import { makeLocationIndex } from "../../../src/parse/positions.js";

describe("buildHeading", () => {
  test.each([
    ["= Doc", 0, "Doc"],
    ["=   spaced doc  ", 0, "spaced doc"],
    ["== One", 1, "One"],
    ["=== Two", 2, "Two"],
    ["====== Six", 5, "Six"],
    ["==   padded", 1, "padded"],
    ["== trailing spaces   ", 1, "trailing spaces"],
  ])("%j at level %i -> %j", (line, level, title) => {
    const at = makeLocationIndex(line);
    const node = buildHeading({ image: line, offset: 0 }, level, at);
    expect(node.type).toBe("heading");
    expect(node.level).toBe(level);
    expect(node.title).toBe(title);
    expect("children" in node).toBe(false);
  });

  test("the position is the heading LINE, end exclusive", () => {
    const source = "para\n== One\n";
    const at = makeLocationIndex(source);
    const node = buildHeading({ image: "== One", offset: 5 }, 1, at);
    expect(node.position).toEqual({
      start: { offset: 5, line: 2, column: 1 },
      end: { offset: 11, line: 2, column: 7 },
    });
  });
});

describe("buildDiscreteHeading", () => {
  test("has the level and text an ordinary heading would, and no children", () => {
    const node = buildDiscreteHeading(
      { image: "=== D", offset: 0 },
      2,
      makeLocationIndex("=== D"),
    );
    expect(node).toMatchObject({
      type: "discreteHeading",
      level: 2,
      title: "D",
    });
    expect("children" in node).toBe(false);
  });

  test("the position is the heading LINE, end exclusive", () => {
    const source = "para\n=== D\n";
    const node = buildDiscreteHeading(
      { image: "=== D", offset: 5 },
      2,
      makeLocationIndex(source),
    );
    expect(node.position).toEqual({
      start: { offset: 5, line: 2, column: 1 },
      end: { offset: 10, line: 2, column: 6 },
    });
  });
});
