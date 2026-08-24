/**
 * The ordered inline rule table — the single source of truth for
 * inline shapes, the way `src/parse/line-shapes.ts` is for line
 * shapes.
 *
 * FIRST MATCH WINS, in array order. That is not a simplification of
 * the lexer this replaces: that lexer had no `longer_alt`
 * on any token, so it was first-match-wins too, and "longest match"
 * behaviour was achieved inside the patterns (`InlineText`'s negative
 * lookahead, and `**` tried before `*` in the mark matcher). Building
 * a longest-match engine here would CHANGE behaviour.
 *
 * Every rule cites the Asciidoctor 2.0.26 source it mirrors
 * (`lib/asciidoctor/asciidoctor.rb`, `substitutors.rb`, `rx.rb`) — the
 * Ruby the oracle (`@asciidoctor/core` 4.0.11) is transpiled from.
 * Where our shape is deliberately narrower or wider than Ruby's, the
 * comment says so: the formatter only has to recognise the construct,
 * not resolve it.
 */
import type { InlineKind } from "./tokens.js";

/** One entry of the ordered table. */
interface InlineRule {
  /** The kind this rule produces. */
  readonly type: InlineKind;
  /**
   * How many characters match at `index`.
   * @param text - the fragment being tokenized
   * @param index - where to try, zero-based
   * @returns the match length, or 0 when the rule does not apply
   */
  readonly match: (text: string, index: number) => number;
}

// Punctuation that counts as a formatting boundary for constrained
// inline formatting (the AsciiDoc spec's term, distinct from regex
// \b). DIVERGENCE, stated as this file's header requires: this is a
// hand-written list, narrower than Ruby's rule. Ruby does not use a
// list at all — the constrained entries of `QUOTE_SUBS`
// (asciidoctor.rb l.448-464) test the neighbourhood with `(^|[^\w;:}])`
// on the left and `(?!\w)` on the right, so Asciidoctor's boundary set
// is "anything that is not a word character", minus `;` `:` `}` on the
// left. Ours is neither a subset nor a superset: `a;*b*` and `a_*b*`
// are bold for us and not for Asciidoctor, `a-*b*` and `*b*-c` are bold
// for Asciidoctor and not for us. The divergence is pre-existing, is
// pinned on purpose by tests/parser/inline-tokens.test.ts, and is filed
// as a tier-2 issue rather than fixed here.
//
// Formatting-mark characters are boundaries for each other, which is
// what lets `*_text_*` nest; `+` is a passthrough mark and is a
// boundary for the same reason.
// prettier-ignore
const BOUNDARY_PUNCTUATION = new Set([
  ",", ";", ":", "!", "?", ".", "(", ")", "[", "]",
  "{", "}", "<", ">", "/", '"', "'",
  "—", "–", "…",
  "*", "_", "`", "#", "+",
]);

const WHITESPACE = /\s/v;

/**
 * Whether the character at `index` is a constrained formatting
 * boundary. Out-of-range indices ARE boundaries: a mark at the very
 * start or end of the FRAGMENT is constrained-valid, and the fragment
 * is what the reader handed us — never the whole document: `* *bold*`
 * after a list marker sees a boundary at offset 0 because index -1 is
 * out of range.
 *
 * Reading the character IS the range test: past either end there is no
 * character, and no character is a boundary. The low end is spelled
 * here because `at` counts a negative index from the END of the
 * string, which would answer about the last character instead of about
 * the absent one.
 * @param text - the fragment being tokenized
 * @param index - the character position to test; may be out of range
 * @returns whether that position is a formatting boundary
 */
function isBoundary(text: string, index: number): boolean {
  const character = index < 0 ? undefined : text.at(index);
  return (
    character === undefined ||
    WHITESPACE.test(character) ||
    BOUNDARY_PUNCTUATION.has(character)
  );
}

/**
 * A constrained/unconstrained formatting mark — `strong`, `emphasis`,
 * `monospaced` and `mark` in the `QUOTE_SUBS` table, which is DEFINED
 * in asciidoctor.rb l.439-470 and consumed by substitutors.rb l.191.
 * Its constrained entries test the neighbouring characters
 * the way {@link isBoundary} does. The double mark is tried first
 * (unconstrained); the single one matches only next to a boundary, on
 * either side — the pairing into spans is inline-node-builder.ts's
 * job, not the tokenizer's.
 * @param character - the mark character (`*`, `_`, `` ` ``, `#`)
 * @returns the rule's match function
 */
function markMatcher(character: string): InlineRule["match"] {
  return (text: string, index: number): number => {
    if (text.at(index) !== character) return 0;
    if (text.at(index + 1) === character) return 1 + 1;
    return isBoundary(text, index - 1) || isBoundary(text, index + 1) ? 1 : 0;
  };
}

/**
 * A rule driven by a regex, matched AT an index rather than searched
 * for from it.
 *
 * The sticky flag is added here rather than written on every literal,
 * so no rule can forget it, and the sticky copy is private to the
 * returned function: `lastIndex` is per-rule state that nothing else
 * can observe.
 * @param regex - a `v`-flag regex, anchored implicitly at the index
 * @returns the rule's match function
 */
