/**
 * The block-body engine: one flat ATOM list per block, one greedy
 * packer, one column budget.
 *
 * A block's inline content becomes a list of {@link Atom}s — newline-free
 * text units, each carrying the LOCAL facts about the break in front of
 * it — and {@link wrap} packs them into the block's finished output
 * lines. Break decisions live where the atoms are built, because a break
 * exists only BETWEEN atoms: a fused run has no slot for one, so there is
 * nothing to record as a marker and nothing to resolve later.
 *
 * Two safety concerns shape atom construction:
 *
 * 1. **Block-syntax safety** (`wordsToAtoms`): prevents the packer from
 *    placing words where AsciiDoc would re-parse them as block syntax —
 *    at column 0 (delimiters, list markers, block attribute lines and
 *    anchors, admonition labels, block macros, breaks, and the comment
 *    and preprocessor lines the reader would eat), or on the block's
 *    first line (a `term::` description-list separator). This file owns
 *    no patterns of its own: every shape it asks about comes from the
 *    registry in src/parse/line-shapes.ts, the same one the BlockReader
 *    classifies lines with, so the two can never disagree about what
 *    ends a paragraph.
 *
 * 2. **Fusing** (`glueLeft` / `noBreakBefore` / `noBreakAfter`): inline
 *    formatting nodes contribute atoms to the same flat list as the text
 *    around them, and the marks that open and close a span ride ON the
 *    atoms they touch. A description-list hazard word inside a span is
 *    therefore an ordinary atom inside a fused run, and the run — not
 *    the word — is what the break lands in front of. That invariant
 *    holds by construction: **the break lands before the fused run
 *    containing the hazard word, never inside the run**, because
 *    {@link wrap} measures and places whole runs. Breaking inside would
 *    insert whitespace the source did not have, changing the rendered
 *    text.
 */
import { doc, util, type Doc } from "prettier";
import {
  ASCII_WHITESPACE,
  DLIST_SEPARATOR_WORD,
  interruptsByLineShape,
  isRawParagraphLine,
  LINE_COMMENT_HEAD,
  startsSectionTitle,
} from "../parse/line-shapes.js";

// The `+` quantified form of ASCII_WHITESPACE, for splitting a run of
// source whitespace rather than testing one character of it.
const ASCII_WHITESPACE_RUN = new RegExp(`${ASCII_WHITESPACE.source}+`, "v");

const {
  builders: { hardline },
} = doc;

// ── The atom model ─────────────────────────────────────────

/**
 * The break in front of an atom.
 *
 * `"hard"` and `"literal"` differ only inside an indented block: a
 * literal break opens a line at COLUMN 0 (a raw line must start there to
 * be one, and Asciidoctor's `LineBreakRx` reads the line after a ` +`
 * from column 0 as well), while a hard break opens a line at the
 * block's continuation indent.
 */
export type BreakBefore = "none" | "hard" | "literal";

/**
 * One atom of a block's inline content: a newline-free text unit plus
 * the LOCAL break facts about the join in front of it. Break decisions
 * live where atoms are built — there is no slot for a break inside a
 * fused run, because breaks exist only between atoms and the flags ride
 * the atom.
 */
export interface Atom {
  /** The atom's text. */
  readonly text: string;
  /** Fuses onto the previous atom (no break, no space, before it). */
  readonly glueLeft: boolean;
  /** A space, never a break, separates this atom from the previous. */
  readonly noBreakBefore: boolean;
  /** The previous atom may not end a line (dangling `+` etc.). */
  readonly noBreakAfter: boolean;
  /**
   * A line break before this atom is mandatory (raw lines, hard line
   * breaks, the dlist first-line guard, keepTextOnFirstRestLine's kept break).
   */
  readonly breakBefore: BreakBefore;
}

/**
 * An atom carrying `text` and no joins — the neutral construction every
 * caller starts from, so the five fields are spelled in ONE place and a
 * new field cannot be forgotten at a call site.
 * @param text - the atom's text.
 * @returns the atom, joins unset.
 */
export function atomOf(text: string): Atom {
  return {
    text,
    glueLeft: false,
    noBreakBefore: false,
    noBreakAfter: false,
    breakBefore: "none",
  };
}

