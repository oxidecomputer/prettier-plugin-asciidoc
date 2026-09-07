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
import type { InlineNode } from "../ast.js";
import {
  accepts,
  continuationPosition,
  FIRST_CONTINUATION,
  LATER_CONTINUATION,
  openingPosition,
} from "../line-verdict.js";
import type { BlockReading } from "../reader-context.js";
import {
  holdsDescriptionSeparatorWord,
  LINE_COMMENT_HEAD,
  startsBlockAtLineStart,
} from "../parse/line-shapes.js";

/**
 * The bytes of a text node's EDGE runs the printer must write back:
 * the run in front of its first word and the one behind its last.
 * Each stands between the node and the sibling beside it, so neither
 * is a run BETWEEN two words and neither has an atom of its own -
 * they ride inside the atom at each end ({@link withEdgeRuns}).
 *
 * Exported because it names an option of {@link wordsToAtoms}; every
 * caller passes an object literal, and tests/print/reflow.test.ts
 * exercises the option.
 * @internal
 */
export interface KeptEdgeRuns {
  /** In front of the first word; empty where the run may fold. */
  readonly leading: string;
  /** Behind the last word; empty where the run may fold. */
  readonly trailing: string;
}

/**
 * What the whitespace record holds against the join in FRONT of a
 * word: nothing, a space the packer may not turn into a break, or a
 * break the packer may not turn into a space.
 */
export type HeldJoin = "none" | "space" | "newline";

/** The join a run the record does not hold asks for: no join at all. */
const NO_HELD_JOIN: HeldJoin = "none";

// A text node with no edge run to keep, which is every caller but the
// text case in src/print/inline.ts.
const NO_EDGE_RUNS: KeptEdgeRuns = { leading: "", trailing: "" };

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
  /**
   * The atom is a whole source line replayed verbatim - a comment or
   * preprocessor line inside a paragraph - so nothing may be
   * CONCATENATED onto either end of its text. The joins around it
   * already keep other atoms off its output line; what this says is
   * that a mark cannot be fused into the line itself, where the
   * re-reader would take it as part of the comment. Set by
   * `appendRawLine` (src/print/inline.ts) and read by `pushSpanAtoms`
   * (src/print/span-marks.ts), which is the one place that fuses text
   * onto an atom it did not build.
   */
  readonly ownsItsLine: boolean;
}

/**
 * An atom carrying `text` and no joins — the neutral construction every
 * caller starts from, so the six fields are spelled in ONE place and a
 * new field cannot be forgotten at a call site. The count is
 * load-bearing: it is what a reader auditing whether a newly added
 * field is set everywhere counts against, so a field added to
 * {@link Atom} is added here and to this sentence in the same edit.
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
    ownsItsLine: false,
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
 * What the packer needs about the block beyond its atoms: the reading
 * the reader took its lines in, and the lines themselves.
 *
 * The reading is what makes the packer's own output line answerable -
 * a line means one thing inside a paragraph and another inside a list
 * item's text, and only the reader knows which
 * ({@link BlockReading}, src/reader-context.ts). The lines are what it
 * writes instead when no line it would write reads back as this
 * block's own text.
 *
 * TWO ARMS, because a block with no lines to write back is not a
 * block with an empty replay: it is one the question is never asked
 * of, and the layout it gets stands whatever the reader would make of
 * it. The only such block is one the printer assembles from a node no
 * reader read as a block of its own, where there is nothing to
 * replay and no recorded reading to ask in.
 *
 * Built by {@link blockLayout}; every src caller passes its result to
 * {@link blockBody}, so the name itself is imported only by the
 * packer's unit rows (tests/print/reflow.test.ts).
 * @internal
 */
