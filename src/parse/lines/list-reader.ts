/**
 * Lists: a port of `Parser.read_lines_for_list_item` together with the
 * second pass `parse_list_item` runs over the lines it collected
 * (`next_block` with `text_only` / `list_type`), done ONLINE.
 *
 * Ruby buffers an item's lines and re-parses them; we make the same
 * decisions as the lines stream by and build the item's node directly
 * — each block the item takes is pushed into it behind the mark that
 * says how the source spelled its arrival. Every branch below names
 * the Ruby branch it mirrors, and the oracle (`renderedHtml`, pinned
 * in tests/parser/reader.test.ts) is the arbiter wherever the two
 * readings could differ.
 *
 * The model this reads and writes — one `list` frame per open list,
 * each carrying the state of its current item (list-item.ts's `Item`)
 * — is list-frames.ts, which also answers the two questions about the
 * stack that `is_sibling_list_item?` and "end every open list" ask.
 *
 * Nothing here scans backwards or reads the token history: every
 * question is answered from the frame the line arrives in.
 */
import { EMPTY, FIRST, NEXT, NOT_FOUND } from "../../constants.js";
import { buildList, buildListItem } from "../build/list.js";
import { buildAttributeEntry, buildRawBlockLine } from "../build/metadata.js";
import { BLOCK_ANCHOR } from "../line-shapes.js";
import { convertParagraphFormBlocks } from "../paragraph-form.js";
import { rawLineForm, type LineKind } from "./classify.js";
import {
  fragmentOfLine,
  isHeldMetadata,
  leafBuilder,
  type ListHost,
} from "./frames.js";
import {
  findSiblingList,
  innermostActiveList,
  innermostList,
  listRunBase,
  outermostList,
  type ListFrame,
} from "./list-frames.js";
import { Item, PLUS_MARK, type PendingMark } from "./list-item.js";
import { readParagraph } from "./paragraph-reader.js";
import type { SourceLine } from "./split.js";

/** A list-marker line, as {@link LineKind} spells it. */
type MarkerKind = Extract<LineKind, Record<"kind", "listMarker">>;

// The two marks of a block no `+` introduced — directly under the line
// before it, or after a blank line. The printer writes each spelling
// back, never a `+` the author did not write (Ruling 24).
const NONE_MARK: PendingMark = { continuation: "none", pluses: EMPTY };
const BLANK_MARK: PendingMark = { continuation: "blank", pluses: EMPTY };

// How many blank lines a pending `+` survives. Ruby's loop buffers the
// FIRST blank after a `+` as ordinary content (the local `prev_line`
// still holds the `+`, so the "after a blank line" branch does not
// fire), and the content line after it then reaches the
// `continuation == :active` branch and attaches. A SECOND blank does
// see an empty `prev_line`, takes the after-blank branch, and breaks —
// which is why `+` / blank / text attaches and `+` / blank / blank /
// text does not. The oracle pins both.
const ATTACHING_BLANKS = 1;

/**
 * Open a list — a new one at block level, or a nested one inside an
 * item — and read its first item's principal text.
 * @param reader - the reader that owns the stack and the tree
 * @param line - the marker line
 * @param kind - the marker, as the classifier parsed it
 */
export function openList(
  reader: ListHost,
  line: SourceLine,
  kind: MarkerKind,
): void {
  // Metadata read ahead of the marker annotates the LIST, so it has to
  // land in the enclosing container before the list frame opens.
  reader.flushMetadata();
  reader.stack.push({
    kind: "list",
    variant: kind.variant,
    style: kind.style,
    item: newItem(line, kind),
    items: [],
  });
  startItem(reader, line, kind);
}

