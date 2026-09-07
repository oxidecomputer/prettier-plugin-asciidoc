/**
 * Inline node → ATOMS: turns a block's inline AST nodes (text, bold,
 * italic, monospace, highlight, curved quotes, super/subscripts,
 * character references, attribute references, links, xrefs,
 * inline anchors, inline images, UI macros, footnotes, passthroughs,
 * raw lines and hard line breaks) into the flat atom list `wrap`
 * (src/print/reflow.ts) packs into output lines.
 *
 * The join between two neighbouring nodes is the whole protocol here,
 * and it is decided in ONE place: a running {@link Boundary} that each
 * node leaves behind and the next node's first atom carries. A node
 * that ends without whitespace leaves `"glue"`, so the next atom fuses
 * onto it with no space and no break — the alternation bookkeeping a
 * separator-slot representation needs has no analogue, because a join
 * is a fact ON an atom rather than an element beside it.
 *
 * Extracted from the main printer to keep file size within
 * the max-lines lint limit.
 */
import type { InlineNode, RawLineNode, TextNode } from "../ast.js";
import { FIRST_COLUMN } from "../constants.js";
import { ASCII_WHITESPACE } from "../parse/line-shapes.js";
import { verbatimText } from "./serialize-inline.js";
import type { SpanNode } from "./span-edges.js";
import { spanDelimiters, type SpanSite } from "./declared-rules.js";
import { marksOf } from "./span-edges.js";
import {
  atomOf,
  type Atom,
  HARD_BREAK_IMAGE,
  wordsToAtoms,
  type HeldJoin,
} from "./reflow.js";
import type { BlockStart } from "./block-start-hazard.js";
import {
  strongerBoundary,
  withBoundary,
  type Boundary,
  type Cursor,
} from "./atom-join.js";
import { appendLiteralText } from "./literal-span.js";
import {
  appendWhitespaceOnlySpan,
  markPlacement,
  pushSpanAtoms,
} from "./span-marks.js";
import {
  appendWholeRun,
  hardBreakOwnsItsLine,
  firstSourceLineWordCount,
  hasFollowingInlineSibling,
  HELD_BOUNDARY,
  joinOfFact,
  keepBreakBetweenMarks,
  leadingBoundary,
  lineShareOf,
  ridesOnWhatFollows,
  ridesOnWhatIsWritten,
  trailingPlusPolicy,
  wordsOfText,
} from "./text-edges.js";
import {
  cutValue,
  factsByNode,
  factsOf,
  type NodeFacts,
} from "../whitespace-runs.js";
import type { BlockWhitespace } from "../whitespace-record.js";

// Whether a text node's FIRST character is a source separator standing
// between it and the previous inline sibling. ASCII only (see
// ASCII_WHITESPACE, issue #75): a no-break space at this position is
// CONTENT glued directly to whatever precedes it, not a join the
// printer may turn into a breakable space or a break.
const LEADS_WITH_ASCII_WHITESPACE = new RegExp(
  `^${ASCII_WHITESPACE.source}`,
  "v",
);

// Whether a text node's LAST character is a source separator standing
// between it and the next inline sibling. Mirrors
// LEADS_WITH_ASCII_WHITESPACE at the trailing edge.
const TRAILS_WITH_ASCII_WHITESPACE = new RegExp(
  `${ASCII_WHITESPACE.source}$`,
  "v",
);

// How a text node OPENS when a list continuation is its first line: a
// `+` and then the line break that ended that line. The reader rstrips
// every line, so nothing else can stand between the two.
const OPENING_CONTINUATION_LINE = "+\n";

/**
 * Whether the node opens with a `+` that stood ALONE on its own source
 * line, which reflow must give an output line of its own back
 * (`keepContinuationLine` in src/print/reflow.ts).
 *
 * Column 1 is what makes "alone" true rather than merely likely. A `+`
 * that opens a text node has a line to itself only when nothing at all
 * precedes it on that line, and the node's own start column is the
 * cheapest statement of that: it excludes an admonition body
 * (`NOTE: +`), a formatting span's content (the opening mark holds
 * column 1), a list item's text (`* +`) and any inline sibling that
 * ended on the same line. In every one of those the `+` sits after a
 * space, where it is a hard line break rather than a continuation, and
 * the ordinary line-end rule is the one that must hold.
 *
 * A node this predicate accepts is always its block's FIRST inline
 * node: a `+` at column 1 always opens a new block, so no preceding
 * sibling can exist to hand it a glue lead. `keepContinuationLine`'s
 * rewrite of the node's own atoms leans on that.
 * @param node - the text node being printed.
 * @returns Whether its first word is a continuation line of its own.
 */
