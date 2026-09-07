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
import type { InlineNode, TextNode } from "../ast.js";
import type { NodeFacts } from "../whitespace-runs.js";
import {
  isBlockSyntaxAtLineStart,
  type Atom,
  type BreakBefore,
} from "./reflow.js";
import type { SpanNode } from "./span-edges.js";
import type { BlockStart } from "./block-start-hazard.js";

/**
 * The join between the atom just emitted and the next one.
 *
 * `"glue"` fuses with no space, `"space"` puts a space there but forbids
 * a break, `"break"` is an ordinary breakable space, `"hardBreak"` is a
 * mandatory break at the block's continuation indent, and `"literal"`
 * is a mandatory break that opens its line at column 0. They are
 * RANKED: when two nodes each ask for a join, the stronger one stands -
 * which is how a raw line's mandatory break survives a neighbour's
 * whitespace asking only for a breakable space.
 *
 * `"hardBreak"` is what a whitespace run BOUND to a newline asks for
 * (`WhitespaceFact`, src/whitespace-record.ts): the source wrote a
 * line break there and a row of the record reads it, so the packer may
 * not write a space instead - but the line it opens is the same
 * block's, so it takes the block's indent rather than column 0.
 */
export type Boundary = "glue" | "space" | "break" | "hardBreak" | "literal";

// Weakest join first: a later index outranks an earlier one.
const BOUNDARY_ORDER: readonly Boundary[] = [
  "glue",
  "space",
  "break",
  "hardBreak",
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

// The break each MANDATORY join writes. A literal break opens its
// line at column 0; a hard break opens it at the block's own
// continuation indent (see BreakBefore, src/print/reflow.ts).
const BOUNDARY_BREAK = {
  hardBreak: "hard",
  literal: "literal",
} as const satisfies Record<string, BreakBefore>;

/**
 * Stamp a join onto an atom. The atom's OWN break demand survives a
 * non-breaking join: a description-list hazard word that opens a
 * formatting span still demands its break, and `wrap`
 * (src/print/reflow.ts) lifts the demand to the front of the run the
 * span belongs to.
 * @param atom - the atom the join lands on.
 * @param boundary - the join.
 * @returns the atom carrying it.
 */
export function withBoundary(atom: Atom, boundary: Boundary): Atom {
  // A `hardBreak` in front of a construct that would OPEN A BLOCK at a
  // line start is refused, and the join falls back to the space that
  // forbids a break. The line such a break opens is at the block's
  // continuation indent, which is column 0 for a paragraph, and the
  // source's own column is not the printer's to reconstruct here - so
  // what the record asked for cannot be written without writing a
  // delimiter the author did not. The same trade `wordAtom`
  // (src/print/reflow.ts) makes for a WORD the packer fuses backwards.
  const join =
    boundary === "hardBreak" && isBlockSyntaxAtLineStart(atom.text)
      ? "space"
      : boundary;
  const breakBefore: BreakBefore =
    join === "literal" || join === "hardBreak"
      ? BOUNDARY_BREAK[join]
      : atom.breakBefore;
  return {
    ...atom,
    glueLeft: join === "glue",
    noBreakBefore: join === "space",
    breakBefore,
  };
}

/**
 * Where a node sits among its inline siblings, and in which block.
 *
 * The first two fields are what the block-start hazard net's callers
 * read before they call it; the rest is what only the printer asks -
 * the siblings themselves, the enclosing span, and the block's source
 * start line the dlist first-line guard reads.
 */
export interface Cursor {
  /** The node's index among its inline siblings. */
  readonly index: number;
  /**
   * Where the block's FIRST atom lands and what stood on its source
   * line ({@link BlockStart}, src/print/block-start-hazard.ts). Only
   * an atom that actually lands at column 0 can be re-read as block
   * syntax there.
   */
  readonly blockStart: BlockStart;
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
   * siblings - see {@link constrainedIsLegal}.
   */
  readonly blockNodes: readonly InlineNode[];
  /**
   * Whether this node sits inside a monospace span's content, where
   * interior whitespace is CONTENT rather than prose to fold (issue
   * #32): a `monospace` ancestor sets it, and it survives further
   * nesting (a mark span inside a monospace span still answers true)
   * because Asciidoctor renders the whole code span's text - nested
   * formatting included - exactly as written. src/print/inline.ts's
   * `appendText` reads it to choose between the block's whitespace
   * record and `splitPreservingSpaces` (src/whitespace-runs.ts).
   */
  readonly literalInterior: boolean;
  /**
   * The block's whitespace record, indexed by the text node each fact
   * belongs to ({@link NodeFacts}, src/whitespace-runs.ts). The
   * printer READS this and may not re-derive it: what a run of the
   * block's whitespace may be respelled as was decided once, at read
   * time, over the source the printer no longer holds.
   */
  readonly facts: ReadonlyMap<TextNode, NodeFacts>;
}
