/**
 * Lists, read extent-first — Asciidoctor's own structure:
 * `parse_list` (parser.rb l.1115) walks sibling markers, ported below
 * as {@link listShape}; `parse_list_item` (l.1297) collects one item's
 * extent (`read_lines_for_list_item`, ported as {@link itemExtent}).
 *
 * Everything here is a PURE FUNCTION over lines: a scan writes to
 * nothing it did not make, and hands back what it decided. The
 * re-parse of an item's buffer with a confined reader (`Reader.new
 * buffer`, l.1359) is NOT here: the module that owns the read
 * position owns every recursion, hands each item's interior back, and
 * list-item-node.ts assembles the node from it. Nesting still
 * composes for Ruby's reason — an inner item's scan runs over the
 * outer item's buffer — but no reader is passed in to make it happen,
 * so nothing in this file can advance a stream or place a node.
 *
 * No frame, no per-item object, no cross-item state: the only mutable
 * state is one ExtentScan's members: Ruby's own four
 * (`continuation`, `withinNestedList`, `detached` and the read
 * position), the state the armed-`+` question is folded into, the
 * record of what each separator line turned out to be, and the
 * `readonly` buffer they fill, whose CELLS the scan rewrites in
 * place to blank a `+` ({@link ExtentScan}).
 *
 * The printer's spelling is not decided here at all: each separator
 * line's ROLE is recorded by the arm that consumes it (GapRole,
 * item-tail.ts), the post-loop turns the roles into the bytes a gap
 * replays, reader.ts applies them to the document-wide record, and
 * gaps are partitioned per block by {@link gapsOf} for
 * src/print/list.ts to replay.
 *
 * The LOOP is here and the POST-LOOP is in item-tail.ts: one Ruby
 * region each (l.1404-1572 and l.1574-89). The seam rule, stated in
 * both files: `finishItem` receives the scan's final state ONCE, as
 * one value, and derives nothing per line.
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
import { conditionalDirective, isDescriptionListLine } from "../line-shapes.js";
import {
  delimiterKind,
  isContinuationLine,
  isLiteralLine,
  metadataLineKind,
  parseListMarker,
  type DelimiterKind,
  type MarkerKind,
  type SiblingTrait,
} from "./classify.js";
import { delimitedExtent } from "./delimited-reader.js";
import {
  finishItem,
  type ArmedTail,
  type Cell,
  type Continuation,
  type GapRole,
  type GapWrite,
  type ItemExtent,
  type ItemStop,
  type ScanTail,
} from "./item-tail.js";
import { directiveDepthAfter } from "./scope.js";
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
  /** Whether a `+` the pop took off the item's end must be printed back. */
  readonly trailingContinuation: boolean;
  /** Whether the pop took the blanked detached `+` off the item's tail. */
  readonly erasedTailContinuation: boolean;
  /** Whether the item's printed tail still shows an armed `+`. */
  readonly activeTail: boolean;
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
  /**
   * Every separator line this list's item scans decided, in item
   * order - the writes reader.ts applies to the document-wide record.
   */
  readonly gapWrites: readonly GapWrite[];
}

/**
 * Scan a whole list opening at `at` — the port of `parse_list`
 * (parser.rb l.1115-1129): one item per sibling marker, anything else
 * ends the list. Pure over the lines: it decides EXTENTS, nothing
 * inside any item is parsed here, and the separator spellings its
 * items decided leave as data. The caller reads each item's interior
 * (a confined reader over `[markerLine, ...buffer]`), applies the
 * writes and assembles the nodes; a scan that recursed would need a
 * reader handed back to it, which is the seam this module no longer
 * has.
 *
 * The dlist arm (#9) plugs in at {@link siblingMarker} and at this
 * function's `opening` parameter, which becomes the union of the
 * opening parses; nothing else here is marker-specific.
 * @param lines - the lines the list is read from (the document's, or
 *   an enclosing item's buffer)
 * @param at - index of the first marker line
 * @param opening - the first marker, as the classifier parsed it
 * @param context - the stream-end fact every item extent inherits
 *   ({@link ExtentContext})
 * @returns one shape per item, the index the caller resumes at, and
 *   every gap write the items decided
 */
