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
  DLIST_SEPARATOR_WORD,
  interruptsByLineShape,
  isRawParagraphLine,
  LINE_COMMENT_HEAD,
  startsSectionTitle,
} from "../parse/line-shapes.js";

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
   * breaks, the dlist first-line guard, keepLastBreak's kept break).
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
    if (line !== "" && (run.breakBefore !== "none" || !fits)) {
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
 * and whitespace-free. Shared so every caller — the text case and the
 * first-source-line counting that feeds the dlist guard — agrees on what
 * a word is; a mismatch would misplace the guard by a word.
 *
 * `\s` is wider than the reader's rstrip set, so every non-ASCII space
 * the reader now preserves (a no-break space, an ideographic space, a
 * byte-order mark mid-text) is rewritten to a plain space or dropped
 * at a line end while the oracle keeps it: a recorded gap, tracked by
 * issue #67.
 * @param value - Raw source text, or a prefix of it.
 * @returns The non-empty whitespace-delimited words, in order.
 */
export function splitWords(value: string): string[] {
  return value.split(/\s+/v).filter((word) => word.length > 0);
}

// ── Detection ──────────────────────────────────────────────

// The lone `+`. Both reflow safety rules name it: at column 0 it is a
// list continuation, at end of a line a hard line break.
const CONTINUATION_WORD = "+";

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
 * in both spellings a reflowed word can take, because reflow does
 * not know which kind of paragraph it is inside and the registry's
 * patterns are whole-LINE ones:
 *
 * - the word alone on a line (`----`, `[source]`, `[[a]]`),
 * - the word starting a line that continues (`* `, `. `, `<1> `,
 *   `NOTE: ` all require that trailing text to match, and the packer
 *   would supply it with the very next word).
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
 * @param word - A single non-empty whitespace-delimited token
 *   from the paragraph text, as produced by String.split on
 *   whitespace - or a span-opening atom's COMPOSED text (mark, edge
 *   space, first word: `** b`), whose interior space is part of the
 *   line head the probes spell either way (the block-start hazard
 *   net, src/print/block-start-hazard.ts).
 * @returns True when the word would start a block, or be eaten by
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
  // The word alone, then the word with a successor after it — the
  // two lines the packer can produce from it.
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
 * Whether the run at `index` is a whole output line the READER DELETES:
 * a `//` comment line. `Reader#skip_line_comments` (reader.rb) drops
 * such lines before the parser counts any, so the break that opens one
 * is not a break the parser will ever see. The run must be a SINGLE atom
 * — that is what makes it the line's whole content rather than the last
 * word of a longer line. The head is the registry's
 * ({@link LINE_COMMENT_HEAD}), whose prefix test is wider than
 * `CommentLineRx`; the difference cannot be reached from here, because
 * the only lines this is asked about are raw lines the BlockReader
 * already classified.
 * @param atoms - the block's atoms.
 * @param run - the run that the break opens.
 * @returns Whether the reader deletes that line.
 */
function opensDeletedLine(atoms: readonly Atom[], run: Run): boolean {
  return (
    run.end - run.start === 1 &&
    atoms[run.start].text.startsWith(LINE_COMMENT_HEAD)
  );
}

/**
 * Make a block's inline content print on at least two lines: the last
 * run whose break the reader still sees gets a mandatory break in front
 * of it.
 *
 * A list item whose text is followed by a trailing titled metadata run
 * (`hazard(item) === "keepBreak"`) needs this: reflowed onto
 * one line, the run's first line would be the first line after the
 * marker line, where Asciidoctor folds it and reads the title as text.
 * ANY break in the text suffices — the run folds only on the first rest
 * line — so the decision is made here over the finished atom list, and
 * is robust to spans, macros, glue and the dlist guard by construction:
 * no word index, no position.
 *
 * The break has to be one the READER will still see. A run that already
 * demands a break usually needs nothing (a hard line break's, a dlist
 * guard's, an ordinary raw line's) — but a break that opens a line
 * `Reader#skip_line_comments` (reader.rb) DELETES buys no break at all:
 * strip the `// c` line from `* a .T` / `// c` / `[role]` and the
 * metadata is back on the first rest line, folding exactly as it would
 * have with no break. So a deleted line is walked past and the search
 * continues to its left, until a breakable join can be made mandatory or
 * the atoms run out. Atoms that form ONE run — a single unbreakable
 * unit — are left alone. Behavior is Ruby's (`Reader#skip_line_comments`,
 * reader.rb), pinned by the `// c` rows in
 * tests/format/list-item-blocks.test.ts and the sweep in
 * tests/format/list-shape-sweep.test.ts.
 *
 * There is no separator slot after the last run to pick by
 * mistake. Only a join with content on both sides puts a break INSIDE
 * the text; a trailing whitespace boundary contributes no atom at all,
 * so hardening it — which would print a blank line after the item text
 * and detach the very run this break exists to keep attached — is not
 * a move this walk can make.
 * @param atoms - the block's atoms.
 * @returns The same atoms, with that break made mandatory.
 */
export function keepLastBreak(atoms: readonly Atom[]): Atom[] {
  const runs: Run[] = [];
  let index = 0;
  while (index < atoms.length) {
    const run = runAt(atoms, index);
    runs.push(run);
    index = run.end;
  }
  for (let position = runs.length - 1; position > 0; position -= 1) {
    const run = runs[position];
    if (run.breakBefore === "none") {
      return atoms.with(run.start, {
        ...atoms[run.start],
        breakBefore: "hard",
      });
    }
    if (!opensDeletedLine(atoms, run)) {
      return [...atoms];
    }
  }
  return [...atoms];
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
