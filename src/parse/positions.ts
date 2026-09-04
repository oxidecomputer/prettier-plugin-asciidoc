// The document's position layer: the Location type's one
// constructor and the offset→Location index every builder asks for
// line and column.
//
// It is a LEAF: it imports ../ast.js and ../constants.js and nothing
// else. It depends on no other module of the parser, so both the
// inline layer and the block builders can consume it without either
// depending on the other.
import type { Location } from "../ast.js";
import { FIRST_COLUMN, FIRST_LINE } from "../constants.js";

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

/**
 * Where a line ends, scanning from `from`: a `\n`, or a bare `\r`
 * with no `\n` immediately after it. Shared by this module's own
 * index and by splitLines (src/parse/lines/split.ts) so the two
 * authorities that count lines cannot drift apart.
 *
 * The two Asciidoctors diverge here. MRI Ruby's
 * `Helpers.prepare_source_string` (helpers.rb:116-133, not vendored,
 * see docs/coding-standards.md's authority list) does no line-ending
 * normalization at all: it strips a leading BOM, splits on `\n`
 * alone, and rstrips each line, so a lone `\r` is trailing content to
 * it rather than a break. `@asciidoctor/core` 4.0.11's own
 * `prepareSourceString` (helpers.js l.80-82) adds a rewrite MRI does
 * not have: every `\r\n`, then every remaining `\r`, becomes `\n`
 * before the string is ever split. This codebase's tests run against
 * the JS oracle, and it wins: a lone `\r` ends a line here exactly as
 * `\n` does. A `\r` that is part of `\r\n` is not lone and does not
 * end the line by itself (that CRLF's own `\n` does, one position
 * later).
 * @param source - the whole document
 * @param from - offset to scan forward from
 * @returns the offset of the line-ending character, or `source.length`
 *   when none remains
 */
export function nextLineBreak(source: string, from: number): number {
  // The `<=` mutant of this bound is undetectable: it reads one past
  // the end, `source[source.length]` is `undefined`, and `undefined`
  // is neither "\n" nor "\r", so the extra turn returns the same
  // `source.length` the loop falling through would anyway.
  for (let index = from; index < source.length; index += 1) {
    const ch = source[index];
    if (ch === "\n") {
      return index;
    }
    if (ch === "\r" && source[index + 1] !== "\n") {
      return index;
    }
  }
  return source.length;
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
 *
 * The line numbers this index reports are the SAME ones splitLines
 * assigns (src/parse/lines/split.ts): both count every line break
 * `nextLineBreak` finds and nothing else, so a SourceLine's `line`
 * and the index's answer at that line's offset agree by construction,
 * pinned by tests/parser/positions.test.ts.
 * @param source - the whole document
 * @returns the index
 */
export function makeLocationIndex(source: string): LocationIndex {
  const starts = [0];
  for (
    let breakAt = nextLineBreak(source, 0);
    breakAt < source.length;
    breakAt = nextLineBreak(source, breakAt + 1)
  ) {
    starts.push(breakAt + 1);
  }
  const at = (offset: number): Location => {
    // Half-open: `low` is the greatest line start at or before
    // `offset` (line 1 starts at 0, so it always is one), `high` is
    // exclusive, and the loop stops when they are adjacent. Written
    // this way because the closed form needs a `starts.length - 1`
    // whose off-by-one mutant is invisible — indexing one past the
    // array yields `undefined`, which loses every comparison.
    let low = 0;
    let high = starts.length;
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      if (starts[middle] <= offset) {
        low = middle;
      } else {
        high = middle;
      }
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
      if (fragment.image.length === 0) {
        return at(fragment.offset);
      }
      const last = at(fragment.offset + fragment.image.length - 1);
      return makeLocation(
        fragment.offset + fragment.image.length,
        last.line,
        last.column + 1,
      );
    },
  };
}
