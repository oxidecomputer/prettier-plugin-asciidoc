/* eslint-disable require-unicode-regexp -- Chevrotain's regexp-to-ast does not support the v flag */

/**
 * Tokens for the lexer's `paragraph` mode.
 *
 * Extracted from tokens.ts (which is at its max-lines budget) the
 * same way inline-link-tokens.ts was, and re-exported from there.
 *
 * ## Why the mode exists
 *
 * The lexer used to re-classify EVERY line as if it stood at the top
 * of a block: a `.Title`-shaped or `* item`-shaped line in the middle
 * of a paragraph became a block title or a list. Asciidoctor does the
 * opposite — an open paragraph swallows every following line until a
 * blank line or one of a tiny interrupting set (issues #26, #27, #29).
 *
 * `paragraph` mode is that "a paragraph is open" state. Once
 * InlineModeStart pushes into it, only ParagraphEnd can leave, and it
 * consults src/parse/line-shapes.ts — the single source of truth,
 * shared with reflow — to decide. Everything else on the line is
 * either a verbatim raw line or ordinary inline content.
 *
 * ## Offsets inside the mode
 *
 * Paragraph mode is entered at two kinds of offset, which is why
 * ParagraphEnd and ParagraphRawLine both require a line start:
 *
 * - at a LINE START, after InlineNewline popped inline mode, and
 * - MID-LINE, right after InlineModeStart (which can fire after a
 *   list marker or an admonition label), and right after a
 *   ParagraphRawLine, whose terminating `\n` is still unconsumed.
 */
import { createToken, Lexer } from "chevrotain";
import type { CustomPatternMatcherReturn, IToken } from "chevrotain";
import { EMPTY, FIRST, LAST_ELEMENT, NEXT, NOT_FOUND } from "../constants.js";
import { isMarkerLineText } from "./continuation-markers.js";
import {
  BLOCK_ANCHOR_SOURCE,
  interruptsParagraph,
  isBlockMetadataLine,
  isDelimiterLine,
  isDescriptionListLine,
  isPreprocessorConditional,
  isRawParagraphLine,
  keepsListOpenAfterBlankLine,
  listMarkerStyle,
  type ParagraphContext,
} from "./line-shapes.js";

// Token type names matched by string rather than by identity: these
// tokens live in tokens.ts, which imports THIS module, so importing
// them back would be a cycle. Same technique as delimiter-patterns.ts.
const LIST_MARKER_TOKENS = new Set([
  "UnorderedListMarker",
  "OrderedListMarker",
  "CalloutListMarker",
]);
const PARAGRAPH_START_TOKEN = "InlineModeStart";

// The shortest possible list marker image (`* `, `- `, `. `). Once
// the ancestry walk has seen one, no enclosing list can be shallower,
// so the walk can stop.
const SHORTEST_MARKER = 2;

// A whole-line block anchor, the one raw shape whose verdict needs
// the paragraph's context. Tested first so ParagraphRawLine pays for
// the token look-back only on the handful of lines shaped like one.
const BLOCK_ANCHOR_LINE = new RegExp(`^${BLOCK_ANCHOR_SOURCE}$`);

// A section heading closes every open list, so the ancestry scan
// stops there. Mirrors `Parser.next_block`'s section handling, which
// is reached only outside a list reader.
const SECTION_HEADING = /^={1,6} /;

/**
 * Read the rest of the current line without consuming it.
 * @param text - the full source being lexed
 * @param offset - where to start reading
 * @returns the characters up to the next newline (or end of input)
 */
function lineAt(text: string, offset: number): string {
  const end = text.indexOf("\n", offset);
  return text.slice(offset, end === NOT_FOUND ? text.length : end);
}

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
 * Whether `offset` sits at the first character of a source line.
 * Both ParagraphEnd and ParagraphRawLine classify a WHOLE line, so
 * neither may fire at a mid-line offset — `* // c` is item text, not
 * a comment, and the `\n` that terminates a raw line is not a blank
 * line.
 * @param text - the full source being lexed
 * @param offset - the offset being classified
 * @returns true at a line start (offset 0 counts)
 */
function atLineStart(text: string, offset: number): boolean {
  return offset === EMPTY || text[offset - NEXT] === "\n";
}

