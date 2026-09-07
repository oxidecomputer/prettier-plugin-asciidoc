/**
 * THE WHITESPACE FACT: what one prose block's whitespace runs mean,
 * decided once over the block's inline nodes and recorded on the
 * block ({@link BlockWhitespace}, src/ast.ts).
 *
 * WHY THIS MODULE IS SHARED and not a fifth address in `src/parse`.
 * Two halves need the same answer and may not each spell it. The
 * READER records the fact, because the fact is about the source and
 * the reader is what holds it. The PRINTER reads the fact back and
 * may not re-derive it, which is only checkable if there is ONE
 * verdict function to point at. So the printer imports this module
 * rather than the parser: the layer rule keeps its list of parse-side
 * addresses and gains a module that belongs to neither side, exactly
 * as src/block-metadata.ts already is for the metadata vocabulary.
 *
 * WHAT THE ROWS ARE. {@link factOfRun} is the one construction site:
 * an ordered walk of the table, first match assigning. The order is
 * strongest arm first, which is what the arms' refinement licenses -
 * `verbatim` refines `bound` refines `free`, so a stronger arm's
 * output satisfies every weaker row's obligation, and a row that
 * replays a run's bytes has already satisfied a row that only wanted
 * its spelling.
 *
 * THE CONTRACT. Attributes supplied from OUTSIDE the document (`-a
 * hardbreaks` on a command line, an editor's own defaults) are out of
 * scope: the formatter reads the document's own text and nothing
 * else, so a block is a hardbreaks block here only when the document
 * itself says so.
 */
import type { BlockNode, InlineNode } from "./ast.js";
import { isBlockMetadata } from "./block-metadata.js";
import type { BlockWhitespace, WhitespaceFact } from "./whitespace-record.js";
import {
  childrenOf,
  hidesItsBytes,
  whitespaceRuns,
  type RunSide,
  type RunSite,
} from "./whitespace-runs.js";

/**
 * The block-level facts the whole-block rows read, all of them from
 * the DOCUMENT'S OWN TEXT (see the module docstring's contract).
 */
export interface WhitespaceContext {
  /**
   * The block carries the hardbreaks option, from its own attribute
   * list (`[%hardbreaks]`) or from a document attribute the source
   * sets (`:hardbreaks:`, `:hardbreaks-option:`).
   */
  readonly hardbreaks: boolean;
  /** The block declares a substitution set other than the default. */
  readonly nonDefaultSubs: boolean;
  /** The document sets `attribute-missing` to `drop-line`. */
  readonly dropLineOnMissingAttribute: boolean;
}

/**
 * The context of a block the source annotated with nothing and whose
 * document sets none of the three attributes: every whole-block row
 * answers no, and the run rows decide the block alone.
 */
export const PLAIN_WHITESPACE_CONTEXT: WhitespaceContext = {
  hardbreaks: false,
  nonDefaultSubs: false,
  dropLineOnMissingAttribute: false,
};

// An attribute entry line setting `hardbreaks` for the whole
// document: `sub_post_replacements` reads every newline of every
// block as a break while it stands (`hardbreaks-option` is the
// spelling `[%hardbreaks]` sets on a block; `:hardbreaks:` is the
// legacy document form and both are honoured).
const DOCUMENT_HARDBREAKS = /^:hardbreaks(?:-option)?:/mv;

// An attribute entry line making an unresolved reference drop the
// whole line it stood on (substitutors.rb l.239-248).
const DOCUMENT_DROP_LINE = /^:attribute-missing:[ \t]+drop-line[ \t]*$/mv;

/**
 * The whole-block facts the DOCUMENT's own attribute entries set.
 *
 * Read off the source text rather than off the attribute-entry nodes
 * because the answer is wanted before the first block is built, and
 * it is deliberately POSITIONLESS: an entry anywhere in the document
 * arms the row for every block of it, including blocks above the
 * entry. That is wider than the reference, which applies an attribute
 * from the line it is set on, and wider in the safe direction - a
 * block bound where the reference would have left it free keeps bytes
 * the render did not need, where the other error respells a break the
 * render reads. Unsetting is not read for the same reason.
 * @param source - the whole document, as written.
 * @returns the document's half of every block's context.
 */
export function documentWhitespaceContext(source: string): WhitespaceContext {
  return {
    hardbreaks: DOCUMENT_HARDBREAKS.test(source),
    nonDefaultSubs: false,
    dropLineOnMissingAttribute: DOCUMENT_DROP_LINE.test(source),
  };
}

