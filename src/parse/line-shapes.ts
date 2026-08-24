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
 * Both the BlockReader's classifier (src/parse/lines/classify.ts)
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
 *   the caller supplies as `enclosingListStyle`.
 * - `dlistItem` — the description of a `term:: desc` item. Widest
 *   set: `parse_list_item` parses the lines after the term with
 *   `text_only: nil` — a full `next_block` — and then `fold_first`
 *   merges the result back into the item text ONLY when it is a
 *   plain paragraph. So every shape `next_block` turns into a
 *   non-paragraph block (admonition, block macro, break, anchor)
 *   ends the description, while block metadata that a paragraph
 *   absorbs (a block title, an attribute entry) does not.
 * - `literalParagraph` — the indented lines of a literal paragraph.
 *   `next_block`'s `indented && !style` branch calls
 *   `read_paragraph_lines reader, (skipped == 0 ? options[:list_type]
 *   : nil)`, so at document level `break_at_list` is nil and the set
 *   is exactly the plain-paragraph one (`StartOfBlockProc`). It is a
 *   context of its own rather than an alias for `paragraph` because
 *   the READER treats the lines differently (verbatim, not reflowed)
 *   and because inside a list item the same branch gets a
 *   `list_type` — the day we model that, only this row changes.
 * - `verbatimStyled` — a paragraph opened under a held VERBATIM
 *   style (`[source]`, `[listing]`, `[literal]`, `[verse]` —
 *   VERBATIM_STYLES, asciidoctor.rb:277; NOT `[pass]`, oracle-pinned).
 *   Behavior is `read_lines_until break_on_blank_lines: true,
 *   break_on_list_continuation: true` (parser.rb:1017-1019): blank
 *   lines are structural to the reader, so the pattern set carries
 *   only the lone `+`. The `+` sits in the ANY-LINE set because
 *   Ruby's `line_read` gate (reader.rb:414, :426) is false only for
 *   the styled block's OPENING line, which Ruby unshifts
 *   (parser.rb:558) and our reader consumes at open — every position
 *   this classifier sees corresponds to `line_read === true`. Pinned
 *   against the oracle, both positions, in
 *   tests/conformance/interruption.test.ts.
 */
export type ParagraphContext =
  | "paragraph"
  | "listItem"
  | "listContinuation"
  | "dlistItem"
  | "literalParagraph"
  | "verbatimStyled";

// The one character the oracle's rstrip removes that JavaScript's
// `trimEnd()` does not. Kept as a string rather than folded into a
// character class because a NUL inside a regex literal is a control
// character ESLint rejects, and this is not worth a suppression.
const NUL = "\u{0}";

/**
 * Trim trailing whitespace, the way Asciidoctor's reader does to
 * EVERY line before the parser sees it
 * (`Helpers.prepare_source_string` / `prepare_source_array`, called
 * with `trim_end`). Every `$`-anchored pattern in this file is
 * therefore matched against the rstripped line: `----␠␠` is a
 * delimiter and `+␠` is a list continuation
 * (src/parse/lines/classify.ts#isContinuationLine keeps the same rule).
 *
 * Exported because src/parse/lines/split.ts must strip the SAME set
 * before handing lines to these patterns; two spellings of "rstrip"
 * would be two dialects of every rule below.
 *
 * ORACLE SURPRISE, and the reason this is neither a plain `trimEnd()`
 * nor a hand-written MRI set: the oracle is Asciidoctor Ruby
 * transpiled by Opal, and Opal implements `String#rstrip` as the
 * JavaScript `self.replace(/[\s\u0000]*$/, '')`. That set is neither
 * MRI's nor `trimEnd`'s — it is JavaScript's `\s` (so a trailing
 * NO-BREAK SPACE goes, which MRI keeps) PLUS a NUL (which `trimEnd`
 * keeps). The oracle is the arbiter, so this mirrors Opal exactly:
 * `trimEnd()` is the `\s` half and the loop is the NUL half. The rows
 * in tests/conformance/interruption.test.ts pin both edges.
 * @param line - one source line, without its trailing newline
 * @returns the line without its trailing run of JavaScript whitespace
 *   and NULs
 */
