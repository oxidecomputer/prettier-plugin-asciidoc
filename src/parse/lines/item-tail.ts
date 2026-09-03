/**
 * How one list item's extent is FINISHED: `read_lines_for_list_item`'s
 * post-loop (parser.rb l.1574-89), ported whole and in Ruby's own arm
 * order. Its sibling file list-reader.ts carries the LOOP
 * (l.1404-1572); one Ruby region each, so a reader following an arm
 * never leaves the range the file cites. Every Ruby line number here
 * is against Asciidoctor core 2.0.26, the revision `@asciidoctor/core`
 * 4.0.11 bundles, exactly as list-reader.ts's are.
 *
 * THE SEAM RULE, stated in both files: {@link finishItem} receives
 * the scan's FINAL state ONCE, as one value ({@link ScanTail}), and
 * derives nothing per line. There is no second reading of the item's
 * lines here - no classifier call, no pattern, no look at
 * `lines[index]`. The scan decided why it stopped ({@link ItemStop})
 * and what each separator line turned out to be ({@link GapRole});
 * this file reads those answers and nothing else.
 *
 * What is decided here, and why it is one place: Ruby's post-loop
 * blanks the detached `+` (l.1576), then walks the buffer's tail with
 * three arms (pop a marker l.1580-82, strip a blank l.1584-85, stop
 * l.1586-87). Which arm takes the last line is what tells an item's
 * trailing `+` from an erased shield, and that difference decides two
 * printed bytes. {@link popTakes} answers it for every role in one
 * exhaustive switch, so a role added to the vocabulary cannot reach
 * the pop without an author saying what the pop does with it.
 */
import type { GapLine } from "../../ast.js";
import type { SourceLine } from "./split.js";

/**
 * One buffered line, held by REFERENCE. The scan blanks lines it
 * buffered earlier, and a cell is what it keeps hold of to do that:
 * the rewrite flows through the reference, so a blank names no
 * position, cannot miss, and cannot go stale while the buffer grows
 * past it or its tail is popped. Validity is local - you blank the
 * cell you hold.
 *
 * Ruby holds POSITIONS instead: `buffer[-1] =
 * ListContinuationPlaceholder` (parser.rb l.1439) and
 * `buffer[detached_continuation] = ...` (l.1576), the second off an
 * index stored lines earlier. This port takes the other shape on
 * purpose, and says nothing about Ruby's own semantics by doing so.
 * The rewrite is the SCAN's alone: {@link finishItem} is handed the
 * cells by value and replaces the one it erases in its own copy, so
 * nothing downstream of the scan writes through a cell. Cells never
 * leave either: {@link finishItem} unwraps them once, so
 * {@link ItemExtent.buffer} is plain lines.
 */
export interface Cell {
  /** The line as the buffer holds it now. */
  current: SourceLine;
}

/**
 * Ruby's three continuation states (parser.rb l.1407-09): `:frozen`
 * marks sequential continuation lines, "really a syntax error".
 */
export type Continuation = "inactive" | "active" | "frozen";

/**
 * What one SEPARATOR line inside an item turned out to be: a blank
 * line, or one of the fates a lone `+` meets in the loop. Recorded by
 * the arm that decides it, so the fact is typed where it is known and
 * never re-derived from line text.
 *
 * - `blank` - a blank line, buffered by the final else (parser.rb
 *   l.1560-70) or
 *   consumed by the after-blank skip (l.1515-17).
 * - `pending` - buffered as a live continuation marker and not yet
 *   decided (`buffer << this_line` at l.1557-59, after the swap at
 *   l.1432). The next line the item reads blanks it (l.1439), the pop
 *   takes it when the item ends first (l.1580-82), and inside a
 *   nested list it stays pending on purpose: `within_nested_list`
 *   keeps the mark "because they will be processed when grabbing the
 *   lines for those nested lists" (parser.rb l.1412-14), so the scan
 *   that re-reads the line is the one that decides it.
 * - `erased` - blanked in place, so the buffer holds Ruby's
 *   Placeholder where the `+` stood (l.1439).
 * - `frozen` - the SECOND `+` of an adjacent run, buffered and never
 *   blanked, "really a syntax error" (l.1442-46).
 * - `dropped` - the THIRD or later `+` of that run: read and never
 *   buffered at all, by l.1444's `continuation != :frozen` gate.
 * - `attached` - the block an ARMED continuation attached turned out
 *   to be a lone `+` itself, so the active arm's fall-through buffers
 *   it as an ordinary content line and spends the continuation
 *   (l.1502-11). It is in the buffer, so the item's re-read makes a
 *   block of it; it was not buffered AS a marker, so the pop is not
 *   what takes it.
 * - `detached` - a `+` that follows a blank line while no
 *   continuation is active, registered on the outermost block
 *   (l.1417-19, l.1522-24) and blanked after the loop (l.1576).
 */