/**
 * One line arriving while the innermost frame is a list.
 *
 * The principal paragraph has already consumed everything
 * `read_paragraph_lines` would, so this is always a boundary: a
 * marker, a `+`, a delimiter, block metadata, or the first line of a
 * new in-item block.
 *
 * The order of the checks is Ruby's loop order, and it is load-bearing.
 * In particular `is_delimited_block?` (parser.rb:1445) only ever sees
 * the line at the TOP of the loop: once two blank lines have put the
 * loop inside `elsif prev_line && prev_line.empty?` (parser.rb:1502),
 * that branch reads the next content line ITSELF
 * (`skip_blank_lines && read_line`) and never re-tests it for a
 * delimiter, so the only survivals there are a `+`, a sibling, a
 * NESTABLE marker and a literal paragraph. Hence the blank budget is
 * tested BEFORE the delimiter: `+` / blank / `----` attaches, and
 * `+` / blank / blank / `----` does not (oracle-confirmed for the
 * listing, example, open and comment-block families).
 * @param reader - the reader that owns the stack and the tree
 * @param line - the source line
 * @param kind - what the classifier made of it
 */
export function listLine(
  reader: ListHost,
  line: SourceLine,
  kind: LineKind,
): void {
  const frame = innermostList(reader);
  const { item } = frame;
  // 1. `break if is_sibling_list_item?`, asked of every open list.
  if (kind.kind === "listMarker") {
    const sibling = findSiblingList(reader, kind.style);
    if (sibling !== NOT_FOUND) {
      startSibling(reader, sibling, line, kind);
      return;
    }
  }
  // 2. The `+` ladder (Ruby's `prev_line == LIST_CONTINUATION` block).
  if (kind.kind === "continuation") {
    continuationLine(reader, item, line);
    return;
  }
  // 3. `elsif prev_line && prev_line.empty?` — after a blank line only
  //    a `+`, a nested list or a literal paragraph keeps the item, and
  //    a delimiter is no longer even asked about (see above). A
  //    detached `+` that an outer item claimed leaves this item's
  //    `separatedByBlank` set: the blank before it still counts here.
  //
  //    A `|===` table delimiter reaching this branch happens to behave
  //    correctly today for the WRONG reason: tables are not modelled
  //    yet (#10), so the line classifies as text and ends the list
  //    like any other text. When #10 lands and `|===` becomes a
  //    delimiterOpen, this branch is what has to keep ending the list.
  const budget = item.continuation === "active" ? ATTACHING_BLANKS : EMPTY;
  if (reader.blanks > budget || item.separatedByBlank) {
    item.separatedByBlank = false;
    afterBlankLine(reader, item, line, kind);
    return;
  }
  // 4. `break unless continuation == :active` — a delimited block is
  //    "harsh like that": within the blank budget it attaches, and
  //    with no pending `+` it ends the list outright.
  if (kind.kind === "delimiterOpen") {
    if (item.continuation !== "active") {
      closeLists(reader, line);
      return;
    }
    claimContinuation(reader, item);
    reader.openDelimited(line, kind.block);
    return;
  }
  // 5. Item content: `continuation == :active && !this_line.empty?`
  //    and the final `else` differ only in which lines are metadata.
  itemContent(reader, item, line, kind);
}

/**
 * Close one list frame: the item it was reading, then the list, whose
 * node goes to whatever frame is now on top. Called by
 * `BlockReader.closeFrame` for every list frame it pops, so the frame
 * is passed in rather than read off the stack.
 * @param reader - the reader that owns the stack and the tree
 * @param frame - the list frame being closed
 */
export function closeList(reader: ListHost, frame: ListFrame): void {
  endItem(reader, frame);
  reader.push(buildList(frame.variant, frame.items));
}

/**
 * The state of a fresh item, with its marker's span.
 * @param line - the marker line
 * @param kind - the marker, as the classifier parsed it
 * @returns the item, before any of its lines are read
 */
function newItem(line: SourceLine, kind: MarkerKind): Item {
  // From `indent`, not from column 0: Ruby's `^[ \t]*` swallows the
  // leading whitespace, and the printer re-indents by nesting depth.
  return new Item(line, fragmentOfLine(line, kind.indent, kind.markerEnd));
}

/**
 * Read an item's principal text.
 *
 * `parse_list_item` hands the marker line's text plus every adjacent
 * line to `next_block` with `text_only`, which reads them with
 * `read_paragraph_lines reader, list_type` — the registry's `listItem`
 * interrupting set — and `fold_first` merges the result into the item
 * text. One paragraph, read from past the marker.
 * @param reader - the reader that owns the stack and the tree
 * @param line - the marker line
 * @param kind - the marker, as the classifier parsed it
 */
