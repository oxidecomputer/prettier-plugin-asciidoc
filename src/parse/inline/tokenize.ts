/**
 * Inline tokenizer: walk the fragment once, take the first rule that
 * matches, fall back to one character of text.
 *
 * Total by construction — every position produces exactly one token —
 * which is why nothing downstream has an error path (spec Decision
 * 6). `start_chars_hint`, `line_breaks` and `Lexer.NA` were
 * lexer-toolkit bookkeeping, an optimisation or unused, and are retired
 * with it.
 */
import { EMPTY, NEXT } from "../../constants.js";
import { INLINE_RULES } from "./rules.js";
import type { InlineKind, InlineToken } from "./tokens.js";

/**
 * Tokenize one fragment of paragraph text.
 *
 * Constrained-mark boundaries are computed against THIS text, never
 * the document: a mark at index 0 sees a boundary because index -1 is
 * out of range, which is what makes `*bold*` after a list marker
 * bold (spec Decision 8). The caller therefore has to hand over a
 * fragment that starts where Asciidoctor's own substitution pass
 * would start.
 * @param text - the fragment, exactly as it appears in the source
 * @param baseOffset - document offset of `text[0]`, added to every
 *   token's offset so the result is in document coordinates
 * @returns one token per matched run, in source order, covering the
 *   whole fragment with no gaps. `RawLine` is not among them: that
 *   kind is the paragraph reader's, not the tokenizer's.
 */
export function tokenizeInline(
  text: string,
  baseOffset: number,
): Array<InlineToken<InlineKind>> {
  const tokens: Array<InlineToken<InlineKind>> = [];
  let index = EMPTY;
  while (index < text.length) {
    let length = EMPTY;
    for (const rule of INLINE_RULES) {
      length = rule.match(text, index);
      if (length > EMPTY) {
        tokens.push({
          type: rule.type,
          image: text.slice(index, index + length),
          offset: baseOffset + index,
        });
        break;
      }
    }
    // Total fallback: unreachable while `InlineChar` is last in the
    // table — it matches any character but a newline, and a newline is
    // matched by InlineNewline. Kept as a one-character step rather
    // than a throw so the tokenizer stays total whatever the table
    // says.
    if (length === EMPTY) {
      tokens.push({
        type: "InlineChar",
        image: text.slice(index, index + NEXT),
        offset: baseOffset + index,
      });
      length = NEXT;
    }
    index += length;
  }
  return tokens;
}
