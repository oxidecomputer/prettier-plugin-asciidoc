/**
 * Lists, read extent-first — Asciidoctor's own structure:
 * `parse_list` (parser.rb l.1115) walks sibling markers, ported below
 * as {@link listShape}; `parse_list_item` (l.1297) collects one item's
 * extent (`read_lines_for_list_item`, ported as {@link itemExtent}).
 *
 * Everything here is a PURE FUNCTION over lines, except one declared
 * side effect: appending to the shared gap record (below). The
 * re-parse of an item's buffer with a confined reader (`Reader.new
 * buffer`, l.1359) is NOT here: the module that owns the read
 * position owns every recursion, hands each item's interior back, and
 * list-item-node.ts assembles the node from it. Nesting still
 * composes for Ruby's reason — an inner item's scan runs over the
 * outer item's buffer — but no reader is passed in to make it happen,
 * so nothing in this file can advance a stream or place a node.
 *
 * No frame, no per-item object, no cross-item state: the only mutable
 * state is one ExtentScan's five mutable members — `continuation`,
 * `withinNestedList`, `detached`, `marked` and the read position, which
 * is Ruby's four locals with one JS-only member (`marked`) beside them
 * — and the `readonly` buffer they fill, whose CELLS the scan rewrites
 * in place to blank a `+` ({@link ExtentScan}). The one declared
 * external append is the document-wide gap record the scan writes to as
 * it consumes separator lines.
 *
 * The printer's spelling is not decided here at all: each block's GAP
 * — the verbatim ""/"+" lines between the item's pieces — is recorded
 * in the {@link GapRecord} by the scan arm that consumes each line,
 * partitioned per block by {@link gapsOf}, and src/print/list.ts
 * replays it.
 *
 * {@link itemExtent} is the pure port of `read_lines_for_list_item`
 * (parser.rb l.1404-1592, Asciidoctor core 2.0.26 — the revision
 * `@asciidoctor/core` 4.0.11 bundles, which is the oracle these tests
 * run; EVERY Ruby line number in this file is against it) for ulist /
 * olist /
 * colist, returning Ruby's BUFFER — the item's lines with every line
 * Ruby blanks rewritten to `text: ""`, offsets and raw spelling intact
 * — plus where the item ends.
 * Every branch cites its parser.rb line. Only the `list_type == :dlist`
 * local branches (the greedy no-text arm l.1551-56, the
 * BlockAttributeLineRx look-ahead l.1462-82) are out of scope (#9);
 * they are left as cited comments where they would go.
 */
import type { BlockNode, GapLine } from "../../ast.js";
import {
  ATTRIBUTE_ENTRY,
  BLOCK_ANCHOR,
  BLOCK_ATTRIBUTE_LINE,
  BLOCK_TITLE,
  isDescriptionListLine,
  LITERAL_LINE,
} from "../line-shapes.js";
import {
  delimiterKind,
  isContinuationLine,
  parseListMarker,
  type DelimiterKind,
  type MarkerKind,
  type SiblingTrait,
} from "./classify.js";
import { delimitedExtent } from "./delimited-reader.js";
import type { SourceLine } from "./split.js";

/**
 * One item's SHAPE — everything the surface lines decide about it,
 * and nothing that needs the item parsed. Exported because the caller
 * that owns the recursion hands one back to list-item-node.ts once
 * the interior has been read.
 */
export interface ListItemShape {
  /** The item's marker line. */
  readonly markerLine: SourceLine;
  /** The marker, as the classifier parses one. */
  readonly marker: MarkerKind;
  /** Ruby's buffer: the item's lines, erasures applied (see {@link ItemExtent}). */
  readonly buffer: readonly SourceLine[];
  /** Whether the scan popped a `+` off the item's end (the raw fact). */
  readonly poppedContinuation: boolean;
  /** Whether the blanked detached `+` was stripped off the item's tail. */
  readonly erasedTailContinuation: boolean;
  /** Whether the item ended with its continuation still armed. */
  readonly activeTailContinuation: boolean;
  /** Whether a `+` printed at the very end of THIS ITEM re-reads inert. */
  readonly tailSafe: boolean;
}

/** A whole list's shape, and where the list ends. NOT exported. */
interface ListShape {
  /**
   * One shape per sibling item, in source order. The opening item is
   * scanned BEFORE the sibling loop, which is what makes "a list
   * always has an item" a fact of this control flow rather than a
   * sentence buildList re-checks.
   */
  readonly items: readonly [ListItemShape, ...ListItemShape[]];
  /** Index (into `lines`) after the last item's extent. */
  readonly end: number;
}

/**
 * Scan a whole list opening at `at` — the port of `parse_list`
 * (l.1115-1129): one item per sibling marker, anything else ends the
 * list. Pure over the lines except the one declared side effect
 * itemExtent has — appending to the shared gap record: it decides
 * EXTENTS, and nothing inside any item is parsed here. The caller
 * reads each item's interior (a confined reader over
 * `[markerLine, ...buffer]`) and assembles the nodes; a scan that
 * recursed would need a reader handed back to it, which is the seam
 * this module no longer has.
 *
 * The dlist arm (#9) plugs in at {@link siblingMarker} and at this
 * function's `opening` parameter, which becomes the union of the
 * opening parses; nothing else here is marker-specific.
 * @param lines - the lines the list is read from (the document's, or
 *   an enclosing item's buffer)
 * @param at - index of the first marker line
 * @param opening - the first marker, as the classifier parsed it
 * @param context - the stream-end fact every item extent inherits,
 *   and the gap record every scan appends to ({@link ExtentContext})
 * @returns one shape per item, and the index the caller resumes at
 */
