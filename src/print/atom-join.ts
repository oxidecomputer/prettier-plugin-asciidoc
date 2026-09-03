/**
 * The ATOM JOIN: the join between two neighbouring inline nodes
 * (glue/space/break/literal), and the print-time cursor that places a
 * node among its siblings - shared by src/print/inline.ts and
 * src/print/literal-span.ts, split out so neither has to import the
 * other (a cycle dependency-cruiser's metrics gate refuses) and so
 * inline.ts stays within the max-lines lint limit.
 *
 * Named apart from tests/format/inline-boundary.test.ts's "boundary"
 * (the characters that may stand beside a formatting mark,
 * src/parse/inline/quote-boundaries.ts) on purpose - this module's
 * `Boundary` type is a different concept (the JOIN between two
 * adjacent atoms) that happened to share the same word before this
 * file was renamed.
 */
import type { InlineNode } from "../ast.js";
import type { Atom, BreakBefore } from "./reflow.js";
import type { SpanNode } from "./span-edges.js";
import type { BlockStartCursor } from "./block-start-hazard.js";

/**
 * The join between the atom just emitted and the next one.
 *
 * `"glue"` fuses with no space, `"space"` puts a space there but forbids
 * a break, `"break"` is an ordinary breakable space, and `"literal"` is
 * a mandatory break that opens its line at column 0. They are RANKED:
 * when two nodes each ask for a join, the stronger one stands - which is
 * how a raw line's mandatory break survives a neighbour's whitespace
 * asking only for a breakable space.
 */
export type Boundary = "glue" | "space" | "break" | "literal";

// Weakest join first: a later index outranks an earlier one.
const BOUNDARY_ORDER: readonly Boundary[] = [
  "glue",
  "space",
  "break",
  "literal",
];

/**
 * The stronger of two joins.
 * @param left - the join already standing.
 * @param right - the join being asked for.
 * @returns whichever ranks higher.
 */
export function strongerBoundary(left: Boundary, right: Boundary): Boundary {
  return BOUNDARY_ORDER.indexOf(right) > BOUNDARY_ORDER.indexOf(left)
    ? right
    : left;
}

/**
 * Stamp a join onto an atom. The atom's OWN break demand survives a
 * non-breaking join: a description-list hazard word that opens a
 * formatting span still demands its break, and {@link wrap} lifts the
 * demand to the front of the run the span belongs to.
 * @param atom - the atom the join lands on.
 * @param boundary - the join.
 * @returns the atom carrying it.
 */
export function withBoundary(atom: Atom, boundary: Boundary): Atom {
  const breakBefore: BreakBefore =
    boundary === "literal" ? "literal" : atom.breakBefore;
  return {
    ...atom,
    glueLeft: boundary === "glue",
    noBreakBefore: boundary === "space",
    breakBefore,
  };
}

/**
 * Where a node sits among its inline siblings, and in which block:
 * what the block-start hazard net reads ({@link BlockStartCursor}),
 * plus everything only the printer asks - the siblings themselves,
 * the enclosing span, and the block's source start line the dlist
 * first-line guard reads.
 */
export interface Cursor extends BlockStartCursor {
  /** The inline siblings the node sits among. */
  readonly siblings: readonly InlineNode[];
  /** 1-based source line the enclosing BLOCK starts on. */
  readonly blockStartLine: number;
  /**
   * The span this node is the content of, when it is one. Declared
   * as a span rather than as any inline node so a span question
   * (rowKeyOf, delimitersOf) can be asked of it directly.
   */
  readonly enclosing: SpanNode | undefined;
  /**
   * The block's top-level inline children. A constrained spelling
   * exposes its marks to a pass that scans the whole LINE, so the
   * stray-mark question is about the block and not about the span's
   * siblings - see `constrainedIsLegal` (src/print/inline.ts).
   */
  readonly blockNodes: readonly InlineNode[];
  /**
   * Whether this node sits inside a monospace span's content, where
   * interior whitespace is CONTENT rather than prose to fold (issue
   * #32): a `monospace` ancestor sets it, and it survives further
   * nesting (a mark span inside a monospace span still answers true)
   * because Asciidoctor renders the whole code span's text - nested
   * formatting included - exactly as written. src/print/inline.ts's
   * `appendText` reads it to choose between src/print/reflow.ts's
   * `splitWords` and `splitPreservingSpaces`.
   */
  readonly literalInterior: boolean;
}