// The hardbreaks OPTION as a block attribute list spells it, in the
// two spellings `parse_style_attribute` accepts: the `%name`
// shorthand and the long `options=` form.
const BLOCK_HARDBREAKS =
  /(?:^|[,;])[^,;]*%hardbreaks\b|options?=["']?[^"']*hardbreaks/v;

// A declared substitution set. Any `subs=` at all: which sets are
// "default" is a question the lens cannot answer, so the row is
// stated over the DECLARATION and not over the set it names.
const BLOCK_SUBS = /(?:^|[,;])[ \t]*subs[ \t]*=/v;

/**
 * The block's own context: the document's, plus what the attribute
 * line standing over the block says.
 * Each field is the DISJUNCTION with what came in, so a run of
 * several attribute lines arms a row when any one of them does, and
 * a block with no attribute line at all never reaches here: its
 * caller walks past every node that is not one.
 * @param document - the context so far: the document's half, and any
 *   attribute line of the same run already read.
 * @param attrlist - the bracket interior of one attribute line.
 * @returns the context the block's whole-block rows read.
 */
function annotatedWhitespaceContext(
  document: WhitespaceContext,
  attrlist: string,
): WhitespaceContext {
  return {
    hardbreaks: document.hardbreaks || BLOCK_HARDBREAKS.test(attrlist),
    nonDefaultSubs: document.nonDefaultSubs || BLOCK_SUBS.test(attrlist),
    dropLineOnMissingAttribute: document.dropLineOnMissingAttribute,
  };
}

/**
 * The context of the prose block a reader is about to build: the
 * document's own half, plus whatever the metadata run standing over
 * it says.
 *
 * The WHOLE RUN, not the last line of it. A block's annotation is
 * released into the sequence before the block itself is built, so it
 * is the tail of `blocks`; but a run may hold several lines and only
 * some of them are attribute lists (`[%hardbreaks]` then `.Title`,
 * or two attribute lists, or an anchor between them). Asciidoctor
 * reads EVERY attribute line of the run onto the block that follows,
 * so this walks back while the block is metadata and takes each
 * attribute list's answer. Reading only the last line lost the
 * `<br>` of `[%hardbreaks]` over a titled paragraph.
 *
 * The walk stops at the first block that is not metadata, which is
 * what `isBlockMetadata` (src/block-metadata.ts) already answers for
 * the reader and the list hazard: one classification, so the run this
 * reads is the run the reader released.
 * @param document - the document's half of the context.
 * @param blocks - the block sequence so far; the run stands at its
 *   end.
 * @returns the context the block's whole-block rows read.
 */
export function contextAbove(
  document: WhitespaceContext,
  blocks: readonly BlockNode[],
): WhitespaceContext {
  let context = document;
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (!isBlockMetadata(block)) {
      return context;
    }
    if (block.type === "blockAttributeList") {
      context = annotatedWhitespaceContext(context, block.value);
    }
  }
  return context;
}

/** The fact of a run no row binds. One value: the arm carries nothing. */
const FREE: WhitespaceFact = { kind: "free" };

// The rows, in the order factOfRun walks them.

// Two or more hyphens standing as a whole word: the em-dash
// replacement's own dashes, still waiting for the boundary characters
// that would fire the row (`(?: |\n|^|\\)--(?: |\n|$)`,
// asciidoctor.rb l.498).
const OPEN_DASHES = /^-{2,}$/v;

// The same dashes behind the backslash the row's left class also
// accepts. A word ENDING this way carries its own left boundary, so
// the row on that side has already spent the character beside it.
const ESCAPED_DASHES = /\\-{2,}$/v;

// One or more hyphens standing as a whole word, which spell the row's
// pattern only when an attribute reference stands FLUSH against them
// and supplies the other half (`-{h}` with `:h: -`, issue #154).
const FUSABLE_HYPHENS = /^-+$/v;

/**
 * Whether one side of a run bears on the em-dash replacement: dashes
 * the row can read, or an attribute reference whose value this tree
 * does not hold and which may spell them.
 *
 * `NORMAL_SUBS` substitutes attributes before the replacement pass
 * (substitutors.rb l.16), so `{d}` is already whatever `:d:` was set
 * to by the time the row reads its boundaries. The answer is
 * therefore about the neighbour's KIND and not about its value: this
 * tree does not model what a reference expands to, and asking would
 * mean resolving the document's attributes at print time (issue
 * #149).
 * @param side - what faces the run there.
 * @returns true when the side is dash-bearing.
 */