function opensWithContinuationLine(node: TextNode): boolean {
  return (
    node.position.start.column === FIRST_COLUMN &&
    node.value.startsWith(OPENING_CONTINUATION_LINE)
  );
}

/**
 * The join a text node leaves BEHIND it, for the sibling that follows.
 *
 * The continuation-line arm is the cross-node half of
 * `keepContinuationLine` (src/print/reflow.ts), which can only reach
 * the words inside one node. A `+` alone on its source line is the
 * node's ONLY word whenever the line after it opens an inline
 * construct — `+` then `*a*` leaves the text node as just `"+\n"`
 * with the span as the next sibling — and then the join is what
 * decides whether the `+` keeps its line. It is a mandatory break at
 * column 0, the same one a raw line asks for: the `+` and the content
 * after it were both written at column 0, which is where a
 * continuation and the block it attaches have to be.
 * @param node - the text node.
 * @param words - its whitespace-split words, non-empty.
 * @param glueToSibling - whether a trailing `+` must fuse forward.
 * @param tail - what the record left at the node's trailing edge.
 * @param tail.keptRun - the run whose bytes ride inside the last atom
 *   instead of folding, which leaves the printer nothing to write
 *   between the two nodes; empty where they do not ride.
 * @param tail.held - what the record holds against the run, where its
 *   bytes do not ride.
 * @returns the join.
 */
function trailingBoundary(
  node: TextNode,
  words: readonly string[],
  glueToSibling: boolean,
  tail: { readonly keptRun: string; readonly held: HeldJoin },
): Boundary {
  const { keptRun, held } = tail;
  if (keptRun !== "" || !TRAILS_WITH_ASCII_WHITESPACE.test(node.value)) {
    return "glue";
  }
  if (words.length === 1 && opensWithContinuationLine(node)) {
    return "literal";
  }
  if (held !== "none") {
    return HELD_BOUNDARY[held];
  }
  // A trailing `+` with a sibling after it keeps the source's space but
  // forbids the break, so no break can land after the `+` (where ` +`
  // at end of line would become a hard line break).
  return glueToSibling && words.at(-1) === "+" ? "space" : "break";
}

/**
 * Append a text node's atoms.
 *
 * Every whitespace decision here READS the block's record and none
 * re-derives it: the two edge runs and every run between the node's
 * words were given a fact at read time, and this only spells each
 * fact in the atom vocabulary - bytes riding inside an atom for a run
 * whose own bytes are read, a non-breaking join for one whose spelling
 * is, an ordinary breakable space for a free one.
 * @param out - the block's atoms so far (mutated).
 * @param boundary - the join standing in front of this node.
 * @param cursor - where the node sits.
 * @param node - the text node.
 * @returns the join this node leaves behind.
 */
