/**
 * Lists, read extent-first — Asciidoctor's own structure:
 * `parse_list` (parser.rb l.1106) walks sibling markers;
 * `parse_list_item` (l.1288) collects one item's extent
 * (`read_lines_for_list_item`, ported below as {@link itemExtent}) and
 * re-parses the buffer with a confined reader (`Reader.new buffer`,
 * l.1350); nesting composes because an inner item's scan runs over the
 * outer item's buffer. No frame, no per-item object, no cross-item
 * state: the only mutable state is one ExtentScan's five mutable
 * members (Ruby's four locals plus the buffer being built).
 *
 * The printer's spelling is not decided here at all: each block's GAP
 * — the verbatim ""/"+" lines between the item's pieces — is read off
 * the ORIGINAL document lines at construction ({@link gapsOf}), and
 * print-list.ts replays it.
 *
 * {@link itemExtent} is the pure port of `read_lines_for_list_item`
 * (parser.rb l.1395–1577, Asciidoctor 2.0.20) for ulist / olist /
 * colist, returning Ruby's BUFFER — the item's lines with every line
 * Ruby blanks rewritten to `text: ""`, offsets and raw spelling intact
 * — plus where the item ends and whether it ended on a trailing `+`.
 * Every branch cites its parser.rb line. Only the `list_type == :dlist`
 * local branches (the greedy no-text arm l.1540-45, the
 * BlockAttributeLineRx look-ahead l.1452-71) are out of scope (#9);
 * they are left as cited comments where they would go.
 */
import type { BlockNode, GapLine, ListItemNode, ListNode } from "../../ast.js";
import { buildList, buildListItem } from "../build/list.js";
import type { InlineToken } from "../inline/tokens.js";
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
  type LineKind,
  type SiblingTrait,
} from "./classify.js";
import { delimitedExtent } from "./delimited-reader.js";
import { fragmentOfLine, type ListHost } from "./frames.js";
import type { SourceLine } from "./split.js";

/** A list-marker line, as {@link LineKind} spells it. */
type MarkerKind = Extract<LineKind, Record<"kind", "listMarker">>;

/**
 * Read a whole list starting at the marker line at `from` — the port
 * of `parse_list` (l.1106-1120): one item per sibling marker, anything
 * else ends the list.
 * @param host - the reader the list is read from (the document's, or
 *   a confined one — nesting recurses through the same seam)
 * @param from - index (into host.lines) of the first marker line
 * @param kind - the first marker, as the classifier parsed it
 * @returns the finished list node, and the index the host resumes at
 *   — the line after the last item's extent
 */
