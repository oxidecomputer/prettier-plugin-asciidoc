/**
 * Delimited blocks: the verbatim ones whose content is source text
 * (listing, literal, pass, fenced code, comment block) and the parent
 * ones whose content is blocks (example, sidebar, open, quote).
 *
 * Every function here takes the block's `extent` and the document's
 * `LocationIndex` (`at`); most also take what was already decided
 * elsewhere — a variant, a role, a rename, or the parsed children —
 * and return the finished node. The extent states its own offsets —
 * where content stops and where the node ends — so no builder here
 * re-derives a boundary from a delimiter. No traversal, no
 * context: what a line MEANS was decided by lines/classify.ts against
 * the registry in line-shapes.ts, and which block it belongs to by
 * the extent lines/reader.ts collected for it. These only take it
 * apart.
 */
import type {
  AdmonitionNode,
  BlockNode,
  CommentNode,
  DelimitedBlockNode,
  LeafDelimiterVariant,
  ParentBlockNode,
  VerbatimVariant,
} from "../../ast.js";
import { NEWLINE_LENGTH } from "../../constants.js";
import type { Fragment, LocationIndex } from "../positions.js";

/**
 * The node the reader builds at OPEN for a verbatim delimited block —
 * decided by resolveDelimitedOpen (lines/open-style.ts) and handed
 * straight to {@link buildVerbatimBlock} with the extent, so nothing
 * is ever re-derived from the opener.
 *
 * Declared HERE, beside the builder that consumes it, rather than up
 * in lines/frames.ts: the reader layer produces a role and this layer
 * takes it apart, so the type belongs to the taking-apart. Resident in
 * frames.ts it made an import run back UP the stack, which is the one
 * direction the layer rules forbid.
 */
export type VerbatimRole =
  | {
      /** Role discriminant: a block opened by its own leaf delimiter. */
      readonly builds: "leafBlock";
      /** Which leaf delimiter opened it. */
      readonly variant: LeafDelimiterVariant;
    }
  | {
      /**
       * Role discriminant: a Markdown-style backtick fence, which
       * implies the `source` style and is the one opener carrying a
       * language hint.
       */
      readonly builds: "fencedBlock";
      /** The fence's language hint, when its opening line carried one. */
      readonly language?: string;
    }
  | {
      /** Role discriminant: a parent block a style re-modeled to verbatim. */
      readonly builds: "masqueradedBlock";
      /** The variant the style named. */
      readonly variant: VerbatimVariant;
      /** The parent delimiter the style re-modeled. */
      readonly sourceDelimiter: ParentBlockNode["variant"];
    }
  | {
      /** Role discriminant: a comment block, which is a CommentNode. */
      readonly builds: "comment";
    };

/** The source extent an extent-first delimited read produced. */
export interface BlockExtent {
  /** The opening delimiter line. */
  readonly open: Fragment;
  /**
   * The closing delimiter line, when the block met one. Optional
   * DATA (a table's builder reads its image back, build/table.ts),
   * not half of an exclusive pair: `contentEnd` and `end` are total
   * either way, and nothing decodes a two-field encoding of one fact.
   */
  readonly close: Fragment | undefined;
  /**
   * Exclusive offset where content stops: the raw end of the last
   * interior line — always a line's OWN end, never a boundary
   * offset minus one (the arithmetic that dropped a confined
   * content byte, #44). The open line's raw end when the interior
   * is empty (which puts it before contentStart, and the slice
   * guard yields "").
   */
  readonly contentEnd: number;
  /**
   * Exclusive offset where the NODE ends — total over both close
   * kinds: past the close line's raw end when the block closed;
   * the confinement's forced-close offset (the two-offsets
   * convention: an inner block's forced end is the terminator line's
   * START; the closed block's OWN end is that line's raw END) when it
   * did not.
   */
  readonly end: number;
  /** The whole document; verbatim content is sliced from it. */
  readonly source: string;
}

/**
 * The half of a {@link BlockExtent} a parent-model builder reads: a
 * compound block's content is its parsed children, never a slice, so
 * only where it opened and where the node ends travel (the
 * extent-first packager passes the full BlockExtent here too,
 * structurally). NOT exported (knip's types bucket gates dead
 * exported types at 0): callers pass literals or a whole BlockExtent;
 * the name exists for the two builders' signatures alone.
 */
type ParentExtent = Pick<BlockExtent, "open" | "end">;

/**
 * The interior of a delimited extent, sliced from the source text:
 * from just past the opening delimiter line to where content stops.
 * Line-based reconstruction would lose the blank lines inside, so
 * every verbatim builder here slices instead.
 * @param extent - where the block opened and closed
 * @returns the content, or `""` for an empty interior
 */
function interiorOf(extent: BlockExtent): string {
  const { open, contentEnd, source } = extent;
  // Content starts after the open delimiter + newline.
  const contentStart = open.offset + open.image.length + NEWLINE_LENGTH;
  return contentStart <= contentEnd
    ? source.slice(contentStart, contentEnd)
    : "";
}

