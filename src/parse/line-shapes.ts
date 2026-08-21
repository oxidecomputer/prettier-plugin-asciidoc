/**
 * The single source of truth for which LINE SHAPES matter inside a
 * paragraph. Asciidoctor's paragraphs are greedy: once open, a
 * paragraph swallows every following line until a blank line or one
 * of a tiny interrupting set. Everything else — list markers, block
 * titles, admonition labels, even section markers — is plain text
 * mid-paragraph. Our lexer historically inverted that (every line was
 * re-classified as if at document top), which is the root of gap
 * issues #26, #27, #29.
 *
 * Both the lexer's paragraph mode (src/parse/paragraph-tokens.ts)
 * and reflow safety (src/reflow.ts) consume these patterns, so they
 * can never drift apart. tests/conformance/interruption.test.ts pins
 * every pattern here against the Asciidoctor oracle — change a row
 * there before changing a pattern here.
 *
 * ## Where these rules come from
 *
 * The oracle (`@asciidoctor/core` 3.0.4) is Asciidoctor Ruby 2.0.20
 * transpiled by Opal, so the Ruby source IS the spec it executes.
 * Every row below names the Ruby constant or method it mirrors —
 * `lib/asciidoctor/parser.rb` (`read_paragraph_lines`,
 * `read_lines_for_list_item`, `parse_list_item`, `is_delimited_block?`,
 * `is_sibling_list_item?`, `StartOfBlockProc`) and
 * `lib/asciidoctor/rx.rb` (`BlockAttributeLineRx`, `BlockAnchorRx`,
 * `CommentLineRx`, `AnyListRx`, `DescriptionListRx`). The oracle is
 * still the arbiter: where a probe disagrees with a reading of the
 * Ruby, the probe wins and the row is marked.
 */

import { EMPTY } from "../constants.js";

/**
 * Which kind of paragraph is open. Each value names the Ruby path
 * that reads those lines:
 *
 * - `paragraph` — `read_paragraph_lines` with a falsey `break_at_list`,
 *   i.e. `StartOfBlockProc`: only a delimited block or a block
 *   attribute line (which includes `[[anchor]]`) ends it.
 * - `listItem` — the lines `read_lines_for_list_item` collects for a
 *   ulist/olist/colist item. It additionally stops at a sibling or
 *   nested marker (`AnyListRx`, `is_sibling_list_item?`) and at a
 *   description-list term.
 * - `listContinuation` — a paragraph a `+` attached to a list item.
 *   It is NOT a blend of the other two: `parse_list_item` parses it
 *   with `read_paragraph_lines` and NO `break_at_list`, so it takes
 *   the plain-paragraph set; the only markers that end it are the
 *   ones `read_lines_for_list_item` already stopped at, i.e. the
 *   OPEN list's own marker style (`is_sibling_list_item?`), which
 *   the caller supplies as `enclosingListStyles`.
 * - `dlistItem` — the description of a `term:: desc` item. Widest
 *   set: `parse_list_item` parses the lines after the term with
 *   `text_only: nil` — a full `next_block` — and then `fold_first`
 *   merges the result back into the item text ONLY when it is a
 *   plain paragraph. So every shape `next_block` turns into a
 *   non-paragraph block (admonition, block macro, break, anchor)
 *   ends the description, while block metadata that a paragraph
 *   absorbs (a block title, an attribute entry) does not.
 */
export type ParagraphContext =
  | "paragraph"
  | "listItem"
  | "listContinuation"
  | "dlistItem";

/**
 * Trim trailing whitespace, the way Asciidoctor's reader does to
 * EVERY line before the parser sees it
 * (`Helpers.prepare_source_string` / `prepare_source_array`, called
 * with `trim_end`). Every `$`-anchored pattern in this file is
 * therefore matched against the rstripped line: `----␠␠` is a
 * delimiter and `+␠` is a list continuation
 * (src/parse/continuation-markers.ts models the same rule).
 * @param line - one source line, without its trailing newline
 * @returns the line without trailing spaces or tabs
 */
function rstrip(line: string): string {
  return line.trimEnd();
}

/**
 * Pattern source for a block anchor line, shared with the lexer's
 * `BlockAnchor` token so the two can never drift (the token wraps it
 * in Chevrotain's flagless dialect, the registry in a `v`-flag
 * regex). Mirrors `BlockAnchorRx`
 * (`/^\[\[(?:|([\p{Alpha}_:][\w\-:.]*)(?:, *(.+))?)\]\]$/`), empty
 * `[[]]` form included; the capture groups are dropped because
 * nothing here reads them.
 */
