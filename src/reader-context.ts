/**
 * THE VOCABULARY THE READER'S CONTEXT IS SPELLED IN, and the reading
 * a prose node records.
 *
 * A leaf module with no imports of its own, and it has to be one: the
 * AST declares a prose node's `reading` field, the line registry keys
 * its interrupting tables on the same context, and the shared verdict
 * function (src/line-verdict.ts) builds the context both halves ask
 * in. A type three layers read cannot live inside any one of them
 * without making the cycle gate's graph a loop
 * (scripts/metrics/graph.ts).
 *
 * Every declaration here is re-exported from the layer that used to
 * own it - {@link DescriptionDelimiter} from src/ast.ts, the four
 * context types from src/parse/line-shapes.ts - so no existing
 * importer has to learn a second address for a name it already had.
 */

/**
 * The four delimiters a description-list term may carry
 * (`DescriptionListRx`, rx.rb:336).
 *
 * It decides STRUCTURE, not spelling: `DescriptionListSiblingRx` is
 * keyed on it (parser.rb:1225, rx.rb:340-345), so a `:::` term inside
 * a `::` list opens a nested list rather than continuing the one it
 * sits in.
 *
 * Declared in this leaf and re-exported by src/ast.ts, and IMPORTED
 * by src/parse/line-shapes.ts so that `parseDescriptionListLine`
 * returns the narrowed value at the pattern that already knows it: the delimiter group is `;;|:{2,4}`,
 * which is exactly these four spellings. Narrowing later instead would
 * make a builder assert what the pattern proved, and would leave the
 * classifier's `dlistTerm.delimiter` a bare string every consumer
 * re-checks.
 */
export type DescriptionDelimiter = "::" | ":::" | "::::" | ";;";

