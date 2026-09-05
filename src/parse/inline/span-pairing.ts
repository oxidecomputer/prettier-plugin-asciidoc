/**
 * WHICH formatting marks pair into spans, and in WHICH ORDER.
 *
 * Asciidoctor does not walk a line once. `sub_quotes`
 * (substitutors.rb l.189-196) runs each row of the `QUOTE_SUBS` table
 * (asciidoctor.rb l.448-470, transcribed in the oracle as
 * `_normalQuoteSubs`, `@asciidoctor/core`'s
 * `build/node/index.cjs` l.1281-1374) as its
 * own gsub over the WHOLE text, one row after the next, and
 * `convert_quoted_text` writes each match's HTML straight back into
 * that text. So the ROW order decides which span wins where two of
 * them overlap, whatever the source order is:
 *
 * - strong, then monospaced, then emphasis, then mark - and within
 *   each mark the unconstrained spelling before the constrained one
 *   ({@link RESOLUTION_ORDER});
 * - `_a *b_ c*` therefore resolves the strong `*b_ c*` first, with
 *   content `b_ c`, and the underscores are left where they stand.
 *
 * WHERE A TREE RUNS OUT. Because the later rows match ACROSS the tags
 * an earlier row already wrote, the oracle emits genuinely
 * OVERLAPPING elements: `_a *b_ c*` renders
 * `<em>a <strong>b</em> c</strong>`, whose `</em>` sits inside the
 * strong. No tree holds that, and the formatter does not need it to:
 * what it needs is the extent and the content of each span, and the
 * span the EARLIER row resolved is the one whose extent and content a
 * tree can carry exactly. A candidate that crosses an
 * already-resolved span is therefore dropped, and its marks stay
 * literal text.
 *
 * The gsub consumed the crossing match all the same, so a dropped
 * candidate still ends its row's scan behind its closing mark: the
 * marks between are unavailable to that row, exactly as they are to
 * Ruby.
 */
import { DELIM_WIDTH } from "../../constants.js";
import type { InlineKind, InlineToken, InlineTokenType } from "./tokens.js";
import { CURVED_WIDTH } from "./curved-quotes.js";
// An unconstrained mark is the constrained one written twice - the
// same width the scan that finds those delimiters is built on, taken
// from there so a row here and a token there cannot disagree.
import { UNCONSTRAINED_WIDTH } from "./doubled-marks.js";
import { MARK_ROW, type MarkKind } from "./quote-boundaries.js";

/**
 * All twelve `QUOTE_SUBS` rows, in the table's own order.
 *
 * The last two, superscript and subscript (asciidoctor.rb l.465-468),
 * are UNCONSTRAINED rows with a single-character delimiter, which is
 * why their width is `DELIM_WIDTH` and not `UNCONSTRAINED_WIDTH`:
 * `\^(\S+?)\^` doubles nothing. Where their delimiters stand is
 * super-sub.ts's scan, and being last is what makes `x ^a~b^c~ y`
 * resolve to a superscript with the subscript dropped as a crossing
 * candidate - the oracle emits `<sup>a<sub>b</sup>c</sub>` there, and
 * no tree holds it.
 *
 * The twelve rows model eight token kinds - BoldMark, DoubleQuoteMark,
 * SingleQuoteMark, MonoMark, ItalicMark, HighlightMark,
 * SuperscriptMark, SubscriptMark - and the four mark kinds among them
 * appear again in `MARK_SPAN_KINDS` below, which maps each to the
 * `MarkKind` its AST node carries: the two curved kinds and the two
 * super/sub kinds are not in that map at all, inline-node-builder.ts
 * gives them their own switch cases, building a `curvedQuote`,
 * `superscript` or `subscript` node directly instead of looking up a
 * kind. Either way, `MARK_SPAN_KINDS` answers what a mark span BUILDS,
 * this table answers when it is resolved.
 */
const RESOLUTION_ORDER = [
  { type: "BoldMark", width: UNCONSTRAINED_WIDTH },
  { type: "BoldMark", width: DELIM_WIDTH },
  { type: "DoubleQuoteMark", width: CURVED_WIDTH },
  { type: "SingleQuoteMark", width: CURVED_WIDTH },
  { type: "MonoMark", width: UNCONSTRAINED_WIDTH },
  { type: "MonoMark", width: DELIM_WIDTH },
  { type: "ItalicMark", width: UNCONSTRAINED_WIDTH },
  { type: "ItalicMark", width: DELIM_WIDTH },
  { type: "HighlightMark", width: UNCONSTRAINED_WIDTH },
  { type: "HighlightMark", width: DELIM_WIDTH },
  { type: "SuperscriptMark", width: DELIM_WIDTH },
  { type: "SubscriptMark", width: DELIM_WIDTH },
] as const;

/**
 * The four kinds whose span has ONE spelling and no constrained
 * alternative to choose: the two curved rows, whose delimiters are a
 * quote character and a backtick rather than the mark character
 * itself, and the two super/sub rows, whose single delimiter has no
 * doubled twin. Not exported: nothing
 * outside this module needs it by name, only {@link MarkSpanTokenKind}
 * (derived below) and {@link ResolvedSpan#type} (the wider
 * {@link MarkTokenKind}) leave the file.
 */
