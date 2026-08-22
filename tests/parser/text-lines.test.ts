/**
 * `textLines` groups a paragraph body's tokens into one synthetic
 * token per source line — the shape a paragraph-form admonition
 * stores its content in.
 *
 * The table is the module's specification: which tokens start a new
 * line, which get joined, and where a joined line claims to be. The
 * position contract is the subtle half — a joined line carries the
 * FIRST token's offset and the JOINED image, so its exclusive end is
 * `offset + image.length`, which is what `LocationIndex.end` reads.
 */
import { describe, expect, test } from "vitest";
import { textLines } from "../../src/parse/inline/text-lines.js";
import type { InlineToken } from "../../src/parse/inline/tokens.js";

/**
 * Build a token, so the rows read as data rather than as objects.
 * @param type - the token kind
 * @param image - its bytes
 * @param offset - its document offset
 * @returns the token
 */
function token(
  type: InlineToken["type"],
  image: string,
  offset: number,
): InlineToken {
  return { type, image, offset };
}

describe("textLines", () => {
  test("adjacent inline tokens join into one line token", () => {
    expect(
      textLines([
        token("InlineText", "a ", 0),
        token("BoldMark", "*", 2),
        token("InlineText", "b", 3),
        token("BoldMark", "*", 4),
      ]),
    ).toEqual([token("InlineText", "a *b*", 0)]);
  });

  test("a newline ends a line and produces no token of its own", () => {
    expect(
      textLines([
        token("InlineText", "a", 0),
        token("InlineNewline", "\n", 1),
        token("InlineText", "b", 2),
      ]),
    ).toEqual([token("InlineText", "a", 0), token("InlineText", "b", 2)]);
  });

  test("a raw line is a line already and passes through whole", () => {
    expect(
      textLines([
        token("InlineText", "a", 0),
        token("InlineNewline", "\n", 1),
        token("RawLine", "// c", 2),
      ]),
    ).toEqual([token("InlineText", "a", 0), token("RawLine", "// c", 2)]);
  });

  test("a raw line flushes the line in progress before itself", () => {
    expect(
      textLines([token("InlineText", "a", 0), token("RawLine", "// c", 1)]),
    ).toEqual([token("InlineText", "a", 0), token("RawLine", "// c", 1)]);
  });

  test("consecutive newlines produce no empty lines", () => {
    expect(
      textLines([
        token("InlineNewline", "\n", 0),
        token("InlineNewline", "\n", 1),
      ]),
    ).toEqual([]);
  });

  test("an empty body produces no lines", () => {
    expect(textLines([])).toEqual([]);
  });

  test("a joined line's offset is the FIRST token's, so its end is offset + image.length", () => {
    const [line] = textLines([
      token("InlineText", "ab", 7),
      token("InlineText", "cd", 9),
    ]);
    expect(line.offset).toBe(7);
    expect(line.offset + line.image.length).toBe(11);
  });
});