/** An unbreakable run of atoms, measured and placed as one unit. */
interface Run {
  /** Index of the run's first atom. */
  readonly start: number;
  /** Index one past the run's last atom. */
  readonly end: number;
  /** The run's joined text, spaces included. */
  readonly text: string;
  /** The break the run demands ({@link runBreak}). */
  readonly breakBefore: BreakBefore;
}

/**
 * Measure the unbreakable run that starts at `start`: atoms fuse
 * forwards while any of the three glue facts holds, and a break demanded
 * anywhere inside the run is lifted to the front of it.
 * @param atoms - the block's atoms.
 * @param start - index of the run's first atom.
 * @returns the run.
 */
function runAt(atoms: readonly Atom[], start: number): Run {
  let { text } = atoms[start];
  let end = start + 1;
  while (
    end < atoms.length &&
    (atoms[end].glueLeft ||
      atoms[end].noBreakBefore ||
      atoms[end - 1].noBreakAfter)
  ) {
    text += atoms[end].glueLeft ? atoms[end].text : ` ${atoms[end].text}`;
    end += 1;
  }
  return { start, end, text, breakBefore: runBreak(atoms, start, end) };
}

/**
 * The break a run demands: the first one any of its atoms asks for. A
 * demand from a FUSED atom still lands in front of the whole run — that
 * is the invariant the module comment states.
 * @param atoms - the block's atoms.
 * @param start - index of the run's first atom.
 * @param end - index one past the run's last atom.
 * @returns the break in front of the run.
 */
function runBreak(
  atoms: readonly Atom[],
  start: number,
  end: number,
): BreakBefore {
  for (let index = start; index < end; index += 1) {
    if (atoms[index].breakBefore !== "none") {
      return atoms[index].breakBefore;
    }
  }
  return "none";
}

/**
 * Greedy line packer: atoms join with single spaces up to `width`
 * columns; a fused run is measured whole before the break decision, so a
 * run longer than the width overruns on its own line rather than being
 * broken — established behavior, not a bug: there is no spelling of a
 * split that AsciiDoc reads back as the same construct. Continuation
 * lines carry `indent` spaces, except a line opened by a literal break,
 * which starts at column 0.
 *
 * A WIDTH break is refused where the run it would start is block
 * syntax at column 0 ({@link isBlockSyntaxAtLineStart}); the run
 * overruns the current line instead. {@link wordsToAtoms} fuses such a
 * word backwards while the atoms are being built, but only WITHIN one
 * text node: a run the packer FUSES out of several nodes
 * (`[` + an address atom + `]`, which no single node ever holds as one
 * word) reaches this loop unprotected, and a break in front of it
 * writes a block attribute line where the source had prose.
 *
 * A DEMANDED break still stands, and three of the four sources of one
 * - a raw line, a hard line break, and the dlist first-line guard -
 * are the AUTHOR's own line boundary, which the packer may not move
 * whatever stands behind it. The fourth,
 * {@link keepTextOnFirstRestLine}'s kept break, is not exempt from the
 * hazard above: it weighs it itself. It lands in front of some run
 * past the block's first, and where the line that run would open is
 * COLUMN 0 it asks this same question of the run and walks left until
 * a run answers no - so a fused run reaching that line is refused
 * there rather than written. A kept break that opens its line at the
 * block's continuation indent asks nothing, because at a non-zero
 * column none of these shapes is read.
 *
 * Width is COLUMNS, not characters: `getStringWidth` is Prettier's own
 * measure, so a full-width CJK character costs two and a combining mark
 * costs none — the same accounting every other Prettier printer wraps
 * by.
 * @param atoms - the block's atoms in order.
 * @param width - the column budget for a whole output line.
 * @param indent - columns the block's continuation lines are indented
 *   by; the FIRST line is returned without it, because its caller writes
 *   whatever occupies those columns (a list marker) itself.
 * @returns the finished lines, indentation included.
 * Exported for its unit test (tests/print/reflow.test.ts); no src
 * consumer.
 * @internal
 */
export function wrap(
  atoms: readonly Atom[],
  width: number,
  indent: number,
): string[] {
  const lines: string[] = [];
  let line = "";
  let lineIndent = indent;
  const flush = (): void => {
    lines.push(lines.length === 0 ? line : " ".repeat(lineIndent) + line);
  };
  for (let index = 0; index < atoms.length; ) {
    const run = runAt(atoms, index);
    const fits =
      lineIndent +
        util.getStringWidth(line) +
        1 +
        util.getStringWidth(run.text) <=
      width;
    const widthBreak = !fits && !isBlockSyntaxAtLineStart(run.text);
    if (line !== "" && (run.breakBefore !== "none" || widthBreak)) {
      flush();
      lineIndent = run.breakBefore === "literal" ? 0 : indent;
      line = run.text;
    } else {
      line = line === "" ? run.text : `${line} ${run.text}`;
    }
    index = run.end;
  }
  if (line !== "") {
    flush();
  }
  return lines;
}

