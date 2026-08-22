/**
 * The types reader.ts, list-reader.ts and list-frames.ts all need, with
 * NOTHING imported back from any of them — the module that lets those
 * three form a DAG instead of a cycle. A cyclic module group has no
 * reading order, so the import graph must stay acyclic; the `import
 * graph` describe block in `tests/parser/architecture.test.ts` gates
 * that at zero cycles (Ruling 31).
 *
 * A frame IS the node under construction: every container frame owns
 * the `children` its blocks are pushed into, and closing the frame
 * builds its node and gives it to the parent. `Frame`'s list branch
 * needs `Item` — list-reader.ts's per-item state machine — but `Item`
 * touches nothing reader-related itself, so it lives in its own leaf
 * module, list-item.ts, and this file imports it as a type. That is
 * what keeps `Frame` here concrete rather than generic: list-frames.ts's
 * `ListFrame` is `Frame`'s "list" branch under its own name (see that
 * file), not a second, hand-restated copy of the same fields.
 */
import type { BlockNode, ListItemNode, ParentBlockNode } from "../../ast.js";
import { FIRST } from "../../constants.js";
import {
  buildAttributeEntry,
  buildBlockAnchor,
  buildBlockAttributeList,
  buildBlockMacro,
  buildBlockTitle,
  buildPageBreak,
  buildRawBlockLine,
  buildThematicBreak,
} from "../build/metadata.js";
import type { ParagraphContext } from "../line-shapes.js";
import type { Fragment, LocationIndex } from "../positions.js";
import type { DelimiterKind, LineKind, ListVariant } from "./classify.js";
import type { Item, PendingMark } from "./list-item.js";
import type { ParagraphHost } from "./paragraph-reader.js";
import type { SourceLine } from "./split.js";

/** One open block-context frame, outermost first on the reader's stack. */
export type Frame =
  | {
      /** Frame discriminant: the document, which never closes. */
      readonly kind: "document";
      /** The blocks read so far, in source order. */
      readonly children: BlockNode[];
    }
  | {
      /** Frame discriminant: a section opened by an ATX title. */
      readonly kind: "section";
      /** The title's level; a title of level <= this one closes it. */
      readonly level: number;
      /** The title line, which the section node is built from. */
      readonly title: SourceLine;
      /** The blocks read so far, in source order. */
      readonly children: BlockNode[];
    }
  | {
      /** Frame discriminant: a delimited block parsed as blocks. */
      readonly kind: "compound";
      /** The rstripped line that closes it. */
      readonly terminator: string;
      /** The opening delimiter line. */
      readonly open: SourceLine;
      /** Which parent block the opener opened, decided at open. */
      readonly variant: ParentBlockNode["variant"];
      /** The blocks read so far, in source order. */
      readonly children: BlockNode[];
    }
  | {
      /** Frame discriminant: a delimited block kept verbatim. */
      readonly kind: "verbatim";
      /** The rstripped line that closes it. */
      readonly terminator: string;
      /** The opening delimiter line; the content is sliced at close. */
      readonly open: SourceLine;
    }
  | {
      /** Frame discriminant: an open list. */
      readonly kind: "list";
      /** Which list kind the marker opened. */
      readonly variant: ListVariant;
      /** The marker style `is_sibling_list_item?` compares. */
      readonly style: string;
      /** State of the item currently being read; replaced per item. */
      item: Item;
      /** The items finished so far, in source order. */
      readonly items: ListItemNode[];
    };

/**
 * The reader surface the list layer (list-reader.ts, list-frames.ts)
 * consumes — narrower than the full `BlockReader` class in reader.ts,
 * which also owns section titles, delimited blocks and the main loop.
 * Named by analogy with `ParagraphHost` (paragraph-reader.ts), which it
 * extends because the list layer also reads an item's principal text
 * through that seam, passing this same reader on. Both are structural
 * views a class implements rather than base classes it extends.
 */
export interface ListHost extends ParagraphHost {
  /** The open frames, outermost first; the reader's only context store. */
  readonly stack: Frame[];
  /** Blank lines seen since the last line the reader consumed. */
  readonly blanks: number;
  /** How many lines are held back right now. */
  readonly heldLines: number;
  /** The document's offset→Location index, for the builders. */
  readonly at: LocationIndex;
  /** The innermost open frame. */
  readonly topFrame: () => Frame;
  /** Put a finished block where the innermost frame wants it. */
  readonly push: (node: BlockNode) => void;
  /** Push a one-line block, releasing any metadata it annotates first. */
  readonly leaf: (node: BlockNode) => void;
  /** Read a paragraph from `line`, text starting at `from`, and push it. */
  readonly paragraph: (
    context: ParagraphContext,
    line: SourceLine,
    from: number,
  ) => void;
  /** Read a paragraph-form admonition whose label ends at `labelEnd`. */
  readonly admonition: (
    context: ParagraphContext,
    line: SourceLine,
    labelEnd: number,
  ) => void;
  /** Read an indented literal paragraph from `line` and push it. */
  readonly literalParagraph: (line: SourceLine) => void;
  /**
   * Hold a metadata line back until it's known what block it
   * annotates, with the mark it is introduced under inside a list item
   * — undefined for the first line of a run, whose mark the run's
   * {@link HeldLead} decides at release.
   */
  readonly holdMetadata: (
    line: SourceLine,
    kind: LineKind,
    mark?: PendingMark,
  ) => boolean;
  /** Decide how the held-back run will be introduced when released. */
  readonly holdLead: (lead: HeldLead) => void;
  /**
   * Release every held-back node behind the run's decided lead —
   * overrides `ParagraphHost.flushMetadata` to add the list layer's
   * "a block of the item follows" flag, which only it needs to pass.
   */
  readonly flushMetadata: (blockFollows?: boolean) => void;
  /** Open a delimited block. */
  readonly openDelimited: (line: SourceLine, block: DelimiterKind) => void;
  /** Pop frames until the stack is `depth` deep, closing each one. */
  readonly closeDownTo: (depth: number, line?: SourceLine) => void;
  /** The lines strictly between two line numbers. */
  readonly linesBetween: (from: number, to: number) => readonly SourceLine[];
  /** The 1-based line number of the last line the reader consumed. */
  readonly lastConsumedLine: () => number | undefined;
}

