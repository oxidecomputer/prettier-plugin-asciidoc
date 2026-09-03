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
 * and reflow safety (src/print/reflow.ts) consume these patterns, so they
 * can never drift apart. tests/conformance/interruption.test.ts pins
 * every pattern here against the Asciidoctor oracle — change a row
 * there before changing a pattern here.
 *
 * ## Where these rules come from
 *
 * The oracle (`@asciidoctor/core` 4.0.11) is Asciidoctor Ruby 2.0.26
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
 * - `listItemText` is the lines that go into a ulist/olist/colist
 *   item's FIRST block, the one `parse_list_item` may fold back into
 *   the item's own text (`list_item.fold_first` fires on `blocks[0]`
 *   alone, parser.rb l.1384). Where it stops is `listItem`'s answer
 *   MINUS the block anchor: an `[[anchor]]` standing here is
 *   `BlockAttributeLineRx` metadata for the very block `fold_first`
 *   merges away, id and all, so the oracle emits no id (see
 *   RAW_BLOCK_ANCHOR_CONTEXTS).
 * - `listItem` is a LATER block of the same item, read with
 *   `read_paragraph_lines reader, skipped == 0 && options[:list_type]`
 *   (parser.rb l.764). A first block exists by then, so an
 *   `[[anchor]]` opens a SECOND one and keeps its id, and the anchor
 *   ends this paragraph from any position.
 *   Both stop at a sibling or nested marker (`AnyListRx`,
 *   `is_sibling_list_item?`) and at a description-list term. For
 *   `listItem` that is the `skipped == 0` half of the cited line and
 *   not an unconditional claim about later blocks: a block opened
 *   ACROSS a blank line gets a falsey `break_at_list` and is
 *   `listContinuation` instead, which is the choice `bodyContext`
 *   makes (src/parse/lines/reader.ts).
 * - `listContinuation` — a paragraph a `+` attached to a list item.
 *   It is NOT a blend of the other two: `parse_list_item` parses it
 *   with `read_paragraph_lines` and NO `break_at_list`, so it takes
 *   the plain-paragraph set; the only markers that end it are the
 *   ones `read_lines_for_list_item` already stopped at, i.e. the
 *   OPEN list's own marker style (`is_sibling_list_item?`), which
 *   the caller supplies as `openListStyle`.
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
 *   VERBATIM_STYLES, asciidoctor.rb:276; NOT `[pass]`, oracle-pinned).
 *   Behavior is `read_lines_until break_on_blank_lines: true,
 *   break_on_list_continuation: true` (parser.rb:1026-1028): blank
 *   lines are structural to the reader, so the pattern set carries
 *   only the lone `+`. The `+` sits in the ANY-LINE set because
 *   Ruby's `line_read` gate (reader.rb:414 and l.426) is false only
 *   for the styled block's OPENING line, which Ruby unshifts
 *   (parser.rb:565) and our reader consumes at open — every position
 *   this classifier sees corresponds to `line_read === true`. Pinned
 *   against the oracle, both positions, in
 *   tests/conformance/interruption.test.ts.
 */
export type ParagraphContext =
  | "paragraph"
  | "listItemText"
  | "listItem"
  | "listContinuation"
  | "dlistItem"
  | "literalParagraph"
  | "verbatimStyled";

/**
 * The reader's state as every line rule reads it — exactly the facts
 * the old token patterns reconstructed by scanning backwards, handed
 * over instead of derived. Three fields and no more: the reader keeps
 * no stack for anything else to read.
 *
 * ONE declaration, here rather than beside the classifier, because
 * both consumers are below the classifier: the interrupting-set rules
 * in this file and `classifyLine` in src/parse/lines/classify.ts. It
 * was two declarations (this one and an `InterruptionOptions` naming
 * the same last two facts under other names, with `?` optionality)
 * kept in step by a translating object literal at the one call site
 * that spanned them — a vocabulary that could drift and a rename that
 * had to be made twice.
 *
 * Every field is spelled `| undefined` rather than `?`: the producer
 * always supplies all three, so "absent" and "undefined" are not two
 * states to tell apart.
 */
export interface ReaderContext {
  /** The paragraph-shaped block being read, or undefined at a block start. */
  readonly openParagraph: ParagraphContext | undefined;
  /**
   * Marker style (see {@link listMarkerStyle}) of the open list, if
   * any (`is_sibling_list_item?`). 0-or-1 BY CONSTRUCTION: a confined
   * reader carries exactly its own item's style, and the
   * physically-truncated buffer is the rest of the old ancestry
   * argument. undefined means no list is open, so no marker line ends
   * the paragraph.
   */
  readonly openListStyle: string | undefined;
  /**
   * Whether this line is the FIRST one after the open block started.
   * Some shapes only mean anything there — see
   * FIRST_LINE_INTERRUPTERS and LATER_LINE_INTERRUPTERS, and the
   * matching rule in {@link isRawParagraphLine}.
   */
  readonly firstLineAfterStart: boolean;
}

/**
 * The context at a plain block start (document level, nothing open).
 * Exported for its unit test (tests/parser/lines.test.ts); no src
 * consumer.
 * @internal
 */
export const BLOCK_START_CONTEXT: ReaderContext = {
  openParagraph: undefined,
  openListStyle: undefined,
  firstLineAfterStart: false,
};

