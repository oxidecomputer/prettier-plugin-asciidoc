/**
 * Lists, read extent-first — Asciidoctor's own structure:
 * `parse_list` (parser.rb l.1115) walks sibling markers, ported below
 * as {@link listShape}; `parse_list_item` (l.1297) collects one item's
 * extent (`read_lines_for_list_item`, ported as {@link itemExtent}).
 *
 * Everything here is a PURE FUNCTION over lines. The re-parse of an
 * item's buffer with a confined reader (`Reader.new buffer`, l.1359)
 * is NOT here: the module that owns the read position owns every
 * recursion, hands each item's interior back, and
 * {@link listItemNode} assembles the node from it. Nesting still
 * composes for Ruby's reason — an inner item's scan runs over the
 * outer item's buffer — but no reader is passed in to make it happen,
 * so nothing in this file can advance a stream or place a node.
 *
 * No frame, no per-item object, no cross-item state: the only mutable
 * state is one ExtentScan's five mutable members (Ruby's four locals
 * plus the buffer being built).
 *
 * The printer's spelling is not decided here at all: each block's GAP
 * — the verbatim ""/"+" lines between the item's pieces — is read off
 * the ORIGINAL document lines at construction ({@link gapsOf}), and
 * src/print/list.ts replays it.
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
import type { BlockNode, GapLine, ListItemNode } from "../../ast.js";
import { buildListItem } from "../build/list.js";
import type { InlineToken } from "../inline/tokens.js";
import type { LocationIndex } from "../positions.js";
import {
  ATTRIBUTE_ENTRY,
  BLOCK_ANCHOR,
  BLOCK_ATTRIBUTE_LINE,
  BLOCK_TITLE,
  isDescriptionListLine,
  LITERAL_LINE,
} from "../line-shapes.js";
import { unreachable } from "../../unreachable.js";
import {
  delimiterKind,
  isContinuationLine,
  parseListMarker,
  type DelimiterKind,
  type MarkerKind,
  type SiblingTrait,
} from "./classify.js";
import { delimitedExtent } from "./delimited-reader.js";
import { fragmentOfLine } from "./frames.js";
import type { SourceLine } from "./split.js";

/**
 * One item's SHAPE — everything the surface lines decide about it,
 * and nothing that needs the item parsed. Exported because the caller
 * that owns the recursion hands one back to {@link listItemNode} once
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
 * list. Pure over the lines: it decides EXTENTS, and nothing inside
 * any item is parsed here. The caller reads each item's interior (a
 * confined reader over `[markerLine, ...buffer]`) and assembles the
 * nodes; a scan that recursed would need a reader handed back to it,
 * which is the seam this module no longer has.
 *
 * The dlist arm (#9) plugs in at {@link siblingMarker} and at this
 * function's `opening` parameter, which becomes the union of the
 * opening parses; nothing else here is marker-specific.
 * @param lines - the lines the list is read from (the document's, or
 *   an enclosing item's buffer)
 * @param at - index of the first marker line
 * @param opening - the first marker, as the classifier parsed it
 * @param tailSafe - whether a `+` printed at the very END of `lines`
 *   re-reads inert; every item extent inherits it (see
 *   {@link ExtentBounds})
 * @returns one shape per item, and the index the caller resumes at
 */
