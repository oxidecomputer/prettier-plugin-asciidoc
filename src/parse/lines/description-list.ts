/**
 * The dlist-local half of the list machinery: the questions a
 * description list answers differently from a `*` or `.` list, one
 * Ruby region per function, each citing its lines. Everything the two
 * share stays in list-reader.ts, which carries the item scan itself.
 *
 * A sibling file rather than more of list-reader.ts because that file
 * is at 397 of the 450 code lines `max-lines` allows, and this work
 * does not fit under the ceiling there. The split follows item-tail.ts:
 * one Ruby region per file, so a reader following an arm never leaves
 * the range the file cites. Every Ruby line number here is against
 * Asciidoctor core 2.0.26, the revision `@asciidoctor/core` 4.0.11
 * bundles, exactly as list-reader.ts's are.
 */
import {
  endsDescriptionLine,
  interruptsParagraph,
  isDescriptionListLine,
  startsItemBlockLine,
} from "../line-shapes.js";
import {
  parseDescriptionListLine,
  parseDescriptionSiblingLine,
} from "../line-shapes-description.js";
import type { DescriptionDelimiter, DescriptionPrinting } from "../../ast.js";
import {
  delimiterKind,
  holdsDescriptionListSeparator,
  isLiteralLine,
  metadataLineKind,
  parseListMarker,
  type DlistTermKind,
} from "./classify.js";
import type { SourceLine } from "./split.js";

/**
 * Whether a line continues an OPEN description list, and if so what
 * term it carries. Ruby asks this with the pattern its list is keyed
 * to (`sibling_pattern = DescriptionListSiblingRx[match[2]]`,
 * parser.rb l.1225) rather than with `DescriptionListRx`, and it asks
 * it of every line of an item, not only of the line after one
 * (`is_sibling_list_item?`, parser.rb l.2280-2282).
 *
 * The answer is a {@link DlistTermKind}, the same value the
 * classifier's own `dlistTerm` arm produces for the term that OPENED
 * the list, so an opening and a sibling are one type and nothing
 * downstream has to tell them apart.
 * @param text - one rstripped source line, as the classifier reads
 *   lines
 * @param delimiter - the delimiter the open list's first term used
 * @returns the sibling term, or undefined when the line does not
 *   continue that list
 */
export function descriptionSibling(
  text: string,
  delimiter: DescriptionDelimiter,
): DlistTermKind | undefined {
  const sibling = parseDescriptionSiblingLine(text, delimiter);
  if (sibling === undefined) {
    return undefined;
  }
  return {
    kind: "dlistTerm",
    indent: text.length - text.trimStart().length,
    delimiter,
    ...sibling,
  };
}

/**
 * What Ruby's search for a nested list made of a line: the whole of
 * `(within_nested_list ? [:dlist] : NESTABLE_LIST_CONTEXTS).find {|ctx|
 * ListRxMap[ctx] =~ this_line}` and the test that rides on its
 * result, asked at all three sites that look for one (parser.rb
 * l.1503-1508, l.1533-1536, l.1562-1568). `undefined` is Ruby's nil:
 * the line opens no nestable list.
 *
 * `textlessTerm` is the arm that matters twice over: it sets
 * `within_nested_list` like the others AND returns `has_text` to
 * false ("get greedy again"), which is the whole of
 * `nested_list_type == :dlist && $3.nil_or_empty?`. A term with an
 * inline description does not, because the item that line opens
 * already has its text.
 *
 * ORDER, and why the marker is asked first: Ruby's `find` walks
 * `[:ulist, :olist, :dlist]` (asciidoctor.rb l.315), so a line that
 * is both a marker item and a term (`* a:::`) is claimed by the ulist
 * arm and lowers nothing. A callout marker is not in that set, which
 * is why the variant is excluded rather than the whole marker parse -
 * `<1> t:: d` is a nested description list.
 *
 * `descriptionsOnly` is the OTHER set. Two of the three sites narrow
 * the search to `[:dlist]` once `within_nested_list` is up (l.1503,
 * l.1562) and the third never does (l.1530). The two sets part
 * company on exactly the line above: inside a nested list `* a:::`
 * IS read as a term and the item gets greedy again. ORACLE: `t:: d` /
 * `* one` / `* a:::` / blank / `x` renders `x` inside the item, which
 * only the narrowed set reaches.
 *
 * `$3.nil_or_empty?` collapses to "the group is absent" because
 * `Helpers.prepare_source_string` rstrips every line before the
 * parser sees it: the description group is reached through `[ \t]+`,
 * so a PRESENT group always has a non-blank character in it.
 * @param text - one rstripped source line
 * @param descriptionsOnly - whether the search set is narrowed to
 *   `[:dlist]`, which it is at the two sites that ask it while
 *   `within_nested_list` already stands
 * @returns which nestable context claimed the line, or undefined when
 *   none did
 */