export type BlockLayout =
  | {
      /** Nothing to write back; the packer's layout stands. */
      readonly replay: "none";
    }
  | {
      /**
       * The block's own source lines, in order, with the first line
       * starting where the block's content does (past any prefix the
       * caller writes in front of it).
       */
      readonly replay: readonly [string, ...string[]];
      /** How the reader read this block. */
      readonly reading: BlockReading;
      /** Where the block's first output line stands. */
      readonly firstLineStart: FirstLineStart;
    };

/**
 * Where a block's FIRST output line stands, which decides both
 * whether the packer may ask what that line opens and, when it may,
 * which reader it has to ask as.
 *
 * `prefixed` is every block whose caller writes bytes in front of
 * that line (a list item's marker, an admonition's label, a
 * description item's term): what the line opens is decided partly by
 * bytes the packer did not lay out, and the nets that answer for it
 * are the atom-level ones (src/print/block-start-hazard.ts,
 * src/print/list-hazard.ts).
 *
 * The other two both stand at column 0 with nothing in front, and
 * they differ by the reader that read the block. A CONFINED one - a
 * compound block's interior, a list item's buffer - reads a section
 * title as the paragraph's own text, so a packed line that spells one
 * is still this block ({@link BlockPosition}, src/line-verdict.ts,
 * carries the citation). At document level it is a heading, and a
 * layout that spells one is refused.
 */
type FirstLineStart = "documentBlockStart" | "confinedBlockStart" | "prefixed";

/**
 * A block's layout input, from the lines it would be replayed from.
 * @param replay - the block's own source lines, or none
 * @param reading - how the reader read the block
 * @param firstLineStart - see {@link FirstLineStart}
 * @returns the layout the packer takes
 */
export function blockLayout(
  replay: readonly string[],
  reading: BlockReading,
  firstLineStart: FirstLineStart,
): BlockLayout {
  const [first, ...rest] = replay;
  return replay.length === 0
    ? { replay: "none" }
    : { replay: [first, ...rest], reading, firstLineStart };
}

/**
 * The source lines a block is replayed from: its own bytes, from the
 * first inline node's start to the last one's end.
 *
 * VERBATIM, indents and all, and that is the whole of the replay
 * contract for the blocks this printer packs. A replayed line has to
 * keep the reading it had, and a line's reading is decided by the line
 * INCLUDING its leading run (`indented = this_line.start_with? ' '`,
 * parser.rb l.572, is what makes ` ----` paragraph text and `----` a
 * listing block). The blocks that reach the packer are printed back at
 * the column they were read at - a list item replays its own
 * `markerIndent`, a paragraph opens at column 0 - so the source's own
 * columns ARE the enclosing block's continuation column and there is
 * no re-indentation to compose.
 * @param nodes - the block's inline nodes, in source order
 * @param source - the document Prettier parsed
 * @param from - where the block's FIRST OUTPUT LINE starts in the
 *   source, for a block whose caller writes a prefix into the packed
 *   run itself (an admonition's `NOTE: ` label); the first node's own
 *   start by default, which is right wherever the prefix is written
 *   outside the run (a list item's marker) or there is none
 * @returns the block's source lines, or none when it holds no node
 */
export function replayLines(
  nodes: readonly InlineNode[],
  source: string,
  from?: number,
): readonly string[] {
  const first = nodes.at(0);
  const last = nodes.at(-1);
  if (first === undefined || last === undefined) {
    return [];
  }
  return source
    .slice(from ?? first.position.start.offset, last.position.end.offset)
    .split("\n");
}

