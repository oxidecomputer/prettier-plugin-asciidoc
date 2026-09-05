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

import type { DescriptionDelimiter } from "../ast.js";

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
 * - `dlistItemTextOnly` - the description of a term line that
 *   carries NO text of its own (`term::`, the description on the
 *   lines below). `parse_list_item` passes `text_only: has_text ?
 *   nil : true` (parser.rb l.1367-74). `next_block` reads `text_only`
 *   at FOUR points and TWO of them decide an interrupting set: the
 *   layout-break arm is skipped (`!textOnly && layoutBreakChars[ch0]`,
 *   index.cjs l.10991) and so is the admonition arm, which the
 *   paragraph branch reaches only past `if (textOnly)` (index.cjs
 *   l.11282). The other two do not reach this table. One chooses
 *   whether an indented run's `//` lines are comments
 *   (`skip_line_comments: !!textOnly`, index.cjs l.11260), which the
 *   reader carries as the description's `comments` fact instead
 *   (lines/list-read.ts). One chooses paragraph over literal for an
 *   indented line (`textOnly || contentAdjacent === 'dlist'`,
 *   index.cjs l.11263), and it cannot decide anything here because
 *   `contentAdjacent` is already `'dlist'` whenever `textOnly`
 *   survives to be read - `if (textOnly && skipped > 0)` nulls it
 *   otherwise (index.cjs l.10878-81).
 *   So what is left for the SETS is `dlistItem`'s ANY-LINE set with
 *   its FIRST-LINE set narrowed to the one shape those two
 *   exemptions leave standing, a block macro. ORACLE,
 *   probed under `term1::`: a block macro, a delimiter, a list
 *   marker, a sibling term and an `[[anchor]]` end it; an admonition
 *   label, `'''`, `<<<` and a Markdown rule do not. The anchor ends
 *   it because `parse_block_metadata_line` runs AHEAD of the ladder
 *   and is gated by nothing: it takes the anchor as metadata for a
 *   block of its own, and that block is outside the item (the
 *   description's `<dd>` is gone and the paragraph below carries the
 *   `id`).
 * - `literalParagraph` — the indented lines of a literal paragraph.
 *   `next_block`'s `indented && !style` branch calls
 *   `read_paragraph_lines reader, (skipped == 0 ? options[:list_type]
 *   : nil)`, so at document level `break_at_list` is nil and the set
 *   is exactly the plain-paragraph one (`StartOfBlockProc`). It is a
 *   context of its own rather than an alias for `paragraph` because
 *   the READER treats the lines differently (verbatim, not reflowed)
 *   and because inside a DESCRIPTION item one more line ends it: the
 *   item scan slurps an indented run through a `read_lines_until`
 *   that breaks at a sibling term, and passes that break for a dlist
 *   alone (parser.rb l.1490-1495). That half of the row lives in
 *   line-shapes-interruption.ts, where the enclosing list is read.
 * - `verbatimStyled` — a paragraph opened under a held VERBATIM
 *   style (`[source]`, `[listing]`, `[literal]`, `[verse]` —
 *   VERBATIM_STYLES, asciidoctor.rb:276; NOT `[pass]`, oracle-pinned).
 *   Behavior AT DOCUMENT LEVEL is `read_lines_until
 *   break_on_blank_lines: true, break_on_list_continuation: true`
 *   (parser.rb:1026-1028): blank lines are structural to the reader,
 *   so the set is the lone `+` and nothing else. The `+` holds at
 *   every position because Ruby's `line_read` gate (reader.rb:414 and
 *   l.426) is false only for the styled block's OPENING line, which
 *   Ruby unshifts (parser.rb:565) and our reader consumes at open, so
 *   every position this classifier sees corresponds to `line_read ===
 *   true`. INSIDE A LIST ITEM the answer is a different set entirely,
 *   because the item scan has already cut the buffer; that reading
 *   lives in line-shapes-interruption.ts. Pinned against the oracle
 *   at document level, both positions, in
 *   tests/conformance/interruption.test.ts, and in every reachable
 *   state by tests/conformance/reader-context-grid.test.ts.
 */
export type ParagraphContext =
  | "paragraph"
  | "listItemText"
  | "listItem"
  | "listContinuation"
  | "dlistItem"
  | "dlistItemTextOnly"
  | "literalParagraph"
  | "verbatimStyled";

/**
 * The list a confined reader is inside, in the two kinds Asciidoctor
 * tells apart when it asks whether a line is a sibling of it
 * (`is_sibling_list_item?`, parser.rb l.2280-2285): a marker list
 * carries the marker STYLE its items share, and a description list
 * carries the term DELIMITER its items share. The two are matched by
 * different grammars - `ListRxMap` plus `resolve_list_marker` for a
 * marker, `DescriptionListSiblingRx` keyed on the delimiter for a
 * term (rx.rb l.340-345) - so the kind has to travel with the value
 * rather than be guessed back out of it.
 */
export type OpenList =
  | {
      /** A ulist, olist or colist. */
      readonly kind: "marker";
      /** The style its items share (see {@link listMarkerStyle}). */
      readonly style: string;
    }
  | {
      /** A description list. */
      readonly kind: "description";
      /** The term delimiter its items share. */
      readonly delimiter: DescriptionDelimiter;
    };

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
   * The list open around the block, if any (`is_sibling_list_item?`).
   * 0-or-1 BY CONSTRUCTION: a confined reader carries exactly its own
   * item's list, and the physically-truncated buffer is the rest of
   * the old ancestry argument. undefined means no list is open, so no
   * sibling line ends the paragraph.
   */
  readonly openList: OpenList | undefined;
  /**
   * Whether this line is the FIRST one after the open block started.
   * Some shapes only mean anything there — see
   * FIRST_LINE_INTERRUPTERS and LATER_LINE_INTERRUPTERS, and the
   * matching rule in {@link isRawParagraphLine}.
   */
  readonly firstLineAfterStart: boolean;
  /**
   * The line BELOW this one, where a two-line construct may be read,
   * and undefined everywhere one may not. The only such construct is
   * the setext section title, and the only position Asciidoctor reads
   * one at is a SECTION's own block start: `is_next_line_section?`
   * (parser.rb l.1667) is asked from `next_section`'s loop, while a
   * list item's buffer and a compound block's interior go through
   * `parse_blocks` -> `next_block`, which never asks. So a confined
   * reader supplies undefined here and gets `next_block`'s ladder
   * unchanged (scope.ts), and so does every position inside an open
   * paragraph.
   */
  readonly nextLine: string | undefined;
}