export function rstrip(line: string): string {
  let stripped = line.trimEnd();
  // Loop, not a single slice: `a\u{0}\u{0}` and `a \u{0} ` must lose
  // every trailing character, whichever half claims it.
  while (stripped.endsWith(NUL)) {
    stripped = stripped.slice(0, -1).trimEnd();
  }
  return stripped;
}

/**
 * Anchor a pattern source to a whole rstripped line, the way every
 * shape in this registry is matched (Asciidoctor's line rules are all
 * `^…$` over one already-rstripped line).
 * @param source - the pattern source, without anchors
 * @returns a `v`-flag regex that must consume the entire line
 */
function wholeLine(source: string): RegExp {
  return new RegExp(`^${source}$`, "v");
}

/**
 * The value of a named group whose branch is OPTIONAL. TypeScript
 * types every group of a match as `string`, but a group that did not
 * participate is undefined at runtime; the declared return type is
 * the honest one, and reading through it costs no assertion. Lives
 * with the patterns rather than with either parser, so both the
 * registry's own parse functions and the classifier's read their
 * optional groups through ONE widening.
 * @param group - a named group of a successful match
 * @returns the group's value, or undefined when it did not participate
 */
export function optionalGroup(group: string): string | undefined {
  return group;
}

/**
 * Pattern source for a block anchor line — unanchored, so
 * {@link BLOCK_ANCHOR} can wrap it and the prose below can point at
 * the shape by name. Mirrors `BlockAnchorRx`
 * (`/^\[\[(?:|([\p{Alpha}_:][\w\-:.]*)(?:, *(.+))?)\]\]$/`), empty
 * `[[]]` form included; the capture groups are dropped because
 * nothing here reads them.
 */
const BLOCK_ANCHOR_SOURCE = String.raw`\[\[(?:|[A-Za-z_:][\w\-:.]*(?:, *[^\n]+)?)\]\]`;

/**
 * Pattern source for a line comment — a PREFIX, so {@link LINE_COMMENT}
 * anchors it at the start only. Mirrors `CommentLineRx`
 * (`%r(^//(?=[^/]|$))`):
 * `//path` IS a comment, `///text` is ordinary text, and `////` is a
 * comment BLOCK delimiter claimed by an earlier token.
 */
const LINE_COMMENT_SOURCE = "//(?!/)";

/**
 * Pattern source for a block attribute list line (`[source,ruby]`,
 * `[.role]`, `[]`), unanchored like the anchor source above. Mirrors
 * `BlockAttributeLineRx`
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
const BLOCK_ATTRIBUTE_LINE_SOURCE = String.raw`\[(?:|[\w.#%\{,"'][^\n]*)\]`;

/**
 * Every delimited-block kind, one per `DELIMITED_BLOCKS` key. Written
 * out rather than derived from {@link DELIMITER_SOURCES} so that the
 * two check each other: a kind missing from either side is a type
 * error, and callers get a list they can iterate with the kind's own
 * type instead of `string` (`Object.keys` widens, and widening it
 * back with an assertion is what the lint config forbids).
 *
 * The order is not load-bearing — the patterns are mutually
 * exclusive: each non-table pattern is a uniform run of a different
 * character, and the four table rows are a distinct hint character
 * followed by a run of `=` at least three long, which no other
 * pattern here (the `={4,}` example row included) can also match.
 */
export const DELIMITER_KINDS = [
  "listing",
  "literal",
  "pass",
  "example",
  "sidebar",
  "quote",
  "commentBlock",
  "openBlock",
  "fencedCode",
  "tablePipe", // |===   (psv; the hint char sets no format, parser.rb:865)
  "tableComma", // ,===   (csv, parser.rb:867)
  "tableColon", // :===   (dsv, parser.rb:867)
  "tableBang", // !===   (psv; used for nested tables)
] as const;

