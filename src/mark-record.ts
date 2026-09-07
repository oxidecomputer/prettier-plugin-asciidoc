/**
 * THE MARK RECORD: what the reader decides about the two marks of one
 * inline span, and the printer reads back.
 *
 * A LEAF, deliberately, for the reason src/whitespace-record.ts is
 * one. src/ast.ts names the record on the span node types, and the
 * module that builds it (src/parse/inline/mark-facts.ts) names the
 * token vocabulary, so declaring the record in the builder would put
 * a src/ast.ts import in front of every printer that reads a mark and
 * make the cross-file cycle the metrics graph gate refuses even for
 * type-only imports (scripts/metrics/graph.ts). Nothing is imported
 * here, so nothing can.
 *
 * WHY THE READER AND NOT THE PRINTER. Whether a span's mark stands
 * against its content or against whitespace is what every constrained
 * row of `QUOTE_SUBS` reads: the content group is `(\S|\S.*?\S)`
 * (asciidoctor.rb l.448-464), non-whitespace at both ends. That is a
 * fact about the SOURCE, and the source is what the reader holds. The
 * printer holds atoms instead, where the same whitespace is in two
 * places depending on how it folded - a JOIN when it became one, the
 * atom's own BYTES when it rode inside one - so no single atom read
 * answers the rows' question and a decision taken there is a second
 * opinion about what the pairing already settled.
 */

/**
 * Both of one span's marks, as the reader read them.
 *
 * Recorded on every span node, so the printer's question about a mark
 * is a read of the node it is printing rather than a walk of the
 * atoms that node produced.
 */
export interface SpanMarks {
  /** The opening mark. */
  readonly open: MarkFact;
  /** The closing mark. */
  readonly close: MarkFact;
}

/**
 * What one mark stands against on the CONTENT side.
 *
 * EVERY ARM IS A NAMED INTERFACE, never written inline in a union,
 * and neither is exported: {@link SpanMarks} and {@link MarkFact} are
 * what travel. The census names an anonymous union member by
 * position, so a change that reordered the arms would rename both.
 *
 * SURVIVING BYTES, per arm. `entangled` is carried by the mark and
 * the content character flush against it, and the printer writes
 * those two adjacent, so a second read re-derives the arm from bytes
 * the output holds. `isolated` is carried by the whitespace between
 * them, and the printer writes at least one whitespace byte there
 * (the fusion's space, a run whose bytes it replays, or a break the
 * whitespace record holds), so a second read re-derives that arm too.
 * Neither arm records WHICH whitespace: the spelling does not survive
 * a fold, and a fact the printer destroys is not one it may consume.
 */
export type MarkFact = EntangledMark | IsolatedMark;

/**
 * The mark is flush against the content it delimits: the constrained
 * rows' content group reads the two as one word, and the printer's
 * fusion writes them with nothing in between.
 *
 * NO PAYLOAD, and that is a deviation from the shape this record was
 * asked for, which named the construct the mark is entangled WITH.
 * Nothing reads it. Keeping the pair pairing is not a per-mark
 * question here: the fusion writes mark and content adjacent
 * unconditionally, and what can still make the shorter spelling
 * illegal is read elsewhere and over other bytes - the block-wide
 * stray-mark and bare-address scans, and the attrlist clauses
 * ({@link constrainedIsLegal}, src/print/declared-rules.ts). The one
 * naming a partner would serve is a construct that OWNS its output
 * line (a raw line, a hard line break), and neither can ever be
 * flush against a mark, because each needs a line boundary between
 * them - which puts the mark in {@link IsolatedMark}. An arm carrying
 * a name no decision consumes is decoration the fact census would
 * have to classify.
 */
interface EntangledMark {
  /** Arm discriminant. */
  readonly kind: "entangled";
}

/**
 * Whitespace stands between the mark and the content.
 *
 * The constrained rows refuse the span at that edge, so a span with
 * an isolated mark has no shorter spelling; and the whitespace is one
 * the author wrote, so a break the packer puts back there is the
 * author's own line rather than an invented one.
 */
interface IsolatedMark {
  /** Arm discriminant. */
  readonly kind: "isolated";
}
