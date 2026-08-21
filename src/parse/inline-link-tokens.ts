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
import type { CustomPatternMatcherReturn } from "chevrotain";
import { EMPTY, FIRST, NEXT, NOT_FOUND } from "../constants.js";
import {
  isDescriptionListLine,
  isRawParagraphLine,
  listMarkerStyle,
} from "./line-shapes.js";

// A hard line break is a space and a `+` at end of line. The token's
// IMAGE is just those two characters; the newline is matched but not
// consumed (InlineNewline owns it, and its mode pop).
const HARD_BREAK_IMAGE = " +";
// The `+` inside that image; everything before it is the line's
// indent when nothing else precedes it.
const PLUS = "+";
const HARD_BREAK_WITH_NEWLINE = `${HARD_BREAK_IMAGE}\n`;

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
 * Offset of the first character of the line containing `offset`.
 * @param text - the full source being lexed
 * @param offset - any offset on the line
 * @returns the line's start offset (0 for the first line)
 */
function lineStartAt(text: string, offset: number): number {
  return text.lastIndexOf("\n", offset - NEXT) + NEXT;
}

/**
 * Number of leading spaces and tabs on a line.
 * @param line - one source line, without its newline
 * @returns the indent width in characters
 */
function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/**
 * Whether every remaining CONTENT line of the block is indented at
 * least `indent` characters — i.e. whether `adjust_indentation!`
 * will strip the whole of the ` +` line's own indent.
 *
 * The block runs to the next blank line or to end of input. Comment
 * and preprocessor lines are not measured: `read_paragraph_lines`
 * is called with `skip_line_comments`, so they never reach
 * `adjust_indentation!`.
 * @param text - the full source being lexed
 * @param newlineOffset - offset of the `\n` ending the ` +` line
 * @param indent - the ` +` line's own indent
 * @returns true when nothing below reduces the common indent
 */
function restOfBlockIsIndented(
  text: string,
  newlineOffset: number,
  indent: number,
): boolean {
  let cursor = newlineOffset;
  while (cursor < text.length) {
    const start = cursor + NEXT;
    const end = text.indexOf("\n", start);
    const line = text.slice(start, end === NOT_FOUND ? text.length : end);
    if (line.trim().length === EMPTY) {
      return true;
    }
    if (!isRawParagraphLine(line) && indentOf(line) < indent) {
      return false;
    }
    if (end === NOT_FOUND) {
      return true;
    }
    cursor = end;
  }
  return true;
}

/**
 * Whether the ` +` at `offset` is a literal plus rather than a hard
 * line break.
 *
 * Asciidoctor decides this in `adjust_indentation!`, not in the
 * break rule: `LineBreakRx` (`/^(.*)[ \t]\+$/`) matches the line as
 * the parser holds it, and a list item's continuation lines have
 * their COMMON indent stripped first. So a ` +` that is the whole of
 * an item's continuation block loses its space and becomes a bare
 * `+` — plain text — while everywhere else the space survives and
 * the break stands. The oracle: `. item` / ` +` renders `item +`,
 * and so does `. item` / ` +` / `  more` (every line indented, so
 * the common indent is 1), but `. item` / ` +` / `more` renders
 * `item <br> more` (the unindented `more` makes it 0) and so does
 * `text` / ` +` (a plain paragraph is never re-indented at all).
 * @param text - the full source being lexed
 * @param offset - offset of the space in ` +`
 * @returns true when the `+` is literal text here
 */
function isStrippedToLiteralPlus(text: string, offset: number): boolean {
  const lineStart = lineStartAt(text, offset);
  // Content before the `+` means the line keeps a break whatever the
  // indent does — `LineBreakRx` only needs SOME character before it.
  if (text.slice(lineStart, offset).trim().length > EMPTY) {
    return false;
  }
  if (lineStart === FIRST) {
    return false;
  }
  // The indent is stripped only when the block is a list item's
  // continuation block, which this line opens — so the line above is
  // the item's own (marker or `term::`) line.
  const previousStart = lineStartAt(text, lineStart - NEXT);
  const previous = text.slice(previousStart, lineStart - NEXT);
  if (
    listMarkerStyle(previous.trimStart()) === undefined &&
    !isDescriptionListLine(previous)
  ) {
    return false;
  }
  // ...and only when no later line of the block is less indented
  // than this one, since `adjust_indentation!` strips their MINIMUM.
  // The line's indent is everything before the `+` itself, and the
  // token's own leading space is part of it.
  const plusColumn = offset + HARD_BREAK_IMAGE.indexOf(PLUS);
  return restOfBlockIsIndented(
    text,
    offset + HARD_BREAK_IMAGE.length,
    plusColumn - lineStart,
  );
}

/**
 * Hard line break: ` +` at end of a line. A space followed by
 * `+` immediately before a newline forces a line break in
 * output. Uses a lookahead for `\n` rather than consuming it —
 * the newline is left for InlineNewline to handle (including
 * its mode pop back to paragraph mode). Must appear before
 * InlineNewline in the inline mode token list.
 *
 * The custom matcher subtracts the one shape Asciidoctor strips the
 * indent out of before applying `LineBreakRx` — see
 * {@link isStrippedToLiteralPlus}. A plain regex cannot express it:
 * Chevrotain rejects `^`, and the decision needs the lines around
 * this one.
 */
export const HardLineBreak = createToken({
  name: "HardLineBreak",
  pattern: {
    exec: (text: string, offset: number): CustomPatternMatcherReturn | null => {
      const isBreak =
        text.startsWith(HARD_BREAK_WITH_NEWLINE, offset) &&
        !isStrippedToLiteralPlus(text, offset);
      return isBreak
        ? ([HARD_BREAK_IMAGE] as CustomPatternMatcherReturn)
        : // eslint-disable-next-line unicorn/no-null -- Chevrotain requires null
          null;
    },
  },
  line_breaks: false,
  start_chars_hint: [" "],
});