/** Which delimited block a delimiter line opens. */
export type DelimiterKind = (typeof DELIMITER_KINDS)[number];

/**
 * Pattern sources for the delimiter of each delimited block, one per
 * `DELIMITED_BLOCKS` key. {@link DELIMITED_BLOCK_PATTERNS} anchors
 * each one to a whole line.
 *
 * Mirrors `is_delimited_block?`: the line must be the delimiter and
 * NOTHING else — a uniform run of the tip character, at least as long
 * as the tip; for the four table rows, the format-hint character then
 * a run of `=` at least three long (parser.rb:967-1001). `----:: x`
 * is therefore a description-list term, not a listing block, and
 * `:===` is a table, not an attribute entry (AttributeEntryRx needs a
 * word character after the colon). The one exception is the Markdown
 * fence, where the 4th character may not be a backtick but anything
 * after ``` is a language hint.
 */
const DELIMITER_SOURCES: Record<DelimiterKind, string> = {
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
  tablePipe: String.raw`\|={3,}`,
  tableComma: String.raw`,={3,}`,
  tableColon: String.raw`:={3,}`,
  tableBang: String.raw`!={3,}`,
};

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
export const BLOCK_ANCHOR = wholeLine(BLOCK_ANCHOR_SOURCE);

// A block attribute list alone on a line: `StartOfBlockProc` tests
// BlockAttributeLineRx, of which this is every alternative but the
// anchor one. See BLOCK_ATTRIBUTE_LINE_SOURCE.
export const BLOCK_ATTRIBUTE_LINE = wholeLine(BLOCK_ATTRIBUTE_LINE_SOURCE);

// A block title (`.Title`). Mirrors `BlockTitleRx`
// (`/^\.(\.?[^ \t.]CC_ANY*)$/`): one dot, an optional second, then a
// character that is neither space nor dot — which is what keeps
// `. item` (an ordered list marker) and `....` (a literal delimiter)
// out.
export const BLOCK_TITLE = /^\.\.?[^ \t.][^\n]*$/v;

// An attribute entry (`:name: value`, `:name!:`). Mirrors
// `AttributeEntryRx` (`/^:(!?CG_WORD[^:]*):(?:[ \t]+(CC_ANY*))?$/`),
// with Ruby's unicode word class approximated by `\w` the same way
// BLOCK_ANCHOR_SOURCE approximates its id class.
// Named groups carry the parse out through the classifier — the ONE
// parse; the accepted line set is IDENTICAL to the ungrouped spelling
// (`!` is a `[^:]` character, so a trailing bang splits off the lazy
// name exactly where the old builder regex split it).
export const ATTRIBUTE_ENTRY =
  /^:(?<prefixBang>!?)(?<name>\w[^:]*?)(?<suffixBang>!?):(?:[ \t]+(?<value>[^\n]*))?$/v;

/**
 * Delimiter lines keyed by kind, one per {@link DELIMITER_SOURCES}
 * entry (and so per `DELIMITED_BLOCKS` key), anchored to a whole
 * rstripped line.
 *
 * Keyed because the classifier has to report WHICH block a delimiter
 * opens (`is_delimited_block?` returns a `BlockMatchData` carrying the
 * context), while the interrupting sets below only ask whether the
 * line is a delimiter at all.
 */
export const DELIMITED_BLOCK_PATTERNS: Record<DelimiterKind, RegExp> = {
  listing: wholeLine(DELIMITER_SOURCES.listing),
  literal: wholeLine(DELIMITER_SOURCES.literal),
  pass: wholeLine(DELIMITER_SOURCES.pass),
  example: wholeLine(DELIMITER_SOURCES.example),
  sidebar: wholeLine(DELIMITER_SOURCES.sidebar),
  quote: wholeLine(DELIMITER_SOURCES.quote),
  commentBlock: wholeLine(DELIMITER_SOURCES.commentBlock),
  openBlock: wholeLine(DELIMITER_SOURCES.openBlock),
  fencedCode: wholeLine(DELIMITER_SOURCES.fencedCode),
  tablePipe: wholeLine(DELIMITER_SOURCES.tablePipe),
  tableComma: wholeLine(DELIMITER_SOURCES.tableComma),
  tableColon: wholeLine(DELIMITER_SOURCES.tableColon),
  tableBang: wholeLine(DELIMITER_SOURCES.tableBang),
};