export function listShape(
  lines: readonly SourceLine[],
  at: number,
  opening: MarkerKind,
  context: ExtentContext,
): ListShape {
  const trait = siblingTrait(opening);
  // One item's shape, as a closure over the facts every item in
  // this list shares — which is also why it is not a top-level
  // function: `lines`, `trait` and `context` are the LIST's, and
  // passing them per item was four arguments saying one thing.
  const itemAt = (
    index: number,
    marker: MarkerKind,
  ): { shape: ListItemShape; end: number } => {
    const extent = itemExtent(lines, index + 1, trait, context);
    return {
      shape: {
        markerLine: lines[index],
        marker,
        buffer: extent.buffer,
        poppedContinuation: extent.poppedContinuation,
        erasedTailContinuation: extent.erasedTailContinuation,
        activeTailContinuation: extent.activeTailContinuation,
        tailSafe: extent.tailSafe,
      },
      end: extent.end,
    };
  };
  const first = itemAt(at, opening);
  const items: [ListItemShape, ...ListItemShape[]] = [first.shape];
  let index = first.end;
  for (;;) {
    // Ruby's `reader.skip_blank_lines || break` between items
    // (l.1125), live for exactly one stopper: an item extent ends AT
    // an erased line (text `""`) when the after-blank arm hard-stops
    // on the tagged Placeholder ({@link ExtentScan.afterBlank}) —
    // every other stopping arm unreads a NON-blank line. The skip
    // consumes the run whether or not a sibling follows (Ruby's
    // `skip_blank_lines || break` consumes either way, and so does
    // the oracle's coercing `Reader.skipBlankLines`), which is what
    // hands the enclosing reader a block opened AFTER skipped blanks —
    // a content-adjacency fact the paragraph read spends. The skipped
    // lines are already in the gap record: the scan that erased or
    // buffered each one recorded it, and first-write-wins holds.
    while (lines.at(index)?.text === "") index += 1;
    // `list_rx =~ reader.peek_line` for the next sibling (l.1119).
    const next = lines.at(index);
    const marker =
      next === undefined ? undefined : siblingMarker(next.text, trait);
    if (marker === undefined) break;
    const sibling = itemAt(index, marker);
    items.push(sibling.shape);
    index = sibling.end;
  }
  return { items, end: index };
}

/**
 * The sibling trait of a marker-opened list: the marker arm, carrying
 * the classifier's resolved style.
 * @param kind - the list's first marker
 * @returns the trait sibling matching compares
 */
function siblingTrait(kind: MarkerKind): SiblingTrait {
  return { kind: "marker", style: kind.style };
}

/**
 * The document-wide record of separator lines: 1-based document line
 * number → what the line spells in a gap. Written by the extent-scan
 * arm that CONSUMES each line — the branch that skips a blank records
 * `""`, the one that erases a `+` records `"+"` — so the spelling is
 * typed where it is known, never re-derived from line text. One map
 * per document, shared by every scan at every nesting depth: an inner
 * scan re-reads an outer item's buffer, which omits blanks the outer
 * scan skipped, so inner gaps need the outer scan's entries — keying
 * by document line number makes the union automatic (re-recording a
 * line writes the same spelling).
 */
export type GapRecord = Map<number, GapLine>;

/** The read side of {@link GapRecord} — what {@link gapsOf} takes. */
type ReadonlyGapRecord = ReadonlyMap<number, GapLine>;

/**
 * Each block's gap: the recorded separator lines strictly between the
 * previous piece of the item and the block. A partition of the
 * {@link GapRecord} by block positions — nothing here reads line
 * text, so a non-gap line in a gap is unrepresentable. The record is
 * complete for these ranges because every line between two of an
 * item's blocks was consumed by a recording arm of some scan
 * (comments, metadata and attribute entries are blocks); a hole would
 * shorten a printed gap, which the parity, idempotence and
 * ast-invariants nets all see.
 * @param record - the document-wide gap record
 * @param textEnd - the text's last line number
 * @param blocks - the item's blocks, in source order
 * @returns one gap per block
 * Consumed by list-item-node.ts's listItemNode; its unit table is
 * tests/parser/list-reader.test.ts.
 */
export function gapsOf(
  record: ReadonlyGapRecord,
  textEnd: number,
  blocks: readonly BlockNode[],
): GapLine[][] {
  // Sorted ONCE for the whole call, then walked with a single cursor:
  // block ranges are disjoint and increasing, so no entry a later
  // block needs can sit before an entry an earlier block already
  // consumed.
  const entries = [...record].toSorted(([a], [b]) => a - b);
  let cursor = 0;
  let previousEnd = textEnd;
  return blocks.map((block) => {
    // Boundaries are 1-based line numbers, both ends exclusive: the
    // previous piece ends ON previousEnd, the block starts ON its
    // start line.
    const start = previousEnd;
    previousEnd = block.position.end.line;
    // Advance past entries at or before this gap's start — that skips
    // both the previous block's own gap and any entry inside the
    // previous block's own span — before collecting this one.
    while (cursor < entries.length && entries[cursor][0] <= start) {
      cursor += 1;
    }
    const gap: GapLine[] = [];
    while (
      cursor < entries.length &&
      entries[cursor][0] < block.position.start.line
    ) {
      gap.push(entries[cursor][1]);
      cursor += 1;
    }
    return gap;
  });
}