// ── Word splitting ─────────────────────────────────────────

/**
 * Split raw block text into the words wordsToAtoms expects: non-empty
 * and whitespace-free (by the ASCII definition below). Shared so every
 * caller - the text case and the first-source-line counting that feeds
 * the dlist guard - agrees on what a word is; a mismatch would misplace
 * the guard by a word.
 *
 * Splits on {@link ASCII_WHITESPACE} - Ruby's `\s`, `[ \t\r\n\f\v]` -
 * not JavaScript's wider `\s`, which also takes a no-break space, every
 * Unicode space separator, the line/paragraph separators and a
 * byte-order mark. Asciidoctor never treats any of those as a word
 * separator (`Reader#rstrip`'s own strip set is the same six
 * characters; see ASCII_WHITESPACE's citation), so a word containing
 * one is ONE word here too, and the character rides inside the atom's
 * text instead of being read as a break and rewritten to a plain space
 * by {@link wrap}'s join. Issue #75.
 * @param value - Raw source text, or a prefix of it.
 * @returns The non-empty whitespace-delimited words, in order.
 */
export function splitWords(value: string): string[] {
  return value.split(ASCII_WHITESPACE_RUN).filter((word) => word.length > 0);
}

// A run of whitespace containing at least one LINE BREAK - the
// boundary splitPreservingSpaces cuts on, as opposed to splitWords'
// ASCII_WHITESPACE_RUN, which cuts on ANY whitespace run. `\n` is
// itself inside ASCII_WHITESPACE, so the trailing quantifier already
// absorbs a run of several newlines and the spaces between them; only
// the leading quantifier is needed to reach back over indentation
// BEFORE the break.
const LINE_BREAK_RUN = new RegExp(
  String.raw`${ASCII_WHITESPACE.source}*\n${ASCII_WHITESPACE.source}*`,
  "v",
);

// The front and back halves of LINE_BREAK_RUN, anchored, for
// leadsWithLineBreak/trailsWithLineBreak: whether a text node's OWN
// edge run (as opposed to the run between two nodes) contains the
// break rather than plain horizontal whitespace.
const LEADING_LINE_BREAK = new RegExp(
  String.raw`^${ASCII_WHITESPACE.source}*\n`,
  "v",
);
const TRAILING_LINE_BREAK = new RegExp(
  String.raw`\n${ASCII_WHITESPACE.source}*$`,
  "v",
);

/**
 * Split raw text into byte-preserving chunks: cut only where a LINE
 * BREAK stood, never on an interior run of plain spaces or tabs. The
 * byte-preserving counterpart to {@link splitWords}, for content
 * Asciidoctor renders exactly as written - a monospace span's
 * interior spacing is content, not prose to reflow (issue #32,
 * measured: `` `a  b` `` renders `<code>a  b</code>`, both spaces
 * kept). A line break still folds to one breakable join, same as
 * ordinary reflowed text: Asciidoctor copies a line break inside an
 * inline code span into the rendered element just as it does outside
 * one, so moving it is not a meaning change - only an interior SPACE
 * RUN is.
 * @param value - Raw source text, or a prefix of it.
 * @returns The chunks, in order; empty only where `value` held
 *   nothing but a line-break run.
 */
export function splitPreservingSpaces(value: string): string[] {
  return value.split(LINE_BREAK_RUN).filter((chunk) => chunk.length > 0);
}

/**
 * Whether `value`'s LEADING whitespace run - if any - contains a line
 * break. Pure leading spaces or tabs answer false: splitPreservingSpaces
 * bakes them into its first chunk instead of treating them as a join,
 * so the caller must not also ask the packer to insert one there.
 * @param value - Raw source text.
 * @returns Whether the run splitPreservingSpaces would cut at the
 *   front of `value` contains a line break.
 */
export function leadsWithLineBreak(value: string): boolean {
  return LEADING_LINE_BREAK.test(value);
}

