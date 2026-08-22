/**
 * One synthetic token per source line of a paragraph body, with the
 * line's text joined into `image`.
 *
 * Used by the callers that store a body as a plain string rather than
 * an InlineNode tree — paragraph-form admonitions — so the printer
 * can re-emit it line by line. A RawLine is a line of its own already
 * and passes through; inline tokens are grouped at InlineNewline
 * boundaries.
 *
 * Its own module rather than part of inline-node-builder.ts because
 * it is the other consumer of the same token stream and has none of
 * that file's pairing machinery.
 */
import { EMPTY } from "../../constants.js";
import type { InlineToken } from "./tokens.js";

/**
 * Join one source line's tokens into a synthetic token whose image is
 * the line's text and whose offset is the first token's.
 * @param lineTokens - the tokens of one non-empty line, in order
 * @returns the synthetic line token
 */
function joinLine(lineTokens: readonly InlineToken[]): InlineToken {
  const [first] = lineTokens;
  return {
    ...first,
    image: lineTokens.map((token) => token.image).join(""),
  };
}

/**
 * Group a body's tokens into one token per source line.
 * @param tokens - a body's offset-sorted token stream
 * @returns one token per non-empty source line, in source order
 */
export function textLines(tokens: readonly InlineToken[]): InlineToken[] {
  const lines: InlineToken[] = [];
  let current: InlineToken[] = [];
  const flush = (): void => {
    if (current.length > EMPTY) {
      lines.push(joinLine(current));
      current = [];
    }
  };
  for (const token of tokens) {
    if (token.type === "InlineNewline") {
      flush();
    } else if (token.type === "RawLine") {
      flush();
      lines.push(token);
    } else {
      current.push(token);
    }
  }
  flush();
  return lines;
}