type FixedSpellingTokenKind =
  | "DoubleQuoteMark"
  | "SingleQuoteMark"
  | "SuperscriptMark"
  | "SubscriptMark";

/**
 * Every token kind {@link RESOLUTION_ORDER} pairs into a span - read
 * off the table so the two cannot drift. What each one BECOMES is
 * inline-node-builder.ts's map; this is only which kinds pair. Not
 * exported: {@link ResolvedSpan#type} carries it out as a field type,
 * which is all any consumer of a resolved span needs.
 */
type MarkTokenKind = (typeof RESOLUTION_ORDER)[number]["type"];

/**
 * The four kinds whose delimiter is the mark character itself and
 * whose span has two spellings to choose between -
 * {@link MarkTokenKind} minus {@link FixedSpellingTokenKind}, which
 * spell a curved-quote, superscript or subscript node instead of a
 * formatting node.
 */
export type MarkSpanTokenKind = Exclude<MarkTokenKind, FixedSpellingTokenKind>;

/**
 * Which mark each pairing token spells. The tokenizer reads it to pick
 * a token's per-mark boundary classes (`markFlags`, rules.ts) and the
 * builder reads it for the AST node's `type`, which is the same four
 * words - so one table rather than one per reader, which is a pair
 * that can disagree about a fifth mark.
 *
 * `satisfies` is what ties it to {@link RESOLUTION_ORDER}: a fifth
 * mark kind added there fails to compile here until it is given a
 * mark.
 */
export const MARK_SPAN_KINDS = {
  BoldMark: "bold",
  ItalicMark: "italic",
  MonoMark: "monospace",
  HighlightMark: "highlight",
} as const satisfies Record<MarkSpanTokenKind, MarkKind>;

/**
 * WHERE a span's closing delimiter stands.
 *
 * A mark token IS its delimiter, and for most spans that is the whole
 * story. One spelling is not, and it follows from this fact:
 * `sub_quotes` (substitutors.rb l.189-196) runs over TEXT, which has
 * no tokens in it, so a delimiter can fall anywhere - including across
 * the seam between two of our own tokens.
 *
 * ACROSS two tokens: an escape is two characters, so `` ``a b\`` ``
 * spells its closing `` `` `` with the escape's own mark and the one
 * behind it, and no single token carries the delimiter (issue #153).
 * That arm is an UNCONSTRAINED row's alone, and the reason is the
 * lookahead: a constrained row has one to answer and the only offset a
 * match measured it for is its own end, where a cut serves instead.
 *
 * A delimiter standing IN a match is not an arm here at all. The
 * stream is CUT there instead ({@link cutMatch}), so the delimiter
 * becomes a token like any other: at the end of a bare URL run,
 * because the address stops in front of a mark the quote pass already
 * paired (issue #150), and in the MIDDLE of one, because Ruby's gsub
 * resumes immediately behind the match it just wrote and a second
 * delimiter in the same run opens the next span (issue #152).
 *
 * Not exported: every consumer reaches a close through the accessors
 * below, which is what keeps the arm's payload this module's own.
 */
type SpanClose =
  | {
      /** The token at `index` is the delimiter and nothing else. */
      readonly kind: "token";
      /** Index of that token. */
      readonly index: number;
    }
  | {
      /**
       * The delimiter's last characters are the whole token at
       * `index`, and its first are the end of the token in front.
       */
      readonly kind: "across";
      /** Index of the token the delimiter ends in. */
      readonly index: number;
      /** What the token in front leaves as the span's last content. */
      readonly head: InlineToken;
    };

/** One token in front of another, as an index delta. */
const TOKEN_BEFORE = 1;

/** The offset of a match's second character, and of its first. */
const SECOND_CHARACTER = 1;
const FIRST_CHARACTER = 0;

/**
 * The last token index a span's extent reaches, which is where the
 * walk outside it resumes.
 *
 * Both arms end AT the end of the token they name - an across close
 * because the delimiter's last characters ARE that whole token - so
 * this index answers for the node's position as well.
 * @param close - where the span closed
 * @returns the index of the token the delimiter ends in
 */
export function closeIndex(close: SpanClose): number {
  return close.index;
}

/**
 * One past the last token whose WHOLE image is the span's content.
 *
 * A delimiter split across two tokens leaves the first of them
 * PARTLY content, so that token is not one of the whole ones and its
 * head ({@link closeHead}) carries what it does contribute.
 * @param close - where the span closed
 * @returns the exclusive end of the whole-token content slice
 */
export function contentEnd(close: SpanClose): number {
  return close.kind === "across" ? close.index - TOKEN_BEFORE : close.index;
}

/**
 * The content a close leaves behind inside its own token, or
 * undefined where the closing token is nothing but the delimiter.
 * @param close - where the span closed
 * @returns the head token, or undefined when there is none
 */
export function closeHead(close: SpanClose): InlineToken | undefined {
  return close.kind === "across" ? close.head : undefined;
}

/**
 * The same close against a stream shifted `base` tokens to the left -
 * the recursion's own arithmetic, spelled here because only this
 * module knows which arms carry an index.
 * @param close - where the span closed
 * @param base - how far the slice starts into the outer stream
 * @returns the close, rebased
 */
export function rebaseClose(close: SpanClose, base: number): SpanClose {
  // The across arm keeps its head: that is an absolute fragment, and
  // only the index is relative to the stream.
  return close.kind === "token"
    ? { kind: "token", index: close.index - base }
    : { ...close, index: close.index - base };
}

