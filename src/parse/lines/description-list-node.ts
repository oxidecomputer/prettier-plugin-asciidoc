/**
 * One description item's parsed SIBLING, assembled from what the
 * extent scan decided and what the confined reader read - the seam
 * list-item-node.ts is for a marker item, and the same shape: the
 * recursion that produced the interior happened in the caller, and
 * nothing here can start another.
 *
 * What this file adds over its marker sibling is the PARTITION. An
 * item's extent is written back as its term lines, each term's gap,
 * the source lines its text was read from, and then its blocks behind
 * their recorded gaps; every non-blank line of the extent belongs to
 * exactly one of the five, and nothing is dropped. The two pieces a
 * marker item has no need of are the term gap (the source between two
 * term lines Ruby folds onto one pair, parser.rb:1230-1235) and the
 * head drain (parser.rb:1363-1371), which is what makes that fold
 * reach the second term at all.
 *
 * Every Ruby line number cites parser.rb at Asciidoctor core 2.0.26,
 * the revision the oracle runs, exactly as list-reader.ts's do.
 */
import type {
  BlockNode,
  DescriptionPrinting,
  GapLine,
  TermGapLine,
} from "../../ast.js";
import { buildDescriptionTerm } from "../build/description-list.js";
import type { DescriptionPair } from "../build/description-list.js";
import { LINE_COMMENT_HEAD, rstrip } from "../line-shapes.js";
import type { LocationIndex } from "../positions.js";
import { tokenizeWholeText } from "../inline/tokenize.js";
import { isContinuationLine, type DlistTermKind } from "./classify.js";
import { descriptionPrinting } from "./description-list.js";
import {
  everyTextLineIndented,
  recordedTextLines,
  textEndLine,
  type ItemInterior,
} from "./item-body.js";
import { endsInPlusParagraph, gapsOf } from "./list-item-node.js";
import type { ListItemShape } from "./list-reader.js";
import { fragmentOfLine, type SourceLine } from "./split.js";

/**
 * What one source line inside a term's GAP spells.
 *
 * READS THE SOURCE, not the line's `text`, and the difference is the
 * whole point. `text` is what the READ left behind, and an enclosing
 * read may have rewritten it: `read_lines_for_list_item` erases a `+`
 * it activated into `ListContinuationPlaceholder` (parser.rb l.1439,
 * l.1576), which this scan ports as `text: ""` with `raw` intact
 * (item-tail.ts). A gap that read `text` there would record a BLANK
 * where the author wrote a `+`, and the byte would be gone with no
 * render to show it - which is the one direction a gap exists to
 * prevent. `raw` is the line as written and no read rewrites it, so
 * rstripping it is the same answer for every line the split produced
 * and the right one for every line a read has touched since.
 *
 * TOTAL over the three arms {@link TermGapLine} carries, and total on
 * purpose: the range this is asked over is the source between two
 * term lines Ruby folded onto one pair, every line of which the
 * sibling's own read turned into neither text nor a block. The only
 * lines that can do that are a blank, a `+` the read loop buffered
 * (l.1557-1559) and the post-loop pop discarded (l.1580-1582), and a
 * line `skip_line_comments` took, which is a `//` line. The last arm
 * is therefore the drain's, and it doubles as the answer that keeps a
 * byte rather than dropping it: whatever stands there goes back as
 * itself. A line the alphabet did not expect is a range drawn wrong,
 * and the description-list AST invariants are the alarm for that, not
 * this switch - and those invariants read the SOURCE line too, so a
 * later read that rewrote a gap line arrives red rather than silent.
 * @param line - one line of the range, as the split produced it
 * @returns the gap line it goes back as
 */
function gapLineOf(line: SourceLine): TermGapLine {
  const source = rstrip(line.raw);
  if (source === "") {
    return "";
  }
  return isContinuationLine(source) ? "+" : { comment: source };
}

/**
 * Where one sibling's recorded lines end - the line the NEXT sibling
 * of its list opens on, or nothing when no sibling follows.
 */