function startItem(reader: ListHost, line: SourceLine, kind: MarkerKind): void {
  const { item } = innermostList(reader);
  const tokens = readParagraph(reader, "listItem", line, kind.markerEnd);
  item.body = tokens;
}

/**
 * A marker line that is a sibling of one of the open lists: every list
 * inside that one ends, the current item ends, and a new item begins.
 * @param reader - the reader that owns the stack and the tree
 * @param depth - stack index of the list the marker is a sibling of
 * @param line - the marker line
 * @param kind - the marker, as the classifier parsed it
 */
function startSibling(
  reader: ListHost,
  depth: number,
  line: SourceLine,
  kind: MarkerKind,
): void {
  // The inner item kept this line, so a detached `+` an outer item took
  // attaches nothing (see Item.releaseOwner).
  innermostList(reader).item.releaseOwner();
  // Metadata held back inside the closing item was buffered INSIDE it
  // (Ruby keeps it in the item's lines), so it belongs to that item —
  // release it before anything closes.
  reader.flushMetadata();
  reader.closeDownTo(depth + NEXT, line);
  const frame = innermostList(reader);
  endItem(reader, frame);
  frame.item = newItem(line, kind);
  startItem(reader, line, kind);
}

/**
 * A lone `+`.
 *
 * Ruby reads this one line behind: it activates the continuation when
 * it sees the line AFTER a buffered `+`, and only then asks whether
 * that line is another `+` (`prev_line == LIST_CONTINUATION`, where
 * `prev_line` is the last BUFFERED line). Read forwards, the same
 * outcomes fall out of what the item remembers: a `+` directly under
 * another `+` is the adjacent case; a `+` under anything else — item
 * text, a blank line, held-back metadata, an attribute entry, a
 * delimited block — is a fresh continuation, pending or detached, and
 * whatever an earlier `+` had pending is simply superseded (Ruby
 * erased it the moment the next line arrived).
 * @param reader - the reader that owns the tree
 * @param item - the state of the item being read
 * @param line - the `+` line
 */
function continuationLine(
  reader: ListHost,
  item: Item,
  line: SourceLine,
): void {
  if (!item.isAdjacentPlus(line)) {
    detachedOrPending(reader, item, line).attach(line, reader.blanks > EMPTY);
    reader.advance();
    return;
  }
  // Adjacent continuations. Ruby keeps the second `+` as CONTENT of
  // the attached block and drops every later one; dropping a line
  // would delete source, so each extra one is kept verbatim on a line
  // of its own instead. The bytes — and so the rendering — are the
  // same; the block structure is not (ORACLE DIVERGENCE, pinned).
  // The first `+` speaks for this line (it is what that `+` attached);
  // every later adjacent one stacks under it with no `+` of its own.
  markBlock(reader, item);
  item.freeze(line);
  // `leaf`, not a bare push: the `+` is CONTENT, so any metadata held
  // for the block it belongs to has to land ahead of it.
  reader.leaf(buildRawBlockLine(fragmentOfLine(line), reader.at));
}

/**
 * Which item a `+` is pending for. Directly under content it is the
 * innermost item's. After a blank line it is a DETACHED continuation
 * (`detached_continuation`), and inside a nested list that belongs to
 * the OUTERMOST item of the run: Ruby's outermost
 * `read_lines_for_list_item` is the one reading the real reader, it
 * deletes the detached `+` from its buffer at the end
 * (`buffer.delete_at detached_continuation`) but keeps `continuation`
 * active, so when the buffered lines are re-read for the nested lists
 * the `+` is gone and the blank line ends the inner item — unless the
 * next line is a sibling, a nested marker or a literal paragraph, which
 * the after-blank rule keeps — while the outer item attaches whatever
 * follows. Oracle: `* a` / `** b` / blank / `+` / `para` puts `para` in
 * a's item after the nested list; with `----` the listing too; with
 * `** c` the inner list simply continues; with `  lit` the literal
 * stays in b. The inner item is told the blank already separated it
 * ({@link Item.separatedByBlank}); see the after-blank branch.
 * @param reader - the reader that owns the stack
 * @param item - the innermost item
 * @param line - the `+` line
 * @returns the item whose continuation the `+` becomes
 */