function pattern(regex: RegExp): InlineRule["match"] {
  const sticky = new RegExp(regex.source, "vy");
  return (text: string, index: number): number => {
    sticky.lastIndex = index;
    const match = sticky.exec(text);
    return match === null ? 0 : match[0].length;
  };
}

// The inline macro names, enumerated ONCE: interpolated into the
// InlineMacro rule and into InlineText's stop lookahead, so the two
// spellings cannot drift (they had: `footnoteref|footnote` here,
// `footnote(?:ref)?` there — same language, two dialects).
// `footnoteref` precedes `footnote` so the longer name wins.
const MACRO_NAMES =
  "link|mailto|xref|image|kbd|btn|menu|footnoteref|footnote|pass";

/**
 * The table, in priority order (see {@link INLINE_KINDS}).
 *
 * The rules report a miss as a zero-length match rather than as a
 * sentinel, which is why the `unicorn/no-null` suppression the
 * old custom matcher needed is gone.
 */
export const INLINE_RULES: readonly InlineRule[] = [
  // Escaped inline formatting mark: `\*`, `\_`, `` \` ``, `\#`
  // (substitutors.rb strips the backslash when it applies quotes).
  { type: "BackslashEscape", match: pattern(/\\[*_`#]/v) },
  // `{name}` / `{counter:name}` — AttributeReferenceRx. Narrower than
  // Ruby's, which also takes `set:`/`counter2:`; the formatter only
  // has to leave the reference alone.
  { type: "AttributeReference", match: pattern(/\{[\w:.\-][\w:.\-]*\}/v) },
  // `[role]` immediately before `#` — the shorthand attrlist of a
  // constrained highlight. Ruby has no constant for it: it is the
  // optional `(?:\[([^\]]+)\])?` group inside every `QUOTE_SUBS`
  // pattern (asciidoctor.rb l.448-464).
  { type: "RoleAttribute", match: pattern(/\[[^\]]+\](?=#)/v) },
  // `name:target[attrlist]` — InlineMacroRx family, with the macro
  // names enumerated rather than `[a-z]+`: a generic name matches
  // mid-word (`Textfootnote:`) and collides with `https://url[text]`.
  // The names and their order come from {@link MACRO_NAMES}.
  {
    type: "InlineMacro",
    match: pattern(
      new RegExp(String.raw`(?:${MACRO_NAMES}):[^\s\[]*\[[^\]]*\]`, "v"),
    ),
  },
  // Bare URL, with or without an attrlist — InlineLinkRx.
  {
    type: "InlineUrl",
    match: pattern(/https?:\/\/[^\s\[\]]+(?:\[[^\]]*\])?/v),
  },
  // `<<target>>` / `<<target,text>>` — InlineXrefMacroRx shorthand.
  { type: "XrefShorthand", match: pattern(/<<[^>\n]+(?:,[^>\n]+)?>>/v) },
  // `[[id]]` / `[[id, reftext]]` — InlineAnchorRx.
  { type: "InlineAnchor", match: pattern(/\[\[[^\]\n]+\]\]/v) },
  { type: "BoldMark", match: markMatcher("*") },
  { type: "ItalicMark", match: markMatcher("_") },
  { type: "MonoMark", match: markMatcher("`") },
  { type: "HighlightMark", match: markMatcher("#") },
  // ` +` at end of line — HardLineBreakRx (`^(.*) \+$` after
  // `adjust_indentation!`). The newline is left for InlineNewline.
  // Context-free on purpose: the one shape Asciidoctor reads as a
  // literal `+` instead is decided by the reader's literal-plus rule
  // (lines/paragraph-reader.ts), which tells the caller.
  { type: "HardLineBreak", match: pattern(/ \+(?=\n)/v) },
  // Not an Asciidoctor construct: Ruby reads a paragraph line by line,
  // so the line break inside one is structure it never has to match.
  // We tokenize the whole run at once and need it as a token.
  { type: "InlineNewline", match: pattern(/\n/v) },
  // A run of ordinary characters. The negative lookahead is what
  // stops the run BEFORE a URL, a macro name or a hard break, which
  // is how first-match-wins produces longest-match behaviour without
  // a longest-match engine. `<` is excluded so `<<ref>>` is not eaten
  // as text; bare `+` is NOT excluded — only the ` +\n` sequence is
  // reserved. Ruby has no equivalent: substitutors.rb rewrites the
  // whole line with `gsub`, so "everything else" is never named.
  {
    type: "InlineText",
    match: pattern(
      new RegExp(
        `(?:(?!https?://|(?:${MACRO_NAMES}):| \\+\\n)[^\\n*_\`#\\\\\\{\\[<])+`,
        "v",
      ),
    ),
  },
  // Single-character fallback. MUST be last: it is what makes the
  // tokenizer total, so there is no error channel to read (the
  // old lexer's `errors` output was never read — provably dead).
  { type: "InlineChar", match: pattern(/[^\n]/v) },
];