export function nestedListKind(
  text: string,
  descriptionsOnly: boolean,
): "marker" | "term" | "textlessTerm" | undefined {
  if (!descriptionsOnly) {
    const marker = parseListMarker(text);
    if (marker !== undefined && marker.variant !== "callout") {
      return "marker";
    }
  }
  const term = parseDescriptionListLine(text);
  if (term === undefined) {
    return undefined;
  }
  return term.descriptionStart === undefined ? "textlessTerm" : "term";
}

/**
 * What the look-ahead decides about a run of block attribute lines:
 * the run stays in the item and the read resumes past it, or it does
 * not and the item ends in front of the whole run. The resume index
 * rides on the arm that has one, so there is no `end` to be wrong
 * about on the arm that does not.
 */
export type AttributeRun =
  | {
      /** The run joins the item. */
      readonly concat: true;
      /** Index past the run, where the item's read resumes. */
      readonly end: number;
    }
  | {
      /** The run is unread and the item ends in front of it. */
      readonly concat: false;
    };

/**
 * What a `[...]` line inside a description item turns out to be:
 * Ruby's look-ahead at parser.rb l.1462-1482. The run
 * (`block_attribute_lines`, blank lines included, l.1468) is buffered
 * and the first line PAST it decides - a nested list item concats the run into the item
 * (l.1471-72), anything else unshifts it and breaks the item
 * (l.1478-81).
 *
 * The sibling test is why the delimiter is a parameter: l.1471 keeps
 * the run only for a list item that is NOT a sibling of this list,
 * because a sibling ends the item and takes its own metadata with it.
 *
 * ONE DIVERGENCE, at the stream's end. Ruby's `while` falls out with
 * `interrupt` never assigned, so the run is neither concatenated nor
 * unshifted: those lines are simply gone from the document
 * (oracle-confirmed - `t:: d` / `[square]` renders the list and
 * nothing else). A formatter may not drop bytes, so the run is kept
 * where Ruby's reader position leaves it, inside the item.
 *
 * The oracle wins, and it does here: the oracle binds RESULTS, and
 * the kept run renders exactly what Ruby's dropped one did, which is
 * nothing - it opens no block at the end of an item. What differs is
 * an EXTENT no render can show. If a render ever disagreed the oracle
 * would decide and the bytes would have to go; the rows in
 * tests/parser/description-list.test.ts pin the shape so that a
 * later change to it is a decision and not a slip.
 * The walk indexes `lines` where Ruby peeks through a
 * `PreprocessorReader`, so a conditional directive inside a run is
 * read as itself rather than as whatever
 * `preprocess_conditional_directive` would put there (reader.rb
 * l.844-848). That is the file's standing treatment of a look-ahead:
 * the literal slurp and the blank skip index raw too, and
 * `activeContent` (list-reader.ts) is the one arm that models
 * directive transparency, because it is the one where the oracle
 * showed the difference.
 * @param lines - the lines the item is being read from
 * @param at - index of the `[...]` line the arm just read
 * @param delimiter - the delimiter the open list's first term used
 * @returns what the run does, or undefined when the line opens no
 *   run and the arm does not claim the turn
 */
