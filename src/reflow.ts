/**
 * Paragraph reflow utilities — ensures fill() wraps text
 * correctly when inline formatting is present.
 *
 * Two concerns are handled:
 *
 * 1. **Block-syntax safety** (`wordsToFillParts`): prevents
 *    fill() from placing words where AsciiDoc would re-parse
 *    them as block syntax — at column 0 (delimiters, list
 *    markers, block attribute lines and anchors, admonition
 *    labels, block macros, breaks, and the comment and
 *    preprocessor lines the reader would eat), or on the
 *    block's first line (a `term::` description-list
 *    separator). This file
 *    owns no patterns of its own: every shape it asks about
 *    comes from the registry in src/parse/line-shapes.ts, the
 *    same one the BlockReader classifies lines with, so the
 *    two can never disagree about what ends a paragraph.
 *
 * 2. **Fill alignment** (`flattenForFill`): when inline
 *    formatting nodes (italic, bold, xref, ...) are embedded
 *    in a paragraph, a naive `.flat()` can break the
 *    content/separator alternation that fill() expects.
 *    flattenForFill detects adjacent content elements and
 *    fuses them, maintaining the fill() protocol.
 *
 * The two interact through DLIST_HAZARD_BREAK. wordsToFillParts
 * sees one text node at a time, so it cannot know whether the
 * hazard word it must break before is glued (no whitespace) to
 * the preceding inline sibling — as in `…[#3641])::`, where the
 * `)::` fuses onto a link. It therefore records the requirement
 * as a marker, and flattenForFill — the one place that knows
 * which adjacent contents fuse — resolves it. The invariant it
 * upholds: **the break lands on the separator BEFORE the fused
 * content run containing the hazard word, never inside the run.**
 * Breaking inside would insert whitespace the source did not
 * have, changing the rendered text.
 */
import { doc, type Doc } from "prettier";
import {
  DLIST_SEPARATOR_WORD,
  interruptsByLineShape,
  isRawParagraphLine,
} from "./parse/line-shapes.js";

const {
  builders: { line, literalline, hardline },
} = doc;

/**
 * Separator marker meaning "a description-list hazard word starts
 * here; the enclosing fill must break no later than the run this
 * word belongs to". Emitted by wordsToFillParts and consumed by
 * flattenForFill (see the module comment for why the decision
 * cannot be made in one place). Its Doc value is a hard break so
 * that a marker which somehow reaches the printer unresolved still
 * keeps the hazard word off the first output line rather than
 * silently creating a description list.
 *
 * It is exported because resolution can cross a nesting boundary:
 * when the marker leads a formatting span's parts, flattenForFill
 * leaves it in front and the span printer re-emits it ahead of the
 * span's own docs, so the ENCLOSING fill resolves it against the
 * separator before the span. That is the whole protocol — the only
 * legal places to see this value outside this module are that hoist
 * (src/print-inline.ts) and stripLeadingHazardBreak below.
 */
export const DLIST_HAZARD_BREAK: Doc = [hardline];

// ── Word splitting ─────────────────────────────────────────

/**
 * Split raw block text into the words wordsToFillParts expects:
 * non-empty and whitespace-free. Shared so every caller — the text
 * case, the admonition printer, and the first-source-line counting
 * that feeds the dlist guard — agrees on what a word is; a mismatch
 * would misplace the guard by a word.
 * @param value - Raw source text, or a prefix of it.
 * @returns The non-empty whitespace-delimited words, in order.
 */
export function splitWords(value: string): string[] {
  return value.split(/\s+/v).filter((word) => word.length > 0);
}

// ── Detection ──────────────────────────────────────────────

// The lone `+`. Both reflow safety rules name it: at column 0 it is a
// list continuation, at end of a line a hard line break.
const CONTINUATION_WORD = "+";

// Stands in for "whatever word fill() puts next", so the registry can
// be asked about a word that STARTS a line rather than one alone on
// it. Any non-blank, non-syntactic text does; the marker patterns
// only require that something follow the space.
const PROBE_SUFFIX = "x";

