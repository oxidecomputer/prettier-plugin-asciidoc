/**
 * Which expected-diff family explains a base-vs-head difference at a
 * STANDING GRID coordinate (`standingGrid`,
 * scripts/shape-registry-grids.ts).
 *
 * One module rather than a field on the perturbation table, because
 * the answer is not a property of the perturbation alone: the same
 * termination moves a `tablePipe` row for a reason no other kind's row
 * moves for, and every row inside a description moves for a reason no
 * kind or perturbation names, so the question needs all three
 * coordinates and the tables that answer it need them too. Splitting
 * it out is also what keeps scripts/shape-registry-grids.ts, which
 * asks the question, from carrying the tables that answer it.
 *
 * A coordinate with NO family is expected byte-identical, and a diff
 * there STOPS the run. That is the point of naming coordinates rather
 * than blanketing a kind: the rows below are the ones the table print
 * rules and the shortest-safe delimiter speller move, and every other
 * row in the grid is still pinned. The one blanket, over the
 * description container, states at its own arm why it is there and
 * which issue removes it.
 *
 * A LIBRARY module, not a command, and the family strings are the
 * closed enumeration's (scripts/parity-ledger.ts) rather than this
 * file's own.
 */
import {
  BLOCK_DELIMITER_LENGTH_FAMILY,
  DESCRIPTION_LIST_ITEM_FAMILY,
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
 * The container whose every row moved when a term line began opening
 * a description list: the body it wraps used to fold onto the term
 * line as paragraph text and now stays on the lines the author wrote.
 * `dlist-desc-line` is NOT here and must not be: its body already
 * stood on its own line, and not one of its rows moved.
 */
const DESCRIPTION_CONTAINER = "dlist-desc";

/**
 * The one coordinate where a delimited LEAF block's own fence moves:
 * the perturbation writes a longer delimiter INSIDE the block, which
 * constrains nothing, so the fence is spelled at its shortest safe
 * length instead of growing past a line that was never a collision.
 *
 * Four kinds and not every kind, because it names the ones whose
 * fence this speller reaches: the three verbatim leaves plus the
 * comment block, whose delimiter is chosen off the interior it wraps.
 * A parent block's wrapper is not here - its interior is a Doc rather
 * than recorded text and its rows do not move at this coordinate -
 * and `tablePipe` keeps {@link TABLE_DELIMITER_LENGTH_FAMILY} in the
 * map below, which is the table's own delimiter rule and not this
 * one. Inside a description the container is answered first, so a
 * leaf fence there takes the container's family rather than this one.
 */
const LONGER_DELIMITER_INSIDE = "longer-delimiter-inside";

/** The leaf kinds whose fence the shortest-safe speller respells. */
const BLOCK_DELIMITER_KINDS: ReadonlySet<string> = new Set([
  "listing",
  "literal",
  "pass",
  "commentBlock",
]);

/**
 * The family a standing grid row takes, or undefined where the row is
 * expected byte-identical.
 *
 * The description container is answered FIRST, and it answers for
 * every kind and every perturbation inside it. That ordering is what
 * the measurement says: all 155 rows that moved sit in this one
 * container, and the twenty-four of them the two per-kind rules below
 * would have claimed are byte-identical at every other container, so
 * the description read is what moved them and a table, a continuation
 * or a leaf-fence family would be excusing the right row for the
 * wrong reason.
 *
 * TRANSIENT, and issue #160 is the removal. A blanket over a
 * container blinds every coordinate inside it, which is the cost this
 * module otherwise refuses to pay; it is paid here only until the
 * landing that moved these rows is the base of every gated
 * differential run, after which they are byte-identical again and the
 * arm has nothing left to excuse.
 * @param kind - the delimiter kind the row is built from
 * @param containerId - the container the construct is embedded in
 * @param perturbationId - the perturbation's stable name
 * @returns the family, or undefined where a diff stops the run
 */
export function gridRowFamily(
  kind: string,
  containerId: string,
  perturbationId: string,
): string | undefined {
  if (containerId === DESCRIPTION_CONTAINER) {
    return DESCRIPTION_LIST_ITEM_FAMILY;
  }
  if (kind === TABLE_PIPE_KIND) {
    return TABLE_PIPE_FAMILIES.get(perturbationId);
  }
  if (
    perturbationId === LONGER_DELIMITER_INSIDE &&
    BLOCK_DELIMITER_KINDS.has(kind)
  ) {
    return BLOCK_DELIMITER_LENGTH_FAMILY;
  }
  return perturbationId === TRAILING_PLUS
    ? NO_OP_CONTINUATION_FAMILY
    : undefined;
}