/**
 * Whether the line at `offset` is the FIRST one after the block
 * started — the position several line shapes depend on (see
 * InterruptionOptions.firstLineAfterBlockStart).
 * @param text - the full source being lexed
 * @param offset - the line start being classified
 * @param startOffset - where the open paragraph began (possibly
 *   mid-line, after a list marker)
 * @returns true when exactly one line separates the two offsets
 */
function isFirstLineAfterBlockStart(
  text: string,
  offset: number,
  startOffset: number,
): boolean {
  const firstLineStart = lineStartAt(text, startOffset);
  return offset === firstLineStart + lineAt(text, firstLineStart).length + NEXT;
}

/**
 * What a line between a `+` and the block it attaches does to
 * `read_lines_for_list_item`'s `continuation` state. See
 * continuationLineKind for which shape is which and why.
 */
type ContinuationLineKind = "blank" | "transparent" | "metadata" | "content";

/**
 * Classify one line of the run between a `+` and the paragraph below
 * it.
 * @param line - the source line, without its newline
 * @returns its kind, or undefined when the line cannot be part of
 *   such a run at all (an ordinary content line would have opened
 *   the paragraph itself)
 */
function continuationLineKind(line: string): ContinuationLineKind | undefined {
  if (line.trim() === "") {
    return "blank";
  }
  // A conditional directive never reaches the parser at all:
  // PreprocessorReader consumes it while reading, so it neither
  // buffers nor changes any state.
  if (isPreprocessorConditional(line)) {
    return "transparent";
  }
  // Block metadata gets its own branch in read_lines_for_list_item —
  // "let block metadata play out until we find the block" — which
  // buffers the line and LEAVES the continuation active.
  if (isBlockMetadataLine(line)) {
    return "metadata";
  }
  // A comment line (and the sentence an unresolved include leaves
  // behind) is read like ordinary content here: the method calls
  // `reader.read_line` with no comment skipping of its own.
  return isRawParagraphLine(line) ? "content" : undefined;
}

/**
 * Replay `read_lines_for_list_item` over the lines between a `+` and
 * the paragraph below them, to decide whether the paragraph is still
 * inside the item.
 *
 * The state that matters is Ruby's `continuation`, which the `+`
 * sets to `:active`. While active, the loop's
 * `continuation == :active && !this_line.empty?` branch takes every
 * non-blank line: block metadata leaves it active, anything else
 * turns it `:inactive`. A blank line falls through to the plain
 * `else` and changes nothing. Once inactive, a blank line becomes
 * `prev_line` and the next line hits the `prev_line.empty?` branch,
 * which BREAKS for anything but a `+`, a nested marker or a literal
 * paragraph — none of which can be in this run.
 *
 * Hence the asymmetry the oracle shows: `+` / blank / `para` and
 * `+` / `// c` / `para` both attach, `+` / `// c` / blank / `para`
 * does not.
 * @param kinds - the run's line kinds, in source order
 * @returns true when the paragraph below the run is still attached
 */
function continuationReachesParagraph(
  kinds: readonly ContinuationLineKind[],
): boolean {
  let active = true;
  // Whether the last line the loop BUFFERED was blank; transparent
  // lines never enter the buffer, so they leave this alone.
  let previousBlank = false;
  for (const kind of kinds) {
    if (kind === "transparent") {
      continue;
    }
    if (active && kind !== "blank") {
      active = kind === "metadata";
    } else if (previousBlank) {
      return false;
    }
    previousBlank = kind === "blank";
  }
  // The paragraph's own first line is ordinary, non-blank content.
  return active || !previousBlank;
}

/**
 * Start offset of the lone `+` that attached the paragraph beginning
 * at `offset`, or undefined when no `+` did.
 *
 * A `+` need not touch the block it attaches: block metadata, the
 * lines the reader eats, and blank lines may sit in between. Which
 * ORDERS survive is continuationReachesParagraph's business; this
 * function walks back to the marker and hands it the run.
 * @param text - the full source being lexed
 * @param offset - an offset on the paragraph's first line
 * @returns the `+` line's start offset, or undefined
 */
