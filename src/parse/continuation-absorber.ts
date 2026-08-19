/**
 * Post-parse pass attaching sibling blocks to list items via
 * `+` continuation markers (issue #6).
 *
 * The grammar cannot consume a delimited block inside a list
 * item: the item is a run of LINES, and a block delimiter line
 * terminates the whole list. So for input like
 *
 * ```
 * . item:
 * +
 * ----
 * code
 * ----
 * +
 * attached paragraph.
 * ```
 *
 * the CST yields a list whose last item ends with a dangling
 * `+`, the block as a top-level SIBLING, and a paragraph whose
 * text starts with `"+\n"` (the second marker swallowed as
 * content). This pass repairs the AST after the fact: the block
 * moves into the item's `attachedBlocks`, and the paragraph is
 * split at its marker lines with each piece attached too.
 *
 * Attachment is strictly ADJACENT: each absorbed sibling must
 * start on the line directly after the `+` that announces it.
 * A blank line breaks the chain — Asciidoctor still attaches
 * across blank lines, but the plugin's existing contract is to
 * preserve a dangling `+` verbatim in that case (rendering is
 * identical either way, and rewriting the user's blank-line
 * structure is not this pass's business).
 *
 * The paragraph-splitting rules mirror the token-level splitter
 * in continuation-builder.ts (splitAtContinuationMarkers) so
 * the two code paths agree on Asciidoctor's quirks: a `+` line
 * directly after a marker is CONTENT, not a second marker, and
 * trailing marker-only lines collapse into one dangling `+`.
 */
import type {
  BlockNode,
  InlineNode,
  ListItemNode,
  ListNode,
  Location,
  ParagraphNode,
  TextNode,
} from "../ast.js";
import {
  EMPTY,
  FIRST,
  FIRST_COLUMN,
  LAST_ELEMENT,
  NEWLINE_LENGTH,
  NEXT,
  SINGLE,
} from "../constants.js";
import {
  collapseTrailingMarkerOnly,
  isMarkerLineText,
} from "./continuation-markers.js";

/**
 * Check whether a sibling block can be attached to a list item
 * under a single `+` marker.
 *
 * Deliberately narrow: block metadata (attribute lists,
 * anchors, titles) must NOT attach, because metadata stacks
 * with the block that follows it while the printer emits one
 * `+` per attached block — attaching would tear the metadata
 * from its block on re-parse. Extending this (and the
 * printer's continuation loop) to metadata+block groups is
 * tracked in issue #17.
 * @param block - The sibling block after a dangling `+`.
 * @returns True when the block may be absorbed.
 */
function isAttachableBlock(block: BlockNode): boolean {
  return block.type === "delimitedBlock" || block.type === "parentBlock";
}

/**
 * Find the list item that a following sibling block would
 * attach to: the deepest last item of the list. Nested lists
 * live inside their parent item's children, so the item
 * adjacent to a sibling block is found by descending through
 * trailing nested lists.
 * @param list - The list whose trailing item chain to walk.
 * @returns The deepest last item, or undefined for a list
 *   with no items (never produced by the parser, but the
 *   type allows it).
 */
function deepestLastItem(list: ListNode): ListItemNode | undefined {
  const item = list.children.at(LAST_ELEMENT);
  if (item === undefined) {
    return undefined;
  }
  const lastChild = item.children.at(LAST_ELEMENT);
  if (lastChild?.type === "list") {
    return deepestLastItem(lastChild);
  }
  return item;
}

/**
 * Extend the end position of a list — and of the trailing
 * item chain down to the item that received attached blocks —
 * to cover absorbed content, keeping Prettier's locEnd (range
 * formatting, cursor tracking) truthful.
 * @param list - The list whose span grew.
 * @param end - The new exclusive end location.
 */
function extendListEnd(list: ListNode, end: Location): void {
  const { position } = list;
  position.end = end;
  const item = list.children.at(LAST_ELEMENT);
  if (item === undefined) {
    return;
  }
  item.position.end = end;
  const lastChild = item.children.at(LAST_ELEMENT);
  if (lastChild?.type === "list") {
    extendListEnd(lastChild, end);
  }
}

/**
 * Advance a location by `index` characters of `text`,
 * tracking line and column across newlines. Used to compute
 * positions for paragraph pieces split out of a larger
 * paragraph — a text node's value maps 1:1 onto the source
 * span its position covers.
 * @param start - Location of `text`'s first character.
 * @param text - The text the location walks through.
 * @param index - Number of characters to advance by.
 * @returns The location `index` characters after `start`.
 */
function advanceLocation(
  start: Location,
  text: string,
  index: number,
): Location {
  let { line, column } = start;
  for (let scan = FIRST; scan < index; scan += NEXT) {
    if (text[scan] === "\n") {
      line += NEXT;
      column = FIRST_COLUMN;
    } else {
      column += NEXT;
    }
  }
  return { offset: start.offset + index, line, column };
}

