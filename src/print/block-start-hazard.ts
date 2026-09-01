/**
 * The BLOCK-START HAZARD NET: the two questions the printer asks
 * before an atom is allowed to open a block's first output line.
 *
 * Reflow packs a block's inline content into lines, and the line it
 * packs is read back by the same classifier that read the source. At
 * column 0 that reading is not free: `*`, `----`, `.Title`, `[[anc]]`
 * and their kin are BLOCK syntax there, so a join reflow is otherwise
 * free to make (a space where the source had a line break) can change
 * what the document IS. The net's answer is always the same trade -
 * keep the source's break instead of the space - and it is only ever
 * taken where the author wrote that break.
 *
 * Two entry points, one rule, because two paths build the block's
 * first atom: {@link hazardAtBlockStart} asks about the atom a
 * formatting span's opening mark would compose, before the span
 * fuses; {@link keepBlockStartBreak} asks about the finished atom
 * list, whatever node built it, so the plain-TEXT path is covered by
 * the same net.
 */
import type { InlineNode } from "../ast.js";
import {
  ASCII_HORIZONTAL_WHITESPACE,
  ASCII_NON_WHITESPACE,
  ASCII_WHITESPACE,
} from "../parse/line-shapes.js";
import { type Atom, isBlockSyntaxAtLineStart } from "./reflow.js";

/**
 * Where a node sits, as far as the net reads it. The printer's
 * `Cursor` (src/print/inline.ts) extends this with the block's source
 * start line, which the net does not read.
 */
export interface BlockStartCursor {
  /** The inline siblings the node sits among. */
  readonly siblings: readonly InlineNode[];
  /** The node's index among them. */
  readonly index: number;
  /**
   * The span this node is the content of, when it is one - only
   * whether it is undefined is read here; the printer's own `Cursor`
   * (src/print/inline.ts) narrows the type to its five span kinds for
   * the questions this net does not ask.
   */
  readonly enclosing: InlineNode | undefined;
  /**
   * Whether the block's FIRST atom opens its output line at column 0.
   * True for a paragraph, whose first line is its own; false where a
   * prefix the printer writes holds the column - a list item's marker,
   * an admonition's `NOTE: ` label. The block-start hazard net reads
   * it on both paths ({@link hazardAtBlockStart} for a span's
   * composed atom, {@link keepBlockStartBreak} for the finished
   * list): only an atom that actually lands at column 0 can be
   * re-read as block syntax there.
   */
  readonly blockAtColumnZero: boolean;
}

/**
 * Whether fusing a span's opening mark onto its first content atom
 * would put BLOCK SYNTAX at column 0.
 *
 * A span whose content begins with whitespace (a source break or
 * space against the opening mark) fuses to an atom like `** b` - and
 * at the head of a paragraph that atom opens the output's first line,
 * where the reader sees a ulist marker: `**\nb** c` replayed as
 * `** b** c` re-reads as a LIST, a measured corruption. Only the
 * block's first atom can land there (wrap never moves it), so the net
 * asks four things: first inline node of its block, the block's
 * content opens at column 0, the content opens after a SOURCE BREAK
 * ({@link contentOpensAfterBreak}), and the composed atom answers yes
 * to the SAME line-shapes questions the reader asks
 * ({@link isBlockSyntaxAtLineStart}). Where it fires, the span keeps
 * the SOURCE's break instead of the space: the open mark stands
 * alone on the first line and the content opens the next at column 0
 * - the one deliberate exception to replaying an in-span break as a
 * space, because here the space spelling changes the line's block
 * classification.
 * @param cursor - where the span sits.
 * @param composed - the atom text the fusion would produce.
 * @returns true when the net must keep the source's break.
 */
export function hazardAtBlockStart(
  cursor: BlockStartCursor,
  composed: string,
): boolean {
  return (
    cursor.index === 0 &&
    cursor.enclosing === undefined &&
    cursor.blockAtColumnZero &&
    contentOpensAfterBreak(cursor.siblings[0]) &&
    isBlockSyntaxAtLineStart(composed)
  );
}

// The whitespace a span's content opens with, reaching the next
// SOURCE LINE: everything up to the first newline is horizontal. ASCII
// only (ASCII_HORIZONTAL_WHITESPACE, issue #75): a no-break space here
// is content the span holds, not whitespace the source break replaced.
const OPENS_AFTER_BREAK = new RegExp(
  `^${ASCII_HORIZONTAL_WHITESPACE.source}*\n`,
  "v",
);

/**
 * Whether a span's content opens on the line AFTER its opening mark.
 *
 * The block-start hazard net trades the replayed space for a break,
 * and it may only do that where the author wrote one: a span the
 * source spells on ONE line (`## b## c`, which the classifier still
 * reads as a paragraph - issue #63) must be printed back as it
 * stands. Breaking it there would invent a line the source never
 * had and destroy a heading the oracle does read.
 * @param node - the block's first inline node, the span in question.
 * @returns true when the content's leading whitespace holds a
 *   newline.
 */
function contentOpensAfterBreak(node: InlineNode): boolean {
  if (!("children" in node)) return false;
  const [first] = node.children;
  return first.type === "text" && OPENS_AFTER_BREAK.test(first.value);
}