function detachedOrPending(
  reader: ListHost,
  item: Item,
  line: SourceLine,
): Item {
  if (reader.blanks === EMPTY) {
    return item;
  }
  const outer = outermostList(reader);
  if (outer.item === item) {
    return item;
  }
  if (item.plusOwner === undefined) {
    item.separate(line, outer.item);
  } else {
    // A detached `+` already went to the outer item: this later one
    // goes there too, and the EARLIER one comes back to this item —
    // see Item.stackDetached.
    item.stackDetached(line, outer.item);
  }
  return outer.item;
}

/**
 * The line after a blank one, where Ruby has already skipped every
 * further blank: `+` detaches a continuation, a nested list marker or
 * an indented literal paragraph keeps the item, and anything else ends
 * every open list — down to an outer item whose `+` is still pending,
 * which is the item the line then attaches to (see
 * {@link detachedOrPending}).
 *
 * The nested-marker test is `NESTABLE_LIST_CONTEXTS`, which is
 * `[:ulist, :olist, :dlist]` — NOT `:colist`. A callout marker after a
 * blank line therefore ends the list (oracle-confirmed), which is why
 * this reads the classified KIND (variant and all) rather than asking
 * a variant-blind "does this line look like a marker?" predicate.
 *
 * Reaching this branch at all means a pending `+` has already been
 * ERASED: `buffer[-1] = ''` (parser.rb:1428) runs on the line after
 * the `+`, blank lines included, so by the time `prev_line` is empty
 * the continuation marker is gone from the item. Claiming it here is
 * what keeps a `DanglingContinuation` — and so a `+` line the printer
 * would re-emit — out of the item.
 * @param reader - the reader that owns the stack and the tree
 * @param item - the state of the item being read
 * @param line - the source line
 * @param kind - what the classifier made of it
 */
function afterBlankLine(
  reader: ListHost,
  item: Item,
  line: SourceLine,
  kind: LineKind,
): void {
  item.claim();
  if (kind.kind === "listMarker" && kind.variant !== "callout") {
    keepAfterBlank(reader, item);
    openList(reader, line, kind);
    return;
  }
  if (kind.kind === "dlistTerm") {
    keepAfterBlank(reader, item);
    reader.paragraph("dlistItem", line, kind.indent);
    return;
  }
  if (kind.kind === "indented") {
    // "slurp up any literal paragraph offset by blank lines" — read
    // whole, so that a line inside it that looks like a list item
    // cannot throw off the exit from it.
    keepAfterBlank(reader, item);
    reader.literalParagraph(line);
    return;
  }
  const active = innermostActiveList(reader);
  if (active === NOT_FOUND) {
    closeLists(reader, line);
    return;
  }
  // The nested lists end here; the line is the outer item's, which
  // reads it with its own `+` pending (and its own blank budget, which
  // counts from that `+`).
  reader.flushMetadata();
  reader.closeDownTo(active + NEXT, line);
  listLine(reader, line, kind);
}

/**
 * A content line inside the item.
 *
 * Ruby's `continuation == :active` branch and its final `else` differ
 * in one respect only: while a continuation is pending, block metadata
 * is allowed to "play out until we find the block", so it does NOT
 * consume the `+`. Every other shape does.
 * @param reader - the reader that owns the stack and the tree
 * @param item - the state of the item being read
 * @param line - the source line
 * @param kind - what the classifier made of it
 */