export type GapRole =
  | "blank"
  | "pending"
  | "erased"
  | "frozen"
  | "dropped"
  | "attached"
  | "detached";

/**
 * One separator line a scan consumed, and what it spells in a gap.
 * Returned by the scan; APPLIED by the module that owns the record
 * (reader.ts). The scan writes nothing outside itself.
 */
export interface GapWrite {
  /** 1-based document line number. */
  readonly line: number;
  /** What the line spells in a gap. */
  readonly spelling: GapLine;
}

/**
 * How an item's tail stands with respect to an ARMED `+`: a `+` whose
 * activation ran through block metadata only (parser.rb l.1499-1501
 * keep `:active`) and never met the block it was waiting for. Folded
 * forward by the scan's own arms, because the two questions it
 * answers are both about lines the scan read.
 *
 * - `spent` - no `+` is waiting at the item's tail: none was erased,
 *   or a block took the one that was (l.1461, l.1497, l.1511, and the
 *   two after-blank arms that buffer a block of their own).
 * - `armed` - a `+` was erased into an activation (l.1437-39) and
 *   nothing has been buffered since, so the byte is in no block's gap
 *   and the printed item does not show it.
 * - `printed` - block metadata has been buffered since that `+`, so
 *   the byte reaches the output inside that block's gap and one blank
 *   line under it attaches the next block on re-read.
 *
 * Three states rather than two booleans: "metadata since the `+`" is
 * only a fact while a `+` is armed, and a pair of booleans would make
 * the impossible half of that pair representable.
 */
export type ArmedTail = "spent" | "armed" | "printed";

/**
 * Why the loop stopped, decided ONCE by the scan at the stop - the
 * only thing this file is told about the line the scan stopped on,
 * which is what keeps the classifier out of it.
 */
export type ItemStop =
  | {
      /** The scan ran out of lines (parser.rb l.1517, and the loop's own). */
      readonly kind: "streamEnd";
      /** Whether the STREAM's own end is a safe print boundary. */
      readonly streamTailSafe: boolean;
    }
  | {
      /** The stop line is a sibling item of this list (parser.rb l.1430). */
      readonly kind: "sibling";
    }
  | {
      /** The stop line is an enclosing scan's erased `+`. */
      readonly kind: "erased";
    }
  | {
      /** Any other unread stop line: a delimiter, or content after blanks. */
      readonly kind: "other";
      /**
       * Whether a conditional pair the author opened over this item
       * is still open where it ends, so the item's last line and
       * whatever the printer writes under it both stand inside the
       * region the pair brackets ({@link tailPrintsInert}).
       */
      readonly insideDirectivePair: boolean;
    };

/**
 * What the scan hands {@link finishItem}: its final state, once, by
 * value.
 * Everything the post-loop reads is here, and nothing else is.
 */
export interface ScanTail {
  /** The item's buffered lines, in source order, as the loop left them. */
  readonly cells: readonly Cell[];
  /**
   * What the loop's arms made of every separator line they consumed,
   * by 1-based document line number. The record is the writing scan's
   * own, and {@link finishItem} is its last writer.
   */
  readonly roles: ReadonlyMap<number, GapRole>;
  /**
   * The cell holding the LAST detached `+` the loop read, which is
   * the one parser.rb l.1576 blanks - a later detached `+` replaces an earlier
   * one, exactly as Ruby's scalar `detached_continuation` does.
   */
  readonly detached: Cell | undefined;
  /** Index into the scan's lines after the item's last consumed line. */
  readonly end: number;
  /** Why the loop stopped. */
  readonly stop: ItemStop;
  /** How the item's tail stands with respect to an armed `+`. */
  readonly armedTail: ArmedTail;
}

/**
 * What the scan hands the reader: Ruby's buffer, where it ends, the
 * separator spellings the item read, and the three tail facts the
 * item's node carries.
 */
