/**
 * Lists: a port of `Parser.read_lines_for_list_item` together with the
 * second pass `parse_list_item` runs over the lines it collected
 * (`next_block` with `text_only` / `list_type`), done ONLINE.
 *
 * Ruby buffers an item's lines and re-parses them; we make the same
 * decisions as the lines stream by and emit tokens directly. Every
 * branch below names the Ruby branch it mirrors, and the oracle
 * (`renderedHtml`, pinned in tests/parser/reader.test.ts) is the
 * arbiter wherever the two readings could differ.
 *
 * The model this reads and writes — one `list` frame per open list,
 * each carrying the state of its current item (list-item.ts's `Item`)
 * — is list-frames.ts, which also answers the two questions about the
 * stack that `is_sibling_list_item?` and "end every open list" ask.
 *
 * Nothing here scans backwards or reads the token history: every
 * question is answered from the frame the line arrives in.
 */
import type { TokenType } from "chevrotain";
import { EMPTY, FIRST, NEXT, NOT_FOUND } from "../../constants.js";
import { rawLineForm, type LineKind, type ListVariant } from "./classify.js";
import { isHeldMetadata, type ListHost } from "./frames.js";
import { BLOCK_ANCHOR } from "../line-shapes.js";
import {
  findSiblingList,
  innermostActiveList,
  innermostList,
  listRunBase,
  outermostList,
  type ListFrame,
} from "./list-frames.js";
import { Item } from "./list-item.js";
import { readLiteralParagraph, readParagraph } from "./paragraph-reader.js";
import type { SourceLine } from "./split.js";
import * as T from "./tokens.js";

/** A list-marker line, as {@link LineKind} spells it. */
type MarkerKind = Extract<LineKind, Record<"kind", "listMarker">>;

// The marker token each list kind opens its items with.
const MARKER_TOKENS: Record<ListVariant, TokenType> = {
  unordered: T.UnorderedListMarker,
  ordered: T.OrderedListMarker,
  callout: T.CalloutListMarker,
};

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
 * @param reader - the reader that owns the stack and the token stream
 * @param line - the marker line
 * @param kind - the marker, as the classifier parsed it
 */