function itemContent(
  reader: ListHost,
  item: Item,
  line: SourceLine,
  kind: LineKind,
): void {
  if (isHeldMetadata(kind)) {
    const mark = holdMark(reader, item, line, kind.kind === "blockTitle");
    // Ruby's metadata test names BlockTitleRx, BlockAttributeLineRx
    // (the block anchor is one of its alternatives) and
    // AttributeEntryRx. A comment or directive is not among them, so
    // it falls into the else branch and CONSUMES the continuation —
    // which is how `* a` / `+` / `// c` / `----` ends up with the
    // listing block outside the list (oracle-confirmed).
    if (kind.kind === "raw") {
      item.claim();
    }
    reader.holdMetadata(line, kind, mark);
    return;
  }
  switch (kind.kind) {
    case "attributeEntry": {
      // Metadata like the three held-back shapes, but a leaf of its
      // own: Asciidoctor processes a document attribute where it
      // stands. The continuation survives it.
      markBlock(reader, item);
      reader.leaf(buildAttributeEntry(fragmentOfLine(line), reader.at));
      return;
    }
    case "indented": {
      claimContinuation(reader, item);
      reader.literalParagraph(line);
      return;
    }
    case "listMarker": {
      // Not a sibling of any open list (checked first), so it opens a
      // nested one — including a callout list, which `next_block`
      // reads as an ordinary in-item block.
      claimContinuation(reader, item);
      openList(reader, line, kind);
      return;
    }
    case "dlistTerm": {
      claimContinuation(reader, item);
      reader.paragraph("dlistItem", line, kind.indent);
      return;
    }
    case "admonitionLabel": {
      const context = item.takeBodyContext();
      claimContinuation(reader, item);
      reader.admonition(context, line, kind.labelEnd);
      return;
    }
    case "blockMacro":
    case "thematicBreak":
    case "pageBreak": {
      claimContinuation(reader, item);
      reader.leaf(leafBuilder(kind.kind)(fragmentOfLine(line), reader.at));
      return;
    }
    default: {
      // Text, and every block shape a confined reader never honours —
      // a section title among them, since `next_block` makes no
      // sections.
      const context = item.takeBodyContext();
      claimContinuation(reader, item);
      reader.paragraph(context, line, FIRST);
    }
  }
}

/**
 * A block is about to be read for this item, and it is the block the
 * pending `+` (if any) attaches: mark how it got here, then claim.
 * @param reader - the reader that owns the tree
 * @param item - the item reading the block
 */
function claimContinuation(reader: ListHost, item: Item): void {
  markBlock(reader, item);
  // The block is this item's, so a detached `+` an outer item took
  // attaches nothing (see Item.releaseOwner).
  item.releaseOwner();
  item.claim();
}

/**
 * Record HOW the block about to be read got into the item — the mark
 * the printer spells back (`AttachedBlock.continuation` / `pluses`):
 * introduced by the pending `+` directly above it, by a detached `+`
 * (a blank line, then one `+` per stacked continuation), or by no `+`
 * at all — directly under the line before it, or after a blank line.
 * A pending `+` speaks for the FIRST block it introduces only
 * (`Item.plusUsed`); the metadata group that block ends is stacked by
 * the printer whatever its marks say. The mark waits on the item as
 * `pendingMark` until the block's node is pushed, which for a
 * delimited block or a nested list is only when its frame closes. A
 * block this item kept right after a detached `+` an OUTER item took
 * is spelled as the source had it — blank line, `+`, block — whatever
 * that `+` meant to Ruby.
 * @param reader - the reader that owns the tree
 * @param item - the item reading the block
 * @param afterBlank - whether the block follows a blank line, whatever
 *   `reader.blanks` says now
 */
function markBlock(reader: ListHost, item: Item, afterBlank = false): void {
  const mark = markFor(reader, item, afterBlank);
  item.countBlock();
  // A block follows the held run after all: it gets the explicit `+`,
  // and the item's text need not keep its break for it.
  item.blockFollowed();
  // Behind the metadata released for it (whose lead the reader decided
  // at hold time), and ahead of the block's own node.
  reader.flushMetadata(true);
  item.markNext(mark);
}

