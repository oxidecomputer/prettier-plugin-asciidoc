/**
 * The two list READS: `parse_list` for a marker list (parser.rb:1115)
 * and `parse_description_list` for a term-opened one (:1220), each
 * from the line that opens it to the node its items make.
 *
 * A sibling module of reader.ts rather than more of it, the response
 * docs/coding-standards.md prescribes when a file meets the 450-line
 * `max-lines` ceiling and the same one that produced scope.ts.
 * Both reads are the same three steps in the same order - measure
 * every item's extent, apply the separator spellings the extents
 * decided, then assemble - and what they do not share is only the
 * assembly, which is where a description differs from a marker item:
 * it has terms rather than a marker, a fold that can put several of
 * them on one item, and a body that may be empty.
 *
 * What STAYS in reader.ts is the recursion. An item's interior is
 * read by a reader confined to that item's buffer, only reader.ts may
 * make one, and it arrives here as {@link ListHost.interiorOf} - so
 * this module holds no read position, opens no reader and cannot
 * place a node.
 *
 * Every Ruby line number cites parser.rb at Asciidoctor core 2.0.26,
 * the revision the oracle runs, exactly as list-reader.ts's do.
 */
import type {
  DescriptionDelimiter,
  DescriptionListNode,
  ListItemNode,
  ListNode,
} from "../../ast.js";
import { buildDescriptionList } from "../build/description-list.js";
import type { DescriptionPair } from "../build/description-list.js";
import { buildList } from "../build/list.js";
import type { InlineToken } from "../inline/tokens.js";
import type { OpenList, ParagraphContext } from "../line-shapes.js";
import { LINE_COMMENT_HEAD } from "../line-shapes.js";
import { descriptionItemNode } from "./description-list-node.js";
import type { DlistTermKind, MarkerKind } from "./classify.js";
import type { ItemInterior } from "./item-body.js";
import type { GapWrite } from "./item-tail.js";
import { listItemNode } from "./list-item-node.js";
import {
  descriptionList,
  listShape,
  markerList,
  type ListItemShape,
} from "./list-reader.js";
import type { ReaderScope } from "./scope.js";
import type { SourceLine } from "./split.js";
import type { TextOpen } from "./paragraph-reader.js";

/** The two facts a confined reader is bounded by, per item. */
interface ItemConfinement {
  /** The one-list ancestry the confined reader sees. */
  readonly list: OpenList;
  /** The item's own tail safety (ItemExtent.tailSafe). */
  readonly tailSafe: boolean;
}

/** Where an item's own text starts, and under which reading. */
interface ItemTextOpen {
  /** Which interrupting set applies. */
  readonly context: ParagraphContext;
  /** Where the text starts and how its `//` lines read. */
  readonly text: TextOpen;
}

/**
 * What a list read is given by the reader that owns the position:
 * where to read from, the document-wide facts, and the ONE operation
 * only a reader can perform.
 */
export interface ListHost {
  /** The document-wide facts every reader over this document shares. */
  readonly scope: ReaderScope;
  /** The lines the list is read from (the document's, or an item's). */
  readonly lines: readonly SourceLine[];
  /** Index of the line the list opens on. */
  readonly at: number;
  /**
   * Whether a `+` printed at the very end of the STREAM re-reads
   * inert - the reader's own boundary fact (`tailSafeIn`, scope.ts).
   */
  readonly tailSafe: boolean;
  /** How many conditional pairs stand open where the read starts. */
  readonly directiveDepth: number;
  /**
   * Read one item's interior with a reader confined to its buffer -
   * `Reader.new read_lines_for_list_item(...)` and the `next_block`
   * loop over it (parser.rb:1359-1384). The marker or term line rides
   * at the front of the confined lines so the text scan consumes it
   * and the text's continuation lines come from the buffer.
   */
  readonly interiorOf: (
    markerLine: SourceLine,
    buffer: readonly SourceLine[],
    item: ItemConfinement,
    open: ItemTextOpen,
  ) => ItemInterior;
}

/**
 * Apply a list's separator spellings to the document-wide record -
 * the ONE writer of {@link ReaderScope.gaps}, standing beside the
 * read order that makes its rule true. FIRST write wins: an inner
 * scan re-reads an outer item's buffer, where a `+` the outer scan
 * erased spells `""`, so the earliest write is the one made by the
 * scan that saw the least-doctored line and a later scan may never
 * overwrite it.
 *
 * Called with the WHOLE list's writes before any item's interior is
 * read, which is what makes the rule true rather than hopeful: every
 * item's scan has run by then and none of them wrote anything.
 * @param scope - the document-wide facts, for the record
 * @param writes - what a list's item scans decided, in item order
 */
function applyGapWrites(scope: ReaderScope, writes: readonly GapWrite[]): void {
  const { gaps } = scope;
  for (const { line, spelling } of writes) {
    if (!gaps.has(line)) {
      gaps.set(line, spelling);
    }
  }
}