// The oracle's strip set, spelled out rather than as `\s`:
// JavaScript's `\s` is wider at both ends of the code space (it also
// takes a no-break space, every Unicode space separator and a
// byte-order mark), and each of those survives the oracle's rstrip.
// ONE spelling of the six characters: a second one is a second
// dialect of every `$`-anchored rule below.
const TRAILING_ASCII_WHITESPACE = new Set(["\t", "\n", "\v", "\f", "\r", " "]);

// The class body the three exports below share, spelled ONCE (the same
// principle TRAILING_ASCII_WHITESPACE's own comment states): TAB, LF,
// VT, FF, CR, SPACE, as escape sequences ready to sit inside a `[...]`
// or `[^...]` bracket expression.
const ASCII_WHITESPACE_BODY = String.raw`\t\n\v\f\r `;

/**
 * The same six characters as {@link TRAILING_ASCII_WHITESPACE} - TAB,
 * LF, VT, FF, CR, SPACE - spelled as a regex class instead of a Set,
 * for callers that need a pattern (`split`, `test`, `replace`) rather
 * than a membership check. This is Ruby's `\s`
 * (`Regexp::POSIX_CLASSES` has no bearing here; Ruby's `\s` is the
 * literal `[ \t\r\n\f\v]`, unlike JavaScript's, which also matches a
 * no-break space, every Unicode space separator and a byte-order
 * mark - see issue #75). Every word-segmentation or edge-whitespace
 * test in src/print that looks at RAW SOURCE TEXT must use this, not
 * `\s`, or it reads a no-break space as a word separator the way
 * Asciidoctor never does.
 */
export const ASCII_WHITESPACE = new RegExp(`[${ASCII_WHITESPACE_BODY}]`, "v");

/**
 * {@link ASCII_WHITESPACE} minus the newline - the ASCII characters a
 * `[^\S\n]`-shaped pattern means to reach for ("horizontal whitespace,
 * not a line break"). JavaScript's `[^\S\n]` is `\s` minus `\n`, so it
 * inherits the same over-wide `\s`; this is the ASCII-only equivalent,
 * for the same reason as {@link ASCII_WHITESPACE} (issue #75).
 */
export const ASCII_HORIZONTAL_WHITESPACE = new RegExp(
  `[${ASCII_WHITESPACE_BODY.replace(String.raw`\n`, "")}]`,
  "v",
);

/**
 * The negation of {@link ASCII_WHITESPACE} - Ruby's `\S` - for a
 * `[^\S...]`-shaped pattern that means "a non-whitespace character", not
 * JavaScript's wider one (which excludes a no-break space and the rest
 * of {@link ASCII_WHITESPACE}'s over-wide counterpart, so it stops a
 * "word" run one character early at one of them; issue #75).
 */
export const ASCII_NON_WHITESPACE = new RegExp(
  `[^${ASCII_WHITESPACE_BODY}]`,
  "v",
);

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
 * The set is the six ASCII whitespace characters and NOTHING else —
 * TAB, LF, VT, FF, CR and SPACE — which is the pinned oracle's own
 * `line.replace(/[ \t\r\n\f\v]+$/, '')` (the reader's
 * `prepare_source` pair share it). It is narrower than `trimEnd()` at
 * both ends of the code space: a trailing NUL survives, and so does
 * every non-ASCII space. Measured against the oracle rather than read
 * off its source alone — `----` followed by a space, a tab, a
 * vertical tab, a form feed or a carriage return each opens a
 * listing, while `----` followed by a NUL, U+00A0, U+1680, U+2000,
 * U+2007, U+2009, U+202F, U+205F, U+2028, U+2029, U+3000, U+200B or
 * U+FEFF is paragraph text, and each of those characters comes back
 * verbatim from a listing block's content.
 * tests/conformance/interruption.test.ts holds both halves as oracle
 * rows.
 *
 * SCANNED BACKWARD from the end rather than matched as an unanchored
 * `+$` pattern: such a pattern is retried at every start position, so
 * inside a long interior run of spaces the engine consumes the run,
 * fails the anchor and backs off one character at a time, which costs
 * time quadratic in the run. This function runs once per line in
 * splitLines and several times more per line in classification, so
 * that cost multiplies. The scan touches only the characters it
 * removes, so a padded ASCII-art line or a pasted fixed-width table
 * row costs what its tail costs and nothing for its interior.
 * @param line - one source line, without its trailing newline
 * @returns the line without its trailing run of ASCII whitespace
 */
export function rstrip(line: string): string {
  let end = line.length;
  while (end > 0 && TRAILING_ASCII_WHITESPACE.has(line[end - 1])) {
    end -= 1;
  }
  return end === line.length ? line : line.slice(0, end);
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
  "tablePipe", // |===   (psv; the hint char sets no format, parser.rb:874)
  "tableComma", // ,===   (csv, parser.rb:876)
  "tableColon", // :===   (dsv, parser.rb:876)
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
 * a run of `=` at least three long (parser.rb:976-1010). `----:: x`
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
 *
 * Read by the printer's item-boundary rule (`tailSwallowsMarker`,
 * src/print/list.ts), which has to call the same lines opaque that
 * the reader's item loop hands to `read_lines_until terminator:`, and
 * by the interruption oracle suite
 * (tests/conformance/interruption.test.ts).
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