export function attributeRunAhead(
  lines: readonly SourceLine[],
  at: number,
  delimiter: DescriptionDelimiter,
): AttributeRun | undefined {
  // Ruby's `(this_line.start_with? '[') && (BlockAttributeLineRx
  // .match? this_line)` (l.1463), asked here rather than at the call
  // site so that the arm's whole condition is one question with one
  // answer.
  if (!isBlockAttributeLine(lines[at].text)) {
    return undefined;
  }
  // The `[...]` line itself is already in the run (l.1464); the walk
  // starts at what follows it.
  let end = at + 1;
  for (;;) {
    const next = lines.at(end);
    if (next === undefined) {
      return { concat: true, end };
    }
    if (delimiterKind(next.text) !== undefined) {
      return { concat: false }; // l.1466-67
    }
    if (next.text === "" || isBlockAttributeLine(next.text)) {
      end += 1; // l.1468-70
      continue;
    }
    if (
      isAnyListLine(next.text) &&
      descriptionSibling(next.text, delimiter) === undefined
    ) {
      return { concat: true, end }; // l.1471-72
    }
    return { concat: false }; // l.1473-74
  }
}

/**
 * `BlockAttributeLineRx` (rx.rb l.184), asked through the registry's
 * accessor rather than its patterns. Ruby's one pattern is two here -
 * the attribute list and the `[[anchor]]` alternative it also carries
 * - and `continuationMetadataKind` reports which of them matched
 * (line-shapes.ts states the same split). Its earlier arms cannot
 * steal a line from this test: a block title is `^\.` and an
 * attribute entry `^:`, and Ruby's own guard here is
 * `this_line.start_with? '['`.
 * @param text - one rstripped source line
 * @returns true when the line is a block attribute list
 */
function isBlockAttributeLine(text: string): boolean {
  const kind = metadataLineKind(text);
  return kind === "attributeLine" || kind === "anchor";
}

/**
 * `AnyListRx` (rx.rb l.274): a line that opens an item of ANY of the
 * four list kinds, which is the one place a list is asked about
 * without a context to key on. The four `ListRxMap` patterns gathered
 * by the classifier's own accessors rather than by a fifth pattern,
 * so this question and the classification can never disagree. Ruby's
 * gathered spelling is deliberately looser than the four it stands
 * for (unbounded `\*\**` and `\.\.*` against `{1,5}`), a pre-existing
 * gap line-shapes.ts records where the marker sources are written.
 * @param text - one rstripped source line
 * @returns true when the line begins a list item of any kind
 */
function isAnyListLine(text: string): boolean {
  return parseListMarker(text) !== undefined || isDescriptionListLine(text);
}

/**
 * One description item's recorded run, written the way an author
 * wrote it: the item's own opening, the term line's inline
 * description, and the rest lines under it.
 *
 * THE INPUT DIALECT is the reader's: every line here is one the
 * scan recorded, rstripped, exactly as `DescriptionItemNode`'s
 * `textLines` documents them (src/ast.ts). The conditions read the
 * lines as they stand and change none of them; where a shape test
 * needs the dialect to hold, the registry rstrips again rather than
 * trusting the caller.
 *
 * The term and its delimiter are in `termHead` and in no condition's
 * DOMAIN. They are the opening the printer replays and never moves,
 * and a domain that included them would refuse every item alive,
 * since `t::` is itself a term separator.
 *
 * `follower` is the one field that is not the run's own bytes, and it
 * is here because a WRAP does not only rewrite the description: it
 * writes a text line into the region the item's first block opens in.
 * A run whose bytes are all safe can still cost that block its
 * meaning, so the line under the run is inside the domain and the
 * conditions below say so.
 *
 * Built by the scan that records the answer
 * (src/parse/lines/description-list-node.ts), which passes an object
 * literal and names no type; exported for the suite that pins the
 * conditions row by row (tests/parser/description-list.test.ts), which
 * is its only reader by name.
 * @internal
 */