/**
 * What one extent scan is given beyond the lines themselves: the
 * stream-end fact, and the record it reports separator lines into.
 */
interface ExtentContext {
  /**
   * Whether a `+` printed at the very end of the STREAM re-reads
   * inert — true for the document reader (EOF), the confined reader's
   * own boundary fact otherwise.
   */
  readonly tailSafe: boolean;
  /** The document-wide gap record ({@link GapRecord}). */
  readonly gaps: GapRecord;
}

/**
 * What the scan hands the reader: Ruby's buffer, where it ends, and
 * the two facts about a `+` that came off the end.
 */
interface ItemExtent {
  /**
   * The item's lines in document order, a COPY: every line Ruby erases
   * (`buffer[-1] = ListContinuationPlaceholder` l.1439,
   * `buffer[detached_continuation] = ListContinuationPlaceholder`
   * l.1576) has `text: ""` with `raw`, `offset` and `line` intact, so
   * positions and gap spellings survive the rewrite.
   *
   * The erasure writes a TAGGED empty String at 2.0.26, not the plain
   * `''` 2.0.20 wrote: `ListContinuationPlaceholder` is
   * `::String.new.extend ListContinuationMarker` (l.46-50). It is
   * still empty, so `text: ""` is the same observable — but the tag is
   * what l.1580's pop tests, which is why that pop runs ahead of the
   * trailing-blank strip rather than after it.
   */
  buffer: readonly SourceLine[];
  /**
   * Exclusive index into `lines` after the item's last consumed line —
   * trailing blanks and a popped trailing `+` included, so the caller
   * resumes exactly where Ruby's reader would.
   */
  end: number;
  /**
   * The scan popped a marked `+` off the buffer's end (l.1580-81's pop).
   * The RAW fact only — whether the byte comes back is
   * list-item-node.ts's keptTrailingContinuation question, not this one's.
   */
  poppedContinuation: boolean;
  /**
   * The cleanup blanked the detached `+` (l.1576) and the strip loop
   * then popped that very cell off the buffer's tail — the item's
   * source ended with the erased shield and nothing after it. The raw
   * fact only; whether the tail is printed back is
   * `ListItemNode.detachedTail`'s question (src/ast.ts).
   *
   * Structurally mutually exclusive with `poppedContinuation`:
   * `marked` IS the detached cell whenever a detached `+` is the last
   * `+` the scan buffered, so the strip either breaks on the marked
   * pop before it ever reaches the detached cell, or pops the blanked
   * detached cell as a blank and then breaks on non-marked content —
   * never both.
   */
  erasedTailContinuation: boolean;
  /**
   * The scan finished with `continuation` still `:active` — a `+`
   * followed only by metadata and at most one buffered blank per run,
   * so the `+` that reaches the output is still ARMED where the item
   * ends.
   *
   * A nested-list context is NOT an exception, which is why no
   * `withinNestedList` guard sits here. A detached `+` inside an item
   * that also holds a nested list is blanked by `finish()`'s
   * UNCONDITIONAL l.1576 erase, so its spelling still reaches the
   * printed output through the gap record and a re-read of that output
   * still activates through the metadata below it (l.1435) and
   * attaches on one blank.
   *
   * The raw scan fact only: whether the PRINTED item still shows the
   * armed `+` is `ListItemNode.activeTail`'s question, answered beside
   * the blocks (armedTailPrints), which is where a `+` left as a mere
   * buffer line for an inner scan to own is discriminated out — its
   * trailing block is the nested list, not metadata.
   */
  activeTailContinuation: boolean;
  /**
   * Whether a `+` printed at the very end of THIS ITEM re-reads inert:
   * the scan stopped at a sibling (which the printer puts on the very
   * next line, where the `+` pops again), or the stream itself ended
   * at a safe boundary ({@link ExtentContext.tailSafe}). False when
   * arbitrary content follows across blank lines — there the printer
   * separates with a blank, and a `+` above a blank ERASES and arms
   * on re-read, which changes what attaches to the item.
   */
  tailSafe: boolean;
}

/**
 * Whether a line is a sibling item of the list being read — style
 * equality on the RESOLVED trait, exactly `is_sibling_list_item?`
 * (parser.rb l.2280). The three marker variants' style sets are
 * disjoint by construction (`listMarkerStyle` in line-shapes.ts: an
 * unordered marker is its own style, an ordered one resolves through
 * `orderedMarkerStyle`, and every callout marker collapses to the one
 * CALLOUT_STYLE), so equality alone decides - and it decides on the
 * RESOLVED style, which is why `5.` continues a list `1.` opened
 * while `.` opens a nested one. The dlist arm has no producer yet: the conjunction's
 * first test is where #9's `DescriptionListSiblingRx` matching plugs
 * in.
 * @param text - one rstripped source line
 * @param trait - the open list's sibling trait
 * @returns true when the line starts a sibling item
 */
function isSibling(text: string, trait: SiblingTrait): boolean {
  return siblingMarker(text, trait) !== undefined;
}

/**
 * The same test, answering with the marker itself — what the sibling
 * LOOP needs, which would otherwise spell the rule a second time to
 * get the parse it builds the item from. ONE rule, two shapes of
 * answer: {@link isSibling} is this function asked whether there was
 * one.
 * @param text - one rstripped source line
 * @param trait - the open list's sibling trait
 * @returns the sibling's marker, or undefined when the line is not one
 */
function siblingMarker(
  text: string,
  trait: SiblingTrait,
): MarkerKind | undefined {
  if (trait.kind !== "marker") return undefined;
  const parsed = parseListMarker(text);
  if (parsed?.style !== trait.style) return undefined;
  return { kind: "listMarker", ...parsed };
}

