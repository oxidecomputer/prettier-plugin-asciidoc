/**
 * The types reader.ts, list-reader.ts and list-frames.ts all need, with
 * NOTHING imported back from any of them — the module that lets those
 * three form a DAG instead of a cycle. A cyclic module group has no
 * reading order, so the import graph must stay acyclic; the `import
 * graph` describe block in `tests/parser/architecture.test.ts` gates
 * that at zero cycles (Ruling 31).
 *
 * `Frame`'s list branch needs `Item` — list-reader.ts's per-item state
 * machine — but `Item` touches nothing reader-related itself (just
 * constants.js and split.ts), so it lives in its own leaf module,
 * list-item.ts, and this file imports it as a type. That is what keeps
 * `Frame` here concrete rather than generic: list-frames.ts's
 * `ListFrame` is `Frame`'s "list" branch under its own name (see that
 * file), not a second, hand-restated copy of the same fields.
 */
import type { TokenType } from "chevrotain";
import type { DelimiterKind, LineKind, ListVariant } from "./classify.js";
import type { Item } from "./list-item.js";
import type { ParagraphHost } from "./paragraph-reader.js";
import type { SourceLine } from "./split.js";
import * as T from "./tokens.js";

/** One open block-context frame, outermost first on the reader's stack. */
export type Frame =
  | {
      /** Frame discriminant: the document, which never closes. */
      readonly kind: "document";
    }
  | {
      /** Frame discriminant: a section opened by an ATX title. */
      readonly kind: "section";
      /** The title's level; a title of level <= this one closes it. */
      readonly level: number;
    }
  | {
      /** Frame discriminant: a delimited block parsed as blocks. */
      readonly kind: "compound";
      /** The rstripped line that closes it. */
      readonly terminator: string;
    }
  | {
      /** Frame discriminant: a delimited block kept verbatim. */
      readonly kind: "verbatim";
      /** The rstripped line that closes it. */
      readonly terminator: string;
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
  /** The innermost open frame. */
  readonly topFrame: () => Frame;
  /** Emit a one-line block, releasing any metadata it annotates first. */
  readonly leaf: (type: TokenType, line: SourceLine) => void;
  /** Emit a zero-length boundary token at end of input. */
  readonly emitBoundaryAtEof: (type: TokenType) => void;
  /** Hold back a boundary token ahead of the metadata line being held. */
  readonly holdBoundary: (type: TokenType, line: SourceLine) => void;
  /** Hold a metadata line back until it's known what block it annotates. */
  readonly holdMetadata: (line: SourceLine, kind: LineKind) => boolean;
  /** Decide how the held-back run will be introduced when released. */
  readonly holdLead: (lead: HeldLead) => void;
  /**
   * Release every held-back line behind the run's decided lead —
   * overrides `ParagraphHost.flushMetadata` to add the list layer's
   * "a block of the item follows" flag, which only it needs to pass.
   */
  readonly flushMetadata: (blockFollows?: boolean) => void;
  /** Open a delimited block. */
  readonly openDelimited: (line: SourceLine, block: DelimiterKind) => void;
  /** Pop frames until the stack is `depth` deep, ending each one. */
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
  /** The mark when a block of the item follows; undefined spells `+`. */
  readonly block: TokenType | undefined;
  /** The mark when the run is trailing; undefined spells `+`. */
  readonly trailing: TokenType | undefined;
  /** How many times to emit it (stacked detached continuations). */
  readonly repeats: number;
}

// Line kinds `parse_block_metadata_line` claims, and the token each
// becomes. An attribute ENTRY is deliberately absent: Ruby processes it
// as a document attribute where it stands, and today's isHeldMetadata
// excludes it too, so it stays a leaf in the section it was written in.
const HELD_TOKENS = new Map<LineKind["kind"], TokenType>([
  ["anchor", T.AnchorLine],
  ["attributeLine", T.BlockAttributeLine],
  ["blockTitle", T.BlockTitleLine],
  ["raw", T.RawLine],
]);

/**
 * The token a held-back metadata line becomes once it is known what it
 * annotates — what `BlockReader.holdMetadata` in reader.ts releases the
 * line under.
 * @param kind - what the classifier made of a line
 * @returns the token, or undefined if the line is not held-back metadata
 */
export function heldMetadataToken(kind: LineKind): TokenType | undefined {
  return HELD_TOKENS.get(kind.kind);
}

/**
 * Whether a line kind is one `parse_block_metadata_line` holds back for
 * the block that follows (see `BlockReader.holdMetadata` in reader.ts).
 * Defined in terms of {@link heldMetadataToken} rather than a second
 * `HELD_TOKENS` lookup, so there is exactly one source of truth for
 * which line kinds are held-back metadata.
 * @param kind - what the classifier made of a line
 * @returns true for an anchor, an attribute line, a block title or a
 *   raw line
 */
export function isHeldMetadata(kind: LineKind): boolean {
  return heldMetadataToken(kind) !== undefined;
}