/**
 * The same close against a stream a CUT has made longer.
 *
 * A cut replaces one token with several, so every index behind it
 * moves. The cut token itself is never one a resolved span names -
 * {@link closeSpelledWith} refuses that - so an index equal to the
 * cut is not a case that arises.
 * @param close - where the span closed
 * @param from - the index of the token that was cut
 * @param delta - how many tokens the cut added
 * @returns the close, shifted
 */
function shiftClose(close: SpanClose, from: number, delta: number): SpanClose {
  if (close.index <= from) {
    return close;
  }
  return close.kind === "token"
    ? { kind: "token", index: close.index + delta }
    : { ...close, index: close.index + delta };
}

/**
 * One resolved span, as indices into the token stream it was
 * resolved from.
 *
 * Indices rather than tokens because the builder slices the same
 * stream to recurse into a span's content, and an index is what
 * survives that slicing arithmetic.
 */
export interface ResolvedSpan {
  /** Which mark spells it. */
  readonly type: MarkTokenKind;
  /** Index of the opening mark token. */
  readonly open: number;
  /** Where the closing delimiter stands. */
  readonly close: SpanClose;
  /**
   * Index of the `[role]` token in front of the opening mark, when the
   * source wrote one - Ruby's optional `(?:\[([^\]]+)\])?` group,
   * which sits INSIDE every `QUOTE_SUBS` pattern and is therefore part
   * of the match's extent. Undefined everywhere else, and always
   * undefined on the rows the tokenizer emits no role token in front
   * of (`RoleAttribute`, rules.ts).
   */
  readonly role: number | undefined;
}

/**
 * Where a span's extent BEGINS: the role attribute when it has one,
 * the opening mark otherwise. The role is inside Ruby's own match, so
 * it is inside the extent that decides nesting and crossing.
 * @param span - a resolved span
 * @returns the index of its first token
 */
export function spanStart(span: ResolvedSpan): number {
  return span.role ?? span.open;
}

/**
 * The kinds whose match can END on a delimiter this table pairs, and
 * the kind the rest of that match becomes once the delimiter is split
 * off it.
 *
 * Two rules reach a closing delimiter before the mark rows do, and
 * for two different reasons in the same Ruby.
 *
 * A BARE URL: `sub_quotes` runs BEFORE `sub_macros` (`NORMAL_SUBS`,
 * substitutors.rb l.16, the list `apply_subs` walks in order), so
 * `InlineLinkRx` (rx.rb l.526) reads text whose spans are already
 * resolved - a mark at the end of a URL run belongs to the span, and
 * the address stops in front of it.
 *
 * An ESCAPE: `convert_quoted_text` refuses a match whose FIRST
 * character is the backslash (substitutors.rb l.1420), and neither
 * scope looks at what stands in front of the CLOSER. So `\*` behind
 * an open span is one backslash of content and the mark that closes
 * it, not an escape.
 *
 * TWO KINDS and not a predicate over all of them: every other rule's
 * match ends on a character no `QUOTE_SUBS` row spells (a bracket, a
 * brace, a `+`), and naming these two makes a third one a decision
 * rather than an accident. The head kind is what the match is once
 * the delimiter leaves: a URL is still a URL, and an escape's
 * backslash is the character no rule claims.
 */
const TRAILING_DELIMITER_HEAD: Partial<Record<InlineTokenType, InlineKind>> = {
  BackslashEscape: "InlineChar",
  InlineUrl: "InlineUrl",
};

/**
 * Whether a match of this kind can END on a delimiter the mark rows
 * pair, which is what earns it the direction facts a mark token
 * carries (`markFlags`, rules.ts).
 * @param type - the kind that matched
 * @returns true for the kinds {@link TRAILING_DELIMITER_HEAD} names
 */
export function mayEndOnDelimiter(type: InlineTokenType): boolean {
  return TRAILING_DELIMITER_HEAD[type] !== undefined;
}

/**
 * Which character each row's delimiter is spelled with, for the four
 * kinds that have one.
 *
 * DERIVED from the two tables that already hold it - this file's
 * {@link MARK_SPAN_KINDS} says which mark a token kind spells and
 * `MARK_ROW` (quote-boundaries.ts) says which character that mark is
 * written with - so a fifth mark is spelled once, there, and never
 * again here. The four kinds with no entry are the curved and
 * super/sub rows, whose delimiters are not a mark character repeated
 * and which therefore never stand at the end of another match.
 */
const MARK_CHARACTER: Partial<Record<MarkTokenKind, string>> =
  Object.fromEntries(
    Object.entries(MARK_SPAN_KINDS).map(([type, kind]) => [
      type,
      MARK_ROW[kind].mark,
    ]),
  );

/**
 * A row's delimiter and what a match that carries it leaves behind -
 * gathered once per candidate so the arms below take one argument
 * instead of three (the project's `max-params` ceiling is four).
 */
interface CloseSpelling {
  /** The mark token kind the row pairs. */
  readonly type: MarkTokenKind;
  /** The row's delimiter: its mark, repeated to its width. */
  readonly delimiter: string;
  /** The kind the match becomes once the delimiter leaves it. */
  readonly headKind: InlineKind;
}