/**
 * Whether a line starts a NESTABLE list — `NESTABLE_LIST_CONTEXTS =
 * [:ulist, :olist, :dlist]` (asciidoctor.rb:315, the authority; the
 * three `find` sites are l.1503, l.1530 and l.1562): an unordered or
 * ordered marker, or a dlist term. A callout marker is deliberately
 * NOT nestable (asciidoctor.rb:315 lists no :colist), which is why a
 * `<n>` line after a blank ends the item — but Ruby's `find` still
 * tries `DescriptionListRx` on it, so a callout-shaped line that is
 * ALSO a dlist term (`<1> t:: d`) nests; hence the `||`, not an
 * early return. One unmodelled nuance, verified harmless: when
 * `within_nested_list` is already true, Ruby narrows the search set to
 * `[:dlist]` — the only effects of a match there are re-setting an
 * already-true flag and the dlist-only `has_text` reset (out of
 * scope, #9), so the unconditional test is equivalent; do not "fix"
 * it.
 * @param text - one rstripped source line
 * @returns true when the line would set `within_nested_list`
 */
function isNestable(text: string): boolean {
  const marker = parseListMarker(text);
  return (
    (marker !== undefined && marker.variant !== "callout") ||
    isDescriptionListLine(text)
  );
}

/**
 * Ruby's "is the buffered previous line a `+`" test (l.1435). The
 * empty-buffer case is the CALLER's branch, not this one's: `prev_line`
 * is nil for the first line of an item, and nil matches neither the `+`
 * arm nor the after-blank arm (l.1513 tests `prev_line &&` for the same
 * reason), which in this port is the buffer having no last cell.
 *
 * A TEXT test here; at 2.0.26 Ruby's is an IDENTITY test —
 * `ListContinuationMarker === prev_line`, an `is_a?` on the module the
 * two `+`-carrying Strings are extended with (l.46-50). 2.0.20 spelled
 * it `prev_line == LIST_CONTINUATION` and this port mirrors THAT. The
 * two disagree on exactly one value: the erased Placeholder, which is
 * empty (so the text test says no) and tagged (so the identity test
 * says yes). The tag IS modeled where the oracle demonstrably spends
 * it — the after-blank arm hard-stops on an erased THIS line
 * ({@link ExtentScan.afterBlank}), keyed on
 * {@link SourceLine.continuationTag} — but an erased PREVIOUS line
 * reaching this test stays OPEN: it needs a buffered erased cell as
 * `prev` under a live scan, which no sweep document constructs; the
 * deep sweep arbitrates.
 * @param previous - the last buffered line's text
 * @returns true when the previous line is a lone `+`
 */
function previousIsContinuation(previous: string): boolean {
  return isContinuationLine(previous);
}

/**
 * "Let block metadata play out until we find the block" — the three
 * shapes l.1499-1501 keeps `:active` across: a block title, a block
 * attribute line, and an attribute entry. Ruby's BlockAttributeLineRx
 * carries the `[[anchor]]` form as one of its alternatives; the
 * registry spells that alternative as its own pattern (BLOCK_ANCHOR),
 * so both are tested here. A comment is deliberately absent: Ruby's
 * test does not name it, so it falls to the else arm and CONSUMES the
 * continuation (oracle-confirmed; see the unit row).
 * @param text - one rstripped source line
 * @returns true when the line is metadata to the `:active` arm
 */
function isBlockMetadataLine(text: string): boolean {
  return (
    BLOCK_TITLE.test(text) ||
    BLOCK_ATTRIBUTE_LINE.test(text) ||
    BLOCK_ANCHOR.test(text) ||
    ATTRIBUTE_ENTRY.test(text)
  );
}

// Ruby's three continuation states (l.1407-09): :frozen marks sequential
// continuation lines, "really a syntax error".
type Continuation = "inactive" | "active" | "frozen";

/**
 * One buffered line, held by REFERENCE. The scan blanks lines it
 * buffered earlier ({@link ExtentScan.blank}), and a cell is what it
 * keeps hold of to do that: the rewrite flows through the reference, so
 * a blank names no position, cannot miss, and cannot go stale while the
 * buffer grows past it or its tail is popped. Validity is local — you
 * blank the cell you hold.
 *
 * Ruby holds POSITIONS instead: `buffer[-1] = ListContinuationPlaceholder`
 * (l.1439) and `buffer[detached_continuation] = ...` (l.1576), the
 * second off an index stored lines earlier. This port takes the other
 * shape on purpose, and says nothing about Ruby's own semantics by
 * doing so. Cells never leave the scan — {@link ExtentScan.finish}
 * unwraps them once, so {@link ItemExtent.buffer} is plain lines.
 */
interface Cell {
  /** The line as the buffer holds it now. */
  current: SourceLine;
}

/**
 * One scan's state — Ruby's four locals as four mutable members
 * (`continuation`, `within_nested_list`, `detached_continuation`, the
 * read position), one JS-only member (`marked`) beside them, and the
 * `readonly` buffer of {@link Cell}s they fill — readonly as an ARRAY:
 * the scan appends and pops, and rewrites a cell's contents to blank a
 * line, but never swaps the array itself. Nothing
 * per-block and nothing cross-item. A class (like paragraph-reader's Paragraph) so
 * each Ruby arm is one small method instead of one 60-line loop body.
 */