export const BLOCK_ANCHOR_SOURCE = String.raw`\[\[(?:|[A-Za-z_:][\w\-:.]*(?:, *[^\n]+)?)\]\]`;

/**
 * Pattern source for a line comment, shared with the lexer's
 * `LineComment` token. Mirrors `CommentLineRx` (`%r(^//(?=[^/]|$))`):
 * `//path` IS a comment, `///text` is ordinary text, and `////` is a
 * comment BLOCK delimiter claimed by an earlier token.
 */
export const LINE_COMMENT_SOURCE = "//(?!/)";

/**
 * Pattern source for a block attribute list line (`[source,ruby]`,
 * `[.role]`, `[]`), shared with the lexer's `BlockAttributeList`
 * token. Mirrors `BlockAttributeLineRx`
 * (`/^\[(?:|[\w.#%{,"']CC_ANY*|\[…\])\]$/`) minus its third
 * alternative, the `[[anchor]]` form, which is
 * {@link BLOCK_ANCHOR_SOURCE} (the two are kept apart because the
 * list-item context treats them differently).
 *
 * Two details are easy to get wrong and both are load-bearing: the
 * FIRST character inside the brackets must come from Ruby's narrow
 * class, so `[+1]` and `[*bold*]` are ordinary text; and `CC_ANY`
 * matches `]`, so `[a]b]` IS an attribute line. The oracle confirms
 * both (see the rows in tests/conformance/interruption.test.ts).
 */
export const BLOCK_ATTRIBUTE_LINE_SOURCE = String.raw`\[(?:|[\w.#%\{,"'][^\n]*)\]`;

/**
 * Pattern sources for the delimiter of each delimited block, one per
 * `DELIMITED_BLOCKS` key. Shared with the lexer's open-delimiter
 * tokens in src/parse/tokens.ts, which append their own end-of-line
 * anchor (`[ \t]*(?![^\n])`) to the same string.
 *
 * Mirrors `is_delimited_block?`: the line must be the delimiter and
 * NOTHING else — a uniform run of the tip character, at least as long
 * as the tip. `----:: x` is therefore a description-list term, not a
 * listing block. The one exception is the Markdown fence, where the
 * 4th character may not be a backtick but anything after ``` is a
 * language hint.
 */
export const DELIMITER_SOURCES = {
  listing: String.raw`-{4,}`,
  literal: String.raw`\.{4,}`,
  pass: String.raw`\+{4,}`,
  example: String.raw`={4,}`,
  sidebar: String.raw`\*{4,}`,
  quote: String.raw`_{4,}`,
  commentBlock: String.raw`/{4,}`,
  openBlock: String.raw`--`,
  // Written as a quoted string rather than String.raw because the
  // pattern contains backticks, which no template literal can carry.
  fencedCode: "```(?!`)[^\\n]*",
} as const;

// A block anchor (`[[id]]`) alone on a line ends a plain paragraph:
// `StartOfBlockProc` tests `BlockAttributeLineRx`, whose third
// alternative is exactly this shape, so the anchor is block METADATA
// and the text after it starts a fresh block (`<div id="...">`).
//
// DIRECTLY after a list item's text it is metadata too — but for a
// block that never materializes, so the oracle DISCARDS it:
// `* item` / `[[a]]` / `para` renders as `<p>item para</p>` with no
// anchor at all. That is why it is absent from
// LIST_ITEM_INTERRUPTERS and why isRawParagraphLine keeps it verbatim
// there instead (reflowing it into the text would emit an `<a id>`
// the oracle does not have). One line further down the fold has
// already happened and the anchor keeps its id, so it interrupts —
// see LATER_LINE_INTERRUPTERS.
const BLOCK_ANCHOR = new RegExp(`^${BLOCK_ANCHOR_SOURCE}$`, "v");

// A block attribute list alone on a line: `StartOfBlockProc` tests
// BlockAttributeLineRx, of which this is every alternative but the
// anchor one. See BLOCK_ATTRIBUTE_LINE_SOURCE.
const BLOCK_ATTRIBUTE_LINE = new RegExp(
  `^${BLOCK_ATTRIBUTE_LINE_SOURCE}$`,
  "v",
);

// A block title (`.Title`). Mirrors `BlockTitleRx`
// (`/^\.(\.?[^ \t.]CC_ANY*)$/`): one dot, an optional second, then a
// character that is neither space nor dot — which is what keeps
// `. item` (an ordered list marker) and `....` (a literal delimiter)
// out.
const BLOCK_TITLE = /^\.\.?[^ \t.][^\n]*$/v;

