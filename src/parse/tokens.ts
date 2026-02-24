/* eslint-disable require-unicode-regexp -- Chevrotain's regexp-to-ast does not support the v flag */

/**
 * Chevrotain token definitions for the AsciiDoc lexer.
 *
 * Token definition order matters: Chevrotain uses first-match-wins for tokens
 * that match the same input at the same length. BlankLine must precede Newline
 * (a blank line starts with \n, which Newline would also match), and
 * SectionMarker must precede InlineModeStart (a heading line is also valid text).
 *
 * All tokens containing newlines need `line_breaks: true` so Chevrotain tracks
 * line/column positions correctly through them.
 *
 * Chevrotain rejects `^` and `$` anchors in token patterns. Where we need
 * "end of line" semantics, we use `(?![^\n])` — a negative lookahead that
 * asserts the match is followed by a newline or end of input.
 *
 * Block comments use a multi-mode lexer: when a `////` delimiter is seen, the
 * lexer pushes into `block_comment` mode where everything is captured verbatim
 * until the closing `////` delimiter. This prevents block comment content from
 * being parsed as headings, paragraphs, or other AsciiDoc constructs.
 */
import { createToken, Lexer } from "chevrotain";
import type { CustomPatternMatcherReturn } from "chevrotain";
import { NEXT } from "../constants.js";
import {
  makeClosePattern,
  makeParentClosePattern,
} from "./delimiter-patterns.js";
import { makeInlineMarkPattern } from "./inline-mark-pattern.js";
import {
  HardLineBreak,
  InlineImage,
  KbdMacro,
  ButtonMacro,
  MenuMacro,
  FootnoteMacro,
  FootnoteReferenceMacro,
  PassMacro,
} from "./inline-macro-tokens.js";
// Re-export inline macro tokens (defined in a separate file to stay within the max-lines limit).
export {
  HardLineBreak,
  InlineImage,
  KbdMacro,
  ButtonMacro,
  MenuMacro,
  FootnoteMacro,
  FootnoteReferenceMacro,
  PassMacro,
} from "./inline-macro-tokens.js";

/**
 * One or more empty/whitespace-only lines. Matches a newline
 * followed by one or more (optional-whitespace + newline)
 * sequences. Must be defined before Newline so the lexer
 * prefers it when applicable.
 */
export const BlankLine = createToken({
  name: "BlankLine",
  pattern: /\n(?:[ \t]*\n)+/,
  line_breaks: true,
});

/** A single line break within a paragraph. */
export const Newline = createToken({
  name: "Newline",
  pattern: /\n/,
  line_breaks: true,
});

/**
 * A heading line starting with 2-6 equals signs followed by
 * space and title text. Must be defined before InlineModeStart
 * so the lexer prefers it for heading lines.
 */
export const SectionMarker = createToken({
  name: "SectionMarker",
  pattern: /={2,6} [^\n]+/,
});

/**
 * Document title: `= Title` (single `=` followed by space and text).
 * Only one `=` sign, unlike SectionMarker which matches `={2,6}`.
 * Placed after SectionMarker in priority order to keep headings
 * grouped logically. The patterns do overlap (`/= [^\n]+/`
 * matches `== Title`), but token priority saves us:
 * SectionMarker appears first in the mode array, so Chevrotain
 * prefers it for any line starting with `={2,6} `.
 */
export const DocumentTitle = createToken({
  name: "DocumentTitle",
  pattern: /= (?!=)[^\n]+/,
});

/**
 * Listing block open delimiter: 4+ dashes on their own line.
 * Pushes into listing_verbatim mode where content is captured
 * verbatim until a matching `----` close delimiter. Must precede
 * BlockCommentDelimiter (which also starts with repeated chars)
 * and InlineModeStart in priority order.
 */
export const ListingBlockOpen = createToken({
  name: "ListingBlockOpen",
  pattern: /-{4,}/,
  push_mode: "listing_verbatim",
});