/**
 * Mark a metadata line the reader holds back. The FIRST line of a
 * held-back run carries the run's lead, decided here for both outcomes
 * and resolved when the run is released (see `HeldLead`); every later
 * line is stacked under it (no `+`, directly under the line before).
 *
 * RULING 26/27. Metadata directly under item text of MORE THAN ONE line
 * (comment lines not counted — `Reader#skip_line_comments` removes them
 * before `parse_block_metadata_lines` counts) with no `+` is read as
 * ending the text and annotating the next block; on the first line
 * after the marker line the same metadata folds the block after it
 * into the text — and reflow puts it there. So such a run is spelled
 * with an explicit `+` (no mark) when a block of the item follows it,
 * whatever introduces that block. A trailing run gets NO `+` — a `+`
 * would pull a block after the list back in (`* a` / `para` / `[role]`
 * / blank / `----`, or a whole section) — and keeps its spelling; when
 * it carries a block title (reflowed onto the first rest line, an
 * attribute line or anchor is still read as metadata, but a title after
 * it as text) the item's text keeps its last line break instead
 * (Ruling 28, `ListItemNode.keepTextBreak`).
 * @param reader - the reader that owns the tree
 * @param item - the item reading the line
 * @param line - the held line
 * @param title - whether the held line is a block title
 * @returns the mark the line is held with, or undefined for the first
 *   line of a run, whose mark the lead decides at release
 */
function holdMark(
  reader: ListHost,
  item: Item,
  line: SourceLine,
  title: boolean,
): PendingMark | undefined {
  const first = reader.heldLines === EMPTY;
  if (first) {
    startHeldRun(reader, item, line);
  }
  // A later line of the run is stacked under the first — unless a
  // `+` stands directly above it (`[role]` / `+` / `[role]` / block),
  // which it then speaks for, like any other block.
  const mark = first ? undefined : markFor(reader, item, false);
  item.countBlock();
  if (item.countHeldLine(title)) {
    // Trailing, the run would still fold on reflow: the item's text
    // keeps its last line break instead of getting a `+` (Ruling 28 —
    // see Item.keepTextBreak). Cleared again if a block follows after
    // all.
    item.keepBreakIfTrailing();
  }
  return mark;
}

/**
 * The first line of a held-back run: decide the run's lead for both
 * outcomes (see {@link holdMark}) and hand it to the reader.
 * @param reader - the reader that owns the tree
 * @param item - the item reading the line
 * @param line - the held line
 */
function startHeldRun(reader: ListHost, item: Item, line: SourceLine): void {
  const afterBlank = reader.blanks > EMPTY;
  const afterText =
    item.blockCount === EMPTY &&
    item.pendingPlus === undefined &&
    item.plusOwner === undefined &&
    !afterBlank &&
    reflowWouldReachFirstRestLine(
      reader.linesBetween(item.markerLine, line.line),
    );
  const mark = markFor(reader, item, afterBlank);
  item.beginHeldRun(afterText);
  reader.holdLead({ block: afterText ? PLUS_MARK : mark, trailing: mark });
}

/**
 * Whether reflowing the item's text would put the metadata line after
 * these lines onto the first line after the marker line — the case
 * Ruling 26 keeps off it with an explicit `+`. It would when at least
 * one of them is reflowable text, and none of them keeps a line of its
 * own: `//` comment lines are transparent to `parse_block_metadata_lines`
 * (`Reader#skip_line_comments` removes them first), so metadata under
 * them IS on the first rest line already and keeps its spelling; a
 * preprocessor line or a block anchor kept raw inside the text is printed
 * on its own line, so the metadata under it never reaches the first rest
 * line.
 * @param between - the lines between the marker line and the metadata
 * @returns true when an explicit `+` is needed
 */
function reflowWouldReachFirstRestLine(
  between: readonly SourceLine[],
): boolean {
  const isComment = (line: SourceLine): boolean =>
    line.text.startsWith(COMMENT_HEAD);
  const keepsOwnLine = (line: SourceLine): boolean =>
    rawLineForm(line.text) !== undefined || BLOCK_ANCHOR.test(line.text);
  return (
    between.some((line) => !isComment(line)) &&
    between.every((line) => isComment(line) || !keepsOwnLine(line))
  );
}

// What `Reader#skip_line_comments` takes for a comment: any line that
// starts with two slashes.
const COMMENT_HEAD = "//";

/**
 * The mark for the block about to be read — see {@link markBlock}.
 * @param reader - the reader that owns the tree
 * @param item - the item reading the block
 * @param afterBlank - whether the block follows a blank line, whatever
 *   `reader.blanks` says now
 * @returns the mark
 */