/**
 * Whether `value`'s TRAILING whitespace run - if any - contains a line
 * break. Mirrors {@link leadsWithLineBreak} at the trailing edge.
 * @param value - Raw source text.
 * @returns Whether the run splitPreservingSpaces would cut at the end
 *   of `value` contains a line break.
 */
export function trailsWithLineBreak(value: string): boolean {
  return TRAILING_LINE_BREAK.test(value);
}

// ── Detection ──────────────────────────────────────────────

// The lone `+`. Both reflow safety rules name it: at column 0 it is a
// list continuation, at end of a line a hard line break.
const CONTINUATION_WORD = "+";

/**
 * What a hard line break PRINTS as: a space and a `+`, closing the
 * line the break ends (`HardLineBreakRx`, rx.rb l.624 and l.627,
 * `^(.*) \+$` - a SPACE before the `+`, never a tab). Declared here
 * beside {@link CONTINUATION_WORD}, the other `+` the printer writes,
 * so the two spellings the packer must tell apart live together; the
 * inline printer emits it (src/print/inline.ts) and
 * {@link opensOrdinaryTextLine} recognizes the line it opens.
 */
export const HARD_BREAK_IMAGE = " +";

// Stands in for "whatever word the packer puts next", so the registry
// can be asked about a word that STARTS a line rather than one alone on
// it. Any non-blank, non-syntactic text does; the marker patterns only
// require that something follow the space.
const PROBE_SUFFIX = "x";

/**
 * Detect words that must not begin an output line, because
 * AsciiDoc would re-parse them there as the start of a new block
 * or list item. Such a word is fused onto its predecessor — within a
 * text node by wordsToAtoms, and across a node boundary by the leading
 * boundary in src/print/inline.ts's text case.
 *
 * The answer comes entirely from the line-shape registry, asked
 * in both spellings a reflowed head can take, because reflow does
 * not know which kind of paragraph it is inside and the registry's
 * patterns are whole-LINE ones:
 *
 * - the head alone on a line (`----`, `[source]`, `[[a]]`),
 * - the head starting a line that continues (`* `, `. `, `<1> `,
 *   `NOTE: ` all require that trailing text to match, and the packer
 *   would supply it with the very next word).
 *
 * The second probe is exact for a single WORD and conservative for the
 * two composed heads below: appending `PROBE_SUFFIX` to a head that
 * already holds a space asks about a line one word longer than the
 * packer would write. It can therefore only over-refuse, never
 * under-refuse, and over-refusing costs a break the output did not
 * need rather than a document the reader loses.
 *
 * The interrupting shapes, the SECTION TITLES and the RAW ones all
 * count, and the difference in the QUESTION is the point. The reader
 * asks "does this line end the block", to which a comment or
 * preprocessor directive answers no (the reader consumes it before
 * block structure exists), and a section title answers no as well (a
 * paragraph swallows one mid-block). Reflow asks "may this word begin
 * a line", and there the same shapes answer yes for a different
 * reason: `//` at column 0 comments out everything packed after it,
 * `ifdef::x[]` swallows it into a directive, and `=` or `##` in front
 * of a word writes a heading the source never had. Text destroyed is
 * text destroyed, whether by a new block, by a section the author did
 * not write, or by the preprocessor.
 * @param word - The head of an output line, in one of three
 *   spellings: a single non-empty whitespace-delimited token from the
 *   paragraph text, as produced by String.split on whitespace; a
 *   span-opening atom's COMPOSED text (mark, edge space, first word:
 *   `** b`, the block-start hazard net,
 *   src/print/block-start-hazard.ts); or a whole FUSED RUN as
 *   {@link wrap} joins it, which may hold any number of atoms and the
 *   spaces between them (`[a@b.com] and`). The last two carry interior
 *   whitespace, which the probes spell either way.
 * @returns True when the head would start a block, or be eaten by
 *   the preprocessor, at line start
 */
export function isBlockSyntaxAtLineStart(word: string): boolean {
  // A lone `+` is the one interrupter this rule must NOT act on: it
  // is handled by the line-END rule (isDangerousAtLineEnd) and by
  // escapeDanglingPlus, and fusing it backwards here would put ` +`
  // at the end of a line instead — a hard line break.
  if (word === CONTINUATION_WORD) {
    return false;
  }
  // The head alone, then the head with a successor after it - the two
  // lines the packer can produce from it. A head that is already
  // several words makes the second probe conservative rather than
  // exact; see the note above.
  const startingALine = `${word} ${PROBE_SUFFIX}`;
  return (
    interruptsByLineShape(word) ||
    interruptsByLineShape(startingALine) ||
    startsSectionTitle(word) ||
    startsSectionTitle(startingALine) ||
    isRawParagraphLine(word) ||
    isRawParagraphLine(startingALine)
  );
}