function attachingContinuationStart(
  text: string,
  offset: number,
): number | undefined {
  // Collected bottom-up; the replay above wants source order.
  const kinds: ContinuationLineKind[] = [];
  let cursor = lineStartAt(text, offset);
  let belowWasBlank = false;
  while (cursor > EMPTY) {
    const start = lineStartAt(text, cursor - NEXT);
    const line = text.slice(start, cursor - NEXT);
    if (isMarkerLineText(line)) {
      return continuationReachesParagraph(kinds.toReversed())
        ? start
        : undefined;
    }
    const kind = continuationLineKind(line);
    if (kind === undefined) {
      return undefined;
    }
    // Two blank lines in a row end the item wherever they fall
    // (`skip_blank_lines` then break), so the scan can stop here
    // rather than walk a document made of blank lines.
    if (kind === "blank" && belowWasBlank) {
      return undefined;
    }
    belowWasBlank = kind === "blank";
    kinds.push(kind);
    cursor = start;
  }
  return undefined;
}

/**
 * Index of the InlineModeStart that opened the paragraph currently
 * being lexed. Walking back from the END finds it first: entering
 * paragraph mode requires an InlineModeStart, and no other one can be
 * emitted before this paragraph closes — so the scan is bounded by
 * the CURRENT paragraph's token count, not by the document's.
 * @param tokens - tokens emitted so far (Chevrotain's matchedTokens)
 * @returns the index, or NOT_FOUND when no paragraph is open
 */
function paragraphStartIndex(tokens: IToken[]): number {
  return tokens.findLastIndex(
    (token) => token.tokenType.name === PARAGRAPH_START_TOKEN,
  );
}

// The Markdown fence tip. `is_delimited_block?` chops any 4th
// character off a fence and requires the rest to be exactly this, so
// ` ```ruby ` and ` ``` ` open and close the same block even though
// the lines differ — which is why the opener search below cannot be
// pure string equality.
const FENCE_TIP = "```";

/**
 * Whether two delimiter lines belong to the same block.
 *
 * `read_lines_until terminator:` compares the terminator as a whole
 * line, and the reader has already rstripped both — except for a
 * fence, whose opener may carry a language hint the terminator never
 * has.
 * @param opener - a candidate opening delimiter line
 * @param close - the closing delimiter line
 * @returns true when `opener` opens the block `close` terminates
 */
function samePairedDelimiter(opener: string, close: string): boolean {
  if (close.trimEnd().startsWith(FENCE_TIP)) {
    return opener.startsWith(FENCE_TIP);
  }
  return opener.trimEnd() === close.trimEnd();
}

/**
 * Start offset of the delimiter line that OPENS the block whose
 * closing delimiter sits at `closeStart`, so the ancestry scan can
 * step over a delimited block in one move (its content may contain
 * blank lines and marker-shaped text that mean nothing out here).
 * @param text - the full source being lexed
 * @param closeStart - start offset of the closing delimiter line
 * @param close - the closing delimiter line's text
 * @returns the opener's start offset, or NOT_FOUND
 */
function delimiterOpenerStart(
  text: string,
  closeStart: number,
  close: string,
): number {
  let cursor = closeStart;
  while (cursor > EMPTY) {
    const start = lineStartAt(text, cursor - NEXT);
    const line = text.slice(start, cursor - NEXT);
    if (samePairedDelimiter(line, close)) {
      return start;
    }
    cursor = start;
  }
  return NOT_FOUND;
}

/**
 * Record `line`'s marker style when it is an ancestor of the ones
 * already recorded — an outer list's marker is strictly shorter than
 * its descendant's (`*` outside `**`).
 * @param line - the candidate marker line
 * @param styles - accumulated styles, innermost first (mutated)
 * @param lengths - the accepted marker image lengths (mutated)
 * @returns true when no shorter marker can exist, so the scan may
 *   stop
 */
function takeMarkerStyle(
  line: string,
  styles: string[],
  lengths: number[],
): boolean {
  const shortest = lengths.at(LAST_ELEMENT) ?? Number.POSITIVE_INFINITY;
  const style = listMarkerStyle(line);
  // A marker's image is its style plus the space that follows.
  const imageLength = style === undefined ? shortest : style.length + NEXT;
  if (style === undefined || imageLength >= shortest) {
    return false;
  }
  lengths.push(imageLength);
  styles.push(style);
  return imageLength <= SHORTEST_MARKER;
}