export interface DescriptionRun {
  /** The item's own term and delimiter, `t::`. */
  readonly termHead: string;
  /**
   * The term line's inline description, `""` when the term line
   * carries none.
   */
  readonly inline: string;
  /**
   * The item's recorded rest lines, in the reader's dialect: no
   * trailing whitespace, and no blank line (a blank ends the text run
   * these are recorded from).
   */
  readonly restLines: readonly string[];
  /**
   * The line the item's FIRST block opens on, when that block stands
   * at a zero-line gap directly under the description; `undefined`
   * where the item has no block or the source wrote a separator in
   * front of the first one.
   *
   * Only the first, and only at a zero gap, because a join and a wrap
   * move exactly one boundary: the one between the description and
   * what the source put directly under it. Every later block keeps the
   * neighbour it had.
   */
  readonly follower: string | undefined;
}

/**
 * What the printer may do with one description item's recorded lines:
 * write them back as they stand, or let the description's text be
 * joined onto the term line and wrapped. `"reflow"` needs every
 * condition below; anything else is `"replay"`, which is the default
 * and not a fallback.
 *
 * TWO PROPERTIES this function must keep, stated here so a later
 * change has to argue against them rather than drift past them:
 *
 * - It reads the run's recorded lines and NOTHING else. It never
 *   re-reads the source and never asks the printer what it produced,
 *   which is the shape that let a wrapped description re-read as a
 *   new term.
 * - It is asked ONCE, by the scan that recorded the lines, and the
 *   answer travels on the node (src/ast.ts, `DescriptionPrinting`).
 *   Asking it again in the printer would be a second place for the
 *   same question to be answered differently.
 *
 * ITS MEASURED DOMAIN, per the house rule that a totality claim names
 * what it measured.
 *
 * What has been measured so far is a SPLIT sweep, which is the
 * question a wrap actually asks: a 19-token hazard alphabet crossed
 * with two term heads (a one-word head, which can be a macro name,
 * and a two-word head, which cannot) over runs of three and four
 * words, 274,360 runs in all. Of those, 4,593 answer `"reflow"`;
 * every one of them was then broken at every place a wrap could
 * break it, 63,703 line layouts, and each layout's render compared
 * against the joined form's. Zero differ. The same sweep before the
 * pair clauses below is what found them: 6,460 runs answered
 * `"reflow"` and 829 of their layouts changed the render.
 *
 * What is CLAIMED is that sweep and the three whole-formatter grids
 * that hold it now that the printer reads this answer
 * (tests/format/description-sweep.ts): a TOKEN grid of 675 rows, the
 * hazard tokens crossed with five positions and five widths plus four
 * word-PAIR runs across a contiguous 25-width range; a CONTAINER grid
 * of 240 rows, ten payloads inside twelve enclosing containers at two
 * widths; a FOLLOWER grid of 3,456 rows, eighteen block shapes
 * standing under a description at a zero gap and at a blank, in every
 * container, at four widths; a UNIFORM-RUN grid of 160 rows, 32
 * punctuation characters repeated two to six times as the run's only
 * rest line; a MARKER grid of 180 rows, 30 marker spellings and their
 * lookalikes in three containers at two widths; and a GAP-FAMILY grid
 * of 288 rows, every `gap:*` family of the block-structure ledgers
 * spelled as a rest line and crossed with four containers, two
 * descriptions and three widths. Eleven
 * hand-written edge rows ride beside them, carrying the shapes no
 * product spells: the `;;`-in-`::` nesting pair and its reverse, the
 * widths at which the term line itself exceeds the budget, and the
 * comment-headed term. Every row is render-equal and a fixed point.
 *
 * The follower grid is one domain this claim used to leave out, and
 * leaving it out was a defect rather than a scoping choice: a wrap
 * writes a text line into the region the item's first block opens in,
 * so a run whose own bytes are all safe could still cost that block
 * its meaning. Measured before condition F: 220 of 1,920 documents
 * with a block under a description failed and 0 failed with the
 * verdict forced to `"replay"`; after it, 0 of 1,920.
 *
 * THE OTHER DOMAIN it left out is the one no predicate here can close
 * on its own: a line Asciidoctor opens a block on and this parser
 * reads as something else. C refuses the shapes the registry knows
 * and the uniform-run rule closes the delimiter class by shape
 * ({@link startsItemBlockLine}'s own citation), but a family outside
 * both is unknowable from inside this file. The standing net for it
 * is the gap-family gate, which crosses every `gap:*` family of the
 * block-structure ledgers with a join and turns red when a family is
 * added (tests/format/description-sweep.test.ts). A net rather than a
 * proof: it watches the shapes a ledger has met and nothing else, so
 * the shapes found outside it - a four-tilde fence, a `\u{2022}`
 * bullet - are the measure of what it cannot see.
 *
 * WHAT EACH NET CAN SEE, measured by removing one condition at a time.
 * The grids catch an UNDER-refusal: removing the content condition,
 * the separator condition, either wrap condition, the pair clauses or
 * the follower condition turns one of them red. They cannot catch an
 * OVER-refusal, because replaying is always render-equal and always a
 * fixed point, so widening the follower condition to a blanket refusal
 * on any zero-gap block leaves all three green. The byte rows in
 * tests/format/description-list.test.ts are the net for that
 * direction, and every one of those seven perturbations reddens them.
 *
 * It is NOT claimed that every run called `"reflow"` re-reads as the
 * same item at every width in every container. The conditions are
 * per-word and per-pair, so a shape needing three cooperating words,
 * or a hazard token outside the alphabet, is outside what was
 * measured; the whole-line reasoning that would support the wider
 * claim is what issue #109 asks for and nothing here provides.
 * @param run - the item's recorded run
 * @returns `"reflow"` when every condition holds, `"replay"`
 *   otherwise
 */