/**
 * Detect words that must not begin an output line, because
 * AsciiDoc would re-parse them there as the start of a new block
 * or list item. Such words are glued to their predecessor in
 * wordsToFillParts — and, when such a word OPENS a text node,
 * glued across the node boundary to the preceding inline sibling
 * (see the leading boundary in src/print-inline.ts's text case).
 *
 * The answer comes entirely from the line-shape registry, asked
 * in both spellings a reflowed word can take, because reflow does
 * not know which kind of paragraph it is inside and the registry's
 * patterns are whole-LINE ones:
 *
 * - the word alone on a line (`----`, `[source]`, `[[a]]`),
 * - the word starting a line that continues (`* `, `. `, `<1> `,
 *   `NOTE: ` all require that trailing text to match, and fill()
 *   would supply it with the very next word).
 *
 * Both the interrupting shapes and the RAW ones count, and the
 * difference in the QUESTION is the point. The reader asks "does this
 * line end the block", to which a comment or preprocessor directive
 * answers no (the reader consumes it before block structure exists).
 * Reflow asks "may this word begin a line", and there the same
 * shapes answer yes for a different reason — `//` at column 0
 * comments out everything fill() packed after it, and `ifdef::x[]`
 * swallows it into a directive. Text destroyed is text destroyed,
 * whether by a new block or by the preprocessor.
 * @param word - A single non-empty whitespace-delimited token
 *   from the paragraph text, as produced by String.split on
 *   whitespace. Callers guarantee it contains no whitespace.
 * @returns True when the word would start a block, or be eaten by
 *   the preprocessor, at line start
 */
export function isBlockSyntaxAtLineStart(word: string): boolean {
  // A lone `+` is the one interrupter this rule must NOT act on: it
  // is handled by the line-END rule (isDangerousAtLineEnd) and by
  // escapeDanglingPlus, and gluing it backwards here would put ` +`
  // at the end of a line instead — a hard line break.
  if (word === CONTINUATION_WORD) {
    return false;
  }
  // The word alone, then the word with a successor after it — the
  // two lines fill() can produce from it.
  const startingALine = `${word} ${PROBE_SUFFIX}`;
  return (
    interruptsByLineShape(word) ||
    interruptsByLineShape(startingALine) ||
    isRawParagraphLine(word) ||
    isRawParagraphLine(startingALine)
  );
}

/**
 * Detect words that would become AsciiDoc syntax when
 * placed at end of a line (before a fill() break). Such
 * words are glued to their successor so fill() breaks
 * before the word rather than after it.
 * @param word - A single non-empty whitespace-delimited token
 *   from the paragraph text.
 * @returns True when placing this word at line end would
 *   produce AsciiDoc syntax in the reflowed output
 */
function isDangerousAtLineEnd(word: string): boolean {
  // A bare `+` preceded by a space (from fill() joining)
  // would become ` +\n` — a hard line break.
  return word === CONTINUATION_WORD;
}

// ── Public API ─────────────────────────────────────────────

/**
 * Append a content group to a fill parts array, preceded by a
 * `line` separator unless it is the first group. Maintains the
 * content/separator alternation that fill() requires.
 * @param parts - The fill parts array being built (mutated).
 * @param content - The content group to append.
 */
function pushGroup(parts: Doc[], content: Doc): void {
  // Only a content element needs a separator in front of it. The
  // dlist guard below pushes a `hardline` straight into `parts`, so
  // the last element may already BE the separator; adding another
  // would put two separators in a row and desynchronize fill()'s
  // content/separator alternation for the rest of the paragraph.
  if (parts.length > 0 && !isFillSeparator(parts.at(-1))) {
    parts.push(line);
  }
  parts.push(content);
}

/**
 * Escape a dangling `+` pending group. A `+` that ends the
 * word list has no successor to glue to, so it will always
 * appear at end of an output line, where AsciiDoc would
 * re-parse ` +\n` as a hard line break (or a lone `+` line as
 * a list continuation). The replacement is the `{plus}`
 * built-in attribute reference, which renders as `+` —
 * backslash is NOT a recognized escape for `+` in Asciidoctor
 * (` \+` renders a literal backslash), so the previously used
 * `\+` changed the rendered text.
 * @param pending - The final pending content group (may be
 *   undefined when the word list was empty).
 * @param escape - Whether escaping is enabled for this text
 *   (disabled when a sibling follows in the same fill, or
 *   inside a formatting span whose closing mark follows the
 *   word in the output).
 * @returns The pending group, with a bare trailing `+`
 *   rewritten to `{plus}` when escaping applies.
 */