// An attribute entry (`:name: value`, `:name!:`). Mirrors
// `AttributeEntryRx` (`/^:(!?CG_WORD[^:]*):(?:[ \t]+(CC_ANY*))?$/`),
// with Ruby's unicode word class approximated by `\w` the same way
// BLOCK_ANCHOR_SOURCE approximates its id class.
const ATTRIBUTE_ENTRY = /^:!?\w[^:]*:(?:[ \t]+[^\n]*)?$/v;

// Lines Asciidoctor reads as METADATA for the block that follows
// rather than as content of their own. `read_lines_for_list_item`
// lets all of them play out between a `+` continuation marker and
// the block it attaches, so the paragraph classifier has to look
// past them to find the `+` (see isBlockMetadataLine).
const BLOCK_METADATA_LINES: readonly RegExp[] = [
  BLOCK_TITLE,
  BLOCK_ATTRIBUTE_LINE,
  BLOCK_ANCHOR,
  ATTRIBUTE_ENTRY,
];

/**
 * Delimiter lines, one pattern per {@link DELIMITER_SOURCES} entry
 * (and so per `DELIMITED_BLOCKS` key), anchored to a whole rstripped
 * line.
 */
export const DELIMITED_BLOCK_LINES: readonly RegExp[] = Object.values(
  DELIMITER_SOURCES,
).map((source) => new RegExp(`^${source}$`, "v"));

/**
 * Whether a line is a delimited-block delimiter.
 * @param line - one source line, without its trailing newline
 * @returns true for `----`, `--`, ` ``` `, and the rest of
 *   `DELIMITED_BLOCKS`
 */
export function isDelimiterLine(line: string): boolean {
  return DELIMITED_BLOCK_LINES.some((pattern) => pattern.test(rstrip(line)));
}

// Lines that end a paragraph in EVERY context: `StartOfBlockProc` =
// `(BlockAttributeLineRx.match? l) || (is_delimited_block? l)`, plus
// the lone `+`, which `read_lines_until` breaks on separately
// (`break_on_list_continuation`).
const SHARED_INTERRUPTERS: readonly RegExp[] = [
  ...DELIMITED_BLOCK_LINES,
  BLOCK_ATTRIBUTE_LINE,
  // A standalone `+` ends a paragraph in EVERY context, a list
  // nowhere in sight included: `read_lines_until` is called with
  // `break_on_list_continuation: true` from `read_paragraph_lines`
  // regardless of nesting. The oracle splits `first line` / `+` /
  // `last line` into two `<p>` elements, the `+` becoming text of
  // the second (it is not consumed).
  /^\+$/v,
];

/**
 * Lines that end a plain paragraph. Also the base set for a
 * `listContinuation` paragraph, which adds the open list's markers.
 */
export const PARAGRAPH_INTERRUPTERS: readonly RegExp[] = [
  ...SHARED_INTERRUPTERS,
  BLOCK_ANCHOR,
];

// Sibling and nested item markers. Mirrors `ListRxMap`'s
// `UnorderedListRx` / `OrderedListRx` / `CalloutListRx` (as gathered
// by `AnyListRx`), minus their leading-whitespace allowance, which
// the indented-line rules handle instead.
const LIST_MARKERS: readonly RegExp[] = [
  /^(?:\*{1,5}|-) /v, // unordered
  /^\.{1,5} /v, // ordered
  /^<(?:\d+|\.)> /v, // callout
];

/**
 * Lines that end a LIST ITEM's text: everything that ends a plain
 * paragraph (except a block anchor — see BLOCK_ANCHOR above) plus
 * sibling/nested item markers, which is `read_lines_for_list_item`
 * breaking at `is_sibling_list_item?` and buffering an `AnyListRx`
 * match as a nested list. (Confirmed by the oracle rows in
 * interruption.test.ts; if the oracle disagrees with an entry, the
 * oracle wins — fix the list.)
 */
export const LIST_ITEM_INTERRUPTERS: readonly RegExp[] = [
  ...SHARED_INTERRUPTERS,
  ...LIST_MARKERS,
];

// Shapes that end a dlist description ONLY on the first line after
// the term. `parse_list_item` hands those lines to `next_block`,
// which reads `this_line` — the block's first line — to pick a block
// context: an admonition label, a block macro, a break. Once it has
// settled on "normal paragraph" the rest of the lines go through
// `read_paragraph_lines`, whose break condition no longer knows any
// of them. The oracle agrees in both positions: `term1:: desc` /
// `NOTE: x` splits, `term1:: desc` / `more` / `NOTE: x` does not.
const DLIST_FIRST_LINE_INTERRUPTERS: readonly RegExp[] = [
  /^(?:NOTE|TIP|IMPORTANT|CAUTION|WARNING): /v, // AdmonitionParagraphRx
  /^[A-Za-z]\w*::[^\[]*\[[^\]]*\]$/v, // BlockMacroRx / CustomBlockMacroRx
  /^'{3,}$/v, // LayoutBreakRx: thematic break
  /^<{3,}$/v, // LayoutBreakRx: page break
];