/**
 * What a scan for a close found.
 *
 * A CUT is not a close: it says the row's delimiter stands inside a
 * match, which the stream has to be cut at before it can carry a close
 * there at all ({@link cutMatch}). The scan reports it and stops, and
 * the search runs again over the cut stream.
 */
type CloseSearch =
  | {
      /** The stream carries a close here. */
      readonly found: "close";
      /** Where it stands. */
      readonly close: SpanClose;
    }
  | {
      /** The stream has to be cut before it can carry one. */
      readonly found: "cut";
      /** The match to cut. */
      readonly index: number;
      /** Where in it the row found its delimiter. */
      readonly site: "interior" | "trailing";
      /** The delimiter to cut at, and what the match leaves behind. */
      readonly spelling: CloseSpelling;
    }
  | {
      /** Nothing here. */
      readonly found: "none";
    };

/** Nothing here. Spelled once so the arms below read as answers. */
const NO_CLOSE: CloseSearch = { found: "none" };

/**
 * What a CONSTRAINED row finds on a match: its delimiter at the
 * match's END, and nowhere else.
 *
 * The row's right lookahead `(?!\w)` has to be answered, and the only
 * position a token answers it for is the delimiter at its own END:
 * that is where `trailingDelimiterFlags` (rules.ts) measured
 * `canClose`. So a constrained row reads the flag and takes the end,
 * where an unconstrained row reads no flag and takes any offset.
 * @param candidate - the match being considered
 * @param index - its index in the stream
 * @param spelling - the row's delimiter and head kind
 * @returns what the scan found here
 */
function constrainedClose(
  candidate: InlineToken,
  index: number,
  spelling: CloseSpelling,
): CloseSearch {
  const { delimiter } = spelling;
  // A head of at least one character, because every content group
  // demands one: the delimiter cannot be the whole match.
  return candidate.canClose === true &&
    candidate.image.length > delimiter.length &&
    candidate.image.endsWith(delimiter)
    ? { found: "cut", index, site: "trailing", spelling }
    : NO_CLOSE;
}

/**
 * What an UNCONSTRAINED row finds on a match: its delimiter standing
 * somewhere inside, or the seam behind it.
 *
 * The FIRST occurrence is the right one: Ruby's content group is
 * non-greedy (`(.+?)`), so the nearest delimiter closes the row, and
 * the doubled scan that decided our opener is a delimiter at all
 * paired it with that same one (doubled-marks.ts replays the row's own
 * gsub). Offset zero is not an occurrence: the content group demands a
 * character, and no kind that reaches this function opens with the
 * mark anyway - a URL opens with its scheme and an escape with its
 * backslash.
 * @param tokens - the stream being resolved
 * @param index - the candidate's index in it
 * @param spelling - the row's delimiter and head kind
 * @returns what the scan found here
 */
function unconstrainedClose(
  tokens: readonly InlineToken[],
  index: number,
  spelling: CloseSpelling,
): CloseSearch {
  const candidate = tokens[index];
  const { delimiter } = spelling;
  const at = candidate.image.indexOf(delimiter, SECOND_CHARACTER);
  if (at <= FIRST_CHARACTER) {
    return acrossClose(tokens, index, spelling);
  }
  // The FIRST occurrence closes this row, and a close never asks what
  // stands in front of it. Every occurrence BEHIND it would have to
  // OPEN, and an escaped one cannot: Ruby hands those bytes back to
  // the rows that run after ({@link escaped}), which read a span our
  // tree has no second pass to find. Cutting anyway would leave what
  // that span sheltered standing in prose, so the row falls back to
  // the close it had before interior cuts existed - the delimiter at
  // the match's END, or none, and the scan carries on either way.
  return escapedBehind(candidate.image, at + delimiter.length, delimiter)
    ? constrainedClose(candidate, index, spelling)
    : { found: "cut", index, site: "interior", spelling };
}

/**
 * The close whose delimiter is spelled across the seam between a
 * match and the token behind it.
 *
 * What stands behind the match has to SPELL the delimiter's remaining
 * characters and nothing else, which is the whole test: a lone mark
 * reaches the stream as a mark token where a row could pair it there
 * and as the plain character no rule claimed otherwise
 * (`InlineChar`, tokens.ts), and both spell the same byte. Anything
 * wider is another construct and closes nothing here.
 *
 * The head is never empty. A match that reaches this function opens
 * with a backslash or with a URL scheme, never with the mark, so
 * taking the delimiter's shared characters off its end always leaves
 * the content group the character it demands.
 * @param tokens - the stream being resolved
 * @param index - the match's index in it
 * @param spelling - the row's delimiter and head kind
 * @returns what the scan found here
 */
function acrossClose(
  tokens: readonly InlineToken[],
  index: number,
  spelling: CloseSpelling,
): CloseSearch {
  const { delimiter } = spelling;
  const candidate = tokens[index];
  // Nothing behind the match spells the whole delimiter, which is the
  // same answer this arm gives a token that carries it whole: that is
  // a close of its own, and the scan finds it when it reaches it.
  const behind = tokens.at(index + TOKEN_BEFORE)?.image ?? delimiter;
  // How many of the delimiter's characters the MATCH has to supply.
  const shared = delimiter.length - behind.length;
  return shared > FIRST_CHARACTER &&
    behind === delimiter.slice(shared) &&
    candidate.image.endsWith(delimiter.slice(FIRST_CHARACTER, shared))
    ? {
        found: "close",
        close: {
          kind: "across",
          index: index + TOKEN_BEFORE,
          head: {
            type: spelling.headKind,
            image: candidate.image.slice(
              FIRST_CHARACTER,
              candidate.image.length - shared,
            ),
            offset: candidate.offset,
          },
        },
      }
    : NO_CLOSE;
}

