/**
 * The state of one list item while its lines stream by —
 * `read_lines_for_list_item`'s per-item bookkeeping (the `+` ladder,
 * held-back metadata, blank-line budgets) — and the parts of the
 * item's node it accumulates on the way (marker, text, blocks).
 *
 * Split out of list-frames.ts so frames.ts (the shared-type module
 * that breaks the reader/list-reader/list-frames import cycle — a
 * cyclic module group has no reading order, so the graph is gated at
 * zero cycles, Ruling 31) can import `Item` as a plain type without
 * importing list-frames.ts itself: this file touches nothing but
 * constants.js, split.ts and the leaf types it accumulates (ast.js,
 * positions.ts, inline/tokens.ts), so it has nowhere a cycle could
 * re-enter through. That is also why {@link PendingMark} is declared
 * HERE rather than in frames.ts, which imports this file: the item
 * carries the mark, so the type has to live at or below the item.
 */
import type { AttachedBlock, ItemContinuation } from "../../ast.js";
import { EMPTY, NEXT } from "../../constants.js";
import type { InlineToken } from "../inline/tokens.js";
import type { Fragment } from "../positions.js";
import type { SourceLine } from "./split.js";

/**
 * `read_lines_for_list_item`'s continuation state.
 *
 * - `inactive` — no `+` is pending; a delimited block would END the
 *   list rather than attach to the item.
 * - `active` — a `+` was read and the block that follows attaches to
 *   the item. Ruby spells this "the previous buffered line is a
 *   LIST_CONTINUATION" and flips the state on the line AFTER the `+`;
 *   holding it on the `+` itself is the same thing read forwards.
 * - `frozen` — a second `+` arrived directly after the first. Ruby
 *   keeps that one as content and drops every further one, calling the
 *   shape "really a syntax error".
 */
export type ContinuationState = "inactive" | "active" | "frozen";

/**
 * How the next node pushed into a list item was introduced — the
 * spelling the printer writes back (`AttachedBlock.continuation` and
 * `.pluses`), decided by the list reader on the block's FIRST line and
 * consumed when the block's node is pushed, which for a delimited
 * block or a nested list is only when its frame closes.
 */
export interface PendingMark {
  /** The spelling the printer writes back. */
  readonly continuation: ItemContinuation;
  /**
   * How many `+` lines introduced it: 1 for a plus, N for stacked
   * detached ones, 0 for none.
   */
  readonly pluses: number;
}

// A `+` directly above its block is exactly one `+` line.
const SINGLE_PLUS = 1;

/**
 * The mark of a block a `+` stands directly above — what an unmarked
 * block inside an item always was.
 */
export const PLUS_MARK: PendingMark = {
  continuation: "plus",
  pluses: SINGLE_PLUS,
};

/**
 * The state of one list item while its lines stream by — the whole of
 * what `read_lines_for_list_item` remembers between lines — plus the
 * node parts the item has accumulated so far.
 */
export class Item {
  /** Whether a `+` is pending; see {@link ContinuationState}. */
  continuation: ContinuationState = "inactive";
  /**
   * The `+` line that has not yet attached anything. Ruby drops a
   * trailing continuation (`buffer.pop if last_line == LIST_CONTINUATION`);
   * we remember the line so the item can end on
   * `danglingContinuation` instead, because a formatter may not delete
   * a line the author wrote.
   */
  pendingPlus: SourceLine | undefined = undefined;
  /**
   * The last `+` line this item saw, whatever it did with it. Ruby's
   * "adjacent list continuations" test is `prev_line ==
   * LIST_CONTINUATION` over the item's BUFFERED lines — and every line
   * the item consumes is buffered (metadata, attribute entries and
   * blank lines included), so "adjacent" is exactly "the line directly
   * above", which a line number settles.
   */
  lastPlus: SourceLine | undefined = undefined;
  /**
   * Set when a blank line has already ended this item's content and
   * the `+` that followed the blank was claimed by an OUTER item (a
   * detached continuation inside a nested list — see
   * `continuationLine` in list-reader.ts). Ruby deletes that `+` from
   * every buffer, so from this item's point of view the next line
   * simply comes after a blank line, whatever `BlockReader.blanks`
   * says now. Consumed by the first line that arrives.
   */
  separatedByBlank = false;

  /** The item's principal text, tokenized. */
  body: readonly InlineToken[] = [];
  /** Every block the item took, in source order, with its spelling. */
  readonly attached: AttachedBlock[] = [];
  /**
   * How the NEXT node pushed into this item was introduced — set by
   * the list reader on the block's first line ({@link Item.markNext}),
   * consumed when the node arrives ({@link Item.takeMark}).
   */
  private pendingMark: PendingMark | undefined = undefined;

  /**
   * Record how the block about to be pushed into the item got here.
   * @param mark - its spelling, for the printer
   */
  markNext(mark: PendingMark): void {
    this.pendingMark = mark;
  }

