/**
 * THE WHITESPACE RECORD: the type of what the reader decides about
 * one prose block's whitespace, and the printer reads back.
 *
 * A LEAF, deliberately. src/ast.ts names the record on four node
 * types, and the two modules that build and index it
 * (src/whitespace-runs.ts, src/whitespace-fact.ts) name the AST's own
 * node types. Declaring the record in either of those would make the
 * cross-file cycle the metrics graph gate refuses even for type-only
 * imports (scripts/metrics/graph.ts). Nothing is imported here, so
 * nothing can.
 */
/**
 * How one prose block's whitespace may be respelled. Recorded once at
 * read time, over the block's own inline nodes, and READ by the
 * printer: the packer asks the record what it may write in a run's
 * place instead of asking the text what Asciidoctor would read there.
 *
 * WHY THE READER AND NOT THE PRINTER. A whitespace run is syntax
 * wherever a rule of the reference spells its boundary as the literal
 * space or the literal newline: the em-dash replacement, the hard
 * line break, a macro target, an anchor's reftext. Deciding that from
 * the printed words means re-deriving, one predicate per rule, what
 * the reader already knew when it tokenized the line - and the
 * predicates then disagree with the reader about what a construct is.
 * The record is the reader's answer, and it is a FACT ABOUT THE
 * SOURCE, so two records that agree describe blocks the reference
 * reads alike.
 *
 * THE TWO ARMS. A `replayed` block is one a whole-block row reaches,
 * and every run of it keeps the spelling the source gave it, so no
 * byte changes line. A `reflowable` block carries one fact per
 * whitespace run, in the order `whitespaceRuns`
 * (src/whitespace-runs.ts) enumerates them, so "one fact per run" is
 * an invariant of the record's construction rather than a claim the
 * printer has to check.
 *
 * EVERY ARM BELOW IS A NAMED INTERFACE, never written inline in a
 * union, and none of them is exported. The record census names an
 * anonymous member by position, so a change that reorders the arms
 * would rename every one of them; and nothing outside this module
 * names an arm, because {@link BlockWhitespace} and
 * {@link WhitespaceFact} are what travel.
 */
export type BlockWhitespace = ReflowableWhitespace | ReplayedWhitespace;

/**
 * A block whose runs the packer may respell, each under its own fact.
 */
interface ReflowableWhitespace {
  /** Arm discriminant. */
  readonly kind: "reflowable";
  /**
   * One fact per whitespace run of the block, in enumeration order.
   * Empty for a block with no run at all.
   */
  readonly runs: readonly WhitespaceFact[];
}

/**
 * A block the printer writes back exactly as the source spelled it.
 */
interface ReplayedWhitespace {
  /** Arm discriminant. */
  readonly kind: "replayed";
  /** Which whole-block row put the block here. */
  readonly why: ReplayReason;
}

/**
 * Why a whole block is replayed instead of reflowed. Each names a
 * reading about which LINE a byte of the block is on, which is what
 * makes every run of it keep its spelling.
 *
 * THE VERBATIM STYLES ARE NOT HERE, and need no arm: a literal,
 * listing, source or verse style over a paragraph builds a
 * `delimitedBlock` whose content is a source slice
 * (`buildStyledParagraph`, src/parse/build/paragraph.ts), so no such
 * block is a prose block and none reaches the record at all.
 */
type ReplayReason =
  /** The block declares a substitution set the lens cannot see through. */
  | "nonDefaultSubs"
  /** The block holds the unset form `{set:name!}`, which drops its line. */
  | "setOrCounterReference"
  /** The document drops a line holding an unresolved attribute reference. */
  | "dropLineWithReference";

/**
 * What the printer may write in one whitespace run's place.
 *
 * `free` carries NO bytes: the packer reads a free run only through
 * its fact, so two records differing only at free runs are
 * indistinguishable to it. `bound.to` is the run's SOURCE spelling,
 * which the packer keeps (a space stays a space, a newline stays a
 * newline) without keeping the run's width. `verbatim` is the only
 * arm that carries bytes, and they are written back as they stand.
 */
export type WhitespaceFact = FreeRun | BoundRun | VerbatimRun;

/**
 * A run no rule reads: the packer writes a space or a break there.
 */
interface FreeRun {
  /** Arm discriminant. */
  readonly kind: "free";
}

/**
 * A run whose SPELLING is read, but not its width.
 */
interface BoundRun {
  /** Arm discriminant. */
  readonly kind: "bound";
  /** The source's own spelling, which the packer writes back. */
  readonly to: "space" | "newline";
  /** The row that bound it. */
  readonly by: BindingRule;
}

/**
 * A run whose own BYTES are read: they are written back unchanged.
 */
interface VerbatimRun {
  /** Arm discriminant. */
  readonly kind: "verbatim";
  /** The run, as the source wrote it. */
  readonly bytes: string;
  /** The row that bound it. */
  readonly by: BindingRule;
}

/**
 * One name per row that can bind a run. Not decoration: two rows can
 * ask different questions of one run, and an instrument has to be
 * able to report which row bound it without re-deriving the row.
 
 * Exported because it names an arm of the union above, which the
 * record census names by NAME rather than by position; asserted by
 * tests/print/whitespace-fact.test.ts.
 * @internal
 */
type BindingRule =
  /** Every run of a block carrying the hardbreaks option. */
  | "hardbreaksOption"
  /** A run containing a tab, which no rule's boundary class accepts. */
  | "tabInRun"
  /** A run with a dash-bearing or attribute-reference edge. */
  | "dashOrReferenceEdge"
  /** The run in front of a hard-break token. */
  | "hardBreakRun"
  /** The run behind a lone `+` token. */
  | "lonePlusAhead"
  /** A run inside an `image:`, `icon:` or `menu:` target. */
  | "macroTarget"
  /** A run inside an anchor's reftext. */
  | "anchorReftext"
  /**
   * A run of a REPLAYED block. The whole-block rows read which LINE a
   * byte of the block is on, so every run of one keeps the spelling
   * the source gave it and no byte changes line.
   */
  | "blockReplay";