/**
 * The block-start hazard net on the block's FIRST ATOM, whatever
 * node built it - the question {@link hazardAtBlockStart} asks of a
 * span's composed opening atom, asked once over the finished list so
 * the plain-TEXT path is covered by the same net.
 *
 * `wordsToAtoms` (src/print/reflow.ts) protects a block-syntax word
 * by fusing it BACKWARDS onto its predecessor, which the block's
 * first word has not got - its probe is disabled there by
 * `index > 0`. The protection here is the other one: the break
 * BEHIND the first atom is kept, so the atom stays alone on its
 * line. `*\nb* c` reflowed to `* b* c` re-reads as a LIST, a
 * measured corruption; kept broken it is the source's own two lines,
 * and a mark alone on a line is no marker (`UnorderedListRx` needs
 * whitespace and text after it).
 *
 * The question is asked of the LINE the two atoms would make, not of
 * the first atom alone, because the first atom alone is a different
 * line: `[[anc]] x para` is ordinary text, while the `[[anc]]` this
 * net would strand on its own line is block metadata. Only a hazard
 * the packed line actually carries may be traded for a break.
 *
 * And only where the author wrote the break this keeps
 * ({@link opensWithSourceBreak}): a block whose first source line
 * already reads `# Title` must be printed back as it stands, because
 * the oracle reads a heading there that the classifier does not
 * (issue #63) - breaking a line the source never had would destroy
 * it.
 *
 * The break is kept only where one may land: an atom GLUED to the
 * first (no space between them at all) is one the packer may not
 * break from, an atom that may not end a line has to keep its
 * successor, and an atom already demanding a break needs nothing - a
 * span whose own net fired arrives that way, so the two nets cannot
 * fight.
 *
 * `noBreakBefore` is NOT such a bail, and that is the one asymmetry
 * here. It marks a word `wordsToAtoms` fused backwards because the
 * word would be block syntax at a line start - which is the very
 * shape that makes the packed line dangerous, so bailing on it would
 * disarm the net exactly where it is needed (`.` then `b. c` packs to
 * `. b. c`, an ordered list item the source never had). The two rules
 * do not actually disagree: the backward fuse guards a word reflow
 * would MOVE to a line start, and the break this keeps is one the
 * AUTHOR wrote ({@link opensWithSourceBreak}), so the word lands back
 * on the source line it already opened. Firing therefore clears the
 * fuse, because a `noBreakBefore` left standing beside a demanded
 * break is two atoms giving the packer opposite orders.
 * @param atoms - the block's atoms (mutated).
 * @param nodes - the block's inline children, for the source break.
 */
export function keepBlockStartBreak(
  atoms: Atom[],
  nodes: readonly InlineNode[],
): void {
  const second = atoms.at(1);
  if (second === undefined) {
    return;
  }
  // Grouped by which atom each fact is about: the three that would
  // stop a break landing in front of `second`, then the one about
  // `atoms[0]` (a `+` that may not end a line), then the two about
  // the pair. `atoms[0]` is indexed directly because the guard above
  // already proved a second atom exists.
  if (
    second.glueLeft ||
    second.noBreakAfter ||
    second.breakBefore !== "none" ||
    atoms[0].noBreakAfter ||
    !opensWithSourceBreak(nodes) ||
    !isBlockSyntaxAtLineStart(`${atoms[0].text} ${second.text}`)
  ) {
    return;
  }
  atoms[1] = { ...second, breakBefore: "literal", noBreakBefore: false };
}

// A source line break BEHIND a text node's first word: the word, then
// a whitespace run that reaches the next line. ASCII only (issue #75):
// with JavaScript's wider `\s`, a no-break space inside the first word
// would end `\S+` early and read as the whitespace run instead - the
// word "ends" mid-word where Ruby's `\s` sees plain content.
const FIRST_WORD_THEN_BREAK = new RegExp(
  `^${ASCII_WHITESPACE.source}*${ASCII_NON_WHITESPACE.source}+${ASCII_HORIZONTAL_WHITESPACE.source}*\n`,
  "v",
);

/**
 * Whether a source line break stands behind the block's first word.
 *
 * A text node answers from its own bytes. So does a CHARACTER
 * REFERENCE, and that arm exists to keep this net's reach exactly what
 * it was before the reference vocabulary landed: `...` used to be the
 * first WORD of the block's first text node, where the net read it,
 * and issue #14 moved those same three bytes into a node of their own
 * without changing anything about the line they make. Without the arm,
 * `...` then `b c` packs to `... b c` - an ordered list item the
 * source never had. A reference is one whitespace-free atom
 * (replacements.ts), so the break behind it is the NEXT sibling's own
 * leading whitespace, which is where this reads it - and only there: a
 * next sibling that is not a text node is answered NO, because a break
 * this cannot see in a node's own bytes is one it may not trade for.
 * Nothing reaches that arm today (a reference is whitespace-free, so a
 * following construct is glued to it and offers no packing space at
 * all, and a real source break arrives as a leading-newline text node),
 * which is why it is stated here rather than pinned by a row.
 *
 * No other node kind answers yes: one the printer writes verbatim
 * (verbatimText, src/print/inline.ts) is an atom whose join to the
 * next node this cannot see, and a span answers through its own net
 * ({@link contentOpensAfterBreak}). No is the conservative answer - it
 * leaves the packed line exactly as it was.
 * @param nodes - the block's inline children, in order.
 * @returns true when the block's first word ends a source line.
 */
function opensWithSourceBreak(nodes: readonly InlineNode[]): boolean {
  const [node] = nodes;
  if (node.type === "text") return FIRST_WORD_THEN_BREAK.test(node.value);
  if (node.type !== "characterReference") return false;
  const next = nodes.at(1);
  return next?.type === "text" && OPENS_AFTER_BREAK.test(next.value);
}