/**
 * Detect words that would become AsciiDoc syntax when
 * placed at end of a line (before a break). Such
 * words are fused to their successor so the break lands
 * before the word rather than after it.
 * @param word - A single non-empty whitespace-delimited token
 *   from the paragraph text.
 * @returns True when placing this word at line end would
 *   produce AsciiDoc syntax in the reflowed output
 */
function isDangerousAtLineEnd(word: string): boolean {
  // A bare `+` preceded by a space (from the packer joining)
  // would become ` +\n` — a hard line break.
  return word === CONTINUATION_WORD;
}

// ── Atom construction ──────────────────────────────────────

/**
 * Whether the atom at `index` is fused to the one before it, and so
 * cannot start a line of its own.
 * @param atoms - the atoms built so far.
 * @param index - the atom to ask about.
 * @returns true when the three glue facts put it in its predecessor's
 *   run.
 * Exported for its unit test (tests/print/reflow.test.ts); no src
 * consumer.
 * @internal
 */
export function isFused(atoms: readonly Atom[], index: number): boolean {
  if (index <= 0) {
    return false;
  }
  return (
    atoms[index].glueLeft ||
    atoms[index].noBreakBefore ||
    atoms[index - 1].noBreakAfter
  );
}

/**
 * Rewrite a dangling `+` atom. A `+` that ends the word list and starts
 * a run of its own has no successor to fuse to, so it will always appear
 * at end of an output line, where AsciiDoc would re-parse ` +\n` as a
 * hard line break (or a lone `+` line as a list continuation). The
 * replacement is the `{plus}` built-in attribute reference, which
 * renders as `+` — backslash is NOT a recognized escape for `+` in
 * Asciidoctor (` \+` renders a literal backslash), so the previously
 * used `\+` changed the rendered text.
 * @param atoms - the finished atoms (mutated).
 * @param escape - Whether escaping is enabled for this text
 *   (disabled when a sibling follows in the same block, or
 *   inside a formatting span whose closing mark follows the
 *   word in the output).
 */
function escapeDanglingPlus(atoms: Atom[], escape: boolean): void {
  const last = atoms.length - 1;
  if (!escape || last < 0) {
    return;
  }
  if (atoms[last].text === CONTINUATION_WORD && !isFused(atoms, last)) {
    atoms[last] = { ...atoms[last], text: "{plus}" };
  }
}

/**
 * Give a `+` that stood ALONE on its own source line an output line of
 * its own again.
 *
 * Such a line is a list continuation, and the reader reads it as one
 * (`cont`) before it reads anything after it. The two ordinary `+`
 * rules both destroy that reading: {@link isDangerousAtLineEnd} fuses
 * the FOLLOWING word onto the `+` so no break can land after it, and
 * {@link isBlockSyntaxAtLineStart} exempts the `+` so no break lands
 * before it either — between them the `+` can only ever come out
 * joined to its neighbours as prose. One alphabet symbol away the same
 * join does visible damage: `+` then `term:: def` comes out as
 * `+ term:: def`, which reads back as a description-list term the
 * source never had.
 *
 * Both rules exist to keep a MID-LINE `+` from drifting to a line
 * boundary it was never at, so neither applies to a `+` that was
 * already alone on a line: nothing joins it from the left (it opens
 * the block, so the packer has an empty line in front of it) and the
 * word after it takes the break the source wrote. A `+` alone on a
 * line is not preceded by the space ` +\n` needs to be a hard line
 * break, so clearing the forward fuse here creates nothing.
 *
 * The caller decides whether the `+` really was alone on its line;
 * this only spells what "alone" costs in atoms. The break is a `hard`
 * one, not a `literal` one: the `+` and the words after it belong to
 * the same block, so they take the same continuation indent, and a
 * literal break would move only the tail of the block to column 0.
 * @param atoms - the node's atoms (mutated); the `+` is atoms[0].
 * @param opensWithOne - what the caller measured: whether the node's
 *   first word really is a `+` the source gave a line of its own. The
 *   answer is the caller's because it needs the source position, and
 *   passing it IN keeps the whole rule in one place rather than
 *   splitting the guard across two files.
 */