/**
 * Which kind of paragraph is open. Each value names the Ruby path
 * that reads those lines:
 *
 * - `paragraph` is `read_paragraph_lines` with a falsey `break_at_list`,
 *   i.e. `StartOfBlockProc`: only a delimited block or a block
 *   attribute line (which includes `[[anchor]]`) ends it.
 * - `listItemText` is the lines that go into a ulist/olist/colist
 *   item's FIRST block, the one `parse_list_item` may fold back into
 *   the item's own text (`list_item.fold_first` fires on `blocks[0]`
 *   alone, parser.rb l.1384). Where it stops is `listItem`'s answer
 *   MINUS the block anchor: an `[[anchor]]` standing here is
 *   `BlockAttributeLineRx` metadata for the very block `fold_first`
 *   merges away, id and all, so the oracle emits no id (see
 *   RAW_BLOCK_ANCHOR_CONTEXTS).
 * - `listItem` is a LATER block of the same item, read with
 *   `read_paragraph_lines reader, skipped == 0 && options[:list_type]`
 *   (parser.rb l.764). A first block exists by then, so an
 *   `[[anchor]]` opens a SECOND one and keeps its id, and the anchor
 *   ends this paragraph from any position.
 *   Both stop at a sibling or nested marker (`AnyListRx`,
 *   `is_sibling_list_item?`) and at a description-list term. For
 *   `listItem` that is the `skipped == 0` half of the cited line and
 *   not an unconditional claim about later blocks: a block opened
 *   ACROSS a blank line gets a falsey `break_at_list` and is
 *   `listContinuation` instead, which is the choice `bodyContext`
 *   makes (src/parse/lines/reader.ts).
 * - `listContinuation` is a paragraph a `+` attached to a list item.
 *   It is NOT a blend of the other two: `parse_list_item` parses it
 *   with `read_paragraph_lines` and NO `break_at_list`, so it takes
 *   the plain-paragraph set; the only markers that end it are the
 *   ones `read_lines_for_list_item` already stopped at, i.e. the
 *   OPEN list's own marker style (`is_sibling_list_item?`), which
 *   the caller supplies as `openListStyle`.
 * - `dlistItem` is the description of a `term:: desc` item. Widest
 *   set: `parse_list_item` parses the lines after the term with
 *   `text_only: nil` (a full `next_block`), and then `fold_first`
 *   merges the result back into the item text ONLY when it is a
 *   plain paragraph. So every shape `next_block` turns into a
 *   non-paragraph block (admonition, block macro, break, anchor)
 *   ends the description, while block metadata that a paragraph
 *   absorbs (a block title, an attribute entry) does not.
 * - `dlistItemTextOnly` - the description of a term line that
 *   carries NO text of its own (`term::`, the description on the
 *   lines below). `parse_list_item` passes `text_only: has_text ?
 *   nil : true` (parser.rb l.1367-74). `next_block` reads `text_only`
 *   at FOUR points and TWO of them decide an interrupting set: the
 *   layout-break arm is skipped (`!textOnly && layoutBreakChars[ch0]`,
 *   index.cjs l.10991) and so is the admonition arm, which the
 *   paragraph branch reaches only past `if (textOnly)` (index.cjs
 *   l.11282). The other two do not reach this table. One chooses
 *   whether an indented run's `//` lines are comments
 *   (`skip_line_comments: !!textOnly`, index.cjs l.11260), which the
 *   reader carries as the description's `comments` fact instead
 *   (lines/list-read.ts). One chooses paragraph over literal for an
 *   indented line (`textOnly || contentAdjacent === 'dlist'`,
 *   index.cjs l.11263), and it cannot decide anything here because
 *   `contentAdjacent` is already `'dlist'` whenever `textOnly`
 *   survives to be read - `if (textOnly && skipped > 0)` nulls it
 *   otherwise (index.cjs l.10878-81).
 *   So what is left for the SETS is `dlistItem`'s ANY-LINE set with
 *   its FIRST-LINE set narrowed to the one shape those two
 *   exemptions leave standing, a block macro. ORACLE,
 *   probed under `term1::`: a block macro, a delimiter, a list
 *   marker, a sibling term and an `[[anchor]]` end it; an admonition
 *   label, `'''`, `<<<` and a Markdown rule do not. The anchor ends
 *   it because `parse_block_metadata_line` runs AHEAD of the ladder
 *   and is gated by nothing: it takes the anchor as metadata for a
 *   block of its own, and that block is outside the item (the
 *   description's `<dd>` is gone and the paragraph below carries the
 *   `id`).
 * - `literalParagraph` is the indented lines of a literal paragraph.
 *   `next_block`'s `indented && !style` branch calls
 *   `read_paragraph_lines reader, (skipped == 0 ? options[:list_type]
 *   : nil)`, so at document level `break_at_list` is nil and the set
 *   is exactly the plain-paragraph one (`StartOfBlockProc`). It is a
 *   context of its own rather than an alias for `paragraph` because
 *   the READER treats the lines differently (verbatim, not reflowed)
 *   and because inside a DESCRIPTION item one more line ends it: the
 *   item scan slurps an indented run through a `read_lines_until`
 *   that breaks at a sibling term, and passes that break for a dlist
 *   alone (parser.rb l.1490-1495). That half of the row lives in
 *   line-shapes-interruption.ts, where the enclosing list is read.
 * - `verbatimStyled` is a paragraph opened under a held VERBATIM
 *   style (`[source]`, `[listing]`, `[literal]`, `[verse]`:
 *   VERBATIM_STYLES, asciidoctor.rb:276; NOT `[pass]`, oracle-pinned).
 *   Behavior AT DOCUMENT LEVEL is `read_lines_until
 *   break_on_blank_lines: true, break_on_list_continuation: true`
 *   (parser.rb:1026-1028): blank lines are structural to the reader,
 *   so the set is the lone `+` and nothing else. The `+` holds at
 *   every position because Ruby's `line_read` gate (reader.rb:414 and
 *   l.426) is false only for the styled block's OPENING line, which
 *   Ruby unshifts (parser.rb:565) and our reader consumes at open, so
 *   every position this classifier sees corresponds to `line_read ===
 *   true`. INSIDE A LIST ITEM the answer is a different set entirely,
 *   because the item scan has already cut the buffer; that reading
 *   lives in line-shapes-interruption.ts. Pinned against the oracle
 *   at document level, both positions, in
 *   tests/conformance/interruption.test.ts, and in every reachable
 *   state by tests/conformance/reader-context-grid.test.ts.
 */
export type ParagraphContext =
  | "paragraph"
  | "listItemText"
  | "listItem"
  | "listContinuation"
  | "dlistItem"
  | "dlistItemTextOnly"
  | "literalParagraph"
  | "verbatimStyled";