/**
 * Lines that end a DESCRIPTION LIST item's description from ANY
 * position: the list-item set plus the block anchor, which survives
 * into `read_paragraph_lines` because `StartOfBlockProc` tests
 * `BlockAttributeLineRx` and the anchor is one of its alternatives.
 * (Oracle: `term1:: desc` / `more` / `[[a]]` / `last` puts `last` in
 * its own anchored block.)
 */
const DLIST_ITEM_ANY_LINE_INTERRUPTERS: readonly RegExp[] = [
  ...LIST_ITEM_INTERRUPTERS,
  BLOCK_ANCHOR,
];

/**
 * Every line shape that ends a DESCRIPTION LIST item's description
 * somewhere — the union of the two sets above, and so the widest in
 * the registry. Position-blind on purpose: its one consumer is
 * {@link interruptsByLineShape}, which asks about a WORD reflow might
 * move and cannot know where the line will end up.
 */
export const DLIST_ITEM_INTERRUPTERS: readonly RegExp[] = [
  ...DLIST_ITEM_ANY_LINE_INTERRUPTERS,
  ...DLIST_FIRST_LINE_INTERRUPTERS,
];

// A list marker's STYLE — `is_sibling_list_item?` compares the
// `resolve_list_marker` result, not the raw line, so `<2>` continues
// a `<1>` list (its style is spelled `<>` here) while `-` and `*` are
// different styles of unordered list.
const MARKER_STYLES: readonly RegExp[] = [
  /^(?<style>\*{1,5}|-)(?= )/v, // unordered: `*`…`*****`, `-`
  /^(?<style>\.{1,5})(?= )/v, // ordered: `.`…`.....`
  /^<(?:\d+|\.)>(?= )/v, // callout: style is always `<>`
];

/** The style key every callout marker shares — see MARKER_STYLES. */
const CALLOUT_STYLE = "<>";

/**
 * The marker style of a line (or of a bare marker token image) that
 * begins a list item.
 *
 * Exists because "is this line a list marker" is not the question a
 * `+`-attached continuation paragraph asks: `read_lines_for_list_item`
 * ends the item only at `is_sibling_list_item?`, which matches the
 * marker of the list that is already open (`* next` closes it inside
 * a `*` list, but is plain text inside a `.` list). Callers pass the
 * styles of the enclosing list ancestry to
 * {@link interruptsParagraph}; this function is how both they and the
 * registry spell them.
 * @param line - one source line without its newline, or a list
 *   marker token image such as `"** "`
 * @returns the style key (`"*"`, `"**"`, `"-"`, `"."`, `"<>"`, …),
 *   or undefined when the line does not begin with a list marker
 */
export function listMarkerStyle(line: string): string | undefined {
  for (const pattern of MARKER_STYLES) {
    const match = pattern.exec(line);
    if (match !== null) {
      return match.groups?.style ?? CALLOUT_STYLE;
    }
  }
  return undefined;
}

/**
 * Lines that are neither text nor interrupting: Asciidoctor drops
 * comment lines (`read_lines_until`'s `skip_line_comments`) and
 * consumes preprocessor directives in `PreprocessorReader` while
 * READING, before block structure exists. The paragraph continues
 * around them, so the formatter must preserve them verbatim on their
 * own line (never reflow them into the text, where they would become
 * visible).
 */
// A conditional preprocessor directive. Unlike the other raw shapes
// this one never reaches the parser AT ALL: `PreprocessorReader`
// consumes the directive (and any region it skips) while reading, so
// no line is handed on. A comment line, by contrast, IS handed on —
// `read_lines_for_list_item` reads it like any other content — and an
// unresolved include leaves a sentence behind. See
// isPreprocessorConditional.
//
// `v`-flag character classes require `[` escaped even when negated
// (bare `[` inside a class starts a nested set operation under `v`).
const CONDITIONAL_DIRECTIVE =
  /^(?:ifdef|ifndef|ifeval|endif)::[^\[]*\[[^\]]*\]$/v;