function dashBearing(side: RunSide): boolean {
  switch (side.at) {
    case "word": {
      return (
        OPEN_DASHES.test(side.word) ||
        ESCAPED_DASHES.test(side.word) ||
        (side.fusedToReference && FUSABLE_HYPHENS.test(side.word))
      );
    }
    case "node": {
      // The character reference the row itself wrote is the one node
      // whose bytes ARE the dashes: the row fired, and its match was
      // wider than the reference by the one boundary character it ate
      // on each side (issue #155).
      return (
        hidesItsBytes(side.node) ||
        (side.node.type === "characterReference" && side.node.value === "--")
      );
    }
    case "edge": {
      return false;
    }
  }
}

/**
 * Whether the side is a reference, or hyphens fused to one - the
 * clause of row A7 that binds a one-character run rather than
 * releasing it, because the reference's value is not resolved.
 * @param side - what faces the run there.
 * @returns true for the conservative clause.
 */
function referenceEdge(side: RunSide): boolean {
  switch (side.at) {
    case "word": {
      return side.fusedToReference && FUSABLE_HYPHENS.test(side.word);
    }
    case "node": {
      return hidesItsBytes(side.node);
    }
    case "edge": {
      return false;
    }
  }
}

/**
 * The spelling a bound run keeps: the source's own.
 * @param bytes - the run.
 * @returns which of the two spellings it is.
 */
function spellingOf(bytes: string): "space" | "newline" {
  return bytes.includes("\n") ? "newline" : "space";
}

/**
 * Whether the run has NO WIDTH left for a row to read: the single
 * character the packer would write anyway, or a run whose width
 * cannot be written back at all because it carries a line break.
 *
 * A LINE BREAK is the second arm because of what the printer can
 * hold. Its unit of output is an atom, which is newline-free by
 * construction, so a run carrying a break has no place to keep its
 * OTHER bytes: what is available is the break itself, and the
 * strongest thing a row can say about such a run is its SPELLING.
 * Reducing it here rather than at the printer is what makes the
 * record a fixed point - the run the next read sees is the one
 * newline this wrote, and it takes the same row and the same arm.
 * @param bytes - the run.
 * @returns true when no row may read the run's width.
 */
function noWidthToRead(bytes: string): boolean {
  return bytes === " " || bytes.includes("\n");
}

/**
 * Row A7: a run with a dash-bearing edge.
 *
 * `do_replacement`'s `:none` restore eats exactly ONE flanking
 * character (substitutors.rb l.1456-1457), so a longer run leaves a
 * residue the fold would spend twice, and its bytes are read. A
 * consumed newline still satisfies `^`, so a break between two
 * dash-bearing edges arms the row twice where a space arms it once,
 * and the one-character run between them is bound to its spelling.
 * @param site - the run.
 * @returns the fact, or undefined where no side is dash-bearing.
 */
function dashRow(site: RunSite): WhitespaceFact | undefined {
  const front = dashBearing(site.before);
  const back = dashBearing(site.after);
  if (!front && !back) {
    return undefined;
  }
  if (!noWidthToRead(site.bytes)) {
    return { kind: "verbatim", bytes: site.bytes, by: "dashOrReferenceEdge" };
  }
  if (
    (front && back) ||
    referenceEdge(site.before) ||
    referenceEdge(site.after)
  ) {
    return {
      kind: "bound",
      to: spellingOf(site.bytes),
      by: "dashOrReferenceEdge",
    };
  }
  // Exactly one side, and it is dashes the row can still read: the
  // one character the packer writes is the one the row wants, so the
  // run is a fixed point either way and nothing is bound (270 of
  // 38,180 corpus runs keep a break opportunity here that a blanket
  // refusal would have cost).
  return FREE;
}

/** The `+` that a hard line break is spelled with, standing alone. */
const LONE_PLUS = "+";

/**
 * Whether the run stands directly in front of a hard-break token.
 * `HardLineBreakRx` (`^(.*) \+$`) keeps the extra space in the text,
 * so the run's own bytes are what the render holds.
 * @param site - the run.
 * @returns true for the run before a break.
 */
function beforeHardBreak(site: RunSite): boolean {
  return site.after.at === "node" && site.after.node.type === "hardLineBreak";
}

/**
 * Whether the run stands directly behind a lone `+` token. A newline
 * there would put ` +` at the end of an output line, where it is a
 * hard line break the source never wrote (issues #43, #45), so the
 * row that reads this writes a SPACE whatever the source spelled -
 * see its arm in {@link boundRow}.
 * @param site - the run.
 * @returns true for the run after a lone `+`.
 */
function afterLonePlus(site: RunSite): boolean {
  return site.before.at === "word" && site.before.word === LONE_PLUS;
}