class ExtentScan {
  private readonly buffer: Cell[] = [];
  private continuation: Continuation = "inactive";
  private withinNestedList = false;
  private detached: Cell | undefined = undefined;
  /**
   * The cell holding the last `+` the LOOP itself buffered as a
   * continuation marker, or undefined while it has buffered none —
   * which is why {@link ExtentScan.finish} can ask the question by
   * comparing cells. The oracle marks those lines by
   * IDENTITY, not by text: `this_line = ListContinuationString if
   * this_line == LIST_CONTINUATION` (l.1432) swaps in a String
   * instance extended with the `ListContinuationMarker` module
   * (l.46-50), so the post-loop `ListContinuationMarker ===
   * buffer[-1]` (l.1580) is `is_a?` and recognises only those. The
   * JavaScript oracle these tests actually run says the same thing in
   * its own words — `class ListContinuation extends String` and a pop
   * gated on `isListContinuation(last)`
   * (node_modules/@asciidoctor/core/src/parser.js). A `+` that reached the buffer INSIDE a slurped delimited
   * block is an ordinary String and is never popped — it is content
   * of that block, and `* i\n+\n====\n----\nfoo\n----\n+\n` renders
   * it as a paragraph inside the example.
   */
  private marked: Cell | undefined = undefined;
  private index: number;

  /**
   * @param lines - the lines the item is read from (the document's, or
   *   an enclosing item's buffer)
   * @param from - index of the first line AFTER the item's marker line
   *   (parse_list_item shifts the marker before reading, l.1357)
   * @param trait - the trait siblings are matched by
   * @param context - the stream-end fact and the gap record
   *   ({@link ExtentContext})
   */
  constructor(
    private readonly lines: readonly SourceLine[],
    from: number,
    private readonly trait: SiblingTrait,
    private readonly context: ExtentContext,
  ) {
    this.index = from;
  }

  /**
   * Record one separator line's spelling. FIRST write wins: an inner
   * scan re-reads an outer item's buffer, where a `+` the outer scan
   * erased spells `""` — the earliest record is the one made by the
   * scan that saw the least-doctored line, so a later scan may never
   * overwrite it.
   * @param line - 1-based document line number
   * @param spelling - what the line spells in a gap
   */
  private recordGap(line: number, spelling: GapLine): void {
    const { gaps } = this.context;
    if (!gaps.has(line)) gaps.set(line, spelling);
  }

  /**
   * Walk the lines exactly as Ruby's while loop does.
   * @returns the finished extent
   */
  run(): ItemExtent {
    while (this.index < this.lines.length) {
      const line = this.lines[this.index];
      this.index += 1;
      if (this.step(line) === "stop") break;
    }
    return this.finish();
  }

  /**
   * One turn of Ruby's while loop: the arms of l.1430-1570 in Ruby's
   * order, each one either finishing the item or moving to the next
   * line. Split from `run` because the loop's arms and the loop's
   * bookkeeping are two things; the `complexity` ceiling made the
   * split mandatory rather than optional.
   * @param line - the line just read (the read position is already
   *   past it, so every stopping arm unreads it)
   * @returns whether the item ends on this line
   */
  private step(line: SourceLine): "stop" | "go" {
    // A sibling item — "we've captured the complete list item"
    // (l.1430) — or an enclosing delimited block's terminator, which
    // is where the lines Ruby's item reader was given run out. Asked
    // of every line first.
    if (this.endsTheItem(line.text)) {
      this.index -= 1;
      return "stop";
    }
    // prev_line is read from the MUTATED buffer (l.1433): a `+` an
    // EARLIER turn blanked reads as a blank here, which is what makes
    // the flat `+`/blank/`+`/para shape take the detached arm.
    //
    // Two reads of one thing, and the difference between them decides
    // an arm. `prev_line` is Ruby's LOCAL: it holds the String the
    // buffer had when this turn began, and l.1439's assignment replaces
    // the buffer's SLOT without touching that local — so the
    // after-blank test at l.1513 still sees the `+` this turn just
    // blanked, never the blank it became. `previousText` is that local,
    // read once and before any arm runs. The CELL travels beside it
    // because the `+` arm blanks the very line it tested, and holding
    // it is how the arm says which line that is.
    const previous = this.buffer.at(-1);
    const previousText = previous?.current.text;
    if (this.continuationArm(line, previous, previousText)) {
      return "go";
    }
    const delimiter = delimiterKind(line.text);
    if (delimiter !== undefined) return this.delimitedArm(delimiter);
    // Ruby's next arm is the dlist-only `BlockAttributeLineRx`
    // look-ahead (l.1462-82, `elsif dlist && continuation != :active
    // && ...`): it decides whether a `[...]` run in front of a
    // non-sibling list item joins the item or breaks it. Out of scope
    // with the rest of the dlist branches (#9); it would go exactly
    // here, between the delimited arm and the `:active` arm.
    if (this.continuation === "active" && line.text !== "") {
      this.activeContent(line);
      return "go";
    }
    if (previousText === "") return this.afterBlank(line);
    this.plainLine(line); // the final else, l.1560-70
    return "go";
  }

  /**
   * The buffered-`+` arm's guard: whether the previous buffered cell
   * holds a lone `+`, tested on `previousText` — the one read `step`
   * already made — rather than a second read of the cell. Split out of
   * `step` so that guard is two conditions here instead of folded into
   * `step`'s own count, which is what keeps `step` under the
   * `complexity` ceiling.
   * @param line - the line just read
   * @param previous - the last buffered cell, or undefined at an
   *   item's first line
   * @param previousText - that cell's text, already read by the caller
   * @returns true when the `+` arm consumes this turn
   */
  private continuationArm(
    line: SourceLine,
    previous: Cell | undefined,
    previousText: string | undefined,
  ): boolean {
    return (
      previous !== undefined &&
      previousText !== undefined &&
      previousIsContinuation(previousText) &&
      this.afterContinuation(line, previous)
    );
  }

