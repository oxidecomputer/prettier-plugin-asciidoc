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
import { INLINE_RULES, markFlags } from "./rules.js";
import type { InlineKind, InlineToken } from "./tokens.js";
import { scanQuotePass, type InlineScan } from "./quote-pass.js";

/**
 * Tokenize one fragment of paragraph text.
 *
 * Constrained-mark boundaries are computed against THIS text, never
 * the document: a mark at index 0 sees a boundary because index -1 is
 * out of range, which is what makes `*bold*` after a list marker
 * bold. The caller therefore has to hand over a
 * fragment that starts where Asciidoctor's own substitution pass
 * would start.
 *
 * The four whole-text SCANS are the caller's too, and they are taken
 * over more text than this: the pass text a block's kept lines make
 * (quote-pass.ts), of which this fragment is one window. That is what
 * lets a doubled pair span a line the reader dropped while every
 * token's image stays a verbatim source slice.
 * @param text - the fragment, exactly as it appears in the source
 * @param baseOffset - document offset of `text[0]`, added to every
 *   token's offset so the result is in document coordinates
 * @param scan - the pass-wide scans in this fragment's coordinates
 *   (`windowOf`, quote-pass.ts)
 * @returns one token per matched run, in source order, covering the
 *   whole fragment with no gaps. `RawLine` is not among them: that
 *   kind is the paragraph reader's, not the tokenizer's.
 */
export function tokenizeInline(
  text: string,
  baseOffset: number,
  scan: InlineScan,
): Array<InlineToken<InlineKind>> {
  const tokens: Array<InlineToken<InlineKind>> = [];
  let index = 0;
  while (index < text.length) {
    let type: InlineKind = "InlineChar";
    let length = 0;
    for (const rule of INLINE_RULES) {
      length = rule.match(text, index, scan);
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
    if (length === 0) {
      length = 1;
    }
    // A mark token carries its DIRECTION facts - whether Ruby's
    // constrained pattern could open or close a span here - because
    // the neighbourhood is visible HERE, in the fragment, and the
    // builder that pairs marks into spans works on tokens alone.
    const flags = markFlags({
      type,
      text,
      index,
      length,
      curved: scan.curved,
      doubled: scan.doubled,
    });
    tokens.push({
      type,
      image: text.slice(index, index + length),
      offset: baseOffset + index,
      ...flags,
    });
    index += length;
  }
  return tokens;
}

/**
 * Tokenize a fragment that is the WHOLE of its own pass text.
 *
 * A description term is the case in src: the term stands on the
 * marker line, which is not part of the description's block text, so
 * nothing a scan could pair with reaches past it. The same holds for
 * any caller that hands over a construct entire - the census's
 * spellings, the tokenizer's own golden rows - and saying so at the
 * call is what keeps {@link tokenizeInline}'s scan parameter meaning
 * "this fragment's window of a wider pass".
 * @param text - the fragment, which is also its own pass text
 * @param baseOffset - document offset of `text[0]`
 * @returns the same tokens {@link tokenizeInline} returns
 */
export function tokenizeWholeText(
  text: string,
  baseOffset: number,
): Array<InlineToken<InlineKind>> {
  return tokenizeInline(text, baseOffset, scanQuotePass(text));
}