export const PARAGRAPH_RAW_LINES: readonly RegExp[] = [
  new RegExp(`^${LINE_COMMENT_SOURCE}`, "v"),
  CONDITIONAL_DIRECTIVE,
  // ORACLE SURPRISE (does not change the classification, only what
  // "raw" means here): an include whose target cannot be resolved is
  // still consumed as a directive while reading -- it never becomes
  // list/paragraph text -- but Asciidoctor's fallback behavior
  // substitutes a literal "Unresolved directive in <file> - <line>"
  // sentence into the surrounding paragraph, so the directive's exact
  // text (not the concept of a raw line) leaks into rendered output
  // for this one failure mode. tests/conformance/interruption.test.ts
  // skips the content-leak assertion for this row for that reason.
  /^include::[^\[]*\[[^\]]*\]$/v,
];

// Contexts where a whole-line block anchor DIRECTLY after the block
// start is kept VERBATIM rather than reflowed into the text. There
// the anchor is `BlockAttributeLineRx` metadata for the item's first
// block, which `fold_first` merges into the item text — so the oracle
// emits no id at all, and reflowing the anchor into the text would
// instead emit an `<a id>` it does not have. A line further down is a
// different case entirely: it opens a SECOND block and keeps its id,
// which is why LATER_LINE_INTERRUPTERS makes it interrupt instead.
// (In `dlistItem` the interrupter check runs first, so the anchor
// ends the description there and never reaches this rule — it is
// listed for the case where that ordering ever changes.)
const RAW_BLOCK_ANCHOR_CONTEXTS = new Set<ParagraphContext>([
  "listItem",
  "dlistItem",
]);

/**
 * A whitespace-delimited word that ends with a description-list term
 * separator. Mirrors `DescriptionListRx`
 * (`^(?!//[^/])[ \t]*([^ \t].*?)(:::{0,2}|;;)(?:$|[ \t]+(.*)$)`) — the
 * term may contain spaces, but the separator must end a word, so ANY
 * such word on the FIRST line of a block turns the block into a
 * dlist. Mid-paragraph it is text. Reflow must therefore never move
 * such a word from a later source line onto the first output line
 * (src/reflow.ts).
 *
 * `\S*`, not `\S+`: Ruby's term group is `([^ \t].*?)` over the whole
 * LINE, not over the word, so the separator may stand alone once
 * something precedes it — `foo :: bar` is a dlist whose term is
 * `foo ` (oracle: `<dt>foo </dt>`). The only line the wider pattern
 * over-reports is one whose FIRST word is a bare separator, which
 * Ruby's `[^ \t]` rejects; guarding a word there costs a join that
 * was safe and changes no rendering.
 */
export const DLIST_SEPARATOR_WORD = /^\S*(?:::|:::|::::|;;)$/v;

// A whole line Asciidoctor reads as a description-list item. Mirrors
// `DescriptionListRx` directly rather than asking
// DLIST_SEPARATOR_WORD about each word, because the two questions
// differ at the edges: the term group is `([^ \t].*?)`, anchored to
// the LINE, so a separator standing alone as the line's FIRST word
// (`;;`) is ordinary text, while a term of several words
// (`a multi word term::`) is a dlist. A leading `//` comment is
// excluded the same way Ruby excludes it.
const DESCRIPTION_LIST_LINE =
  /^(?!\/\/[^\/])[ \t]*[^ \t][^\n]*?(?:::|:::|::::|;;)(?:$|[ \t]+[^\n]*)$/v;

/**
 * Whether Asciidoctor would read a line as a description-list item —
 * which it does whenever the line is the FIRST of a block, and (via
 * `AnyListRx`) whenever it follows a list item's text. The lexer
 * needs this to classify what comes after: a dlist item's
 * description is read as block content, not as paragraph text.
 * @param rawLine - one source line, without its trailing newline;
 *   trailing whitespace is trimmed here (see rstrip)
 * @returns true when the line is a `term:: definition` item
 */
export function isDescriptionListLine(rawLine: string): boolean {
  return DESCRIPTION_LIST_LINE.test(rstrip(rawLine));
}

/**
 * Whether a line is a conditional preprocessor directive, the one
 * raw shape `PreprocessorReader` removes from the line stream
 * entirely (see CONDITIONAL_DIRECTIVE). Callers that replay
 * Asciidoctor's line-by-line state have to skip these without
 * advancing it.
 * @param rawLine - one source line, without its trailing newline;
 *   trailing whitespace is trimmed here (see rstrip)
 * @returns true for `ifdef::`, `ifndef::`, `ifeval::` and `endif::`
 */
export function isPreprocessorConditional(rawLine: string): boolean {
  return CONDITIONAL_DIRECTIVE.test(rstrip(rawLine));
}