/**
 * A line of nothing but indentation and a `+` - the one shape whose
 * MEANING an item-text dedent can change. `adjust_indentation!`
 * (parser.rb:755, the literal-paragraph branch's own call, not the
 * def) strips the run's common indent before `HardLineBreakRx`
 * (rx.rb:627) ever runs, so an indented `+` can reach the break test
 * as a bare `+` - plain text, not a break. The rule that decides
 * which it is needs the whole paragraph and lives with the scan that
 * has it (lines/paragraph-reader.ts, THE LITERAL-PLUS RULE); the
 * SHAPE lives here beside CONTINUATION_LINE, which is the same line
 * without its indent.
 */
export const INDENTED_PLUS = /^[ \t]+\+$/v;

// A line carrying ONE word and nothing else. It names no Asciidoctor
// construct: it is a question ABOUT a line, the way INDENTED_PLUS is,
// and it is spelled here because the registry owns every pattern that
// reads a source line.
//
// The word run is {@link ASCII_NON_WHITESPACE}, Ruby's `\S`, not
// JavaScript's: a no-break space is CONTENT inside a word to
// Asciidoctor, and `\S` would end the run at one and call a one-word
// line two words (issue #75). The trailing anchor is exact because the
// reader rstrips every line before any rule runs (see {@link rstrip}),
// so a line's trailing whitespace cannot change the answer.
const SINGLE_WORD_LINE = new RegExp(
  `^${ASCII_HORIZONTAL_WHITESPACE.source}*${ASCII_NON_WHITESPACE.source}+$`,
  "v",
);

/**
 * Whether a line holds ONE word: its indent, one run of non-whitespace,
 * and nothing more.
 *
 * A PREDICATE rather than a {@link LineKind} arm, the second route
 * docs/coding-standards.md's line-shape recipe describes: the shape
 * neither opens nor ends a block, so the classifier's verdict for such
 * a line is unchanged and an interruption row for it would pin a grid
 * of identical answers. It sits HERE rather than beside
 * `isIndentedContinuationLine` in lines/classify.ts because the
 * paragraph BUILDERS ask it (src/parse/build/paragraph.ts) and a
 * builder may not import lines/ (the `build-imports-lines` layer rule,
 * scripts/metrics/graph.ts).
 *
 * What reads the answer is the printer's block-start hazard net,
 * through `ParagraphNode.firstWordEndsItsLine` (src/ast.ts); why ONE
 * word is the condition it trades on is stated at the net itself
 * (`keepBlockStartBreak`, src/print/block-start-hazard.ts).
 * @param line - one rstripped source line
 * @returns true when the line is one word between its edges
 */
export function isSingleWordLine(line: string): boolean {
  return SINGLE_WORD_LINE.test(line);
}

/**
 * Which shape of block metadata a line is, for the ONE reader rule
 * that lets metadata "play out until we find the block"
 * (parser.rb:1499-1501) - the four shapes a live list continuation
 * survives, in Ruby's own order.
 */
type ContinuationMetadataKind =
  | "blockTitle"
  | "attributeLine"
  | "anchor"
  | "attributeEntry";

/**
 * "Let block metadata play out until we find the block" - which of
 * the four shapes parser.rb:1499-1501 keeps `continuation == :active`
 * across a line is, if any.
 *
 * Arms in Ruby's own order: a block title (`ch0 == '.'`), a block
 * attribute line (`ch0 == '['`), then an attribute entry
 * (`ch0 == ':'`). Ruby's `BlockAttributeLineRx` (rx.rb:184) carries
 * the `[[anchor]]` form as one of its alternatives and this registry
 * spells that alternative as a pattern of its own, so the anchor is
 * tested where Ruby's second arm would have matched it.
 *
 * A COMMENT is deliberately absent: Ruby's test does not name one, so
 * a comment falls to the else arm at parser.rb:1502 and CONSUMES the
 * continuation (oracle-confirmed; the unit row is in
 * tests/parser/item-extent.test.ts).
 *
 * A DIFFERENT question from the one the block-start classifier
 * answers for a block's first line, and deliberately not funnelled
 * into it: Ruby asks this one inside `read_lines_for_list_item` with
 * three arms in this order, and the other inside
 * `parse_block_metadata_line` with the anchor tested FIRST and an
 * attribute entry parsed rather than matched. Two Ruby sites, two
 * orders, two consequences.
 * @param line - one rstripped source line
 * @returns which metadata shape it is, or undefined when it is none
 */