export function descriptionPrinting(run: DescriptionRun): DescriptionPrinting {
  // F, the follower: the line the item's first block opens on, where
  // the source put nothing between the two. A wrap writes a text line
  // into the region that block opens in, and four shapes stop being a
  // block the moment a text line stands above them, because
  // `parse_list_item` hands the item's lines to `next_block`, which
  // reads THIS_LINE - the block's own first line - to pick a block
  // context, and once that context is "normal paragraph" the rest go
  // through `read_paragraph_lines`, whose break condition
  // (`StartOfBlockProc`, `StartOfListProc`) knows none of them.
  // ORACLE, both positions: `t:: desc` / `NOTE: x` splits and
  // `t:: desc` / `more` / `NOTE: x` does not.
  //
  // THE CLASS IS CLOSED, and it is closed by asking the registry
  // rather than by listing it: `interruptsParagraph(line,
  // "dlistItem")` at a LATER position is the model's own answer to
  // "does this line end the item's open paragraph", and
  // tests/conformance/interruption.test.ts holds that model to the
  // oracle construct by construct. So the shapes this refuses are
  // exactly the ones the registry files as ending the description on
  // its FIRST line only (line-shapes.ts,
  // `DLIST_FIRST_LINE_INTERRUPTERS`: an admonition label, a block
  // macro, a thematic break and a page break), and a fifth shape
  // could only join them by joining that set, where its Ruby argument
  // would have to be written down beside the other four. Everything
  // the set does NOT hold either ends the paragraph from any position
  // (a delimiter, a block attribute line, an anchor, a `+`, any list
  // marker, a sibling term) and so survives a text line above it, or
  // never reaches this condition at all: a block title, an attribute
  // entry and a `//` line under a description are read as the item's
  // own text rather than as a block of it, so they arrive as REST
  // LINES and B refuses them per word.
  if (
    run.follower !== undefined &&
    !interruptsParagraph(run.follower, "dlistItem")
  ) {
    return "replay";
  }
  // C, content: every REST line is ordinary description text - not
  // indented, and not a line the reader would take for a block.
  //
  // TWO QUESTIONS, and the second is not the one B asks. B probes each
  // WORD, so it reaches every shape whose head lies inside one word or
  // inside a word plus a successor; a shape that needs SEVERAL words to
  // be itself is invisible to it and visible here. Measured, and each
  // of these two is a render loss when the line is joined away:
  // `_ _ _` is a markdown thematic break written as three words, and
  // `> quote` is a markdown blockquote whose head test is `'> '`. Both
  // are refused by asking the whole line and by nothing else. The
  // reverse redundancy is real and harmless: a single-word rest line
  // is refused twice.
  //
  // The INDENT is C's alone either way. It is refused rather than
  // normalized because a rest line's common indent is the input to
  // `adjust_indentation!` and decides literal against paragraph, and
  // it is the expensive half: `term::` / `  description` is idiomatic
  // AsciiDoc and refusing it is the honest cost of a per-line rule
  // that cannot see what the whole run would join to.
  //
  // Vacuously true for a description that lives entirely on its term
  // line, which is why B and not C guards that shape. A BLANK line is
  // not tested for either, because none reaches here: the recorded
  // lines are the ones the description's own text run consumed, a
  // blank ends that run, and the greedy read that crosses one leaves
  // it in the item's gap. Measured over the vendored corpus, of the
  // 381 description items the reader builds none records a blank.
  if (!run.restLines.every(isOrdinaryDescriptionLine)) {
    return "replay";
  }
  // The domain the remaining three read: the description's text, the
  // term line's inline part included and the term head excluded.
  const text = [run.inline, ...run.restLines];
  // S, separators: no word of that text may end in a term separator.
  // `DescriptionListRx`'s term group and every
  // `DescriptionListSiblingRx` variant end at a delimiter preceded by
  // a non-blank run or by nothing, so a joined line can match either
  // only through such a word. A separator INSIDE a word (`x::y`)
  // matches neither and is not refused.
  //
  // WHOLE-RUN, where the packer's own guard on the same hazard word
  // is per word and per line (`wordsToAtoms`'s `firstLineWordCount`,
  // src/print/reflow.ts). The two answer for two constructs: on a
  // plain paragraph's later line the word is text and only the MOVE
  // onto the first line is dangerous, while inside a description the
  // `is_sibling_list_item?` is asked of every line of the item
  // (parser.rb:1430, :2281), so there is no line the word is safe on
  // and the whole run replays. Neither guard may be widened into the
  // other's job.
  if (text.some(holdsDescriptionListSeparator)) {
    return "replay";
  }
  const words = text.flatMap(wordsOf);
  // B, wrap safety, and E, line-end safety: the two halves of one
  // question, since a wrap creates a line start and a line end at the
  // same point and safety at every start is not safety at every end.
  if (words.some(startsItemBlockLine)) {
    return "replay";
  }
  if (words.some((word) => endsDescriptionLine(word, run.termHead))) {
    return "replay";
  }
  // E's pair clauses: the shapes neither per-word probe can see.
  return closesAPairedLineShape(words) ? "replay" : "reflow";
}