  /**
   * The mark for the node being pushed, and forget it. An unmarked
   * node is one a `+` stood directly above — the reader marks every
   * block it reads for an item, so the default is the total fallback,
   * not a path a document reaches.
   * @returns the mark
   */
  takeMark(): PendingMark {
    const mark = this.pendingMark ?? PLUS_MARK;
    this.pendingMark = undefined;
    return mark;
  }

  /**
   * 1-based line of the item's marker line. `parse_block_metadata_lines`
   * runs over an item's buffered lines BEFORE its text is read, so
   * metadata on the first line after the marker line folds the
   * paragraph after it into the item text, while metadata on a later
   * line ends the text and attaches a block. The marker line is what
   * "first line after" is measured from.
   */
  readonly markerLine: number;

  /**
   * @param line - the item's marker line
   * @param marker - the marker's span on it, leading indent excluded
   */
  constructor(
    line: SourceLine,
    readonly marker: Fragment,
  ) {
    ({ line: this.markerLine } = line);
  }

  /**
   * Which interrupting set a paragraph inside this item is read with.
   *
   * `next_block` reads it as `read_paragraph_lines reader, skipped == 0
   * && options[:list_type]`: after a `+` the marker became a blank
   * line, so `skipped > 0`, `break_at_list` is nil, and the plain set
   * applies plus the open lists' own markers — the registry's
   * `listContinuation`. With no `+` the paragraph is adjacent to what
   * came before, `skipped == 0`, and the list-item set applies.
   *
   * Taking it consumes the erased-`+` fact, which applies to the next
   * block only.
   * @returns the paragraph context to read the body with
   */
  takeBodyContext(): "listItem" | "listContinuation" {
    const plain = this.continuation === "inactive" && !this.erasedPlus;
    this.erasedPlus = false;
    return plain ? "listItem" : "listContinuation";
  }

  /**
   * Whether the pending `+` was DETACHED — written after a blank line
   * (`detached_continuation`). The printer reproduces that spelling,
   * so the reader marks the block it attaches (`"detached"`).
   */
  detached = false;
  /**
   * Whether the pending `+` has already introduced a block — metadata,
   * say, or an attribute entry. Later blocks of the group are spelled
   * by what sits directly above them, not by that `+` (`* a` / `+` /
   * `:x: y` / `para` has no `+` above `para`).
   */
  plusUsed = false;
  /**
   * The outer item whose `+` a detached continuation went to, while
   * this (inner) item still decides what the next line is — see
   * {@link Item.separate} and {@link Item.releaseOwner}.
   */
  plusOwner: Item | undefined = undefined;
  /**
   * Detached `+` lines stacked between this item's own detached `+` and
   * the block it attaches — each one an outer item erased
   * (`read_lines_for_list_item` keeps only the LAST detached `+` out of
   * its buffer), so the block's mark counts them all and the printer
   * writes them all back. See {@link Item.stackDetached}.
   */
  extraPluses = EMPTY;
  /** How many blocks the item has taken so far (metadata lines count). */
  blockCount = EMPTY;

  /** Count one block taken by the item. */
  countBlock(): void {
    this.blockCount += NEXT;
  }

  /**
   * Whether the metadata run being held ended item text of more than
   * one line with no `+` (Ruling 26/27), and how many metadata lines it
   * has so far — see `markBlock` in list-reader.ts.
   */
  heldRunAfterText = false;
  /** Whether the run being held carries a block title. */
  heldRunHasTitle = false;
  /**
   * Whether the item's text must keep its last source-line break —
   * `ListItemNode.keepTextBreak`. Set when the run being held would
   * need it should it turn out to be trailing; cleared the moment a
   * block of the item follows the run, so at the item's end it is the
   * answer.
   */
  keepTextBreak = false;
  /** The run being held turned out to need the kept break — see above. */
  keepBreakIfTrailing(): void {
    this.keepTextBreak = true;
  }

  /** A block of the item follows the held run: no kept break needed. */
  blockFollowed(): void {
    this.keepTextBreak = false;
  }

  /**
   * Whether a `+` was erased ahead of the block about to be read:
   * Ruby turns the `+` into a blank line (`buffer[-1] = ''`) whoever
   * claims it — a comment included — so the block after it is read
   * with `skipped > 0`, where no list marker breaks a paragraph.
   */
  erasedPlus = false;

  /**
   * A held-back run begins with this line.
   * @param afterText - whether it ends multi-line item text with no `+`
   */
  beginHeldRun(afterText: boolean): void {
    this.heldRunAfterText = afterText;
    this.heldRunHasTitle = false;
  }