function escapeDanglingPlus(
  pending: Doc | undefined,
  escape: boolean,
): Doc | undefined {
  return escape && pending === "+" ? "{plus}" : pending;
}

// Accumulator threaded through appendWord. `pending` is the content
// group being built — words that must stay on the same line — and is
// flushed into `parts` when the next word is safe to break before.
// `glueNext` records that `pending` ends with a word that is
// dangerous at line end, so the next word must fuse onto it.
interface PendingState {
  pending: Doc | undefined;
  glueNext: boolean;
}

/**
 * Fold one word into the fill being built, applying all three reflow
 * safety rules. Split out of wordsToFillParts so each rule stays
 * readable (and to keep both functions under the complexity limit).
 * @param parts - The fill parts array so far, appended to in place.
 * @param state - The pending group and glue flag before this word.
 * @param word - The next whitespace-delimited token, non-empty.
 * @param forceBreakBefore - True when the word must not reach the
 *   block's first output line, where it would re-parse as a
 *   description-list term.
 * @returns The pending group and glue flag after this word.
 */
function appendWord(
  parts: Doc[],
  state: PendingState,
  word: string,
  forceBreakBefore: boolean,
): PendingState {
  let { pending, glueNext } = state;
  // Rules 1 and 2 fuse `word` backwards onto `pending`: the previous
  // word is dangerous at line end (a bare `+`), or this word is
  // dangerous at line start. Either way the two must share a line.
  const fuseBackwards = glueNext || isBlockSyntaxAtLineStart(word);
  if (pending !== undefined && forceBreakBefore && fuseBackwards) {
    // Rule 3 must not split what rules 1 and 2 fused: breaking here
    // would put a bare `+` at end of line (a hard line break) or a
    // list marker at column 0 — the very syntax they prevent. Same
    // invariant as the glued-sibling case: the break goes in the
    // separator slot IN FRONT of the whole run. Pushing the marker
    // now claims that slot; pushGroup then skips its own `line`
    // when the run is finally flushed.
    parts.push(DLIST_HAZARD_BREAK);
    pending = [pending, " ", word];
    glueNext = false;
  } else if (forceBreakBefore) {
    // Nothing to fuse to: flush pending so the marker lands in a
    // separator slot. When the hazard word opens this text node,
    // parts is empty and the marker becomes the node's first
    // element — the signal to flattenForFill that the word may be
    // glued to the preceding inline sibling.
    if (pending !== undefined) {
      pushGroup(parts, pending);
    }
    parts.push(DLIST_HAZARD_BREAK);
    // The hazard word becomes the new pending group rather than
    // being flushed outright: a following word that must be glued to
    // its predecessor still needs a pending group to fuse into.
    pending = word;
    glueNext = false;
  } else if (pending === undefined) {
    // First word — nothing to merge with yet.
    pending = word;
  } else if (fuseBackwards) {
    // Rules 1 and 2 without a hazard word in play.
    pending = [pending, " ", word];
    glueNext = false;
  } else {
    // Safe word: flush the pending group and start new.
    pushGroup(parts, pending);
    pending = word;
  }
  // If this word is dangerous at line end, the *next* word must be
  // glued to it.
  return { pending, glueNext: glueNext || isDangerousAtLineEnd(word) };
}

