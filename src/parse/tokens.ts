/* eslint-disable require-unicode-regexp -- Chevrotain's regexp-to-ast does not support the v flag */

/**
 * Chevrotain token definitions for the INLINE lexer.
 *
 * The block layer is not lexed any more: the BlockReader
 * (src/parse/lines/reader.ts) classifies every source line itself and
 * emits the block vocabulary declared in src/parse/lines/tokens.ts.
 * What remains here is the inline vocabulary — formatting marks,
 * attribute references, escapes, plain text — which the reader runs
 * over each run of paragraph text through {@link inlineLexer} and
 * splices into its stream between the paragraph's boundary tokens.
 *
 * Token definition order matters: Chevrotain uses first-match-wins for
 * tokens that match the same input at the same length, so
 * {@link inlineModeTokens} is the priority order.
 *
 * Chevrotain rejects `^` and `$` anchors in token patterns. Where we
 * need "end of line" semantics, we use `(?![^\n])` — a negative
 * lookahead that asserts the match is followed by a newline or end of
 * input.
 */
import { createToken, Lexer } from "chevrotain";
import { makeInlineMarkPattern } from "./inline-mark-pattern.js";
import {
  InlineUrl,
  InlineMacro,
  XrefShorthand,
  InlineAnchor,
  HardLineBreak,
} from "./inline-link-tokens.js";

/**
 * Newline between two lines of one paragraph. The reader decides
 * where a paragraph ends, so this is a plain token: there is no lexer
 * mode to pop any more.
 */
export const InlineNewline = createToken({
  name: "InlineNewline",
  pattern: /\n/,
  line_breaks: true,
});

/** Escaped inline formatting mark: `\*`, `\_`, `` \` ``, `\#`. */
export const BackslashEscape = createToken({
  name: "BackslashEscape",
  pattern: /\\[*_`#]/,
});

/** Attribute reference like `{name}` or `{counter:name}`. */
export const AttributeReference = createToken({
  name: "AttributeReference",
  pattern: /\{[\w:.-][\w:.-]*\}/,
});

/** Role attribute `[role]` immediately before `#` (highlight). */
export const RoleAttribute = createToken({
  name: "RoleAttribute",
  pattern: /\[[^\]]+\](?=#)/,
});

// Re-export the link/macro tokens (defined in a separate file to stay
// within the max-lines limit).
export {
  InlineUrl,
  InlineMacro,
  XrefShorthand,
  InlineAnchor,
  HardLineBreak,
} from "./inline-link-tokens.js";

/** Bold formatting mark — `*` (constrained) or `**` (unconstrained). */
export const BoldMark = createToken({
  name: "BoldMark",
  pattern: makeInlineMarkPattern("*"),
  line_breaks: false,
  start_chars_hint: ["*"],
});

/** Italic formatting mark — `_` (constrained) or `__` (unconstrained). */
export const ItalicMark = createToken({
  name: "ItalicMark",
  pattern: makeInlineMarkPattern("_"),
  line_breaks: false,
  start_chars_hint: ["_"],
});

/**
 * Monospace formatting mark — `` ` `` (constrained) or
 * ``` `` ``` (unconstrained).
 */
export const MonoMark = createToken({
  name: "MonoMark",
  pattern: makeInlineMarkPattern("`"),
  line_breaks: false,
  start_chars_hint: ["`"],
});

/** Highlight formatting mark — `#` (constrained) or `##` (unconstrained). */
export const HighlightMark = createToken({
  name: "HighlightMark",
  pattern: makeInlineMarkPattern("#"),
  line_breaks: false,
  start_chars_hint: ["#"],
});

/**
 * Run of non-special characters in inline mode. The negative
 * lookaheads prevent consuming into URL/macro prefixes that
 * the dedicated tokens should match instead. The `<` character
 * is excluded so `<<ref>>` xref shorthand is not consumed as
 * text. The ` +\n` negative lookahead prevents consuming
 * the trailing space before a hard line break token. Note
 * that `+` itself is NOT excluded from the character class
 * because HardLineBreak uses this lookahead pattern — only
 * the ` +\n` sequence is reserved, not bare `+`.
 */
export const InlineText = createToken({
  name: "InlineText",
  pattern:
    /(?:(?!https?:\/\/|link:|mailto:|xref:|image:|kbd:|btn:|menu:|footnote(?:ref)?:|pass:| \+\n)[^\n*_`#\\{[<])+/,
});

/**
 * Single-character fallback for inline mode. MUST be last in
 * the inline mode token list so it only fires when no other
 * inline token matches.
 */
export const InlineChar = createToken({
  name: "InlineChar",
  pattern: /[^\n]/,
});

/**
 * The inline vocabulary in priority order. The parser's vocabulary is
 * this list plus the block vocabulary; the reader's fragment lexer is
 * built from exactly this list so the two can never drift apart.
 */
export const inlineModeTokens = [
  BackslashEscape,
  AttributeReference,
  RoleAttribute,
  // Inline macro token before link/xref/anchor tokens
  // and formatting marks — covers link:, mailto:, xref:,
  // image:, kbd:, btn:, menu:, footnote:, footnoteref:,
  // pass: macros in one token.
  InlineMacro,
  // Non-macro inline tokens with their own syntax.
  InlineUrl,
  XrefShorthand,
  InlineAnchor,
  BoldMark,
  ItalicMark,
  MonoMark,
  HighlightMark,
  HardLineBreak, // before InlineNewline (` +\n` before `\n`)
  InlineNewline,
  InlineText,
  InlineChar, // single-char fallback, must be last
];

/**
 * The single-mode inline lexer the BlockReader runs over each run of
 * paragraph text. Stateless, safe to share. Full position tracking
 * (the default) because the reader rebases every token to document
 * coordinates from its fragment-local line and column.
 */
export const inlineLexer = new Lexer(inlineModeTokens);
