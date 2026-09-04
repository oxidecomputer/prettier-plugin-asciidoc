/**
 * Shared numeric constants used across the parser and printer.
 *
 * A constant earns a place here when its value doesn't carry its own
 * meaning — a delimiter width, a 1-based origin, a sentinel number.
 * Plain index/offset arithmetic (the first element, the next slot,
 * the last one) is inlined at call sites instead: `array[0]`,
 * `index + 1`, `array.at(-1)` read as clearly as a named constant
 * ever did, without a name to look up — eslint.config.js's
 * `no-magic-numbers` override (`ignore: [-1, 0, 1, 2]`, readability
 * judgment, agreed 2026-08-22) is what makes that legible again.
 * EMPTY, FIRST, NEXT and LAST_ELEMENT once lived here for exactly
 * that arithmetic and were retired with it.
 */

// AsciiDoc section levels start at 1, but marker strings start
// at 2 characters ("==" for level 1). MARKER_OFFSET bridges
// the two:
// - parsing:  level = markers.length - MARKER_OFFSET
// - printing: marker = "=".repeat(level + MARKER_OFFSET)
export const MARKER_OFFSET = 1;

// Width of single-character delimiters stripped via
// slice(DELIM_WIDTH, -DELIM_WIDTH), e.g. `{attr}` or `[role]`.
export const DELIM_WIDTH = 1;

// AsciiDoc delimited blocks require at least 4 delimiter characters
// (e.g. `----`, `....`, `++++`).
export const MIN_DELIMITER_LENGTH = 4;

// A table's delimiter lines are three characters long, not the four
// the delimited-block family takes: `|===`, `,===`, `:===`, `!===`.
// A block-delimiter-length option (issue #11) governs the family
// above and must NOT be wired to tables, which would spell `|====`
// by default and no AsciiDoc document does.
export const MIN_TABLE_DELIMITER_LENGTH = 3;

// Lines and columns are 1-based, as editors count them. These mark the
// origin position in a source file.
export const FIRST_LINE = 1;
export const FIRST_COLUMN = 1;

// A single newline character (`\n`). Used when computing content
// boundaries inside delimited blocks — the newline after the open
// delimiter and before the close delimiter is not part of the content.
export const NEWLINE_LENGTH = 1;

// Sentinel for auto-numbered callout markers (`<.>`). The
// value 0 is distinct from any explicit callout number (1+).
export const AUTO_CALLOUT_NUMBER = 0;
