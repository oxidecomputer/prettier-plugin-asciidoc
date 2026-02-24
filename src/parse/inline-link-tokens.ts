/* eslint-disable require-unicode-regexp -- Chevrotain's regexp-to-ast does not support the v flag */

/**
 * Inline link, xref, anchor, and macro tokens for the
 * Chevrotain lexer.
 *
 * Extracted from tokens.ts to keep that file within the
 * max-lines lint limit. Defines tokens for:
 * - Bare URLs (InlineUrl) — `https://url` or `https://url[text]`
 * - Unified inline macros (InlineMacro) — `name:target[attrlist]`
 * - Xref shorthand (XrefShorthand) — `<<target>>`
 * - Inline anchors (InlineAnchor) — `[[id]]`
 * - Hard line breaks (HardLineBreak) — ` +\n`
 *
 * These must appear before `InlineText` in the inline mode
 * array so the lexer prefers them over generic text runs.
 */
import { createToken } from "chevrotain";

/** Inline URL: `https://url` or `https://url[text]`. */
export const InlineUrl = createToken({
  name: "InlineUrl",
  pattern: /https?:\/\/[^\s[\]]+(?:\[[^\]]*\])?/,
  start_chars_hint: ["h"],
});

/**
 * Unified inline macro: `name:target[attrlist]`. Enumerates
 * the standard AsciiDoc inline macro names rather than using
 * a generic `[a-z]+` pattern because:
 * - `[a-z]+` matches mid-word (`Textfootnote:` → `extfootnote:`)
 * - `[a-z]+` collides with URLs (`https://url[text]` matches)
 * `footnoteref` precedes `footnote` so the longer name matches
 * first. The target portion (`[^\s[]*`) allows zero chars for
 * macros like kbd and btn that have no target.
 */
export const InlineMacro = createToken({
  name: "InlineMacro",
  pattern:
    /(?:link|mailto|xref|image|kbd|btn|menu|footnoteref|footnote|pass):[^\s[]*\[[^\]]*\]/,
  start_chars_hint: ["b", "f", "i", "k", "l", "m", "p", "x"],
});

/** Xref shorthand: `<<target>>` or `<<target,text>>`. */
export const XrefShorthand = createToken({
  name: "XrefShorthand",
  pattern: /<<[^>\n]+(?:,[^>\n]+)?>>/,
  start_chars_hint: ["<"],
});

/** Inline anchor: `[[id]]` or `[[id, reftext]]`. */
export const InlineAnchor = createToken({
  name: "InlineAnchor",
  pattern: /\[\[[^\]\n]+\]\]/,
  start_chars_hint: ["["],
});

/**
 * Hard line break: ` +` at end of a line. A space followed by
 * `+` immediately before a newline forces a line break in
 * output. Uses a lookahead for `\n` rather than consuming it —
 * the newline is left for InlineNewline to handle (including
 * its mode pop back to default_mode). Must appear before
 * InlineNewline in the inline mode token list.
 */
export const HardLineBreak = createToken({
  name: "HardLineBreak",
  pattern: / \+(?=\n)/,
  start_chars_hint: [" "],
});