/**
 * Marker styles of the list ancestry still OPEN at `offset`,
 * innermost first.
 *
 * Reads `read_lines_for_list_item` in reverse over the source lines:
 * an item keeps reading across a blank line only for a `+`, a nested
 * marker or a literal paragraph (see keepsListOpenAfterBlankLine),
 * and otherwise the list ends there — which is what stops this scan,
 * and what bounds it to the current list rather than the document.
 * A delimited block is stepped over whole. An ancestor's marker is
 * any earlier marker with a strictly shorter image (`*` outside
 * `**`), matching `is_sibling_list_item?` comparing marker styles.
 * @param text - the full source being lexed
 * @param offset - the paragraph's start offset
 * @returns the styles, innermost first; empty when no list is open
 */
function openListStyles(text: string, offset: number): string[] {
  const styles: string[] = [];
  // Marker image lengths accepted so far, shortest last.
  const lengths: number[] = [];
  let cursor = lineStartAt(text, offset);
  // First line of the run scanned so far — what the blank-line rule
  // asks about.
  let runFirstLine = lineAt(text, cursor);
  while (cursor > EMPTY) {
    const start = lineStartAt(text, cursor - NEXT);
    const line = text.slice(start, cursor - NEXT);
    if (
      SECTION_HEADING.test(line) ||
      (line.trim() === "" && !keepsListOpenAfterBlankLine(runFirstLine))
    ) {
      return styles;
    }
    if (isDelimiterLine(line)) {
      const opener = delimiterOpenerStart(text, start, line);
      if (opener === NOT_FOUND) {
        return styles;
      }
      cursor = opener;
      runFirstLine = lineAt(text, opener);
      continue;
    }
    if (takeMarkerStyle(line, styles, lengths)) {
      return styles;
    }
    runFirstLine = line;
    cursor = start;
  }
  return styles;
}

/**
 * Whether the paragraph at `startIndex` is a list item's own text:
 * its InlineModeStart follows a marker token with nothing between
 * them, which only happens on the marker's own line.
 * @param tokens - tokens emitted so far
 * @param startIndex - index of the paragraph's InlineModeStart
 * @param startOffset - that token's offset
 * @returns true when the paragraph is list-item text
 */
function opensListItemText(
  tokens: IToken[],
  startIndex: number,
  startOffset: number,
): boolean {
  const before = startIndex > FIRST ? tokens[startIndex - NEXT] : undefined;
  return (
    before !== undefined &&
    LIST_MARKER_TOKENS.has(before.tokenType.name) &&
    before.endOffset === startOffset - NEXT
  );
}

/** The open paragraph, before the (costlier) ancestry scan. */
interface OpenParagraph {
  context: ParagraphContext;
  /** Offset the paragraph started at; its first line never ends it. */
  startOffset: number;
  /** True when the paragraph's own first line is a lone `+`. */
  isContinuationMarker: boolean;
  /**
   * Where openListStyles must start its walk. Normally the
   * paragraph's own offset, but for a `listContinuation` it is the
   * attaching `+` line: the walk stops at a blank line the list
   * survives only when it can see the `+` as the run's first line.
   */
  listAncestryOffset: number;
}

/**
 * Classify the paragraph currently open, from the already-lexed
 * tokens: walk back to the InlineModeStart that opened it and look at
 * what precedes it. A list marker there means we are reading list-item
 * text; a first line — or a PREVIOUS line — that is a lone `+` means
 * we are reading the block a continuation attached to an item.
 *
 * Deliberately cheap: the enclosing-list ancestry (openListStyles) is
 * only needed in the `listContinuation` branch, so the caller asks
 * for it separately.
 * @param text - the full source being lexed
 * @param tokens - tokens emitted so far (Chevrotain's matchedTokens)
 * @returns the open paragraph's classification, or undefined when no
 *   paragraph is open (unreachable — paragraph mode is only entered
 *   through InlineModeStart)
 */