  /**
   * Count one held line of the run.
   * @param title - whether it is a block title
   * @returns true when the run now needs an explicit `+` even when it is
   *   trailing: it ended multi-line item text and carries a block title
   *   — reflowed onto the first rest line, an attribute line or anchor
   *   is still read as metadata but a title after it is read as text
   *   (oracle: `* a para` / `[role]` / `.T` renders `a para .T`, while
   *   `* a para` / `[role]` / `[role]` renders `a para`)
   */
  countHeldLine(title: boolean): boolean {
    this.heldRunHasTitle ||= title;
    return this.heldRunAfterText && this.heldRunHasTitle;
  }

  /**
   * Take a `+`: the next block attaches to this item.
   * @param line - the `+` line, kept in case nothing follows it
   * @param detached - whether a blank line preceded the `+`
   */
  attach(line: SourceLine, detached = false): void {
    this.continuation = "active";
    this.pendingPlus = line;
    this.lastPlus = line;
    this.detached = detached;
    this.plusUsed = false;
  }

  /**
   * A second detached `+` arrived while the first still belongs to an
   * outer item (see {@link Item.separate}). Ruby's outer loop keeps only
   * the LAST detached `+` out of its buffer, so when the inner item
   * re-reads the buffered lines the FIRST `+` is its own detached
   * continuation and it takes the block; the outer `+` attaches
   * nothing. The inner item therefore takes its earlier `+` back as a
   * pending detached continuation, remembers the extra `+` so the block
   * is spelled with both, and keeps the owner to release.
   * @param line - the later detached `+` line
   * @param owner - the outer item that takes the later `+`
   */
  stackDetached(line: SourceLine, owner: Item): void {
    if (this.pendingPlus === undefined) {
      this.attach(this.lastPlus ?? line, true);
    }
    this.extraPluses += NEXT;
    this.separatedByBlank = false;
    this.plusOwner = owner;
    this.lastPlus = line;
  }

  /**
   * How many `+` lines the pending detached continuation is spelled
   * with — its own and the stacked ones — and forget the stacked ones.
   * @returns the count, at least one
   */
  takeDetachedPluses(): number {
    const pluses = NEXT + this.extraPluses;
    this.extraPluses = EMPTY;
    return pluses;
  }

  /**
   * Let the pending `+` speak for the block about to be read — once:
   * later blocks of the group it introduces are spelled by what sits
   * directly above them.
   * @returns how the `+` was written, or undefined when no `+` is
   *   pending or it has already introduced a block
   */
  takePlus(): "plus" | "detached" | undefined {
    if (this.pendingPlus === undefined || this.plusUsed) {
      return undefined;
    }
    this.plusUsed = true;
    return this.detached ? "detached" : "plus";
  }

  /**
   * Take a second, adjacent `+` — Ruby's :frozen state. The first `+`
   * is no longer pending: Ruby erased it the moment this line arrived
   * (`buffer[-1] = ''`), and what it attached is the frozen `+` itself,
   * which the reader keeps as a raw-line leaf. Were it left pending the
   * item would end on a dangling continuation as well, and the printer
   * would write three `+` lines where the source had two.
   * @param line - the adjacent `+` line
   */
  freeze(line: SourceLine): void {
    this.continuation = "frozen";
    this.pendingPlus = undefined;
    this.lastPlus = line;
  }

  /**
   * A detached `+` went to an OUTER item: note that a blank line
   * already separated this item from whatever comes next, that the
   * `+` line itself is what separates them — so a LATER adjacent `+`
   * is still recognised as adjacent — and which item took it.
   * @param line - the `+` line the outer item took
   * @param owner - the outer item that took it
   */
  separate(line: SourceLine, owner: Item): void {
    this.separatedByBlank = true;
    this.lastPlus = line;
    this.plusOwner = owner;
  }

  /**
   * This item kept the line after the detached `+` an outer item took
   * (a sibling or nested marker, a dlist term, a literal paragraph):
   * Ruby's outer loop buffers that line through its
   * `continuation == :active` branch and sets `continuation =
   * :inactive` (parser.rb, `read_lines_for_list_item`: the literal arm
   * and the final else both do), so the outer `+` attaches nothing and a
   * later blank-separated block is OUTSIDE the list. Only metadata
   * leaves it active.
   */
  releaseOwner(): void {
    this.plusOwner?.claim();
    this.plusOwner = undefined;
  }

  /**
   * Whether a `+` on `line` is ADJACENT to the last one — the shape
   * Ruby calls "really a syntax error" and freezes on.
   * @param line - the `+` line being read
   * @returns true when the line directly above was a `+` too
   */
  isAdjacentPlus(line: SourceLine): boolean {
    return (
      this.lastPlus !== undefined && line.line === this.lastPlus.line + NEXT
    );
  }

  /** Consume any pending `+`: the block that follows has claimed it. */
  claim(): void {
    if (this.pendingPlus !== undefined) {
      this.erasedPlus = true;
    }
    this.continuation = "inactive";
    this.pendingPlus = undefined;
    this.detached = false;
  }
}
