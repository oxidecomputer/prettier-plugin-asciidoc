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
 * The byte-operator dimension. `trailing-space-first-line` exists
 * because the all-lines operators above can mask a position-dependent
 * bug; one positional probe at the document's first line is the cheap
 * insurance.
 */
export const BYTE_OPERATORS: readonly ByteOperatorEntry[] = [
  trailingByteOperator("trailing-space", " "),
  trailingByteOperator("trailing-tab", "\t"),
  trailingByteOperator("trailing-vt", "\v"),
  trailingByteOperator("trailing-ff", "\f"),
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
