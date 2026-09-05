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
  ADMONITION_LABEL_FOLD_FAMILY,
  BLOCK_DELIMITER_LENGTH_FAMILY,
  DESCRIPTION_LIST_ITEM_FAMILY,
  MARKDOWN_THEMATIC_BREAK_FAMILY,
  NO_OP_CONTINUATION_FAMILY,
  OPEN_BLOCK_TILDE_FAMILY,
  TABLE_DELIMITER_LENGTH_FAMILY,
  TABLE_LAYOUT_FAMILY,
  UNDERLINED_SECTION_TITLE_FAMILY,
} from "./parity-ledger.js";

// Ruby's five admonition styles (ADMONITION_STYLES, parser.rb:730),
// in the bracket spelling a style line carries before the fold.
const ADMONITION_STYLES: readonly string[] = [
  "NOTE",
  "TIP",
  "IMPORTANT",
  "WARNING",
  "CAUTION",
];

/**
 * Whether a base/head pair differs by EXACTLY one admonition style
 * line's fold to its label form: `[STYLE]\n` at the head of `baseOut`
 * respelled `STYLE: ` at the head of `headOut`, with every byte after
 * that line identical in both. Tested on the OUTPUTS a diff actually
 * produced rather than claimed by the coordinate that happened to
 * realize it first ({@link ADMONITION_LABEL_FOLD_FAMILY}'s own
 * citation names why - issue #202's lesson): {@link gridRowFamily}
 * answers by coordinate for the rows below it because each of THOSE
 * mechanisms is a property of the coordinate itself (a kind the base
 * registry has no dimension for, a container every row inside moves
 * for), but the admonition fold is a property of what the printer
 * wrote, realized at exactly one coordinate today and not chosen
 * because of it.
 * @param baseOut - the base revision's formatted output
 * @param headOut - this checkout's formatted output
 * @returns the family, or undefined when no admonition style line
 *   explains the whole difference
 */
export function admonitionLabelFoldFamily(
  baseOut: string,
  headOut: string,
): string | undefined {
  for (const style of ADMONITION_STYLES) {
    const bracketPrefix = `[${style}]\n`;
    const labelPrefix = `${style}: `;
    if (
      !baseOut.startsWith(bracketPrefix) ||
      !headOut.startsWith(labelPrefix)
    ) {
      continue;
    }
    if (
      baseOut.slice(bracketPrefix.length) === headOut.slice(labelPrefix.length)
    ) {
      return ADMONITION_LABEL_FOLD_FAMILY;
    }
  }
  return undefined;
}

/** The delimiter kind base's registry has no dimension for at all. */
const OPEN_BLOCK_TILDE_KIND = "openBlockTilde";

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
 * The coordinates the two READING changes move, named one by one
 * rather than blanketed over a kind, a container or a perturbation -
 * which is this module's own rule, and it bites hardest here. Both
 * mechanisms are about what a LINE INSIDE the grid's document says,
 * and no coordinate of the triple carries that: `foreign-marker-inside`
 * writes `* x` above the block's content line at every kind, and only
 * where the interior that results puts a text line directly over a
 * uniform run within one character of its length does a title appear.
 * Blanketing the perturbation would blind the kinds where it does
 * not.
 *
 * A TITLE the base did not read (issue #16). Each row's head output
 * gains an ATX heading where the base kept prose and re-delimited a
 * block around it: the interior the perturbation writes ends up with
 * a text line over a delimiter run, and that pair is a section title
 * to the oracle. The three `setext/*` rows are the same reading and
 * carry the family at their own push site, where they are built
 * (shape-registry-grids.ts).
 */
const UNDERLINED_TITLE_COORDINATES: ReadonlySet<string> = new Set([
  "example/after-h0-adjacent/foreign-marker-inside",
  "example/after-h0-adjacent/heading-inside",
  "example/in-example/closed",
  "example/in-example/closed-no-final-newline",
  "example/in-example/closed-then-text-adjacent",
  "example/in-example/heading-inside",
  "example/in-example/longer-delimiter-inside",
  "example/in-example/terminator-trailing-ws",
  "example/in-example/unterminated",
  "example/in-example/unterminated-then-blank-text",
  "listing/after-h0-adjacent/foreign-marker-inside",
  "listing/after-h0-adjacent/heading-inside",
  "pass/after-h0-adjacent/foreign-marker-inside",
  "pass/after-h0-adjacent/heading-inside",
]);

/**
 * A BREAK the base did not read (issue #23). Four coordinates, each
 * one where the perturbation writes a three-character run - `---`,
 * `___`, `***` - inside a block whose own delimiter is one character
 * longer, so the run is a near miss for the terminator and a
 * Markdown thematic break to the oracle. The head output writes the
 * canonical `'''` where the base kept the run as prose.
 *
 * `openBlock`'s row is at `longer-delimiter-inside` rather than
 * `near-miss-terminator-inside` because its delimiter is two
 * characters: the run that is one LONGER than `--` is the same `---`
 * that is one shorter than `----`, so the perturbation that reaches
 * the shape is the other one.
 */
const MARKDOWN_BREAK_COORDINATES: ReadonlySet<string> = new Set([
  "listing/after-h0-adjacent/near-miss-terminator-inside",
  "openBlock/after-h0-adjacent/longer-delimiter-inside",
  "quote/after-h0-adjacent/near-miss-terminator-inside",
  "sidebar/after-h0-adjacent/near-miss-terminator-inside",
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
  // Asked before every other per-kind rule: the base registry has no
  // `openBlockTilde` dimension at all (issue #64), so no perturbation
  // of this kind, in any container, can be byte-identical against it -
  // the whole kind takes its own family rather than one coordinate at
  // a time.
  if (kind === OPEN_BLOCK_TILDE_KIND) {
    return OPEN_BLOCK_TILDE_FAMILY;
  }
  // The two reading changes are asked BEFORE the per-kind rules for
  // the reason the description container is: at these coordinates a
  // title or a break is what moved the row, and the leaf-fence or
  // continuation family beside them would be excusing the right row
  // for the wrong reason.
  const coordinate = `${kind}/${containerId}/${perturbationId}`;
  if (UNDERLINED_TITLE_COORDINATES.has(coordinate)) {
    return UNDERLINED_SECTION_TITLE_FAMILY;
  }
  if (MARKDOWN_BREAK_COORDINATES.has(coordinate)) {
    return MARKDOWN_THEMATIC_BREAK_FAMILY;
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