/**
 * Whether a line is block METADATA — a block title, a block
 * attribute list, a block anchor or an attribute entry — rather than
 * content. See BLOCK_METADATA_LINES for the Ruby each shape mirrors.
 *
 * Exists for the `+`-continuation walk-back in
 * src/parse/paragraph-tokens.ts: Asciidoctor lets any run of these
 * lines sit between a continuation marker and the block it attaches,
 * so "is the paragraph above me a `+`" has to be asked past them.
 * @param rawLine - one source line, without its trailing newline;
 *   trailing whitespace is trimmed here (see rstrip)
 * @returns true when the line annotates the block that follows
 */
export function isBlockMetadataLine(rawLine: string): boolean {
  const line = rstrip(rawLine);
  return BLOCK_METADATA_LINES.some((pattern) => pattern.test(line));
}

/**
 * Whether a line keeps a list open ACROSS a blank line.
 *
 * `read_lines_for_list_item`, after a blank line, continues the item
 * only for a `+` (a detached continuation), a nested list marker, or
 * a literal (indented) paragraph; on anything else it breaks and the
 * list ends. "Nested list marker" is `NESTABLE_LIST_CONTEXTS` /
 * `AnyListRx`, which includes `DescriptionListRx` — hence the
 * dlist-term test alongside the marker one. The lexer uses this to
 * decide whether a `+` further down is still inside a list.
 * @param line - the first line after the blank one
 * @returns true when the list survives the blank line
 */
export function keepsListOpenAfterBlankLine(line: string): boolean {
  return (
    line.trimEnd() === "+" ||
    /^[ \t]/v.test(line) ||
    listMarkerStyle(line.trimStart()) !== undefined ||
    isDescriptionListLine(line)
  );
}

// The pattern list each context uses REGARDLESS of where the line
// sits. listContinuation starts from the plain-paragraph set and adds
// only the OPEN list's markers, which the line alone cannot tell it —
// see interruptsParagraph.
const INTERRUPTERS_BY_CONTEXT: Record<ParagraphContext, readonly RegExp[]> = {
  paragraph: PARAGRAPH_INTERRUPTERS,
  listItem: LIST_ITEM_INTERRUPTERS,
  listContinuation: PARAGRAPH_INTERRUPTERS,
  dlistItem: DLIST_ITEM_ANY_LINE_INTERRUPTERS,
};

// No context-specific patterns for this position.
const NO_PATTERNS: readonly RegExp[] = [];

// Patterns that interrupt ONLY on the first line after the block
// started — where `next_block` still gets to choose a block context.
const FIRST_LINE_INTERRUPTERS: Record<ParagraphContext, readonly RegExp[]> = {
  paragraph: NO_PATTERNS,
  listItem: NO_PATTERNS,
  listContinuation: NO_PATTERNS,
  dlistItem: DLIST_FIRST_LINE_INTERRUPTERS,
};

// Patterns that interrupt ONLY on a LATER line. One entry, and it is
// the mirror of the raw-line rule: a `[[a]]` directly after a list
// item's text is metadata for the item's FIRST block, which
// `fold_first` merges into the item text — anchor and all, so the
// oracle emits no id (see BLOCK_ANCHOR). Further down there is a
// first block already, so the anchor opens a second one and keeps
// its id (`* item` / `foo` / `[[a]]` / `para` renders
// `<div id="a">`).
const LATER_LINE_INTERRUPTERS: Record<ParagraphContext, readonly RegExp[]> = {
  paragraph: NO_PATTERNS,
  listItem: [BLOCK_ANCHOR],
  listContinuation: NO_PATTERNS,
  dlistItem: NO_PATTERNS,
};

/**
 * Whether a line's SHAPE ends the open block: the context's
 * position-independent patterns plus the ones its position adds.
 * @param line - one rstripped source line
 * @param context - which kind of paragraph is open
 * @param firstLineAfterBlockStart - see {@link InterruptionOptions}
 * @returns true when some applicable pattern matches
 */
function matchesInterrupter(
  line: string,
  context: ParagraphContext,
  firstLineAfterBlockStart: boolean,
): boolean {
  const { [context]: always } = INTERRUPTERS_BY_CONTEXT;
  const byPosition = firstLineAfterBlockStart
    ? FIRST_LINE_INTERRUPTERS
    : LATER_LINE_INTERRUPTERS;
  const { [context]: positional } = byPosition;
  const test = (pattern: RegExp): boolean => pattern.test(line);
  return always.some(test) || positional.some(test);
}

// Contexts in which a `term::` word starts a nested description list
// rather than being plain text.
const ENDED_BY_DLIST_TERM = new Set<ParagraphContext>([
  "listItem",
  "dlistItem",
]);

// The ONE context ignoreDescriptionListTerms may switch off. Not
// `dlistItem`: there the next `term::` line is the SIBLING term of
// the list already being read, and swallowing it merges two items
// the oracle keeps apart (`[horizontal]` / `term::` / `alt term::`
// renders both terms in one cell, and reflowing them together loses
// one).
const LEXER_IGNORES_DLIST_TERMS_IN: ParagraphContext = "listItem";

