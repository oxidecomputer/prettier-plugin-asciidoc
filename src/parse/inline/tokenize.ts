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
import { scanCurvedQuotes } from "./curved-quotes.js";
import { scanDoubledMarks } from "./doubled-marks.js";
import { scanSuperSubMarks } from "./super-sub.js";
import { scanReplacements } from "./replacements.js";

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
  // The two curved-quote rows are scanned ONCE for the whole fragment,
  // because their delimiter is not decidable from a neighbourhood
  // (curved-quotes.ts says why). Every rule is handed the result; the
  // two curved rules read it to find their own delimiters, and
  // InlineText's own rule reads it too, to cut its run before one
  // (rules.ts's textMatcher/firstCurvedDelimiterIn) - the same reason
  // it already cuts before an email address.
  const curved = scanCurvedQuotes(text);
  // The four unconstrained (doubled) rows are scanned ONCE for the same
  // reason (doubled-marks.ts says why): `**a**` pairs and `**a*` does
  // not, so whether two adjacent marks are one delimiter is a fact
  // about the whole fragment. The doubled scan reads the curved scan's
  // masked view where its own row runs later, so it is taken second.
  // The last two QUOTE_SUBS rows and the REPLACEMENTS table are scanned
  // once each, for the same reason and with the same shape: a
  // superscript delimiter answers to text arbitrarily far away
  // (`^a^b^` pairs the first two carets and leaves the third), and a
  // character reference answers to the ROW ORDER and to what an earlier
  // row already consumed (`<->` is one right arrow, `-- --` one em
  // dash). Both read the source rather than a rewritten view; their
  // modules' headers say why that is faithful.
  const scan = {
    curved,
    doubled: scanDoubledMarks(text, curved),
    superSub: scanSuperSubMarks(text),
    replacements: scanReplacements(text),
  };
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
    if (length === 0) length = 1;
    // A mark token carries its DIRECTION facts - whether Ruby's
    // constrained pattern could open or close a span here - because
    // the neighbourhood is visible HERE, in the fragment, and the
    // builder that pairs marks into spans works on tokens alone.
    const flags = markFlags({ type, text, index, length, curved });
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
