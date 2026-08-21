/**
 * Shared helpers for the BlockReader characterization suites
 * (reader.test.ts and reader-lists.test.ts).
 *
 * A module rather than a test file so both suites read the SAME
 * definition of "the shape of a token stream" — two spellings would be
 * two contracts.
 */
import type { IToken } from "chevrotain";
import { inlineModeTokens } from "../../src/parse/tokens.js";
import { renderedHtml } from "../helpers.js";

// Inline tokens collapse to "t" (any inline token) and "/" (InlineNewline)
// so a shape string reads as structure; line/boundary tokens keep names.
const INLINE = new Set(inlineModeTokens.map((t) => t.name));

/**
 * Render a token stream as a readable structure string.
 * @param tokens - the reader's output
 * @returns token names, with runs of inline tokens collapsed to `t`
 */
export function shape(tokens: IToken[]): string {
  return (
    tokens
      .map(({ tokenType: { name } }) => {
        if (name === "InlineNewline") return "/";
        return INLINE.has(name) ? "t" : name;
      })
      .join(" ")
      // Collapse a RUN of inline tokens to one "t". The word boundary is
      // load-bearing: "ParagraphStart t" ends in `t t` and would collapse
      // into the token name itself without it.
      .replaceAll(/\bt(?: t)+\b/gv, "t")
  );
}

/**
 * `<li>` count from the oracle — the structure
 * `read_lines_for_list_item` exists to get right. The reader emits one
 * ItemEnd per list item, so the two counts must agree on every row.
 * @param input - the document
 * @returns how many `<li>` elements Asciidoctor renders
 */
export function oracleItems(input: string): number {
  return (renderedHtml(input).match(/<li>/gv) ?? []).length;
}

/**
 * Count tokens of one type in a stream.
 * @param tokens - the reader's output
 * @param name - the token type's name
 * @returns how many tokens carry that name
 */
export function count(tokens: IToken[], name: string): number {
  return tokens.filter(({ tokenType }) => tokenType.name === name).length;
}
