/**
 * The BLOCK-START HAZARD NET: the question the printer asks before an
 * atom list is allowed to open a block's first output line.
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
 * Where the author wrote it is not read off the printed fragments
 * here: it is the reader's recorded answer, `firstWordEndsItsLine`
 * (src/ast.ts), travelling on {@link BlockStart}. The fragments can
 * only ever answer for the node that happens to hold the break's own
 * bytes, and a break INSIDE an inline span belongs to no such node -
 * `**` then `*b* c` is one bold span whose content is `*\n*b`, which
 * is why the question is asked of the source line instead.
 *
 * ONE question, asked once over the finished atom list
 * ({@link keepBlockStartBreak}), so the plain-TEXT path and the span
 * path are covered by the same net. A span's opening MARK would
 * otherwise be invisible to it - the mark fuses onto the content atom
 * beside it, and the fused atom carries a space where the source had
 * the break, which is not a line the net may strand. So the span hands
 * the net the pieces instead: {@link openMarkStandsApart} keeps the
 * mark as its OWN atom, joined to the content over a space that packs
 * exactly as the fusion did, wherever the recorded fact says the
 * author's line ended right there. The net then trades that space for
 * the break, or leaves it alone, from the one place that can see the
 * whole line.
 */
import { ASCII_WHITESPACE } from "../parse/line-shapes.js";
import { type Atom, isBlockSyntaxAtLineStart } from "./reflow.js";

/**
 * Where a block's first atom lands, and - only where that is column 0
 * - what the source line under it looked like.
 *
 * The two facts are ONE value because the second is a question only
 * the first makes answerable: a block whose first atom follows a
 * printed prefix (a list item's marker, an admonition's `NOTE: `
 * label) can put no block syntax at column 0 at all, so no source line
 * of it is ever traded for a break.
 */
export type BlockStart =
  | {
      /** A prefix the printer writes holds the column. */
      readonly atColumnZero: false;
    }
  | {
      /** The block's first atom opens its output line at column 0. */
      readonly atColumnZero: true;
      /**
       * The block's first source line ends after its first word -
       * `ParagraphNode.firstWordEndsItsLine` (src/ast.ts), as the
       * reader recorded it.
       */
      readonly firstWordEndsItsLine: boolean;
    };

/**
 * Where a node sits, as far as the net reads it - TWO facts, which is
 * all the net reads. The printer's `Cursor` (src/print/inline.ts)
 * extends this with the siblings, the enclosing span and the block's
 * source start line, none of which the net asks about.
 */
export interface BlockStartCursor {
  /** The node's index among its inline siblings. */
  readonly index: number;
  /**
   * Where the block's FIRST atom lands and what stood on its source
   * line. Only an atom that actually lands at column 0 can be re-read
   * as block syntax there, so both {@link openMarkStandsApart} and
   * {@link keepBlockStartBreak} start from this.
   */
  readonly blockStart: BlockStart;
}