function appendText(
  out: Atom[],
  boundary: Boundary,
  cursor: Cursor,
  node: TextNode,
): Boundary {
  const facts = factsOf(cursor.facts, node);
  const share = lineShareOf(cursor);
  const { words, held } = wordsOfText(node.value, facts, share);
  // All-whitespace text nodes (e.g. " " between adjacent formatting
  // marks, or " " as sole content of a formatting span like `** **`).
  // They contribute no atom, only the break opportunity their
  // whitespace stands for - dropping that would fuse adjacent siblings
  // or collapse content whitespace inside formatting marks.
  if (words.length === 0) {
    return appendWholeRun(out, boundary, node, cursor);
  }
  const cut = cutValue(node.value);
  // A kept edge run rides inside the atom at its end, so the join
  // there stays the glue it already was and the printer writes nothing
  // of its own between the two nodes.
  const front = joinOfFact(facts.leading, cut.leading);
  const back = joinOfFact(facts.trailing, cut.trailing);
  const leading =
    front.rides && ridesOnWhatIsWritten(out, boundary, cursor)
      ? cut.leading
      : "";
  // The lead is computed BEFORE the atoms, because the trailing-`+`
  // policy reads it: a one-word node carrying a glue cannot reach a
  // line boundary, and a `+` that cannot reach one needs no escape.
  const lead =
    leading === "" && LEADS_WITH_ASCII_WHITESPACE.test(node.value)
      ? strongerBoundary(boundary, leadingJoin(cursor, words, front.held))
      : boundary;
  const { escapeTrailingPlus, glueToSibling } = trailingPlusPolicy(
    cursor,
    words,
    lead,
  );
  const trailing = back.rides && ridesOnWhatFollows(cursor) ? cut.trailing : "";
  const atoms = wordsToAtoms(words, {
    escapeTrailingPlus,
    firstLineWordCount: firstSourceLineWordCount(node, cursor, words),
    opensWithContinuationLine: opensWithContinuationLine(node),
    edgeRuns: { leading, trailing },
    held,
  });
  keepBreakBetweenMarks(atoms, node.value, words, share);
  out.push(withBoundary(atoms[0], lead), ...atoms.slice(1));
  return trailingBoundary(node, words, glueToSibling, {
    keptRun: trailing,
    held: back.held,
  });
}

/**
 * The join a text node's LEADING run asks for: what the record holds
 * against it, or the block-syntax net's answer where the record holds
 * nothing.
 * @param cursor - where the node sits.
 * @param words - the node's words.
 * @param held - what the record holds against the leading run.
 * @returns the join.
 */
function leadingJoin(
  cursor: Cursor,
  words: readonly string[],
  held: HeldJoin,
): Boundary {
  return held === "none" ? leadingBoundary() : HELD_BOUNDARY[held];
}

/**
 * Append a formatting span's atoms: the span's content joins the
 * block's ONE flat atom list, with the marks fused onto the first and
 * last atoms so they stay adjacent to their words (required for
 * AsciiDoc constrained formatting) and the packer measures them.
 * @param out - the block's atoms so far (mutated).
 * @param boundary - the join standing in front of the span.
 * @param cursor - where the span sits.
 * @param node - the span node.
 * @returns the join the span leaves behind.
 */
function appendSpan(
  out: Atom[],
  boundary: Boundary,
  cursor: Cursor,
  node: SpanNode,
): Boundary {
  // A monospace ancestor - this node or an outer one - makes every
  // BYTE of the content CONTENT: see Cursor.literalInterior.
  const literalInterior = cursor.literalInterior || node.type === "monospace";
  const { atoms: inner, trailing } = collectAtoms(node.children, {
    blockStartLine: cursor.blockStartLine,
    enclosing: node,
    blockNodes: cursor.blockNodes,
    facts: cursor.facts,
    // Content inside a span opens no block line of its own: the marks
    // around it hold the column whatever the block does.
    blockStart: { atColumnZero: false, markInFront: undefined },
    literalInterior,
  });
  // The span's own whitespace lives INSIDE its marks: content whitespace
  // at either edge is a space in the output, never a break, because the
  // marks fuse onto the content they enclose. Both edges are read off
  // the joins themselves — the first atom carries the join its content
  // asked for, and `trailing` is the join the last one left behind.
  const openSpace = inner.length > 0 && inner[0].glueLeft ? "" : " ";
  const closeSpace = trailing === "glue" ? "" : " ";
  // The two spaces are about the printed ATOMS - what the fusion
  // writes between the mark and the content it fuses onto. `flush` is
  // a different question with a different owner: the constrained rows'
  // content group reads the SOURCE, and the source is the reader's.
  // Neither atom read answers it on its own - a fold turns the
  // source's whitespace into a join and a kept run rides inside the
  // atom's own bytes, so a decision here would need both and would
  // still be a second opinion about what the reader already paired
  // (issue #147 is the run beside a lone `--` that shape lost).
  const marks = marksOf(node);
  const flush =
    marks.open.kind === "entangled" && marks.close.kind === "entangled";
  // The delimiters are ASKED FOR, not chosen here: `spanDelimiters`
  // answers with the source's own spelling or with the one a declared
  // rule licensed (src/print/declared-rules.ts), and this function has
  // no way to write any other bytes into the marks.
  const site: SpanSite = {
    node,
    cursor,
    flush,
    texts: inner.map((atom) => atom.text),
  };
  const { open, close } = spanDelimiters(site).bytes;
  // Children that are all whitespace produce no atoms (`x ** ** y`,
  // where the bold holds only a space). Emit the bare marks around
  // whatever whitespace they stood for. That is one of THREE homes of
  // "a span may not be empty", and none of them subsumes another:
  //
  // - a CONSTRAINED span may not hold whitespace at either edge, and
  //   that is read off the source characters beside the mark, before
  //   any pairing (canOpenAt/canCloseAt, quote-boundaries.ts): `x * *
  //   y` is plain text, never a span;
  // - a span may not hold NOTHING, which the pairing enforces by
  //   skipping an adjacent close (closeForOpen,
  //   src/parse/inline/span-pairing.ts), so `____` never reaches the
  //   printer as a node at all;
  // - and an UNCONSTRAINED span may hold whitespace alone, because
  //   its patterns test no boundary - which is the shape that gets
  //   here, and only here.
  if (inner.length === 0) {
    appendWhitespaceOnlySpan(out, boundary, { open, close, closeSpace });
    return "glue";
  }
  pushSpanAtoms(out, boundary, inner, {
    openText: `${open}${openSpace}`,
    closeText: `${closeSpace}${close}`,
    ...markPlacement(cursor, marks, inner),
  });
  return "glue";
}

