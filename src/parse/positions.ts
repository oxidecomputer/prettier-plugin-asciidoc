// The document's position layer: the Location type's one
// constructor and the offset→Location index every builder asks for
// line and column.
//
// It is a LEAF: it imports ../ast.js and ../constants.js and nothing
// else. It depends on no other module of the parser, so both the
// inline layer and the block builders can consume it without either
// depending on the other.
import type { Location } from "../ast.js";
import {
  EMPTY,
  FIRST,
  FIRST_COLUMN,
  FIRST_LINE,
  HALF,
  LAST_ELEMENT,
  NEXT,
  NOT_FOUND,
  SINGLE,
} from "../constants.js";

/**
 * Assemble a Location from raw coordinates. Centralising
 * construction here insulates callers from the field names and
 * makes it easy to grep for every place a Location is created.
 * @param offset - Zero-based character offset from the very start
 *   of the document source (not a substring offset).
 * @param line - One-based line number.
 * @param column - One-based column number.
 * @returns A Location value ready to embed directly in an AST node.
 */
export function makeLocation(
  offset: number,
  line: number,
  column: number,
): Location {
  return { offset, line, column };
}

/** A span of source: its exact bytes and where they start. */
export interface Fragment {
  /** The verbatim source bytes of the span. */
  readonly image: string;
  /** Zero-based offset of the span's first character. */
  readonly offset: number;
}

/** The document's offset→Location index. */
export interface LocationIndex {
  /**
   * The Location of one document offset.
   * @param offset - zero-based, may equal the document length
   * @returns the position, with 1-based line and column
   */
  readonly at: (offset: number) => Location;
  /**
   * The Location of a span's first character.
   * @param fragment - the span
   * @returns its start position
   */
  readonly start: (fragment: Fragment) => Location;
  /**
   * The EXCLUSIVE end of a span: one past its last character.
   * @param fragment - the span
   * @returns its end position
   */
  readonly end: (fragment: Fragment) => Location;
}

/**
 * Build the document's line index once, and answer every position
 * question from it.
 *
 * Binary search over the line starts rather than a scan per token:
 * every inline node in a multi-line paragraph asks this, and a scan
 * would make positioning quadratic in the paragraph.
 *
 * The END convention is the old lexer's, kept because it is the AST's:
 * an exclusive end carries the LAST character's line with its column
 * plus one. A span that ends at a line break therefore reports the
 * line the break is on. Both spellings name the same OFFSET, which is
 * what Prettier's locEnd, cursor tracking and range formatting read.
 * @param source - the whole document
 * @returns the index
 */
export function makeLocationIndex(source: string): LocationIndex {
  // Scanning with indexOf rather than character by character keeps
  // the loop free of a `offset < source.length` bound, whose `<=`
  // mutant reads one past the end and is undetectable: `undefined`
  // is not "\n", so the extra turn pushes nothing.
  const starts = [FIRST];
  for (
    let breakAt = source.indexOf("\n");
    breakAt !== NOT_FOUND;
    breakAt = source.indexOf("\n", breakAt + NEXT)
  ) {
    starts.push(breakAt + NEXT);
  }
  const at = (offset: number): Location => {
    // Half-open: `low` is the greatest line start at or before
    // `offset` (line 1 starts at 0, so it always is one), `high` is
    // exclusive, and the loop stops when they are adjacent. Written
    // this way because the closed form needs a `starts.length - 1`
    // whose off-by-one mutant is invisible — indexing one past the
    // array yields `undefined`, which loses every comparison.
    let low = FIRST;
    // Destructured because `prefer-destructuring` is on: this is
    // `high = starts.length`, the exclusive bound.
    let { length: high } = starts;
    while (high - low > SINGLE) {
      const middle = Math.floor((low + high) / HALF);
      if (starts[middle] <= offset) low = middle;
      else high = middle;
    }
    return makeLocation(
      offset,
      low + FIRST_LINE,
      offset - starts[low] + FIRST_COLUMN,
    );
  };
  return {
    at,
    start: (fragment) => at(fragment.offset),
    end: (fragment) => {
      if (fragment.image.length === EMPTY) return at(fragment.offset);
      const last = at(fragment.offset + fragment.image.length + LAST_ELEMENT);
      return makeLocation(
        fragment.offset + fragment.image.length,
        last.line,
        last.column + NEXT,
      );
    },
  };
}
