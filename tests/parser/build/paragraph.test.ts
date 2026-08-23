/**
 * `build/paragraph.ts` — inline bodies and line runs to nodes.
 *
 * Table-driven because every function here is `(tokens, index) → node`
 * with no context: the rows are the specification. They pin the one
 * rule prose keeps getting wrong — a paragraph is positioned over its
 * CONTENT tokens, so the newline that ended it is outside its span —
 * and the empty-body arms.
 */
import { describe, expect, test } from "vitest";
import {
  bodyExtent,
  buildAdmonitionParagraph,
  buildLiteralParagraph,
  buildParagraph,
  buildRawLineParagraph,
} from "../../../src/parse/build/paragraph.js";
import type { InlineToken } from "../../../src/parse/inline/tokens.js";
import { makeLocationIndex } from "../../../src/parse/positions.js";

/**
 * One inline text token at a document offset.
 * @param image - the token's bytes
 * @param offset - where they start
 * @returns the token
 */
function text(image: string, offset: number): InlineToken {
  return { type: "InlineText", image, offset };
}

/**
 * One inline newline token at a document offset.
 * @param offset - where it starts
 * @returns the token
 */
function newline(offset: number): InlineToken {
  return { type: "InlineNewline", image: "\n", offset };
}

describe("bodyExtent", () => {
  const source = "one\ntwo\n";
  const at = makeLocationIndex(source);

  test("spans the first to the last CONTENT token", () => {
    expect(
      bodyExtent([text("one", 0), newline(3), text("two", 4)], at),
    ).toEqual({
      start: { offset: 0, line: 1, column: 1 },
      end: { offset: 7, line: 2, column: 4 },
    });
  });

  test("ignores leading and trailing newlines", () => {
    expect(bodyExtent([newline(3), text("two", 4), newline(7)], at)).toEqual({
      start: { offset: 4, line: 2, column: 1 },
      end: { offset: 7, line: 2, column: 4 },
    });
  });

  test("a single token starts and ends on itself", () => {
    expect(bodyExtent([text("one", 0)], at)).toEqual({
      start: { offset: 0, line: 1, column: 1 },
      end: { offset: 3, line: 1, column: 4 },
    });
  });

  test.each([
    ["an empty body", [] as InlineToken[]],
    ["a body of nothing but newlines", [newline(3), newline(7)]],
  ])("%s yields the document origin twice", (_name, tokens) => {
    const origin = { offset: 0, line: 1, column: 1 };
    expect(bodyExtent(tokens, at)).toEqual({ start: origin, end: origin });
  });
});

describe("buildParagraph", () => {
  test("joins its children and is positioned over the content", () => {
    const source = "one\ntwo\n";
    const node = buildParagraph(
      [text("one", 0), newline(3), text("two", 4)],
      makeLocationIndex(source),
    );
    expect(node.type).toBe("paragraph");
    expect(node.children).toEqual([
      {
        type: "text",
        value: "one\ntwo",
        position: {
          start: { offset: 0, line: 1, column: 1 },
          end: { offset: 7, line: 2, column: 4 },
        },
      },
    ]);
    expect(node.position).toEqual({
      start: { offset: 0, line: 1, column: 1 },
      end: { offset: 7, line: 2, column: 4 },
    });
  });
});

describe("buildRawLineParagraph", () => {
  test("keeps the line verbatim as the paragraph's only child", () => {
    const node = buildRawLineParagraph(
      { image: "+", offset: 2 },
      makeLocationIndex("a\n+\n"),
    );
    const position = {
      start: { offset: 2, line: 2, column: 1 },
      end: { offset: 3, line: 2, column: 2 },
    };
    expect(node).toEqual({
      type: "paragraph",
      children: [{ type: "rawLine", value: "+", position }],
      position,
    });
  });
});

describe("buildLiteralParagraph", () => {
  test("joins the run's lines with newlines, indentation kept", () => {
    const source = "  a\n   b\n  c\n";
    const node = buildLiteralParagraph(
      [
        { image: "  a", offset: 0 },
        { image: "   b", offset: 4 },
        { image: "  c", offset: 9 },
      ],
      makeLocationIndex(source),
    );
    expect(node).toEqual({
      type: "delimitedBlock",
      variant: "literal",
      form: "indented",
      content: "  a\n   b\n  c",
      position: {
        start: { offset: 0, line: 1, column: 1 },
        end: { offset: 12, line: 3, column: 4 },
      },
    });
  });

  test("a single line starts and ends on itself", () => {
    expect(
      buildLiteralParagraph(
        [{ image: "  a", offset: 0 }],
        makeLocationIndex("  a\n"),
      ).position,
    ).toEqual({
      start: { offset: 0, line: 1, column: 1 },
      end: { offset: 3, line: 1, column: 4 },
    });
  });
});

describe("buildAdmonitionParagraph", () => {
  const source = "NOTE: one\ntwo\n";
  const at = makeLocationIndex(source);
  const label = { image: "NOTE: ", offset: 0 };

  test("takes its variant from the label and keeps the body inline", () => {
    const node = buildAdmonitionParagraph(
      label,
      [text("one", 6), newline(9), text("two", 10)],
      at,
    );
    expect(node).toEqual({
      type: "admonition",
      variant: "note",
      form: "paragraph",
      // The SAME inline children a paragraph gets (spec D7): one text
      // node spanning both lines, the newline kept in its value.
      text: [
        {
          type: "text",
          value: "one\ntwo",
          position: {
            start: { offset: 6, line: 1, column: 7 },
            end: { offset: 13, line: 2, column: 4 },
          },
        },
      ],
      children: [],
      position: {
        start: { offset: 0, line: 1, column: 1 },
        end: { offset: 13, line: 2, column: 4 },
      },
    });
  });

  test.each([
    ["NOTE: ", "note"],
    ["WARNING: ", "warning"],
  ])("%j → variant %j", (image, variant) => {
    expect(buildAdmonitionParagraph({ image, offset: 0 }, [], at).variant).toBe(
      variant,
    );
  });

  test("an empty body has no inline children and ends at the label's end", () => {
    expect(buildAdmonitionParagraph(label, [], at)).toMatchObject({
      text: [],
      children: [],
      position: {
        start: { offset: 0, line: 1, column: 1 },
        end: { offset: 6, line: 1, column: 7 },
      },
    });
  });
});