export interface ItemExtent {
  /**
   * The item's lines in document order, a COPY: every line Ruby erases
   * (`buffer[-1] = ListContinuationPlaceholder` parser.rb l.1439,
   * `buffer[detached_continuation] = ListContinuationPlaceholder`
   * l.1576) has `text: ""` with `raw`, `offset` and `line` intact, so
   * positions and gap spellings survive the rewrite.
   *
   * The erasure writes a TAGGED empty String at 2.0.26, not the plain
   * `''` 2.0.20 wrote: `ListContinuationPlaceholder` is
   * `::String.new.extend ListContinuationMarker` (l.46-50). It is
   * still empty, so `text: ""` is the same observable. The tag is why
   * l.1580's pop, which tests the marker MODULE and not emptiness,
   * has to run ahead of l.1584's blank strip: the other way round the
   * strip would take the placeholder for an ordinary blank and the
   * pop would never see it. {@link finishItem} runs the two in that
   * order; what it tests there is the line's recorded ROLE, which is
   * the tag under a name.
   */
  readonly buffer: readonly SourceLine[];
  /**
   * Exclusive index into `lines` after the item's last consumed line -
   * trailing blanks and a popped trailing `+` included, so the caller
   * resumes exactly where Ruby's reader would.
   */
  readonly end: number;
  /**
   * Every separator line this scan decided, as the byte it spells in a
   * gap. The scan writes nothing outside itself: reader.ts applies
   * these to the document-wide record, where first write wins.
   */
  readonly gapWrites: readonly GapWrite[];
  /**
   * The item's source ended on a `+` the pop took - Ruby's
   * `ListContinuationMarker === (last_line = buffer[-1])` and the
   * `buffer.pop` under it (parser.rb l.1580-82) - AND the
   * tail it would be printed into re-reads inert
   * ({@link tailPrintsInert}) - so the byte the author wrote comes
   * back. `ListItemNode.trailingContinuation` (src/ast.ts) is this
   * fact and nothing else.
   */
  readonly trailingContinuation: boolean;
  /**
   * The cleanup wrote `ListContinuationPlaceholder` over the detached
   * `+` (parser.rb l.1576) and the tail walk's POP arm then took that
   * cell
   * off the buffer's end (l.1580-82): the item's source ended with the
   * erased shield and nothing after it. The POP is the arm that takes
   * it, not the `last_line.empty?` strip at l.1584, because l.1576
   * writes a cell that still carries the marker module, and the walk
   * asks about the module - here, the role - before it asks about
   * emptiness.
   *
   * The scan's half of `ListItemNode.detachedTail`; the block-shape
   * half stays in list-item-node.ts, where the item's blocks exist
   * (endsInPlusParagraph, and the witness that keeps it there).
   *
   * Structurally mutually exclusive with `trailingContinuation`'s
   * first half, by construction rather than by argument: both facts
   * are reported by the SAME arm, which pops exactly one cell and
   * breaks, and the if/else inside it asks which role came off. One
   * pop, one flag, never both.
   */
  readonly erasedTailContinuation: boolean;
  /**
   * The item PRINTS a tail whose continuation is still armed - the
   * scan's own fold, read off {@link ScanTail.armedTail}.
   *
   * An activation whose `+` was followed by blanks alone leaves
   * nothing in the buffer, the item prints without the byte, and a
   * re-read finds no continuation to arm; that tail is `armed` and
   * not `printed`. A `+` left unblanked for a NESTED list to own
   * (`within_nested_list`, parser.rb l.1412-14) arms nothing here
   * either - it was never erased, so the nested scan is the one that
   * answers for the line.
   */
  readonly activeTail: boolean;
  /**
   * Whether a `+` printed at the very end of THIS ITEM re-reads inert
   * ({@link tailPrintsInert}). Carried on past the tail facts because
   * a confined reader over this item's buffer inherits it as its own
   * stream-end boundary fact (reader.ts's Confinement).
   */
  readonly tailSafe: boolean;
}

