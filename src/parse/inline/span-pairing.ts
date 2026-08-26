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
import type { InlineToken } from "./tokens.js";

// An unconstrained mark is the constrained one written twice.
const UNCONSTRAINED_WIDTH = DELIM_WIDTH + DELIM_WIDTH;

/**
 * The `QUOTE_SUBS` rows this parser models, in the table's own order.
 *
 * FOUR rows are left out, and they are not left out for the same
 * reason. Superscript and subscript (the last two) genuinely cannot
 * matter: `\^(\S+?)\^` and `~(\S+?)~` consume only `^` and `~`, which
 * no row here spells, and both run after every row here anyway.
 *
 * The two CURVED-QUOTE rows (3 and 4) are a real gap. They are
 * `"` + backtick + content + backtick + `"` and the `'` pair, so they
 * consume BACKTICKS - the same character the two monospaced rows
 * spell - and they run BEFORE both of them. Where a source writes
 * them, our monospaced rows take backticks the oracle had already
 * spent: `"``a``"` renders `&#8220;`a`&#8221;`, the outer pair gone
 * to the curved quote and the inner two left as literal text, while
 * we build a `monospace` span the oracle has nowhere.
 *
 * That divergence is byte-stable on its own, but it does not stay
 * contained: the row REWRITES its neighbours into `&#8220;`/`&#8221;`,
 * whose `;` is excluded in front of every constrained mark, and the
 * printer's constrained-downgrade rule (`constrainedIsLegal`,
 * src/print/inline.ts) models `sub_specialchars` but not this
 * rewrite. `x "`__a__`" y` therefore formats to `x "`_a_`" y` and
 * loses the emphasis. That render bug is issue #74 and is older than
 * this table; modelling the two rows is what would close it.
 *
 * The four kinds ARE listed again in inline-node-builder.ts's map
 * from token kind to AST node type - that map answers what a span
 * IS, this table answers when it is resolved, and they are separate
 * facts.
 */
const RESOLUTION_ORDER = [
  { type: "BoldMark", width: UNCONSTRAINED_WIDTH },
  { type: "BoldMark", width: DELIM_WIDTH },
  { type: "MonoMark", width: UNCONSTRAINED_WIDTH },
  { type: "MonoMark", width: DELIM_WIDTH },
  { type: "ItalicMark", width: UNCONSTRAINED_WIDTH },
  { type: "ItalicMark", width: DELIM_WIDTH },
  { type: "HighlightMark", width: UNCONSTRAINED_WIDTH },
  { type: "HighlightMark", width: DELIM_WIDTH },
] as const;

/**
 * The four token kinds a span can be spelled with - read off
 * {@link RESOLUTION_ORDER} so the two cannot drift. What each one
 * BECOMES is inline-node-builder.ts's map; this is only which kinds
 * pair.
 */
export type MarkTokenKind = (typeof RESOLUTION_ORDER)[number]["type"];

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
   * Index of the `[role]` token in front of a highlight's opening
   * mark, when the source wrote one - Ruby's optional
   * `(?:\[([^\]]+)\])?` group, which sits INSIDE every `QUOTE_SUBS`
   * pattern and is therefore part of the match's extent. Undefined
   * everywhere else.
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
 * Scan forward for a mark that can CLOSE the one at `openIndex`: same
 * kind, same width (constrained marks never pair with unconstrained
 * ones), and able to close where it stands.
 *
 * The nearest such mark is the right one because Ruby's content
 * groups are non-greedy (`(.+?)`, `(\S|\S.*?\S)`). A mark that cannot
 * close is skipped rather than ending the search: Ruby's engine
 * backtracks past a position where the trailing lookahead fails and
 * goes on looking, and `canClose` is that lookahead
 * (quote-boundaries.ts).
 * @param tokens - the stream being resolved
 * @param openIndex - position of the opening mark
 * @returns the closing mark's index, or -1 when there is none
 */
function findCloseMark(
  tokens: readonly InlineToken[],
  openIndex: number,
): number {
  const {
    type: openType,
    image: { length: markWidth },
  } = tokens[openIndex];
  for (
    let scanIndex = openIndex + 1;
    scanIndex < tokens.length;
    scanIndex += 1
  ) {
    const candidate = tokens[scanIndex];
    if (
      candidate.type === openType &&
      candidate.image.length === markWidth &&
      candidate.canClose === true
    ) {
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
 * The retry is an `if` and not a loop because it can only ever happen
 * once: the second search starts AT the adjacent close and so answers
 * at least `openIndex + 2`, which the test can no longer hold for.
 * @param tokens - the stream being resolved
 * @param openIndex - position of the opening mark
 * @returns the closing mark's index, or -1 when there is none
 */
function closeForOpen(
  tokens: readonly InlineToken[],
  openIndex: number,
): number {
  const closeIndex = findCloseMark(tokens, openIndex);
  return closeIndex === openIndex + 1
    ? findCloseMark(tokens, closeIndex)
    : closeIndex;
}

/**
 * The `[role]` token in front of a highlight's opening mark, if any.
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
    const close = opens ? closeForOpen(tokens, index) : -1;
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
    if (!crossesAccepted(candidate, accepted)) accepted.push(candidate);
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
  for (const row of RESOLUTION_ORDER) resolveRow(tokens, row, accepted);
  // Start alone orders them. No two spans can share a start - a mark
  // belongs to at most one span, and a `[role]` token is not a mark -
  // and properly nested intervals with distinct starts put every
  // enclosing span in front of the spans inside it.
  return accepted.toSorted((left, right) => spanStart(left) - spanStart(right));
}