/**
 * A delimited block's own span: the opening delimiter line's start to
 * the extent's total `end`, which is one formula over both close kinds.
 * @param extent - where the block opened and where the node ends
 * @param at - the document's location index
 * @returns the node's position
 */
function spanOf(
  extent: Pick<BlockExtent, "open" | "end">,
  at: LocationIndex,
): DelimitedBlockNode["position"] {
  return { start: at.start(extent.open), end: at.at(extent.end) };
}

/**
 * The bracket interior of the block-attribute line released directly
 * above a block, as the reader recorded it (`HeldMetadata.annotation`,
 * lines/held-metadata.ts), or undefined when nothing annotated the
 * block, as the key to write LAST into a node literal - so a node
 * leaves its builder finished and nothing assigns a field afterwards.
 *
 * ONE body, declared HERE and imported by build/paragraph.ts, because
 * every builder that takes an annotation returns a
 * `DelimitedBlockNode` and this is the module that builds that node
 * kind. The rule it encodes is the wire format's: an absent key and a
 * key holding `undefined` serialize alike but are not the same
 * object, and src/ast.ts declares the field ABSENT when nothing
 * annotated the block. A rule about the wire belongs in one place -
 * two copies kept in step by a prose cross-reference is how the two
 * spellings drift apart.
 *
 * The conditional spread is the same device `language` uses below.
 * @param annotatedBy - the recorded annotation, or undefined
 * @returns the key to spread last into a node literal
 */
export function annotation(annotatedBy: string | undefined): {
  annotatedBy?: string;
} {
  return annotatedBy === undefined ? {} : { annotatedBy };
}

/**
 * A block opened by its own leaf delimiter — `----`, `....`, `++++`.
 *
 * Key order is part of parity's no-change claim (pinned by the
 * key-order rows in tests/parser/block-masquerade.test.ts), so every
 * literal in this file writes its keys in wire order and assigns
 * nothing after construction. `annotatedBy` trails `position`
 * because the reader's old post-construction stamp put it there;
 * writing it last in the literal keeps the wire order the pinned rows
 * expect.
 * @param extent - where the block opened and closed
 * @param variant - which leaf delimiter opened it
 * @param at - the document's location index
 * @param annotatedBy - the annotation the reader recorded, if any
 * @returns the leaf block node
 */
function buildLeafBlock(
  extent: BlockExtent,
  variant: LeafDelimiterVariant,
  at: LocationIndex,
  annotatedBy: string | undefined,
): DelimitedBlockNode {
  return {
    type: "delimitedBlock",
    variant,
    form: "delimited",
    content: interiorOf(extent),
    position: spanOf(extent, at),
    ...annotation(annotatedBy),
  };
}

/**
 * A block from a Markdown-style backtick fence. `fenced` and
 * `language` follow `position` in the literal because that is where
 * the old post-construction assignments put them on the wire.
 *
 * The hint arrives INSIDE the role, the way the masquerade's two
 * halves do below: `language` and `annotatedBy` are both
 * `string | undefined`, so as two loose positional slots a caller
 * could swap them and the compiler would agree. The role carries the
 * one the open resolved, which leaves a single slot of that type in
 * the signature.
 * @param extent - where the fence opened and closed
 * @param fence - the role arm the open resolved, carrying the hint
 *   the opening line had
 * @param at - the document's location index
 * @param annotatedBy - the annotation the reader recorded, if any
 * @returns the fenced block node
 */
function buildFencedBlock(
  extent: BlockExtent,
  fence: Extract<VerbatimRole, Record<"builds", "fencedBlock">>,
  at: LocationIndex,
  annotatedBy: string | undefined,
): DelimitedBlockNode {
  const { language } = fence;
  return {
    type: "delimitedBlock",
    variant: "listing",
    form: "delimited",
    content: interiorOf(extent),
    position: spanOf(extent, at),
    fenced: true,
    ...(language === undefined ? {} : { language }),
    ...annotation(annotatedBy),
  };
}

/**
 * A parent block a held style re-modeled to verbatim content: the
 * variant the style named, and the parent delimiter it re-modeled so
 * the printer emits that spelling back.
 *
 * The masquerade travels as ONE parameter - the role's own arm -
 * because the linter caps a builder at four and the annotation needs
 * the fourth. The two halves were never separable anyway: the role
 * declares them together and the open resolves them together, which
 * is why {@link buildDelimitedAdmonition}'s `rename` has the same
 * shape.
 * @param extent - where the block opened and closed
 * @param masquerade - the role arm the open resolved
 * @param at - the document's location index
 * @param annotatedBy - the annotation the reader recorded, if any
 * @returns the masqueraded block node
 */
function buildMasqueradedBlock(
  extent: BlockExtent,
  masquerade: Extract<VerbatimRole, Record<"builds", "masqueradedBlock">>,
  at: LocationIndex,
  annotatedBy: string | undefined,
): DelimitedBlockNode {
  return {
    type: "delimitedBlock",
    variant: masquerade.variant,
    form: "delimited",
    content: interiorOf(extent),
    sourceDelimiter: masquerade.sourceDelimiter,
    position: spanOf(extent, at),
    ...annotation(annotatedBy),
  };
}