/**
 * The description's words, in the unit `holdsDescriptionListSeparator`
 * already reads a line in: runs of anything but a space or a tab.
 * Matched rather than split, so an empty inline description yields no
 * words instead of one empty one. A filter after a split would say
 * the same thing and be inert, since every clause answers false on
 * the empty string; under the disclosure rule stated at
 * {@link startsItemBlockLine} the artifact is not produced instead of
 * being guarded against.
 *
 * NARROWER than the packer's own unit, which is
 * `ASCII_WHITESPACE_RUN` (`[\t\n\v\f\r ]+`, src/print/reflow.ts):
 * a line carrying a vertical tab, a form feed or a bare CR is one
 * word here and two there, so such a line could put a word at a line
 * start that was never probed. It is stated rather than fixed for two
 * reasons: the registry pattern that would fix it may not be imported
 * here (the classification pass is the only module allowed to name a
 * pattern), and the same narrowing is already the standing spelling
 * of the separator question this file calls beside it. What removes
 * the divergence is the reader normalizing those characters, which is
 * recorded as issue #68.
 * @param line - one rstripped source line
 * @returns its words, in order
 */
function wordsOf(line: string): readonly string[] {
  return line.match(/[^ \t]+/gv) ?? [];
}

/**
 * C's question about one rest line: is it ordinary description text?
 *
 * {@link startsItemBlockLine} asked of a whole LINE rather than of a
 * word, plus the two questions a word cannot carry - a line's INDENT
 * and its emptiness. So it refuses an indented line, a comment line, a
 * metadata line, an attribute entry, a block title, a delimiter, a
 * marker, a callout, a lone `+` and the markdown block heads that
 * predicate carries.
 *
 * NOT REDUNDANT with the per-word test beside it, and the difference is
 * measured rather than assumed: a shape that needs several words to be
 * itself is invisible to a word probe. `_ _ _` and `> quote` are the
 * two witnesses, both render losses when the line is joined away.
 * @param line - one recorded rest line, verbatim
 * @returns true when the line is ordinary description text
 */