/**
 * Where the token at `scanIndex` CLOSES this row, if it does: a mark
 * of the row's own kind and width, or a match carrying the row's
 * delimiter in or beside it.
 * @param tokens - the stream being resolved
 * @param scanIndex - the position being considered
 * @param row - the row being resolved
 * @returns what the scan found here
 */
function closesRow(
  tokens: readonly InlineToken[],
  scanIndex: number,
  row: (typeof RESOLUTION_ORDER)[number],
): CloseSearch {
  const candidate = tokens[scanIndex];
  if (candidate.type === row.type) {
    return candidate.canClose === true && candidate.image.length === row.width
      ? { found: "close", close: { kind: "token", index: scanIndex } }
      : NO_CLOSE;
  }
  const mark = MARK_CHARACTER[row.type];
  const headKind = TRAILING_DELIMITER_HEAD[candidate.type];
  if (mark === undefined || headKind === undefined) {
    return NO_CLOSE;
  }
  const spelling = {
    type: row.type,
    delimiter: mark.repeat(row.width),
    headKind,
  };
  return row.width === UNCONSTRAINED_WIDTH
    ? unconstrainedClose(tokens, scanIndex, spelling)
    : constrainedClose(candidate, scanIndex, spelling);
}

/** Ruby's `\\?`, and the one character it makes optional. */
const ESCAPE = "\\";

/**
 * Whether the delimiter at `at` stands behind a backslash, which is
 * what stops it OPENING a span.
 *
 * Every unconstrained `QUOTE_SUBS` row carries the escape inside its
 * own pattern, a bare `\\?` in front of the opening delimiter
 * (asciidoctor.rb l.446-468).
 *
 * A match whose first character is that backslash is written back with
 * the backslash removed and no span made, and the bytes go on to the
 * rows that run after (`convert_quoted_text`, substitutors.rb l.1420).
 * Nothing looks at what stands in front of a CLOSER, so this is asked
 * about opening alone.
 *
 * One character is the whole question. The row's `\\?` takes at most
 * one backslash, so a doubled `\\\\` still puts a backslash first in
 * the match and still escapes it.
 * @param image - the match being cut
 * @param at - where the delimiter starts inside it
 * @returns true when the delimiter may not open a span
 */
function escaped(image: string, at: number): boolean {
  return image.slice(FIRST_CHARACTER, at).endsWith(ESCAPE);
}

/**
 * Whether any occurrence of the delimiter at or behind `from` stands
 * behind a backslash.
 *
 * This is where the escape rule bites, and the only place it needs to:
 * the delimiter a cut emits at the FIRST occurrence is the row's own
 * close, and a close asks no escape (nothing looks at what stands in
 * front of one), while every occurrence behind it could only OPEN.
 * Refusing the cut when one of THOSE is escaped is therefore the whole
 * of `convert_quoted_text`'s answer here, and no delimiter the cut
 * emits ever needs its opening refused one at a time.
 * @param image - the match being considered
 * @param from - where to start looking
 * @param delimiter - the row's delimiter
 * @returns true when an escaped occurrence follows
 */
function escapedBehind(
  image: string,
  from: number,
  delimiter: string,
): boolean {
  for (
    let at = image.indexOf(delimiter, from);
    at > FIRST_CHARACTER;
    at = image.indexOf(delimiter, at + delimiter.length)
  ) {
    if (escaped(image, at)) {
      return true;
    }
  }
  return false;
}

/**
 * Cut a match where the row's delimiter stands, so the stream carries
 * it as a token.
 *
 * Ruby has no tokens: a delimiter is a delimiter wherever it stands,
 * and its gsub resumes immediately behind the match it wrote, so a
 * second delimiter in the same run OPENS the next span. Recording the
 * close as an offset inside a token cannot express that - the row
 * would have to resume inside a token it has already stepped over -
 * so the stream is cut instead, and everything downstream goes on
 * working in whole tokens.
 *
 * WHERE it cuts, and what the delimiter may then do, is the SITE's to
 * say. An `interior` site is an unconstrained row's, which tests no
 * boundary: every occurrence becomes a delimiter, and each may open a
 * span as well as close one. A `trailing` site is a constrained row's,
 * and there the only offset whose lookahead the match answered is its
 * own end (`trailingDelimiterFlags`, rules.ts) - one cut, and the
 * delimiter may only CLOSE, because a match read out of text
 * `sub_quotes` has already paired cannot begin a span.
 *
 * The pieces between the delimiters are `InlineChar`, the kind for a
 * position no rule claims. The cut is BYTE-NEUTRAL: a piece that pairs
 * with nothing prints its own image back, exactly as it did inside the
 * match.
 *
 * WHY THE SCAN TERMINATES. The stream gets LONGER at every cut, so its
 * length is no measure. What decreases is the number of characters
 * residing in tokens {@link TRAILING_DELIMITER_HEAD} names: a cut
 * replaces one such match with a head of that kind, one mark token per
 * delimiter, and `InlineChar` pieces between them, so every character
 * behind the first delimiter leaves the class and the head is at least
 * one character shorter than the match was. The scan only ever asks
 * for a cut on a match, so it cannot ask forever.
 * @param tokens - the stream being resolved, spliced in place
 * @param index - the match to cut
 * @param spelling - the delimiter to cut at, and what the match
 *   leaves behind; the scan found both and hands them on rather than
 *   letting this look them up a second time
 * @param site - where in the match the row found its delimiter
 * @returns how many tokens the cut added
 */