function keepContinuationLine(atoms: Atom[], opensWithOne: boolean): void {
  if (
    !opensWithOne ||
    atoms.length === 0 ||
    atoms[0].text !== CONTINUATION_WORD
  ) {
    return;
  }
  atoms[0] = { ...atoms[0], noBreakAfter: false };
  if (atoms.length > 1) {
    atoms[1] = { ...atoms[1], noBreakBefore: false, breakBefore: "hard" };
  }
}

/**
 * One word's atom.
 * @param word - the word.
 * @param fuseBackwards - whether it must share its predecessor's line.
 * @param hazard - whether it is a dlist term off the block's first
 *   source line, and so may not reach the first output line.
 * @returns the atom.
 */
function wordAtom(word: string, fuseBackwards: boolean, hazard: boolean): Atom {
  return {
    ...atomOf(word),
    noBreakBefore: fuseBackwards,
    noBreakAfter: isDangerousAtLineEnd(word),
    breakBefore: hazard ? "hard" : "none",
  };
}

/**
 * Close off one text node's atoms. The node's LAST word has no successor
 * HERE to fuse forward onto: whether the next inline sibling joins its
 * run is the boundary's decision, made where the two nodes meet, not
 * this word's.
 * @param atoms - the node's atoms (mutated).
 * @param escapeTrailingPlus - whether a dangling `+` must be rewritten.
 */
function endNodeAtoms(atoms: Atom[], escapeTrailingPlus: boolean): void {
  const last = atoms.length - 1;
  if (last < 0) {
    return;
  }
  atoms[last] = { ...atoms[last], noBreakAfter: false };
  escapeDanglingPlus(atoms, escapeTrailingPlus);
}

/**
 * Convert a text node's word list into atoms. Three safety mechanisms
 * prevent reflow from creating syntax:
 * 1. Words dangerous at line START are fused onto their
 *    predecessor (`noBreakBefore`) so the break lands before the pair.
 * 2. Words dangerous at line END (`+`) are fused to
 *    their successor (`noBreakAfter`) so the break lands before them.
 * 3. Words dangerous only on the FIRST line of a block (a
 *    `term::` description-list separator) demand a break in front of
 *    them (`breakBefore`), which no amount of packing can undo — and
 *    which {@link wrap} lifts to the front of the whole run when rules 1
 *    and 2 have fused the word into one.
 *
 * Rule 2 has one exemption, {@link keepContinuationLine}: a `+` the
 * source already gave a line of its own is a reading the join would
 * delete rather than a hazard the join would create.
 * @param words - Array of whitespace-delimited tokens already
 *   split from the paragraph text. Each element is non-empty
 *   and contains no whitespace. The array itself may be empty,
 *   in which case no atoms are produced.
 * @param options - Reflow safety switches.
 * @param options.firstLineWordCount - How many leading words came
 *   from the paragraph's FIRST source line. Words after that many
 *   were on a later line, where Asciidoctor treats a `term::` word
 *   as plain text; moving one onto the first output line would
 *   re-parse the block as a description list. Defaults to "all
 *   words", which disables the guard for callers that cannot say.
 * @param options.escapeTrailingPlus - Whether a `+` with no
 *   successor word should be rewritten to `{plus}`. True for
 *   text that truly ends its enclosing block, where the word
 *   could land at the end of an output line and be re-parsed
 *   as a hard line break or list continuation. False when an
 *   inline sibling follows (the printer fuses the `+` forward
 *   instead) or inside a formatting span (`` `+` ``): the
 *   closing mark follows the word in the output, so it can
 *   never end a line bare — and rewriting it would corrupt
 *   the span's content.
 * @param options.opensWithContinuationLine - Whether the node's first
 *   word is a `+` that stood ALONE on its own source line, and so
 *   must keep an output line to itself
 *   ({@link keepContinuationLine}). Defaults to false, which leaves
 *   every `+` to the ordinary line-end rule — the right answer for
 *   callers that cannot say where the word sat.
 * @returns The node's atoms, in order.
 */