/**
 * Literal block open delimiter: 4+ dots on their own line.
 * Pushes into literal_verbatim mode. Must precede OrderedListMarker
 * (which also starts with dots) and InlineModeStart.
 */
export const LiteralBlockOpen = createToken({
  name: "LiteralBlockOpen",
  // Negative lookahead prevents matching when the dots are
  // followed by more dots or a space — those are ordered list
  // markers (e.g. `.... text` at depth 4 or `..... text` at
  // depth 5). Delimiters occupy a line by themselves.
  pattern: /\.{4,}(?![. ])/,
  push_mode: "literal_verbatim",
});

/**
 * Passthrough block open delimiter: 4+ plus signs on their own
 * line. Pushes into pass_verbatim mode. Must precede InlineModeStart.
 */
export const PassBlockOpen = createToken({
  name: "PassBlockOpen",
  pattern: /\+{4,}/,
  push_mode: "pass_verbatim",
});

/**
 * Markdown-style fenced code block opener: three backticks with
 * an optional language hint (e.g. `` ```rust ``). Pushes into
 * fenced_code_verbatim mode. The language hint (everything after
 * the backticks to end of line) is captured in the token image
 * for the AST builder to extract.
 */
export const FencedCodeOpen = createToken({
  name: "FencedCodeOpen",
  pattern: /```[^\n]*/,
  push_mode: "fenced_code_verbatim",
});

/**
 * Example block open delimiter: 4+ equals signs on their own
 * line. Parent blocks stay in default mode (no push_mode)
 * because their content is parsed recursively using normal
 * grammar rules. The matching ExampleBlockClose token enforces
 * that the close delimiter has the same length as this open.
 *
 * Negative lookahead prevents matching when followed by a space
 * or more equals signs — those are section headings handled by
 * SectionMarker (`={2,6} text`). A bare `====` (no space, no
 * trailing text) is the example block open delimiter.
 */
export const ExampleBlockOpen = createToken({
  name: "ExampleBlockOpen",
  pattern: /={4,}(?![= ])/,
});

/**
 * Sidebar block open delimiter: 4+ asterisks on their own line.
 * No conflict with UnorderedListMarker (`*{1,5} `) because the
 * list marker requires a trailing space; a delimiter is just
 * `****` alone. The matching SidebarBlockClose token enforces
 * length matching. Parent block -- stays in default mode.
 */
export const SidebarBlockOpen = createToken({
  name: "SidebarBlockOpen",
  // Negative lookahead prevents matching when followed by a
  // space — `**** text` is an unordered list marker at depth 4,
  // not a sidebar delimiter. Also rejects more asterisks after
  // the 5th (though `*{4,}` already won't match `*{6+}`
  // because the list marker only goes to 5).
  pattern: /\*{4,}(?![ *])/,
});

/**
 * Open block delimiter: exactly 2 dashes on their own line.
 * Negative lookahead prevents matching 3+ dashes (those are
 * listing blocks via ListingBlockOpen `/-{4,}/`, or just
 * invalid syntax). Parent block — stays in default mode.
 */
export const OpenBlockDelimiter = createToken({
  name: "OpenBlockDelimiter",
  // Exactly 2 dashes, not followed by another dash or any
  // other character on the same line. AsciiDoc requires `--`
  // to appear on its own line as a block delimiter. Without
  // the negative lookahead, `-- text` would be consumed as
  // an open block delimiter + indented line instead of text.
  pattern: /--(?![^\n])/,
});

/**
 * Quote block open delimiter: 4+ underscores on their own line.
 * No conflict with existing tokens. The matching QuoteBlockClose
 * token enforces length matching. Parent block -- stays in
 * default mode.
 */
export const QuoteBlockOpen = createToken({
  name: "QuoteBlockOpen",
  pattern: /_{4,}(?![^\n])/,
});

// -- Parent block close tokens --
// Close tokens use makeClosePattern to enforce that the close
// delimiter is exactly the same length as the most recent open
// of the same type. Unlike leaf block close tokens, these stay
// in default_mode (parent blocks contain recursive AsciiDoc).
// No push_mode/pop_mode needed.

export const ExampleBlockClose = createToken({
  name: "ExampleBlockClose",
  pattern: makeParentClosePattern("=", "ExampleBlockOpen", "ExampleBlockClose"),
  line_breaks: false,
  start_chars_hint: ["="],
});

export const SidebarBlockClose = createToken({
  name: "SidebarBlockClose",
  pattern: makeParentClosePattern("*", "SidebarBlockOpen", "SidebarBlockClose"),
  line_breaks: false,
  start_chars_hint: ["*"],
});

export const QuoteBlockClose = createToken({
  name: "QuoteBlockClose",
  pattern: makeParentClosePattern("_", "QuoteBlockOpen", "QuoteBlockClose"),
  line_breaks: false,
  start_chars_hint: ["_"],
});

/**
 * Block comment delimiter: 4+ slashes on their own line.
 * When encountered in default mode, pushes into block_comment mode.
 * When encountered in block_comment mode, pops back to default.
 * Must precede LineComment (which also starts with //) and
 * InlineModeStart in priority order.
 */
export const BlockCommentDelimiter = createToken({
  name: "BlockCommentDelimiter",
  pattern: /\/{4,}/,
  push_mode: "block_comment",
});

/**
 * Closing delimiter inside `block_comment` mode — pops back
 * to default. Chevrotain requires separate push/pop token
 * instances even though the surface syntax is identical to
 * BlockCommentDelimiter.
 */
export const BlockCommentEnd = createToken({
  name: "BlockCommentEnd",
  pattern: /\/{4,}/,
  pop_mode: true,
});

/**
 * Line comment: `//` followed by a space (then optional text)
 * or end of line. `//path` (no space) is NOT a comment.
 * The negative lookahead `(?!\S)` rejects `//` followed by
 * a non-whitespace char.
 * Must precede InlineModeStart so the lexer prefers it.
 */
export const LineComment = createToken({
  name: "LineComment",
  pattern: /\/\/(?!\S)[^\n]*/,
});

// Thematic break: three or more single quotes on their own line.
// Must precede InlineModeStart so the lexer prefers it.
export const ThematicBreak = createToken({
  name: "ThematicBreak",
  pattern: /'{3,}/,
});

// Page break: three or more less-than signs on their own line.
// Must precede InlineModeStart so the lexer prefers it.
export const PageBreak = createToken({
  name: "PageBreak",
  pattern: /<{3,}/,
});

/**
 * Verbatim content inside a block comment. Captures everything
 * that is not the closing delimiter line. This token only exists
 * in the block_comment lexer mode.
 */
export const BlockCommentContent = createToken({
  name: "BlockCommentContent",
  pattern: /[^\n]+/,
});

/**
 * Closing delimiter for listing blocks inside listing_verbatim
 * mode. Pops back to default mode. Uses a custom pattern to
 * ensure the close delimiter length matches the open delimiter.
 */
export const ListingBlockClose = createToken({
  name: "ListingBlockClose",
  pattern: makeClosePattern("-", "ListingBlockOpen"),
  pop_mode: true,
  line_breaks: false,
  start_chars_hint: ["-"],
});

/**
 * Closing delimiter for literal blocks inside literal_verbatim
 * mode. Pops back to default mode. Uses a custom pattern to
 * ensure the close delimiter length matches the open delimiter.
 */
export const LiteralBlockClose = createToken({
  name: "LiteralBlockClose",
  pattern: makeClosePattern(".", "LiteralBlockOpen"),
  pop_mode: true,
  line_breaks: false,
  start_chars_hint: ["."],
});

/**
 * Closing delimiter for passthrough blocks inside pass_verbatim
 * mode. Pops back to default mode. Uses a custom pattern to
 * ensure the close delimiter length matches the open delimiter.
 */
export const PassBlockClose = createToken({
  name: "PassBlockClose",
  pattern: makeClosePattern("+", "PassBlockOpen"),
  pop_mode: true,
  line_breaks: false,
  start_chars_hint: ["+"],
});

// Fenced code block close: exactly three backticks on their own
// line. Unlike listing/literal/pass blocks, the close delimiter
// is always exactly 3 backticks (it doesn't need to match the
// open delimiter length, since the open is also always 3).
// The negative lookahead (?![^\n]) ensures the backticks are
// the entire line content (followed by newline or EOF).
export const FencedCodeClose = createToken({
  name: "FencedCodeClose",
  pattern: /```(?![^\n])/,
  pop_mode: true,
  line_breaks: false,
  start_chars_hint: ["`"],
});

/**
 * Verbatim content inside a delimited leaf block. Captures any
 * non-newline text that is not a closing delimiter. Shared across
 * all three verbatim modes (listing, literal, pass). Each mode
 * places its specific close token before this one in priority
 * order so the delimiter is matched first.
 */
export const VerbatimContent = createToken({
  name: "VerbatimContent",
  pattern: /[^\n]+/,
});

/**
 * Attribute entry: `:name: value` metadata declaration.
 * Matches `:name:`, `:name: value`, `:!name:`, and `:name!:`.
 * Must precede InlineModeStart so attribute lines aren't consumed as
 * plain text. The regex captures the full line from the opening `:`
 * through the optional value. The `!` for unset can appear before
 * or after the name.
 *
 * The value separator uses `[ \t]` (space/tab) instead of `\s` to
 * prevent the regex from crossing a newline boundary into the next
 * line — important for no-value entries like `:toc:` followed by
 * another attribute entry on the next line.
 *
 * No `^` anchor needed: Chevrotain matches at the current position
 * in the remaining input, which is always line-start after a Newline
 * token. Token priority (before InlineModeStart) ensures attribute lines
 * are recognized first.
 */
export const AttributeEntry = createToken({
  name: "AttributeEntry",
  pattern: /:[!]?[A-Za-z_][\w-]*[!]?:(?:[ \t][^\n]*)?/,
});

/**
 * Block attribute list: `[source,ruby]`, `[#myid]`, `[.role]`,
 * `[start=7]`, etc. on its own line. Single square brackets.
 * Must precede InlineModeStart so attribute lists aren't consumed
 * as plain text.
 *
 * The negative lookahead `(?!\[)` after the opening bracket
 * avoids consuming `[[anchor]]` as an attribute list. The
 * trailing `(?![^\n])` ensures the closing `]` is at end of
 * line — this prevents matching checklist markers (`[x]`,
 * `[ ]`) and other bracketed content that appears mid-line
 * inside list items or paragraphs.
 */
export const BlockAttributeList = createToken({
  name: "BlockAttributeList",
  pattern: /\[(?!\[)[^\]\n]*\](?![^\n])/,
});

/**
 * Block title: `.Title text` — a dot followed by a non-space,
 * non-dot character, then the rest of the line. Must not conflict
 * with LiteralBlockOpen (`....`), which uses 4+ dots, or
 * OrderedListMarker (`. text`), which has a space after the dot.
 * The negative lookahead `(?![. ])` rejects dots and spaces
 * after the initial dot.
 */
export const BlockTitle = createToken({
  name: "BlockTitle",
  pattern: /\.(?![. ])\S[^\n]*/,
});

/**
 * Admonition paragraph marker: `NOTE: `, `TIP: `, `IMPORTANT: `,
 * `CAUTION: `, or `WARNING: ` at the start of a line. AsciiDoc's
 * five admonition types can be written as a label prefix on a
 * paragraph. The marker is consumed separately so the grammar can
 * distinguish admonition paragraphs from regular paragraphs.
 * Must precede InlineModeStart so the lexer prefers it.
 */

/**
 * Conditional preprocessor directive on its own line.
 * Matches `ifdef::attr[]`, `ifndef::attr[]`,
 * `ifeval::[expr]`, and `endif::[]`. Must precede both
 * IncludeDirective and BlockMacro so these specific
 * keywords are not consumed as generic macros.
 */
export const ConditionalDirective = createToken({
  name: "ConditionalDirective",
  pattern: /(?:ifdef|ifndef|ifeval|endif)::[^[\n]*\[[^\]\n]*\](?![^\n])/,
});

/**
 * Include directive: `include::path[opts]` on its own line.
 * A preprocessor directive that inserts content from another
 * file. Must precede BlockMacro in token priority so
 * `include::` is not consumed as a generic block macro.
 */
export const IncludeDirective = createToken({
  name: "IncludeDirective",
  pattern: /include::[^[\n]*\[[^\]\n]*\](?![^\n])/,
});

/**
 * Block macro: `name::target[attrlist]` on its own line.
 * Covers image::, video::, audio::, toc::, and any other
 * block macro. The name is one or more word characters,
 * the target is everything between `::` and `[`, and the
 * attrlist is everything inside `[…]`. Must precede
 * InlineModeStart so the lexer doesn't treat the line as
 * paragraph text.
 */
export const BlockMacro = createToken({
  name: "BlockMacro",
  pattern: /[a-zA-Z]\w*::[^[\n]*\[[^\]\n]*\](?![^\n])/,
});

export const AdmonitionMarker = createToken({
  name: "AdmonitionMarker",
  pattern: /(?:NOTE|TIP|IMPORTANT|CAUTION|WARNING): /,
});

/**
 * Unordered list item marker: 1–5 `*` characters followed by a space,
 * or a single `-` followed by a space. AsciiDoc uses repeated `*` for
 * nested list levels (`*`, `**`, `***`, etc.) and allows `-` as an
 * alternative level-1 marker. The marker is consumed separately from
 * the item text so the AST builder can determine nesting depth from
 * the marker length. The formatter normalizes `-` to `*`.
 * Must precede InlineModeStart so the lexer prefers it for list lines.
 */
export const UnorderedListMarker = createToken({
  name: "UnorderedListMarker",
  pattern: /(?:\*{1,5}|-) /,
});

/**
 * Ordered list item marker: 1–5 `.` characters followed by a
 * space. AsciiDoc uses repeated dots for nested ordered list
 * levels (`.`, `..`, `...`, etc.). The marker is consumed
 * separately from the item text so the AST builder can
 * determine nesting depth from the marker length.
 * Must precede InlineModeStart so the lexer prefers it.
 *
 * The trailing space distinguishes list markers (`. Item`) from
 * block titles (`.Title`), which have no space after the dot.
 * Block titles will be added in a later task.
 */
export const OrderedListMarker = createToken({
  name: "OrderedListMarker",
  pattern: /\.{1,5} /,
});

/**
 * Callout list item marker: `<N> ` where N is a positive
 * integer, or `<.> ` for auto-numbering. The angle brackets
 * and trailing space distinguish callout markers from other
 * AsciiDoc constructs. Must precede InlineModeStart so the lexer
 * prefers it for callout list lines.
 */
export const CalloutListMarker = createToken({
  name: "CalloutListMarker",
  pattern: /<(?:\d+|\.)> /,
});

/**
 * An indented line: one or more leading spaces followed by
 * non-whitespace content. Indented lines form literal
 * paragraphs (monospace, preserved formatting). Must appear
 * before InlineModeStart so the leading spaces are not consumed
 * by the catch-all.
 */
export const IndentedLine = createToken({
  name: "IndentedLine",
  pattern: / +\S[^\n]*/,
});

// ── Inline lexer mode tokens ────────────────────────────────
//
// When no block-level token matches in default_mode,
// InlineModeStart fires (zero-length match) and pushes the
// lexer into inline mode. There, formatting marks, attribute
// references, and runs of plain text are tokenized until a
// newline pops back to default_mode.

/**
 * Zero-length custom pattern that pushes the lexer into inline
 * mode. Placed last in default_mode so all block-level tokens
 * get priority. The custom pattern function (not a RegExp)
 * bypasses Chevrotain's empty-match validation. Only fires when
 * a non-newline character exists at the current offset.
 */
export const InlineModeStart = createToken({
  name: "InlineModeStart",
  pattern: {
    exec: (text: string, offset: number): CustomPatternMatcherReturn | null => {
      // eslint-disable-next-line unicorn/no-null -- Chevrotain requires null
      if (offset >= text.length || text[offset] === "\n") return null;
      // Reject whitespace-only lines — scan forward to the next
      // newline (or EOF) and require at least one non-whitespace
      // character. This prevents whitespace-only paragraphs from
      // ever being created, eliminating the need for printer-side
      // filtering.
      let scan = offset;
      while (scan < text.length && text[scan] !== "\n") {
        if (text[scan] !== " " && text[scan] !== "\t") {
          return [""] as CustomPatternMatcherReturn;
        }
        scan += NEXT;
      }
      // Reached newline or EOF with only whitespace — reject.
      // eslint-disable-next-line unicorn/no-null -- Chevrotain requires null
      return null;
    },
  },
  push_mode: "inline",
  line_breaks: false,
});

/**
 * Newline inside inline mode — pops back to default_mode
 * so the next line gets block-level token checks.
 *
 * Not to be confused with `Newline`, which fires in
 * default mode (between block elements) and stays in
 * default mode. Both match `\n` but serve different
 * lexer-mode transitions.
 */
export const InlineNewline = createToken({
  name: "InlineNewline",
  pattern: /\n/,
  pop_mode: true,
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

// ── Inline link / xref / anchor tokens ──────────────────────
// Must appear before InlineText in the inline mode array.

/** Inline URL: `https://url` or `https://url[text]`. */
export const InlineUrl = createToken({
  name: "InlineUrl",
  pattern: /https?:\/\/[^\s[\]]+(?:\[[^\]]*\])?/,
  start_chars_hint: ["h"],
});
/** Link macro: `link:target[text]`. */
export const LinkMacro = createToken({
  name: "LinkMacro",
  pattern: /link:[^\s[]+\[[^\]]*\]/,
  start_chars_hint: ["l"],
});
/** Mailto link: `mailto:addr[text]`. */
export const MailtoLink = createToken({
  name: "MailtoLink",
  pattern: /mailto:[^\s[]+\[[^\]]*\]/,
  start_chars_hint: ["m"],
});
/** Xref macro: `xref:target[text]`. */
export const XrefMacro = createToken({
  name: "XrefMacro",
  pattern: /xref:[^\s[]+\[[^\]]*\]/,
  start_chars_hint: ["x"],
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
 * Multi-mode lexer definition. The default mode handles normal
 * AsciiDoc content; block_comment mode captures verbatim content
 * between //// delimiters.
 *
 * Token order within each mode determines match priority
 * (first match wins for same-length matches).
 */
const multiModeDefinition = {
  modes: {
    default_mode: [
      BlankLine,
      Newline,
      SectionMarker,
      DocumentTitle,
      // Delimited block openers before BlockCommentDelimiter and
      // LineComment because `----` must not be consumed as text.
      // LiteralBlockOpen uses a negative lookahead to avoid
      // consuming `.... text` as a block (that's an ordered
      // list marker at depth 4).
      ListingBlockOpen,
      LiteralBlockOpen,
      PassBlockOpen,
      FencedCodeOpen,
      // Parent block close tokens BEFORE their corresponding
      // open tokens. When a delimiter line appears, the close
      // token's custom matcher checks length against the most
      // recent open. If it rejects (wrong length), the line
      // falls through to the open token — creating a nested
      // block, which is correct AsciiDoc nesting behavior.
      ExampleBlockClose,
      ExampleBlockOpen,
      SidebarBlockClose,
      SidebarBlockOpen,
      OpenBlockDelimiter,
      QuoteBlockClose,
      QuoteBlockOpen,
      BlockCommentDelimiter,
      LineComment,
      ThematicBreak,
      PageBreak,
      AttributeEntry,
      BlockAttributeList,
      BlockTitle,
      ConditionalDirective,
      IncludeDirective,
      BlockMacro,
      AdmonitionMarker,
      UnorderedListMarker,
      OrderedListMarker,
      CalloutListMarker,
      IndentedLine,
      InlineModeStart,
    ],
    inline: [
      BackslashEscape,
      AttributeReference,
      RoleAttribute,
      // Link/xref/anchor tokens before formatting marks.
      InlineUrl,
      LinkMacro,
      MailtoLink,
      XrefMacro,
      XrefShorthand,
      InlineAnchor,
      // Inline macro tokens before formatting marks.
      InlineImage,
      KbdMacro,
      ButtonMacro,
      MenuMacro,
      FootnoteReferenceMacro,
      FootnoteMacro, // ref before base (longer prefix)
      PassMacro,
      BoldMark,
      ItalicMark,
      MonoMark,
      HighlightMark,
      HardLineBreak, // before InlineNewline (` +\n` before `\n`)
      InlineNewline,
      InlineText,
      InlineChar, // single-char fallback, must be last
    ],
    block_comment: [
      // BlankLine before Newline (same reason as default mode).
      BlankLine,
      Newline,
      BlockCommentEnd,
      BlockCommentContent,
    ],
    // Each verbatim mode has its specific close token before the
    // shared VerbatimContent so the delimiter is matched first.
    listing_verbatim: [BlankLine, Newline, ListingBlockClose, VerbatimContent],
    literal_verbatim: [BlankLine, Newline, LiteralBlockClose, VerbatimContent],
    pass_verbatim: [BlankLine, Newline, PassBlockClose, VerbatimContent],
    fenced_code_verbatim: [
      BlankLine,
      Newline,
      FencedCodeClose,
      VerbatimContent,
    ],
  },
  defaultMode: "default_mode",
};

/**
 * Token array for the parser — includes all tokens from both modes.
 * The parser needs to know about every token type even though
 * the lexer only produces them in the appropriate mode.
 */
export const allTokens = [
  BlankLine,
  Newline,
  SectionMarker,
  DocumentTitle,
  ListingBlockOpen,
  ListingBlockClose,
  LiteralBlockOpen,
  LiteralBlockClose,
  PassBlockOpen,
  PassBlockClose,
  FencedCodeOpen,
  FencedCodeClose,
  ExampleBlockClose,
  ExampleBlockOpen,
  SidebarBlockClose,
  SidebarBlockOpen,
  OpenBlockDelimiter,
  QuoteBlockClose,
  QuoteBlockOpen,
  BlockCommentDelimiter,
  BlockCommentEnd,
  LineComment,
  ThematicBreak,
  PageBreak,
  BlockCommentContent,
  VerbatimContent,
  AttributeEntry,
  BlockAttributeList,
  BlockTitle,
  ConditionalDirective,
  IncludeDirective,
  BlockMacro,
  AdmonitionMarker,
  UnorderedListMarker,
  OrderedListMarker,
  CalloutListMarker,
  IndentedLine,
  InlineModeStart,
  HardLineBreak,
  InlineNewline,
  BackslashEscape,
  AttributeReference,
  RoleAttribute,
  InlineUrl,
  LinkMacro,
  MailtoLink,
  XrefMacro,
  XrefShorthand,
  InlineAnchor,
  InlineImage,
  KbdMacro,
  ButtonMacro,
  MenuMacro,
  FootnoteReferenceMacro,
  FootnoteMacro,
  PassMacro,
  BoldMark,
  ItalicMark,
  MonoMark,
  HighlightMark,
  InlineText,
  InlineChar,
];

/** Reusable lexer instance — stateless, safe to share. */
export const asciidocLexer = new Lexer(multiModeDefinition);