interface DescriptionBounds {
  /** The lines the list is being read from. */
  readonly lines: readonly SourceLine[];
  /** The document-wide gap record, complete for this item by now. */
  readonly gaps: ReadonlyMap<number, GapLine>;
  /** The document's offset-to-Location index. */
  readonly at: LocationIndex;
  /**
   * 1-based line number of the NEXT sibling's term line, or undefined
   * for the last sibling of the list.
   *
   * A sibling the fold ABSORBS writes its term line and then its gap,
   * and nothing else stands between it and the next term, so it owes
   * the gap every line down to that term. The last sibling owes no
   * such range: the lines under it are its item's tail, and a tail is
   * what the item's blocks and its `+` facts already answer for.
   */
  readonly nextTermLine: number | undefined;
  /**
   * 1-based line number one past the last line the head drain took
   * (list-read.ts), or the term line's own number where it took none.
   *
   * Its own bound because the drain is the one thing that deletes
   * lines from a sibling that HAS a body: `t:: item` / `//yin:: yang`
   * is one item whose description is `item`, and the comment the
   * drain took has no home in that description, in a block or in a
   * tail fact. Ruby simply loses it (parser.rb:1363-1371); a
   * formatter may not.
   */
  readonly drainedEnd: number;
}

/**
 * The lines strictly between two 1-based line numbers, spelled as gap
 * lines.
 *
 * TWO SOURCES, because one cannot see the whole range. The lines the
 * list was read from are an enclosing item's BUFFER when the list
 * stands inside one, and that buffer omits what the enclosing scan
 * consumed without buffering: `read_lines_for_list_item` keeps one
 * blank and lets `skip_blank_lines` eat the rest of a run
 * (parser.rb l.1515-17), so a run of three blanks between two folded
 * term lines reaches this call as one line. Reading only the buffer
 * therefore recorded a gap of one where the author wrote three, and
 * the sibling spanned five source lines while writing three. The
 * skipped lines are exactly what the document-wide separator record
 * holds - every scan hands back the separator lines it consumed
 * (`ReaderScope.gaps`, scope.ts) - so the buffer answers for the lines it
 * kept and the record answers for the lines it lost.
 *
 * The buffer wins where both know a line: its `raw` is the line as
 * written, while the record holds a SPELLING an enclosing scan
 * decided, and a `+` the outer scan erased is `""` to that scan and
 * `"+"` in the source.
 *
 * A line NEITHER knows would have its bytes dropped, and the third
 * branch below is unreachable only while one invariant holds: every
 * `GapRole` whose `gapSpelling` is empty is a role whose line the
 * buffer KEEPS (`pending`, `frozen`, `attached` - item-tail.ts
 * l.370-386), so a line missing from the buffer always carries a
 * spelling in the record. A role added to that union with an empty
 * spelling and no buffering reopens the hole, and reopens it
 * SILENTLY: the branch drops the line rather than failing. The
 * standing alarm is the description partition invariant
 * (tests/parser/ast-invariants-description.ts), which writes the
 * whole region back from the SOURCE and reds when a line goes
 * missing - but it only sees the shapes its rows reach, so the
 * invariant above is what a new role has to be checked against.
 * @param lines - the lines the item was read from
 * @param gaps - the document-wide separator record
 * @param from - the term line's own number, exclusive
 * @param to - the first number past the gap, exclusive
 * @returns one gap line per source line in between
 */
function gapBetween(
  lines: readonly SourceLine[],
  gaps: ReadonlyMap<number, GapLine>,
  from: number,
  to: number,
): TermGapLine[] {
  const buffered = new Map<number, TermGapLine>(
    lines
      .filter((line) => line.line > from && line.line < to)
      .map((line) => [line.line, gapLineOf(line)]),
  );
  const gap: TermGapLine[] = [];
  for (let line = from + 1; line < to; line += 1) {
    const spelled = buffered.get(line) ?? gaps.get(line);
    if (spelled !== undefined) {
      gap.push(spelled);
    }
  }
  return gap;
}