/**
 * The same patterns as a plain list, for the callers that only ask
 * "is this line a delimiter" (the interrupting sets, isDelimiterLine).
 */
const DELIMITED_BLOCK_LINES: readonly RegExp[] = DELIMITER_KINDS.map(
  (kind) => DELIMITED_BLOCK_PATTERNS[kind],
);

/**
 * Whether a line is a delimited-block delimiter.
 * @param line - one source line, without its trailing newline
 * @returns true for `----`, `--`, ` ``` `, and the rest of
 *   `DELIMITED_BLOCKS`
 */
export function isDelimiterLine(line: string): boolean {
  return DELIMITED_BLOCK_LINES.some((pattern) => pattern.test(rstrip(line)));
}

/**
 * A `+` list continuation (`LIST_CONTINUATION`, compared as
 * `line == '+'` against an already-rstripped line).
 *
 * A standalone `+` ends a paragraph in EVERY context, a list nowhere
 * in sight included: `read_lines_until` is called with
 * `break_on_list_continuation: true` from `read_paragraph_lines`
 * regardless of nesting. The oracle splits `first line` / `+` /
 * `last line` into two `<p>` elements, the `+` becoming text of the
 * second (it is not consumed).
 */
export const CONTINUATION_LINE = /^\+$/v;

// Lines that end a paragraph in EVERY context: `StartOfBlockProc` =
// `(BlockAttributeLineRx.match? l) || (is_delimited_block? l)`, plus
// the lone `+`, which `read_lines_until` breaks on separately
// (`break_on_list_continuation`).
const SHARED_INTERRUPTERS: readonly RegExp[] = [
  ...DELIMITED_BLOCK_LINES,
  BLOCK_ATTRIBUTE_LINE,
  CONTINUATION_LINE,
];

/**
 * Lines that end a plain paragraph. Also the base set for a
 * `listContinuation` paragraph, which adds the open list's markers.
 */
const PARAGRAPH_INTERRUPTERS: readonly RegExp[] = [
  ...SHARED_INTERRUPTERS,
  BLOCK_ANCHOR,
];

// The marker itself, one source per list kind, so that the three
// shapes below (interrupting set, style extractor, whole-line parser)
// spell the alternation once. Mirrors `ListRxMap`'s
// `UnorderedListRx` (`(-|\*\**|•)`), `OrderedListRx` (`(\.\.*|\d+\.|
// [a-zA-Z]\.|[IVXivx]+\))`) and `CalloutListRx` (`<(\d+|\.)>`).
//
// KNOWN NARROWER THAN RUBY, unchanged by this task: the marker runs
// are capped at five (`*{1,5}`, `.{1,5}`) where Ruby's `\*\**` is
// unbounded, and the ordered alternatives Ruby spells with digits,
// letters and roman numerals are not modelled at all. Both are
// pre-existing gaps tracked with description lists and numbering
// styles, not new claims about Asciidoctor.
const UNORDERED_MARKER_SOURCE = String.raw`\*{1,5}|-`;
const ORDERED_MARKER_SOURCE = String.raw`\.{1,5}`;
const CALLOUT_MARKER_SOURCE = String.raw`<(?:\d+|\.)>`;

