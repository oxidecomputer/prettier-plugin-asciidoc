/**
 * The byte-operator dimension: document-level transforms applied to
 * realized inputs, in its own module because scripts/shape-registry.ts
 * is at its `max-lines` ceiling and the coding standard splits rather
 * than condenses (the same reason scripts/shape-registry-list-run.ts
 * exists). scripts/shape-registry.ts re-exports this module's names so
 * they still read as that registry's vocabulary; consumers
 * (scripts/metrics/shape-census.ts) may import from either path.
 *
 * The bytes Asciidoctor erases at ingest
 * (`Helpers.prepare_source_string` rstrips every line, strips a BOM,
 * rewrites CRLF) are exactly the bytes the vendored corpus can never
 * exercise: the formatter has to handle them without ever having
 * seen one in a fixture. Bare CR is the recorded gap #68 and stays out
 * until that issue closes.
 *
 * TWO sets are declared, not one. `BYTE_OPERATORS` is the whole
 * dimension, for the grids that are linear in the construct alphabet;
 * `PAIR_BYTE_OPERATORS` is the shorter set the quadratic pair grid
 * crosses with, and its own comment says what was measured to shorten
 * it.
 *
 * A LIBRARY module, not a command, on the same terms as
 * `scripts/shape-registry.ts`.
 */

/** One byte-level document transform from the oracle's ingest set. */
export interface ByteOperatorEntry {
  /** Stable name. */
  readonly id: string;
  /** The transformed document, or undefined when nothing changed. */
  readonly apply: (document: string) => string | undefined;
}

/**
 * @param before - the document before a transform
 * @param after - the document after the same transform
 * @returns `after`, or undefined when the transform was a no-op
 */
const changed = (before: string, after: string): string | undefined =>
  after === before ? undefined : after;

/**
 * One operator that appends `byte` to every non-empty line, the
 * trailing-horizontal-whitespace class `prepare_source_string` rstrips
 * away. Blank lines are skipped deliberately: a whitespace-only line
 * is its own construct, worth a follow-up operator only if triage
 * shows the class matters.
 * @param id - the operator's stable name
 * @param byte - the single character appended to each non-empty line
 * @returns the operator entry
 */
const trailingByteOperator = (id: string, byte: string): ByteOperatorEntry => ({
  id,
  apply: (document) =>
    changed(
      document,
      document
        .split("\n")
        .map((line) => (line === "" ? line : `${line}${byte}`))
        .join("\n"),
    ),
});

/**
 * A trailing space on every non-empty line. Named on its own because
 * both operator sets below list it, and two spellings of one operator
 * could drift apart.
 */
const TRAILING_SPACE = trailingByteOperator("trailing-space", " ");

/**
 * The byte-operator dimension, for the grids that are linear in the
 * construct alphabet. `trailing-space-first-line` exists because the
 * all-lines operators can mask a position-dependent bug; one
 * positional probe at the document's first line is the cheap
 * insurance.
 *
 * A VERTICAL TAB and a FORM FEED are not here. They belong to the
 * same trailing-whitespace class as the tab, they changed no verdict
 * anywhere either grid reaches, and no editor and no export writes
 * either byte into a text file. The bytes are still read: the reader
 * rstrips both, and tests/format/delimited-block.test.ts pins the
 * pair the reader calls whitespace where Prettier's trim does not.
 */
export const BYTE_OPERATORS: readonly ByteOperatorEntry[] = [
  TRAILING_SPACE,
  trailingByteOperator("trailing-tab", "\t"),
  {
    id: "trailing-space-first-line",
    apply: (document) => {
      const lines = document.split("\n");
      if (lines[0] === "") {
        return;
      }
      lines[0] = `${lines[0]} `;
      return lines.join("\n");
    },
  },
  {
    id: "crlf",
    apply: (document) => changed(document, document.replaceAll("\n", "\r\n")),
  },
  {
    id: "no-final-newline",
    apply: (document) =>
      document.endsWith("\n") ? document.slice(0, -1) : undefined,
  },
  { id: "bom", apply: (document) => `\u{FEFF}${document}` },
];

/**
 * The operators the width-2 PAIR grid crosses with: the trailing
 * whitespace class, represented by `trailing-space`, and nothing else.
 *
 * WHY IT IS SHORTER THAN THE DIMENSION ABOVE. The pair grid is
 * quadratic in the alphabet where the other grids are linear, so one
 * operator costs it two orders of magnitude more rows than it costs
 * the standing grid. Each operator was measured over the whole pair
 * product, verdict by verdict, against the operator whose rows would
 * stand in its place: `bom`, `crlf` and `no-final-newline` change no
 * row's verdict relative to the unperturbed document, and
 * `trailing-tab` and `trailing-space-first-line` change none relative
 * to `trailing-space`. `trailing-space` itself does change verdicts, and
 * one coordinate (`pair/continuation/dlist-term/adjacent/doc`) fails
 * under it and under nothing else, so the class is represented rather
 * than dropped in favour of the unperturbed row alone.
 *
 * The cut operators mint bytes the oracle erases at ingest and
 * the formatter reads through, so agreeing with a kept operator is a
 * property of that erasure rather than an accident of sampling; the
 * measurement over the whole product is what checks the formatter
 * really does read through them.
 *
 * A DECLARED list and not a filter over `BYTE_OPERATORS`, so an entry
 * added above cannot silently multiply this product.
 */
export const PAIR_BYTE_OPERATORS: readonly ByteOperatorEntry[] = [
  TRAILING_SPACE,
];