/**
 * Whether a span's opening mark must stay its OWN atom instead of
 * fusing onto the content atom beside it.
 *
 * A span whose content begins with whitespace (a source break or a
 * space against the opening mark) would otherwise fuse to an atom like
 * `** b`, and at the head of a paragraph that atom opens the output's
 * first line, where the reader sees a ulist marker: `**\nb** c`
 * replayed as `** b** c` re-reads as a LIST, a measured corruption.
 * Putting the source's break back means printing the mark alone on the
 * first line - and no fused atom can be cut there afterwards, because
 * nothing in the atom says which of its spaces the source wrote. So the
 * cut is made HERE, while the mark and the content are still two
 * things, and the two atoms are joined over the same space the fusion
 * would have written: identical bytes, identical packing, one atom
 * boundary the net can trade for a break.
 *
 * Which is why this asks nothing about block SYNTAX. The whole-line
 * question belongs to {@link keepBlockStartBreak}, which is the only
 * place that can see the line the atoms pack into; this one answers
 * only "is the space between these two atoms a break the author
 * wrote", which is exactly three facts: first node of the run it is
 * asked about, the block's content opens at column 0 on a source line
 * its first word ended, and the fusion's space is whitespace the SOURCE
 * had (`fusesOverSpace`).
 *
 * A span's own CONTENT is refused by the column-0 fact, not by a
 * second test here: content inside a span is collected with
 * `blockStart: { atColumnZero: false }` (src/print/inline.ts's
 * `appendSpan`), because the marks around it hold the column. That
 * one claim covers all three prefixes the printer writes - a list
 * marker, a `NOTE: ` label and a span's marks - so the net needs no
 * span-shaped guard of its own. Removing BOTH is what breaks:
 * `w` / `*##` / `b c##* d` then keeps a break at an INNER span's
 * mark, and the output no longer answers `firstWordEndsItsLine`, so
 * a second pass walks it back (pinned in
 * tests/format/inline-span-break.test.ts).
 *
 * `fusesOverSpace` is what makes the recorded fact the RIGHT fact for
 * this path. Standing the mark apart puts it alone on the first line
 * if the net fires, so it may only be done where the mark is the whole
 * word that line ended with; the mark is that word exactly when the
 * content behind it opened with whitespace, since anything else it
 * opened with would be more of the same word (`**` then `*b* c` is the
 * mark `*` and a content `*` the author wrote against it - there the
 * block's first ATOM is the word already, and no cut is needed).
 * @param cursor - where the span sits.
 * @param fusesOverSpace - whether the fusion writes a space between
 *   the mark and the content, standing for whitespace the span's
 *   content began with.
 * @returns true when the mark stays a separate atom.
 */
export function openMarkStandsApart(
  cursor: BlockStartCursor,
  fusesOverSpace: boolean,
): boolean {
  return (
    cursor.index === 0 &&
    cursor.blockStart.atColumnZero &&
    cursor.blockStart.firstWordEndsItsLine &&
    fusesOverSpace
  );
}

/**
 * Whether the line the block's atoms pack into re-reads as BLOCK
 * SYNTAX.
 *
 * TWO lines are asked about. The PAIR - `atoms[0]` and its successor -
 * answers for the shapes decided by their HEAD, and it answers for the
 * longer lines too, because {@link isBlockSyntaxAtLineStart} asks its
 * own question twice, once of the head it is given and once of that
 * head with a word after it. What the pair cannot answer for is a
 * shape anchored at BOTH ends: `BLOCK_ATTRIBUTE_LINE`
 * (src/parse/line-shapes.ts) needs a `[` at the head AND a `]` at the
 * end, so the `]` deciding it can live any number of atoms further
 * along. The WHOLE join answers for those, and it is the line the
 * packer writes whenever the block's content fits on one.
 *
 * The witness is issue #96's `[.role]##` then `b## c]`: a highlight
 * span's role prefix (`spanMarks`, src/print/span-edges.ts) puts the
 * `[` at the head, `[.role]## b##` is no block shape, and
 * `[.role]## b## c]` is a block attribute line - so the paragraph
 * packed into block METADATA and rendered EMPTY.
 *
 * KNOWN GAP, stated because it is easy to read this as total: a WRAP
 * can also end the first line at a `]`, and neither line asked about
 * here is that one. It is not this net's to close - every line of a
 * packed block opens at column 0, so a wrap-created tail is the same
 * hazard on line five as on line one, and `wordsToAtoms`
 * (src/print/reflow.ts) guards line STARTS only.
 * @param atoms - the block's atoms, at least two.
 * @returns true when the packed line reads as block syntax.
 */
function packsIntoBlockSyntax(atoms: readonly Atom[]): boolean {
  // Spelled with a space because the caller has already refused a
  // successor glued to `atoms[0]`: these two atoms make this line.
  const pair = `${atoms[0].text} ${atoms[1].text}`;
  let line = pair;
  for (let index = 2; index < atoms.length; index += 1) {
    const atom = atoms[index];
    // The packer must end its line at a demanded break, so nothing
    // past one joins the line asked about here.
    if (atom.breakBefore !== "none") {
      break;
    }
    line += atom.glueLeft ? atom.text : ` ${atom.text}`;
  }
  return (
    isBlockSyntaxAtLineStart(pair) ||
    (line !== pair && isBlockSyntaxAtLineStart(line))
  );
}