// Sibling and nested item markers. Mirrors `AnyListRx` gathering the
// three `ListRxMap` patterns: `UnorderedListRx` and `OrderedListRx`
// open with `^[ \t]*` and take a `[ \t]+` gap, while `CalloutListRx`
// allows no leading whitespace at all (`next_block` gates it on
// `!indented`).
//
// This set used to be narrower than LIST_MARKER_LINE on those two
// axes — column-0 only, one SPACE only — because widening it would
// have moved indented (or tab-gapped) markers out of list-item text
// before there was a reader that could nest them (issue #29). The
// BlockReader nests them, and the oracle is unambiguous: `* a` /
// `␠␠** b` / `* c` renders a nested list and a sibling item, while
// `* a` / `*\tb` renders two siblings. Issue #29 is closed here; both
// spellings now say the same thing, and the rows in
// tests/parser/lines.test.ts and tests/parser/reader.test.ts pin the
// Ruby-true verdict in both line positions.
const LIST_MARKERS: readonly RegExp[] = [
  new RegExp(String.raw`^[ \t]*(?:${UNORDERED_MARKER_SOURCE})[ \t]+`, "v"),
  new RegExp(String.raw`^[ \t]*(?:${ORDERED_MARKER_SOURCE})[ \t]+`, "v"),
  new RegExp(String.raw`^${CALLOUT_MARKER_SOURCE}[ \t]+`, "v"),
];

/**
 * A whole line that begins an unordered or ordered list item, with
 * the parts the classifier reports: the leading whitespace Ruby
 * allows (`^[ \t]*`), the marker, the gap, and the text.
 *
 * `\S[^\n]*` where Ruby has `(CC_ANY*)`: Ruby's text group may be
 * empty, but the line is rstripped before matching, so `*␠` arrives
 * as `*` and fails the `[ \t]+` gap anyway. Requiring the text makes
 * that explicit and keeps `****` (a sidebar delimiter) out.
 */
export const LIST_MARKER_LINE = new RegExp(
  String.raw`^(?<indent>[ \t]*)(?<marker>${UNORDERED_MARKER_SOURCE}|${ORDERED_MARKER_SOURCE})(?<gap>[ \t]+)(?<text>\S[^\n]*)$`,
  "v",
);

/**
 * A whole line that begins a callout list item. Separate from
 * {@link LIST_MARKER_LINE} because `CalloutListRx` allows NO leading
 * whitespace and `next_block` only tries it when the line is not
 * indented (`!indented && ch0 == '<'`) — an indented `<1>` is a
 * literal paragraph.
 */
export const CALLOUT_MARKER_LINE = new RegExp(
  String.raw`^(?<marker>${CALLOUT_MARKER_SOURCE})(?<gap>[ \t]+)(?<text>\S[^\n]*)$`,
  "v",
);

/**
 * Lines that end a LIST ITEM's text: everything that ends a plain
 * paragraph (except a block anchor — see BLOCK_ANCHOR above) plus
 * sibling/nested item markers, which is `read_lines_for_list_item`
 * breaking at `is_sibling_list_item?` and buffering an `AnyListRx`
 * match as a nested list. (Confirmed by the oracle rows in
 * interruption.test.ts; if the oracle disagrees with an entry, the
 * oracle wins — fix the list.)
 */
const LIST_ITEM_INTERRUPTERS: readonly RegExp[] = [
  ...SHARED_INTERRUPTERS,
  ...LIST_MARKERS,
];

/**
 * An ATX section title (`== Section`), the document title (`= Doc`)
 * included — its level is simply 0. Mirrors `AtxSectionTitleRx`
 * (`/^(=={0,5})[ \t]+(CC_ANY+?)(?:[ \t]+\1)?$/`), whose marker group
 * is one `=` followed by up to five more, so `level = markers.length
 * - 1`. Ruby's optional trailing `\1` (the closed form `== T ==`)
 * only shortens the TITLE, never decides whether the line is one, so
 * it is left out here where only the level is reported.
 */
export const SECTION_TITLE = /^(?<markers>={1,6})[ \t]+(?<title>\S[^\n]*)$/v;

/**
 * An admonition label (`NOTE: text`). Mirrors
 * `AdmonitionParagraphRx` (`/^(NOTE|TIP|IMPORTANT|WARNING|CAUTION):
 * [ \t]+/`), which is a PREFIX match: the rest of the line is the
 * admonition's first line of text (`lines[0] = $'`). The whole prefix
 * is captured so callers can report where the text starts without
 * re-deriving the colon's width.
 */