/**
 * Whether the POP at parser.rb l.1580-82 is what takes a buffered
 * line with this role - so the byte is the item's to print back
 * rather than a line its own re-read still sees.
 *
 * One arm per role and NO default: a role added to {@link GapRole}
 * stops this function compiling until an author answers for it, which
 * is the whole reason the roles exist as a union rather than as
 * cell identities.
 *
 * TAKEN. Ruby's test is `ListContinuationMarker === buffer[-1]`, an
 * `is_a?` on the module the swap at l.1432 extends every `+` String
 * with, so it takes any line the loop buffered AS a marker, blanked
 * or not: `pending` and `frozen` are the unblanked ones, `erased` and
 * `detached` are the Placeholder l.1439 and l.1576 write, which is
 * `::String.new.extend ListContinuationMarker` (l.46-50) and answers
 * the same test.
 *
 * NOT TAKEN. An `attached` `+` went into the buffer as the LINE
 * (l.1502-11's fall-through) rather than as a marker, so the item's
 * re-read makes a block of it and the pop leaves it alone. A `blank`
 * is not a `+` at all and belongs to the strip arm below it
 * (l.1584-85). A `dropped` one never entered the buffer, so no walk
 * can reach it.
 * A TYPE GUARD rather than a plain predicate, because the `undefined`
 * arm is load-bearing at the only call site: {@link walkBufferTail}
 * returns the role it just tested, and the guard is what proves to the
 * compiler that a taken line always HAS a role. The guard is weaker
 * than the switch - it narrows to the whole union, not to the four
 * arms that answer true - which is sound in that direction and keeps
 * the union's members in one list.
 * @param role - the role the buffer's last line carries, or undefined
 *   for a line no arm recorded: content, and content stops the walk
 * @returns true when the pop is what takes that line, narrowing the
 *   role away from `undefined` for the caller that then reports it
 */
function popTakes(role: GapRole | undefined): role is GapRole {
  switch (role) {
    case "pending":
    case "frozen":
    case "erased":
    case "detached": {
      return true;
    }
    case "attached":
    case "blank":
    case "dropped":
    case undefined: {
      return false;
    }
  }
}

/**
 * What one separator line spells in a printed gap, or nothing when
 * the item's own re-read makes a BLOCK of the line instead.
 *
 * The rule, stated once here rather than at each recording arm: a
 * separator spells its byte in the gap exactly when this item's gap
 * is how the byte comes back. `frozen` and `attached` stay in the
 * buffer as content and print as themselves. `pending` is the `+`
 * this scan does not spell at all: a nested list's scan will re-read
 * the line and record what it decides (`within_nested_list`,
 * parser.rb l.1412-14), and first write wins, so this scan must not
 * guess.
 *
 * The line the POP took is out of this switch's reach, and
 * deliberately: the byte comes back through the item's TAIL FACTS
 * ({@link ItemExtent.trailingContinuation},
 * {@link ItemExtent.erasedTailContinuation}) rather than through any
 * gap, so {@link finishItem} drops it from the record before spelling
 * what is left. No role means "the pop took this line" - the arm that
 * records a role cannot know yet, because the pop is decided lines
 * later - which is why the removal is the post-loop's and not a case
 * here.
 * @param role - what the scan made of the line
 * @returns the byte the gap replays, as a one-element list, or an
 *   empty one for a line the buffer keeps. A LIST, so that a role
 *   added to the union cannot fall through this switch into a silent
 *   "no byte": the missing arm makes the function return `undefined`,
 *   which is not a list, and the compiler says so.
 */
function gapSpelling(role: GapRole): readonly GapLine[] {
  switch (role) {
    case "blank": {
      return [""];
    }
    case "erased":
    case "dropped":
    case "detached": {
      return ["+"];
    }
    case "pending":
    case "frozen":
    case "attached": {
      return [];
    }
  }
}