/**
 * Convert a word list into a Doc array for fill().
 * Words are interleaved with `line` so fill() can break
 * between them. Three safety mechanisms prevent reflow
 * from creating syntax:
 * 1. Words dangerous at line START are glued to their
 *    predecessor so fill() breaks before the pair.
 * 2. Words dangerous at line END (`+`) are glued to
 *    their successor so fill() breaks before them.
 * 3. Words dangerous only on the FIRST line of a block (a
 *    `term::` description-list separator) get a hard break in
 *    front of them, which no amount of packing can undo.
 * @param words - Array of whitespace-delimited tokens already
 *   split from the paragraph text. Each element is non-empty
 *   and contains no whitespace. The array itself may be empty,
 *   in which case an empty Doc array is returned.
 * @param options - Reflow safety switches.
 * @param options.firstLineWordCount - How many leading words came
 *   from the paragraph's FIRST source line. Words after that many
 *   were on a later line, where Asciidoctor treats a `term::` word
 *   as plain text; moving one onto the first output line would
 *   re-parse the block as a description list. Defaults to "all
 *   words", which disables the guard for callers that cannot say.
 * @param options.escapeTrailingPlus - Whether a `+` with no
 *   successor word should be rewritten to `{plus}`. True for
 *   text that truly ends its enclosing fill(), where the word
 *   could land at the end of an output line and be re-parsed
 *   as a hard line break or list continuation. False when an
 *   inline sibling follows (the printer glues the `+` forward
 *   instead) or inside a formatting span (`` `+` ``): the
 *   closing mark follows the word in the output, so it can
 *   never end a line bare — and rewriting it would corrupt
 *   the span's content.
 * @returns Doc array suitable for Prettier's fill()
 */
export function wordsToFillParts(
  words: string[],
  options?: { escapeTrailingPlus?: boolean; firstLineWordCount?: number },
): Doc[] {
  const escapeTrailingPlus = options?.escapeTrailingPlus ?? true;
  const firstLineWordCount = options?.firstLineWordCount ?? words.length;
  const parts: Doc[] = [];
  let state: PendingState = { pending: undefined, glueNext: false };
  for (const [index, word] of words.entries()) {
    // A word ending in a description-list separator (`term::`,
    // `term;;`) is plain text mid-paragraph but IS a dlist term on
    // the first line of a block. When it came from a later source
    // line, packing it onto the first output line would silently
    // turn the paragraph into a description list.
    const forceBreakBefore =
      index >= firstLineWordCount && DLIST_SEPARATOR_WORD.test(word);
    state = appendWord(parts, state, word, forceBreakBefore);
  }
  // If the last word was dangerous at line end and had no
  // successor to glue to, escape it (see escapeDanglingPlus).
  const last = escapeDanglingPlus(state.pending, escapeTrailingPlus);
  // Flush the last pending group.
  if (last !== undefined) {
    pushGroup(parts, last);
  }

  return parts;
}

// ── Fill alignment ─────────────────────────────────────────

// Prettier's `line`, `literalline` and `hardline` are the
// only separator-type Docs used in fill() arrays by this
// plugin. Checking reference identity (===) is safe
// because these are module-level singletons exported from
// Prettier's doc.builders.

/**
 * Check whether a Doc element occupies a fill() SEPARATOR slot
 * rather than a content slot. The single source of truth for that
 * distinction: `pushGroup`, `flattenForFill` and the hazard-break
 * resolution all consult it to keep fill()'s content/separator
 * alternation intact.
 * @param element - A Doc element from a fill parts array, or
 *   undefined when the array is empty (never a separator).
 * @returns True when the element is one of the separators this
 *   plugin emits (`line`, `literalline`, `hardline`, or the
 *   unresolved DLIST_HAZARD_BREAK marker)
 */
function isFillSeparator(element: Doc | undefined): boolean {
  return (
    element === line ||
    element === literalline ||
    element === hardline ||
    element === DLIST_HAZARD_BREAK
  );
}

/**
 * Turn a soft `line` separator into a forced break. `literalline`
 * and `hardline` already break, so they are left alone rather than
 * normalized — a hard line break's `literalline` must keep resetting
 * to column 0.
 * @param result - The fill array being built (mutated).
 * @param index - Position of the separator to harden.
 */
function hardenSeparator(result: Doc[], index: number): void {
  if (result[index] === line) {
    result[index] = hardline;
  }
}

/**
 * Resolve a DLIST_HAZARD_BREAK marker against the fill assembled so
 * far, upholding the invariant in the module comment: the break must
 * land on the separator in front of the fused content run that will
 * contain the hazard word.
 * @param result - The fill array being built (mutated); the marker
 *   itself is never appended, only resolved into a break.
 * @param glued - True when the marker opened its node's parts, so
 *   the hazard word carries no leading whitespace and will fuse onto
 *   whatever content precedes it. False when a word of the same text
 *   node precedes it, in which case the marker IS the separator.
 */