function isOrdinaryDescriptionLine(line: string): boolean {
  return !isLiteralLine(line) && !startsItemBlockLine(line);
}

/**
 * E's PAIR clauses: the line shapes that constrain a line at BOTH
 * ends, which no per-word probe can see.
 *
 * `endsDescriptionLine` appends a fixed prefix and
 * `startsItemBlockLine` appends a fixed suffix, so between them they
 * decide a probe line's head and its tail from ONE word. A shape that
 * needs a particular head AND a particular tail is invisible to both
 * whenever a run supplies the two halves in different words. This
 * walks the run once and asks, for each shape with such a face,
 * whether an earlier word could open it and a later word close it.
 *
 * THE ENUMERATION, which is the argument that three clauses are all
 * of them. Asking the registry for a two-word line that matches where
 * neither the first word nor the first word with a probe suffix
 * matches returns five shapes:
 *
 * - `BLOCK_ATTRIBUTE_LINE` (`[a b]`), the bracket pair below.
 *   Probed: `t:: [a b] ccc` at width 12 is clean under every per-word
 *   test, wraps to `t:: [a b]` / `ccc`, is render-equal on pass 1,
 *   and on pass 2 the description's tail leaves the `dd`.
 * - `BLOCK_MACRO` (`image::y x[]`), the same closer with a different
 *   opener. Probed: `a b:: alpha image::y x[]` split after `alpha`
 *   renders an image block where the joined form renders text. The
 *   term-head spelling of `endsDescriptionLine` cannot catch this for
 *   ANY term, `a b` included: since #183 BLOCK_MACRO's target must
 *   start right after `::` with no whitespace, and a term line's own
 *   syntax always inserts the mandatory space (`term:: desc`), so its
 *   probe (`${termHead} p ${word}`) never matches BLOCK_MACRO whatever
 *   the term is. This word inside the run (`image::y`, no space after
 *   its own `::`) is what the per-word PAIR clause below still needs.
 * - `ATTRIBUTE_ENTRY` (`:a a:`), the colon pair below. Probed:
 *   `t:: alpha :a a: bravo` packed at width 9 puts `:a a:` on its own
 *   line, where the metadata loop drains it: the words are deleted
 *   from the render and a document attribute is set.
 * - `DESCRIPTION_LIST_LINE`, already refused by S, whose domain
 *   includes the bare `::` word every such pair needs.
 * - `ATTRIBUTE_CONTINUATION`, which is the value suffix of an entry
 *   the run is already refused for.
 *
 * All three clauses are word-PAIR reasoning, not whole-line
 * reasoning: none can tell whether a width exists that actually
 * places the closer at a line end, so each refuses whenever one
 * could. That knowingly over-refuses a realistic
 * `xref:x.adoc#p[P stylesheet section]`, whose width sweep from 8 to
 * 300 columns finds no width that loses a render or a fixed point.
 *
 * This is one face of issue #109 ("a wrapped line ending at `]`
 * re-reads as block metadata on any line of a packed block"). The
 * other, a SINGLE word that both opens and closes, needs a line that
 * starts with `[` and ends with `]`, and {@link startsItemBlockLine}
 * already refuses any run carrying a word that could start one.
 * Neither answer SOLVES #109: both decline. #109 stays open for every
 * other container, and the whole-line reasoning it asks for is what
 * would let a later change narrow the wrap conditions and these
 * clauses together instead of refusing whole runs.
 * @param words - the description's words, in order
 * @returns true when a shape an earlier word could open is closed by
 *   a later one
 */