  /**
   * `is_sibling_list_item?` (l.1430) — the one shape that ends the
   * item wherever it is read, before and after a blank run alike
   * (l.1519/1528-29 ask the same question a second time). The old
   * enclosing-terminator disjunct is unrepresentable now: the scan's
   * lines physically end at every enclosing boundary.
   * @param text - one rstripped source line
   * @returns true when the item ends on this line, unread
   */
  private endsTheItem(text: string): boolean {
    return isSibling(text, this.trait);
  }

  /**
   * The delimited-block arm: "a delimited block immediately breaks the
   * list unless preceded by a list continuation (they are harsh like
   * that)" — l.1453-56.
   * @param kind - which delimited block the current line opens
   * @returns whether the item ends here
   */
  private delimitedArm(kind: DelimiterKind): "stop" | "go" {
    if (this.continuation !== "active") {
      this.index -= 1;
      return "stop";
    }
    this.slurpDelimited(kind);
    return "go";
  }

  /**
   * The buffered-`+` arm (l.1435-51, `ListContinuationMarker ===
   * prev_line` at 2.0.26): activate the pending `+` — blanking it
   * unless inside a nested list — and freeze on an adjacent one. `LIST_CONTINUATION` itself (asciidoctor.rb l.332) is
   * `isContinuationLine`'s pattern, shared with the classifier so the
   * scan and the reader can never disagree about what a `+` line is.
   * @param line - the line after the buffered `+`
   * @param previousCell - the cell holding that buffered `+`
   * @returns true when the line was fully handled (the adjacent case)
   */
  private afterContinuation(line: SourceLine, previousCell: Cell): boolean {
    if (this.continuation === "inactive") {
      this.continuation = "active"; // l.1437
      // "if we are within a nested list, we don't throw away the list
      // continuation marks because they will be processed when
      // grabbing the lines for those nested lists" — l.1412-14, 1439.
      if (!this.withinNestedList) this.blank(previousCell);
    }
    if (!isContinuationLine(line.text)) return false;
    // Adjacent continuations, "really a syntax error" — l.1442-46.
    // The gate at l.1444 is Ruby's and now ours: the SECOND `+` of a
    // run is buffered, every later one is read and dropped. The third
    // `+` renders nothing and reaches no block — `* a\n+\n+\n+\n` and
    // `* a\n+\n+\n` are one document to the oracle — so buffering it
    // only to print it back was carrying a byte with no meaning
    // behind it, and it cost the run its fixed point: the printed run
    // shrank by one `+` on every pass.
    if (this.continuation === "frozen") {
      // The dropped `+` enters no buffer, but it still stands between
      // the item's pieces in the document, so it is a gap line.
      this.recordGap(line.line, "+");
    } else {
      this.continuation = "frozen"; // l.1445
      this.pushMarker(line);
    }
    return true;
  }

  /**
   * `continuation == :active && !this_line.empty?` (l.1483-1512): a
   * literal paragraph is slurped whole, metadata plays out, anything
   * else is the attached block and consumes the `+`.
   * @param line - the non-blank line under an active continuation
   */
  private activeContent(line: SourceLine): void {
    if (LITERAL_LINE.test(line.text)) {
      // "if we don't process it as a whole, then a line in it that
      // looks like a list item will throw off the exit from it" —
      // l.1486-95 (l.1495 is the non-dlist read; the dlist one at
      // l.1493 is out of scope).
      this.index -= 1;
      this.slurpLiteral();
      this.continuation = "inactive";
      return;
    }
    if (isBlockMetadataLine(line.text)) {
      // l.1499-1501, continuation stays active
      this.buffer.push({ current: line });
      return;
    }
    if (isNestable(line.text)) this.withinNestedList = true; // l.1503-04
    this.buffer.push({ current: line });
    this.continuation = "inactive"; // l.1511
  }

  /**
   * `prev_line && prev_line.empty?` (l.1513-50): skip further blanks,
   * then only a detached `+`, a nestable marker or a literal paragraph
   * keeps the item. `has_text` is always true outside dlists (l.1525);
   * the greedy no-text arm (l.1551-56) is dlist-only and out of scope
   * (#9).
   * @param first - the line that arrived after the blank
   * @returns whether the item ends here
   */
  private afterBlank(first: SourceLine): "stop" | "go" {
    // An ERASED line is not a blank here: the JS oracle's strict test
    // (`thisLine === ''`, parser.js l.2168 — false for the boxed
    // Placeholder) sends it past the blank skip, where it matches no
    // keeping shape and falls to the break at the bottom (l.2215).
    // The unread erased line then stands where the sibling loop's
    // blank skip consumes it (listShape). Only THIS arm reads the
    // tag: skipBlanks below keeps coercing, because
    // `Reader.skipBlankLines` does (`String(nextLine) !== ''`,
    // reader.js l.418-27) — the oracle's asymmetry is real and
    // load-bearing.
    const blank = first.text === "" && first.continuationTag !== "erased";
    // `first` is the second blank of a run when it is blank at all —
    // the run loop read it, so skipBlanks below starts past it.
    if (blank) this.recordGap(first.line, "");
    const line = blank ? this.skipBlanks() : first;
    if (line === undefined) return "stop"; // EOF, l.1517
    if (isContinuationLine(line.text)) {
      // A detached continuation "gets associated with the outermost
      // block" — l.1417-19, 1522-24. The held cell is a SCALAR: a later
      // detached `+` replaces it, which is why only the last one is
      // blanked after the loop. Ruby writes `detached_continuation =
      // buffer.size` and then `buffer << line`, naming the slot the
      // push is about to fill; here the push hands back the cell it
      // made.
      this.detached = this.pushMarker(line);
      return "go";
    }
    // l.1519 and l.1528-29 are one test here, not two: Ruby asks
    // whether the line it just read is a sibling once for the
    // re-read-past-blanks path and once for the fall-through path, and
    // both arms unread the line and break. A `+` is not a sibling
    // marker, so testing it first changes nothing.
    if (this.endsTheItem(line.text)) {
      this.index -= 1;
      return "stop";
    }
    if (isNestable(line.text)) {
      this.buffer.push({ current: line }); // l.1530-32
      this.withinNestedList = true;
      return "go";
    }
    if (LITERAL_LINE.test(line.text)) {
      // "slurp up any literal paragraph offset by blank lines" —
      // l.1537-46.
      this.index -= 1;
      this.slurpLiteral();
      return "go";
    }
    this.index -= 1; // break — l.1549; this_line unshifted at l.1574
    return "stop";
  }