function markFor(
  reader: ListHost,
  item: Item,
  afterBlank: boolean,
): PendingMark {
  if (item.pendingPlus === undefined && item.plusOwner !== undefined) {
    return detachedMark(item);
  }
  switch (item.takePlus()) {
    case "plus": {
      return PLUS_MARK;
    }
    case "detached": {
      return detachedMark(item);
    }
    default: {
      return afterBlank || reader.blanks > EMPTY ? BLANK_MARK : NONE_MARK;
    }
  }
}

/**
 * The mark of a block a DETACHED `+` introduced — written after a blank
 * line. It carries every `+` that stacked before the block (see
 * `Item.stackDetached`), so the printer writes them all back, and
 * taking the count CONSUMES the stack.
 * @param item - the item whose stacked `+` count is taken
 * @returns the mark
 */
function detachedMark(item: Item): PendingMark {
  return { continuation: "detached", pluses: item.takeDetachedPluses() };
}

/**
 * This item keeps the line after a blank one (a nested marker, a dlist
 * term, a literal paragraph): mark the block, and tell the outer item
 * whose detached `+` stood between them that its `+` attached nothing
 * — see {@link Item.releaseOwner}.
 * @param reader - the reader that owns the tree
 * @param item - the item keeping the line
 */
function keepAfterBlank(reader: ListHost, item: Item): void {
  markBlock(reader, item, true);
  item.releaseOwner();
}

/**
 * End the item a frame is reading: build its node from what it
 * accumulated and add it to the frame's items, keeping a `+` that
 * attached nothing — but only where it was the item's LAST line.
 *
 * Ruby simply drops such a `+` (`buffer.pop if last_line ==
 * LIST_CONTINUATION`, and `buffer[-1] = ''` the moment any line
 * follows it — a blank line or a metadata line included). We keep it
 * as `ListItemNode.danglingContinuation` so the printer can reproduce
 * the byte — EXCEPT when any line came between the `+` and the item's
 * end. By then Ruby has erased it, so nothing that follows was
 * attached by it; and the printer derives a `+` of its own for
 * whatever the item did take after it (held-back metadata, say), so
 * re-emitting this one would print a `+` the source never had there
 * (Ruling 23: a byte may be dropped when doing so is rendering-neutral
 * AND idempotent, and this one is both). Most such paths never reach
 * this guard because {@link afterBlankLine} claims the `+` itself: in
 * `+` / two blanks / `  lit` the literal paragraph is slurped into the
 * item by the after-blank rule, not by the continuation. What does
 * reach it is a sibling marker, which is tested BEFORE the blank
 * budget (`* a` / `+` / blank / `* b`), an outer terminator's forced
 * close, and EOF.
 * @param reader - the reader that owns the tree
 * @param frame - the list frame whose item is ending
 */
function endItem(reader: ListHost, frame: ListFrame): void {
  const { item } = frame;
  // The style-driven conversions replace a pair of blocks with a pair,
  // so each converted block keeps the mark of the one it replaced.
  const blocks = convertParagraphFormBlocks(
    item.attached.map(({ block }) => block),
    reader.source,
  ).map((block, index) => ({ ...item.attached[index], block }));
  frame.items.push(
    buildListItem(
      {
        marker: item.marker,
        variant: frame.variant,
        body: item.body,
        blocks,
        keepTextBreak: item.keepTextBreak,
        danglingContinuation:
          item.pendingPlus !== undefined &&
          item.lastPlus?.line === reader.lastConsumedLine(),
      },
      reader.at,
    ),
  );
}

/**
 * Close every list open at this level of the stack.
 *
 * "This level" is the innermost RUN of list frames: a delimited block
 * between two of them is a barrier, because Ruby parses a delimited
 * block from a fresh reader that never sees the enclosing list.
 * @param reader - the reader that owns the stack and the tree
 * @param line - the line the ends fall on
 */
function closeLists(reader: ListHost, line: SourceLine): void {
  // Metadata held inside the item was buffered INSIDE it (Ruby keeps it
  // in the item's lines), so it belongs to that item — release it
  // before anything closes.
  reader.flushMetadata();
  reader.closeDownTo(listRunBase(reader), line);
}