function openParagraph(
  text: string,
  tokens: IToken[],
): OpenParagraph | undefined {
  const startIndex = paragraphStartIndex(tokens);
  if (startIndex === NOT_FOUND) {
    return undefined;
  }
  const { [startIndex]: start } = tokens;
  const { startOffset } = start;
  const base = {
    startOffset,
    isContinuationMarker: false,
    listAncestryOffset: startOffset,
  };
  if (opensListItemText(tokens, startIndex, startOffset)) {
    return { ...base, context: "listItem" };
  }
  const firstLine = lineAt(text, startOffset);
  const isContinuationMarker = isMarkerLineText(firstLine);
  const markerStart = isContinuationMarker
    ? lineStartAt(text, startOffset)
    : attachingContinuationStart(text, startOffset);
  if (markerStart !== undefined) {
    return {
      ...base,
      context: "listContinuation",
      isContinuationMarker,
      listAncestryOffset: markerStart,
    };
  }
  // A first line carrying a `term::` separator opens a DESCRIPTION
  // LIST item, whose description Asciidoctor reads as block content
  // (see the `dlistItem` note in line-shapes.ts). We do not build
  // dlist nodes yet (issue #9), but classifying the lines correctly
  // keeps a nested list from being swallowed into the term's
  // paragraph.
  return {
    ...base,
    context: isDescriptionListLine(firstLine) ? "dlistItem" : "paragraph",
  };
}

/**
 * Zero-length, skipped token that POPS paragraph mode when the
 * upcoming line would end the paragraph: blank line / EOF, or one of
 * the registry's interrupting shapes for the open context. The line
 * itself is then lexed by default_mode as usual. This is the single
 * point where "what ends a paragraph" is decided — and it delegates
 * entirely to src/parse/line-shapes.ts.
 *
 * It must never fire on the paragraph's OWN first line: default_mode
 * already decided that line is paragraph text, so popping there would
 * hand the same offset straight back to InlineModeStart — an infinite
 * lexer loop for inputs like a lone `+`.
 *
 * The one rule here that is not a line shape is the
 * continuation-marker rule inside the matcher: a `+` line inside a
 * list is a whole paragraph by itself, because what follows it is a
 * new BLOCK and default_mode is what knows how to classify a block's
 * first line.
 */
export const ParagraphEnd = createToken({
  name: "ParagraphEnd",
  pattern: {
    exec: (
      text: string,
      offset: number,
      tokens: IToken[],
    ): CustomPatternMatcherReturn | null => {
      // eslint-disable-next-line unicorn/no-null -- Chevrotain requires null
      if (!atLineStart(text, offset)) return null;
      const open = openParagraph(text, tokens);
      // eslint-disable-next-line unicorn/no-null -- Chevrotain requires null
      if (open === undefined || open.startOffset === offset) return null;
      const styles =
        open.context === "listContinuation"
          ? openListStyles(text, open.listAncestryOffset)
          : [];
      // A `+` line INSIDE a list is a whole paragraph by itself: it
      // announces a new BLOCK, and that block's first line has to go
      // back through default_mode to be classified (`.Title`,
      // `image::x[]`, `NOTE:` are block syntax there, and only
      // there). Outside a list a `+` line is just the first word of
      // an ordinary paragraph — the oracle renders `first para` /
      // `+` / `second` as two paragraphs, the second reading
      // "+ second" — so the rule is gated on a list being open.
      const endsAfterMarker =
        open.isContinuationMarker && styles.length > EMPTY;
      const line = lineAt(text, offset);
      const ends =
        endsAfterMarker ||
        offset >= text.length ||
        line.trim() === "" ||
        interruptsParagraph(line, open.context, {
          enclosingListStyles: styles,
          firstLineAfterBlockStart: isFirstLineAfterBlockStart(
            text,
            offset,
            open.startOffset,
          ),
          // Until description lists are parsed (#9) the lexer has
          // nowhere to end a paragraph INTO at a `term::` line, and
          // popping there made formatting non-idempotent. See
          // InterruptionOptions.ignoreDescriptionListTerms.
          ignoreDescriptionListTerms: true,
        });
      // eslint-disable-next-line unicorn/no-null -- Chevrotain requires null
      return ends ? ([""] as CustomPatternMatcherReturn) : null;
    },
  },
  pop_mode: true,
  group: Lexer.SKIPPED,
  line_breaks: false,
});