  /**
   * "Advance to the next line of content" — `skip_blank_lines` then
   * `read_line` (l.1515-17). The blanks are consumed, not buffered.
   * @returns the first non-blank line, read (the position is past it),
   *   or undefined at EOF — where Ruby's `!this_line` breaks
   */
  private skipBlanks(): SourceLine | undefined {
    while (
      this.index < this.lines.length &&
      this.lines[this.index].text === ""
    ) {
      this.recordGap(this.lines[this.index].line, "");
      this.index += 1;
    }
    if (this.index >= this.lines.length) return undefined; // EOF, l.1517
    const line = this.lines[this.index];
    this.index += 1;
    return line;
  }

  /**
   * The final else (l.1560-70): buffer the line; a nestable marker
   * flips `within_nested_list`. Deliberately does NOT touch
   * `continuation` — that omission IS the one-blank budget: a blank
   * after a `+` lands here with the continuation still active, so the
   * next content line still attaches.
   * @param line - the line to buffer
   */
  private plainLine(line: SourceLine): void {
    // A `+` reaching the final else is Ruby's own `elsif
    // ListContinuationMarker === this_line` arm (l.1557-59): the line
    // was swapped for the marker instance at the top of the loop, so
    // it goes in marked.
    if (isContinuationLine(line.text)) {
      this.pushMarker(line);
      return;
    }
    if (isNestable(line.text)) this.withinNestedList = true; // l.1562-63
    // The FIRST blank of a run lands here (later ones take the
    // afterBlank arm): it is buffered, and it is a gap line.
    if (line.text === "") this.recordGap(line.line, "");
    this.buffer.push({ current: line });
  }

  /**
   * Buffer a `+` line AS a continuation marker — Ruby's
   * `ListContinuationString` swap (l.1432). Only a line pushed here
   * can be the one l.1580-81 pops; see {@link marked}.
   * @param line - the `+` line
   * @returns the cell the line went into, for a caller that has to keep
   *   holding it (the detached arm does)
   */
  private pushMarker(line: SourceLine): Cell {
    // The buffered copy carries the tag Ruby's swap gives the String
    // itself — the fact the confined paragraph read keys its fold on
    // (SourceLine.continuationTag).
    const cell: Cell = { current: { ...line, continuationTag: "marker" } };
    this.buffer.push(cell);
    this.marked = cell;
    return cell;
  }

  /**
   * `read_lines_until terminator: match.terminator, read_last_line:
   * true` (l.1460): the whole block, delimiters included, goes into
   * the buffer and the continuation is consumed.
   * @param kind - which delimited block the current line opens
   */
  private slurpDelimited(kind: DelimiterKind): void {
    const openIndex = this.index - 1;
    const { resume } = delimitedExtent(this.lines, openIndex, kind);
    for (let at = openIndex; at < resume; at += 1) {
      this.buffer.push({ current: this.lines[at] });
    }
    this.index = resume;
    this.continuation = "inactive"; // l.1461
  }

  /**
   * `read_lines_until preserve_last_line: true, break_on_blank_lines:
   * true, break_on_list_continuation: true` (l.1495/1546, the two
   * non-dlist calls): the literal
   * paragraph runs until a blank line or a `+`, whichever comes first.
   */
  private slurpLiteral(): void {
    while (this.index < this.lines.length) {
      const line = this.lines[this.index];
      if (line.text === "" || isContinuationLine(line.text)) return;
      this.buffer.push({ current: line });
      this.index += 1;
    }
  }

  /**
   * Blank one buffered line — Ruby assigns `''` over the string; the
   * copy keeps raw/offset/line so positions and gap spellings survive.
   * Takes the {@link Cell}, so there is no position to be right about:
   * the caller blanks the line it is holding.
   * @param cell - the buffered cell to blank
   */
  private blank(cell: Cell): void {
    // The blanked line is always a buffered `+`, and blanking it is
    // what turns it into a gap line — record the spelling here, where
    // that is known. The tag makes the cell Ruby's Placeholder rather
    // than a written blank: an inner scan's after-blank arm hard-stops
    // on it (SourceLine.continuationTag).
    this.recordGap(cell.current.line, "+");
    cell.current = { ...cell.current, text: "", continuationTag: "erased" };
  }