export function continuationMetadataKind(
  line: string,
): ContinuationMetadataKind | undefined {
  if (BLOCK_TITLE.test(line)) {
    return "blockTitle";
  }
  if (BLOCK_ATTRIBUTE_LINE.test(line)) {
    return "attributeLine";
  }
  if (BLOCK_ANCHOR.test(line)) {
    return "anchor";
  }
  if (ATTRIBUTE_ENTRY.test(line)) {
    return "attributeEntry";
  }
  return undefined;
}

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
// `UnorderedListRx` (`(-|\*\**|•)`), `OrderedListRx` (rx.rb l.300,
// `(\.\.*|\d+\.|[a-zA-Z]\.|[IVXivx]+\))`) and `CalloutListRx`
// (`<(\d+|\.)>`).
//
// The ordered alternation is Ruby's, alternative for alternative and
// in Ruby's order. WHICH ordered form matched is not read off the
// match: the five explicit families are one string to every consumer,
// and {@link orderedMarkerStyle} decides the style from that string.
//
// KNOWN NARROWER THAN RUBY, unchanged here: the marker runs are
// capped at five (`*{1,5}`, `.{1,5}`) where Ruby's `\*\**` and
// `\.\.*` are unbounded. That is a pre-existing gap tracked with
// description lists, not a new claim about Asciidoctor.
const UNORDERED_MARKER_SOURCE = String.raw`\*{1,5}|-`;
const ORDERED_MARKER_SOURCE = String.raw`\.{1,5}|\d+\.|[a-zA-Z]\.|[IVXivx]+\)`;
// The interior is a NAMED group so the one match the classifier
// already runs also reports the number, and no builder re-matches the
// marker to learn it. The two patterns below that only ask "is this a
// callout marker" carry the group unused, which costs them nothing.
const CALLOUT_MARKER_SOURCE = String.raw`<(?<callout>\d+|\.)>`;

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
 * The marker is TWO named groups, one per list kind, so the VARIANT
 * is read off the branch that participated instead of re-derived from
 * the marker's spelling. That derivation used to be `startsWith(".")`,
 * which was right only while `.`-runs were the sole ordered form:
 * `1.`, `a.` and `i)` are ordered markers that start with neither a
 * dot nor a star. The two branches are disjoint by first character,
 * so exactly one group ever participates.
 *
 * `\S[^\n]*` where Ruby has `(CC_ANY*)`: Ruby's text group may be
 * empty, but the line is rstripped before matching, so `*␠` arrives
 * as `*` and fails the `[ \t]+` gap anyway. Requiring the text makes
 * that explicit and keeps `****` (a sidebar delimiter) out.
 */