export function openList(
  reader: ListHost,
  line: SourceLine,
  kind: MarkerKind,
): void {
  // Metadata read ahead of the marker annotates the LIST, so it has to
  // reach the stream before the marker token does.
  reader.flushMetadata();
  reader.stack.push({
    kind: "list",
    variant: kind.variant,
    style: kind.style,
    item: new Item(),
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
 * @param reader - the reader that owns the stack and the token stream
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
    claimContinuation(reader, item, line);
    reader.openDelimited(line, kind.block);
    return;
  }
  // 5. Item content: `continuation == :active && !this_line.empty?`
  //    and the final `else` differ only in which lines are metadata.
  itemContent(reader, item, line, kind);
}

/**
 * Close one list frame: the item it was reading, then the list.
 * Called by `BlockReader.endFrame` for every list frame it pops, so
 * the frame is passed in rather than read off the stack.
 * @param reader - the reader that owns the token stream
 * @param frame - the list frame being closed
 * @param line - the line the ends fall on, or undefined at EOF
 */
export function closeList(
  reader: ListHost,
  frame: ListFrame,
  line: SourceLine | undefined,
): void {
  endItem(reader, frame, line);
  emitEnd(reader, T.ListEnd, line);
}

/**
 * Emit an item's marker and read its principal text.
 *
 * `parse_list_item` hands the marker line's text plus every adjacent
 * line to `next_block` with `text_only`, which reads them with
 * `read_paragraph_lines reader, list_type` — the registry's `listItem`
 * interrupting set — and `fold_first` merges the result into the item
 * text. One paragraph, opened by the marker token.
 * @param reader - the reader that owns the stack and the token stream
 * @param line - the marker line
 * @param kind - the marker, as the classifier parsed it
 */
function startItem(reader: ListHost, line: SourceLine, kind: MarkerKind): void {
  const { [kind.variant]: marker } = MARKER_TOKENS;
  innermostList(reader).item.beginAt(line);
  // From `indent`, not from column 0: Ruby's `^[ \t]*` swallows the
  // leading whitespace, and the printer re-indents by nesting depth.
  reader.emitLine(marker, line, kind.indent, kind.markerEnd);
  readParagraph(reader, "listItem", line, kind.markerEnd);
}

/**
 * A marker line that is a sibling of one of the open lists: every list
 * inside that one ends, the current item ends, and a new item begins.
 * @param reader - the reader that owns the stack and the token stream
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
  // (Ruby keeps it in the item's lines), and its tokens sit at earlier
  // offsets than the ends about to be emitted — so release it first,
  // which is also what keeps the stream offset-sorted.
  reader.flushMetadata();
  reader.closeDownTo(depth + NEXT, line);
  const frame = innermostList(reader);
  endItem(reader, frame, line);
  frame.item = new Item();
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
 * @param reader - the reader that owns the token stream
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
  markBlock(reader, item, line);
  item.freeze(line);
  // `leaf`, not a bare emit: the `+` is CONTENT, so any metadata held
  // for the block it belongs to has to reach the stream ahead of it.
  reader.leaf(T.RawLine, line);
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
 * @param reader - the reader that owns the stack and the token stream
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
    keepAfterBlank(reader, item, line);
    openList(reader, line, kind);
    return;
  }
  if (kind.kind === "dlistTerm") {
    keepAfterBlank(reader, item, line);
    readParagraph(reader, "dlistItem", line, kind.indent);
    return;
  }
  if (kind.kind === "indented") {
    // "slurp up any literal paragraph offset by blank lines" — read
    // whole, so that a line inside it that looks like a list item
    // cannot throw off the exit from it.
    keepAfterBlank(reader, item, line);
    readLiteralParagraph(reader, line);
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
 * @param reader - the reader that owns the stack and the token stream
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
    markBlock(reader, item, line, {
      held: true,
      title: kind.kind === "blockTitle",
    });
    // Ruby's metadata test names BlockTitleRx, BlockAttributeLineRx
    // (the block anchor is one of its alternatives) and
    // AttributeEntryRx. A comment or directive is not among them, so
    // it falls into the else branch and CONSUMES the continuation —
    // which is how `* a` / `+` / `// c` / `----` ends up with the
    // listing block outside the list (oracle-confirmed).
    if (kind.kind === "raw") {
      item.claim();
    }
    reader.holdMetadata(line, kind);
    return;
  }
  switch (kind.kind) {
    case "attributeEntry": {
      // Metadata like the three held-back shapes, but a leaf of its
      // own: Asciidoctor processes a document attribute where it
      // stands. The continuation survives it.
      markBlock(reader, item, line);
      reader.leaf(T.AttributeEntryLine, line);
      return;
    }
    case "indented": {
      claimContinuation(reader, item, line);
      readLiteralParagraph(reader, line);
      return;
    }
    case "listMarker": {
      // Not a sibling of any open list (checked first), so it opens a
      // nested one — including a callout list, which `next_block`
      // reads as an ordinary in-item block.
      claimContinuation(reader, item, line);
      openList(reader, line, kind);
      return;
    }
    case "dlistTerm": {
      claimContinuation(reader, item, line);
      readParagraph(reader, "dlistItem", line, kind.indent);
      return;
    }
    case "admonitionLabel": {
      const context = item.takeBodyContext();
      claimContinuation(reader, item, line);
      // The label is the block's FIRST token, so any metadata held for
      // that block has to reach the stream ahead of it — readParagraph
      // would otherwise flush it after, out of offset order.
      reader.flushMetadata();
      reader.emitLine(T.AdmonitionLabel, line, FIRST, kind.labelEnd);
      readParagraph(reader, context, line, kind.labelEnd);
      return;
    }
    case "blockMacro":
    case "thematicBreak":
    case "pageBreak": {
      claimContinuation(reader, item, line);
      const { [kind.kind]: token } = LEAF_TOKENS;
      reader.leaf(token, line);
      return;
    }
    default: {
      // Text, and every block shape a confined reader never honours —
      // a section title among them, since `next_block` makes no
      // sections.
      const context = item.takeBodyContext();
      claimContinuation(reader, item, line);
      readParagraph(reader, context, line, FIRST);
    }
  }
}

/**
 * A block is about to be read for this item, and it is the block the
 * pending `+` (if any) attaches: mark how it got here, then claim.
 * @param reader - the reader that owns the token stream
 * @param item - the item reading the block
 * @param line - the block's first line
 */
function claimContinuation(
  reader: ListHost,
  item: Item,
  line: SourceLine,
): void {
  markBlock(reader, item, line);
  // The block is this item's, so a detached `+` an outer item took
  // attaches nothing (see Item.releaseOwner).
  item.releaseOwner();
  item.claim();
}

/** Where a block's mark goes, and what the reader knows of its blank. */
interface MarkOptions {
  /** The line is metadata the reader holds back: hold the mark with it. */
  readonly held?: boolean;
  /** The held line is a block title. */
  readonly title?: boolean;
  /** The line follows a blank line, whatever `reader.blanks` says now. */
  readonly afterBlank?: boolean;
}

/**
 * Record HOW a block got into the item — the mark the printer spells
 * back (see {@link T.DetachedContinuation} for the four spellings):
 * introduced by the pending `+` directly above it (no mark), by a
 * detached `+` (DetachedContinuation), or by no `+` at all — directly
 * under the line before it (NoContinuation) or after a blank line
 * (BlankSeparated). A pending `+` speaks for the FIRST block it
 * introduces only (`Item.plusUsed`); the metadata group that block
 * ends is stacked by the printer whatever its marks say. A held
 * metadata line's mark is held with it, so the two are released
 * together and in order. A block this item kept right after a
 * detached `+` an OUTER item took is spelled as the source had it —
 * blank line, `+`, block — whatever that `+` meant to Ruby.
 * @param reader - the reader that owns the token stream
 * @param item - the item reading the block
 * @param line - the block's first line
 * @param options - see {@link MarkOptions}
 */
function markBlock(
  reader: ListHost,
  item: Item,
  line: SourceLine,
  options: MarkOptions = {},
): void {
  if (options.held === true) {
    holdMark(reader, item, line, options);
    return;
  }
  const mark = markFor(reader, item, options);
  item.countBlock();
  // A block follows the held run after all: it gets the explicit `+`,
  // and the item's text need not keep its break for it.
  item.blockFollowed();
  // Ahead of the block's own first token, and behind the metadata
  // released for it (whose lead the reader decided at hold time).
  reader.flushMetadata(true);
  if (mark === undefined) {
    return;
  }
  const repeats = repeatsFor(mark, item);
  for (let index = EMPTY; index < repeats; index += NEXT) {
    reader.emitBoundaryAt(mark, line, FIRST);
  }
}

/**
 * How many marks one continuation is spelled with. A detached
 * continuation carries every `+` that stacked before the block (see
 * `Item.stackDetached`), so it repeats once per `+` and CONSUMES the
 * stack; every other mark is written once.
 * @param mark - the boundary token the block is introduced with
 * @param item - the item whose stacked `+` count is taken
 * @returns how many times to write the mark
 */
function repeatsFor(mark: TokenType | undefined, item: Item): number {
  return mark === T.DetachedContinuation ? item.takeDetachedPluses() : NEXT;
}

/**
 * Mark a metadata line the reader holds back. The FIRST line of a
 * held-back run carries the run's lead, decided here for both outcomes
 * and resolved when the run is released (see `HeldLead`); every later
 * line is stacked under it (NoContinuation).
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
 * (Ruling 28, `KeepTextBreak`).
 * @param reader - the reader that owns the token stream
 * @param item - the item reading the line
 * @param line - the held line
 * @param options - see {@link MarkOptions}
 */
function holdMark(
  reader: ListHost,
  item: Item,
  line: SourceLine,
  options: MarkOptions,
): void {
  if (reader.heldLines === EMPTY) {
    startHeldRun(reader, item, line, options);
  } else {
    // A later line of the run is stacked under the first — unless a
    // `+` stands directly above it (`[role]` / `+` / `[role]` / block),
    // which it then speaks for, like any other block.
    const mark = markFor(reader, item, options);
    if (mark !== undefined) {
      const repeats = repeatsFor(mark, item);
      for (let index = EMPTY; index < repeats; index += NEXT) {
        reader.holdBoundary(mark, line);
      }
    }
  }
  item.countBlock();
  if (item.countHeldLine(options.title === true)) {
    // Trailing, the run would still fold on reflow: the item's text
    // keeps its last line break instead of getting a `+` (Ruling 28 —
    // see KeepTextBreak). Cleared again if a block follows after all.
    item.keepBreakIfTrailing();
  }
}

/**
 * The first line of a held-back run: decide the run's lead for both
 * outcomes (see {@link holdMark}) and hand it to the reader.
 * @param reader - the reader that owns the token stream
 * @param item - the item reading the line
 * @param line - the held line
 * @param options - see {@link MarkOptions}
 */
function startHeldRun(
  reader: ListHost,
  item: Item,
  line: SourceLine,
  options: MarkOptions,
): void {
  const afterBlank = options.afterBlank === true || reader.blanks > EMPTY;
  const afterText =
    item.blocks === EMPTY &&
    item.pendingPlus === undefined &&
    item.plusOwner === undefined &&
    !afterBlank &&
    reflowWouldReachFirstRestLine(
      reader.linesBetween(item.markerLine, line.line),
    );
  const mark = markFor(reader, item, options);
  item.beginHeldRun(afterText);
  reader.holdLead({
    block: afterText ? undefined : mark,
    trailing: mark,
    repeats: repeatsFor(mark, item),
  });
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
 * @param reader - the reader that owns the token stream
 * @param item - the item reading the block
 * @param options - see {@link MarkOptions}
 * @returns the mark, or undefined for a block a `+` stands directly above
 */
function markFor(
  reader: ListHost,
  item: Item,
  options: MarkOptions,
): TokenType | undefined {
  const afterBlank = options.afterBlank === true || reader.blanks > EMPTY;
  if (item.pendingPlus === undefined && item.plusOwner !== undefined) {
    return T.DetachedContinuation;
  }
  switch (item.takePlus()) {
    case "plus": {
      return undefined;
    }
    case "detached": {
      return T.DetachedContinuation;
    }
    default: {
      return afterBlank ? T.BlankSeparated : T.NoContinuation;
    }
  }
}

/**
 * This item keeps the line after a blank one (a nested marker, a dlist
 * term, a literal paragraph): mark the block, and tell the outer item
 * whose detached `+` stood between them that its `+` attached nothing
 * — see {@link Item.releaseOwner}.
 * @param reader - the reader that owns the token stream
 * @param item - the item keeping the line
 * @param line - the line
 */
function keepAfterBlank(reader: ListHost, item: Item, line: SourceLine): void {
  markBlock(reader, item, line, { afterBlank: true });
  item.releaseOwner();
}

// The one-line blocks a list item can hold, and the token each becomes.
const LEAF_TOKENS: Record<
  "blockMacro" | "thematicBreak" | "pageBreak",
  TokenType
> = {
  blockMacro: T.BlockMacroLine,
  thematicBreak: T.ThematicBreakLine,
  pageBreak: T.PageBreakLine,
};

/**
 * End the item a frame is reading, keeping a `+` that attached nothing
 * — but only where it was the item's LAST line.
 *
 * Ruby simply drops such a `+` (`buffer.pop if last_line ==
 * LIST_CONTINUATION`, and `buffer[-1] = ''` the moment any line
 * follows it — a blank line or a metadata line included). We keep it
 * as a {@link T.DanglingContinuation} so the printer can reproduce the
 * byte — EXCEPT when any line came between the `+` and the item's
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
 * @param reader - the reader that owns the token stream
 * @param frame - the list frame whose item is ending
 * @param line - the line the ends fall on, or undefined at EOF
 */
function endItem(
  reader: ListHost,
  frame: ListFrame,
  line: SourceLine | undefined,
): void {
  const { item } = frame;
  if (item.keepTextBreakIfTrailing) {
    emitEnd(reader, T.KeepTextBreak, line);
  }
  if (
    item.pendingPlus !== undefined &&
    item.lastPlus?.line === reader.lastConsumedLine()
  ) {
    emitEnd(reader, T.DanglingContinuation, line);
  }
  emitEnd(reader, T.ItemEnd, line);
}

/**
 * Emit one zero-length end token, at a line or at end of input.
 * @param reader - the reader that owns the token stream
 * @param type - the token type
 * @param line - the line the end falls on, or undefined at EOF
 */
function emitEnd(
  reader: ListHost,
  type: TokenType,
  line: SourceLine | undefined,
): void {
  if (line === undefined) {
    reader.emitBoundaryAtEof(type);
  } else {
    reader.emitBoundaryAt(type, line, FIRST);
  }
}

/**
 * Close every list open at this level of the stack.
 *
 * "This level" is the innermost RUN of list frames: a delimited block
 * between two of them is a barrier, because Ruby parses a delimited
 * block from a fresh reader that never sees the enclosing list.
 * @param reader - the reader that owns the stack and the token stream
 * @param line - the line the ends fall on
 */
function closeLists(reader: ListHost, line: SourceLine): void {
  // Metadata held inside the item belongs to it, and its tokens are at
  // earlier offsets than the ends — release it before them.
  reader.flushMetadata();
  reader.closeDownTo(listRunBase(reader), line);
}