/**
 * The list a confined reader is inside, in the two kinds Asciidoctor
 * tells apart when it asks whether a line is a sibling of it
 * (`is_sibling_list_item?`, parser.rb l.2280-2285): a marker list
 * carries the marker STYLE its items share, and a description list
 * carries the term DELIMITER its items share. The two are matched by
 * different grammars - `ListRxMap` plus `resolve_list_marker` for a
 * marker, `DescriptionListSiblingRx` keyed on the delimiter for a
 * term (rx.rb l.340-345) - so the kind has to travel with the value
 * rather than be guessed back out of it.
 */
export type OpenList =
  | {
      /** A ulist, olist or colist. */
      readonly kind: "marker";
      /** The style its items share (see {@link listMarkerStyle}). */
      readonly style: string;
    }
  | {
      /** A description list. */
      readonly kind: "description";
      /** The term delimiter its items share. */
      readonly delimiter: DescriptionDelimiter;
    };

/**
 * What a DESCRIPTION item's own scan did at the run of block
 * attribute lines a line heads - the third of
 * `read_lines_for_list_item`'s cuts (parser.rb l.1462-1482) and the
 * only one that is not a fact about the line.
 *
 * Ruby does not decide at the `[...]` line. It reads FORWARD over the
 * run of further attribute lines and blanks (l.1464-1470) and lets
 * the first line PAST the run decide: a list item that is not a
 * sibling of the open list keeps the run inside the item
 * (l.1471-1472), and a delimited block line, an ordinary line or a
 * sibling ends the item in front of the whole run (l.1466-1467,
 * l.1473-1474, unshifted at l.1478-1481). `[a]` / `[b]` / `* n` and
 * `[a]` / `[b]` / `x` differ only past their second line, so no
 * single following line decides it and
 * {@link ReaderContext.nextLine} cannot carry it.
 *
 * A READING rather than a shape test, because the asker is what
 * knows: a confined reader's lines are the item scan's own output and
 * every one of them was read past, while an asker holding the lines
 * BELOW a line - the printer deciding what its next output line may
 * be - reads the run for itself.
 */
export type AttributeRunReading =
  /**
   * The scan read past the run: it kept the run in the item, or it
   * never looked at all (the line heads no attribute run, no
   * description list is open, or another arm buffered the line).
   */
  | "runIsInTheItem"
  /** The scan ended the item in front of the run. */
  | "runEndsTheItem";

/**
 * HOW THE READER READ THIS BLOCK, recorded so the printer can ask the
 * reader's own question of a line it is about to write instead of
 * approximating it with a predicate over a word.
 *
 * The printer packs a prose block's words into output lines, and every
 * line it writes is read back by the classifier that read the source.
 * What a line MEANS there is a function of the line's bytes and of
 * two facts about the block around it: which interrupting set is open
 * (the context) and which list, if any, stands around it. Neither is
 * a function of the block's own bytes, so neither can be recovered
 * from the tree: the same words are a paragraph's own text at
 * document level and a nested list at a `+`-attached one, and a `-`
 * marker line is a sibling inside one list and prose inside another.
 *
 * TWO FIELDS AND NO MORE, because the other five of
 * {@link ReaderContext} are fixed at a continuation position rather
 * than the block's to record. `firstLineAfterStart` and `nextLine`
 * belong to the LINE and travel with the position the printer asks
 * at; the remaining three are what an open paragraph means -
 * `substitutedContentAbove` and `markerLineWins` are block-START
 * questions that a line inside an open block never reaches, and
 * `attributeRun` is `runIsInTheItem` wherever the lines came out of
 * an item scan, which is every line of every prose block. The one
 * producer of the full context is `continuationContext`
 * (src/line-verdict.ts), and both the reader's scans and the printer
 * call it, so the fixed five have one spelling.
 *
 * SURVIVING BYTES: the fact this records is the READING itself. The
 * printer's output re-reads into a block with the same context and
 * the same enclosing list, or the output is not the document that
 * went in, which is what the reparse gate measures.
 */
export interface BlockReading {
  /**
   * Which interrupting set the block's lines below its first are read
   * against ({@link ParagraphContext}).
   */
  context: ParagraphContext;
  /**
   * The list open AROUND the block, as `is_sibling_list_item?` reads
   * it, or undefined at document level ({@link OpenList}).
   */
  openList: OpenList | undefined;
}