export function wordsToAtoms(
  words: readonly string[],
  options?: {
    escapeTrailingPlus?: boolean;
    firstLineWordCount?: number;
    opensWithContinuationLine?: boolean;
  },
): Atom[] {
  const {
    escapeTrailingPlus = true,
    firstLineWordCount = words.length,
    opensWithContinuationLine = false,
  } = options ?? {};
  const atoms: Atom[] = [];
  let glueNext = false;
  for (const [index, word] of words.entries()) {
    // A word ending in a description-list separator (`term::`,
    // `term;;`) is plain text mid-paragraph but IS a dlist term on
    // the first line of a block. When it came from a later source
    // line, packing it onto the first output line would silently
    // turn the paragraph into a description list.
    const hazard =
      index >= firstLineWordCount && DLIST_SEPARATOR_WORD.test(word);
    // Rules 1 and 2 both fuse `word` backwards: the previous word is
    // dangerous at line end (a bare `+`), or this word is dangerous at
    // line start. Either way the two must share a line, with the
    // whitespace the source had between them.
    const fuseBackwards =
      index > 0 && (glueNext || isBlockSyntaxAtLineStart(word));
    atoms.push(wordAtom(word, fuseBackwards, hazard));
    glueNext = isDangerousAtLineEnd(word);
  }
  keepContinuationLine(atoms, opensWithContinuationLine);
  endNodeAtoms(atoms, escapeTrailingPlus);
  return atoms;
}

// ── The kept break ─────────────────────────────────────────

/**
 * Whether the line the run at `run` OPENS is one the reader reads as
 * the block's ordinary text. Two runs are not, and both must be a
 * SINGLE atom to be the line's whole content rather than its last
 * word:
 *
 * - a whole `//` line, which `Reader#skip_line_comments` (reader.rb)
 *   drops before the parser counts any line. The head is the
 *   registry's ({@link LINE_COMMENT_HEAD}), whose prefix test is wider
 *   than `CommentLineRx`; the difference cannot be reached from here,
 *   because the only lines this is asked about are raw lines the
 *   BlockReader already classified.
 * - the {@link HARD_BREAK_IMAGE}, whose leading space makes the line
 *   INDENTED (`indented = this_line.start_with? ' ', TAB`,
 *   parser.rb l.572) and so sends the whole block down the arm that
 *   strips its indentation.
 * @param atoms - the block's atoms.
 * @param run - the run that the break opens.
 * @returns Whether the reader reads that line as ordinary text.
 */
function opensOrdinaryTextLine(atoms: readonly Atom[], run: Run): boolean {
  if (run.end - run.start !== 1) {
    return true;
  }
  const { text } = atoms[run.start];
  return !text.startsWith(LINE_COMMENT_HEAD) && text !== HARD_BREAK_IMAGE;
}

/**
 * Put an ordinary TEXT line on the block's FIRST REST LINE - the line
 * directly under the one the block opens on.
 *
 * That line is where a list item's re-reader makes its decisions. The
 * item's buffer starts there (`read_lines_for_list_item`,
 * parser.rb l.1404), and three of Ruby's own tests read only its first
 * line: `skip_line_comments` and the peek behind it, which decide
 * whether the item's blocks are its text (parser.rb l.1364-70);
 * `next_block`'s blank count, taken once on entry (parser.rb l.505)
 * and read again by `read_paragraph_lines` to decide whether a
 * paragraph breaks at a nested marker (parser.rb l.764); and the
 * `text_only` indent test (parser.rb l.572) that sends the block down
 * the arm `adjust_indentation!` strips (parser.rb l.753-755). Reflow
 * packs the item's text onto the MARKER line, so whatever the source
 * put under it moves up into that position - and {@link hazard}
 * (src/print/list-hazard.ts) says when the move would answer one of
 * those tests differently. The remedy is this one: hold a break so a
 * plain text line stands there, exactly as it did in the source.
 *
 * WHICH break is held follows from which run opens that line. A run
 * that already demands a break of its own opens it, so the first such
 * run is the one to ask about: if it is ordinary text the line is
 * already right and nothing is held; if it is a deleted comment line
 * or an indented one, the break moves to the last TEXT run in front of
 * it. Where no run demands a break at all the packer's width decides,
 * and the LAST run is the one a held break can put on the first rest
 * line while leaving the most reflow intact. Either way the held run
 * is never the block's first - the break in front of that one is not
 * this block's to make, and a block whose only text run opens the line
 * has no earlier text to hold, which is the source's own reading
 * anyway.
 *
 * The candidate still has to be a run that MAY open the line it would
 * be given ({@link canOpenLine}), and where it may not the search walks
 * on to its left. {@link wrap} honours a demanded break without asking
 * about the line it opens, so this is the place the question gets
 * asked.
 * @param atoms - the block's atoms.
 * @param kept - which break to demand: `"hard"` opens the line at the
 *   block's continuation indent, `"literal"` at column 0. The caller
 *   knows which, because it is the caller that knows what else stands
 *   on the item's lines (src/print/list-hazard.ts).
 * @returns The same atoms, with that break made mandatory.
 */