export const LIST_MARKER_LINE = new RegExp(
  String.raw`^(?<indent>[ \t]*)(?:(?<unordered>${UNORDERED_MARKER_SOURCE})|(?<ordered>${ORDERED_MARKER_SOURCE}))(?<gap>[ \t]+)(?<text>\S[^\n]*)$`,
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
 * The MARKDOWN spelling of a section title (`## Section`), which the
 * oracle also accepts: `ExtAtxSectionTitleRx`
 * (`/^(=={0,5}|##{0,5})[ \t]+(.+?)(?:[ \t]+\1)?$/`,
 * `@asciidoctor/core/build/node/index.cjs` l.266) is the pattern
 * `next_block` actually matches with, and its second alternative is
 * one `#` followed by up to five more.
 *
 * The CLASSIFIER does not read this spelling yet (a `## b` line
 * stays paragraph text here, which is issue #63), so it is not in
 * any interrupting set; it is asked only by
 * {@link startsSectionTitle}, see {@link SECTION_TITLE_SHAPES}.
 */
const MARKDOWN_ATX_SECTION_TITLE = /^#{1,6}[ \t]+\S[^\n]*$/v;

/**
 * Both spellings of a section title, together, for the ONE question
 * no interrupting set answers: may reflow put this line at the start
 * of an output line?
 *
 * Two spellings, one question, so {@link startsSectionTitle} - the
 * only reader - cannot answer about one and forget the other. The
 * measured corruptions are `##\nb## c` packed to `## b## c` (an
 * `<h2>`, the text behind the marks eaten) and `=\nb= c` packed to
 * `= b= c` (the document title, lifted out of the body).
 */
const SECTION_TITLE_SHAPES: readonly RegExp[] = [
  SECTION_TITLE,
  MARKDOWN_ATX_SECTION_TITLE,
];

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

// The one shape that ends a ulist/olist/colist item ONLY on the line
// directly after the marker line. `parse_list_item` hands the item's
// collected lines to `next_block`, which reads the block's first line
// to pick a context; `fold_first` then merges that block back into the
// item text only when it came out a plain paragraph. A block macro
// gives `next_block` a macro block, which `fold_first` refuses, so the
// item text ends at the marker line. Further down there is a first
// block already and the macro line is just paragraph text — the same
// first-line/later split BLOCK_ANCHOR has, mirrored.
//
// Core 2.0.20 folded the macro in at BOTH positions; core 2.0.26 (the
// `@asciidoctor/core` 4.0.11 transpile, the pinned oracle) splits at
// the first. The probe is the arbiter for which Ruby line moved, and
// it is pinned in tests/conformance/interruption.test.ts — the
// `listItem, first line` / `block macro` row of "line-shape registry
// matches the Asciidoctor oracle", plus the round-trip row of the
// same name in "the formatter round-trips every construct in every
// context". Direct pins live in tests/parser/list-reader.test.ts and
// tests/format/block-macro.test.ts.
//
// WIDER THAN THE ORACLE, knowingly: BLOCK_MACRO's name group is open
// (see its doc), while `next_block` only opens a block for a macro
// name that is registered, so `custom::t[b]` on this line is item text
// to the oracle and an interrupter here. DLIST_FIRST_LINE_INTERRUPTERS
// has carried the same looseness since it was written; both rows are
// pinned with `image::a.png[]`, the shape that is always registered.
const LIST_ITEM_FIRST_LINE_INTERRUPTERS: readonly RegExp[] = [BLOCK_MACRO];

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
 * Lines that end a LIST ITEM's LATER block: the item-text set plus
 * the block anchor. Past the first block `fold_first` (parser.rb
 * l.1384) has nothing left to merge into the item text, so an
 * `[[anchor]]` here is metadata for a block of its own and
 * `StartOfBlockOrListProc` (parser.rb l.40) breaks the paragraph at
 * it, id and all. (Oracle: `* a` / `para` / `[[anc]]` / `  lit` puts
 * the indented line in a literal block with `id="anc"`.)
 */
const LIST_ITEM_LATER_BLOCK_INTERRUPTERS: readonly RegExp[] = [
  ...LIST_ITEM_INTERRUPTERS,
  BLOCK_ANCHOR,
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
//
// Three patterns rather than one list, because the three RESOLVE
// differently: an unordered marker is its own style, a callout marker
// collapses to CALLOUT_STYLE, and an ordered one goes through
// {@link orderedMarkerStyle}.
//
// The gap lookahead is `[ \t]`, the gap `ListRxMap`'s patterns take
// (`[ \t]+`) and the one LIST_MARKER_LINE and LIST_MARKERS take. It
// used to be a single space, which made these three DISAGREE with the
// rest of the registry about a TAB-gapped marker: `listMarkerStyle`
// saw none where `interruptsByLineShape` saw one, so a tab-gapped
// sibling marker inside a `+`-attached paragraph was invisible to
// {@link isForeignMarkerLine} and to the `listContinuation` arm of
// {@link interruptsParagraph}, and the line was joined into the
// prose. Measured over 1,408 continuation shapes (8 openers x 11
// sibling markers x 4 gaps x 2 bodies x 2 widths): 316 render-breaks
// under the space-only spelling, 0 under this one, 0 regressions.
// The corruption is not the ordered families': `*`, `**`, `-`, `.`
// and `..` broke identically, so this closes a pre-existing hole
// rather than one the widened alternation opened.
const UNORDERED_MARKER_STYLE = new RegExp(
  String.raw`^(?<style>${UNORDERED_MARKER_SOURCE})(?=[ \t])`,
  "v",
);
const ORDERED_MARKER_STYLE = new RegExp(
  String.raw`^(?<style>${ORDERED_MARKER_SOURCE})(?=[ \t])`,
  "v",
);
const CALLOUT_MARKER_STYLE = new RegExp(
  String.raw`^${CALLOUT_MARKER_SOURCE}(?=[ \t])`,
  "v",
);

/** The style key every callout marker shares. */
export const CALLOUT_STYLE = "<>";

// A lowercase ASCII letter at the head of what it is asked about:
// how {@link orderedMarkerStyle} tells `i)` from `I)` and `a.` from
// `A.`.
const LOWERCASE_LETTER = /^[a-z]/v;

// A digit at the head of a marker: the arabic branch of Ruby's
// `OrderedListMarkerRxMap`, which no other explicit form can open.
const ARABIC_MARKER = /^\d/v;

// The last TWO characters of a roman marker: its final letter and the
// `)` behind it. Taking a two-character tail and testing its HEAD is
// how that letter is reached without an index that could go negative.
const ROMAN_CASE_TAIL = 2;

/**
 * The style an ORDERED marker resolves to - Ruby's
 * `resolve_ordered_list_marker` (parser.rb l.2229), which is what
 * `is_sibling_list_item?` (parser.rb l.2280) compares. The four
 * explicit families collapse onto five representatives, so `5.` and
 * `2020.` both continue a list that `1.` opened, while an implicit
 * `.` opens a NESTED one.
 *
 * An implicit marker resolves to ITSELF, run length included: Ruby
 * returns early on a leading dot, and the list's rendered numbering
 * then comes from the run's LENGTH
 * (`ORDERED_LIST_STYLES[sibling_trait.length - 1]`, parser.rb l.1343,
 * over the roster at asciidoctor.rb l.318): `.` is arabic, `..`
 * loweralpha, `...` lowerroman, `....` upperalpha, `.....`
 * upperroman.
 *
 * Total over the markers {@link ORDERED_MARKER_SOURCE} accepts, with
 * every arm reachable: a dot run, a roman marker in either case, an
 * arabic run, and a single letter in either case. Nothing here reads
 * which alternative of that pattern matched - the marker arrives as a
 * string and this decides from the string, which is why the pattern
 * can stay Ruby's spelling exactly.
 *
 * The roman case is decided by the letter BEFORE the `)` because
 * Ruby's `OrderedListMarkerRxMap` tests (rx.rb l.303) are unanchored:
 * `[ivx]+\)` finds `v)` inside `Iv)`, so `Iv)` is lowerroman, while
 * `iV)` has no lowercase letter against the `)` and falls to
 * `[IVX]+\)`. Both are oracle-pinned in
 * tests/parser/ordered-marker-style.test.ts.
 * @param marker - an ordered marker, exactly as the author wrote it
 * @returns the style key (`.`…`.....`, `1.`, `a.`, `A.`, `i)`, `I)`)
 */
export function orderedMarkerStyle(marker: string): string {
  if (marker.startsWith(".")) {
    return marker;
  }
  if (marker.endsWith(")")) {
    return LOWERCASE_LETTER.test(marker.slice(-ROMAN_CASE_TAIL)) ? "i)" : "I)";
  }
  if (ARABIC_MARKER.test(marker)) {
    return "1.";
  }
  return LOWERCASE_LETTER.test(marker) ? "a." : "A.";
}

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
 * @returns the style key (`"*"`, `"**"`, `"-"`, `"."`, `"1."`,
 *   `"<>"`, …), or undefined when the line does not begin with a list
 *   marker
 * Exported for the shape census, which reconciles this module's
 * runtime export names against the registry's coverage
 * (scripts/metrics/shape-census.ts); no src consumer.
 * @internal
 */
export function listMarkerStyle(line: string): string | undefined {
  const unordered = UNORDERED_MARKER_STYLE.exec(line)?.groups;
  if (unordered !== undefined) {
    return unordered.style;
  }
  const ordered = ORDERED_MARKER_STYLE.exec(line)?.groups;
  if (ordered !== undefined) {
    return orderedMarkerStyle(ordered.style);
  }
  return CALLOUT_MARKER_STYLE.test(line) ? CALLOUT_STYLE : undefined;
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
/**
 * Exported for the shape registry's coverage census
 * (scripts/shape-registry.ts); the one src consumer is
 * {@link conditionalDirective} below, in this file, which reads the
 * three groups. No other module imports it.
 * @internal
 */
export const CONDITIONAL_DIRECTIVE =
  /^(?<name>ifdef|ifndef|ifeval|endif)::(?<target>[^\[]*)\[(?<text>[^\]]*)\]$/v;

/**
 * `EvalExpressionRx` (rx.rb l.83): the restricted comparison an
 * `ifeval` must spell for the reader to open a region at all. A
 * transcription, not an approximation - `CC_ANY` is Ruby's `.`
 * (asciidoctor.rb l.431), and the operator set is the one the regex
 * itself enforces, "a restricted set of math-related operations"
 * (reader.rb l.973).
 *
 * NOT part of the shape registry's dimension set: it matches the TEXT
 * inside a directive's brackets, never a line.
 */
const EVAL_EXPRESSION = /^.+? *(?:[=!><]=|[><]) *.+$/v;

/**
 * What a conditional directive line does to the reader's conditional
 * stack - the stack `PreprocessorReader` pushes a region onto and
 * pops it off (reader.rb l.913-924 for the pop, l.989-1006 for the
 * two pushes).
 *
 * - `opens` - the region form: an `ifeval` with no target whose text
 *   matches {@link EVAL_EXPRESSION} (l.970-991: the match is the
 *   condition of the very branch that reaches the push), and an
 *   `ifdef`/`ifndef` with a target whose brackets are EMPTY
 *   (l.1003-1006).
 * - `closes` - an `endif` with empty brackets (l.918-920).
 * - `inert` - a directive line that moves the stack not at all: the
 *   single-line `ifdef::attr[text]` form, which replaces itself with
 *   its own text (l.992-1001), and the malformed spellings Ruby
 *   reports and returns from without touching the stack - a
 *   targetless `ifdef` or `ifndef` (l.936-939, l.952-954), an
 *   `ifeval` carrying a target (l.981-984) or one whose text is
 *   missing or not a comparison (l.977-979, whose own message says
 *   `invalid expression` for the second and `missing expression` for
 *   the first), and an `endif` carrying text (l.914-915).
 *
 * ONE RULING, written rather than implied. Ruby pops only when the
 * `endif`'s target is empty OR equal to the target of the pair on top
 * of its stack (l.918); a mismatched target logs "mismatched
 * preprocessor directive" and pops NOTHING (l.922). This answer does
 * not model targets, so `endif::other[]` closes whatever pair the
 * count has open. The reason is what the count is FOR: it feeds one
 * boolean, "does a pair the author opened still stand over this
 * line", and a mismatched `endif` is a document Ruby has already
 * called an error. Answering `inert` there would leave the count open
 * over every line to the end of the reader's stream on the strength
 * of a typo, which is the worse of the two wrong answers. Modelling
 * it properly means carrying the targets, not a depth.
 *
 * The condition itself is never evaluated here, and that is the whole
 * reason a formatter can count these lines at all: the depth this
 * answer folds into is the depth of the pairs the AUTHOR WROTE, which
 * is a property of the bytes on the page rather than of the
 * attributes a build happens to set. An `ifeval`'s EXPRESSION is a
 * different matter and is read: whether the reader pushes at all
 * turns on the text matching, not on what it evaluates to.
 * @param line - one rstripped source line
 * @returns what the line does to the stack, or undefined when the
 *   line is not a conditional directive at all
 */
export function conditionalDirective(
  line: string,
): "opens" | "closes" | "inert" | undefined {
  const groups = CONDITIONAL_DIRECTIVE.exec(line)?.groups;
  if (groups === undefined) {
    return undefined;
  }
  const { name, target, text } = groups;
  if (name === "endif") {
    return text === "" ? "closes" : "inert";
  }
  if (name === "ifeval") {
    // `no_target` and an `EvalExpressionRx` match, both, or the reader
    // logs and returns without pushing (reader.rb l.968-979). Trimmed
    // because Ruby matches the expression against `text.strip`
    // (reader.rb l.970).
    return target === "" && EVAL_EXPRESSION.test(text.trim())
      ? "opens"
      : "inert";
  }
  return target !== "" && text === "" ? "opens" : "inert";
}

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
 * Exported for the shape registry's coverage census
 * (scripts/shape-registry.ts); no src consumer.
 * @internal
 */
export const INCLUDE_DIRECTIVE = /^include::[^\[]*\[[^\]]*\]$/v;

/**
 * A line comment. A PREFIX match, not a whole-line one: `CommentLineRx`
 * is `%r(^//(?=[^/]|$))`, so everything after the `//` is the comment.
 * Exported for the shape registry's coverage census
 * (scripts/shape-registry.ts); no src consumer.
 * @internal
 */
export const LINE_COMMENT = new RegExp(`^${LINE_COMMENT_SOURCE}`, "v");

/**
 * The two characters `Reader#skip_line_comments` tests a line for
 * (`start_with? '//'`) — the one spelling of "line comment" on the
 * SCAN side, where raw LINE text is examined before nodes exist
 * (paragraph-reader.ts, src/print/list-hazard.ts, reflow.ts). The EMIT
 * side spells its own bytes (src/print/blocks.ts writes the literal
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

// Block metadata a description's FIRST line can be while STAYING in
// the description. `parse_list_item` hands the lines after the term to
// a full `next_block` (parser.rb l.1374), which reads them as the
// metadata of the description's first block (a `.T` titles that
// block, a `:a: b` sets an attribute), and `fold_first` (l.1384) then
// merges the block back into the term's text without carrying the
// title along. Reflowed onto the term the line becomes the term's own
// last words and whatever it decorated loses what it said (oracle:
// `t:: d` / `.T` / `** b` titles the nested list "T"; `t:: d .T` /
// blank / `** b` renders `d .T` and an untitled list).
//
// The third shape the item scan reads through at l.1499-1501,
// `BlockAttributeLineRx`, is deliberately absent: it is in
// SHARED_INTERRUPTERS, so a `[role]` ENDS the description and the
// interrupter check turns it away before this rule is asked.
const RAW_DESCRIPTION_METADATA: readonly RegExp[] = [
  BLOCK_TITLE,
  ATTRIBUTE_ENTRY,
];

// Contexts where a whole-line block anchor DIRECTLY after the block
// start is kept VERBATIM rather than reflowed into the text. There
// the anchor is `BlockAttributeLineRx` metadata for the item's first
// block, which `fold_first` merges into the item text — so the oracle
// emits no id at all, and reflowing the anchor into the text would
// instead emit an `<a id>` it does not have. A line further down is a
// different case entirely: it opens a SECOND block and keeps its id,
// which is why `listItem` interrupts at one unconditionally. The key
// here is `listItemText` because "the item's first block" is what
// `fold_first` is about: a count of lines within one paragraph says
// the same thing only while nothing has closed that paragraph early.
// (In `dlistItem` the interrupter check runs first, so the anchor
// ends the description there and never reaches this rule — it is
// listed for the case where that ordering ever changes.)
const RAW_BLOCK_ANCHOR_CONTEXTS = new Set<ParagraphContext>([
  "listItemText",
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
 * (src/print/reflow.ts).
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
 * `DescriptionListRx`, rx.rb:336, pinned by tests/parser/lines.test.ts's
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
  listItemText: LIST_ITEM_INTERRUPTERS,
  listItem: LIST_ITEM_LATER_BLOCK_INTERRUPTERS,
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
  listItemText: LIST_ITEM_FIRST_LINE_INTERRUPTERS,
  // Nothing: this position is the SECOND line of a block that already
  // has a first, so `next_block` has picked its context and
  // `read_paragraph_lines` is running (parser.rb l.764) under
  // `StartOfBlockOrListProc` (chosen at l.966-67, the proc itself at
  // l.40). A block macro line matches none of that proc's three
  // alternatives, so it is prose (oracle: `* item` /
  // `image::a.png[]` / `para line` / `image::a.png[]` renders one
  // paragraph, not two blocks).
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
// oracle emits no id (see BLOCK_ANCHOR). Further down THAT SAME BLOCK
// there is a first line already, so the anchor opens a second block
// and keeps its id (`* item` / `foo` / `[[a]]` / `para` renders
// `<div id="a">`). Blocks after the first hold the same anchor at
// every position, which is INTERRUPTERS_BY_CONTEXT's `listItem` row.
const LATER_LINE_INTERRUPTERS: Record<ParagraphContext, readonly RegExp[]> = {
  paragraph: NO_PATTERNS,
  listItemText: [BLOCK_ANCHOR],
  listItem: NO_PATTERNS,
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
 * @param firstLineAfterStart - see {@link ReaderContext}
 * @returns true when some applicable pattern matches
 */
function matchesInterrupter(
  line: string,
  context: ParagraphContext,
  firstLineAfterStart: boolean,
): boolean {
  const always = INTERRUPTERS_BY_CONTEXT[context];
  const byPosition = firstLineAfterStart
    ? FIRST_LINE_INTERRUPTERS
    : LATER_LINE_INTERRUPTERS;
  const positional = byPosition[context];
  const test = (pattern: RegExp): boolean => pattern.test(line);
  return always.some(test) || positional.some(test);
}

// Contexts in which a `term::` word starts a nested description list
// rather than being plain text.
const ENDED_BY_DLIST_TERM = new Set<ParagraphContext>([
  "listItemText",
  "listItem",
  "dlistItem",
]);

/**
 * Whether a line ends the open paragraph (or list item text).
 *
 * `context` stays its own parameter beside `reader`, whose
 * `openParagraph` names the same thing: the caller has already
 * narrowed the open paragraph to a definite one to be asking at all,
 * and passing the narrowing is what keeps the interrupting-set lookup
 * total without an absent case.
 * @param rawLine - one source line, without its trailing newline;
 *   trailing whitespace is trimmed here (see rstrip)
 * @param context - which kind of paragraph is open; see
 *   {@link ParagraphContext} for what each set contains
 * @param reader - the line's position in the block and the enclosing
 *   list ancestry, neither of which the line alone conveys; see
 *   {@link ReaderContext}
 * @returns true when Asciidoctor would start a new block (or item) here
 */
export function interruptsParagraph(
  rawLine: string,
  context: ParagraphContext,
  reader: ReaderContext = BLOCK_START_CONTEXT,
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
  if (matchesInterrupter(line, context, reader.firstLineAfterStart)) {
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
    return style !== undefined && style === reader.openListStyle;
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
 * Exists for reflow (src/print/reflow.ts), which decides whether a word may
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
 * each of which carries its own Ruby citation, plus
 * nothing. A section title is NOT in it: the oracle does not end a
 * paragraph at one, so the union stays exactly "what interrupts
 * somewhere" and reflow asks {@link startsSectionTitle} separately.
 * (Reflow additionally asks
 * isRawParagraphLine, because a comment or directive that a word
 * lands on destroys text without interrupting anything.)
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
 * Whether a line would START A SECTION where it stands - the second
 * question reflow asks, and the one no interrupting set answers.
 *
 * A section title does not END a paragraph in the oracle, so neither
 * spelling belongs to an interrupting set and
 * {@link interruptsByLineShape} says nothing about them. But a title
 * line reflow CREATES is a section the source did not have: `##`
 * packed in front of a following word turns the paragraph into an
 * `<h2>` and eats the text behind the marks, and `=` packed the same
 * way writes the DOCUMENT TITLE, which the renderer lifts out of the
 * body entirely. Refusing to WRITE the shape is a different question
 * from reading it - the classifier still does not read the Markdown
 * spelling (issue #63), and this answers about neither reader.
 *
 * The printer's block-start hazard nets
 * (src/print/block-start-hazard.ts) trade a
 * replayed space for a break only where the AUTHOR's source already
 * broke the line, so a title written on one line is printed back as
 * it stands and a lone `=` or `##` word in reflowed prose only ever
 * fuses backwards.
 * @param line - one source line, without its trailing newline
 * @returns true when the line is a section title in either spelling
 */
export function startsSectionTitle(line: string): boolean {
  const text = rstrip(line);
  return SECTION_TITLE_SHAPES.some((pattern) => pattern.test(text));
}

/**
 * Why a line is raw — kept verbatim and invisible to block structure.
 * The first three are consumed while READING (`skip_line_comments`,
 * `PreprocessorReader#process_line`); `anchor` is block metadata for a
 * block `fold_first` merges away, so the oracle renders no id at all.
 */
export type RawForm = "comment" | "conditional" | "include" | "anchor";

/**
 * Which raw shape a line has, of the ones the reader consumes wherever
 * they occur. The block anchor is NOT here: it is raw only in the
 * contexts {@link isRawParagraphLine} names.
 *
 * Declared HERE rather than in lines/classify.ts because this file
 * owns all three patterns the answer is read off — the classifier
 * merely names the result, and having the test live a layer above its
 * own regexes made the builders import upwards to reach it.
 * @param line - one rstripped source line
 * @returns the raw form, or undefined for an ordinary line
 */
export function rawLineForm(
  line: string,
): Exclude<RawForm, "anchor"> | undefined {
  if (LINE_COMMENT.test(line)) {
    return "comment";
  }
  if (CONDITIONAL_DIRECTIVE.test(line)) {
    return "conditional";
  }
  return INCLUDE_DIRECTIVE.test(line) ? "include" : undefined;
}

/**
 * Whether a line inside a paragraph must be kept verbatim rather than
 * treated as reflowable text: a comment or preprocessor line
 * anywhere, a whole-line block anchor inside a list item's first
 * block (see RAW_BLOCK_ANCHOR_CONTEXTS), block metadata on a
 * description's first line (see RAW_DESCRIPTION_METADATA), and a
 * foreign list marker inside a `+`-attached paragraph (see
 * isForeignMarkerLine).
 * @param rawLine - one source line, without its trailing newline;
 *   trailing whitespace is trimmed here (see rstrip)
 * @param context - the open paragraph's context; omit for the
 *   context-free preprocessor shapes alone
 * @param reader - the line's position in the block and the enclosing
 *   list ancestry: the anchor rule applies on the first line after
 *   the block start alone, and the marker rule needs to know which
 *   list is open (see {@link ReaderContext})
 * @returns true for line comments, conditional directives, includes,
 *   and the three context-dependent shapes
 */
export function isRawParagraphLine(
  rawLine: string,
  context?: ParagraphContext,
  reader: ReaderContext = BLOCK_START_CONTEXT,
): boolean {
  const line = rstrip(rawLine);
  if (PARAGRAPH_RAW_LINES.some((pattern) => pattern.test(line))) {
    return true;
  }
  if (context === undefined) {
    return false;
  }
  if (context === "listContinuation") {
    return isForeignMarkerLine(line, reader);
  }
  // Both remaining shapes are about the FIRST line after a block
  // start, and for one reason: that is the line `next_block` reads to
  // pick the block's context and to collect its metadata
  // (parser.rb l.1374). From the second line on `read_paragraph_lines`
  // is running and knows none of them.
  if (!reader.firstLineAfterStart) {
    return false;
  }
  if (
    context === "dlistItem" &&
    RAW_DESCRIPTION_METADATA.some((pattern) => pattern.test(line))
  ) {
    return true;
  }
  return RAW_BLOCK_ANCHOR_CONTEXTS.has(context) && BLOCK_ANCHOR.test(line);
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
 * @param reader - the open list's style; a marker of that style
 *   interrupts instead and never reaches this rule
 * @returns true when the line must keep its own output line
 */
function isForeignMarkerLine(line: string, reader: ReaderContext): boolean {
  if (reader.openListStyle === undefined) {
    return false;
  }
  const style = listMarkerStyle(line);
  return style !== undefined && style !== reader.openListStyle;
}