function closesAPairedLineShape(words: readonly string[]): boolean {
  // Two standing openers, because the two closers differ. Each word
  // is asked as a CLOSER first and recorded as an OPENER after, so a
  // single word carrying both halves (`[ab]`) does not close itself:
  // that one is a per-word case and `startsItemBlockLine` has it.
  let bracketed = false;
  let entry = false;
  for (const word of words) {
    if (bracketed && word.endsWith("]")) {
      return true;
    }
    if (entry && CLOSES_ATTRIBUTE_ENTRY.test(word)) {
      return true;
    }
    bracketed ||= opensAnUnclosedBracket(word) || OPENS_BLOCK_MACRO.test(word);
    entry ||= OPENS_ATTRIBUTE_ENTRY.test(word);
  }
  return false;
}

// A word that could be the `name::target` head of a BLOCK_MACRO whose
// `[attrlist]` a later word closes: the macro's name class, its
// delimiter, and a target that has not yet reached the `[` (the
// target is barred from `[` and from nothing else). The name is left
// open WIDER than BLOCK_MACRO's own registered-name set (issue
// #183): this is a per-word probe with no closing bracket in view
// yet, so it cannot know whether the word it is looking at will turn
// out to be `image` or `custom` until a later word supplies the
// close. Refusing on any `name::` word is the conservative direction
// - it only declines a wrap this reader could otherwise take, never
// misreads a render - so staying wide here costs nothing the way
// BLOCK_MACRO's own wideness once did.
const OPENS_BLOCK_MACRO = /^[A-Za-z]\w*::[^\[]*$/v;

// A word that could be the `:name` head of an ATTRIBUTE_ENTRY whose
// closing `:` a later word carries: the opening colon, Ruby's
// optional leading bang, and then a name that has not yet reached its
// own closing colon. `ATTRIBUTE_ENTRY`'s name group is `[^:]*?`, so
// the head word may hold no second colon.
const OPENS_ATTRIBUTE_ENTRY = /^:!?\w[^:]*$/v;

// A word that could carry that entry's closing `:`, optional trailing
// bang included: a colon at the end and none before it, for the same
// reason the head word may hold none.
const CLOSES_ATTRIBUTE_ENTRY = /^[^:]*:$/v;

/**
 * Whether one word leaves a `[` open at its end, counted rather than
 * searched for so that `[a[b]` - which closes one of its two - still
 * answers yes. A `]` with nothing open is ordinary text and closes
 * nothing, which is why the count floors at zero rather than going
 * negative.
 * @param word - one whitespace-delimited word
 * @returns true when the word ends with a bracket still open
 */
function opensAnUnclosedBracket(word: string): boolean {
  let open = 0;
  for (const character of word) {
    if (character === "[") {
      open += 1;
    } else if (character === "]" && open > 0) {
      open -= 1;
    }
  }
  return open > 0;
}