/**
 * How a list item's held-back metadata run is introduced when it is
 * released. The list reader decides both outcomes at hold time (Ruling
 * 27: the explicit-`+` decision is the reader's); which one applies
 * depends only on whether a block of the item follows the run.
 */
export interface HeldLead {
  /** The mark when a block of the item follows the run. */
  readonly block: PendingMark;
  /** The mark when the run turns out to be trailing. */
  readonly trailing: PendingMark;
}

/**
 * One line's span, for the builders. A block node is built from the
 * RAW spelling of its line — trailing whitespace and all — and that is
 * what its position measures; classification used the rstripped
 * `text`.
 * @param line - the source line
 * @param from - raw start column index, 0-based
 * @param to - raw end column index, exclusive
 * @returns the span
 */
export function fragmentOfLine(
  line: SourceLine,
  from = FIRST,
  to = line.raw.length,
): Fragment {
  return { image: line.raw.slice(from, to), offset: line.offset + from };
}

/**
 * A line kind that IS a block, whole and entire: no extent to read and
 * no frame to open. The union {@link leafBuilder} is total over.
 */
export type LeafKind =
  | "attributeEntry"
  | "blockMacro"
  | "thematicBreak"
  | "pageBreak";

// The builder each leaf kind goes to. ONE table for both readers: the
// document reader (reader.ts) dispatches every kind through it, and
// the confined list reader (list-reader.ts) reaches three of the four
// the same way — it handles `attributeEntry` on its own path, because
// an attribute entry inside an item claims no continuation.
const LEAF_BUILDERS: Record<
  LeafKind,
  (line: Fragment, at: LocationIndex) => BlockNode
> = {
  attributeEntry: buildAttributeEntry,
  blockMacro: buildBlockMacro,
  thematicBreak: buildThematicBreak,
  pageBreak: buildPageBreak,
};

/**
 * Whether a classified line is a block, whole and entire — a narrowing
 * so {@link leafBuilder} needs no absent case.
 * @param kind - what the classifier made of a line
 * @returns true when {@link leafBuilder} has a builder for it
 */
export function isLeafKind(kind: LineKind["kind"]): kind is LeafKind {
  return Object.hasOwn(LEAF_BUILDERS, kind);
}

/**
 * The builder one leaf kind's node comes from.
 * @param kind - a leaf line kind, narrowed by {@link isLeafKind} or by
 *   the caller's own `case` labels
 * @returns the builder for it
 */
export function leafBuilder(
  kind: LeafKind,
): (line: Fragment, at: LocationIndex) => BlockNode {
  return LEAF_BUILDERS[kind];
}

// Line kinds `parse_block_metadata_line` claims, and the node each
// becomes: an anchor, an attribute list, a block title, and the
// comment/preprocessor lines the same scan consumes. An attribute
// ENTRY is deliberately absent: Ruby processes it as a document
// attribute where it stands, so it stays a leaf in the section it was
// written in. This table is the one source of truth for both
// functions below.
const HELD_BUILDERS = new Map<
  LineKind["kind"],
  (line: Fragment, at: LocationIndex) => BlockNode
>([
  ["anchor", buildBlockAnchor],
  ["attributeLine", buildBlockAttributeList],
  ["blockTitle", buildBlockTitle],
  ["raw", buildRawBlockLine],
]);

/**
 * The node a held-back metadata line becomes once it is known what it
 * annotates — what `BlockReader.holdMetadata` in reader.ts holds and
 * releases.
 * @param kind - what the classifier made of the line
 * @param line - the line itself
 * @param at - the document's location index
 * @returns the node, or undefined when the line is not held-back
 *   metadata
 */
export function heldMetadataNode(
  kind: LineKind,
  line: SourceLine,
  at: LocationIndex,
): BlockNode | undefined {
  return HELD_BUILDERS.get(kind.kind)?.(fragmentOfLine(line), at);
}

/**
 * Whether a line kind is one `parse_block_metadata_line` holds back for
 * the block that follows (see `BlockReader.holdMetadata` in reader.ts).
 * Reads the same table as {@link heldMetadataNode}, so there is exactly
 * one source of truth for which line kinds are held-back metadata.
 * @param kind - what the classifier made of a line
 * @returns true for an anchor, an attribute line, a block title or a
 *   raw line
 */
export function isHeldMetadata(kind: LineKind): boolean {
  return HELD_BUILDERS.has(kind.kind);
}
