/**
 * The two AST invariants about a delimited or parent block's recorded
 * delimiter SPELLING, split out of ast-invariants.ts for the reason
 * ast-walk.ts was: that file stands at the 450-line ceiling, and
 * these are one subject: a delimiter fact a builder records so the
 * printer never has to re-derive it.
 *
 * Both are totality witnesses for a field a builder sets under a
 * narrow condition: (xiii) that `sourceDelimiter` is never absent
 * where a masquerade variant requires it, (xvi) that `openDelimiter`
 * is never present where only the OPEN variant may carry it. Neither
 * narrows a node to an AST interface, so a shape that changes fails
 * these rows rather than the type-checker; structural, like the file
 * they came from.
 */
import { expect } from "vitest";
import type { AnyNode } from "./ast-walk.js";

// The delimited-block variants that only a masquerading style
// produces, each riding on a recorded source delimiter.
const MASQUERADE_VARIANTS = new Set<unknown>([
  "verse",
  "example",
  "sidebar",
  "quote",
]);

/**
 * (xiii): a masquerade-variant delimited block always carries its
 * source delimiter: `form: "delimited"` with a variant
 * that has no leaf delimiter of its own can only arise from a style
 * re-modeling a parent block, and the open records the delimiter it
 * re-modeled. The printer's masquerade arm READS the field with no
 * fallback table; this row is what makes that read total. Exported
 * for its negative row in tests/parser/ast-invariants.test.ts.
 * @param nodes - every node, in document order
 */
export function expectMasqueradeSourceDelimiter(nodes: AnyNode[]): void {
  for (const node of nodes) {
    if (node.type !== "delimitedBlock" || node.form !== "delimited") {
      continue;
    }
    if (!MASQUERADE_VARIANTS.has(node.variant)) {
      continue;
    }
    expect(
      node.sourceDelimiter,
      `masquerade ${String(node.variant)} block at line ${String(node.position.start.line)} carries no sourceDelimiter`,
    ).toBeDefined();
  }
}

/**
 * (xvi): a parent block's recorded delimiter spelling is defined
 * only for the OPEN variant: `ParentBlockNode.openDelimiter` (issue
 * #64) has meaning only for the one variant a tilde run can open, and
 * `buildParentBlock`'s own fact (src/parse/build/delimited.ts) never
 * sets it otherwise, so this is a witness of that construction rather
 * than a defense against a state the printer would need to guard.
 * Exported for its negative row in tests/parser/ast-invariants.test.ts.
 * @param nodes - every node, in document order
 */
export function expectOpenDelimiterVariantOnly(nodes: AnyNode[]): void {
  for (const node of nodes) {
    if (node.type !== "parentBlock") {
      continue;
    }
    if (node.variant === "open") {
      continue;
    }
    expect(
      node.openDelimiter,
      `${String(node.variant)} block at line ${String(node.position.start.line)} carries an openDelimiter`,
    ).toBeUndefined();
  }
}