/** Caller-supplied context {@link interruptsParagraph} cannot infer. */
export interface InterruptionOptions {
  /**
   * Marker styles (see {@link listMarkerStyle}) of the list ancestry
   * open around a `listContinuation` paragraph, innermost first.
   * Ignored in the other contexts. Empty means no list is open, so no
   * marker line ends the paragraph.
   */
  readonly enclosingListStyles?: readonly string[];
  /**
   * Suppress the description-list TERM rule (see
   * {@link ENDED_BY_DLIST_TERM}), leaving every LINE-shaped rule in
   * force. Off by default, so the registry's own verdict stays
   * Asciidoctor-true and the oracle pin keeps testing it.
   *
   * The lexer turns it ON, and only until description lists are
   * parsed (#9); it bites in the `listItem` context alone (see
   * LEXER_IGNORES_DLIST_TERMS_IN). Ending the paragraph at a
   * `term::` line is the right verdict but we have no dlist node to
   * end it INTO: the line goes back through default_mode, where its
   * indentation decides which branch takes it — inline text when
   * flush left, an attached literal block once the printer has
   * indented it under the item's marker. Formatting `* a` /
   * `term:: def` therefore did not converge. Keeping the line inside
   * the paragraph makes both passes take the same path; the reflow
   * hazard guard still keeps the term off the block's first output
   * line, and the oracle renders the result identically (a dlist
   * nested in the item).
   */
  readonly ignoreDescriptionListTerms?: boolean;
  /**
   * Whether the line being classified is the FIRST one after the
   * block started. Some shapes only mean anything there — see
   * FIRST_LINE_INTERRUPTERS and LATER_LINE_INTERRUPTERS, and the
   * matching rule in {@link isRawParagraphLine}. Defaults to false,
   * the position most lines are in.
   */
  readonly firstLineAfterBlockStart?: boolean;
}

/**
 * Whether a line ends the open paragraph (or list item text).
 * @param rawLine - one source line, without its trailing newline;
 *   trailing whitespace is trimmed here (see rstrip)
 * @param context - which kind of paragraph is open; see
 *   {@link ParagraphContext} for what each set contains
 * @param options - the line's position in the block, the enclosing
 *   list ancestry, and the lexer's dlist opt-out — none of which the
 *   line alone conveys; see {@link InterruptionOptions}
 * @returns true when Asciidoctor would start a new block (or item) here
 */
export function interruptsParagraph(
  rawLine: string,
  context: ParagraphContext,
  options: InterruptionOptions = {},
): boolean {
  // A comment or preprocessor line is consumed while READING, before
  // block structure exists, so it can never end anything — including
  // when its shape (`ifdef::flag[]`) also reads as a block macro.
  // Context-free on purpose: the block-anchor rule below is about
  // how a line is PRINTED, not about what the preprocessor eats.
  if (isRawParagraphLine(rawLine)) {
    return false;
  }
  const line = rstrip(rawLine);
  if (
    matchesInterrupter(line, context, options.firstLineAfterBlockStart === true)
  ) {
    return true;
  }
  if (context === "listContinuation") {
    // Only a marker of a list that is ALREADY OPEN ends a
    // `+`-attached paragraph: the oracle continues the paragraph
    // through `. next` inside a `*` list and through `* next` inside
    // a `.` list, and ends it at either inside its own list. A dlist
    // term never ends one — the asymmetry with `listItem` below is
    // the oracle's, not a modelling shortcut.
    const style = listMarkerStyle(line);
    return (
      style !== undefined && (options.enclosingListStyles ?? []).includes(style)
    );
  }
  // A dlist term interrupts a LIST ITEM's text — the oracle nests a
  // fresh `<div class="dlist">` inside the `<li>` — but is swallowed
  // as plain text mid-PARAGRAPH (confirmed against the oracle for
  // "term:: definition" in every context). Surprising: it is the only
  // pattern in this registry whose verdict flips by context rather
  // than being a strict superset/subset relationship.
  const ignored =
    options.ignoreDescriptionListTerms === true &&
    LEXER_IGNORES_DLIST_TERMS_IN === context;
  return (
    !ignored && ENDED_BY_DLIST_TERM.has(context) && isDescriptionListLine(line)
  );
}

