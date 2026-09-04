/**
 * The three answers every list-like item's body is assembled from,
 * shared by the two seams that assemble one: what a confined read
 * produced, which source lines the principal text occupied, and
 * whether all of them stand at an indent.
 *
 * ONE home rather than a copy per item kind. A marker item and a
 * description item share the body half of their shape whole
 * ({@link ItemBody}, src/ast.ts), so the questions asked to fill it
 * are the same questions, and two spellings of one transcription of
 * Ruby is two chances to answer differently from Ruby. Declared
 * BELOW both seams, which is what the copies were working around:
 * list-read.ts imports the seams, so a seam could not reach back for
 * a shape declared there without a cycle.
 *
 * Every Ruby line number cites parser.rb at Asciidoctor core 2.0.26,
 * the revision the oracle runs.
 */
import type { BlockNode } from "../../ast.js";
import type { InlineToken } from "../inline/tokens.js";
import { LINE_COMMENT_HEAD } from "../line-shapes.js";
import type { LocationIndex } from "../positions.js";
import { isLiteralLine } from "./classify.js";
import type { SourceLine } from "./split.js";

/**
 * What reading one item's interior produced: the principal text as
 * tokens, and the blocks that followed it in source order.
 */
export interface ItemInterior {
  /** The item's principal text, as tokens. */
  readonly text: InlineToken[];
  /** The item's blocks, in source order. */
  readonly blocks: BlockNode[];
}

/**
 * The last source line an item's principal text occupies - where the
 * first block's gap starts counting from, and where the item's
 * recorded lines stop.
 *
 * TOTAL over empty text, and the item's OPENING line is the honest
 * answer there. No marker shape LIST_MARKER_LINE admits leaves the
 * text empty today, and a term with no description of its own writes
 * nothing under itself, but reading `text.at(-1)` without the arm
 * would throw rather than answer.
 * @param at - the document's offset-to-Location index
 * @param text - the item's principal text, as tokens
 * @param openingLine - the item's marker or term line
 * @returns the 1-based line number
 */
export function textEndLine(
  at: LocationIndex,
  text: readonly InlineToken[],
  openingLine: SourceLine,
): number {
  const last = text.at(-1);
  if (last === undefined) {
    return openingLine.line;
  }
  // One BEFORE the exclusive end: a token ending at a newline must
  // report the line it ends ON, not the next one.
  return at.at(last.offset + Math.max(last.image.length, 1) - 1).line;
}

/**
 * The source lines an item's principal text was read from: everything
 * under its opening line down to where the text ends.
 *
 * Taken from the item's own BUFFER, which is where the raw spelling
 * of those lines already is - the scan handed them over with their
 * indentation intact, so the questions below are asked of the source
 * rather than of the nodes the text was split into.
 * @param buffer - the item's lines, in document order
 * @param openingLine - the 1-based marker or term line, excluded
 * @param textEnd - the 1-based last line the text occupies, included
 * @returns the recorded lines, in document order
 */
export function recordedTextLines(
  buffer: readonly SourceLine[],
  openingLine: number,
  textEnd: number,
): SourceLine[] {
  return buffer.filter(
    (line) => line.line > openingLine && line.line <= textEnd,
  );
}

/**
 * Whether every source line the item's text wrote under its opening
 * line stands at an indent: `ItemBody.everyTextLineIndented`
 * (src/ast.ts carries the Ruby argument and the two exempt kinds).
 *
 * THREE disjuncts, and only the last is the indent test. The other
 * two are `adjust_indentation!`'s own exemptions, transcribed: a
 * blank line, which the walk skips (`next if line.empty?`,
 * parser.rb:2726), and a `//` line, which `read_paragraph_lines`
 * drops before the strip runs (l.754). The blank row cannot be
 * reached from a marker item's extent - a blank ends the principal
 * text, so no line under the marker is empty - and it stays anyway:
 * it is a row of the RULE, not a guard on one call, and dropping it
 * would make the transcription answer differently from Ruby the
 * first time an extent runs through a blank.
 *
 * VACUOUSLY TRUE where the item recorded no lines at all, which is
 * every item whose description lives on its opening line.
 * @param textLines - the recorded lines, rstripped
 * @returns true when no recorded line stands at column 0
 */
export function everyTextLineIndented(textLines: readonly string[]): boolean {
  return textLines.every(
    (text) =>
      text === "" || text.startsWith(LINE_COMMENT_HEAD) || isLiteralLine(text),
  );
}