/**
 * Builds a CommentNode from a block comment's extent.
 * Content is sliced from the source text rather than rebuilt line by
 * line (which would lose the blank lines inside); a forced close ends
 * it where the reader ended the block.
 *
 * Exported for the SECOND consumer the variant dispatch below cannot
 * serve: the document-header scan (lines/header-reader.ts) meets a
 * `////` block where `skip_comment_lines` skips one, inside a header
 * whose other lines are not delimited blocks at all - so it needs
 * this builder without the variant table around it. Those blank lines
 * inside are exactly why the header must consume the block whole
 * rather than stop at it: to the oracle a blank INSIDE a comment
 * block does not end the header (measured).
 * @param extent - where the block opened and closed
 * @param at - the document's location index
 * @returns A CommentNode with block type whose value contains
 *   the raw content between (or after) the delimiters.
 */
export function buildBlockComment(
  extent: BlockExtent,
  at: LocationIndex,
): CommentNode {
  return {
    type: "comment",
    commentType: "block",
    value: interiorOf(extent),
    position: spanOf(extent, at),
  };
}

/**
 * A delimited block kept verbatim — listing, literal, pass, fence,
 * verse, or a comment block (a CommentNode).
 * The ROLE was decided at open (lines/open-style.ts) and travels
 * with the extent: nothing is re-derived from the opener here, which
 * is what deleted the two agreement guards this function and
 * verbatimVariant used to carry.
 * @param extent - where the block opened and closed
 * @param role - what the opening line resolved to build
 * @param at - the document's location index
 * @param annotatedBy - the annotation the reader recorded, if any
 * @returns the node the role names
 */
export function buildVerbatimBlock(
  extent: BlockExtent,
  role: VerbatimRole,
  at: LocationIndex,
  annotatedBy: string | undefined,
): DelimitedBlockNode | CommentNode {
  if (role.builds === "comment") {
    // A CommentNode declares no `annotatedBy` (src/ast.ts), so an
    // annotation over a `////` block is dropped here - exactly what
    // the reader's own `node.type === "delimitedBlock"` guard did
    // before this parameter replaced it.
    return buildBlockComment(extent, at);
  }
  if (role.builds === "fencedBlock") {
    return buildFencedBlock(extent, role, at, annotatedBy);
  }
  if (role.builds === "masqueradedBlock") {
    return buildMasqueradedBlock(extent, role, at, annotatedBy);
  }
  return buildLeafBlock(extent, role.variant, at, annotatedBy);
}

/**
 * A delimited block a held admonition style renamed at open
 * (`ADMONITION_STYLES`, parser.rb:543-544): an AdmonitionNode that
 * KEEPS its parsed children — Ruby's `:admonition` arm hands
 * `build_block` the :compound content model (parser.rb:881-884).
 * The wrapper delimiter IS the node's `form` — the spelling and the
 * wrapper are one fact, never two fields that can disagree. Position
 * is the parent block's own: start at the opener, end at the extent's
 * total `end` (one formula for every close kind).
 *
 * The rename travels as ONE parameter because the linter caps a
 * builder at four; the two halves are inseparable anyway — a rename
 * is a delimiter and the variant it was renamed to.
 * @param extent - where the block opened and closed
 * @param rename - what the held style made of the block
 * @param rename.delimiter - which parent-block delimiter wraps the body
 * @param rename.variant - the admonition variant (lowercase)
 * @param children - the blocks the reader put inside it
 * @param at - the document's location index
 * @returns the admonition node
 */
export function buildDelimitedAdmonition(
  extent: ParentExtent,
  rename: {
    /** Which parent-block delimiter wraps the body. */
    readonly delimiter: ParentBlockNode["variant"];
    /** The admonition variant (lowercase). */
    readonly variant: string;
  },
  children: BlockNode[],
  at: LocationIndex,
): AdmonitionNode {
  const { delimiter, variant } = rename;
  return {
    type: "admonition",
    variant,
    form: delimiter,
    text: [],
    children,
    position: { start: at.start(extent.open), end: at.at(extent.end) },
  };
}

/**
 * A delimited block whose content is parsed as blocks: example,
 * sidebar, open, quote.
 *
 * A parent block's own position ends where the extent it READ ends —
 * on its terminator when it met one, at the start of the outer
 * terminator that took the line when it did not, and at the document
 * end at EOF. That is the same rule the verbatim blocks follow, and
 * the extent states it as one offset (`end`) rather than as a pair
 * of boundaries this builder would have to decode.
 * @param extent - where the block opened and where the node ends
 * @param variant - which parent block it is
 * @param children - the blocks the reader put inside it
 * @param at - the document's location index
 * @returns the parent block node
 */
export function buildParentBlock(
  extent: ParentExtent,
  variant: ParentBlockNode["variant"],
  children: BlockNode[],
  at: LocationIndex,
): ParentBlockNode {
  return {
    type: "parentBlock",
    variant,
    children,
    position: { start: at.start(extent.open), end: at.at(extent.end) },
  };
}