/** The outcome of splitting a sibling paragraph at `+` lines. */
interface ParagraphSplit {
  /** Attached paragraphs, one per non-empty segment. */
  paragraphs: ParagraphNode[];
  /**
   * True when the paragraph ended with a marker that has
   * nothing after it inside the paragraph — the NEXT sibling
   * block is the attachment target (or, failing adjacency,
   * the item keeps a dangling `+`).
   */
  trailingMarker: boolean;
}

/**
 * Split a sibling paragraph that BEGINS with a `+` marker line
 * into the blocks the markers attach.
 *
 * Marker lines only ever live inside text nodes: newlines
 * appear only in text-node values, and adjacent text tokens
 * are merged by the parser, so a lone `+` line always sits in
 * one text node together with the newlines that bound it.
 * Non-text inline nodes are passed through into the current
 * segment untouched.
 * @param paragraph - The sibling paragraph directly after an
 *   attached block.
 * @returns The split, or undefined when the paragraph does
 *   not begin with a marker line (no continuation intent —
 *   the paragraph stays a sibling and the chain ends).
 */
function splitMarkerParagraph(
  paragraph: ParagraphNode,
): ParagraphSplit | undefined {
  const firstChild = paragraph.children.at(FIRST);
  if (firstChild?.type !== "text") {
    return undefined;
  }
  const [firstLine] = firstChild.value.split("\n");
  if (!isMarkerLineText(firstLine)) {
    return undefined;
  }

  // Segments of inline nodes between marker lines. The first
  // segment stays empty (the paragraph starts with a marker)
  // and is dropped below.
  const segments: InlineNode[][] = [[]];
  // A `+` line DIRECTLY after a marker is content of the
  // attached paragraph, not a second marker (`+\n+\nAttached`
  // attaches one paragraph whose text starts with `+`). Set
  // when a marker is consumed; cleared by the first content
  // line after it.
  let afterMarker = false;

  for (const [childIndex, child] of paragraph.children.entries()) {
    if (child.type !== "text") {
      segments[segments.length + LAST_ELEMENT].push(child);
      afterMarker = false;
      continue;
    }
    const { nodes: pieces, endsAfterMarker } = splitTextAtMarkers(
      child,
      childIndex === FIRST,
      childIndex === paragraph.children.length + LAST_ELEMENT,
      afterMarker,
    );
    for (const piece of pieces) {
      if (piece === "marker") {
        segments.push([]);
      } else {
        segments[segments.length + LAST_ELEMENT].push(piece);
      }
    }
    afterMarker = endsAfterMarker;
  }

  // Trailing marker-only segments (`+` after `+` at the end)
  // attach nothing and render nothing; collapse them into one
  // trailing marker via the rule shared with the token-level
  // splitter.
  const trailingMarker = collapseTrailingMarkerOnly(
    segments,
    isMarkerOnlySegment,
  );

  const [, ...attachedSegments] = segments;
  return {
    paragraphs: attachedSegments
      .filter((segment) => segment.length > EMPTY)
      .map((segment) => buildParagraph(segment)),
    trailingMarker,
  };
}

/**
 * Check whether a segment is empty or holds only a lone `+`
 * text (the exempt content line after a marker, with nothing
 * following it) — segments that must collapse into the
 * dangling-marker flag rather than attach.
 * @param segment - The trailing segment to test.
 * @returns True when the segment carries nothing to attach.
 */
function isMarkerOnlySegment(segment: InlineNode[] | undefined): boolean {
  if (segment === undefined) {
    return false;
  }
  if (segment.length === EMPTY) {
    return true;
  }
  const [only] = segment;
  return (
    segment.length === SINGLE &&
    only.type === "text" &&
    isMarkerLineText(only.value)
  );
}

/** Pieces of a text node split at marker lines. */
interface TextSplit {
  /** Text pieces interleaved with `"marker"` sentinels. */
  nodes: Array<TextNode | "marker">;
  /** True when the node's last line was a consumed marker. */
  endsAfterMarker: boolean;
}

/**
 * Split one text node's value at `+` marker lines.
 *
 * A line is a marker only when it occupies a COMPLETE source
 * line: positions after a `\n` inside the value are always
 * line starts, but the value's first line starts mid-line
 * unless this node is the paragraph's first child (a non-text
 * sibling precedes it on the same line otherwise), and
 * symmetrically for the last line.
 * @param node - The text node to split.
 * @param isFirstChild - Whether the node opens the paragraph
 *   (its first line starts at a line start).
 * @param isLastChild - Whether the node closes the paragraph
 *   (its last line ends at a line end).
 * @param afterMarker - Whether the previous line (in an
 *   earlier node) was a consumed marker, exempting this
 *   node's first line from marker detection.
 * @returns Text pieces and marker sentinels in source order.
 */
