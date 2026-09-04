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
  /** Index of the closing mark token. */
  readonly close: number;
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
 * The token a span's closing token leaves behind as CONTENT: the
 * match minus the delimiter at its end, or undefined when the whole
 * token is the delimiter (every ordinary mark).
 *
 * The offset is the match's own, so the head covers exactly the
 * source it always did minus its last `width` characters, and the
 * delimiter that follows it is what the span's node ends at.
 * @param token - the token a span closed on
 * @param width - the closing delimiter's width, which is the opening
 *   delimiter's own: a constrained mark never pairs with a doubled one
 * @returns the head token, or undefined when there is no head
 */
export function delimiterHead(
  token: InlineToken,
  width: number,
): InlineToken | undefined {
  const type = TRAILING_DELIMITER_HEAD[token.type];
  return type === undefined
    ? undefined
    : { type, image: token.image.slice(0, -width), offset: token.offset };
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
 * Whether the token at `scanIndex` can CLOSE this row: a mark of the
 * row's own kind and width, or a match that ENDS on that row's
 * delimiter ({@link TRAILING_DELIMITER_HEAD}). Either way it has to be
 * able to close where the delimiter stands, which is what `canClose`
 * records (`markFlags`, rules.ts).
 * @param candidate - the token being considered
 * @param row - the row being resolved
 * @returns true when this row may close here
 */
function closesRow(
  candidate: InlineToken,
  row: (typeof RESOLUTION_ORDER)[number],
): boolean {
  if (candidate.canClose !== true) {
    return false;
  }
  if (candidate.type === row.type) {
    return candidate.image.length === row.width;
  }
  const mark = MARK_CHARACTER[row.type];
  // A head of at least one character, because every content group
  // demands one: the delimiter cannot be the whole match.
  return (
    mark !== undefined &&
    mayEndOnDelimiter(candidate.type) &&
    candidate.image.length > row.width &&
    candidate.image.endsWith(mark.repeat(row.width))
  );
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
 * @returns the closing token's index, or -1 when there is none
 */
function findCloseMark(
  tokens: readonly InlineToken[],
  openIndex: number,
  row: (typeof RESOLUTION_ORDER)[number],
): number {
  for (
    let scanIndex = openIndex + 1;
    scanIndex < tokens.length;
    scanIndex += 1
  ) {
    if (closesRow(tokens[scanIndex], row)) {
      return scanIndex;
    }
  }
  return -1;
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
 * @returns the closing mark's index, or -1 when there is none
 */
function closeForOpen(
  tokens: readonly InlineToken[],
  openIndex: number,
  row: (typeof RESOLUTION_ORDER)[number],
): number {
  const closeIndex = findCloseMark(tokens, openIndex, row);
  return closeIndex === openIndex + 1 &&
    delimiterHead(tokens[closeIndex], row.width) === undefined
    ? findCloseMark(tokens, closeIndex, row)
    : closeIndex;
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
  return accepted.some((span) => {
    const other = spanStart(span);
    const disjoint = candidate.close < other || span.close < start;
    const nested =
      (start <= other && span.close <= candidate.close) ||
      (other <= start && candidate.close <= span.close);
    return !disjoint && !nested;
  });
}

/**
 * Resolve one row of {@link RESOLUTION_ORDER} over the whole stream,
 * appending the spans it wins.
 * @param tokens - the stream being resolved
 * @param row - the mark kind and width this row pairs
 * @param accepted - spans resolved so far (appended to)
 */
function resolveRow(
  tokens: readonly InlineToken[],
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
    const close = opens ? closeForOpen(tokens, index, row) : -1;
    if (close === -1) {
      index += 1;
      continue;
    }
    const candidate = {
      type: row.type,
      open: index,
      close,
      role: roleBefore(tokens, index),
    };
    if (!crossesAccepted(candidate, accepted)) {
      accepted.push(candidate);
    }
    index = close + 1;
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
 * @param tokens - one block body's tokens, in source order
 * @returns the spans, start-ascending
 */
export function resolveSpans(tokens: readonly InlineToken[]): ResolvedSpan[] {
  const accepted: ResolvedSpan[] = [];
  for (const row of RESOLUTION_ORDER) {
    resolveRow(tokens, row, accepted);
  }
  // Start alone orders them. No two spans can share a start - a mark
  // belongs to at most one span, and a `[role]` token is not a mark -
  // and properly nested intervals with distinct starts put every
  // enclosing span in front of the spans inside it.
  return accepted.toSorted((left, right) => spanStart(left) - spanStart(right));
}