/**
 * Whether a `+` printed at the very end of this ITEM re-reads inert.
 *
 * Every stopping arm unreads its stop line, so the stop IS the next
 * printed neighbour, and four kinds of neighbour answer yes - each
 * for a reason of its own, each naming what says so.
 *
 * A SIBLING prints on the very next output line - `printList`
 * (src/print/list.ts) puts ONE hardline between items and a blank
 * only where `tailSwallowsMarker` says the previous item's last block
 * would swallow the marker - so the `+` above it pops again. A marker
 * that opens a NEW list is not this arm and falls to the last one: the
 * printer puts a blank line between the two blocks, and a lone `+`
 * above a blank line and a block ARMS and attaches it, so `* a` / `+`
 * / `+` / blank / `<1> n` renders its colist OUTSIDE the item. A
 * marker of an ENCLOSING list cannot be spelled here at all - the
 * enclosing scan stopped ON it, so this scan's lines end before it,
 * and the answer arrives instead as that item's own tail-safety
 * through the stream-end arm.
 *
 * An ERASED stopper is the enclosing item's own blanked `+`, whose
 * spelling the enclosing gap replays around this item's tail
 * (`["+", "", "+"]` for `* a` / `** b` / `+` / `+` / blank / `+`), so
 * a `+` printed here comes back shielded by exactly the run the
 * source put there and re-reads as the frozen `+` it was.
 *
 * At STREAM END the answer is the stream's own, which the reader
 * decided when it confined the scan (reader.ts's Confinement) - and a
 * stream ends in two places, not one. The DOCUMENT's end has nothing
 * written after it: no blank line goes under the `+` and no block
 * follows it to attach, so the printed byte re-reads as the same
 * unattached tail the source wrote. An enclosing block's TERMINATOR
 * is the other: `read_lines_until terminator:` hands the interior to
 * a reader of its own (parser.rb l.1046 and parser.rb l.1457-60), so
 * an item that ends on `--` or `====` ends at the last line its
 * reader has and the
 * terminator is written on the very next output line, with no blank
 * between.
 *
 * A conditional PAIR still open over the item answers yes for a
 * reason none of the three share: the byte and the blank line under
 * it are both written inside the region the pair brackets, and this
 * formatter never evaluates the condition, so the region is preserved
 * as the author wrote it and read back the way the author's own bytes
 * were. With the condition false the reader `shift`s the whole region
 * away and hands on `nil` for every line of it (reader.rb l.879-881),
 * blank and all, so nothing the printer put there can change a
 * rendering; with it true `preprocess_conditional_directive` takes
 * only the two directive lines and `shift`s past them (reader.rb
 * l.844-848). Either way the `+` is the second of an adjacent pair on re-read -
 * `ListContinuationMarker === this_line` under a `continuation` that
 * is already active, which freezes it (parser.rb l.1443-46), and
 * frozen is the one state `is_delimited_block?` does not attach under
 * (parser.rb l.1453-56).
 *
 * Any OTHER stopper reaches the output behind a blank line
 * (`joinBlocks`, src/print/join.ts), above which a lone `+`
 * erases and ARMS, which changes what attaches to the item - so the
 * byte may not be printed there.
 * @param stop - why the loop stopped
 * @returns true when the tail is a safe print boundary
 */
function tailPrintsInert(stop: ItemStop): boolean {
  switch (stop.kind) {
    case "streamEnd": {
      return stop.streamTailSafe;
    }
    case "sibling":
    case "erased": {
      return true;
    }
    case "other": {
      return stop.insideDirectivePair;
    }
  }
}

/**
 * The line the pop took off the buffer's end, and what the loop had
 * made of it. ONE value rather than two returns, because the two are
 * only ever read together: the role says which tail fact the item
 * reports, and the line number says which entry of the separator
 * record the item's gaps may no longer spell.
 */
interface PoppedLine {
  /** 1-based document line number of the popped line. */
  readonly line: number;
  /** What the loop's arms had made of it before the pop. */
  readonly role: GapRole;
}

/**
 * The post-loop's TAIL WALK, Ruby's `until buffer.empty?` and its
 * three arms in Ruby's own order: pop ONE trailing marker
 * (parser.rb l.1580-82), else strip a trailing blank and look again
 * (l.1584-85), else stop (l.1586-87).
 *
 * It stands apart from {@link finishItem} because the two things it
 * does have two different consumers: the SHORTENING is the buffer the
 * item prints, finished when the walk returns, while the popped line
 * is a fact the caller still has to spend. Keeping the arms here
 * leaves that caller reading one value instead of reading a loop.
 * @param cells - the item's buffer, {@link finishItem}'s own copy.
 *   The walk SHORTENS it in place, as Ruby's `buffer.pop` does, and in
 *   both of its taking arms: trailing blank cells are stripped
 *   (l.1584-85) and the marker under them is popped (l.1580-82).
 * @param roles - what the scan made of each separator line, by
 *   1-based document line number
 * @returns the line the pop took and the role it carried, or
 *   undefined when the walk stopped on content or emptied the buffer
 *   taking none
 */
function walkBufferTail(
  cells: Cell[],
  roles: ReadonlyMap<number, GapRole>,
): PoppedLine | undefined {
  // The CELL is the loop's condition, not the buffer's length: an
  // empty buffer and a missing last cell are one fact, so spelling it
  // once leaves nothing for the body to re-check.
  for (let last = cells.at(-1); last !== undefined; last = cells.at(-1)) {
    const role = roles.get(last.current.line);
    if (popTakes(role)) {
      cells.pop(); // drop the trailing continuation, parser.rb l.1580-82
      return { line: last.current.line, role };
    }
    if (last.current.text === "") {
      cells.pop(); // strip trailing blank lines, parser.rb l.1584-85
      continue;
    }
    return undefined; // parser.rb l.1586-87
  }
  return undefined;
}