function splitTextAtMarkers(
  node: TextNode,
  isFirstChild: boolean,
  isLastChild: boolean,
  afterMarker: boolean,
): TextSplit {
  const lines = node.value.split("\n");
  const nodes: Array<TextNode | "marker"> = [];
  // Lines accumulated for the current text piece, plus the
  // value-index where the piece begins (for position math).
  let buffer: string[] = [];
  let bufferStart = FIRST;
  let exemptNextLine = afterMarker;
  let index = FIRST;

  const flush = (endIndex: number): void => {
    const value = buffer.join("\n");
    // An empty buffer (or a lone "" from a value that starts
    // with `\n` right before a marker) carries no content —
    // the newline before a marker is structural and dropped.
    if (value.length > EMPTY && value !== "\n") {
      nodes.push({
        type: "text",
        value,
        position: {
          start: advanceLocation(node.position.start, node.value, bufferStart),
          end: advanceLocation(node.position.start, node.value, endIndex),
        },
      });
    }
    buffer = [];
  };

  for (const [lineNumber, line] of lines.entries()) {
    const isLineStart = lineNumber > FIRST || isFirstChild;
    const isLineEnd = lineNumber < lines.length + LAST_ELEMENT || isLastChild;
    const isMarker =
      isLineStart && isLineEnd && !exemptNextLine && isMarkerLineText(line);
    if (isMarker) {
      // The buffered piece ends before the newline that
      // precedes the marker line (that newline is structural).
      flush(index - NEWLINE_LENGTH);
      nodes.push("marker");
      exemptNextLine = true;
    } else {
      if (buffer.length === EMPTY) {
        bufferStart = index;
      }
      buffer.push(line);
      // Only a line with real content clears the exemption —
      // the empty pseudo-line from a value starting with `\n`
      // represents no content on this node's part of the line.
      if (line.length > EMPTY) {
        exemptNextLine = false;
      }
    }
    index += line.length + NEXT;
  }
  flush(node.value.length);

  return {
    nodes,
    endsAfterMarker: nodes.at(LAST_ELEMENT) === "marker",
  };
}

/**
 * Wrap a split segment's inline nodes in a ParagraphNode,
 * deriving the position from the first and last children.
 * @param children - The segment's inline nodes (non-empty).
 * @returns The attached paragraph.
 */
function buildParagraph(children: InlineNode[]): ParagraphNode {
  const [firstChild] = children;
  const lastChild = children.at(LAST_ELEMENT) ?? firstChild;
  return {
    type: "paragraph",
    children,
    position: {
      start: firstChild.position.start,
      end: lastChild.position.end,
    },
  };
}

/**
 * Absorb the sibling blocks following `list` into its dangling
 * deepest last item, consuming from `blocks` at `index`.
 * @param blocks - The flat sibling array being scanned.
 * @param index - Index of the first sibling after the list.
 * @param list - The list the siblings may attach into.
 * @returns The index of the first sibling NOT absorbed
 *   (`index` unchanged when the list has no dangling `+`).
 */
function absorbChain(
  blocks: BlockNode[],
  index: number,
  list: ListNode,
): number {
  const item = deepestLastItem(list);
  if (item?.danglingContinuation !== true) {
    return index;
  }

  // True while the last thing seen is a bare `+` whose
  // attachment target is the next sibling block; false right
  // after a block attaches (then only a `+`-led paragraph can
  // continue the chain).
  let expectingBlock = true;
  // The node holding the last absorbed line (initially the
  // item, whose final line is the dangling `+`); the next
  // sibling must start on the line directly after it.
  let previous: ListItemNode | BlockNode = item;

  let scan = index;
  while (scan < blocks.length) {
    const { [scan]: sibling } = blocks;
    if (sibling.position.start.line !== previous.position.end.line + NEXT) {
      break;
    }
    if (expectingBlock && isAttachableBlock(sibling)) {
      item.attachedBlocks.push(sibling);
      item.danglingContinuation = false;
      expectingBlock = false;
      previous = sibling;
      extendListEnd(list, sibling.position.end);
      scan += NEXT;
      continue;
    }
    if (!expectingBlock && sibling.type === "paragraph") {
      const split = splitMarkerParagraph(sibling);
      if (split === undefined) {
        break;
      }
      const { paragraphs, trailingMarker } = split;
      item.attachedBlocks.push(...paragraphs);
      // A trailing marker re-arms block attachment; if no
      // adjacent block follows, the flag makes the printer
      // re-emit the bare `+` verbatim.
      item.danglingContinuation = trailingMarker;
      expectingBlock = trailingMarker;
      previous = sibling;
      extendListEnd(list, sibling.position.end);
      scan += NEXT;
      continue;
    }
    break;
  }
  return scan;
}

/**
 * Attach sibling blocks to list items across `+` continuation
 * boundaries the grammar cannot see (issue #6).
 *
 * Runs on a flat sibling array — at the document level before
 * section nesting, and on parent-block children — so a list
 * followed by the block its dangling `+` announces has that
 * block (and any `+`-chained followers) moved into the item's
 * `attachedBlocks`.
 * @param blocks - Flat array of sibling block nodes.
 * @returns A new array with absorbed siblings removed; the
 *   input array is not mutated (list items are).
 */
export function absorbListContinuations(blocks: BlockNode[]): BlockNode[] {
  const result: BlockNode[] = [];
  let index = FIRST;
  while (index < blocks.length) {
    const { [index]: current } = blocks;
    result.push(current);
    index += NEXT;
    if (current.type !== "list") {
      continue;
    }
    index = absorbChain(blocks, index, current);
  }
  return result;
}