/**
 * Whether a line's SHAPE would start a new block in ANY context —
 * the union of every {@link ParagraphContext}'s pattern set, which is
 * DLIST_ITEM_INTERRUPTERS: it already carries the plain-paragraph set,
 * the list markers a sibling item or a `+`-continuation breaks at, and
 * the block anchor, so no context contributes a pattern it lacks.
 *
 * Exists for reflow (src/reflow.ts), which decides whether a word may
 * be placed at the start of an output line while knowing nothing about
 * which kind of paragraph it is printing. Gluing a word that needed no
 * gluing only makes a line longer; letting an interrupting one reach
 * column 0 splits the block, so the union is the safe side.
 *
 * The description-list term rule is deliberately NOT part of it. It is
 * the one member of the interrupting set that is word-based rather
 * than line-shaped: a `term::` word interrupts from ANY column of a
 * list-item line, and from no column of a paragraph's later lines, so
 * "may this word start a line" is the wrong question to ask about it.
 * Reflow guards it separately (see DLIST_SEPARATOR_WORD's own rule
 * there), and answering true here would fight that guard.
 *
 * Makes no new claim about Asciidoctor: it composes the sets above,
 * each of which carries its own Ruby citation. (Reflow additionally
 * asks isRawParagraphLine, because a comment or directive that a
 * word lands on destroys text without interrupting anything.)
 * @param line - one source line, without its trailing newline
 * @returns true when some context would start a new block or item on
 *   a line beginning with this shape
 */
export function interruptsByLineShape(line: string): boolean {
  // Same exemption as interruptsParagraph: a comment or preprocessor
  // line is consumed while READING, before block structure exists, so
  // it never starts a block whatever its shape suggests.
  if (isRawParagraphLine(line)) {
    return false;
  }
  const text = rstrip(line);
  return DLIST_ITEM_INTERRUPTERS.some((pattern) => pattern.test(text));
}

/**
 * Whether a line inside a paragraph must be kept verbatim rather than
 * treated as reflowable text: a comment or preprocessor line
 * anywhere, a whole-line block anchor directly after a list item's
 * text (see RAW_BLOCK_ANCHOR_CONTEXTS), and a foreign list marker
 * inside a `+`-attached paragraph (see isForeignMarkerLine).
 * @param rawLine - one source line, without its trailing newline;
 *   trailing whitespace is trimmed here (see rstrip)
 * @param context - the open paragraph's context; omit for the
 *   context-free preprocessor shapes alone
 * @param options - the line's position in the block and the
 *   enclosing list ancestry: the anchor rule applies on the first
 *   line after the block start alone, and the marker rule needs to
 *   know which lists are open (see {@link InterruptionOptions})
 * @returns true for line comments, conditional directives, includes,
 *   and the two context-dependent shapes
 */
export function isRawParagraphLine(
  rawLine: string,
  context?: ParagraphContext,
  options: InterruptionOptions = {},
): boolean {
  const line = rstrip(rawLine);
  if (PARAGRAPH_RAW_LINES.some((pattern) => pattern.test(line))) {
    return true;
  }
  if (context === "listContinuation" && isForeignMarkerLine(line, options)) {
    return true;
  }
  return (
    context !== undefined &&
    options.firstLineAfterBlockStart === true &&
    RAW_BLOCK_ANCHOR_CONTEXTS.has(context) &&
    BLOCK_ANCHOR.test(line)
  );
}

/**
 * Whether a line inside a `+`-attached paragraph is shaped like a
 * list item of a list that is NOT open around it.
 *
 * Such a line is plain TEXT — it does not end the paragraph — but
 * its position still matters: `read_lines_for_list_item` flips
 * `within_nested_list` on any line matching `NESTABLE_LIST_CONTEXTS`,
 * and that flag decides whether the NEXT `+` line is erased (a real
 * continuation) or kept as text. Reflowing the line onto its
 * predecessor moves the marker off column 0, the flag stays false,
 * and a later `+` silently changes meaning. Keeping the line
 * verbatim is what preserves it.
 *
 * An EMPTY ancestry means no list is open — a `+` at the top level,
 * where `read_lines_for_list_item` never runs and `within_nested_list`
 * does not exist. There the marker-shaped line is ordinary text with
 * nothing riding on its column, so the rule must stay out of the way
 * (holding it back made `+` / `para` / `* item` / `more` reflow
 * differently on each pass).
 * @param line - one rstripped source line
 * @param options - the enclosing list ancestry; a marker belonging
 *   to it interrupts instead and never reaches this rule
 * @returns true when the line must keep its own output line
 */
function isForeignMarkerLine(
  line: string,
  options: InterruptionOptions,
): boolean {
  const styles = options.enclosingListStyles ?? [];
  if (styles.length === EMPTY) {
    return false;
  }
  const style = listMarkerStyle(line);
  return style !== undefined && !styles.includes(style);
}