/**
 * Finish one item: the post-loop cleanup (parser.rb l.1574-89) run
 * on the scan's final state, in Ruby's own arm order - blank the
 * detached `+` (l.1576), then walk the buffer's tail
 * ({@link walkBufferTail}).
 *
 * The popped `+`'s BYTES are not reported anywhere, because nothing
 * downstream may spend them: the line attached nothing, Ruby drops it
 * and it renders not one character. Two FACTS about the tail leave
 * here instead, and they are the pop arm's own two answers -
 * `trailingContinuation` (it took a marker the loop left live, and
 * the boundary the item closed on replays it inert) and
 * `erasedTailContinuation` (it took the cell parser.rb l.1576 had
 * blanked).
 * @param tail - the scan's final state, by value
 * @returns the item's extent, its gap writes and its tail facts
 */
export function finishItem(tail: ScanTail): ItemExtent {
  // This function writes only into copies, so BY VALUE is literally
  // true and not a claim about who is done with what: the walk
  // pops from its own array, the record gains its last entries in its
  // own map, and the erase below replaces a CELL in the copy instead
  // of writing through the scan's own object.
  const roles = new Map(tail.roles);
  const { detached } = tail;
  // Ruby's `buffer[detached_continuation] = ListContinuationPlaceholder`
  // (parser.rb l.1576), as a replacement rather than a write, and
  // unconditional - no within_nested_list guard, which is what hands a
  // nested-list detached `+`'s block to the OUTER item: the inner scan
  // re-reads a blank where the `+` was. It happens BEFORE the tail
  // walk because Ruby's does, and the order is load-bearing: l.1576
  // leaves a cell the walk's first arm still recognises, so a trailing
  // detached `+` is taken by the pop rather than stripped as a blank.
  // Most items detach no `+` at all, and then the identity test below
  // simply matches no cell.
  const cells: Cell[] = tail.cells.map((cell) =>
    cell === detached
      ? { current: { ...cell.current, text: "", continuationTag: "erased" } }
      : cell,
  );
  if (detached !== undefined) {
    // Ruby's own write is over the SLOT, and so is the role: a loop
    // arm that blanked this cell on the way past (an activation,
    // parser.rb l.1439) recorded `erased` for it, and l.1576 is the
    // later write.
    roles.set(detached.current.line, "detached");
  }
  const popped = walkBufferTail(cells, roles);
  if (popped !== undefined) {
    // The popped line leaves the separator record with the buffer: the
    // two tail facts below are the ONE place its byte may come back,
    // and a gap that spelled it as well would write the `+` twice.
    // That collision is reachable only through a nested item, because
    // an enclosing scan leaves a `+` standing inside a nested list
    // rather than blanking it (parser.rb l.1412-14, l.1439) and its
    // own gap therefore still spans the line the nested scan pops. The
    // second `+` is not a spare byte there: adjacent to the first it
    // FREEZES the continuation on re-read (l.1443-46), so the nested
    // item ends on the frozen mark and the block under the shield is
    // read into the enclosing item instead.
    //
    // A tail fact that WITHHOLDS the byte (`tailPrintsInert` said the
    // boundary would arm it) drops the line from the output entirely,
    // and that is the same answer: the pop is what Ruby does with a
    // trailing `+`, and a popped `+` renders not one character.
    roles.delete(popped.line);
  }
  // WHICH role came off is the whole difference between the two
  // reports: an erased shield prints back as a blank and a `+`
  // (`ListItemNode.detachedTail`), any other marker as the `+` alone
  // (`trailingContinuation`). Both are read off the one role the walk
  // returned, so the exclusion the two facts claim cannot come apart.
  const erasedTail = popped?.role === "detached";
  const liveTail = popped !== undefined && !erasedTail;
  const inert = tailPrintsInert(tail.stop);
  return {
    // The cells are unwrapped ONCE, here: nothing outside the scan and
    // this call holds one, so nothing else can rewrite a buffered line.
    buffer: cells.map((cell) => cell.current),
    end: tail.end,
    gapWrites: [...roles].flatMap(([line, role]) =>
      gapSpelling(role).map((spelling) => ({ line, spelling })),
    ),
    trailingContinuation: liveTail && inert,
    erasedTailContinuation: erasedTail,
    activeTail: tail.armedTail === "printed",
    tailSafe: inert,
  };
}
