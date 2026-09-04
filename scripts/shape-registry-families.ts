/**
 * Which expected-diff family explains a base-vs-head difference at a
 * STANDING GRID coordinate (`standingGrid`, scripts/shape-registry.ts).
 *
 * One module rather than a field on the perturbation table, because
 * the answer is not a property of the perturbation alone: the same
 * termination moves a `tablePipe` row for a reason no other kind's row
 * moves for, so the question needs both coordinates and the table that
 * answers it needs both. Splitting it out is also what keeps
 * scripts/shape-registry.ts under its `max-lines` ceiling, which it is
 * at exactly.
 *
 * A coordinate with NO family is expected byte-identical, and a diff
 * there STOPS the run. That is the point of naming coordinates rather
 * than blanketing a kind: the rows below are the ones the table print
 * rules move, and every other row in the grid is still pinned.
 *
 * A LIBRARY module, not a command, and the family strings are the
 * closed enumeration's (scripts/parity-ledger.ts) rather than this
 * file's own.
 */
import {
  NO_OP_CONTINUATION_FAMILY,
  TABLE_DELIMITER_LENGTH_FAMILY,
  TABLE_LAYOUT_FAMILY,
} from "./parity-ledger.js";

/** The delimiter kind whose rows the table print rules move. */
const TABLE_PIPE_KIND = "tablePipe";

/**
 * The family a `tablePipe` coordinate takes, by perturbation.
 *
 * TWO families and not one, because the table print rules move these
 * rows for two different reasons and a family names the reason. Where
 * the table the grid writes is ACCEPTED, its second row goes back on
 * one line and the whole interior takes the normal form
 * ({@link TABLE_LAYOUT_FAMILY}); where a container swallows the
 * opening delimiter, the interior `|====` opens a table of its own
 * and only its two delimiter lines take their shortest spelling
 * ({@link TABLE_DELIMITER_LENGTH_FAMILY}). The two sets are exactly
 * the perturbations below, measured over the realized grid: 19 rows
 * at each of the five layout keys and 2 at each of the three
 * delimiter keys.
 *
 * `trailing-plus-after-close` is in the LAYOUT set rather than taking
 * the `no-op-continuation` family every other kind takes at that
 * coordinate. The `+` it writes stopped moving bytes once the base
 * carried the lone-`+` fix, so what moves in a `tablePipe` row there
 * is the table interior like every other closed row, and a family
 * naming the `+` would be excusing the right row for the wrong
 * reason.
 */
const TABLE_PIPE_FAMILIES: ReadonlyMap<string, string> = new Map([
  ["closed", TABLE_LAYOUT_FAMILY],
  ["terminator-trailing-ws", TABLE_LAYOUT_FAMILY],
  ["closed-then-text-adjacent", TABLE_LAYOUT_FAMILY],
  ["closed-no-final-newline", TABLE_LAYOUT_FAMILY],
  ["trailing-plus-after-close", TABLE_LAYOUT_FAMILY],
  ["unterminated", TABLE_DELIMITER_LENGTH_FAMILY],
  ["unterminated-then-blank-text", TABLE_DELIMITER_LENGTH_FAMILY],
  ["longer-delimiter-inside", TABLE_DELIMITER_LENGTH_FAMILY],
]);

/**
 * The family every OTHER kind takes at `trailing-plus-after-close`:
 * inside an item container the `+` that perturbation writes sits at
 * the item's end, where it attaches nothing and is no longer printed.
 * The one coordinate outside `tablePipe` that is allowed to differ.
 */
const TRAILING_PLUS = "trailing-plus-after-close";

/**
 * The family a standing grid row takes, or undefined where the row is
 * expected byte-identical.
 * @param kind - the delimiter kind the row is built from
 * @param perturbationId - the perturbation's stable name
 * @returns the family, or undefined where a diff stops the run
 */
export function gridRowFamily(
  kind: string,
  perturbationId: string,
): string | undefined {
  if (kind === TABLE_PIPE_KIND) {
    return TABLE_PIPE_FAMILIES.get(perturbationId);
  }
  return perturbationId === TRAILING_PLUS
    ? NO_OP_CONTINUATION_FAMILY
    : undefined;
}