/**
 * Whether every line the packer laid out below the block's first
 * reads back as this block's own text.
 *
 * THE BLOCK'S FIRST LINE IS A DIFFERENT QUESTION, asked by
 * {@link opensTheSameBlock}: the reader classified it at a block
 * START, where what matters is whether it still opens the block it
 * opened rather than whether it continues one.
 *
 * The lines are asked about EXACTLY AS THEY WILL BE WRITTEN, leading
 * indent included, because that is what the reader will read: the same
 * words at column 0 and at column 2 are two different lines to
 * `next_block`.
 *
 * `next` is undefined at every position below the first, and that is
 * the reader's own arrangement rather than a shortcut: a line inside
 * an open block reads no neighbour, because the one two-line
 * construct is the underlined section title and it is asked at a
 * block start alone (parser.rb l.374 and l.710, both from
 * `next_section`). The design's base case, the line the printer
 * writes AFTER the block, therefore reaches only
 * {@link opensTheSameBlock}, where {@link BLANK_LINE_BELOW} supplies
 * it.
 * @param lines - the finished output lines, indentation included
 * @param layout - the block's reading and its own source lines
 * @returns true when the layout is one the reader reads back
 */
function readsBackAsTheBlock(
  lines: readonly PackedLine[],
  layout: Extract<BlockLayout, { readonly reading: BlockReading }>,
): boolean {
  const { reading } = layout;
  if (!opensTheSameBlock(lines, layout)) {
    return false;
  }
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    // A line the packer REPLAYED is not one it composed: a comment or
    // a preprocessor directive inside a block is the author's own
    // line, written back where it stood, and the reader consumes it
    // as what it is rather than reading it as the block's text
    // ({@link keepsTheLine}, src/line-verdict.ts, is the reader's own
    // half of that difference). Asking the composed-line question of
    // one would refuse every block that holds one.
    if (!line.composed) {
      continue;
    }
    const ordinal = index === 1 ? FIRST_CONTINUATION : LATER_CONTINUATION;
    // No neighbour: a position inside an open block reads none, which
    // is `read_paragraph_lines` running rather than `next_section`'s
    // loop (see lineVerdict, src/line-verdict.ts).
    if (
      !accepts(line.text, undefined, continuationPosition(reading, ordinal))
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Whether the block's FIRST output line still opens the block the
 * reader opened.
 *
 * A DIFFERENT QUESTION from the one every line below it is asked: the
 * reader classified this line at a block START, where the whole
 * ladder is live and where every shape it knows is a reading the
 * paragraph could lose. It is asked of the line the PACKER would
 * write and of nothing else, and the bytes the refusal writes back
 * are the block's own source lines.
 *
 * ASKED ONLY WHERE THE PACKER OWNS THE COLUMN, and asked AS THE
 * READER THAT READ THE BLOCK. Where a marker, a label or a term line
 * stands in front of the first output line, what that line opens is
 * decided partly by bytes the packer did not lay out, and the
 * atom-level nets answer for it instead
 * (src/print/block-start-hazard.ts, src/print/list-hazard.ts). Where
 * the packer does own it, a CONFINED reader read the block through
 * `next_block` and no section can open there, so a packed `== T` line
 * is still that paragraph's text ({@link FirstLineStart}).
 *
 * ITS DOMAIN, and why ONE answer settles it. The block-start context
 * this can build is the widest one: `substitutedContentAbove` and
 * `markerLineWins` are the two facts a block start turns on that the
 * recorded reading does not carry, and false is the reading under
 * which every rule they hold off fires. So the question is wider than
 * the reader's, and a wider question can only turn an accepted layout
 * into a refused one - which writes back lines the reader itself
 * read.
 *
 * WHAT IT REFUSES IS A PACKED LINE, and the source's own first line
 * is not asked about at all. A layout whose first line reads back as
 * a title, a heading, a marker or an attribute entry is refused and
 * the block's own lines are written instead, which is the output safe
 * under BOTH readings a substituting directive leaves open: either
 * the preprocessor puts content above it and every line here is the
 * prose of one paragraph, or it deletes the directive and the line
 * stands at a block start.
 *
 * ITS LIMIT, stated because the domain above is not the mechanism's.
 * Where the packed line reads back as TEXT nothing is refused and the
 * fold stands, whatever the block's own first source line was. A
 * `'''`, `___`, `<<<`, `image::` or `toc::` line under a substituting
 * directive is one of those: each is a block only on a line of its
 * own, so the packed line carrying the words below it is prose, and a
 * directive whose condition turns out FALSE leaves the source's two
 * lines rendering differently from the one this writes. This question
 * cannot reach that; a per-word or per-atom net would have to.
 *
 * THE NEIGHBOUR is the block's own second output line where it has
 * one, and the blank line the join writes under it where it does not.
 * That is the design's base case, and the only place a neighbour is
 * read at all: the underlined section title is the one two-line
 * construct, and it is asked at a block start alone (parser.rb l.374
 * and l.710, both from `next_section`).
 * @param lines - the finished output lines
 * @param layout - the block's reading and its own source lines
 * @returns true when the first line opens the block it opened
 */
function opensTheSameBlock(
  lines: readonly PackedLine[],
  layout: Extract<BlockLayout, { readonly reading: BlockReading }>,
): boolean {
  const first = lines.at(0);
  if (layout.firstLineStart === "prefixed" || first?.composed !== true) {
    return true;
  }
  const below = lines.at(1)?.text ?? BLANK_LINE_BELOW;
  return accepts(
    first.text,
    below,
    openingPosition(
      layout.reading,
      OPENS_AS_TEXT,
      layout.firstLineStart === "confinedBlockStart",
    ),
  );
}

/**
 * The one reading this packer can answer for at a block start: the
 * block's first line is the prose it holds. See
 * {@link opensTheSameBlock} for why the others are left to the
 * atom-level nets.
 */
const OPENS_AS_TEXT = { reading: "text" } as const;

/**
 * What the join writes under a block that ends its own extent: one
 * blank line. Every block sequence this printer writes is separated
 * by one (src/print/join.ts), and inside a list item the line under a
 * packed block is a marker line, a term line or a `+`; none of the
 * four is a setext underline, which is the only shape a neighbour
 * decides.
 */
const BLANK_LINE_BELOW = "";

/**
 * One finished output line, and whether the packer COMPOSED it out of
 * the block's words or REPLAYED it from a line the source already had.
 */
interface PackedLine {
  /** The line as it will be written, indentation included. */
  readonly text: string;
  /** False for a line that is one raw source line replayed whole. */
  readonly composed: boolean;
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
 * @param layout - how the reader read the block, and the lines it is
 *   replayed from ({@link BlockLayout}).
 * @returns the finished lines, indentation included; the block's own
 *   source lines where no line of the layout reads back as its text.
 * Exported for its unit test (tests/print/reflow.test.ts); no src
 * consumer.
 * @internal
 */
export function wrap(
  atoms: readonly Atom[],
  width: number,
  indent: number,
  layout: BlockLayout,
): string[] {
  const lines = packLines(atoms, width, indent);
  // A block with nothing to write back keeps its layout: the only
  // such block is one the printer assembles from a node no reader
  // read as a block of its own, where there is no recorded reading to
  // ask in and no source lines to write instead.
  if (layout.replay === "none") {
    return lines.map((each) => each.text);
  }
  // THE REFUSAL IS WHOLE-BLOCK, never a retreat to some other break.
  // A layout with one line the reader does not read as this block's
  // text is not repaired by keeping one of the source's own breaks
  // instead: the packer would have to pick WHICH, and a rule that
  // picks is one two spellings of the same document answer
  // differently, which is a confluence violation rather than a fix.
  // Writing the block's own lines back is the one answer that is a
  // fixed point on re-read, because the output IS the input the
  // reader read.
  if (readsBackAsTheBlock(lines, layout)) {
    return lines.map((each) => each.text);
  }
  return [...layout.replay];
}

/**
 * The greedy layout: runs join with single spaces up to `width`
 * columns, a demanded break opens a line, and a fused run is measured
 * whole. See {@link wrap}, whose comment carries the rules this loop
 * applies; this is the loop alone, split out so the layout and the
 * question asked of it are two functions.
 * @param atoms - the block's atoms in order.
 * @param width - the column budget for a whole output line.
 * @param indent - columns the continuation lines are indented by.
 * @returns the lines, each saying whether the packer composed it.
 */
function packLines(
  atoms: readonly Atom[],
  width: number,
  indent: number,
): PackedLine[] {
  const lines: PackedLine[] = [];
  let line = "";
  // A line is COMPOSED unless every run on it is one the source wrote
  // as a whole line of its own; a raw run is alone on its line by
  // construction, so one flag per line is the whole of it.
  let composed = true;
  let lineIndent = indent;
  const flush = (): void => {
    lines.push({
      text: lines.length === 0 ? line : " ".repeat(lineIndent) + line,
      composed,
    });
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
      composed = true;
    } else {
      line = line === "" ? run.text : `${line} ${run.text}`;
    }
    composed &&= !atoms[run.start].ownsItsLine;
    index = run.end;
  }
  if (line !== "") {
    flush();
  }
  return lines;
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

/**
 * Detect words that must not begin an output line, because
 * AsciiDoc would re-parse them there as the start of a new block
 * or list item. Such a word is fused onto its predecessor — within a
 * text node by wordsToAtoms, and across a node boundary by the leading
 * boundary in src/print/inline.ts's text case.
 *
 * The answer comes entirely from the line-shape registry.
 * {@link startsBlockAtLineStart} answers whether the head would be
 * re-read as syntax where it stands; this adds the one word the
 * PRINTER must answer differently, the lone `+`.
 * @param word - The head of an output line, in one of three
 *   spellings: a single non-empty whitespace-delimited token from the
 *   paragraph text, as produced by String.split on whitespace; a
 *   span-opening atom's COMPOSED text (mark, edge space, first word:
 *   `** b`, the block-start hazard net,
 *   src/print/block-start-hazard.ts); or a whole FUSED RUN as
 *   {@link wrap} joins it, which may hold any number of atoms and the
 *   spaces between them (`[a@b.com] and`). The last two carry interior
 *   whitespace, which the registry's probes spell either way.
 * @returns True when the head would start a block, start a section,
 *   or be eaten by the preprocessor, at line start
 */
export function isBlockSyntaxAtLineStart(word: string): boolean {
  // A lone `+` is the one interrupter this rule must NOT act on: it
  // is handled by the line-END rule (isDangerousAtLineEnd) and by
  // escapeDanglingPlus, and fusing it backwards here would put ` +`
  // at the end of a line instead, a hard line break. That is a rule
  // about where a BREAK may land, which is the printer's question and
  // not the registry's about what a line shape means, so it lives
  // here rather than in the registry.
  if (word === CONTINUATION_WORD) {
    return false;
  }
  return startsBlockAtLineStart(word);
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
 *
 * Read by anything that wants to DEMAND a break in front of an atom:
 * a demand recorded on a fused atom is lifted to the front of its
 * whole run ({@link runBreak}), which puts the line boundary somewhere
 * else entirely. `markerLineGuard` (src/print/list-hazard.ts) asks it
 * for exactly that reason.
 * @param atoms - the atoms built so far.
 * @param index - the atom to ask about.
 * @returns true when the three glue facts put it in its predecessor's
 *   run.
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
 * Rewrite a dangling `+` atom. A `+` that ends the word list has no
 * successor to fuse to, so it will always appear at end of an output
 * line, where AsciiDoc would re-parse ` +\n` as a hard line break (or
 * a lone `+` line as a list continuation). The replacement is the
 * `{plus}` built-in attribute reference, which renders as `+`;
 * backslash is NOT a recognized escape for `+` in Asciidoctor
 * (` \+` renders a literal backslash), so the previously used `\+`
 * changed the rendered text.
 *
 * FUSING DOES NOT SAVE IT. A join fuses the atom to what stands
 * BEFORE it, which decides where a break may land and never whether
 * the packer writes the space in front of it; the atom is still the
 * last thing on its line. So every trailing `+` this is asked about
 * is rewritten. Asking {@link isFused} here instead is what let
 * `* a` / ` +` / ` +` come out as `* a + +`, a hard break the source
 * did not write. The one `+` that needs no rewriting is the one whose
 * join CONCATENATES it, where `HardLineBreakRx` (`^(.*) \+$`, rx.rb
 * l.627) finds no space and reads text; that join is not on the atom
 * yet, and `trailingPlusPolicy` (src/print/text-edges.ts) reads it
 * from the boundary and clears `escape`.
 * @param atoms - the finished atoms (mutated). NON-EMPTY:
 *   {@link endNodeAtoms} is the only caller and it returns on an
 *   empty list two statements before this call.
 * @param escape - Whether escaping is enabled for this text
 *   (disabled when a sibling follows in the same block, when the join
 *   in front concatenates, or inside a formatting span whose closing
 *   mark follows the word in the output).
 */
function escapeDanglingPlus(atoms: Atom[], escape: boolean): void {
  const last = atoms.length - 1;
  if (!escape) {
    return;
  }
  if (atoms[last].text === CONTINUATION_WORD) {
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
  // Both clauses behind `opensWithOne` are what make this TOTAL over
  // the (atoms, flag) pairs {@link wordsToAtoms} declares: the flag is
  // an exported function's option and no type ties it to the atoms
  // beside it, so the emptiness and the `+` are checked here rather
  // than assumed from the caller's claim.
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
 * @param held - what the whitespace record holds against the join in
 *   front of it ({@link HeldJoin}).
 * @returns the atom.
 */
function wordAtom(
  word: string,
  fuseBackwards: boolean,
  hazard: boolean,
  held: HeldJoin,
): Atom {
  // A word FUSED BACKWARDS is one that would be block syntax at a
  // line start, and the break the record holds in front of it is
  // exactly the break the block-start net weighs (`keepBlockStartBreak`,
  // src/print/block-start-hazard.ts): the net puts the AUTHOR's line
  // back, indent and all, where doing so is safe. Demanding one here
  // as well would be two atoms giving the packer opposite orders, and
  // the demand would be lifted to the front of the fused run - in
  // front of the wrong word. So the net decides, and this yields.
  const demanded = hazard || (held === "newline" && !fuseBackwards);
  return {
    ...atomOf(word),
    noBreakBefore: fuseBackwards || held === "space",
    noBreakAfter: isDangerousAtLineEnd(word),
    breakBefore: demanded ? "hard" : "none",
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
 * Give the node's kept EDGE runs the only place they can stand: inside
 * the atom at each end, where the packer's join can no longer rewrite
 * them.
 *
 * The atoms are otherwise finished, so no rule above has read a word
 * with the run's bytes on it. That is the point: the runs are
 * whitespace the source wrote OUTSIDE every word, and the packing
 * decisions - which word may open a line, which may end one - are
 * about the words.
 * @param atoms - the node's finished atoms.
 * @param runs - the bytes to keep at each end; empty where the fold is
 *   safe.
 * @returns the same atoms, with the runs riding at the two ends.
 */
function withEdgeRuns(atoms: Atom[], runs: KeptEdgeRuns): Atom[] {
  // Every text node in every document asks, and almost none has a run
  // to keep: measured at about 5% of format time to rebuild the atoms
  // for nothing.
  if (runs.leading === "" && runs.trailing === "") {
    return atoms;
  }
  const last = atoms.length - 1;
  return atoms.map((atom, index) => ({
    ...atom,
    text:
      (index === 0 ? runs.leading : "") +
      atom.text +
      (index === last ? runs.trailing : ""),
  }));
}

/**
 * Whether this word is a description-list separator that reflow must
 * not move onto the block's FIRST output line.
 *
 * A word ending in a separator (`term::`, `term;;`) is plain text
 * mid-paragraph but IS a dlist term on the first line of a block.
 * When it came from a later source line, packing it onto the first
 * output line would silently turn the paragraph into a description
 * list.
 *
 * ASKED OF THE ATOM'S WORDS, not of the atom, because an atom is one
 * word only until the whitespace record makes a run ride inside it
 * (src/print/text-edges.ts): `b<TAB>x::` is one atom, and the line it
 * would be written onto reads a term off its second word exactly as
 * the reader does. The anchored pattern alone answered no for it, and
 * `NOTE: a` over `b<TAB>x:: y` came back with both on the label's
 * line, where the oracle reads a description list (issue #294).
 *
 * THIS GUARD ANSWERS FOR A PLAIN PARAGRAPH, and for no other
 * construct. On a paragraph's later line the word really is text
 * (oracle-pinned at src/parse/lines/paragraph-reader.ts), so what is
 * dangerous is the MOVE onto the first line, and a per-word,
 * per-line guard is the right size for it. Inside a DESCRIPTION the
 * same word is a sibling term on EVERY line of the item
 * (`is_sibling_list_item?`, parser.rb:1430, :2281), so no break the
 * packer could place is safe and no guard here would be the right
 * size: that construct is answered whole-run by
 * `descriptionPrinting`'s separator condition
 * (src/parse/lines/description-list.ts), which replays the item
 * instead of packing it. Two guards for one hazard word, named at
 * both sites, so a later change cannot widen either into the other's
 * job.
 * @param word - the word.
 * @param index - its position among the node's words.
 * @param firstLineWordCount - how many of them came from the block's
 *   first source line.
 * @returns true when the word may not reach the first output line.
 */
function dlistHazard(
  word: string,
  index: number,
  firstLineWordCount: number,
): boolean {
  return index >= firstLineWordCount && holdsDescriptionSeparatorWord(word);
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
 *   split from the paragraph text. Each element is non-empty and
 *   holds no LINE BREAK; it holds interior whitespace only where
 *   the block's whitespace record kept a load-bearing run
 *   (`wordsOfText`, src/print/text-edges.ts), or where the caller
 *   splits on line breaks alone (src/print/literal-span.ts). The
 *   array itself may be empty, in which case no atoms are produced.
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
 * @param options.edgeRuns - The bytes of the node's own EDGE runs that
 *   may not fold, which stand outside every word and so ride on the
 *   first and last atom instead ({@link KeptEdgeRuns},
 *   {@link KeptEdgeRuns}). Defaults to none, the answer for
 *   every caller that has no node edges to speak of.
 * @param options.held - What the block's whitespace record holds
 *   against the join in front of each word ({@link HeldJoin}), one
 *   entry per word. Defaults to one `"none"` per word, which holds
 *   nothing anywhere: the answer for every caller whose words are not
 *   a prose block's runs (a monospace span's chunks, a test's word
 *   list).
 * @returns The node's atoms, in order.
 */
export function wordsToAtoms(
  words: readonly string[],
  options?: {
    escapeTrailingPlus?: boolean;
    firstLineWordCount?: number;
    opensWithContinuationLine?: boolean;
    edgeRuns?: KeptEdgeRuns;
    held?: readonly HeldJoin[];
  },
): Atom[] {
  const {
    escapeTrailingPlus = true,
    firstLineWordCount = words.length,
    opensWithContinuationLine = false,
    edgeRuns = NO_EDGE_RUNS,
    // TOTAL over the words by construction: a caller whose words are
    // not a prose block's runs (a monospace span's chunks, a test's
    // word list) holds nothing anywhere, and saying that as one join
    // per word is what keeps `held[index]` from handing `wordAtom` an
    // index past the end.
    held = words.map(() => NO_HELD_JOIN),
  } = options ?? {};
  const atoms: Atom[] = [];
  let glueNext = false;
  for (const [index, word] of words.entries()) {
    // A word ending in a description-list separator (`term::`,
    // `term;;`) is plain text mid-paragraph but IS a dlist term on
    // the first line of a block. When it came from a later source
    // line, packing it onto the first output line would silently
    // turn the paragraph into a description list.
    //
    // THIS GUARD ANSWERS FOR A PLAIN PARAGRAPH, and for no other
    // construct. On a paragraph's later line the word really is text
    // (oracle-pinned at src/parse/lines/paragraph-reader.ts), so what
    // is dangerous is the MOVE onto the first line, and a per-word,
    // per-line guard is the right size for it. Inside a DESCRIPTION
    // the same word is a sibling term on EVERY line of the item
    // (`is_sibling_list_item?`, parser.rb:1430, :2281), so no break
    // the packer could place is safe and no guard here would be the
    // right size: that construct is answered whole-run by
    // `descriptionPrinting`'s separator condition
    // (src/parse/lines/description-list.ts), which replays the item
    // instead of packing it. Two guards for one hazard word, named at
    // both sites, so a later change cannot widen either into the
    // other's job.
    const hazard = dlistHazard(word, index, firstLineWordCount);
    // Rules 1 and 2 both fuse `word` backwards: the previous word is
    // dangerous at line end (a bare `+`), or this word is dangerous at
    // line start. Either way the two must share a line, with the
    // whitespace the source had between them.
    const fuseBackwards =
      index > 0 && (glueNext || isBlockSyntaxAtLineStart(word));
    atoms.push(wordAtom(word, fuseBackwards, hazard, held[index]));
    glueNext = isDangerousAtLineEnd(word);
  }
  keepContinuationLine(atoms, opensWithContinuationLine);
  endNodeAtoms(atoms, escapeTrailingPlus);
  return withEdgeRuns(atoms, edgeRuns);
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
  for (let index = 0; index < atoms.length; ) {
    const run = runAt(atoms, index);
    runs.push(run);
    index = run.end;
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
 * Keep the block's FIRST OUTPUT LINE holding exactly what its first
 * SOURCE line held: no width break may fall before the first break
 * the atoms already demand.
 *
 * The opposite trade from {@link keepTextOnFirstRestLine}, and the
 * other half of the same question. That one holds a break so a text
 * line stands directly under the block's opening line; this one
 * refuses every break in front of that position, so whatever the
 * source put directly under the opening line is still what stands
 * there. A list item whose next source line is read as what it is
 * only because it stands there needs the second
 * (`ListItemNode.nextLineNeedsItsPosition`, src/ast.ts): a block
 * macro one line lower is prose, a `///` comment one line lower is
 * text the render keeps, and the wrap that moved it wrote no byte of
 * its own.
 *
 * The refusal is spelled as `noBreakBefore`, which is the join fact
 * the packer already reads (`runAt`), so the atoms pack as ONE run
 * and overrun the width the way a fused run does. It stops at the
 * first DEMANDED break because that break is the author's own line
 * boundary: fusing past one would lift it to the front of the run
 * (`runBreak`) and move every word behind it onto a line the source
 * never wrote.
 * @param atoms - the block's atoms, in order.
 * @returns the same atoms, with the joins up to the first demanded
 *   break refused.
 */
export function keepFirstSourceLineWhole(atoms: readonly Atom[]): Atom[] {
  const held = [...atoms];
  for (let index = 1; index < held.length; index += 1) {
    if (held[index].breakBefore !== "none") {
      break;
    }
    held[index] = { ...held[index], noBreakBefore: true };
  }
  return held;
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
 * @param layout - how the reader read the block, and the lines it is
 *   replayed from ({@link BlockLayout}).
 * @returns the reflowed body, one Doc line per output line.
 */
export function blockBody(
  atoms: readonly Atom[],
  width: number,
  indent: number,
  layout: BlockLayout,
): Doc[] {
  const parts: Doc[] = [];
  for (const text of wrap(atoms, width, indent, layout)) {
    if (parts.length > 0) {
      parts.push(hardline);
    }
    parts.push(text);
  }
  return parts;
}
