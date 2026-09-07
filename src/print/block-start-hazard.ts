/**
 * WHERE A BLOCK'S FIRST ATOM LANDS, which is the one fact about a
 * block's start that its atoms cannot carry.
 *
 * The printer packs a block's inline content into lines, and at
 * COLUMN 0 a line's reading is not free: `*`, `----`, `.Title` and
 * their kin are BLOCK syntax there. What a finished line spells is
 * the READER's question, asked of the layout the packer produced
 * (`opensTheSameBlock` and `readsBackAsTheBlock`, src/print/reflow.ts).
 * What is left here is where the block's own words begin, which the
 * reader cannot be asked because it is the printer that decides it.
 */
import type { MarkInFront } from "./whitespace-fold.js";

/**
 * Where a block's first atom lands, and - only where a PREFIX holds
 * the column - what that prefix spells.
 *
 * The two facts are ONE value because the second is a question only
 * the first makes answerable: only a prefix can put a THEMATIC
 * BREAK's first mark on the line in front of the block's words, so
 * what that prefix spells is a question a block opening at column 0
 * never asks ({@link MarkInFront}, src/print/whitespace-fold.ts).
 */
export type BlockStart =
  | {
      /** A prefix the printer writes holds the column. */
      readonly atColumnZero: false;
      /**
       * The break mark the prefix writes, where it writes one;
       * undefined for every prefix that spells no part of a rule.
       */
      readonly markInFront: MarkInFront | undefined;
    }
  | {
      /** The block's first atom opens its output line at column 0. */
      readonly atColumnZero: true;
    };
