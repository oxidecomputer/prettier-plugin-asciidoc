/**
 * Inline tokenizer: walk the fragment once, take the first rule that
 * matches, fall back to one character of text.
 *
 * Total by construction — every position produces exactly one token —
 * which is why nothing downstream has an error path.
 * `start_chars_hint`, `line_breaks` and `Lexer.NA` were
 * Chevrotain's lexer bookkeeping, an optimisation or unused, and are
 * retired with it.
 */
import { INLINE_RULES } from "./rules.js";
import type { InlineKind, InlineToken } from "./tokens.js";

/**
 * Tokenize one fragment of paragraph text.
 *
 * Constrained-mark boundaries are computed against THIS text, never
 * the document: a mark at index 0 sees a boundary because index -1 is
 * out of range, which is what makes `*bold*` after a list marker
 * bold. The caller therefore has to hand over a
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
  let index = 0;
  while (index < text.length) {
    let type: InlineKind = "InlineChar";
    let length = 0;
    for (const rule of INLINE_RULES) {
      length = rule.match(text, index);
      if (length > 0) {
        ({ type } = rule);
        break;
      }
    }
    // No rule matched: one character of plain text. Not a defense —
    // the rules match constructs, and a character no rule claims (a
    // stray formatting mark, say) is InlineChar by definition. This
    // used to be the table's own last row; as the else branch it is
    // one mechanism instead of two that had to agree, and it keeps
    // the loop finite whatever the table contains.
    if (length === 0) length = 1;
    tokens.push({
      type,
      image: text.slice(index, index + length),
      offset: baseOffset + index,
    });
    index += length;
  }
  return tokens;
}