/**
 * Read the whole MARKER list opening at `host.at` - `parse_list`
 * (parser.rb:1115-1129).
 * @param host - what the reader hands the read ({@link ListHost})
 * @param kind - the opening marker, as the classifier parsed it
 * @returns the list node and the index the reader resumes at
 */
export function readMarkerList(
  host: ListHost,
  kind: MarkerKind,
): { node: ListNode; end: number } {
  const shape = listShape(host.lines, host.at, markerList(kind), host);
  applyGapWrites(host.scope, shape.gapWrites);
  const item = (shape: ListItemShape<MarkerKind>): ListItemNode =>
    listItemNode(shape, interiorOfItem(host, shape), {
      gaps: host.scope.gaps,
      at: host.scope.at,
    });
  const [opening, ...rest] = shape.items;
  // The opening item is read into its own local, not inlined into the
  // call, so the items are read in SOURCE ORDER on the page as well
  // as at run time.
  const first = item(opening);
  return {
    node: buildList(kind.variant, kind.style, first, rest.map(item)),
    end: shape.end,
  };
}

/**
 * One marker item's interior: its own text read with `text_only` -
 * `parse_list_item` clears `has_text` for a ulist or olist item whose
 * content is adjacent (parser.rb:1369), so the item's `//` lines are
 * the comments they look like.
 * @param host - what the reader hands the read
 * @param shape - what the extent scan decided about the item
 * @returns the item's text and blocks
 */
function interiorOfItem(
  host: ListHost,
  shape: ListItemShape<MarkerKind>,
): ItemInterior {
  const { marker } = shape;
  return host.interiorOf(
    shape.markerLine,
    shape.buffer,
    { list: { kind: "marker", style: marker.style }, tailSafe: shape.tailSafe },
    {
      context: "listItemText",
      text: { from: marker.markerEnd, comments: "skipped" },
    },
  );
}

/**
 * The head drain: `parse_list_item` peeks past a run of `//` lines
 * before deciding whether the item's first block is content-adjacent,
 * and UNSHIFTS them back when a line follows (`comment_lines =
 * list_item_reader.skip_line_comments`, then `unshift_lines
 * comment_lines unless comment_lines.empty?`, parser.rb:1363-1371). A
 * line after the run - a blank one included, which is truthy to Ruby
 * - puts every drained line back, so the peek drops a line only where
 * the run reaches the end of the item's buffer.
 *
 * The spelling is `Reader#skip_line_comments`'s own: a bare `//`
 * PREFIX, stopping at a blank line (reader.rb:332-345). NOT the
 * classifier's `LINE_COMMENT`, which mirrors `CommentLineRx` and
 * EXEMPTS `///`. The two disagree on exactly the line this drain
 * exists for: `t::` / `///c` / `u:: x` is ONE item with terms `t` and
 * `u`, because `t::`'s whole buffer is `["///c"]`, the drain takes
 * it, nothing follows, nothing is unshifted, and the sibling is left
 * with neither text nor blocks - which is the nil half of Ruby's pair
 * (:1387) and what lets the term fold roll on to `u`. Read the line
 * as text instead and the sibling has a body, the fold ends early,
 * and the list holds a non-last item with an empty body, which is
 * what the description-list AST invariant refuses.
 *
 * The drained bytes are not dropped: they are the term's own gap
 * lines, replayed where the author wrote them. Moving one is not a
 * milder alternative - `parse_block_metadata_line` EXEMPTS `///`
 * (:2080) where `skip_line_comments` does not, so a `///` line lifted
 * above the term line stops being a comment and takes the whole list
 * with it.
 * @param shape - what the extent scan decided about the sibling
 * @returns the lines its interior is read from, and the first line
 *   number past what the drain took - the term line's own where it
 *   took nothing, which is a gap range holding no lines at all
 */
function drainHeadComments(shape: ListItemShape<DlistTermKind>): {
  interior: readonly SourceLine[];
  drainedEnd: number;
} {
  const { buffer } = shape;
  let end = 0;
  while (
    end < buffer.length &&
    // TRANSCRIPTION, not a guard: Ruby's loop condition is
    // `(next_line = peek_line) && !next_line.empty?` and the `//`
    // test is its body, so the blank test is written where Ruby
    // writes it. It decides nothing on its own - `""` starts with no
    // prefix - and it stays because the rule is Ruby's shape, not
    // this call's minimum.
    buffer[end].text !== "" &&
    buffer[end].text.startsWith(LINE_COMMENT_HEAD)
  ) {
    end += 1;
  }
  const last = buffer.at(end - 1);
  if (end < buffer.length || last === undefined) {
    return { interior: buffer, drainedEnd: shape.markerLine.line };
  }
  return { interior: [], drainedEnd: last.line + 1 };
}