/**
 * Whether the line at `offset` is one of the raw shapes that depend
 * on where we are: a whole-line `[[anchor]]` directly after a list
 * item's text, or a foreign list marker inside a `+`-attached
 * paragraph (see isRawParagraphLine). Split out so the far cheaper
 * context-free shapes are tested first — this is the only branch
 * that pays for the token look-back, and it runs at every line
 * start.
 * @param text - the full source being lexed
 * @param offset - the line start being classified
 * @param tokens - tokens emitted so far
 * @returns true when the line is raw in the open paragraph's context
 */
function isRawInContext(
  text: string,
  offset: number,
  tokens: IToken[],
): boolean {
  const line = lineAt(text, offset).trimEnd();
  if (!BLOCK_ANCHOR_LINE.test(line) && listMarkerStyle(line) === undefined) {
    return false;
  }
  const open = openParagraph(text, tokens);
  if (open === undefined) {
    return false;
  }
  return isRawParagraphLine(line, open.context, {
    enclosingListStyles:
      open.context === "listContinuation"
        ? openListStyles(text, open.listAncestryOffset)
        : [],
    firstLineAfterBlockStart: isFirstLineAfterBlockStart(
      text,
      offset,
      open.startOffset,
    ),
  });
}

/**
 * A line the paragraph continues AROUND rather than through: a
 * comment or preprocessor line anywhere, a block anchor directly
 * after a list item's text, and a foreign list marker inside a
 * `+`-attached paragraph. Emitted as a whole-line token so the AST
 * keeps it verbatim (RawLineNode) and the printer never reflows it
 * into visible text — reflowing would make a comment visible, make a
 * directive inert, turn a discarded block anchor into an inline
 * `<a id>`, or move a marker off column 0 and change what the next
 * `+` means.
 */
export const ParagraphRawLine = createToken({
  name: "ParagraphRawLine",
  pattern: {
    exec: (
      text: string,
      offset: number,
      tokens: IToken[],
    ): CustomPatternMatcherReturn | null => {
      // eslint-disable-next-line unicorn/no-null -- Chevrotain requires null
      if (!atLineStart(text, offset)) return null;
      const line = lineAt(text, offset);
      const raw =
        line.length > EMPTY &&
        (isRawParagraphLine(line) || isRawInContext(text, offset, tokens));
      // eslint-disable-next-line unicorn/no-null -- Chevrotain requires null
      return raw ? ([line] as CustomPatternMatcherReturn) : null;
    },
  },
  line_breaks: false,
});

/**
 * The newline that terminates a ParagraphRawLine. Stays in paragraph
 * mode: a raw line is lexed whole, so unlike a text line there is no
 * inline mode to pop out of when it ends.
 */
export const ParagraphNewline = createToken({
  name: "ParagraphNewline",
  pattern: /\n/,
  line_breaks: true,
});

/**
 * Zero-length token that pushes inline mode for one paragraph line.
 * Takes over InlineModeStart's old role in the grammar: `inlineLine`
 * now begins with ParagraphLineStart, while InlineModeStart marks
 * where the paragraph itself began.
 */
export const ParagraphLineStart = createToken({
  name: "ParagraphLineStart",
  pattern: {
    exec: (text: string, offset: number): CustomPatternMatcherReturn | null =>
      offset < text.length && text[offset] !== "\n"
        ? ([""] as CustomPatternMatcherReturn)
        : // eslint-disable-next-line unicorn/no-null -- Chevrotain requires null
          null,
  },
  push_mode: "inline",
  line_breaks: false,
});

/**
 * Token order for the lexer's `paragraph` mode.
 *
 * ParagraphEnd first, so a blank line after a raw line still ends the
 * paragraph. ParagraphRawLine before ParagraphNewline, so a raw line
 * is taken whole. ParagraphNewline before ParagraphLineStart, so the
 * `\n` that follows a raw line is consumed here rather than pushing
 * inline mode for an empty line.
 */
export const paragraphModeTokens = [
  ParagraphEnd,
  ParagraphRawLine,
  ParagraphNewline,
  ParagraphLineStart,
];