/**
 * The VERBATIM rows, in table order: the run's own bytes are read, so
 * they are written back as they stand.
 * @param site - the run and everything the rows read.
 * @returns the fact, or undefined where no verbatim row matches.
 */
function verbatimRow(site: RunSite): WhitespaceFact | undefined {
  // A6: a run holding a tab. The em-dash row, the hard-break row, the
  // image target and the implicit menu all spell their boundary as
  // the literal SPACE, so a tab there is never the character they
  // read, and a tab after an escaped `\--` leaks the backslash into
  // the render. The row is WIDER than that authority BY POLICY: a
  // plain `a<TAB>b` renders as `a b` and would be free, so this also
  // freezes tabs no rule reads. It costs 2 of 5,175 corpus prose
  // lines and buys a rule with no neighbour test.
  //
  // A run carrying a LINE BREAK is outside the row. Its horizontal
  // bytes are not what any reader sees: the reference rstrips every
  // line before the parser reads one (`prepare_lines`, reader.rb
  // l.582), so a tab in front of the break is already gone, and a tab
  // behind it is a continuation line's indent, which the printer
  // rewrites to the block's own. Neither can be written back, so
  // claiming them would be a fact the printer destroys.
  if (!site.bytes.includes("\n") && site.bytes.includes("\t")) {
    return { kind: "verbatim", bytes: site.bytes, by: "tabInRun" };
  }
  // A8: the run before a hard break. `HardLineBreakRx` (`^(.*) \+$`)
  // keeps the extra space in the text, so the bytes are in the render.
  if (beforeHardBreak(site) && !noWidthToRead(site.bytes)) {
    return { kind: "verbatim", bytes: site.bytes, by: "hardBreakRun" };
  }
  // A10: an `image:` or `icon:` target, which the converter
  // URL-encodes into `src` whitespace and all (issue #224). A target
  // admits no line break, so no run of one ever carries one here.
  if (site.reach === "urlTarget") {
    return { kind: "verbatim", bytes: site.bytes, by: "macroTarget" };
  }
  // A7's verbatim outcome: a longer run beside a dash-bearing edge
  // leaves a residue the row's own restore does not eat.
  const dashes = dashRow(site);
  return dashes?.kind === "verbatim" ? dashes : undefined;
}

/**
 * The BOUND rows, in table order: the run's spelling is read, but not
 * its width.
 * @param site - the run and everything the rows read.
 * @param context - the block-level facts row A5 reads.
 * @returns the fact, or undefined where no bound row matches.
 */
function boundRow(
  site: RunSite,
  context: WhitespaceContext,
): WhitespaceFact | undefined {
  const to = spellingOf(site.bytes);
  // A5: every run of a hardbreaks block keeps its spelling, because
  // `sub_post_replacements` reads every newline there as a break.
  // Length and tabs still fold, so this is not the verbatim arm.
  if (context.hardbreaks) {
    return { kind: "bound", to, by: "hardbreaksOption" };
  }
  // A8's weaker arm: the run before a hard break that carries a line
  // break of its own keeps the break, which is all of it the printer
  // can write back.
  if (beforeHardBreak(site)) {
    return { kind: "bound", to, by: "hardBreakRun" };
  }
  // A9: the run after a lone `+`, bound to the SPACE and not to the
  // source's own spelling - the one row here whose two answers are
  // not the two spellings. What it reads is the `+` in front of it,
  // whose byte the printer re-emits; the run's own newline is read by
  // nothing, because every newline outside a hardbreaks block renders
  // as the space this writes. Writing that newline back is what
  // WOULD be read: it closes an output line with ` +`, which
  // `HardLineBreakRx` (rx.rb l.627) takes as a break the source did
  // not spell. The hardbreaks block, where the newline IS read, never
  // reaches here - row A5 stands above this one and binds every run
  // of such a block to its spelling.
  if (afterLonePlus(site)) {
    return { kind: "bound", to: "space", by: "lonePlusAhead" };
  }
  // A11: a `menu:` target admits no newline.
  if (site.reach === "plainTarget") {
    return { kind: "bound", to, by: "macroTarget" };
  }
  // A7's bound outcome.
  const dashes = dashRow(site);
  return dashes?.kind === "bound" ? dashes : undefined;
}