/**
 * The line the item's FIRST block opens on, when the source wrote
 * nothing between that block and the description
 * ({@link DescriptionRun}'s `follower`).
 *
 * A LOOK-UP, not a re-read: the block's own start line is on the node
 * the confined reader already built, and the lines it indexes are the
 * ones this sibling was read from. Nothing here classifies anything;
 * the shape question is the predicate's.
 * @param lines - the lines the list is being read from
 * @param blocks - the item's blocks, in source order
 * @param gaps - the gap recorded in front of each of them, parallel
 * @returns the first block's opening line, or undefined where there is
 *   no block or the source wrote a separator in front of it
 */
function followerLine(
  lines: readonly SourceLine[],
  blocks: readonly BlockNode[],
  gaps: ReadonlyArray<readonly GapLine[]>,
): string | undefined {
  const first = blocks.at(0);
  if (first === undefined || gaps[0].length > 0) {
    return undefined;
  }
  return lines.find((line) => line.line === first.position.start.line)?.text;
}

/**
 * What the printer may do with ONE sibling's recorded lines: the five
 * conditions asked of the RUN ({@link descriptionPrinting}), and the
 * two questions a run cannot carry, both of them about the term line
 * rather than about the description.
 *
 * THE GAP is the join's own ground: it stands BETWEEN the term line
 * and the description, so a join deletes every line of it. An EMPTY
 * gap is the only one a join may cross, and the rule is stated over
 * the gap's length rather than over its alphabet on purpose. Two of
 * the three arms are an author's bytes outright - a `//` line the head
 * drain took (parser.rb:1363-1371) and a `+` the read loop buffered
 * (:1557-1559) - and the third, a BLANK, is the one the greedy read
 * popped (:1551-1556). Deleting that blank is render-neutral, so
 * `term::` / blank / `desc` is the one shape this rule leaves on the
 * table, measured at 10 items of the vendored corpus and 0 of the real
 * documents. Crossing it is a wider claim than the rest of the rule
 * makes: a blank is not a line any of the five conditions ever reads,
 * and it is not in the domain they were measured over.
 *
 * A `//`-HEADED TERM LINE is one a confined item reader deletes, and
 * whether it comes back turns on whether a line FOLLOWS it.
 * `Reader#skip_line_comments` takes any line whose head is `//`
 * (reader.rb:337-339, wider than `CommentLineRx`, which exempts `///`
 * - so `///b::` is a term to the classifier and a comment to the
 * reader), and `parse_list_item` unshifts what it took only when a
 * line follows the run (parser.rb:1363-1371). A join is exactly what
 * takes that following line away. ORACLE: `* a` / `///b::` / `c`
 * renders the description list, and `* a` / `///b:: c` renders
 * nothing after `a`. The head is read on the LINE and not on the
 * term, which is the drain's own spelling: an indented ` ///b::` is a
 * term line the drain never reaches, and it joins.
 *
 * WIDER THAN THE HAZARD, knowingly. The drain runs only where such a
 * reader is opened over the lines, so at document level and inside a
 * delimited block the same join is safe and this refuses it anyway.
 * What would narrow it is the item's ANCESTRY, which is not a fact a
 * sibling carries; replaying costs bytes where joining costs a
 * render, so the refusal takes the direction it can defend.
 *
 * ASKED HERE, at the one site that asks the question at all, so the
 * answer the node carries is still a single recorded answer and the
 * printer derives nothing (src/ast.ts, `DescriptionPrinting`).
 * @param marker - the term line's own parse, for the head and the
 *   inline description the conditions read
 * @param markerLine - the term's source line, for that description's
 *   bytes and for the line's own head
 * @param gap - the source between the term line and the description
 * @param run - the rest of what the conditions read: the sibling's
 *   recorded rest lines and the line its first block opens on
 * @param run.restLines - the item's recorded rest lines
 * @param run.follower - the first block's opening line, where nothing
 *   separates it from the description
 * @returns the verdict the sibling's node carries
 */
function siblingPrinting(
  marker: DlistTermKind,
  markerLine: SourceLine,
  gap: readonly TermGapLine[],
  run: { restLines: readonly string[]; follower: string | undefined },
): DescriptionPrinting {
  if (gap.length > 0 || markerLine.text.startsWith(LINE_COMMENT_HEAD)) {
    return "replay";
  }
  return descriptionPrinting({
    termHead: marker.term + marker.delimiter,
    inline:
      marker.descriptionStart === undefined
        ? ""
        : markerLine.text.slice(marker.descriptionStart),
    ...run,
  });
}