function cutMatch(
  tokens: InlineToken[],
  index: number,
  spelling: CloseSpelling,
  site: "interior" | "trailing",
): number {
  const match = tokens[index];
  const { delimiter, headKind } = spelling;
  const interior = site === "interior";
  const pieces: InlineToken[] = [];
  let cursor = FIRST_CHARACTER;
  let at = interior
    ? match.image.indexOf(delimiter, SECOND_CHARACTER)
    : match.image.length - delimiter.length;
  while (at > FIRST_CHARACTER) {
    // Two delimiters that ABUT leave nothing between them, and an
    // empty token is not a token: the stream carries characters.
    if (cursor < at) {
      pieces.push({
        type: cursor === FIRST_CHARACTER ? headKind : "InlineChar",
        image: match.image.slice(cursor, at),
        offset: match.offset + cursor,
      });
    }
    pieces.push({
      type: spelling.type,
      image: delimiter,
      offset: match.offset + at,
      canOpen: interior,
      canClose: true,
    });
    cursor = at + delimiter.length;
    // Resume AT the cursor, not one past it: Ruby's gsub carries on
    // from the character behind the match it wrote, and the content
    // the next match needs comes from whatever follows the delimiter -
    // the rest of this image or the tokens behind it. Two delimiters
    // that ABUT are two delimiters.
    at = interior ? match.image.indexOf(delimiter, cursor) : FIRST_CHARACTER;
  }
  if (cursor < match.image.length) {
    pieces.push({
      type: "InlineChar",
      image: match.image.slice(cursor),
      offset: match.offset + cursor,
    });
  }
  tokens.splice(index, TOKEN_BEFORE, ...pieces);
  return pieces.length - TOKEN_BEFORE;
}

// Every kind {@link RESOLUTION_ORDER} pairs, as a set, so a content
// walk can ask whether a token is some OTHER row's delimiter without
// knowing which row.
const PAIRING_KINDS: ReadonlySet<InlineTokenType> = new Set(
  RESOLUTION_ORDER.map((row) => row.type),
);

/**
 * Whether a mark of the same KIND stands openable in front of
 * `openIndex`, which is what makes a delimiter inside the content a
 * partner some other row will want.
 *
 * Kind and not WIDTH, deliberately. The printer respells an
 * unconstrained span with the constrained mark wherever the two render
 * alike (`constrainedIsLegal`, src/print/inline.ts), so the same
 * document read a second time offers the same pairing in a narrower
 * spelling. A guard that asked for the width would fire on the first
 * reading and not on the second, and the two readings would disagree
 * about which spans exist. Which ROW pairs the two is not the question
 * here anyway: the question is whether anything in front of this
 * opener could want the delimiter this span would enclose.
 * @param tokens - the stream being resolved
 * @param openIndex - position of the opening mark
 * @param mark - the delimiter standing in the content
 * @returns true when a row could pair the two across this span
 */
function opensInFrontOf(
  tokens: readonly InlineToken[],
  openIndex: number,
  mark: InlineToken,
): boolean {
  for (let at = FIRST_CHARACTER; at < openIndex; at += 1) {
    const token = tokens[at];
    if (token.type === mark.type && token.canOpen === true) {
      return true;
    }
  }
  return false;
}

/**
 * Whether a delimiter in the content belongs to a row that has not run
 * yet, and so may still want a partner of its own.
 *
 * A token of this row's OWN kind and width is this row's delimiter,
 * and the scan has already decided what to do with it. Everything else
 * {@link RESOLUTION_ORDER} pairs belongs to a row that runs later -
 * including the same mark in the other WIDTH, because this question is
 * only ever asked by an UNCONSTRAINED row and the constrained row of
 * the same mark runs behind it. Reading the KIND alone hid exactly
 * that case: a constrained monospace span holding an address and a
 * tab, closed by the first mark of a THREE-mark run, loses its span
 * outright when the doubled row pairs the rest of that run across the
 * seam behind it - and the tab it sheltered folds inside code.
 * @param token - the delimiter standing in the content
 * @param row - the row being resolved
 * @returns true when a later row could still want it
 */
function belongsToALaterRow(
  token: InlineToken,
  row: (typeof RESOLUTION_ORDER)[number],
): boolean {
  return (
    PAIRING_KINDS.has(token.type) &&
    !(token.type === row.type && token.image.length === row.width)
  );
}