/**
 * One description sibling's interior: the description that follows
 * the delimiter, then the blocks under it.
 *
 * `has_text` is the term line's own answer (`has_text = true if
 * (item_text = match[3])`, parser.rb:1304) and a dlist item keeps it
 * where a marker item loses it (`has_text = nil unless dlist`,
 * :1369). So a term that carried inline text is the ONE paragraph
 * whose `//` lines the oracle can fold in as content rather than
 * skipping (issue #101), and a textless term's description is read
 * with `text_only` set, where they are comments.
 * @param host - what the reader hands the read
 * @param shape - what the extent scan decided about the sibling
 * @param buffer - the sibling's lines, the head drain applied
 * @param delimiter - the list's delimiter, which IS the open list
 *   inside the confined reader: a description confinement matches a
 *   sibling by this delimiter, so every marker line the buffer holds
 *   is foreign to the list that is open, which is what a description
 *   item's ancestry means
 * @returns the description and blocks
 */
function interiorOfDescription(
  host: ListHost,
  shape: ListItemShape<DlistTermKind>,
  buffer: readonly SourceLine[],
  delimiter: DescriptionDelimiter,
): ItemInterior {
  const { descriptionStart } = shape.marker;
  const interior = host.interiorOf(
    shape.markerLine,
    buffer,
    { list: { kind: "description", delimiter }, tailSafe: shape.tailSafe },
    {
      // Ruby's `text_only: has_text ? nil : true` (parser.rb l.1367-74),
      // as the context it decides: a term line carrying no text of
      // its own gets the GATED ladder, where a break and an
      // admonition label are description text (see ParagraphContext,
      // src/parse/line-shapes.ts). The same fact picks the comment
      // reading two lines down.
      context:
        descriptionStart === undefined ? "dlistItemTextOnly" : "dlistItem",
      text: {
        // Past the term line's own end where the term carried no
        // description, so the run opens empty and the description is
        // whatever the rest lines hold.
        from: descriptionStart ?? shape.markerLine.raw.length,
        comments: descriptionStart === undefined ? "skipped" : "content",
      },
    },
  );
  // A textless term line contributes no text, so the newline that
  // ENDS it is not the description's first token. Ruby has no such
  // token to drop: `reader.shift` takes the term line off before the
  // item is read at all (:1357) and `item_text` is nil, so the
  // description IS the rest lines. Here the term line rides at the
  // front of the confined reader, which is what puts an inline
  // description on the same run as its continuation lines; a term
  // that carried none opens the run at its own end instead, and this
  // is where that empty opening is spent.
  //
  // Load-bearing, not cosmetic: `list_item.text? || list_item.blocks?`
  // (:1387) is what decides whether the term fold rolls on, and a
  // description holding one newline and nothing else answers the
  // question the wrong way for every term-only item there is.
  return descriptionStart === undefined
    ? { text: withoutTermLineBreak(interior.text), blocks: interior.blocks }
    : interior;
}

/**
 * A description's tokens without the newline that ends the term line.
 * @param text - the tokens the confined read produced
 * @returns the same tokens, an opening newline dropped
 */
function withoutTermLineBreak(text: InlineToken[]): InlineToken[] {
  return text.at(0)?.type === "InlineNewline" ? text.slice(1) : text;
}

/**
 * Read the whole DESCRIPTION list opening at `host.at` -
 * `parse_description_list` (parser.rb:1220-1240).
 *
 * The sibling loop is `listShape`'s, shared with the marker path
 * because `is_sibling_list_item?` is one test with two traits
 * (:2280-2284). The FOLD is not shared and is not here either: how
 * many items a run of siblings makes is `buildDescriptionList`'s
 * answer, because Ruby appends a term-only sibling to the pair
 * already open instead of starting a new one (:1230-1235).
 * @param host - what the reader hands the read ({@link ListHost})
 * @param kind - the opening term line, as the classifier parsed it
 * @returns the list node and the index the reader resumes at
 */
export function readDescriptionList(
  host: ListHost,
  kind: DlistTermKind,
): { node: DescriptionListNode; end: number } {
  const shape = listShape(host.lines, host.at, descriptionList(kind), host);
  applyGapWrites(host.scope, shape.gapWrites);
  const pair = (
    item: ListItemShape<DlistTermKind>,
    position: number,
  ): DescriptionPair => {
    const drain = drainHeadComments(item);
    return descriptionItemNode(
      item,
      interiorOfDescription(host, item, drain.interior, kind.delimiter),
      {
        lines: host.lines,
        gaps: host.scope.gaps,
        at: host.scope.at,
        nextTermLine: shape.items.at(position + 1)?.markerLine.line,
        drainedEnd: drain.drainedEnd,
      },
    );
  };
  const [opening, ...rest] = shape.items;
  const first = pair(opening, 0);
  return {
    node: buildDescriptionList(
      kind.delimiter,
      [first, ...rest.map((item, position) => pair(item, position + 1))],
      host.scope.at,
    ),
    end: shape.end,
  };
}