export function listShape(
  lines: readonly SourceLine[],
  at: number,
  opening: MarkerKind,
  tailSafe: boolean,
): ListShape {
  const trait = siblingTrait(opening);
  // One item's shape, as a closure over the three facts every item in
  // this list shares — which is also why it is not a top-level
  // function: `lines`, `trait` and `tailSafe` are the LIST's, and
  // passing them per item was four arguments saying one thing.
  const itemAt = (
    index: number,
    marker: MarkerKind,
  ): { shape: ListItemShape; end: number } => {
    const extent = itemExtent(lines, index + 1, trait, { tailSafe });
    return {
      shape: {
        markerLine: lines[index],
        marker,
        buffer: extent.buffer,
        poppedContinuation: extent.poppedContinuation,
        tailSafe: extent.tailSafe,
      },
      end: extent.end,
    };
  };
  const first = itemAt(at, opening);
  const items: [ListItemShape, ...ListItemShape[]] = [first.shape];
  let index = first.end;
  for (;;) {
    // `list_rx =~ reader.peek_line` for the next sibling (l.1119).
    // Ruby's `reader.skip_blank_lines || break` (l.1125) has NO
    // counterpart here, and that is a property of this port rather
    // than an omission: Ruby needs it because
    // `read_lines_for_list_item` unshifts its stopper and leaves the
    // blank run sitting in the reader, while `itemExtent` consumes
    // blank runs itself ({@link ExtentScan.skipBlanks}) and every
    // stopping arm unreads a NON-blank stopper — so `lines[extent.end]`
    // is never `""` and a skip loop here would be dead code. It was:
    // an instrumented build executed the loop body zero times over
    // 26,562 documents, and a mutation pass put four mutants on it,
    // two of them NoCoverage.
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

/** What reading one item's interior produced. NOT exported. */
interface ItemInterior {
  /** The principal text's tokens. */
  readonly text: InlineToken[];
  /** The item's blocks, in source order. */
  readonly blocks: BlockNode[];
}

/**
 * Assemble one item's node, once its interior has been read: the
 * marker's own span, the principal text, and each block paired with
 * the GAP that precedes it. Pure — the recursion that produced the
 * interior happened in the caller, and nothing here can start another.
 * @param shape - what the extent scan decided about the item
 * @param interior - the text and blocks the caller read from the buffer
 * @param lines - the document's lines and offset index, plus whether
 *   this item was read from ANOTHER item's buffer
 * @param lines.documentLines - EVERY document line, unerased, for the gaps
 * @param lines.at - the document's offset→Location index
 * @param lines.nested - true when the enclosing reader is confined to
 *   a list item's buffer
 * @returns the item node
 */
export function listItemNode(
  shape: ListItemShape,
  interior: ItemInterior,
  lines: {
    documentLines: readonly SourceLine[];
    at: LocationIndex;
    nested: boolean;
  },
): ListItemNode {
  const { documentLines, at, nested } = lines;
  const { markerLine, marker } = shape;
  const { text, blocks } = interior;
  const gaps = gapsOf(documentLines, textEndLine(at, text, markerLine), blocks);
  return buildListItem(
    {
      marker: fragmentOfLine(markerLine, marker.indent, marker.markerEnd),
      variant: marker.variant,
      // The classifier captured the number when it matched the
      // marker; only a callout has one.
      calloutNumber:
        marker.variant === "callout" ? marker.calloutNumber : undefined,
      text,
      blocks: blocks.map((block, index) => ({ gap: gaps[index], block })),
      trailingContinuation: keptTrailingContinuation(shape, blocks, nested),
    },
    at,
  );
}

/**
 * Whether a `+` the scan popped off an item's end must be printed
 * back — the question {@link ListItemNode.trailingContinuation}
 * answers.
 *
 * The pop is Ruby's and the byte renders nothing WHEN Ruby's own read
 * of the item ended where ours did. Two tails are where it does not,
 * and both are measured rather than argued (the list-shape sweep's own
 * alphabet, exhaustive to depth 5):
 *
 * - an INDENTED LITERAL. Its re-read slurp
 *   (`read_lines_until break_on_blank_lines, break_on_list_continuation`)
 *   takes the `+` and whatever follows into the `<pre>`, so
 *   `* a\n** b\n+\n  lit\n+\n** b\n` renders a three-line literal and
 *   dropping the byte renders a one-line one plus an `<li>` that was
 *   never written.
 * - a paragraph carrying a RAW LINE. That is the reader's record of a
 *   line Ruby folded into prose — a frozen `+`, a marker line a
 *   paragraph swallowed — and the `+` beside it is prose too:
 *   `* a\n+\npara\n** b\n+\n+\n` renders `para ** b +`.
 *
 * A NESTED item — one read from another item's buffer — keeps the byte
 * whatever its own blocks look like. There the enclosing scan has
 * already re-shaped the lines (erasures, slurps, folds) before this
 * item ever saw them, so "our read ended where Ruby's did" is not a
 * claim this reader can make: `* a\n+\n+\n** b\n+\n** b\n` is one
 * paragraph to the oracle and a nested list to us.
 * @param shape - the extent scan's record for this item
 * @param blocks - the blocks its interior read
 * @param nested - whether it was read from another item's buffer
 * @returns true when the byte must come back
 */
function keptTrailingContinuation(
  shape: ListItemShape,
  blocks: readonly BlockNode[],
  nested: boolean,
): boolean {
  if (!shape.poppedContinuation || !shape.tailSafe) return false;
  return nested || blocks.some((block) => readsOnPastTheItem(block));
}

/**
 * Whether a block the item ends with re-reads PAST the item — the two
 * tails {@link keptTrailingContinuation} refuses to drop a `+` behind.
 * @param block - one of the item's blocks
 * @returns true when the block's re-read runs on into the lines below
 */
function readsOnPastTheItem(block: BlockNode): boolean {
  if (block.type === "list") return true;
  if (block.type === "delimitedBlock") return block.form === "indented";
  if (block.type !== "paragraph") return false;
  return block.children.some((child) => child.type === "rawLine");
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
 * The last source line the principal text occupies — where the first
 * block's gap starts counting from.
 * @param at - the document's offset→Location index
 * @param text - the principal text's tokens
 * @param markerLine - the item's marker line (the answer for empty text)
 * @returns the 1-based line number
 */
function textEndLine(
  at: LocationIndex,
  text: readonly InlineToken[],
  markerLine: SourceLine,
): number {
  const last = text.at(-1);
  if (last === undefined) return markerLine.line;
  // One BEFORE the exclusive end: a token ending at a newline must
  // report the line it ends ON, not the next one.
  const end = last.offset + Math.max(last.image.length, 1) - 1;
  return at.at(end).line;
}

/**
 * Each block's gap: the lines strictly between the previous piece of
 * the item and the block, read VERBATIM off the original document
 * lines (never the buffer — the buffer blanks erased `+` lines and
 * omits blanks the extent scan skipped). Anything but a blank or a `+`
 * in a gap is a reader bug, not an input shape: comments, metadata and
 * attribute entries are blocks (checked over the corpus and 40,000
 * random documents), and the AST invariant re-checks it on every
 * parse.
 * Exported for its table test (tests/parser/list-reader.test.ts): the
 * unreachable arm and the boundary arithmetic deserve direct rows, not
 * just corpus coverage.
 * @param documentLines - EVERY document line, unerased
 * @param textEnd - the text's last line number
 * @param blocks - the item's blocks, in source order
 * @returns one gap per block
 * Exported for its unit test (tests/parser/list-reader.test.ts); no
 * src consumer.
 * @internal
 */
export function gapsOf(
  documentLines: readonly SourceLine[],
  textEnd: number,
  blocks: readonly BlockNode[],
): GapLine[][] {
  let previousEnd = textEnd;
  return blocks.map((block) => {
    // slice is by 0-based index, the boundaries by 1-based line
    // number, so "the lines strictly between previousEnd and the
    // block's start line" is exactly this slice.
    const between = documentLines.slice(
      previousEnd,
      block.position.start.line - 1,
    );
    previousEnd = block.position.end.line;
    return between.map((line) => {
      if (line.text !== "" && line.text !== "+") {
        return unreachable(
          `list-item gap holds ${JSON.stringify(line.text)} at line ${String(line.line)}`,
        );
      }
      return line.text === "+" ? "+" : "";
    });
  });
}

/**
 * What bounds one extent scan beyond the lines themselves: whether the
 * END of the stream is a place a printed `+` re-reads inert.
 */
interface ExtentBounds {
  /**
   * Whether a `+` printed at the very end of the STREAM re-reads
   * inert — true for the document reader (EOF), the confined reader's
   * own boundary fact otherwise.
   */
  readonly tailSafe: boolean;
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
  buffer: SourceLine[];
  /**
   * Exclusive index into `lines` after the item's last consumed line —
   * trailing blanks and a popped trailing `+` included, so the caller
   * resumes exactly where Ruby's reader would.
   */
  end: number;
  /**
   * The scan popped a marked `+` off the buffer's end (l.1580-81's pop).
   * The RAW fact only — whether the byte comes back is
   * {@link keptTrailingContinuation}'s question, not this one's.
   */
  poppedContinuation: boolean;
  /**
   * Whether a `+` printed at the very end of THIS ITEM re-reads inert:
   * the scan stopped at a sibling (which the printer puts on the very
   * next line, where the `+` pops again), or the stream itself ended
   * at a safe boundary ({@link ExtentBounds.tailSafe}). False when
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
 * disjoint by construction (`MARKER_STYLES` in line-shapes.ts; every
 * callout marker collapses to the one CALLOUT_STYLE), so equality
 * alone decides. The dlist arm has no producer yet: the conjunction's
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
 * Ruby's "is the buffered previous line a `+`" test (l.1435) over a
 * buffer that may still be empty: `prev_line` is nil for the first
 * line of an item, and nil matches neither the `+` arm nor the
 * after-blank arm (l.1513 tests `prev_line &&` for the same reason).
 *
 * A TEXT test here; at 2.0.26 Ruby's is an IDENTITY test —
 * `ListContinuationMarker === prev_line`, an `is_a?` on the module the
 * two `+`-carrying Strings are extended with (l.46-50). 2.0.20 spelled
 * it `prev_line == LIST_CONTINUATION` and this port mirrors THAT. The
 * two disagree on exactly one value: the erased Placeholder, which is
 * empty (so the text test says no) and tagged (so the identity test
 * says yes). Whether that difference is reachable is OPEN — recorded
 * rather than reworded away, and #56 (`+` runs erased as markers) is
 * where it would show if it is.
 * @param previous - the last buffered line's text, or undefined when
 *   nothing is buffered yet
 * @returns true when the previous line is a lone `+`
 */
function previousIsContinuation(previous: string | undefined): boolean {
  return previous !== undefined && isContinuationLine(previous);
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
 * One scan's state — Ruby's four locals as four mutable members
 * (`continuation`, `within_nested_list`, `detached_continuation`, the
 * read position) plus the `readonly` buffer they fill. Nothing
 * per-block and nothing cross-item. A class (like paragraph-reader's Paragraph) so
 * each Ruby arm is one small method instead of one 60-line loop body.
 */
class ExtentScan {
  private readonly buffer: SourceLine[] = [];
  private continuation: Continuation = "inactive";
  private withinNestedList = false;
  private detachedContinuation: number | undefined = undefined;
  /**
   * Buffer index of the last `+` the LOOP itself buffered as a
   * continuation marker, or -1. The oracle marks those lines by
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
  private markedContinuation = -1;
  private index: number;

  /**
   * @param lines - the lines the item is read from (the document's, or
   *   an enclosing item's buffer)
   * @param from - index of the first line AFTER the item's marker line
   *   (parse_list_item shifts the marker before reading, l.1357)
   * @param trait - the trait siblings are matched by
   * @param bounds - the stream-end print-safety fact
   *   ({@link ExtentBounds})
   */
  constructor(
    private readonly lines: readonly SourceLine[],
    from: number,
    private readonly trait: SiblingTrait,
    private readonly bounds: ExtentBounds,
  ) {
    this.index = from;
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
    // prev_line is read from the MUTATED buffer (l.1433): an erased
    // `+` reads as a blank here, which is what makes the flat
    // `+`/blank/`+`/para shape take the detached arm.
    const previous = this.buffer.at(-1)?.text;
    if (previousIsContinuation(previous) && this.afterContinuation(line)) {
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
    if (previous === "") return this.afterBlank(line);
    this.plainLine(line); // the final else, l.1560-70
    return "go";
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
   * prev_line` at 2.0.26): activate the pending `+` — erasing it
   * unless inside a nested list — and freeze on an adjacent one. `LIST_CONTINUATION` itself (asciidoctor.rb l.332) is
   * `isContinuationLine`'s pattern, shared with the classifier so the
   * scan and the reader can never disagree about what a `+` line is.
   * @param line - the line after the buffered `+`
   * @returns true when the line was fully handled (the adjacent case)
   */
  private afterContinuation(line: SourceLine): boolean {
    if (this.continuation === "inactive") {
      this.continuation = "active"; // l.1437
      // "if we are within a nested list, we don't throw away the list
      // continuation marks because they will be processed when
      // grabbing the lines for those nested lists" — l.1412-14, 1439.
      if (!this.withinNestedList) this.erase(this.buffer.length - 1);
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
    if (this.continuation !== "frozen") {
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
      this.buffer.push(line); // l.1499-1501, continuation stays active
      return;
    }
    if (isNestable(line.text)) this.withinNestedList = true; // l.1503-04
    this.buffer.push(line);
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
    const line = first.text === "" ? this.skipBlanks() : first;
    if (line === undefined) return "stop"; // EOF, l.1517
    if (isContinuationLine(line.text)) {
      // A detached continuation "gets associated with the outermost
      // block" — l.1417-19, 1522-24. The index is a SCALAR: a later
      // detached `+` overwrites it, which is why only the last one is
      // erased after the loop. `push` returns the new length, so the
      // pushed line's index is one less — Ruby's
      // `detached_continuation = buffer.size` then `buffer << line`.
      this.pushMarker(line);
      this.detachedContinuation = this.buffer.length - 1;
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
      this.buffer.push(line); // l.1530-32
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
    this.buffer.push(line);
  }

  /**
   * Buffer a `+` line AS a continuation marker — Ruby's
   * `ListContinuationString` swap (l.1432). Only a line pushed here
   * can be the one l.1580-81 pops; see {@link markedContinuation}.
   * @param line - the `+` line
   */
  private pushMarker(line: SourceLine): void {
    this.markedContinuation = this.buffer.push(line) - 1;
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
      this.buffer.push(this.lines[at]);
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
      this.buffer.push(line);
      this.index += 1;
    }
  }

  /**
   * Blank one buffered line — Ruby assigns `''` over the string; the
   * copy keeps raw/offset/line so positions and gap spellings survive.
   * @param at - non-negative buffer index to erase
   */
  private erase(at: number): void {
    const target = this.buffer.at(at);
    // Total fallback: both callers pass an index into a line they just
    // pushed or read, so the line is there. Doing nothing rather than
    // throwing keeps the scan total. The blast radius is one gap line
    // left unerased, which the gap invariant (gapsOf) then reports on
    // the next parse.
    if (target !== undefined) {
      this.buffer[at] = { ...target, text: "" };
    }
  }

  /**
   * The post-loop cleanup (l.1574-89): erase the detached `+`, strip
   * trailing blanks, pop ONE trailing `+`.
   *
   * The popped `+` is not reported anywhere, because nothing downstream
   * may spend it: it attached nothing, Ruby drops it (l.1580-81) and it
   * renders not one character. The line leaves the buffer here and the
   * item's node has no place to put it, so a `+` an author left at an
   * item's end simply does not come back — render-equal by the
   * oracle's own arithmetic, and idempotent for free.
   * @returns the finished extent
   */
  private finish(): ItemExtent {
    if (this.detachedContinuation !== undefined) {
      // Unconditional — no within_nested_list guard here (l.1576),
      // which is what hands a nested-list detached `+`'s block to the
      // OUTER item: the inner scan re-reads a blank where the `+` was.
      this.erase(this.detachedContinuation);
    }
    let popped = false;
    // The LINE is the loop's condition, not the buffer's length: an
    // empty buffer and a missing last line are one fact, so spelling
    // it once leaves nothing for the body to re-check.
    for (
      let last = this.buffer.at(-1);
      last !== undefined;
      last = this.buffer.at(-1)
    ) {
      if (last.text === "") {
        this.buffer.pop(); // strip trailing blank lines, l.1583-85
        continue;
      }
      // l.1580-81, on the marker INSTANCE: a `+` the loop buffered as a
      // continuation, never one a slurp carried in as block content.
      if (this.buffer.length - 1 === this.markedContinuation) {
        this.buffer.pop();
        popped = true;
      }
      break;
    }
    return {
      buffer: this.buffer,
      end: this.index,
      poppedContinuation: popped,
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
   * @returns true when the tail is a safe print boundary
   */
  private boundarySafe(): boolean {
    const stop = this.lines.at(this.index);
    return stop === undefined
      ? this.bounds.tailSafe
      : this.endsTheItem(stop.text);
  }
}

/**
 * Collect one list item's extent — see the module comment. Pure: the
 * only state is the scan's own — Ruby's four locals as four mutable
 * members (`continuation`, `withinNestedList`,
 * `detachedContinuation`, the read position) plus the `readonly`
 * buffer they fill. Exported for its branch table
 * (tests/parser/item-extent.test.ts).
 * @param lines - the lines the item is read from (the document's, or
 *   an enclosing item's buffer — nesting composes by re-scanning)
 * @param from - index of the first line after the item's marker line
 * @param trait - the trait siblings are matched by
 * @param bounds - the stream-end print-safety fact ({@link ExtentBounds})
 * @returns the buffer, the end index and the two `+` facts
 * Exported for its unit test (tests/parser/item-extent.test.ts); no
 * src consumer.
 * @internal
 */
export function itemExtent(
  lines: readonly SourceLine[],
  from: number,
  trait: SiblingTrait,
  bounds: ExtentBounds,
): ItemExtent {
  return new ExtentScan(lines, from, trait, bounds).run();
}