/**
 * Append a raw line — a comment, preprocessor or otherwise verbatim line
 * kept inside a paragraph.
 *
 * Such a line must start at column 0 to be one, so the joins around it
 * are LITERAL breaks: they open their line at column 0 whatever the
 * enclosing block's continuation indent is.
 *
 * A break is only demanded where a neighbour exists on that side: the
 * TRAILING one is dropped when nothing follows in this block (the block
 * joiner already supplies that break — demanding one here would open the
 * next block with a blank line), and the LEADING one when the raw line
 * is the block's first node (a paragraph that is one verbatim line —
 * the second of two adjacent `+` lines in a list item — would otherwise
 * open with a blank).
 * @param out - the block's atoms so far (mutated).
 * @param boundary - the join standing in front of the raw line.
 * @param cursor - where the raw line sits.
 * @param node - the raw line node.
 * @returns the join the raw line leaves behind.
 */
function appendRawLine(
  out: Atom[],
  boundary: Boundary,
  cursor: Cursor,
  node: RawLineNode,
): Boundary {
  const lead = cursor.index === 0 ? boundary : "literal";
  out.push({ ...withBoundary(atomOf(node.value), lead), ownsItsLine: true });
  return hasFollowingInlineSibling(cursor) ? "literal" : "glue";
}

/**
 * Append a hard line break (` +` at end of a line).
 *
 * The break it forces is LITERAL, so the line after it starts at column
 * 0 regardless of the block's continuation indent — a list item's text
 * indent must not reach the line Asciidoctor reads after the `<br>`.
 *
 * A ` +` the source put alone on its line keeps that line.
 * Asciidoctor's `LineBreakRx` captures everything before the space
 * (`^(.*)[ \t]\+$`), so ` +` alone renders `<br>` with the
 * preceding line's text AND its newline intact, while `text +`
 * renders `text<br>` — joining the two lines would drop a space from
 * the rendered output. The trailing break is demanded only when an
 * inline sibling follows in the same block.
 * @param out - the block's atoms so far (mutated).
 * @param boundary - the join standing in front of the break.
 * @param cursor - where the break sits.
 * @returns the join the break leaves behind.
 */
function appendHardLineBreak(
  out: Atom[],
  boundary: Boundary,
  cursor: Cursor,
): Boundary {
  const lead = hardBreakOwnsItsLine(cursor.siblings, cursor.index)
    ? "literal"
    : boundary;
  out.push(withBoundary(atomOf(HARD_BREAK_IMAGE), lead));
  return hasFollowingInlineSibling(cursor) ? "literal" : "glue";
}