/**
 * Whether the content an ACROSS close would enclose holds a delimiter
 * that some other row would pair ACROSS this span.
 *
 * A close spelled across a seam is a close the stream does not carry
 * as a token, so taking it can only ever ADD a span - and where the
 * span it adds encloses a delimiter whose partner stands in FRONT of
 * this opener, it COSTS one. That delimiter's own row runs later, the
 * two spans cross, and a crossing candidate is dropped, taking with it
 * whatever the lost span sheltered. Monospace shelters whitespace, so
 * the loss is a rendering change and not a spelling one:
 * `` ``a<TAB>**``\** `` renders its tab inside `<code>`, and pairing
 * the bold across the seam would leave the tab in prose.
 *
 * So the arm declines exactly there, and nowhere else: a foreign
 * delimiter with no partner in front of this opener crosses nothing,
 * and the span is taken. What the refusal costs is the added span and
 * nothing else - the bytes print back as the source wrote them, which
 * is what they did before this arm existed at all.
 * @param tokens - the stream being resolved
 * @param openIndex - position of the opening mark
 * @param close - the close being considered
 * @param row - the row being resolved
 * @returns true when the close must be declined
 */
function enclosesCrossingMark(
  tokens: readonly InlineToken[],
  openIndex: number,
  close: SpanClose,
  row: (typeof RESOLUTION_ORDER)[number],
): boolean {
  const end = contentEnd(close);
  for (let at = openIndex + TOKEN_BEFORE; at < end; at += 1) {
    const token = tokens[at];
    if (
      belongsToALaterRow(token, row) &&
      token.canClose === true &&
      opensInFrontOf(tokens, openIndex, token)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Scan forward for a token that can CLOSE the mark at `openIndex`:
 * the row's own kind and width, or a match ending on its delimiter,
 * and able to close where it stands.
 *
 * The nearest such token is the right one because Ruby's content
 * groups are non-greedy (`(.+?)`, `(\S|\S.*?\S)`). A mark that cannot
 * close is skipped rather than ending the search: Ruby's engine
 * backtracks past a position where the trailing lookahead fails and
 * goes on looking, and `canClose` is that lookahead
 * (quote-boundaries.ts).
 * @param tokens - the stream being resolved
 * @param openIndex - position of the opening mark
 * @param row - the row being resolved, whose kind and width the close
 *   must match
 * @returns what the scan found
 */
function findCloseMark(
  tokens: readonly InlineToken[],
  openIndex: number,
  row: (typeof RESOLUTION_ORDER)[number],
): CloseSearch {
  for (
    let scanIndex = openIndex + TOKEN_BEFORE;
    scanIndex < tokens.length;
    scanIndex += 1
  ) {
    const found = closesRow(tokens, scanIndex, row);
    if (found.found !== "none") {
      return found;
    }
  }
  return NO_CLOSE;
}

/**
 * The closing mark for `openIndex`, skipping a close that would leave
 * the span EMPTY.
 *
 * Every `QUOTE_SUBS` content group demands at least one character, so
 * an adjacent close is no match at all and Ruby's engine looks
 * further; `____` is emphasis around a literal `_`, not two empty
 * spans. Every token's image is at least one character wide, so
 * "no tokens between" and Ruby's "at least one character" are the
 * same predicate here, not an approximation of it. The skipped mark
 * becomes content, which is why the search resumes FROM it rather
 * than from the opener.
 *
 * An adjacent close that carries a HEAD is not empty at all: the head
 * is the content, so `` `\` `` is a monospace span around one
 * backslash and the skip does not apply to it.
 *
 * The retry is an `if` and not a loop because it can only ever happen
 * once: the second search starts AT the adjacent close and so answers
 * at least `openIndex + 2`, which the test can no longer hold for.
 * @param tokens - the stream being resolved
 * @param openIndex - position of the opening mark
 * @param row - the row being resolved
 * @returns what the scan found
 */
function closeForOpen(
  tokens: readonly InlineToken[],
  openIndex: number,
  row: (typeof RESOLUTION_ORDER)[number],
): CloseSearch {
  const found = findCloseMark(tokens, openIndex, row);
  if (found.found !== "close") {
    return found;
  }
  if (
    found.close.kind === "across" &&
    enclosesCrossingMark(tokens, openIndex, found.close, row)
  ) {
    return NO_CLOSE;
  }
  // A close whose delimiter is spelled ACROSS a seam is never empty
  // either: the token in front of the bare mark keeps a head, and that
  // head is the content group's own character.
  return closeIndex(found.close) === openIndex + TOKEN_BEFORE &&
    closeHead(found.close) === undefined
    ? findCloseMark(tokens, closeIndex(found.close), row)
    : found;
}

/**
 * The `[role]` token in front of an opening mark, if any.
 *
 * Asked of EVERY row, because Ruby's attrlist group sits inside every
 * one of them; which marks can have a role token standing in front of
 * them at all is the tokenizer's answer, not this one's
 * (`RoleAttribute`, rules.ts).
 * @param tokens - the stream being resolved
 * @param openIndex - position of the opening mark
 * @returns the role token's index, or undefined
 */
function roleBefore(
  tokens: readonly InlineToken[],
  openIndex: number,
): number | undefined {
  return openIndex > 0 && tokens[openIndex - 1].type === "RoleAttribute"
    ? openIndex - 1
    : undefined;
}

/**
 * Whether a candidate CROSSES a span already resolved - overlapping
 * it without either one containing the other, which is the shape a
 * tree cannot hold.
 * @param candidate - the span being considered
 * @param accepted - the spans resolved by earlier rows
 * @returns true when the candidate must be dropped
 */
function crossesAccepted(
  candidate: ResolvedSpan,
  accepted: readonly ResolvedSpan[],
): boolean {
  const start = spanStart(candidate);
  const end = closeIndex(candidate.close);
  return accepted.some((span) => {
    const other = spanStart(span);
    const otherEnd = closeIndex(span.close);
    const disjoint = end < other || otherEnd < start;
    const nested =
      (start <= other && otherEnd <= end) ||
      (other <= start && end <= otherEnd);
    return !disjoint && !nested;
  });
}

/**
 * Whether a match is one an accepted span's own close is SPELLED
 * with, which is the one place a cut is refused.
 *
 * An ACROSS close keeps part of the token in front of its mark as a
 * head. Cutting that match would leave the span holding a head the
 * pieces now repeat, so the row goes without its close there instead,
 * which is the answer it had before the cut was possible at all. No
 * other close can name a match: every one of them ends on a mark
 * token, and a mark is never a match a cut falls in.
 *
 * A match inside a span's CONTENT is cut freely: nothing names it, and
 * the indices behind it move with {@link shiftAccepted}.
 * @param index - the match a cut would fall in
 * @param accepted - the spans resolved by earlier rows
 * @returns true when the cut must be refused
 */
function closeSpelledWith(
  index: number,
  accepted: readonly ResolvedSpan[],
): boolean {
  return accepted.some((span) => index === contentEnd(span.close));
}

/**
 * Shift every accepted span behind a cut, which made the stream
 * longer.
 * @param accepted - the spans resolved so far, rewritten in place
 * @param from - the index of the token that was cut
 * @param delta - how many tokens the cut added
 */
function shiftAccepted(
  accepted: ResolvedSpan[],
  from: number,
  delta: number,
): void {
  for (const [at, span] of accepted.entries()) {
    accepted[at] = {
      type: span.type,
      open: span.open > from ? span.open + delta : span.open,
      close: shiftClose(span.close, from, delta),
      role:
        span.role !== undefined && span.role > from
          ? span.role + delta
          : span.role,
    };
  }
}

/**
 * Resolve one row of {@link RESOLUTION_ORDER} over the whole stream,
 * appending the spans it wins.
 * @param tokens - the stream being resolved
 * @param row - the mark kind and width this row pairs
 * @param accepted - spans resolved so far (appended to)
 */
function resolveRow(
  tokens: InlineToken[],
  row: (typeof RESOLUTION_ORDER)[number],
  accepted: ResolvedSpan[],
): void {
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    const opens =
      token.type === row.type &&
      token.image.length === row.width &&
      token.canOpen === true;
    const found = opens ? closeForOpen(tokens, index, row) : NO_CLOSE;
    if (found.found === "cut") {
      // The stream could not carry a close where the delimiter stands,
      // so it is cut there and the SAME opener asks again - now over a
      // stream whose tokens reach past the delimiter. The loop
      // terminates because every cut strictly decreases the same
      // measure ({@link cutMatch}), never because the stream shrinks:
      // it grows.
      const delta = closeSpelledWith(found.index, accepted)
        ? 0
        : cutMatch(tokens, found.index, found.spelling, found.site);
      if (delta === 0) {
        index += 1;
        continue;
      }
      shiftAccepted(accepted, found.index, delta);
      continue;
    }
    if (found.found === "none") {
      index += 1;
      continue;
    }
    const candidate = {
      type: row.type,
      open: index,
      close: found.close,
      role: roleBefore(tokens, index),
    };
    if (!crossesAccepted(candidate, accepted)) {
      accepted.push(candidate);
    }
    index = closeIndex(found.close) + TOKEN_BEFORE;
  }
}

/**
 * Pair the formatting marks of one token stream into spans, in
 * Asciidoctor's own resolution order.
 *
 * The result is PROPERLY NESTED by construction - crossing candidates
 * are dropped - and sorted so an enclosing span always precedes the
 * spans inside it, which is the order the builder walks them in.
 *
 * Called ONCE per block body, never per span: a row is a gsub over the
 * whole text, so which span a row wins cannot be decided a slice at a
 * time. The builder re-bases these indices when it descends.
 *
 * The STREAM comes back too, because resolving can CUT one: a
 * delimiter standing in a match belongs to the span, not to the match,
 * and the pieces on either side of it are tokens like any others
 * ({@link cutMatch}). The cut is byte-neutral, but a caller that walks
 * the spans has to walk the same stream they were resolved against.
 * @param tokens - one block body's tokens, in source order
 * @returns the stream the spans index, and the spans, start-ascending
 */
export function resolveSpans(tokens: readonly InlineToken[]): {
  tokens: readonly InlineToken[];
  spans: ResolvedSpan[];
} {
  const stream = [...tokens];
  const accepted: ResolvedSpan[] = [];
  for (const row of RESOLUTION_ORDER) {
    resolveRow(stream, row, accepted);
  }
  // Start alone orders them. No two spans can share a start - a mark
  // belongs to at most one span, and a `[role]` token is not a mark -
  // and properly nested intervals with distinct starts put every
  // enclosing span in front of the spans inside it.
  return {
    tokens: stream,
    spans: accepted.toSorted(
      (left, right) => spanStart(left) - spanStart(right),
    ),
  };
}