/**
 * Assemble one parsed sibling of a description list, once its
 * interior has been read: the term the line carried, the source
 * between that line and the item's description, the description
 * itself, and each block paired with the GAP that precedes it.
 *
 * A sibling, NOT an item: how many items a run of siblings makes is
 * the term fold's answer (`buildDescriptionList`), and this cannot
 * know it. What it does know is whether THIS sibling carries a body,
 * which is the fold's own input, and that is why the gap is filled
 * only where the body is empty: an absorbed sibling's lines have no
 * other home, and a sibling with a body keeps its lines in its
 * description and its `+` bytes in its own tail facts.
 * @param shape - what the extent scan decided about the sibling
 * @param interior - the description and blocks the caller read
 * @param bounds - the gap record, the location index and where the
 *   sibling's recorded lines end ({@link DescriptionBounds})
 * @returns the parsed sibling, ready for the fold
 */
export function descriptionItemNode(
  shape: ListItemShape<DlistTermKind>,
  interior: ItemInterior,
  bounds: DescriptionBounds,
): DescriptionPair {
  const { at } = bounds;
  const { markerLine, marker } = shape;
  const { text, blocks } = interior;
  const term = fragmentOfLine(
    markerLine,
    marker.indent,
    marker.indent + marker.term.length,
  );
  const textEnd = textEndLine(at, text, markerLine);
  const recorded = recordedTextLines(shape.buffer, markerLine.line, textEnd);
  const textLines = recorded.map((line) => line.text);
  const gaps = gapsOf(bounds.gaps, textEnd, blocks);
  const bodyless = text.length === 0 && blocks.length === 0;
  // Where this term's gap stops. A sibling with a body owes the
  // source between its term line and its description - the blank the
  // greedy read popped so that it could not re-read as a continuation
  // (parser.rb:1551-1556) stands there, and it is in no buffer, so
  // nothing else would write it back - and it owes whatever the head
  // drain took, which is in no buffer either. A BODYLESS sibling owes
  // the whole range down to the next term line, because there is no
  // description for the rest of it to be part of.
  const gapEnd = bodyless
    ? (bounds.nextTermLine ?? bounds.drainedEnd)
    : Math.max(bounds.drainedEnd, recorded.at(0)?.line ?? markerLine.line);
  const gap = gapBetween(bounds.lines, bounds.gaps, markerLine.line, gapEnd);
  return {
    term: buildDescriptionTerm(
      // The term's own text, tokenized where it stands: a term
      // carries inline formatting (`*bold*:: d` renders a `<strong>`)
      // and may open with an inline anchor (l.1301-1303). A term is
      // one line and the whole of its own pass text - the term line
      // is not part of the description's block text, so no scan of
      // it reaches past the term (quote-pass.ts).
      tokenizeWholeText(term.image, term.offset),
      term,
      markerLine.text,
      at,
    ),
    gap,
    body: {
      text,
      blocks: blocks.map((block, index) => ({ gap: gaps[index], block })),
      // The three tail facts belong to a body, and a bodyless sibling
      // has none: its `+` bytes are in the gap above where the fold
      // can still reach them (buildDescriptionList's `withTerm`
      // states why they may not also be here), and a `+` at the end
      // of the LAST sibling of a list is the one Ruby's pop discards
      // for good - it attaches nothing and renders nothing
      // (l.1580-1582).
      trailingContinuation: !bodyless && shape.trailingContinuation,
      detachedTail:
        !bodyless &&
        shape.erasedTailContinuation &&
        endsInPlusParagraph(blocks),
      activeTail: !bodyless && shape.activeTail,
      everyTextLineIndented: everyTextLineIndented(textLines),
    },
    textLines,
    printing: siblingPrinting(marker, markerLine, gap, {
      restLines: textLines,
      follower: followerLine(bounds.lines, blocks, gaps),
    }),
  };
}