/**
 * The context at a plain block start (document level, nothing open).
 * The default reader every registry rule falls back to, which is what
 * line-shapes-interruption.ts hands `interruptsParagraph`'s callers
 * when they name no state of their own.
 */
export const BLOCK_START_CONTEXT: ReaderContext = {
  openParagraph: undefined,
  openList: undefined,
  firstLineAfterStart: false,
  nextLine: undefined,
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
  return line.slice(0, end);
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
 * The class Ruby's `BlockAttributeLineRx` requires of the FIRST
 * character inside a block-attribute line's brackets - kept in sync
 * with {@link BLOCK_ATTRIBUTE_LINE_SOURCE} by hand rather than
 * derived from it (that source is a whole line's pattern; this is
 * only its head), because attrlist.ts asks the narrower question
 * before printing a quoted first entry bare: unquoting it to a value
 * starting outside this class would change whether the WHOLE LINE
 * still reads as an attribute line, not just which value it names
 * (measured: `` [`d`] `` and `[*bold*]` read as ordinary text,
 * `["d"]` and `[.role]` do not).
 */
export const ATTRLIST_LEADING_CHARACTER = /[\w.#%\{,"']/v;

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
  // `~~~~`, a SECOND key that opens the same "open" content model as
  // `openBlock` (`DELIMITED_BLOCKS['~~~~']`, masquerades `abstract`
  // and `partintro`), absent from the vendored Ruby entirely: the
  // oracle's semantics win over the missing entry (issue #64).
  // Its own kind rather than a wider `openBlock` pattern because the
  // registry is one row per `DELIMITED_BLOCKS` key (see this array's
  // own doc comment), and `resolveDelimitedOpen`
  // (lines/open-style.ts) reads which key matched to keep a style
  // from masquerading a spelling the printer cannot replay at any
  // length but its own.
  "openBlockTilde",
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
  // `DELIMITED_BLOCKS['~~~~']` (`@asciidoctor/core/build/node/index.cjs`
  // l.1108) is absent from the vendored Ruby, so this row cites the
  // bundle rather than parser.rb: `isDelimitedBlock` (index.cjs
  // l.13262-13303) tail-matches a longer run the same uniform way
  // `----` and the rest do, which is why this is `~{4,}` and not the
  // fixed two-character spelling `openBlock` above is.
  openBlockTilde: String.raw`~{4,}`,
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

// The suffix that carries an attribute entry's VALUE onto the line
// below: `LINE_CONTINUATION` (` \`) or the legacy spelling ` +` it
// shares with a hard line break (asciidoctor.rb l.335-339), tested by
// `process_attribute_entry` with `value.end_with?` (parser.rb l.2107).
// A SPACE before the mark, never a tab, and the two characters are
// one unit: `end_with?` decides the whole suffix, and the same suffix
// then has to match on every line the value runs onto (l.2111), which
// is why the group is the PAIR rather than the mark alone.
//
// Matched against the entry's value, not against the line: `:a: \`
// ends in ` \` as a LINE while its value is the single character `\`
// (`AttributeEntryRx` above eats the run of blanks after the colon),
// and Asciidoctor continues nothing there.
//
// A registry row with a named predicate and no `LineKind` arm (see
// "Line-Shaped Constructs" in docs/coding-standards.md): the shape
// neither opens nor ends a block, and the only caller is a reader
// asking about a line it has already read as an attribute entry, so
// the classifier's verdict does not change and an interruption row
// would pin a column of identical answers.
export const ATTRIBUTE_CONTINUATION = /(?<suffix> [\\+])$/v;

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
  openBlockTilde: wholeLine(DELIMITER_SOURCES.openBlockTilde),
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
 * `listContinuation` paragraph, which adds the open list's own
 * siblings (line-shapes-interruption.ts).
 */
export const PARAGRAPH_INTERRUPTERS: readonly RegExp[] = [
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
//
// The bullet is a SINGLE character, not a run: Ruby's alternative is
// the bare `\u2022` where its neighbours are `\*\**` and `-`, so
// `\u{2022}\u{2022}` is text. `resolve_list_marker` hands a ulist
// marker back unchanged (parser.rb l.2194-2195), so the bullet is its
// own sibling trait and nests against `*` and `-` the way those two
// nest against each other.
const UNORDERED_MARKER_SOURCE = String.raw`\*{1,5}|-|\u{2022}`;
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
export const LIST_ITEM_INTERRUPTERS: readonly RegExp[] = [
  ...SHARED_INTERRUPTERS,
  ...LIST_MARKERS,
];

/**
 * A one-line (ATX) section title, in BOTH marker spellings the oracle
 * accepts: the AsciiDoc `== Section` (the document title `= Doc`
 * included, its level being 0) and the Markdown `## Section`.
 *
 * Mirrors `ExtAtxSectionTitleRx`
 * (`/^(=={0,5}|##{0,5})[ \t]+(CC_ANY+?)(?:[ \t]+\1)?$/`, rx.rb l.244
 * and `@asciidoctor/core/build/node/index.cjs` l.266), which is what
 * `atx_section_title?` matches with under `markdown_syntax`
 * (parser.rb l.1709-13; the pinned oracle has no other path,
 * index.cjs l.12631-40). Each alternative is one marker character
 * followed by up to five more, so `level = markers.length - 1`
 * whichever one participated.
 *
 * ONE PATTERN for the two spellings, not two: the level arithmetic,
 * the title capture and the closed form are the same rule, and a
 * second pattern would be a second place for any of them to drift.
 * The two alternatives are disjoint by first character, so exactly
 * one ever participates.
 *
 * The CLOSED form (`== T ==`) is carried here where it used to be
 * left out, because the TITLE is what the closing run changes and
 * the printer replays the title: Ruby's optional trailing `\1` takes
 * the closing run off `$2`, and a `# Doc #` whose title kept the
 * trailing `#` would be reprinted `= Doc #` - a different heading
 * from the one the author wrote. The run must repeat the OPENING
 * markers exactly, so `== T ===` keeps all of `T ===` as its title,
 * which the pattern decides by backtracking rather than by a rule of
 * its own.
 */
export const SECTION_TITLE =
  /^(?<markers>={1,6}|#{1,6})[ \t]+(?<title>.+?)(?:[ \t]+\k<markers>)?$/v;

/**
 * `SETEXT_SECTION_LEVELS` (asciidoctor.rb l.262-268) as one string:
 * the underline mark of level N is the character at index N, so `=`
 * underlines a level-0 title and `+` a level-4 one.
 *
 * ONE spelling of the five marks, read by {@link SETEXT_UNDERLINE}'s
 * own doc and by the classifier's level lookup; the pattern below is
 * held to it, mark by mark, in tests/parser/lines.test.ts.
 */
export const SETEXT_LEVEL_MARKS = "=-~^+";

/**
 * The UNDERLINE of a two-line (setext) section title: a uniform run
 * of one {@link SETEXT_LEVEL_MARKS} character. Mirrors the first two
 * tests of `setext_section_title?` (parser.rb l.1722-24) -
 * `SETEXT_SECTION_LEVELS[line2.chr]` and `uniform? line2, line2_ch0,
 * line2_len` - which the pinned oracle spells the same way
 * (`@asciidoctor/core/build/node/index.cjs` l.12650-58).
 *
 * NOT A LINE SHAPE ON ITS OWN, and that is the point: an underline
 * means nothing without the line above it, so the third and fourth
 * tests (the title line, and a length within one character of it)
 * live with the two-line parse in src/parse/lines/classify.ts. What
 * this pattern answers alone is reflow's question - may a word be
 * WRITTEN at the start of a line? - where the line above is whatever
 * the packer already emitted and any such word could complete a
 * heading the source never had.
 */
export const SETEXT_UNDERLINE = /^(?<mark>[=\-~^+])\k<mark>*$/v;

/**
 * The TITLE line of a two-line section title: `SetextSectionTitleRx`
 * (rx.rb l.248, `/^((?!\.)CC_ANY*?CG_ALNUM CC_ANY*)$/`) - a line that
 * does not open with `.` and carries at least one alphanumeric.
 *
 * Ruby's group spans the WHOLE line, so the title text is the
 * rstripped line itself and no consumer slices it. Its alphanumeric
 * is `CC_ALNUM`, `\p{Alphabetic}\p{N}` in the pinned oracle
 * (index.cjs l.49), which `CG_ALNUM` wraps in a class one line down.
 */
export const SETEXT_TITLE_LINE = /^(?!\.).*[\p{Alphabetic}\p{N}].*$/v;

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
 * A block macro line (`image::a.png[]`, `video::a.mp4[]`,
 * `audio::a.mp3[]`, `toc::[]`): the four names `next_block` opens a
 * block for BY DEFAULT. It reaches `BlockMediaMacroRx` (rx.rb l.421,
 * `image|video|audio`) and `BlockTocMacroRx` (rx.rb l.430, `toc`)
 * unconditionally for a line ending in `]` that contains `::`
 * (parser.rb l.598-599, l.642); a fifth branch reaches
 * `CustomBlockMacroRx` (rx.rb l.412, any name) but only when
 * `extensions.block_macros?` holds, i.e. some extension registered a
 * custom block macro (parser.rb l.647-649,
 * `extensions.registered_for_block_macro? $1`), and this formatter
 * (like the pinned oracle's own test harness) registers none, so an
 * unregistered name never opens a block macro; what the line becomes
 * instead depends on what else classifies it (issue #183; recorded
 * and left unnarrowed at #51 before the ATX heading vocabulary in
 * #63 made the gap visible: a false block start now hands its next
 * line to a block-opening vocabulary that never used to see it).
 *
 * `toc` carries NO target: `BlockTocMacroRx` is `/^toc::\[...\]$/`,
 * so `toc::x[]` matches neither rx and falls through as paragraph
 * text (measured against the pinned oracle: 4.0.11 renders it as a
 * `<p>`). The three media names require a NON-EMPTY target whose
 * first and last characters are not whitespace (`\S|\S.*?\S`), so
 * `image::[]` (an empty target) falls through the same way and is
 * paragraph text too; `image:: a.png[]` (a space right after `::`)
 * instead falls through to `DescriptionListRx` (parser.rb l.704,
 * `this_line.include? '::'`), which reads it as a description-list
 * term (`image`) and description (`a.png[]`), not as paragraph text.
 * `[^\s\[\n]` here is that non-whitespace boundary read against the
 * target's existing bracket exclusion, not a new restriction.
 */
// `mediaName`/`mediaTarget` rather than a `name`/`target` pair shared
// with the `toc` branch: engines vary on whether a named group may
// repeat across alternatives of a disjunction (a duplicate that
// measured fine against the oracle build threw `SyntaxError: ...
// Duplicate capture group name` under the pinned CI runtime), so the
// media branch keeps its own group names and the `toc` branch
// captures nothing - `toc::` is a fixed literal parseBlockMacro
// (classify.ts) reads straight off the line, not out of a group.
export const BLOCK_MACRO =
  /^(?:(?<mediaName>image|video|audio)::(?<mediaTarget>[^\s\[\n](?:[^\[\n]*[^\s\[\n])?)|toc::)\[(?<attrlist>[^\]\n]*)\]$/v;

/**
 * A thematic break, in both spellings `next_block` reads: the
 * AsciiDoc `'''` and the Markdown rules `---`, `***`, `___` and
 * `_ _ _`.
 *
 * The AsciiDoc arm mirrors `next_block`'s `LAYOUT_BREAK_CHARS` lookup
 * (asciidoctor.rb l.300-303) guarded by `uniform?` and a length
 * greater than two. The Markdown arm mirrors the other half of
 * `HYBRID_LAYOUT_BREAK_CHARS` (l.305-311), which `next_block` reaches
 * through `ExtLayoutBreakRx` (rx.rb l.650,
 * `/^(?:'{3,}|<{3,}|([-*_])( *)\1\2\1)$/`) at column 0 and through
 * `MarkdownThematicBreakRx` (rx.rb l.638, `/^ {0,3}([-*_])( *)\1\2\1$/`)
 * from its `this_line.start_with? ' '` arm (parser.rb l.575-585). The
 * page-break alternative of `ExtLayoutBreakRx` is {@link PAGE_BREAK}.
 *
 * THREE MARKS EXACTLY, where the AsciiDoc arm takes a run: a fourth
 * `-`, `*` or `_` makes a `DELIMITED_BLOCKS` key (`----`, `****`,
 * `____`), and `is_delimited_block?` runs ahead of the break arm.
 * Three characters are below its tip length, so it refuses them
 * (parser.rb l.985-1005) and the break arm gets the line.
 *
 * The Markdown arm's indent is SPACES ONLY, at most three, because a
 * tab-led line takes `next_block`'s `TAB` arm, which never asks the
 * question; the AsciiDoc arm takes no indent at all, because the
 * indented arm only looks up `MARKDOWN_THEMATIC_BREAK_CHARS`.
 *
 * SPACED MARKS, which the two rx above also read (`- - -`,
 * `_  _  _`), are read HERE FOR `_` AND NOT FOR `-` OR `*`. The line
 * is not what separates them; the open list is. A spaced `-` or `*`
 * form is simultaneously an `UnorderedListRx` marker line, and
 * `parse_list`'s own loop (parser.rb l.1119) never reaches
 * `next_block`: it keeps the line inside the list, where the ORACLE
 * gives `* a` / `- - -` / `* b` a NESTED `ul` holding the item `- -`
 * and `* a` / `* * *` / `* b` three sibling items. Reading either as
 * a break would split the list with a rule instead. `_` is no
 * unordered marker, so no list can claim it: the oracle renders
 * `* a` / `_ _ _` / `* b` as one item whose text is `a _ _ _`, which
 * is what this parser already does with it, and at a block start it
 * renders the `<hr>` this pattern now reads.
 *
 * WHAT THE TWO EXCLUDED SPELLINGS STILL COST is a live render loss,
 * not a tidy gap: `- - -` or `* * *` above prose is reflow-joined
 * into it and the `<hr>` leaves the render, exactly as `---` did.
 * Closing it needs `parse_list`'s marker rule rather than this
 * pattern, which is issue #182; the `gap:md-thematic-break` ledger
 * family stands for it (scripts/block-structure-ledger.ts).
 *
 * THE `_` ARM IS THE FIRST ROW IN THIS REGISTRY WHOSE MATCH DEPENDS
 * ON INTERIOR SPACING, and the printer's whitespace fold normalizes
 * interior spacing. A line the oracle reads as TEXT (`_ _  _`, an
 * unequal gap) would fold to one this arm reads as a break, moving
 * the render on the first pass and then normalizing to `'''` on the
 * second. The refusal that stops it is the fold's, not this
 * registry's: `fuseRunsSpellingABreak` (src/print/whitespace-fold.ts)
 * keeps such a run's bytes, and asks the ORACLE's question - all
 * three marks - rather than this pattern's, so it covers the `-` and
 * `*` spellings this arm excludes as well.
 */
export const THEMATIC_BREAK =
  /^(?:'{3,}| {0,3}(?:(?<mark>[\-*])\k<mark>\k<mark>|_(?<gap> *)_\k<gap>_))$/v;

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

/**
 * The one shape that ends a ulist/olist/colist item ONLY on the line
 * directly after the marker line. `parse_list_item` hands the item's
 * collected lines to `next_block`, which reads the block's first line
 * to pick a context; `fold_first` then merges that block back into the
 * item text only when it came out a plain paragraph. A block macro
 * gives `next_block` a macro block, which `fold_first` refuses, so the
 * item text ends at the marker line. Further down there is a first
 * block already and the macro line is just paragraph text, the same
 * first-line/later split BLOCK_ANCHOR has, mirrored.
 *
 * Core 2.0.20 folded the macro in at BOTH positions; core 2.0.26 (the
 * `@asciidoctor/core` 4.0.11 transpile, the pinned oracle) splits at
 * the first. The probe is the arbiter for which Ruby line moved, and
 * it is pinned in tests/conformance/interruption.test.ts: the
 * `listItem, first line` / `block macro` row of "line-shape registry
 * matches the Asciidoctor oracle", plus the round-trip row of the
 * same name in "the formatter round-trips every construct in every
 * context". Direct pins live in tests/parser/list-reader.test.ts and
 * tests/format/block-macro.test.ts.
 *
 * BLOCK_MACRO's name group now holds only the names `next_block`
 * opens a block for by default (see its doc), so `custom::t[b]` on
 * this line is item text to the oracle AND to this reader alike; both
 * this row and DLIST_FIRST_LINE_INTERRUPTERS are pinned with
 * `image::a.png[]`, one of the registered shapes.
 */
export const LIST_ITEM_FIRST_LINE_INTERRUPTERS: readonly RegExp[] = [
  BLOCK_MACRO,
];

/**
 * Shapes that end a dlist description ONLY on the first line after
 * the term. `parse_list_item` hands those lines to `next_block`,
 * which reads `this_line` (the block's first line) to pick a block
 * context: an admonition label, a block macro, a break. Once it has
 * settled on "normal paragraph" the rest of the lines go through
 * `read_paragraph_lines`, whose break condition no longer knows any
 * of them. The oracle agrees in both positions: `term1:: desc` /
 * `NOTE: x` splits, `term1:: desc` / `more` / `NOTE: x` does not.
 */
export const DLIST_FIRST_LINE_INTERRUPTERS: readonly RegExp[] = [
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
export const LIST_ITEM_LATER_BLOCK_INTERRUPTERS: readonly RegExp[] = [
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
export const DLIST_ITEM_ANY_LINE_INTERRUPTERS: readonly RegExp[] = [
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
 *
 * ONE src consumer asks the same question without this pattern, and
 * it is sanctioned rather than an oversight: the table scan
 * (src/parse/lines/table-reader.ts) spells `skip_comments`'s own two
 * prefix tests as two local constants, because reader.rb:424 IS two
 * prefix tests (`//` taken, `///` left) and that line, not a pattern,
 * is where the rule the scan needs lives. Any OTHER src consumer
 * deciding whether a line is a comment to the parser reaches for this
 * constant.
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

/**
 * The YAML front-matter fence, and a whole line rather than a
 * pattern: `skip_front_matter!` compares the prepared line to the
 * literal `---` at both ends of the block (reader.rb l.1305, l.1310),
 * so there is no regex to mirror and none is written here.
 *
 * It takes no `LineKind` arm and no interruption row, and unlike
 * every other whole-line spelling in this file it is not a line SHAPE
 * at all: the same three characters are ordinary text everywhere but
 * the top of a document, and what makes them a fence is the POSITION
 * plus a second fence below (src/parse/lines/front-matter.ts). Its
 * one consumer is the document reader, which may import it because it
 * is a string and not a pattern - see the pattern-import rule in
 * tests/parser/architecture.test.ts.
 */
export const FRONT_MATTER_FENCE = "---";

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
// The delimiter is FOUR branches, longest colon run first, which is
// Ruby's `(:::{0,2}|;;)` alternative for alternative: the engine
// tries `::::`, then `:::`, then `::` at each term length, exactly as
// a greedy `:{2,4}` would. The branches are what makes the delimiter
// a DescriptionDelimiter without an assertion - the spelling is read
// off the branch that participated, never re-derived from the
// captured text. Three of the four are NAMED; `;;` is what is left
// when no colon branch participated, so a group there would be one
// nothing reads. The named groups are what parseDescriptionListLine
// hands the classifier; isDescriptionListLine only asks whether there
// is a match at all.
//
// EXPORTED, unlike most patterns here, and to exactly one reader:
// line-shapes-description.ts holds the parse that rides these groups
// out. The pattern stays here because interruptsParagraph below asks
// isDescriptionListLine itself, and a registry module that imported
// this file back would close an import cycle src/parse does not
// admit.
export const DESCRIPTION_LIST_LINE =
  /^(?!\/\/[^\/])[ \t]*(?<term>[^ \t][^\n]*?)(?:(?<colons4>::::)|(?<colons3>:::)|(?<colons2>::)|;;)(?:$|[ \t]+(?<description>[^\n]*))$/v;

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
 * Whether a line's SHAPE would start a new block in ANY context —
 * the union of every {@link ParagraphContext}'s pattern set, which is
 * DLIST_ITEM_INTERRUPTERS: it already carries the plain-paragraph set,
 * the list markers a sibling item or a `+`-continuation breaks at, and
 * the block anchor, so no context contributes a pattern it lacks. The
 * enclosing-list rules in line-shapes-interruption.ts add no pattern
 * either: what they test with a pattern is a delimiter line and a
 * sibling MARKER line, both members already. A sibling TERM line is
 * not a member and is not meant to be - it is the word-based rule the
 * paragraph below excludes on purpose, and the sibling rules reach it
 * through the description grammar rather than through this union.
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
 *
 * Its src readers are {@link startsBlockAtLineStart} and
 * {@link endsDescriptionLine}'s probe, both below and both in this
 * file. It stays EXPORTED for the two suites that import it - the one
 * holding the model to the oracle construct by construct
 * (tests/conformance/interruption.test.ts) and the one pinning the
 * two probe spellings the line-end predicate reads it in
 * (tests/parser/description-list.test.ts); no src module outside this
 * file imports it.
 * @internal
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
 * from reading it: the classifier reads both marker spellings, and
 * this answers about neither reader.
 *
 * The printer's block-start hazard nets
 * (src/print/block-start-hazard.ts) trade a
 * replayed space for a break only where the AUTHOR's source already
 * broke the line, so a title written on one line is printed back as
 * it stands and a lone `=` or `##` word in reflowed prose only ever
 * fuses backwards.
 * @param line - one source line, without its trailing newline
 * @returns true when the line is a section title in either spelling
 *
 * Its src readers are {@link startsBlockAtLineStart} and
 * {@link endsDescriptionLine}'s probe, both below and both in this
 * file. It stays EXPORTED for the shape census, which reconciles this
 * module's runtime export names against the registry's coverage and
 * carries a row for this one (scripts/metrics/shape-census.ts); no
 * src module imports it.
 * @internal
 */
export function startsSectionTitle(line: string): boolean {
  return SECTION_TITLE.test(rstrip(line));
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
  // The context-free caller's answer, and the NARROWING the three
  // context-dependent rules below need: `RAW_BLOCK_ANCHOR_CONTEXTS`
  // is a `Set<ParagraphContext>`, so the last line does not compile
  // while `context` may still be undefined. Reading it as a
  // redundant restatement of the fall-through misses that; it is
  // also the hot path, taken by every context-free call.
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
 * NO open list means none is open, i.e. a `+` at the top level,
 * where `read_lines_for_list_item` never runs and `within_nested_list`
 * does not exist. There the marker-shaped line is ordinary text with
 * nothing riding on its column, so the rule must stay out of the way
 * (holding it back made `+` / `para` / `* item` / `more` reflow
 * differently on each pass).
 * @param line - one rstripped source line
 * @param reader - the list open around the block; a SIBLING of that
 *   list interrupts instead and never reaches this rule
 * @returns true when the line must keep its own output line
 */
function isForeignMarkerLine(line: string, reader: ReaderContext): boolean {
  const { openList } = reader;
  if (openList === undefined) {
    return false;
  }
  const style = listMarkerStyle(line);
  if (style === undefined) {
    return false;
  }
  // A marker line inside a DESCRIPTION item is foreign whatever its
  // style: no marker spells a term delimiter, so `is_sibling_list_item?`
  // (parser.rb l.2280-2285) can never take one for a sibling there.
  return openList.kind === "description" || style !== openList.style;
}

// Stands in for "whatever word comes next", so the registry can be
// asked about a word that STARTS a line rather than one alone on it.
// Any non-blank, non-syntactic text does; the marker patterns only
// require that something follow the space.
const PROBE_SUFFIX = "x";

// The mirror of PROBE_SUFFIX, so the registry can be asked about a
// word that ENDS a line rather than one alone on it. Any non-blank,
// non-syntactic text does; what it has to supply is a preceding word,
// because the shapes that turn on a line's last word ({@link
// BLOCK_MACRO} above all) are whole-LINE patterns and read nothing
// about the text in front of that word beyond its being there.
const PROBE_PREFIX = "p";

/**
 * Whether a word written at the START of a line would be re-read there
 * as the opening of a new block, as a section title, or as a line the
 * preprocessor eats. It is the question a caller assembling output
 * lines must ask of every head it is about to write.
 *
 * A DIFFERENT question from {@link interruptsParagraph}'s, and the
 * difference is the point. The reader asks "does this line end the
 * block", to which a comment or preprocessor directive answers no (the
 * reader consumes it before block structure exists), and a section
 * title answers no as well (a paragraph swallows one mid-block). This
 * asks "may this word begin a line", and there the same shapes answer
 * yes for a different reason: `//` at column 0 comments out everything
 * written after it, `ifdef::x[]` swallows it into a directive, and `=`
 * or `##` in front of a word writes a heading the source never had.
 * Text destroyed is text destroyed, whether by a new block, by a
 * section the author did not write, or by the preprocessor. So the
 * interrupting shapes, the SECTION TITLES and the RAW ones all count.
 *
 * A SETEXT UNDERLINE counts for the same reason and from the other
 * end: `----` or `~~~~` written alone on a line makes a heading out
 * of whatever line the packer emitted ABOVE it, and the text of that
 * line becomes a title. This is the one shape whose reading is
 * decided by a neighbour, and the refusal is deliberately blind to
 * that neighbour: it holds the word off a line start whatever stands
 * above, which over-refuses (the length rule may not have been met)
 * and costs a break rather than a heading nobody wrote.
 *
 * Asked in both spellings a head can take, because the caller does not
 * know which kind of line it is building and the patterns here are
 * whole-LINE ones:
 *
 * - the head alone on a line (`----`, `[source]`, `[[a]]`),
 * - the head starting a line that continues (`* `, `. `, `<1> `,
 *   `NOTE: ` all require that trailing text to match, and the caller
 *   would supply it with the very next word).
 *
 * The second probe is exact for a single WORD and conservative for a
 * head that already carries a space: appending `PROBE_SUFFIX` to such
 * a head asks about a line one word longer than the caller would
 * write. It can therefore only over-refuse, never under-refuse, and
 * over-refusing costs a break the output did not need rather than a
 * document the reader loses.
 * @param word - the head of a line: a single whitespace-delimited
 *   token, or several words with the spaces between them
 * @returns true when the head would start a block, start a section, or
 *   be eaten by the preprocessor at line start
 */
export function startsBlockAtLineStart(word: string): boolean {
  // The head alone, then the head with a successor after it - the two
  // lines a caller can produce from it. A head that is already several
  // words makes the second probe conservative rather than exact; see
  // the note above.
  const startingALine = `${word} ${PROBE_SUFFIX}`;
  return (
    interruptsByLineShape(word) ||
    interruptsByLineShape(startingALine) ||
    startsSectionTitle(word) ||
    startsSectionTitle(startingALine) ||
    SETEXT_UNDERLINE.test(rstrip(word)) ||
    isRawParagraphLine(word) ||
    isRawParagraphLine(startingALine)
  );
}

/**
 * The block heads Asciidoctor opens a block on and this registry's
 * classifier files as TEXT. A description's join is the first pass
 * that can lose one: our reader kept such a line where it stood and
 * the render agreed, and a run that swallows it does not.
 *
 * THE FIRST PATTERN CLOSES A CLASS BY SHAPE, which is what an
 * enumeration of spellings could not do. Every delimiter Asciidoctor
 * opens a block on is a UNIFORM RUN of one non-alphanumeric character
 * - `DELIMITED_BLOCKS` (asciidoctor.rb l.278-292) is `--`, `----`,
 * `....`, `====`, `****`, `____`, `++++`, `////` and the fence, and
 * the layout breaks (`LAYOUT_BREAK_CHARS` l.300-303) and markdown
 * rules (`MARKDOWN_THEMATIC_BREAK_CHARS` l.305-308) are runs of one
 * character too, the rule's optional interior spacing included. The
 * four table delimiters `|===`, `,===`, `:===` and `!===` are the
 * only entries of those three tables that are NOT uniform, and this
 * registry models all four. One more non-uniform block opener stands
 * outside them and is modelled elsewhere: {@link BLOCK_ATTRIBUTE_LINE}
 * is what refuses `[]` and `[a b]`, so a mixed run like `{}` or `()`
 * passing this pattern is inert rather than uncovered. Refusing every
 * uniform run therefore refuses every delimiter there is and every
 * one a later Asciidoctor adds, without naming any of them - which is
 * the property an enumeration of spellings does not have. Measured
 * over 32 punctuation characters at lengths two to six: of the 160
 * spellings this refuses, three WERE live render losses (`~{4,}` at
 * lengths four through six, which opens an OPEN block), closed by
 * naming `openBlockTilde` in {@link DELIMITER_KINDS} instead of
 * leaving the shape to this blanket refusal (issue #64), and the
 * rest are inert; refusing the remaining 157 costs the vendored
 * corpus nothing.
 *
 * THE OTHER TWO ARE NAMED, because neither is a run:
 *
 * - the markdown blockquote arm of `next_block` (parser.rb l.777),
 *   `md_syntax && ch0 == '>' && this_line.start_with?('> ')`, spelled
 *   as its head test.
 * - U+2022 BULLET, which `UnorderedListRx` (rx.rb l.284) carries as a
 *   third marker alternative beside `-` and `*`, and `AnyListRx`
 *   (l.274) with it. {@link UNORDERED_MARKER_SOURCE} models the
 *   marker, so a bullet line the join could reach is already a marker
 *   line to the interrupting set; this entry answers the WORD probe
 *   the marker sets cannot. Anchored at the head and NOT at a
 *   following space, unlike Ruby's `[ \t]+`: this pattern is asked of
 *   a WORD as well as of a line, and a wrap that puts the bare word
 *   at a line start supplies the space itself. So a line whose bullet
 *   has no space behind it is refused where the oracle reads text,
 *   and a run carrying a bullet word anywhere replays - including at
 *   positions no width can move to a line start - which is the same
 *   whole-run posture the separator condition takes. Over-refusal,
 *   bytes only. The lookalikes the pattern does
 *   NOT name stay text on both sides - U+2043 HYPHEN BULLET, U+2219
 *   BULLET OPERATOR and U+00B7 MIDDLE DOT among them - because this
 *   Asciidoctor's alternation holds one bullet and not a class.
 *
 * WHAT IS NOT CLOSED HERE, and what watches it instead. A head that
 * is neither a uniform run nor named above is one this registry does
 * not model and this file cannot know about - the standing set of
 * those is the block-structure ledger's `gap:*` families
 * (scripts/block-structure.ts), and the gate that crosses every one
 * of them with a description's join lives in
 * tests/format/description-sweep.test.ts. That gate is a REGRESSION
 * net rather than a proof: it reds when a family arrives with nothing
 * answering for it, and a shape no ledger has met yet - a bullet was
 * one - it cannot see at all.
 */
const UNMODELLED_BLOCK_HEADS: readonly RegExp[] = [
  /^[ \t]*(?<mark>[^\p{L}\p{N}\s])(?:[ \t]*\k<mark>)+[ \t]*$/v,
  /^> /v,
  /^[ \t]*\u{2022}/v,
];

/**
 * Whether a word written at the START of a line INSIDE a description
 * list's item would be re-read there as anything but that
 * description's own text. WIDER than
 * {@link startsBlockAtLineStart}, by exactly the shapes a
 * description's line loses and a paragraph's later lines keep, and a
 * SEPARATE predicate rather than a widening of that one because the
 * two questions are asked at different reader positions.
 *
 * The narrower question is the paragraph packer's: "may this word
 * begin a line at document level", where a mid-paragraph `:a: v`,
 * `.T` or `//c` is ordinary text - `read_paragraph_lines` breaks on
 * `StartOfBlockProc` / `StartOfListProc` and on nothing else
 * (parser.rb l.962-969). Answering true for those there would
 * over-refuse every plain paragraph, so the widening may not leak
 * back.
 *
 * This one is asked where a description's wrapped line stands, which
 * is the FIRST line the item's confined `next_block` sees: a comment
 * is drained by `skip_line_comments` with nothing behind it to
 * unshift back (parser.rb l.1363-1371), and an attribute entry or a
 * block title is drained by the metadata loop (l.519-523) and takes
 * the text it decorates with it. All three destroy content there and
 * none of them mid-paragraph, which is exactly why the narrower
 * predicate does not catch them. {@link UNMODELLED_BLOCK_HEADS} is here
 * for a different reason, stated at its own declaration: those shapes
 * are blocks to the ORACLE and text to this registry, so no
 * composition of the sets above can reach them.
 *
 * {@link BLOCK_ATTRIBUTE_LINE} is deliberately NOT a fourth shape: it
 * is already inside {@link interruptsByLineShape} through
 * SHARED_INTERRUPTERS, and naming it again would state one shape
 * twice and invite a later reader to believe the two lists are
 * independent.
 *
 * A DISCLOSURE RULE, applied to every clause of this predicate, of
 * {@link endsDescriptionLine}, and of the run predicate that reads
 * them both (src/parse/lines/description-list.ts). A clause that
 * refuses nothing over its measured domain is DELETED when it is
 * inert for a structural reason the code can name, and KEPT with the
 * measurement written down when it is one arm of an enumeration of a
 * real domain. Deleted under it: the successor spellings of the two
 * patterns below, and the blank-line and empty-word guards in the run
 * predicate. Kept under it: the second spelling of
 * {@link endsDescriptionLine} and two of the three questions its
 * probe asks. The rule is stated once, here, so the next clause is
 * decided rather than adjudicated.
 *
 * The shapes added here are asked in ONE spelling, where the
 * composition below asks its three in two. Deleted under the rule,
 * and the structural reason is this: the successor spelling
 * appends a fixed non-syntactic word, and none of them can be
 * completed by such a word. `BLOCK_TITLE` is decided by
 * `^\.\.?[^ \t.]`, the comment head by two characters,
 * `ATTRIBUTE_ENTRY` needs a closing `:` the probe suffix does not
 * carry, and {@link UNMODELLED_BLOCK_HEADS}' two patterns are anchored
 * at both ends. Over 346,200 probe strings no input made a successor
 * spelling refuse where the bare one did not, so a second call would
 * be a branch nothing reaches.
 *
 * THAT IS THE WHOLE OF WHAT A PROBE SUFFIX CAN DO, and it is where
 * this predicate ends rather than where the danger does.
 * `ATTRIBUTE_ENTRY` constrains a line at BOTH ends: `:a a:` is one
 * entry written as two words, and no probe that appends a fixed word
 * can see it. A shape that constrains both ends needs a word-PAIR
 * test over the whole run, which is a question about a run and not
 * about a word; the run's own predicate carries it
 * (src/parse/lines/description-list.ts).
 *
 * The line-END half of the same question is
 * {@link endsDescriptionLine}.
 * @param word - the head of a line: a single whitespace-delimited
 *   token, or several words with the spaces between them; rstripped
 *   here, so a caller may hand it a raw source line
 * @returns true when the head would start a block, a section, a
 *   preprocessor line, or one of the drained metadata shapes
 */
export function startsItemBlockLine(word: string): boolean {
  // Rstripped for the same reason the three questions
  // {@link startsBlockAtLineStart} composes rstrip internally: the
  // oracle rstrips every line in `prepare_source_string`, and the
  // shapes added here test the string they are given, so a CRLF
  // terminator on `:a:` would otherwise make them all fail open.
  const head = rstrip(word);
  return (
    startsBlockAtLineStart(head) ||
    BLOCK_TITLE.test(head) ||
    ATTRIBUTE_ENTRY.test(head) ||
    head.startsWith(LINE_COMMENT_HEAD) ||
    UNMODELLED_BLOCK_HEADS.some((pattern) => pattern.test(head))
  );
}

/**
 * Whether a word written at the END of a description's line would
 * make that line something other than the description's own text.
 * The line-END half of {@link startsItemBlockLine}'s question, and
 * not answerable by it: a wrap creates a line start and a line end at
 * the same point, and a run that is safe at every start it can make
 * is not thereby safe at every end.
 *
 * Asked of the TWO lines a description's wrap can close: a
 * continuation line the word ends, and the item's own TERM line,
 * which is still standing in front of the word whenever the wrap
 * falls on the first output line. The term head is what makes the
 * second one a different question and it is not optional:
 * `t:: p x[]` is `name:: target[attrlist]` under {@link BLOCK_MACRO}
 * and interrupts, while `p x[]` does not, so the shape that costs the
 * item its description is visible only when the probe carries the
 * head. Symmetrically `t:: p x{}` does not interrupt, which is what
 * keeps this from refusing `x[`, `x]`, `x{}` and `x()`, the
 * neighbouring spellings that wrap and stay stable.
 *
 * MEASURED, so the asymmetry between the two spellings is not read as
 * an accident: the CONTINUATION spelling refuses nothing today, and
 * the reason is the PREFIX, not the shapes. A fixed prefix decides
 * the probe line's own head, and every shape that turns on a line's
 * last word constrains its first word too - {@link BLOCK_MACRO} needs
 * a `name::` head, {@link BLOCK_ATTRIBUTE_LINE} a `[` one. The prefix
 * supplies neither, so the spelling can only ever report a line whose
 * head IS the prefix. It does not follow that a continuation line is
 * safe: `image::y x[]` is a block macro whose `name::` comes from a
 * word of the description itself, and no fixed prefix reaches it.
 * That case is a word PAIR, and the run's own predicate carries it
 * (src/parse/lines/description-list.ts) for the same reason the
 * line-start half hands `ATTRIBUTE_ENTRY`'s pair face over.
 *
 * Note also what this composition does NOT ask. It is the
 * document-level one, three questions, while its line-start twin
 * {@link startsItemBlockLine} asks the item-level one, six. Narrowing
 * the gap is what would make the continuation spelling live, and it
 * needs both spellings standing to be narrowed into.
 *
 * Swept over every punctuation pair as a word, alone and with a
 * letter in front and behind, the continuation spelling was true for
 * no word. It is KEPT under the disclosure rule stated at
 * {@link startsItemBlockLine}, as one arm of a two-arm enumeration of
 * a real domain - a wrap does create both lines - and the
 * measurement is written down so that no reader takes it for a live
 * guard in the meantime.
 * @param word - one whitespace-delimited word of a description
 * @param termHead - the item's own term and delimiter (`t::`): the
 *   opening the printer replays, and therefore the text a wrap can
 *   leave standing in front of the word
 * @returns true when either line the word could close reads as
 *   something other than description text
 */
export function endsDescriptionLine(word: string, termHead: string): boolean {
  return (
    closesADescriptionLine(`${PROBE_PREFIX} ${word}`) ||
    closesADescriptionLine(`${termHead} ${PROBE_PREFIX} ${word}`)
  );
}

/**
 * The three registry questions {@link endsDescriptionLine} asks of
 * each of its two probe lines, and the same three
 * {@link startsBlockAtLineStart} asks of its own: what interrupts,
 * what starts a section, and what the reader eats before block
 * structure exists. Written once so the two spellings cannot drift.
 *
 * MEASURED, under the disclosure rule stated at
 * {@link startsItemBlockLine}: over those probe words only
 * `interruptsByLineShape` was ever true, in either spelling. The
 * other two are KEPT because the three
 * together are one enumeration of "what makes a line not text" - the
 * enumeration {@link startsBlockAtLineStart} asks and the one the
 * line-end half will be narrowed toward - and not because either has
 * a witness here.
 * @param line - one whole probe line
 * @returns true when the line is not ordinary text
 */
function closesADescriptionLine(line: string): boolean {
  return (
    interruptsByLineShape(line) ||
    startsSectionTitle(line) ||
    isRawParagraphLine(line)
  );
}