function resolveHazardBreak(result: Doc[], glued: boolean): void {
  const lastElement = result.at(-1);
  if (isFillSeparator(lastElement)) {
    // The marker already sits in a separator slot (a sibling's
    // trailing boundary, or a hard line break). Harden that one
    // instead of adding a second separator, which would emit two
    // newlines and desynchronize the alternation.
    hardenSeparator(result, result.length - 1);
    return;
  }
  if (!glued && result.length > 0) {
    // Whitespace separates the hazard word from the preceding word
    // of its own text node, so the marker is the separator.
    result.push(hardline);
    return;
  }
  // Glued (or the fill is still empty): the hazard word fuses onto
  // the content run that ends `result`, so a break here would insert
  // whitespace the source did not have. Harden the separator in
  // front of that run instead — alternation
  // guarantees the most recent separator is exactly that one.
  const separatorIndex = result.findLastIndex((element) =>
    isFillSeparator(element),
  );
  if (separatorIndex !== -1) {
    hardenSeparator(result, separatorIndex);
    return;
  }
  // No separator anywhere: the run reaches back to the start of this
  // fill, so the break belongs BEFORE the fill itself. Keep the
  // marker in front instead of dropping it — dropping would silently
  // disable the guard exactly where a fill is a formatting span's
  // contents, and the span printer re-emits a leading marker to the
  // enclosing fill, which does have a separator to harden.
  result.unshift(DLIST_HAZARD_BREAK);
}

/**
 * Whether appending `element` would put two content elements next to
 * each other with no separator between them, which desynchronizes
 * fill()'s even/odd alternation for everything that follows.
 * @param lastElement - The element already at the end of the fill
 *   array, or undefined when it is still empty (nothing to fuse to).
 * @param element - The element about to be appended.
 * @returns True when the two must be fused into one content unit.
 */
function isAdjacentContent(
  lastElement: Doc | undefined,
  element: Doc,
): boolean {
  return (
    lastElement !== undefined &&
    !isFillSeparator(lastElement) &&
    !isFillSeparator(element)
  );
}

/**
 * Flatten an array of child Doc outputs into a single
 * fill()-compatible array, preserving the content/separator
 * alternation that fill() requires.
 *
 * Prettier's fill() expects `[content, sep, content, ...]`
 * where even-indexed elements are content and odd-indexed
 * are separators (`line`). A naive `.flat()` breaks this
 * invariant when inline formatting nodes (italic, bold,
 * xref, etc.) contribute elements to the array without
 * a `line` separator at the junction with adjacent text.
 *
 * For example, `_Nexus_,` produces three children whose
 * flattened parts look like:
 *   `[..., "and", line, "_Nexus_", ",", line, "the", ...]`
 * The comma at index 3 is in a separator position but is
 * really content. This function detects adjacent content
 * elements (neither is a `line` separator) and fuses them
 * into a single content unit, fixing the alignment.
 * @param children - Array of Doc values returned by
 *   `path.map(print, "children")`, one per child node.
 *   Each may be an array of fill parts (text, formatting)
 *   or a single atomic Doc (xref string, etc.).
 * @returns Flat Doc array suitable for fill(), with
 *   content and separator elements properly alternating
 */