export function listShape(
  lines: readonly SourceLine[],
  at: number,
  opening: MarkerKind,
  context: ExtentContext,
): ListShape {
  const trait = siblingTrait(opening);
  // The list's writes, in item order: each item's scan hands its own
  // back and this is where they are strung together, because the list
  // is what the caller applies them for.
  const gapWrites: GapWrite[] = [];
  // One item's shape, as a closure over the facts every item in
  // this list shares — which is also why it is not a top-level
  // function: `lines`, `trait` and `context` are the LIST's, and
  // passing them per item was four arguments saying one thing.
  const itemAt = (
    index: number,
    marker: MarkerKind,
  ): { shape: ListItemShape; end: number } => {
    const extent = itemExtent(lines, index + 1, trait, context);
    gapWrites.push(...extent.gapWrites);
    return {
      shape: {
        markerLine: lines[index],
        marker,
        buffer: extent.buffer,
        trailingContinuation: extent.trailingContinuation,
        erasedTailContinuation: extent.erasedTailContinuation,
        activeTail: extent.activeTail,
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
    // (parser.rb l.1125), live for exactly one stopper: an item extent
    // ends AT an erased line (text `""`) when the after-blank arm
    // hard-stops on the tagged Placeholder
    // ({@link ExtentScan.afterBlank}) - every other stopping arm
    // unreads a NON-blank line. The skip consumes the run whether or not a
    // sibling follows (Ruby's `skip_blank_lines || break` consumes
    // either way, and so does the oracle's coercing
    // `Reader.skipBlankLines`), which is what hands the enclosing
    // reader a block opened AFTER skipped blanks - a content-adjacency
    // fact the paragraph read spends. The skipped lines are already
    // written: the scan that erased or buffered each one recorded its
    // role, and first-write-wins holds where the writes are applied.
    while (lines.at(index)?.text === "") {
      index += 1;
    }
    // `list_rx =~ reader.peek_line` for the next sibling (parser.rb
    // l.1119).
    const next = lines.at(index);
    const marker =
      next === undefined ? undefined : siblingMarker(next.text, trait);
    if (marker === undefined) {
      break;
    }
    const sibling = itemAt(index, marker);
    items.push(sibling.shape);
    index = sibling.end;
  }
  return { items, end: index, gapWrites };
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
 * Each block's gap: the recorded separator lines strictly between the
 * previous piece of the item and the block. A partition of the
 * document-wide gap record (GapRecord, scope.ts) by block positions.
 * Nothing here reads line text, so a non-gap line in a gap is
 * unrepresentable. Every line between two of an item's blocks was
 * consumed by a recording arm of some scan (comments and metadata are
 * blocks), so the record covers these ranges but for the one a scan's
 * own pop took off an item's tail and the item prints back itself
 * (`finishItem`, item-tail.ts) - the exception invariant (vii) states.
 * @param record - the document-wide gap record
 * @param textEnd - the text's last line number
 * @param blocks - the item's blocks, in source order
 * @returns one gap per block
 * Consumed by list-item-node.ts's listItemNode; its unit table is
 * tests/parser/list-reader.test.ts.
 */
export function gapsOf(
  record: ReadonlyMap<number, GapLine>,
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
 * What one extent scan is given beyond the lines themselves: the one
 * fact about the stream around it that the lines cannot say.
 */
interface ExtentContext {
  /**
   * Whether a `+` printed at the very end of the STREAM re-reads
   * inert — true for the document reader (EOF), the confined reader's
   * own boundary fact otherwise.
   */
  readonly tailSafe: boolean;
  /**
   * How many conditional pairs stand open where this scan starts -
   * the reader's own count, folded over the lines IT walked
   * (`directiveDepthAfter`, scope.ts). The scan keeps its own count
   * from here, over the lines it consumes.
   */
  readonly directiveDepth: number;
}

/**
 * Whether a line is a sibling item of the list being read — style
 * equality on the RESOLVED trait, exactly the last arm of
 * `is_sibling_list_item?` (parser.rb l.2284, the comparison itself;
 * the def is at l.2280). The three marker variants' style sets are
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
  if (trait.kind !== "marker") {
    return undefined;
  }
  const parsed = parseListMarker(text);
  if (parsed?.style !== trait.style) {
    return undefined;
  }
  return { kind: "listMarker", ...parsed };
}

/**
 * Whether a line starts a NESTABLE list — `NESTABLE_LIST_CONTEXTS =
 * [:ulist, :olist, :dlist]` (asciidoctor.rb:315, the authority; the
 * three `find` sites are parser.rb l.1503/1530/1562): an unordered or
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
 * Ruby's "is the buffered previous line a `+`" test (parser.rb l.1435).
 * The empty-buffer case is the CALLER's branch, not this one's:
 * `prev_line` is nil for the first line of an item, and nil matches
 * neither the `+` arm nor the after-blank arm (l.1513 tests `prev_line
 * &&` for the same reason), which in this port is the buffer having no
 * last cell.
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
 * One scan's state — Ruby's four locals as four mutable members
 * (`continuation`, `within_nested_list`, `detached_continuation`, the
 * read position), the state the armed-`+` question is folded into,
 * the record of what each separator line turned out to be, and
 * the `readonly` buffer of {@link Cell}s they fill, readonly as an
 * ARRAY: the scan appends, and rewrites a cell's contents to blank a
 * line, but never swaps the array itself. Nothing
 * per-block and nothing cross-item. A class (like paragraph-reader's Paragraph) so
 * each Ruby arm is one small method instead of one 60-line loop body.
 *
 * What the scan does NOT hold is a marked CELL. Ruby marks its `+`
 * lines by identity - `this_line = ListContinuationString if
 * this_line == LIST_CONTINUATION` (parser.rb l.1432) swaps in a
 * String extended with the `ListContinuationMarker` module (parser.rb
 * l.46-50), and the post-loop `ListContinuationMarker === buffer[-1]`
 * (parser.rb l.1580)
 * is an `is_a?` on it. The JavaScript oracle these tests actually run
 * says the same thing in its own words (`class ListContinuation
 * extends String` and a pop gated on `isListContinuation(last)`,
 * node_modules/@asciidoctor/core/src/parser.js). Here the mark is the
 * line's recorded ROLE, which says WHICH of Ruby's arms buffered it
 * as well as that one did - so the post-loop reads a named fate
 * instead of comparing object identities, and a `+` that reached the
 * buffer
 * INSIDE a slurped delimited block has no role at all, which is why
 * it is never popped: it is content of that block, and
 * `* i\n+\n====\n----\nfoo\n----\n+\n` renders it as a paragraph
 * inside the example.
 */
class ExtentScan {
  private readonly buffer: Cell[] = [];
  private continuation: Continuation = "inactive";
  private withinNestedList = false;
  private detached: Cell | undefined = undefined;
  /**
   * What every separator line this scan has consumed turned out to
   * be, by 1-based document line number ({@link GapRole}). One entry
   * per line, written by the arm that decides it and revised by a
   * later arm of the SAME scan when a later line settles it (the
   * activation's `buffer[-1] = ListContinuationPlaceholder`, parser.rb
   * l.1439, blanks a `+` this scan buffered as pending);
   * `finishItem` is its last writer. Nothing here crosses a scan: an
   * inner scan re-reading an outer item's buffer keeps its own
   * record, and the two meet only where the writes are applied, where
   * the first scan's spelling wins.
   */
  private readonly roles = new Map<number, GapRole>();
  /**
   * How the item's tail stands with respect to an armed `+`, folded
   * forward over the arms that decide it ({@link ArmedTail}) - the
   * whole of {@link ItemExtent.activeTail}, answered where the lines
   * are read rather than re-derived from the item's blocks.
   */
  private armedTail: ArmedTail = "spent";
  /**
   * How many conditional pairs stand open over the read position -
   * this scan's OWN count, seeded with the reader's
   * ({@link ExtentContext.directiveDepth}) and folded over the lines
   * the loop consumes. Two integers rather than one shared cell: the
   * reader counts the lines it walks and the scan counts the lines it
   * takes, and neither writes the other's.
   */
  private directiveDepth: number;
  private index: number;

  /**
   * @param lines - the lines the item is read from (the document's, or
   *   an enclosing item's buffer)
   * @param from - index of the first line AFTER the item's marker line
   *   (parse_list_item shifts the marker before reading, parser.rb l.1357)
   * @param trait - the trait siblings are matched by
   * @param context - the stream-end fact ({@link ExtentContext})
   */
  constructor(
    private readonly lines: readonly SourceLine[],
    from: number,
    private readonly trait: SiblingTrait,
    private readonly context: ExtentContext,
  ) {
    this.index = from;
    this.directiveDepth = context.directiveDepth;
  }

  /**
   * Record what one separator line turned out to be, where that is
   * decided. A later arm of this same scan may revise the entry until
   * the item is finished; no arm may guess for a line it did not
   * consume.
   * @param line - the separator line
   * @param role - what this scan's arm made of it
   */
  private role(line: SourceLine, role: GapRole): void {
    this.roles.set(line.line, role);
  }

  /**
   * Spend the continuation on the block just buffered: Ruby's
   * `continuation = :inactive` (parser.rb l.1461, l.1497, l.1511),
   * and with it the armed tail - the `+` above the line attached
   * something, so it is no longer waiting at the item's end.
   */
  private spendContinuation(): void {
    this.continuation = "inactive";
    this.armedTail = "spent";
  }

  /**
   * Walk the lines exactly as Ruby's while loop does.
   * @returns the finished extent
   */
  run(): ItemExtent {
    while (this.index < this.lines.length) {
      const line = this.lines[this.index];
      this.index += 1;
      if (this.step(line) === "stop") {
        break;
      }
      // Folded over the lines the item CONSUMES, and so after the
      // arms rather than before them: every stopping arm unreads its
      // line, and a stop line's own `ifdef` or `endif` belongs to
      // whoever reads it next. Lines a slurp took whole are not
      // counted either - they are content of the block that swallowed
      // them, printed back inside it, and a pair spelled across such
      // a boundary is a document this formatter preserves rather than
      // reads.
      this.directiveDepth = directiveDepthAfter(this.directiveDepth, line.text);
    }
    return this.finish();
  }

  /**
   * One turn of Ruby's while loop: the arms of parser.rb l.1430-1570 in
   * Ruby's order, each one either finishing the item or moving to the
   * next line. Split from `run` because the loop's arms and the loop's
   * bookkeeping are two things; the `complexity` ceiling made the split
   * mandatory rather than optional.
   * @param line - the line just read (the read position is already
   *   past it, so every stopping arm unreads it)
   * @returns whether the item ends on this line
   */
  private step(line: SourceLine): "stop" | "go" {
    // A sibling item — "we've captured the complete list item"
    // (parser.rb l.1430) - or an enclosing delimited block's
    // terminator, which is where the lines Ruby's item reader was
    // given run out. Asked of every line first.
    if (this.endsTheItem(line.text)) {
      this.index -= 1;
      return "stop";
    }
    // prev_line is read from the MUTATED buffer (parser.rb l.1433): a
    // `+` an EARLIER turn blanked reads as a blank here, which is what
    // makes the flat `+`/blank/`+`/para shape take the detached arm.
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
    if (this.continuationArm(line, previous)) {
      return "go";
    }
    const delimiter = delimiterKind(line.text);
    if (delimiter !== undefined) {
      return this.delimitedArm(delimiter);
    }
    // Ruby's next arm is the dlist-only `BlockAttributeLineRx`
    // look-ahead (parser.rb l.1462-82, `elsif dlist && continuation !=
    // :active && ...`): it decides whether a `[...]` run in front of a
    // non-sibling list item joins the item or breaks it. Out of scope
    // with the rest of the dlist branches (#9); it would go exactly
    // here, between the delimited arm and the `:active` arm.
    if (this.continuation === "active" && line.text !== "") {
      this.activeContent(line);
      return "go";
    }
    if (previousText === "") {
      return this.afterBlank(line);
    }
    this.plainLine(line); // the final else, parser.rb l.1560-70
    return "go";
  }

  /**
   * The buffered-`+` arm's guard: whether the previous buffered cell
   * holds a lone `+`. The text is read here, past the cell's own
   * guard, and it is the same text `step` holds: nothing has run
   * between the two reads, and the blanking this arm does happens
   * inside `afterContinuation`, after the test. `step` keeps its own
   * `previousText` because its after-blank arm needs the value from
   * BEFORE this arm ran. Split out of `step` so that guard is two
   * conditions here instead of folded into `step`'s own count, which
   * is what keeps `step` under the `complexity` ceiling.
   * @param line - the line just read
   * @param previous - the last buffered cell, or undefined at an
   *   item's first line
   * @returns true when the `+` arm consumes this turn
   */
  private continuationArm(
    line: SourceLine,
    previous: Cell | undefined,
  ): boolean {
    return (
      previous !== undefined &&
      previousIsContinuation(previous.current.text) &&
      this.afterContinuation(line, previous)
    );
  }

  /**
   * `is_sibling_list_item?` (parser.rb l.1430) - the one shape that
   * ends the item wherever it is read, before and after a blank run
   * alike (l.1519/1528-29 ask the same question a second time). The old
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
   * that)" - parser.rb l.1453-56.
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
   * The buffered-`+` arm (parser.rb l.1435-51, `ListContinuationMarker
   * === prev_line` at 2.0.26): activate the pending `+` — blanking it
   * unless inside a nested list — and freeze on an adjacent one.
   * `LIST_CONTINUATION` itself (asciidoctor.rb l.332) is
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
      // grabbing the lines for those nested lists" - parser.rb
      // l.1412-14, 1439.
      const erasedHere = !this.withinNestedList;
      if (erasedHere) {
        this.blank(previousCell);
      }
      // The tail is ARMED when this `+`'s byte reaches a gap of the
      // printed item, which is the erase above - or, for a DETACHED
      // `+`, the post-loop's own erase at parser.rb l.1576, which has no
      // within_nested_list guard and so puts the byte in the gap even
      // here. A mark kept for a nested list's scan is that scan's to
      // answer for, and arms nothing of this item's.
      if (erasedHere || previousCell === this.detached) {
        this.armedTail = "armed";
      }
    }
    if (!isContinuationLine(line.text)) {
      return false;
    }
    // Adjacent continuations, "really a syntax error" - parser.rb
    // l.1442-46. The gate at l.1444 is Ruby's and now ours: the SECOND
    // `+` of a run is buffered, every later one is read and dropped.
    // The third `+` renders nothing and reaches no block - `*
    // a\n+\n+\n+\n` and `* a\n+\n+\n` are one document to the oracle -
    // so buffering it only to print it back was carrying a byte with no
    // meaning behind it, and it cost the run its fixed point: the
    // printed run shrank by one `+` on every pass.
    if (this.continuation === "frozen") {
      // The dropped `+` enters no buffer, but it still stands between
      // the item's pieces in the document, so it is a gap line.
      this.role(line, "dropped");
    } else {
      this.continuation = "frozen"; // parser.rb l.1445
      this.role(line, "frozen");
      this.pushMarker(line);
    }
    return true;
  }

  /**
   * `continuation == :active && !this_line.empty?` (parser.rb
   * l.1483-1512): a literal paragraph is slurped whole, metadata plays
   * out, anything else is the attached block and consumes the `+`.
   * @param line - the non-blank line under an active continuation
   */
  private activeContent(line: SourceLine): void {
    if (isLiteralLine(line.text)) {
      // "if we don't process it as a whole, then a line in it that
      // looks like a list item will throw off the exit from it" —
      // parser.rb l.1486-95 (l.1495 is the non-dlist read; the dlist one
      // at l.1493 is out of scope).
      this.index -= 1;
      this.slurpLiteral();
      this.spendContinuation(); // parser.rb l.1497
      return;
    }
    // A conditional directive joins the block-metadata set below, and
    // this is the one place directive transparency changes an arm:
    // `preprocess_conditional_directive` answers true and the reader
    // `shift`s the line away before the parser ever looks (reader.rb
    // l.844-848), so THIS line is never the block an armed `+`
    // attached. What may reach the parser instead is other bytes -
    // the single-line form's own text, put on the next line by
    // `replace_next_line` (l.995-997) - or, under a false condition,
    // nothing at all; neither is this line, and the formatter cannot
    // tell which, so it must spend the continuation on neither.
    // Letting the line fall to the else below spent it anyway, and the
    // delimited block that followed then broke the item instead of
    // attaching to it - 29 documents of the 6,384-document directive
    // product, every one of them a rendering this tree lost. The byte
    // stays in the buffer either way: the line is printed back where
    // the author wrote it, inside the region, and only the
    // CONTINUATION stops being spent on it.
    if (
      metadataLineKind(line.text) !== undefined ||
      conditionalDirective(line.text) !== undefined
    ) {
      // parser.rb l.1499-1501, continuation stays active. WHICH of the
      // four shapes it is changes nothing here, so the verdict is only
      // asked for; classify.ts owns the shapes and the order.
      this.buffer.push({ current: line });
      // The line that keeps the tail armed: the `+` above it is still
      // waiting for a block, and this metadata block's own gap is
      // where its byte reaches the output.
      if (this.armedTail === "armed") {
        this.armedTail = "printed";
      }
      return;
    }
    // A `+` here is the block the armed continuation attached, and it
    // goes into the buffer as the LINE rather than as a marker
    // (parser.rb l.1502-11), so the item's re-read makes a block of it
    // and the
    // post-loop's pop leaves it alone.
    if (isContinuationLine(line.text)) {
      this.role(line, "attached");
    }
    // parser.rb l.1503-04
    if (isNestable(line.text)) {
      this.withinNestedList = true;
    }
    this.buffer.push({ current: line });
    this.spendContinuation(); // parser.rb l.1511
  }

  /**
   * `prev_line && prev_line.empty?` (parser.rb l.1513-50): skip further
   * blanks, then only a detached `+`, a nestable marker or a literal
   * paragraph keeps the item. `has_text` is always true outside dlists
   * (l.1525); the greedy no-text arm (l.1551-56) is dlist-only and out
   * of scope (#9).
   * @param first - the line that arrived after the blank
   * @returns whether the item ends here
   */
  private afterBlank(first: SourceLine): "stop" | "go" {
    // An ERASED line is not a blank here: the JS oracle's strict test
    // (`thisLine === ''`, parser.js l.2168 — false for the boxed
    // Placeholder) sends it past the blank skip, where it matches no
    // keeping shape and falls to the break at the bottom (parser.js
    // l.2215).
    // The unread erased line then stands where the sibling loop's
    // blank skip consumes it (listShape). Only THIS arm reads the
    // tag: skipBlanks below keeps coercing, because
    // `Reader.skipBlankLines` does (`String(nextLine) !== ''`,
    // reader.js l.418-27) — the oracle's asymmetry is real and
    // load-bearing.
    const blank = first.text === "" && first.continuationTag !== "erased";
    // `first` is the second blank of a run when it is blank at all —
    // the run loop read it, so skipBlanks below starts past it.
    if (blank) {
      this.role(first, "blank");
    }
    const line = blank ? this.skipBlanks() : first;
    if (line === undefined) {
      return "stop";
    } // EOF, parser.rb l.1517
    if (isContinuationLine(line.text)) {
      // A detached continuation "gets associated with the outermost
      // block" - parser.rb l.1417-19, 1522-24. The held cell is a
      // SCALAR: a later detached `+` replaces it, which is why only
      // the last one is
      // blanked after the loop. Ruby writes `detached_continuation =
      // buffer.size` and then `buffer << line`, naming the slot the
      // push is about to fill; here the push hands back the cell it
      // made.
      this.role(line, "detached");
      this.detached = this.pushMarker(line);
      return "go";
    }
    // parser.rb l.1519 and l.1528-29 are one test here, not two: Ruby asks
    // whether the line it just read is a sibling once for the
    // re-read-past-blanks path and once for the fall-through path, and
    // both arms unread the line and break. A `+` is not a sibling
    // marker, so testing it first changes nothing.
    if (this.endsTheItem(line.text)) {
      this.index -= 1;
      return "stop";
    }
    // Both arms below buffer a line the item's re-read makes a BLOCK
    // of, and a block that is not metadata is where the armed tail
    // ends: the `+` above it reaches no gap of the printed item.
    // Ruby leaves `continuation` alone here (parser.rb l.1530-46
    // assign none),
    // and so do we - the flag and the printed tail are two questions.
    if (isNestable(line.text)) {
      this.buffer.push({ current: line }); // parser.rb l.1530-32
      this.withinNestedList = true;
      this.armedTail = "spent";
      return "go";
    }
    if (isLiteralLine(line.text)) {
      // "slurp up any literal paragraph offset by blank lines" —
      // parser.rb l.1537-46.
      this.index -= 1;
      this.slurpLiteral();
      this.armedTail = "spent";
      return "go";
    }
    // break - parser.rb l.1549; this_line unshifted at l.1574
    this.index -= 1;
    return "stop";
  }

  /**
   * "Advance to the next line of content" — `skip_blank_lines` then
   * `read_line` (parser.rb l.1515-17). The blanks are consumed, not
   * buffered.
   * @returns the first non-blank line, read (the position is past it),
   *   or undefined at EOF — where Ruby's `!this_line` breaks
   */
  private skipBlanks(): SourceLine | undefined {
    while (
      this.index < this.lines.length &&
      this.lines[this.index].text === ""
    ) {
      this.role(this.lines[this.index], "blank");
      this.index += 1;
    }
    // EOF, parser.rb l.1517
    if (this.index >= this.lines.length) {
      return undefined;
    }
    const line = this.lines[this.index];
    this.index += 1;
    return line;
  }

  /**
   * The final else (parser.rb l.1560-70): buffer the line; a nestable
   * marker flips `within_nested_list`. Deliberately does NOT touch
   * `continuation` — that omission IS the one-blank budget: a blank
   * after a `+` lands here with the continuation still active, so the
   * next content line still attaches.
   * @param line - the line to buffer
   */
  private plainLine(line: SourceLine): void {
    // A `+` reaching the final else is Ruby's own `elsif
    // ListContinuationMarker === this_line` arm (parser.rb l.1557-59):
    // the line was swapped for the marker instance at the top of the
    // loop, so it is buffered AS a marker - live, and waiting for the
    // next line to say what it was.
    if (isContinuationLine(line.text)) {
      this.role(line, "pending");
      this.pushMarker(line);
      return;
    }
    // parser.rb l.1562-63
    if (isNestable(line.text)) {
      this.withinNestedList = true;
    }
    // The FIRST blank of a run lands here (later ones take the
    // afterBlank arm): it is buffered, and it is a gap line.
    if (line.text === "") {
      this.role(line, "blank");
    }
    this.buffer.push({ current: line });
  }

  /**
   * Buffer a `+` line AS a continuation marker — Ruby's
   * `ListContinuationString` swap (parser.rb l.1432). The caller
   * records the role that says which arm did it; a `+` that reaches
   * the buffer any other way carries no role, and the pop leaves it
   * alone ({@link ExtentScan}).
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
    return cell;
  }

  /**
   * `read_lines_until terminator: match.terminator, read_last_line:
   * true` (parser.rb l.1460): the whole block, delimiters included,
   * goes into the buffer and the continuation is consumed.
   * @param kind - which delimited block the current line opens
   */
  private slurpDelimited(kind: DelimiterKind): void {
    const openIndex = this.index - 1;
    const { resume } = delimitedExtent(this.lines, openIndex, kind);
    for (let at = openIndex; at < resume; at += 1) {
      this.buffer.push({ current: this.lines[at] });
    }
    this.index = resume;
    this.spendContinuation(); // parser.rb l.1461
  }

  /**
   * `read_lines_until preserve_last_line: true, break_on_blank_lines:
   * true, break_on_list_continuation: true` (parser.rb l.1495/1546, the
   * two non-dlist calls): the literal paragraph runs until a blank line
   * or a `+`, whichever comes first.
   */
  private slurpLiteral(): void {
    while (this.index < this.lines.length) {
      const line = this.lines[this.index];
      if (line.text === "" || isContinuationLine(line.text)) {
        return;
      }
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
    // what settles what the line was: record the role here, where
    // that is known, over whatever the arm that buffered it wrote.
    // The tag makes the cell Ruby's Placeholder rather than a written
    // blank: an inner scan's after-blank arm hard-stops on it
    // (SourceLine.continuationTag).
    this.role(cell.current, "erased");
    cell.current = { ...cell.current, text: "", continuationTag: "erased" };
  }

  /**
   * Hand `finishItem` this scan's final state, once, as one value -
   * the seam rule both files state ({@link ScanTail}, item-tail.ts). The
   * post-loop of `read_lines_for_list_item` (parser.rb l.1574-89) runs
   * there, over what is in this value and nothing else; no line is
   * read a second time.
   * @returns the finished extent
   */
  private finish(): ItemExtent {
    const tail: ScanTail = {
      cells: this.buffer,
      roles: this.roles,
      detached: this.detached,
      end: this.index,
      stop: this.stopFacts(),
      armedTail: this.armedTail,
    };
    return finishItem(tail);
  }

  /**
   * Why the loop stopped, answered HERE because it is a question
   * about the LINES: every stopping arm unreads its stop line, so
   * `lines[index]` IS the stopper, and item-tail.ts never looks at
   * it. What the answer is FOR - whether a `+` printed at this item's
   * end re-reads inert - is answered there (tailPrintsInert), and the
   * arms give each stop its reason.
   * @returns the stop, as one value
   */
  private stopFacts(): ItemStop {
    const stop = this.lines.at(this.index);
    if (stop === undefined) {
      // The stream's own end, which the reader that confined this
      // scan decided (ExtentContext.tailSafe).
      return { kind: "streamEnd", streamTailSafe: this.context.tailSafe };
    }
    // An enclosing scan's blanked `+`, which the after-blank arm
    // hard-stops on ({@link ExtentScan.afterBlank}).
    if (stop.continuationTag === "erased") {
      return { kind: "erased" };
    }
    if (this.endsTheItem(stop.text)) {
      return { kind: "sibling" };
    }
    // The stop line is unread, so this depth is the one the item's
    // own last line stood at - which is the depth whatever the
    // printer writes under that line stands at too.
    return { kind: "other", insideDirectivePair: this.directiveDepth > 0 };
  }
}

/**
 * Collect one list item's extent; see the module comment. A PURE
 * function: the only state is the scan's own (Ruby's four locals
 * (`continuation`, `withinNestedList`, `detached`, the read
 * position), the armed-tail state, the role record, and the
 * `readonly` buffer of cells they fill, blanked in place), and what
 * it decided leaves as the value `finishItem` shapes.
 * @param lines - the lines the item is read from (the document's, or
 *   an enclosing item's buffer — nesting composes by re-scanning)
 * @param from - index of the first line after the item's marker line
 * @param trait - the trait siblings are matched by
 * @param context - the stream-end fact ({@link ExtentContext})
 * @returns the buffer, the end index, the gap writes and the tail facts
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