export const ADMONITION_LABEL =
  /^(?<prefix>(?<label>NOTE|TIP|IMPORTANT|WARNING|CAUTION):[ \t]+)/v;

/**
 * A block macro line (`image::a.png[]`, `toc::[]`, `custom::t[a]`).
 * Mirrors `BlockMediaMacroRx` / `BlockTocMacroRx` /
 * `CustomBlockMacroRx`, which `next_block` only reaches for a line
 * that ends in `]` and contains `::`; the name is left open because
 * extensions may register any name and the formatter reprints the
 * line either way.
 */
export const BLOCK_MACRO =
  /^(?<name>[A-Za-z]\w*)::(?<target>[^\[\n]*)\[(?<attrlist>[^\]\n]*)\]$/v;

/**
 * A thematic break (`'''`). Mirrors `next_block`'s
 * `LAYOUT_BREAK_CHARS` lookup guarded by `uniform?` and a length
 * greater than two.
 */
export const THEMATIC_BREAK = /^'{3,}$/v;

/** A page break (`<<<`). Same `LAYOUT_BREAK_CHARS` rule. */
export const PAGE_BREAK = /^<{3,}$/v;

/**
 * An indented line, which `next_block` reads as the start of a
 * literal paragraph (`indented = this_line.start_with? ' ', TAB`, and
 * `LiteralParagraphRx` = `/^([ \t]+CC_ANY*)$/`). A line of nothing
 * but whitespace is not one: it is rstripped to empty first, which
 * makes it blank.
 */
export const LITERAL_LINE = /^[ \t]+\S/v;