export function flattenForFill(children: Doc[]): Doc[] {
  const result: Doc[] = [];

  for (const child of children) {
    // Spread one level (equivalent to .flat()): array
    // children contribute their individual elements;
    // non-array Docs (strings, Doc commands) contribute
    // a single element.
    const elements: Doc[] = Array.isArray(child) ? (child as Doc[]) : [child];

    for (const [elementIndex, element] of elements.entries()) {
      if (element === DLIST_HAZARD_BREAK) {
        // A marker that opened this child's parts (index 0) means no
        // leading whitespace, so its hazard word will fuse onto the
        // preceding content — the "glued" case.
        resolveHazardBreak(result, elementIndex === 0);
        continue;
      }
      const lastElement = result.at(-1);
      if (isAdjacentContent(lastElement, element)) {
        // Fuse into one content unit so fill() keeps the pieces
        // together and measures their combined width correctly.
        const lastIndex = result.length - 1;
        result[lastIndex] = [result[lastIndex], element];
      } else if (isFillSeparator(lastElement) && isFillSeparator(element)) {
        // Two separators in a row is the mirror image of the fusing
        // case, and just as corrupting: fill() reads the second one
        // as CONTENT and prints it, so a `line` after a forced break
        // becomes a stray leading space and a second forced break
        // becomes a blank line — which ends the block on re-parse.
        // A node that owns its output line (a hard line break, a
        // verbatim raw line) emits a break on BOTH sides, so this
        // happens whenever two of them meet, or one meets a text
        // node whose whitespace boundary asks for a break of its own.
        // Keep the stronger of the two: a forced break outranks a
        // soft `line`, never the reverse.
        if (lastElement === line) {
          result.splice(-1, 1, element);
        }
      } else {
        result.push(element);
      }
    }
  }

  return result;
}

/**
 * Drop a hazard marker left leading a BLOCK-level fill. Resolution
 * hoists an unresolvable marker to the front of its fill so a
 * formatting span can pass it outwards (see DLIST_HAZARD_BREAK); at
 * the top of a paragraph or list item there is nowhere further to
 * pass it, and no earlier line to keep the hazard word off — the
 * word is already on the block's first output line, which is where
 * a first-source-line term belongs. Emitting the marker there would
 * open the block with a blank line, so it is dropped.
 *
 * This strip FIRES. Measured: `"+\nterm2:: def2\n"` prints as
 * `"+ term2:: def2\n"`, and three cases in the conformance corpus
 * reach it, all description-list (`term::`) syntax. Why a marker
 * leads the fill there is open — see issue #43.
 *
 * A strip rather than an `unreachable()` assertion because the
 * consequence of being wrong differs by an order of magnitude — a
 * stray marker costs one missed guard on one paragraph, while an
 * assertion would abort formatting the whole file over a corner case
 * in position bookkeeping.
 * @param parts - Flattened fill parts for a block's inline content.
 * @returns The same parts, without a leading hazard marker.
 */
export function stripLeadingHazardBreak(parts: Doc[]): Doc[] {
  return parts[0] === DLIST_HAZARD_BREAK ? parts.slice(1) : parts;
}

/**
 * Make a block's inline content print on at least two lines: the last
 * soft separator of its flattened fill parts that has CONTENT after it
 * becomes a hard break.
 *
 * A list item whose text is followed by a trailing titled metadata run
 * (`hazard(item) === "keepBreak"`, Ruling 28/29) needs this: reflowed onto
 * one line, the run's first line would be the first line after the
 * marker line, where Asciidoctor folds it and reads the title as text.
 * ANY break in the text suffices — the run folds only on the first rest
 * line — so the decision is made here at paragraph level, after the
 * parts are flattened, and is robust to spans, macros, glue and hazard
 * resolution by construction: no word index, no position. A last
 * separator that is already hard (a raw line's, a hard line break's, or
 * a hazard break) needs nothing; parts with no separator at all — one
 * unbreakable unit — are left alone.
 *
 * Ruling 30: separators in the FINAL slots are skipped. Text whose last
 * source line ends in whitespace gets a trailing `line` appended
 * (`pushTrailingBoundary`) so the whitespace can still break between
 * this block and whatever follows; hardening THAT separator would print
 * a blank line after the item text and detach the very run this break
 * exists to keep attached. Only a separator with content after it puts
 * a break INSIDE the text.
 * @param parts - Flattened fill parts for the block's inline content.
 * @returns The same parts, with that separator hardened.
 */
export function keepLastBreak(parts: Doc[]): Doc[] {
  const lastContent = parts.findLastIndex(
    (element) => !isFillSeparator(element),
  );
  if (lastContent === -1) {
    return parts;
  }
  const last = parts
    .slice(0, lastContent)
    .findLastIndex((element) => isFillSeparator(element));
  if (last === -1 || parts[last] !== line) {
    return parts;
  }
  return parts.with(last, hardline);
}
