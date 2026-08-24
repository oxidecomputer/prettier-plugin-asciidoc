/**
 * `build/heading.ts` — heading lines to nodes.
 *
 * Table-driven because the whole module is `(span, level, title,
 * index) → node` with no context: the rows state the two things prose
 * cannot pin — that the builder is a FIELD READER over the
 * CLASSIFIER's parse (the module's own pattern, its slice arithmetic
 * and its agreement guard are all gone, spec D10(c)) — and the
 * exclusive-end convention. The level/title derivation itself is
 * pinned on `parseSectionTitle` in tests/parser/lines.test.ts.
 */
import { describe, expect, test } from "vitest";
import {
  buildDiscreteHeading,
  buildHeading,
} from "../../../src/parse/build/heading.js";
import { parseSectionTitle } from "../../../src/parse/lines/classify.js";
import { makeLocationIndex } from "../../../src/parse/positions.js";

/**
 * The classifier's parse of a heading line, the way the reader hands
 * it to the builder.
 * @param line - one rstripped heading line
 * @returns its level and title
 */
function parsed(line: string): { level: number; title: string } {
  const kind = parseSectionTitle(line);
  if (kind === undefined) throw new Error(`not a section title: ${line}`);
  return kind;
}

describe("buildHeading", () => {
  test.each([
    ["= Doc", 0, "Doc"],
    ["=   spaced doc", 0, "spaced doc"],
    ["== One", 1, "One"],
    ["=== Two", 2, "Two"],
    ["====== Six", 5, "Six"],
    ["==   padded", 1, "padded"],
  ])("%j at level %i -> %j", (line, level, title) => {
    const at = makeLocationIndex(line);
    const kind = parsed(line);
    const node = buildHeading(
      { image: line, offset: 0 },
      kind.level,
      kind.title,
      at,
    );
    expect(node.type).toBe("heading");
    expect(node.level).toBe(level);
    expect(node.title).toBe(title);
    expect("children" in node).toBe(false);
  });

  test("the title is carried verbatim — the builder decides nothing", () => {
    const at = makeLocationIndex("== One");
    const node = buildHeading({ image: "== One", offset: 0 }, 1, "  odd  ", at);
    expect(node.title).toBe("  odd  ");
  });

  test("the position is the heading LINE, end exclusive", () => {
    const source = "para\n== One\n";
    const at = makeLocationIndex(source);
    const node = buildHeading({ image: "== One", offset: 5 }, 1, "One", at);
    expect(node.position).toEqual({
      start: { offset: 5, line: 2, column: 1 },
      end: { offset: 11, line: 2, column: 7 },
    });
  });
});

describe("buildDiscreteHeading", () => {
  test("has the level and text an ordinary heading would, and no children", () => {
    const kind = parsed("=== D");
    const node = buildDiscreteHeading(
      { image: "=== D", offset: 0 },
      kind.level,
      kind.title,
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
      "D",
      makeLocationIndex(source),
    );
    expect(node.position).toEqual({
      start: { offset: 5, line: 2, column: 1 },
      end: { offset: 10, line: 2, column: 6 },
    });
  });
});
