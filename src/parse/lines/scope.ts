/**
 * What a BlockReader is GIVEN, as two data declarations: the
 * document-wide facts every reader over one document shares, and how
 * a reader that is not the document reader is bounded.
 *
 * Split out of reader.ts when that file met the 450-line ceiling -
 * the coding standard's prescribed response, and these two are the
 * natural piece to move: they are pure declarations with no
 * behaviour, and they say what a reader is handed rather than what it
 * does.
 */
import type { LocationIndex } from "../positions.js";
import type { GapRecord } from "./list-reader.js";

/**
 * How a reader is confined, when it is not the document reader.
 */
export type Confinement =
  | {
      /** A list item's buffer (Ruby: parse_list_item's Reader, :1350). */
      readonly kind: "item";
      /** The item's marker style - the one-style ancestry. */
      readonly style: string;
      /** The item's own tail-safety (ItemExtent.tailSafe). */
      readonly tailSafe: boolean;
      /**
       * Where a forced close at this buffer's end falls: the last
       * buffer line's raw end - the vii-b clamp, computed at the one
       * place that knows the buffer (listItem()) and carried as data.
       */
      readonly closeOffset: number;
    }
  | {
      /**
       * A compound block's interior (Ruby: build_block's Reader,
       * parser.rb:1046; parse_blocks "does not consider sections",
       * :1091-1092).
       */
      readonly kind: "block";
      /**
       * Whether a trailing `+` at this interior's end re-reads inert
       * - true when the block closed (the printed terminator follows
       * on the very next line and pops it), the enclosing reader's own
       * tail-safety when it did not.
       */
      readonly tailSafe: boolean;
      /**
       * Where a forced close at this interior's end falls: the
       * terminator line's start when the block closed, the
       * enclosing reader's own forced-close offset when it did not.
       */
      readonly closeOffset: number;
    };

/** What every reader over this document shares, however confined. */
export interface ReaderScope {
  /** The whole document. */
  readonly source: string;
  /** The document's offset->Location index, built once. */
  readonly at: LocationIndex;
  /**
   * The document-wide gap record: every extent scan, at every nesting
   * depth, records the separator lines it consumes here, and each
   * item's blocks are paired with their gaps by partitioning it
   * (listItemNode -> gapsOf). Shared because an inner scan re-reads an
   * outer item's buffer, which omits blanks the outer scan skipped -
   * the outer scan's entries are the only record of them.
   */
  readonly gaps: GapRecord;
}
