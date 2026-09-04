/**
 * The vocabulary two generated sweeps share: how a realized grid is
 * crossed with the byte operators, and how a per-row manifest is read
 * back as a failing set to compare against.
 *
 * Both are DECISIONS, not conveniences, which is why they are here
 * once rather than in each sweep. "An operator that changed nothing
 * mints no row" is what stops the same bytes being assessed twice
 * under two ids, and a manifest that is sorted the same way the
 * actual failing set is sorted is what makes a mismatch read as a row
 * diff instead of an ordering diff. Two copies could drift on either,
 * and neither drift would fail anything: the sweep would just quietly
 * assess or compare something slightly different on one of its grids.
 *
 * What is NOT here is either sweep's own vocabulary - the grids, the
 * cluster keys, the manifest paths. Those differ on purpose.
 *
 * A LIBRARY module: `registry-sweep.ts` and `inline-sweep.ts` build
 * rows with it, and their default-tier gates compare with it.
 */
import { BYTE_OPERATORS } from "../../scripts/shape-registry-byte-operators.js";
import type { QuarantineEntry } from "./quarantine.js";
import type { SweepFailure } from "./registry-sweep.js";

/** The two fields the byte-operator crossing reads off a shape. */
interface RealizedShape {
  /** The registry coordinate the perturbed ids are derived from. */
  readonly id: string;
  /** The realized document. */
  readonly input: string;
}

/**
 * Crosses realized shapes with the byte-operator dimension: each
 * shape clean, then once per operator that actually changed it.
 *
 * An operator whose `apply` returns undefined was a no-op on this
 * document and mints no row, so the sweep never runs the same bytes
 * twice under two names. A perturbed row's id is the shape's id with
 * `@<operatorId>` behind it, which is what lets a manifest name the
 * perturbed row and the clean one separately.
 * @param shapes - the realized grid to cross
 * @param makeRow - builds one row from its shape, id and bytes; each
 *   sweep supplies the fields its own rows carry
 * @returns the clean and perturbed rows, in a stable order
 * @template Shape - the realized shape type the grid produces
 * @template Row - the sweep's own row type
 */
export function crossByteOperators<Shape extends RealizedShape, Row>(
  shapes: readonly Shape[],
  makeRow: (shape: Shape, id: string, input: string) => Row,
): Row[] {
  const rows: Row[] = [];
  for (const shape of shapes) {
    rows.push(makeRow(shape, shape.id, shape.input));
    for (const operator of BYTE_OPERATORS) {
      const input = operator.apply(shape.input);
      if (input === undefined) {
        continue;
      }
      rows.push(makeRow(shape, `${shape.id}@${operator.id}`, input));
    }
  }
  return rows;
}

/**
 * A failing set in the manifest's order: sorted by id, so the two
 * sides of a gate's comparison cannot differ merely by sweep order.
 * @param failures - the rows to order
 * @returns the same rows, sorted
 */
export function byId(failures: readonly SweepFailure[]): SweepFailure[] {
  return failures.toSorted((a, b) => (a.id < b.id ? -1 : Number(a.id > b.id)));
}

/**
 * A per-row manifest as the sweep's own result shape, sorted by id,
 * so the two sides compare with `toEqual` and a mismatch reads as a
 * row diff rather than a map diff.
 * @param manifest - the loaded quarantine manifest
 * @returns the expected failing set
 */
export function expectedFailures(
  manifest: ReadonlyMap<string, QuarantineEntry>,
): SweepFailure[] {
  return byId([...manifest].map(([id, entry]) => ({ id, fails: entry.fails })));
}
