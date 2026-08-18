/**
 * Shared numeric constants used across the parser and printer.
 *
 * These replace magic numbers (0, 1) with named values that convey
 * intent. Each constant has one semantic meaning even when the
 * underlying value is the same — e.g. EMPTY and FIRST are both 0,
 * but separating them clarifies whether code is checking emptiness
 * or accessing an index.
 */

// Length/emptiness check: `array.length > EMPTY`, `string.length > EMPTY`.
export const EMPTY = 0;

// First element of an array: `tokens[FIRST]`.
export const FIRST = 0;

// AsciiDoc section levels start at 1, but marker strings start
// at 2 characters ("==" for level 1). MARKER_OFFSET bridges
// the two:
// - parsing:  level = markers.length - MARKER_OFFSET
// - printing: marker = "=".repeat(level + MARKER_OFFSET)
export const MARKER_OFFSET = 1;

// Last element: array.at(LAST_ELEMENT)
export const LAST_ELEMENT = -1;

// Exactly one element: `items.length === SINGLE`.
export const SINGLE = 1;

// Offset to the next element in a sequential scan.
// Also used as `length - NEXT` to get the last-element index
// when `.at(LAST_ELEMENT)` can't be used (e.g. ESLint
// `prefer-destructuring` contexts). See inline-tokens.ts.
export const NEXT = 1;

// Width of single-character delimiters stripped via
// slice(DELIM_WIDTH, -DELIM_WIDTH), e.g. `{attr}` or `[role]`.
export const DELIM_WIDTH = 1;

// Two adjacent nodes that form a logical pair (e.g. an attribute
// list followed by the block it annotates).
export const PAIR_LENGTH = 2;

// AsciiDoc delimited blocks require at least 4 delimiter characters
// (e.g. `----`, `....`, `++++`).
export const MIN_DELIMITER_LENGTH = 4;

// Chevrotain's LA(k) uses 1-based lookahead: LA(1) is the
// next token. Used in GATE functions to check what comes next.
export const LOOKAHEAD = 1;

// Two-token lookahead for GATEs that need to peek past the
// current token (e.g. checking what follows a Newline).
export const LOOKAHEAD_2 = 2;

// When a delimited block's content contains a line that looks
// like a delimiter, the output delimiter must be this many
// characters longer than the conflicting line to avoid
// ambiguity on re-parse.
export const SAFE_DELIMITER_PAD = 1;

// Chevrotain uses 1-based lines and columns. These mark the
// origin position in a source file.
export const FIRST_LINE = 1;
export const FIRST_COLUMN = 1;

// A single newline character (`\n`). Used when computing content
// boundaries inside delimited blocks — the newline after the open
// delimiter and before the close delimiter is not part of the content.
export const NEWLINE_LENGTH = 1;

// Sentinel returned by indexOf/findIndex when no match exists.
export const NOT_FOUND = -1;

// Sentinel for auto-numbered callout markers (`<.>`). The
// value 0 is distinct from any explicit callout number (1+).
export const AUTO_CALLOUT_NUMBER = 0;