/**
 * Append one inline node's atoms to the block's list.
 * @param out - the block's atoms so far (mutated).
 * @param boundary - the join standing in front of this node.
 * @param cursor - where the node sits.
 * @returns the join this node leaves behind.
 */
function appendNode(out: Atom[], boundary: Boundary, cursor: Cursor): Boundary {
  const node = cursor.siblings[cursor.index];
  switch (node.type) {
    case "text": {
      return cursor.literalInterior
        ? appendLiteralText(out, boundary, cursor, node)
        : appendText(out, boundary, cursor, node);
    }
    case "bold":
    case "italic":
    case "monospace":
    case "highlight":
    case "curvedQuote":
    case "superscript":
    case "subscript": {
      return appendSpan(out, boundary, cursor, node);
    }
    case "rawLine": {
      return appendRawLine(out, boundary, cursor, node);
    }
    case "hardLineBreak": {
      return appendHardLineBreak(out, boundary, cursor);
    }
    default: {
      // A construct that would open a block at column 0 keeps its
      // breakable join: what the line the packer opens with it reads
      // as is the reader's question about the finished layout, and a
      // layout it refuses writes the block's own source lines back.
      out.push(withBoundary(atomOf(verbatimText(node)), boundary));
      return "glue";
    }
  }
}

/** The block-level facts every cursor of one run shares. */
interface RunContext {
  /** 1-based source line the enclosing BLOCK starts on. */
  readonly blockStartLine: number;
  /**
   * The span this run is the content of, when it is one: the printer
   * needs the NODE and not just the fact, because what stands beside a
   * span at the edge of its parent is the parent's delimiter as the
   * child's row reads it (span-edges.ts). `undefined` at block level.
   */
  readonly enclosing: SpanNode | undefined;
  /**
   * The block's top-level inline children. A constrained spelling
   * exposes its marks to a pass that scans the whole LINE, so the
   * stray-mark question is about the block and not about the span's
   * siblings - see `constrainedIsLegal` (src/print/declared-rules.ts).
   */
  readonly blockNodes: readonly InlineNode[];
  /** Where the block's first atom lands (block-start-hazard.ts). */
  readonly blockStart: BlockStart;
  /** See {@link Cursor.literalInterior}; carried into every cursor the run builds. */
  readonly literalInterior: boolean;
  /** The block's whitespace record, indexed by node (see {@link Cursor.facts}). */
  readonly facts: ReadonlyMap<TextNode, NodeFacts>;
}

/**
 * Build the atoms for a run of inline siblings.
 * @param nodes - the inline siblings, in order.
 * @param context - the block facts the run's cursors share: source
 *   start line (for the dlist first-line guard), the enclosing span
 *   and the block's own children (for the stray-mark scan), and
 *   whether the first atom opens its line at column 0.
 * @returns the atoms, in order, and the join the last one leaves behind.
 */
function collectAtoms(
  nodes: readonly InlineNode[],
  context: RunContext,
): { atoms: Atom[]; trailing: Boundary } {
  const out: Atom[] = [];
  let boundary: Boundary = "glue";
  for (const index of nodes.keys()) {
    boundary = appendNode(out, boundary, {
      siblings: nodes,
      index,
      ...context,
    });
  }
  return { atoms: out, trailing: boundary };
}

/**
 * Convert a block's inline content to atoms.
 * @param nodes - the block's inline children, in order.
 * @param whitespace - the record the reader put on the block: what
 *   each of its whitespace runs may be respelled as
 *   ({@link BlockWhitespace}, src/whitespace-record.ts).
 * @param blockStartLine - 1-based source line the block starts on.
 * @param blockStart - where the block's first atom lands
 *   (block-start-hazard.ts).
 * @returns the block's atoms, ready for `wrap` (src/print/reflow.ts).
 */
export function inlineAtoms(
  nodes: readonly InlineNode[],
  whitespace: BlockWhitespace,
  blockStartLine: number,
  blockStart: BlockStart,
): Atom[] {
  const { atoms } = collectAtoms(nodes, {
    blockStartLine,
    enclosing: undefined,
    blockNodes: nodes,
    blockStart,
    literalInterior: false,
    facts: factsByNode(nodes, whitespace),
  });
  return atoms;
}