// Shapes that end a dlist description ONLY on the first line after
// the term. `parse_list_item` hands those lines to `next_block`,
// which reads `this_line` — the block's first line — to pick a block
// context: an admonition label, a block macro, a break. Once it has
// settled on "normal paragraph" the rest of the lines go through
// `read_paragraph_lines`, whose break condition no longer knows any
// of them. The oracle agrees in both positions: `term1:: desc` /
// `NOTE: x` splits, `term1:: desc` / `more` / `NOTE: x` does not.
const DLIST_FIRST_LINE_INTERRUPTERS: readonly RegExp[] = [
  ADMONITION_LABEL,
  BLOCK_MACRO,
  THEMATIC_BREAK,
  PAGE_BREAK,
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
const DLIST_ITEM_INTERRUPTERS: readonly RegExp[] = [
  ...DLIST_ITEM_ANY_LINE_INTERRUPTERS,
  ...DLIST_FIRST_LINE_INTERRUPTERS,
];

// A list marker's STYLE — `is_sibling_list_item?` compares the
// `resolve_list_marker` result, not the raw line, so `<2>` continues
// a `<1>` list (its style is spelled `<>` here) while `-` and `*` are
// different styles of unordered list.
const MARKER_STYLES: readonly RegExp[] = [
  // unordered: `*`…`*****`, `-`
  new RegExp(`^(?<style>${UNORDERED_MARKER_SOURCE})(?= )`, "v"),
  // ordered: `.`…`.....`
  new RegExp(`^(?<style>${ORDERED_MARKER_SOURCE})(?= )`, "v"),
  // callout: style is always `<>`
  new RegExp(`^${CALLOUT_MARKER_SOURCE}(?= )`, "v"),
];

/** The style key every callout marker shares — see MARKER_STYLES. */
export const CALLOUT_STYLE = "<>";

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
// unresolved include leaves a sentence behind.
//
// `v`-flag character classes require `[` escaped even when negated
// (bare `[` inside a class starts a nested set operation under `v`).
export const CONDITIONAL_DIRECTIVE =
  /^(?:ifdef|ifndef|ifeval|endif)::[^\[]*\[[^\]]*\]$/v;

/**
 * An include directive.
 *
 * ORACLE SURPRISE (does not change the classification, only what
 * "raw" means here): an include whose target cannot be resolved is
 * still consumed as a directive while reading -- it never becomes
 * list/paragraph text -- but Asciidoctor's fallback behavior
 * substitutes a literal "Unresolved directive in <file> - <line>"
 * sentence into the surrounding paragraph, so the directive's exact
 * text (not the concept of a raw line) leaks into rendered output
 * for this one failure mode. tests/conformance/interruption.test.ts
 * skips the content-leak assertion for this row for that reason.
 */
export const INCLUDE_DIRECTIVE = /^include::[^\[]*\[[^\]]*\]$/v;

/**
 * A line comment. A PREFIX match, not a whole-line one: `CommentLineRx`
 * is `%r(^//(?=[^/]|$))`, so everything after the `//` is the comment.
 */
export const LINE_COMMENT = new RegExp(`^${LINE_COMMENT_SOURCE}`, "v");

/**
 * The two characters `Reader#skip_line_comments` tests a line for
 * (`start_with? '//'`) — the one spelling of "line comment" on the
 * SCAN side, where raw LINE text is examined before nodes exist
 * (paragraph-reader.ts, print-list-hazard.ts, reflow.ts). The EMIT
 * side spells its own bytes (print-blocks.ts writes the literal
 * prefix; build/metadata.ts slices its length) and is out of this
 * constant's scope.
 *
 * DELIBERATELY the reader's cruder test, WIDER than
 * {@link LINE_COMMENT}'s `CommentLineRx`: a prefix test also takes
 * `///x` and the `////` block delimiter, which the Rx excludes. The
 * width is load-bearing in paragraph-reader.ts — a `///b::` dlist
 * term is ordinary text to the Rx and a deleted line to
 * `skip_line_comments` (pinned by tests/parser/reader-lists.test.ts
 * and tests/format/list-item-blocks.test.ts's `///b::` rows). In the
 * other two consumers no reachable wider case is known: the lines
 * they are asked about are raw lines the BlockReader classified,
 * pinned by the list-shape sweep. A consumer that must decide
 * whether a line is a comment TO THE PARSER reaches for
 * {@link LINE_COMMENT} instead.
 */
export const LINE_COMMENT_HEAD = "//";

const PARAGRAPH_RAW_LINES: readonly RegExp[] = [
  LINE_COMMENT,
  CONDITIONAL_DIRECTIVE,
  INCLUDE_DIRECTIVE,
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
//
// The delimiter is spelled `:{2,4}` — greedy, exactly Ruby's
// `:::{0,2}` — so the groups below split a line the way Ruby splits
// it. The named groups are what parseDescriptionListLine hands the
// classifier; isDescriptionListLine only asks whether there is a
// match at all.
const DESCRIPTION_LIST_LINE =
  /^(?!\/\/[^\/])[ \t]*(?<term>[^ \t][^\n]*?)(?<delimiter>;;|:{2,4})(?:$|[ \t]+(?<description>[^\n]*))$/v;

/**
 * Whether Asciidoctor would read a line as a description-list item —
 * which it does whenever the line is the FIRST of a block, and (via
 * `AnyListRx`) whenever it follows a list item's text. The reader's
 * classifier needs this to decide what comes after: a dlist item's
 * description is read as block content, not as paragraph text.
 * @param rawLine - one source line, without its trailing newline;
 *   trailing whitespace is trimmed here (see rstrip)
 * @returns true when the line is a `term:: definition` item
 */
export function isDescriptionListLine(rawLine: string): boolean {
  return DESCRIPTION_LIST_LINE.test(rstrip(rawLine));
}

/**
 * Parse a description-list term line into the fields the classifier
 * carries: the delimiter (`::` | `:::` | `::::` | `;;`), the term
 * text (Ruby's group — trailing spaces before the delimiter
 * included: `foo ::` has term `"foo "`), and where the optional
 * inline description starts, as an offset into the RSTRIPPED line.
 * Grammar home: DESCRIPTION_LIST_LINE above (Ruby's
 * `DescriptionListRx`, rx.rb:335, pinned by tests/parser/lines.test.ts's
 * split rows); the groups ride out so no builder
 * or reader ever re-parses the line.
 * @param rawLine - one source line, without its trailing newline;
 *   trailing whitespace is trimmed here (see rstrip)
 * @returns the term line's fields, or undefined when the line is no
 *   description-list item
 */
export function parseDescriptionListLine(
  rawLine: string,
):
  | { delimiter: string; term: string; descriptionStart: number | undefined }
  | undefined {
  const line = rstrip(rawLine);
  const groups = DESCRIPTION_LIST_LINE.exec(line)?.groups;
  if (groups === undefined) {
    return undefined;
  }
  // The description group is the one OPTIONAL branch, so it is the
  // one read through {@link optionalGroup}.
  const description = optionalGroup(groups.description);
  return {
    delimiter: groups.delimiter,
    term: groups.term,
    descriptionStart:
      description === undefined ? undefined : line.length - description.length,
  };
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
  // The literal-paragraph branch of `next_block` calls
  // `read_paragraph_lines` with a nil `break_at_list` at document
  // level, so its set is the plain-paragraph one exactly.
  literalParagraph: PARAGRAPH_INTERRUPTERS,
  verbatimStyled: [CONTINUATION_LINE],
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
  literalParagraph: NO_PATTERNS,
  verbatimStyled: NO_PATTERNS,
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
  literalParagraph: NO_PATTERNS,
  verbatimStyled: NO_PATTERNS,
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
  const always = INTERRUPTERS_BY_CONTEXT[context];
  const byPosition = firstLineAfterBlockStart
    ? FIRST_LINE_INTERRUPTERS
    : LATER_LINE_INTERRUPTERS;
  const positional = byPosition[context];
  const test = (pattern: RegExp): boolean => pattern.test(line);
  return always.some(test) || positional.some(test);
}

// Contexts in which a `term::` word starts a nested description list
// rather than being plain text.
const ENDED_BY_DLIST_TERM = new Set<ParagraphContext>([
  "listItem",
  "dlistItem",
]);

/** Caller-supplied context {@link interruptsParagraph} cannot infer. */
export interface InterruptionOptions {
  /**
   * Marker style (see {@link listMarkerStyle}) of the list open
   * around a `listContinuation` paragraph. 0-or-1 BY CONSTRUCTION: a
   * confined reader carries exactly its own item's style, and the
   * physically-truncated buffer is the rest of the old ancestry
   * argument. Ignored in the other contexts; undefined means no list
   * is open, so no marker line ends the paragraph.
   */
  readonly enclosingListStyle?: string;
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
 * @param options - the line's position in the block and the
 *   enclosing list ancestry, neither of which the line alone
 *   conveys; see {@link InterruptionOptions}
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
    return style !== undefined && style === options.enclosingListStyle;
  }
  // A dlist term interrupts a LIST ITEM's text — the oracle nests a
  // fresh `<div class="dlist">` inside the `<li>` — but is swallowed
  // as plain text mid-PARAGRAPH (confirmed against the oracle for
  // "term:: definition" in every context). Surprising: it is the only
  // pattern in this registry whose verdict flips by context rather
  // than being a strict superset/subset relationship.
  return ENDED_BY_DLIST_TERM.has(context) && isDescriptionListLine(line);
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
 * NO open style means no list is open — a `+` at the top level,
 * where `read_lines_for_list_item` never runs and `within_nested_list`
 * does not exist. There the marker-shaped line is ordinary text with
 * nothing riding on its column, so the rule must stay out of the way
 * (holding it back made `+` / `para` / `* item` / `more` reflow
 * differently on each pass).
 * @param line - one rstripped source line
 * @param options - the open list's style; a marker of that style
 *   interrupts instead and never reaches this rule
 * @returns true when the line must keep its own output line
 */
function isForeignMarkerLine(
  line: string,
  options: InterruptionOptions,
): boolean {
  if (options.enclosingListStyle === undefined) {
    return false;
  }
  const style = listMarkerStyle(line);
  return style !== undefined && style !== options.enclosingListStyle;
}