/**
 * The block-start hazard net on the block's FIRST ATOM, whatever node
 * built it - asked once over the finished list, so the plain-TEXT path
 * and the span path are covered by the same net.
 *
 * `wordsToAtoms` (src/print/reflow.ts) protects a block-syntax word
 * by fusing it BACKWARDS onto its predecessor, which the block's
 * first word has not got - its probe is disabled there by
 * `index > 0`. The protection here is the other one: the break
 * BEHIND the first atom is kept, so the atom stays alone on its
 * line. `*\nb* c` reflowed to `* b* c` re-reads as a LIST, a
 * measured corruption; kept broken it is the source's own two lines,
 * and a mark alone on a line is no marker: `UnorderedListRx` is
 * `/^[ \t]*(-|\*\**|\u2022)[ \t]+(#{CC_ANY}*)$/` (rx.rb l.284), so the
 * marker needs whitespace AND text after it, and its ordered and
 * callout siblings are built the same way. THIS is why putting the
 * source's line back is safe where the block's first source line held
 * one word, and would invent a line where it did not - the argument
 * `ParagraphNode.firstWordEndsItsLine` (src/ast.ts) and
 * `isSingleWordLine` (src/parse/line-shapes.ts) both defer to.
 *
 * The question is asked of the LINE the atoms pack into, never of the
 * first atom alone, because the first atom alone is a different line:
 * `[[anc]] x para` is ordinary text, while the `[[anc]]` this net would
 * strand on its own line is block metadata. Only a hazard the packed
 * line actually carries may be traded for a break
 * ({@link packsIntoBlockSyntax}, which reads the pair AND the whole
 * join, because not every shape is decided by its head).
 *
 * CALLED ONLY where the author wrote the break this keeps - the
 * caller's own guard, `firstWordEndsItsLine` on a block that opens at
 * column 0 (src/print/inline.ts) - because a block whose first source
 * line already reads `# Title` must be printed back as it stands: the
 * oracle reads a heading there that the classifier does not (issue
 * #63), and breaking a line the source never had would destroy it.
 *
 * The trade rebuilds that line as `atoms[0]` ALONE, so it is only
 * legitimate where `atoms[0]` IS the block's first source line - and
 * the recorded fact says that line holds one WORD, which is
 * whitespace-free. Hence the interior-whitespace test below: an atom
 * carrying whitespace fused ACROSS a break somewhere (the space IS
 * what the newline became), so stranding it would put a line the
 * author never wrote at column 0, which is the one thing this module
 * promises not to do. A span's opening mark is the case where the
 * break is worth keeping anyway, and it never reaches here fused:
 * {@link openMarkStandsApart} left it as its own atom precisely so
 * this test would pass.
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
 * AUTHOR wrote, so the word lands back on the source line it already
 * opened. Firing therefore clears the fuse, because a `noBreakBefore`
 * left standing beside a demanded break is two atoms giving the
 * packer opposite orders.
 * @param atoms - the block's atoms (mutated).
 */
export function keepBlockStartBreak(atoms: Atom[]): void {
  const second = atoms.at(1);
  if (second === undefined) {
    return;
  }
  // Grouped by which atom each fact is about: the three that would
  // stop a break landing in front of `second`, then the two about
  // `atoms[0]` (a `+` that may not end a line, and the whitespace that
  // proves the atom is not the block's one-word first line), then the
  // one about the line. `atoms[0]` is indexed directly because the
  // guard above already proved a second atom exists.
  if (
    second.glueLeft ||
    second.noBreakAfter ||
    second.breakBefore !== "none" ||
    atoms[0].noBreakAfter ||
    // ASCII whitespace only (issue #75): a no-break space is content
    // the atom holds, not a run a source line break stood for.
    ASCII_WHITESPACE.test(atoms[0].text) ||
    !packsIntoBlockSyntax(atoms)
  ) {
    return;
  }
  atoms[1] = { ...second, breakBefore: "literal", noBreakBefore: false };
}