export function keepTextOnFirstRestLine(
  atoms: readonly Atom[],
  kept: "hard" | "literal",
): Atom[] {
  const runs: Run[] = [];
  for (let index = 0; index < atoms.length; index = runs.at(-1)?.end ?? 0) {
    runs.push(runAt(atoms, index));
  }
  const opener = runs.findIndex(
    (run, index) => index > 0 && run.breakBefore !== "none",
  );
  if (opener !== -1 && opensOrdinaryTextLine(atoms, runs[opener])) {
    return [...atoms];
  }
  const held = heldRun(
    runs,
    opener === -1 ? runs.length - 1 : opener - 1,
    kept,
  );
  if (held === -1) {
    return [...atoms];
  }
  return atoms.with(runs[held].start, {
    ...atoms[runs[held].start],
    breakBefore: kept,
  });
}

/**
 * Whether the run at `index` may open the line a kept break would give
 * it.
 *
 * At the block's continuation indent it always may, and the reason is
 * narrower than "nothing is read there": a list MARKER is read at any
 * column (the registry's own patterns are anchored `^[ \t]*`), so an
 * indented `** b` is still a marker line. What a HELD run can carry is
 * what makes it safe - the run is a text run past the block's first,
 * whose own words `wordsToAtoms` has already fused backwards if any of
 * them is block syntax at a line start - and the claim is measured
 * rather than derived: 0 of 112,610 population documents move a byte
 * on this path. At COLUMN 0 it is the same question
 * {@link isBlockSyntaxAtLineStart} answers for a width break, and it
 * has to be asked for the same reason: `wordsToAtoms` fuses a
 * block-syntax WORD backwards, so no single word a run past the first
 * starts with is one - but a run the packer FUSES out of several nodes
 * (`[` + an address atom + `]`, which no single node ever holds as one
 * word) is the exception {@link wrap}'s own comment records, and a
 * break held in front of one at column 0 writes a block attribute line
 * where the source had prose.
 * @param runs - the block's runs, in order.
 * @param index - the run being considered.
 * @param kept - the break the caller would demand.
 * @returns Whether that run may take it.
 */
function canOpenLine(
  runs: readonly Run[],
  index: number,
  kept: "hard" | "literal",
): boolean {
  return kept === "hard" || !isBlockSyntaxAtLineStart(runs[index].text);
}

/**
 * The run whose join the kept break lands in front of: the candidate,
 * or the nearest run to its left that may open the line
 * ({@link canOpenLine}). `-1` when none can - the block's first run is
 * never held, because the break in front of it is not this block's to
 * make.
 * @param runs - the block's runs, in order.
 * @param from - the candidate index the search starts at.
 * @param kept - the break the caller would demand.
 * @returns The run's index, or -1.
 */
function heldRun(
  runs: readonly Run[],
  from: number,
  kept: "hard" | "literal",
): number {
  for (let index = from; index >= 1; index -= 1) {
    if (canOpenLine(runs, index, kept)) {
      return index;
    }
  }
  return -1;
}

// ── The block body ─────────────────────────────────────────

/**
 * THE block-body engine: one packer over a block's atoms — extracted so
 * the paragraph printer, the paragraph-form admonition body and the list
 * item's text are one engine BY CONSTRUCTION, not by review: the
 * deleted string engine had already forked the dlist first-line guard
 * into a second spelling.
 * @param atoms - the block's atoms, in order.
 * @param width - the column budget for a whole output line.
 * @param indent - columns the continuation lines are indented by.
 * @returns the reflowed body, one Doc line per output line.
 */
export function blockBody(
  atoms: readonly Atom[],
  width: number,
  indent: number,
): Doc[] {
  const parts: Doc[] = [];
  for (const text of wrap(atoms, width, indent)) {
    if (parts.length > 0) {
      parts.push(hardline);
    }
    parts.push(text);
  }
  return parts;
}