  /**
   * The post-loop cleanup (l.1574-89): blank the detached `+`, strip
   * trailing blanks, pop ONE trailing `+`.
   *
   * The popped `+`'s BYTES are not reported anywhere, because nothing
   * downstream may spend them: the line attached nothing, Ruby drops
   * it (l.1580-81) and it renders not one character. Two FACTS about
   * the tail do leave here — `poppedContinuation` (the marked pop
   * fired) and `erasedTailContinuation` (the blanked detached cell
   * came off the tail as a blank) — because each one is the
   * load-bearing half of a print decision the node makes later
   * (list-item-node.ts's keptTrailingContinuation and `detachedTail`).
   * @returns the finished extent
   */
  private finish(): ItemExtent {
    // Most items detach no `+` at all, so this is a branch on what the
    // scan saw rather than a check on whether it can be trusted.
    if (this.detached !== undefined) {
      // Unconditional — no within_nested_list guard here (l.1576),
      // which is what hands a nested-list detached `+`'s block to the
      // OUTER item: the inner scan re-reads a blank where the `+` was.
      // The blank must still run before the strip: a trailing detached
      // `+` reads as a blank to the strip loop only once blanked,
      // which is what keeps it out of the marked pop (`popped` stays
      // false) and lets the blanks behind it strip too. The cell
      // removes Ruby's dangling-slot hazard (a pop can leave
      // `detached_continuation` off the buffer's end, l.1576), not the
      // ordering.
      this.blank(this.detached);
    }
    let popped = false;
    let erasedTail = false;
    // The CELL is the loop's condition, not the buffer's length: an
    // empty buffer and a missing last cell are one fact, so spelling
    // it once leaves nothing for the body to re-check.
    for (
      let last = this.buffer.at(-1);
      last !== undefined;
      last = this.buffer.at(-1)
    ) {
      if (last.current.text === "") {
        // The blanked detached `+` strips off the tail HERE, as the
        // blank it became — cell identity is the report's whole test,
        // exactly as the marked pop's below.
        if (last === this.detached) erasedTail = true;
        this.buffer.pop(); // strip trailing blank lines, l.1583-85
        continue;
      }
      // l.1580-81, on the marker INSTANCE: a `+` the loop buffered as a
      // continuation, never one a slurp carried in as block content.
      // The test is cell IDENTITY — is the last cell the one
      // `pushMarker` made? — which admits exactly what the scan
      // marked: the last `+` `pushMarker` buffered. How that set
      // relates to Ruby's tagged Strings is the OPEN question recorded
      // at previousIsContinuation (#56).
      if (last === this.marked) {
        this.buffer.pop();
        popped = true;
      }
      break;
    }
    return {
      // The cells are unwrapped ONCE, here: nothing outside this scan
      // holds one, so nothing outside it can rewrite a buffered line.
      buffer: this.buffer.map((cell) => cell.current),
      end: this.index,
      poppedContinuation: popped,
      erasedTailContinuation: erasedTail,
      activeTailContinuation: this.continuation === "active",
      tailSafe: this.boundarySafe(),
    };
  }

  /**
   * Whether a `+` printed at the very end of this ITEM re-reads inert
   * — see {@link ItemExtent.tailSafe}. Every stopping arm unreads its
   * stop line, so `lines[index]` IS the stopper: a sibling prints on
   * the very next output line (the item printer and the block
   * printers keep those adjacent) and pops the `+` again; any other
   * stopper reaches the output behind a blank line (joinBlocks),
   * above which a lone `+` erases and ARMS. At stream end the answer
   * is the bounds'.
   *
   * An ERASED stopper is the third safe answer, and not for either of
   * those reasons. That line is the enclosing item's own blanked `+`,
   * whose spelling the ENCLOSING gap replays around this item's tail
   * (`["+", "", "+"]` for `* a` / `** b` / `+` / `+` / blank / `+`),
   * so a `+` printed at this tail comes back shielded by exactly the
   * run the source put there and re-reads as the frozen `+` it was —
   * inert, never armed.
   * @returns true when the tail is a safe print boundary
   */
  private boundarySafe(): boolean {
    const stop = this.lines.at(this.index);
    if (stop === undefined) return this.context.tailSafe;
    return stop.continuationTag === "erased" || this.endsTheItem(stop.text);
  }
}

/**
 * Collect one list item's extent — see the module comment. Pure
 * except one declared side effect: appending to the shared gap
 * record. The only state is the scan's own — Ruby's four locals
 * (`continuation`, `withinNestedList`, `detached`, the read position),
 * `marked` (a fifth, JS-only — see {@link ExtentScan}), and the
 * `readonly` buffer of cells they fill, blanked in place: five mutable
 * members and one buffer. Exported for its branch table
 * (tests/parser/item-extent.test.ts).
 * @param lines - the lines the item is read from (the document's, or
 *   an enclosing item's buffer — nesting composes by re-scanning)
 * @param from - index of the first line after the item's marker line
 * @param trait - the trait siblings are matched by
 * @param context - the stream-end fact and the gap record
 *   ({@link ExtentContext})
 * @returns the buffer, the end index and the two `+` facts
 * Exported for its unit test (tests/parser/item-extent.test.ts); no
 * src consumer.
 * @internal
 */
export function itemExtent(
  lines: readonly SourceLine[],
  from: number,
  trait: SiblingTrait,
  context: ExtentContext,
): ItemExtent {
  return new ExtentScan(lines, from, trait, context).run();
}
