/**
 * The types reader.ts and list-reader.ts both need, with NOTHING
 * imported back from either of them — the module that lets the two
 * form a DAG instead of a cycle. A cyclic module group has no
 * reading order, so the import graph must stay acyclic; the `import
 * graph` describe block in `tests/parser/architecture.test.ts` gates
 * that at zero cycles (Ruling 31).
 *
 * A frame IS the node under construction: every container frame owns
 * the `children` its blocks are pushed into, and closing the frame
 * builds its node and gives it to the parent. Lists have no frame:
 * they are read recursively (list-reader.ts's `readList`), through the
 * {@link ListHost} seam below.
 */
import type { BlockNode, ParentBlockNode } from "../../ast.js";
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
import type { InlineToken } from "../inline/tokens.js";
import type { Fragment, LocationIndex } from "../positions.js";
import type { LineKind } from "./classify.js";
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
    };

/**
 * The seam the list reader (list-reader.ts) consumes — everything
 * extent-first reading needs from a BlockReader, and nothing else.
 * A confined reader implements it too, which is what lets readList
 * recurse: an inner list is read from an outer item's buffer with the
 * SAME functions.
 */
export interface ListHost {
  /** The lines this host reads — the document's, or an item's buffer. */
  readonly lines: readonly SourceLine[];
  /**
   * EVERY line of the document, unerased — gap spellings are read from
   * here by 1-based line number, because a buffer omits lines the
   * extent scan consumed (skipped blanks) and blanks the ones Ruby
   * erased.
   */
  readonly documentLines: readonly SourceLine[];
  /** The document's offset→Location index, for the builders. */
  readonly at: LocationIndex;
  /** The whole document — verbatim content is sliced from it. */
  readonly source: string;
  /**
   * Terminators of every open delimited block on THIS host's stack —
   * the confinement Ruby gets for free (a list inside an example block
   * is parsed from a reader that physically ends at the block's
   * terminator; ours sees the whole line array, so itemExtent takes
   * these as unconditional stop lines).
   */
  readonly openTerminators: readonly string[];
  /**
   * Whether a `+` printed at the very end of this host's lines
   * re-reads inert — true for the document reader (EOF), the
   * enclosing item's own tail-safety for a confined one. The extent
   * scan inherits it as its stream-end boundary fact (see
   * `ExtentBounds.tailSafe` in list-reader.ts).
   */
  readonly tailSafe: boolean;
  /** Put a finished block where the innermost frame wants it. */
  readonly push: (node: BlockNode) => void;
  /** Release the metadata nodes held back for the block that follows. */
  readonly flushMetadata: () => void;
  /**
   * Read one item's interior: the principal text (the `listItem`-set
   * paragraph from the marker line, text starting at the marker's
   * `markerEnd`) and then every block, via a fresh confined
   * BlockReader over `[markerLine, ...buffer]` whose root collects the
   * item's blocks and whose context stack is its own.
   *
   * DEVIATION from the spec's §3 seam sketch, called out on purpose:
   * the sketch lists `readItemText` and `confine` as two members;
   * here the text is read INSIDE confine, because the text's
   * continuation lines must be consumed from the confined reader's
   * own stream (`readParagraph` advances its host), and one entry
   * point means one stream authority — no index handshake between
   * two readers.
   */
  readonly confine: (
    markerLine: SourceLine,
    marker: {
      /** The marker style, for the confined reader's ancestry. */
      readonly style: string;
      /** Raw column where the item's text starts. */
      readonly markerEnd: number;
    },
    buffer: readonly SourceLine[],
    tailSafe: boolean,
  ) => {
    /** The principal text's tokens. */
    text: InlineToken[];
    /** The item's blocks, in source order. */
    blocks: BlockNode[];
  };
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
  from = 0,
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