export function readList(
  host: ListHost,
  from: number,
  kind: MarkerKind,
): { node: ListNode; end: number } {
  const items: ListItemNode[] = [];
  let index = from;
  let marker: MarkerKind = kind;
  for (;;) {
    const { item, end } = readListItem(host, index, marker);
    items.push(item);
    index = end;
    // `list_rx =~ reader.peek_line` for the next sibling (l.1110).
    // Ruby's `reader.skip_blank_lines || break` (l.1116) has NO
    // counterpart here, and that is a property of this port rather
    // than an omission: Ruby needs it because
    // `read_lines_for_list_item` unshifts its stopper and leaves the
    // blank run sitting in the reader, while `itemExtent` consumes
    // blank runs itself ({@link ExtentScan.skipBlanks}) and every
    // stopping arm unreads a NON-blank stopper — so `lines[extent.end]`
    // is never `""` and a skip loop here would be dead code. It was:
    // the plan's mutation pass put four mutants on it, two of them
    // NoCoverage, and an instrumented build executed the loop body
    // zero times over 26,562 documents.
    const next = host.lines.at(index);
    const parsed = next === undefined ? undefined : parseListMarker(next.text);
    if (parsed === undefined) break;
    if (parsed.style !== kind.style) break;
    marker = { kind: "listMarker", ...parsed };
  }
  return { node: buildList(kind.variant, kind.style, items), end: index };
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
 * Read one item: extent first, then the interior from the buffer.
 * @param host - the reader the item is read from
 * @param markerIndex - index (into host.lines) of the marker line
 * @param kind - the marker, as the classifier parsed it
 * @returns the item's node, and the index after its extent
 */
function readListItem(
  host: ListHost,
  markerIndex: number,
  kind: MarkerKind,
): { item: ListItemNode; end: number } {
  const { lines } = host;
  const markerLine = lines[markerIndex];
  const extent = itemExtent(host.lines, markerIndex + 1, siblingTrait(kind), {
    tailSafe: host.tailSafe,
  });
  const { text, blocks } = host.confine(
    markerLine,
    kind,
    extent.buffer,
    extent.tailSafe,
  );
  const gaps = gapsOf(
    host.documentLines,
    textEndLine(host, text, markerLine),
    blocks,
  );
  return {
    item: buildListItem(
      {
        marker: fragmentOfLine(markerLine, kind.indent, kind.markerEnd),
        variant: kind.variant,
        text,
        blocks: blocks.map((block, at) => ({ gap: gaps[at], block })),
        trailingContinuation: extent.trailingContinuation,
      },
      host.at,
    ),
    end: extent.end,
  };
}

/**
 * The last source line the principal text occupies — where the first
 * block's gap starts counting from.
 * @param host - the reader, for its location index
 * @param text - the principal text's tokens
 * @param markerLine - the item's marker line (the answer for empty text)
 * @returns the 1-based line number
 */
function textEndLine(
  host: ListHost,
  text: readonly InlineToken[],
  markerLine: SourceLine,
): number {
  const last = text.at(-1);
  if (last === undefined) return markerLine.line;
  // One BEFORE the exclusive end: a token ending at a newline must
  // report the line it ends ON, not the next one.
  const end = last.offset + Math.max(last.image.length, 1) - 1;
  return host.at.at(end).line;
}

/**
 * Each block's gap: the lines strictly between the previous piece of
 * the item and the block, read VERBATIM off the original document
 * lines (never the buffer — the buffer blanks erased `+` lines and
 * omits blanks the extent scan skipped). Anything but a blank or a `+`
 * in a gap is a reader bug, not an input shape: comments, metadata and
 * attribute entries are blocks (spec §1, checked over the corpus and
 * 40,000 random documents), and the AST invariant re-checks it on
 * every parse.
 * Exported for its table test (tests/parser/list-reader.test.ts): the
 * unreachable arm and the boundary arithmetic deserve direct rows, not
 * just corpus coverage.
 * @param documentLines - EVERY document line, unerased
 * @param textEnd - the text's last line number
 * @param blocks - the item's blocks, in source order
 * @returns one gap per block
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
 * What bounds one extent scan beyond the lines themselves: whether
 * the END of the stream is a safe place to print a `+` back.
 */
export interface ExtentBounds {
  /**
   * Whether a `+` printed at the very end of the STREAM re-reads
   * inert — true for the document reader (EOF), the confined
   * reader's own boundary fact otherwise (the Confinement record's
   * tailSafe: an item's own, or a block child's closed-or-enclosing
   * answer — spec D2/D3). Tail safety is a LIST-NESTING fact (what
   * follows an ITEM's popped trailing `+`), which is why this seam
   * survives at exactly one member.
   */
  readonly tailSafe: boolean;
}

/** What the scan hands the reader: Ruby's buffer, and the boundary. */
export interface ItemExtent {
  /**
   * The item's lines in document order, a COPY: every line Ruby blanks
   * (`buffer[-1] = ''` l.1429, `buffer[detached_continuation] = ''`
   * l.1562) has `text: ""` with `raw`, `offset` and `line` intact, so
   * positions and gap spellings survive the rewrite.
   */
  buffer: SourceLine[];
  /**
   * Exclusive index into `lines` after the item's last consumed line —
   * trailing blanks and a popped trailing `+` included, so the caller
   * resumes exactly where Ruby's reader would.
   */
  end: number;
  /**
   * The item's last non-blank line was an UNERASED `+` that attached
   * nothing (Ruby pops it, l.1571; we keep the byte — Ruling 23 — as
   * `ListItemNode.trailingContinuation`), AND printing it back is a
   * fixed point (see {@link ExtentScan.finish} for the rule). An
   * erased `+` (one a blank line followed, or a detached `+` at EOF)
   * is NOT trailing: Ruby turned it into a blank, and dropping it is
   * render-equal and idempotent.
   */
  trailingContinuation: boolean;
  /**
   * Whether a `+` printed at the very end of THIS ITEM re-reads
   * inert: the scan stopped at a sibling (which the printer puts on
   * the very next line, where the `+` pops again), or the stream
   * itself ended at a safe boundary — EOF, or a confined boundary
   * whose enclosing side is safe (a closed block's printed terminator
   * follows on the very next output line and pops it; spec D3's
   * four-class equivalence)
   * ({@link ExtentBounds.tailSafe}). False when arbitrary content
   * follows across blank lines — there the printer separates with a
   * blank, and a `+` above a blank ERASES and arms on re-read. This
   * is the fact the item's own confined reader inherits as its
   * bounds.
   */
  tailSafe: boolean;
}

/**
 * Whether a line is a sibling item of the list being read — style
 * equality on the RESOLVED trait, exactly `is_sibling_list_item?`
 * (parser.rb l.2265). The three marker variants' style sets are
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
  return (
    trait.kind === "marker" && parseListMarker(text)?.style === trait.style
  );
}

/**
 * Whether a line starts a NESTABLE list — `NESTABLE_LIST_CONTEXTS =
 * [:ulist, :olist, :dlist]` (asciidoctor.rb:316, the authority; the
 * three `find` sites are l.1492, l.1519 and l.1548): an unordered or
 * ordered marker, or a dlist term. A callout marker is deliberately
 * NOT nestable (asciidoctor.rb:316 lists no :colist), which is why a
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
 * Ruby's `prev_line == LIST_CONTINUATION` test (l.1425) over a buffer
 * that may still be empty: `prev_line` is nil for the first line of an
 * item, and nil matches neither the `+` arm nor the after-blank arm
 * (l.1502 tests `prev_line &&` for the same reason).
 * @param previous - the last buffered line's text, or undefined when
 *   nothing is buffered yet
 * @returns true when the previous line is a lone `+`
 */
function previousIsContinuation(previous: string | undefined): boolean {
  return previous !== undefined && isContinuationLine(previous);
}

/**
 * "Let block metadata play out until we find the block" — the three
 * shapes l.1488-90 keeps `:active` across: a block title, a block
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

// Ruby's three continuation states (l.1401): :frozen marks sequential
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
  private index: number;

  /**
   * @param lines - the lines the item is read from (the document's, or
   *   an enclosing item's buffer)
   * @param from - index of the first line AFTER the item's marker line
   *   (parse_list_item shifts the marker before reading, l.1348)
   * @param trait - the trait siblings are matched by
   * @param bounds - the enclosing confinement (stop lines) and the
   *   stream-end print-safety fact — see {@link ExtentBounds}
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
   * One turn of Ruby's while loop: the arms of l.1421–1556 in Ruby's
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
    // (l.1421) — or an enclosing delimited block's terminator, which
    // is where the lines Ruby's item reader was given run out. Asked
    // of every line first.
    if (this.endsTheItem(line.text)) {
      this.index -= 1;
      return "stop";
    }
    // prev_line is read from the MUTATED buffer (l.1423): an erased
    // `+` reads as a blank here, which is what makes the flat
    // `+`/blank/`+`/para shape take the detached arm.
    const previous = this.buffer.at(-1)?.text;
    if (previousIsContinuation(previous) && this.afterContinuation(line)) {
      return "go";
    }
    const delimiter = delimiterKind(line.text);
    if (delimiter !== undefined) return this.delimitedArm(delimiter);
    // Ruby's next arm is the dlist-only `BlockAttributeLineRx`
    // look-ahead (l.1452-71, `elsif dlist && continuation != :active
    // && ...`): it decides whether a `[...]` run in front of a
    // non-sibling list item joins the item or breaks it. Out of scope
    // with the rest of the dlist branches (#9); it would go exactly
    // here, between the delimited arm and the `:active` arm.
    if (this.continuation === "active" && line.text !== "") {
      this.activeContent(line);
      return "go";
    }
    if (previous === "") return this.afterBlank(line);
    this.plainLine(line); // the final else, l.1546-56
    return "go";
  }

  /**
   * `is_sibling_list_item?` (l.1421) — the one shape that ends the
   * item wherever it is read, before and after a blank run alike
   * (l.1508/1517-18 ask the same question a second time). The old
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
   * that)" — l.1445-46.
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
   * `prev_line == LIST_CONTINUATION` (l.1425-41): activate the pending
   * `+` — erasing it unless inside a nested list — and freeze on an
   * adjacent one. `LIST_CONTINUATION` itself (asciidoctor.rb:333) is
   * `isContinuationLine`'s pattern, shared with the classifier so the
   * scan and the reader can never disagree about what a `+` line is.
   * @param line - the line after the buffered `+`
   * @returns true when the line was fully handled (the adjacent case)
   */
  private afterContinuation(line: SourceLine): boolean {
    if (this.continuation === "inactive") {
      this.continuation = "active"; // l.1427
      // "if we are within a nested list, we don't throw away the list
      // continuation marks because they will be processed when
      // grabbing the lines for those nested lists" — l.1404-06, 1429.
      if (!this.withinNestedList) this.erase(this.buffer.length - 1);
    }
    if (!isContinuationLine(line.text)) return false;
    // Adjacent continuations, "really a syntax error" — l.1433-35.
    // DEVIATION from l.1434 (`if continuation != :frozen`, the gate
    // that drops them): Ruby buffers the SECOND `+` and drops
    // every later one; a formatter may not delete a line the author
    // wrote (Ruling 23), so every adjacent `+` is buffered and the
    // confined reader keeps each as a raw-line block — the pinned
    // oracle divergence (spec D5): bytes and rendering identical,
    // block structure not.
    this.continuation = "frozen"; // l.1435
    this.buffer.push(line);
    return true;
  }

  /**
   * `continuation == :active && !this_line.empty?` (l.1472-99): a
   * literal paragraph is slurped whole, metadata plays out, anything
   * else is the attached block and consumes the `+`.
   * @param line - the non-blank line under an active continuation
   */
  private activeContent(line: SourceLine): void {
    if (LITERAL_LINE.test(line.text)) {
      // "if we don't process it as a whole, then a line in it that
      // looks like a list item will throw off the exit from it" —
      // l.1477-84 (l.1484 is the non-dlist read; the dlist one at
      // l.1482 is out of scope).
      this.index -= 1;
      this.slurpLiteral();
      this.continuation = "inactive";
      return;
    }
    if (isBlockMetadataLine(line.text)) {
      this.buffer.push(line); // l.1488-90, continuation stays active
      return;
    }
    if (isNestable(line.text)) this.withinNestedList = true; // l.1492-93
    this.buffer.push(line);
    this.continuation = "inactive"; // l.1500
  }

  /**
   * `prev_line && prev_line.empty?` (l.1502-38): skip further blanks,
   * then only a detached `+`, a nestable marker or a literal paragraph
   * keeps the item. `has_text` is always true outside dlists (l.1514);
   * the greedy no-text arm (l.1540-45) is dlist-only and out of scope
   * (#9).
   * @param first - the line that arrived after the blank
   * @returns whether the item ends here
   */
  private afterBlank(first: SourceLine): "stop" | "go" {
    const line = first.text === "" ? this.skipBlanks() : first;
    if (line === undefined) return "stop"; // EOF, l.1506
    if (isContinuationLine(line.text)) {
      // A detached continuation "gets associated with the outermost
      // block" — l.1408-10, 1511-12. The index is a SCALAR: a later
      // detached `+` overwrites it, which is why only the last one is
      // erased after the loop. `push` returns the new length, so the
      // pushed line's index is one less — Ruby's
      // `detached_continuation = buffer.size` then `buffer << line`.
      this.detachedContinuation = this.buffer.push(line) - 1;
      return "go";
    }
    // l.1508 and l.1517-18 are one test here, not two: Ruby asks
    // whether the line it just read is a sibling once for the
    // re-read-past-blanks path and once for the fall-through path, and
    // both arms unread the line and break. A `+` is not a sibling
    // marker, so testing it first changes nothing.
    if (this.endsTheItem(line.text)) {
      this.index -= 1;
      return "stop";
    }
    if (isNestable(line.text)) {
      this.buffer.push(line); // l.1519-21
      this.withinNestedList = true;
      return "go";
    }
    if (LITERAL_LINE.test(line.text)) {
      // "slurp up any literal paragraph offset by blank lines" —
      // l.1528-34.
      this.index -= 1;
      this.slurpLiteral();
      return "go";
    }
    this.index -= 1; // break — l.1538; this_line unshifted at l.1560
    return "stop";
  }

  /**
   * "Advance to the next line of content" — `skip_blank_lines` then
   * `read_line` (l.1504-06). The blanks are consumed, not buffered.
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
    if (this.index >= this.lines.length) return undefined; // EOF, l.1506
    const line = this.lines[this.index];
    this.index += 1;
    return line;
  }

  /**
   * The final else (l.1546-56): buffer the line; a nestable marker
   * flips `within_nested_list`. Deliberately does NOT touch
   * `continuation` — that omission IS the one-blank budget: a blank
   * after a `+` lands here with the continuation still active, so the
   * next content line still attaches.
   * @param line - the line to buffer
   */
  private plainLine(line: SourceLine): void {
    if (isNestable(line.text)) this.withinNestedList = true; // l.1548-49
    this.buffer.push(line);
  }

  /**
   * `read_lines_until terminator: match.terminator, read_last_line:
   * true` (l.1450): the whole block, delimiters included, goes into
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
    this.continuation = "inactive"; // l.1451
  }

  /**
   * `read_lines_until preserve_last_line: true, break_on_blank_lines:
   * true, break_on_list_continuation: true` (l.1484/1535, the two
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
   * The post-loop cleanup (l.1560-77): erase the detached `+`, strip
   * trailing blanks, pop ONE trailing `+`.
   *
   * The pop is reported so the printer can keep the byte (Ruling 23)
   * — but ONLY where reprinting it is a FIXED POINT, because Ruby pops
   * it either way (it attached nothing) and a reprinted `+` that
   * re-reads differently arms or shrinks (review B1/B2). Two prints
   * are fixed points:
   *
   * - the item's tail is a safe boundary ({@link boundarySafe}): the
   *   printed `+` is followed by EOF, a sibling marker or an enclosing
   *   terminator on the very next line, all of which pop it again;
   * - the `+` directly above it also prints ({@link frozenRunKept}):
   *   the pair re-reads as erase-head + pop-tail (or freeze), never as
   *   a lone `+` that a following blank would ACTIVATE. This is what
   *   keeps `* a\n+\n+\n+\n\npara\n` byte-stable while
   *   `* a\n+\n+\n\npara\n` (whose erased first `+` is invisible — it
   *   sits in no gap) must collapse to `* a\n\npara\n` in ONE pass.
   *
   * Everywhere else the byte must go — render-neutral, since it
   * rendered nothing.
   * @returns the finished extent
   */
  private finish(): ItemExtent {
    if (this.detachedContinuation !== undefined) {
      // Unconditional — no within_nested_list guard here (l.1562),
      // which is what hands a nested-list detached `+`'s block to the
      // OUTER item: the inner scan re-reads a blank where the `+` was.
      this.erase(this.detachedContinuation);
    }
    const tailSafe = this.boundarySafe();
    let trailing = false;
    while (this.buffer.length > 0) {
      const last = this.buffer.at(-1);
      if (last?.text === "") {
        this.buffer.pop(); // strip trailing blank lines, l.1567-69
        continue;
      }
      if (last !== undefined && isContinuationLine(last.text)) {
        this.buffer.pop(); // l.1571
        trailing = tailSafe || this.frozenRunKept();
      }
      break;
    }
    return {
      buffer: this.buffer,
      end: this.index,
      trailingContinuation: trailing,
      tailSafe,
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
   * is the bounds' — EOF for the document reader, the enclosing
   * item's own tail-safety for an item-confined one, and
   * `closed || enclosing` for a compound interior (spec D2/D3).
   * @returns true when the tail is a safe print boundary
   */
  private boundarySafe(): boolean {
    const stop = this.lines.at(this.index);
    return stop === undefined
      ? this.bounds.tailSafe
      : this.endsTheItem(stop.text);
  }

  /**
   * Whether the popped `+` prints directly under ANOTHER printed `+`
   * — the buffer's new last line is a frozen `+` the confined reader
   * keeps as a raw-line block (D5). The pair re-reads as
   * erase + freeze/pop, reproducing itself, so reporting the pop is a
   * fixed point even at an unsafe tail. NOT trusted inside a nested
   * list: there the buffer's tail is re-read by the INNER item's own
   * scan, which may pop it in turn (dropping it from the output), and
   * the reported `+` would print alone and arm.
   * @returns true when the `+` above the popped one is this item's own
   *   frozen raw line
   */
  private frozenRunKept(): boolean {
    if (this.withinNestedList) return false;
    const last = this.buffer.at(-1);
    return last !== undefined && isContinuationLine(last.text);
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
 * @returns the buffer, the end index, the trailing-`+` flag and the
 *   item's own tail-safety
 */
export function itemExtent(
  lines: readonly SourceLine[],
  from: number,
  trait: SiblingTrait,
  bounds: ExtentBounds,
): ItemExtent {
  return new ExtentScan(lines, from, trait, bounds).run();
}