/**
 * The fact of ONE run: the table, walked in precedence order, first
 * match assigning.
 *
 * The order is by ARM before by row number, which is what the arms'
 * refinement licenses: replaying a run's bytes preserves whether it
 * was a newline and whether it held a tab, so the `verbatim` rows
 * satisfy the `bound` rows' obligations and may outrank them. That is
 * why the tab row (A6) stands over the hardbreaks row (A5) and the
 * lone-plus row (A9) rather than under them.
 *
 * SURVIVING BYTES, per arm. `verbatim` re-emits the very bytes it
 * read, so the decision's input survives into the output. `bound`
 * re-emits a byte of the same class (a space for a space, a newline
 * for a newline), which is the whole of what the rows that produce it
 * read - except row A9, whose fact is about the `+` STANDING BEFORE
 * the run, a byte the printer re-emits, and not about the run at all.
 * `free` is the absence of a decision: nothing is consumed, so
 * nothing can be destroyed.
 * @param site - the run and everything the rows read.
 * @param context - the block-level facts (row A5).
 * @returns the run's fact.
 * Exported for its unit test (tests/print/whitespace-fact.test.ts);
 * src reaches it through {@link blockWhitespace}.
 * @internal
 */
export function factOfRun(
  site: RunSite,
  context: WhitespaceContext,
): WhitespaceFact {
  // A13 is the last row and the total one: a run no row above reads
  // is free, which is what the battery measured for the 162 slots of
  // the roster that no rule's pattern reaches.
  return verbatimRow(site) ?? boundRow(site, context) ?? FREE;
}

// The unset form of the `set` directive: `{set:name!}`. Its arm of
// `sub_attributes` drops the WHOLE LINE the directive stood on
// (substitutors.rb l.211-227), so which line a byte of the block is
// on is a fact the render reads and no run of the block may move. The
// assigning form `{set:x v}` and the `counter` forms take the
// `drop_empty_line` branch instead (substitutors.rb l.224-230) and
// measure free, so they are not in the domain.
//
// The drop is the DEFAULT reading and not a document setting:
// `attribute_undefined` is `drop-line` out of the box
// (asciidoctor.rb l.153).
//
// A BYTE-LEVEL test, not a token one, because our reader does not
// tokenize the directive: `{set:x!}` reaches the printer as text.
// Issue #236 closes the gap by tokenizing it; this row's witness is a
// fixed point either way.
const UNSET_DIRECTIVE = /\{set:[^\}\n]*!\}/v;

/**
 * Whether the block's own bytes hold the unset `set` directive.
 * @param children - the block's inline children.
 * @returns true when a line of the block would be dropped.
 */
function holdsUnsetDirective(children: readonly InlineNode[]): boolean {
  return children.some((node) => {
    if (node.type === "text") {
      return UNSET_DIRECTIVE.test(node.value);
    }
    const nested = childrenOf(node);
    return nested !== undefined && holdsUnsetDirective(nested);
  });
}

/**
 * Whether the block holds any attribute reference at all.
 * @param children - the block's inline children.
 * @returns true when one stands anywhere in it.
 */
function holdsReference(children: readonly InlineNode[]): boolean {
  return children.some((node) => {
    if (hidesItsBytes(node)) {
      return true;
    }
    const nested = childrenOf(node);
    return nested !== undefined && holdsReference(nested);
  });
}

/**
 * The whole record for one prose block.
 *
 * Row A1 (a verbatim, literal, indented-literal, listing, source or
 * verse block) has no arm here because our reader answers it by
 * CONSTRUCTION: a verbatim style over a paragraph builds a
 * `delimitedBlock` whose content is a source slice
 * (`buildStyledParagraph`, src/parse/build/paragraph.ts), so no such
 * block is a prose block and none reaches this function.
 * @param children - the block's inline children, in order.
 * @param context - the block-level facts the whole-block rows read.
 * @returns the record the printer reads.
 */
export function blockWhitespace(
  children: readonly InlineNode[],
  context: WhitespaceContext,
): BlockWhitespace {
  // A2: a declared substitution set the lens cannot see through, so
  // the block is replayed by policy rather than by measurement.
  if (context.nonDefaultSubs) {
    return { kind: "replayed", why: "nonDefaultSubs" };
  }
  // A3: line membership is read, so no byte may change line.
  if (holdsUnsetDirective(children)) {
    return { kind: "replayed", why: "setOrCounterReference" };
  }
  // A4: the same question, from the document's side. Resolvability is
  // not decidable here, so any reference suffices: the
  // `attribute_missing` arm drops the line an unresolved reference
  // stands on (substitutors.rb l.236-248).
  if (context.dropLineOnMissingAttribute && holdsReference(children)) {
    return { kind: "replayed", why: "dropLineWithReference" };
  }
  return {
    kind: "reflowable",
    runs: whitespaceRuns(children).map((site) => factOfRun(site, context)),
  };
}
