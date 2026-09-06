/**
 * The spelling reduction order (issue #220): the well-founded order on
 * document spellings that every formatting rule strictly decreases.
 *
 * WHY IT EXISTS. Completion (docs/architecture.md, "The formal model")
 * orients each render-equal equation into a rule with a reduction
 * order, and a rule that does not strictly decrease the order is
 * exactly a rule some other rule can undo - a loop. Without an order,
 * orientation is per-case taste and termination is structural luck,
 * caught late by a second format pass differing. This module is the
 * order; {@link reductionBreach} is the check.
 *
 * THE ORDER. Five counts read left to right, so a count may rise only
 * if one to its left fell. Highest first:
 *
 *   1. compatibility forms - a construct spelled in a form AsciiDoc
 *      accepts for compatibility with another markup, where the
 *      language's own syntax spells the same thing.
 *   2. general-purpose forms - a construct said through a slot that
 *      says many things, where the language gives that construct a
 *      spelling that says only it.
 *   3. redundant syntax - syntax bytes past the shortest spelling of
 *      the same construct.
 *   4. padding - whitespace past the shortest spelling of the same
 *      construct.
 *   5. non-preferred forms - the losing member of an axis whose two
 *      spellings cost the same in every count above.
 *
 * WHY EACH COMPONENT EXISTS. Each answers to landed conversions no
 * other component orients. Only from LANDED conversions: an axis whose
 * conversion is parked gets no component, however settled its
 * orientation looks (`link:target[]` against the bare URL is that case,
 * issue #219).
 *
 * - A Markdown fence formats to `[source,ruby]` over `----`. Counting
 *   the syntax on both sides and the `ruby` hint on neither, that is
 *   six bytes in (two three-backtick runs) and seventeen out
 *   (`[source,]` plus two `----`). A Markdown thematic break `---`
 *   formats to `'''` and a Markdown heading `# T` to `= T`, both
 *   byte-for-byte ties, and `Tit` over `^^^` to `==== Tit`, a byte
 *   longer. No count of bytes orients any of those, and the fence it
 *   orients backwards.
 * - `[#id]` over a paragraph formats to `[[id]]` and a blank line, and
 *   `[NOTE]` over a paragraph to the `NOTE: ` label. The anchor's own
 *   spelling wins although it costs a byte and a newline.
 * - A delimiter run past its minimum, a heading's repeated closing
 *   run, a page break past `<<<`, an unconstrained inline mark where
 *   the constrained one suffices and the quotes around a positional
 *   attribute value are all syntax the shortest spelling of the same
 *   construct does without.
 * - Attribute-list padding (`[source, ruby]`), an attribute entry's
 *   value run, a psv cell's leading pad and a blank run past one blank
 *   are the same fact in whitespace.
 * - `:name!:` formats to `:!name:`: one construct, two spellings, the
 *   same cost in every count above. A recorded preference is the whole
 *   content of the last component, and it is where an axis lands when
 *   nothing else separates its two sides.
 *
 * WHY THEY ARE IN THIS SEQUENCE, and what that is worth. The evidence
 * forces each component's EXISTENCE; it does not force its RANK. No
 * landed conversion moves two components in opposite directions (0 of
 * the 44 roster rows, 0 of the 1,614 corpus cases), so nothing measured
 * separates this sequence from a permuted one. The sequence is a
 * RECORDED CHOICE, made on the argument that a component whose
 * conversions cost bytes at every lower one must outrank them - the
 * fence adds seventeen bytes of syntax, the anchor a byte and a newline
 * - and the coarser fact outranks the finer below that. It stands until
 * a conversion lands that moves two components apart, which is the
 * evidence that would confirm or refute it. What makes the sequence
 * TESTABLE meanwhile is a constructed pair in reduction-order.test.ts
 * ("the components are read in sequence"): it is the only thing in the
 * tree that fails if the comparison is read pointwise, as a sum, or
 * reversed.
 *
 * WHAT THE ORDER DELIBERATELY DOES NOT RANK. Line breaking, block
 * separation and the syntax the reader supplies on the author's behalf
 * are LAYOUT: the printer both joins short lines and splits long ones,
 * and its normal form ADDS a blank line between adjacent blocks and a
 * closing delimiter to an unterminated one. No well-founded order can
 * be strictly decreased by a rewrite that runs in both directions, and
 * one that counted bytes would be RAISED by the supplied syntax: 169 of
 * the 1,614 vendored corpus cases format to more bytes than they were
 * written with. So no component counts bytes outright; every component
 * counts OCCURRENCES of a spelling some rule replaces, and supplying
 * missing syntax mints no occurrence.
 *
 * WELL-FOUNDED. Five counts, each floored at zero, compared
 * lexicographically: a lexicographic product of finitely many copies
 * of the naturals has no infinite descending chain. A rewrite chain
 * that strictly decreases it is therefore finite, which is termination
 * (obligation 2) written as something a test can read.
 *
 * THE MEASURED DOMAIN, exactly. Non-increase is checked on all 1,614
 * vendored corpus cases (the `reduction` property,
 * tests/conformance/properties.ts) and on both spellings of every
 * roster row; strict decrease is checked on the roster's converging
 * rows (reduction-order.test.ts). What the recognizers cover is every
 * landed conversion on the confluence roster
 * (tests/conformance/confluence-variants.ts), which is the inventory
 * this order was derived from.
 *
 * WHAT THE MEASURE GUARANTEES, and what it does not. Two limits, both
 * measured rather than argued:
 *
 * 1. No recognizer fires on a spelling it does not name, so an axis
 *    nobody wrote a recognizer for weighs zero on both sides of a
 *    format and cannot move the order. But a recognizer can still
 *    misread a line's ROLE, because {@link lineRoles} is a
 *    delimiter-stack scan and not the reader: it knows which lines
 *    open, close and fill a delimited block, plus the header lines a
 *    doctitle swallows, and it knows nothing of lists, continuations or
 *    inline state. A role misread CAN move the order in either
 *    direction. It is not a hypothetical - reading the top of the stack
 *    instead of the whole of it, and reading a doctitle's author line
 *    as a section title, each minted a false compatibility form on the
 *    registry sweep's near-miss grids until this scan was narrowed to
 *    match the reader there. So: blind where no recognizer names the
 *    spelling; wrong only where the scan misreads a role; and neither
 *    claim is "never wrong".
 * 2. {@link reductionBreach} compares WHOLE-DOCUMENT weights, so it
 *    catches a non-decreasing PASS, not a non-decreasing step: a rise
 *    at one site and an equal fall at another cancel and are not
 *    reported. That is inherent to a weight order, and it is why the
 *    per-site obligation is stated on rules rather than measured here.
 *
 * WHERE IT IS NOT RUN, and why. Not on the registry sweep. The measure
 * reads a delimiter's minimum as a CONSTANT (four, or three past a
 * table hint) where the printer DERIVES one from the block's content,
 * and the sweep's grids are built of exactly those near misses: 540 of
 * its 34,131 default-tier rows are reported, and after the role
 * narrowing above every one of them rises at `redundantSyntax` on a
 * `longer-delimiter-inside` or `minimum-delimiter-inside` coordinate.
 * The grids also carry real printer behaviour worth someone's eyes
 * (issue #226), so the honest statement is that this measure cannot
 * separate the two there, not that there is nothing there. A
 * content-aware delimiter minimum is the extension that would reach
 * those coordinates.
 */

/**
 * One document's weight: the five counts, highest first.
 *
 * A record rather than a tuple so a failing gate names the count that
 * moved instead of an index.
 */
export interface SpellingWeight {
  /**
   * Constructs spelled for compatibility with another markup or with
   * an older AsciiDoc: a Markdown heading, thematic break or code
   * fence, and a section title underlined instead of marked with `=`.
   */
  readonly compatibilityForms: number;
  /**
   * Constructs said through a general-purpose slot that has a
   * dedicated spelling: the `[#id]` attribute shorthand for a block
   * anchor, and an `[NOTE]` style line over a paragraph. Both are
   * LANDED conversions; `link:target[]` against the bare URL belongs to
   * the same class and is deliberately NOT counted, because its
   * conversion is parked (issue #219) and the order derives from landed
   * evidence only.
   */
  readonly generalPurposeForms: number;
  /**
   * Syntax bytes past the shortest spelling of the same construct: a
   * delimiter run past its minimum, a heading's repeated closing run,
   * a page break past `<<<`, an unconstrained inline mark, and the
   * quotes around an attribute value that needs none.
   */
  readonly redundantSyntax: number;
  /**
   * Whitespace past the shortest spelling of the same construct: a
   * blank run past one blank, a pad after a comma in an attribute
   * list, an attribute entry's value run, and a psv cell's leading
   * pad.
   */
  readonly padding: number;
  /**
   * The losing member of an equal-cost axis: today the `:name!:`
   * spelling of an attribute unset, which prints as `:!name:`.
   */
  readonly nonPreferredForms: number;
}

/** The components in the order they are read, highest first. */
export const WEIGHT_COMPONENTS = [
  "compatibilityForms",
  "generalPurposeForms",
  "redundantSyntax",
  "padding",
  "nonPreferredForms",
] as const satisfies ReadonlyArray<keyof SpellingWeight>;

// A Markdown ATX heading: one to six `#` then a space or end of line.
// AsciiDoc's own spelling is the `=` run, and `# T` formats to `= T`.
const MARKDOWN_HEADING = /^#{1,6}(?: |$)/v;

// The three Markdown thematic breaks at exactly three marks, the
// length AsciiDoc's own `'''` competes with. A longer `*` or `_` run
// opens a sidebar or a quote and is a delimiter, not a break.
const MARKDOWN_THEMATIC_BREAK = /^(?:-{3}|\*{3}|_{3})$/v;

// The marks a section title may be underlined with (SETEXT_LEVEL_MARKS,
// src/parse/line-shapes.ts).
const SETEXT_MARKS = "=-~^+";

// A heading already marked at its head, in either spelling. A marked
// heading is a whole section title on its own, so the line under it is
// never its underline - `parse_section_title` reads one form or the
// other, never both.
const MARKED_HEADING = /^(?:={1,6}|#{1,6})[ \t]/v;

// The `[#id]` attribute shorthand carrying an id and nothing else -
// the spelling that formats to the anchor line `[[id]]`. A shorthand
// also carrying a role or an option (`[#id.role]`) says more than an
// anchor and is not respelled, so it is not counted.
const ANCHOR_SHORTHAND = /^\[#[\p{L}\d_][\p{L}\d\-_:.]*\]$/v;

// An admonition said as a block style line. It folds into the `NOTE: `
// label only over a paragraph, so a style line above a blank or a
// delimiter is not this form.
const ADMONITION_STYLE = /^\[(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]$/v;

// A page break: three or more `<`, and three is the minimum.
const PAGE_BREAK = /^<{3,}$/v;

// A heading closed by a repeat of its own marker run. `parse_section_title`
// admits the closing run only at the opening run's length, so
// `== T ====` is a heading whose title ends in `====`, not a closed one.
const CLOSED_HEADING = /^(?<markers>={1,6})[ \t]+\S.*[ \t]\k<markers>$/v;

// The unconstrained spelling of an inline mark: the doubled delimiter
// the reader accepts anywhere, where the constrained single mark
// carries the same node at a word boundary.
const DOUBLED_MARK = /\*\*|__|``|##/gv;

// A list marker run at a line's head. Its repeated `*` spells nesting
// depth and is not an inline mark at all, so it is cut off the line
// before the doubled-mark scan reads it.
const LIST_MARKER_RUN = /^[ \t]*[*.]+[ \t]/v;

// A block anchor with its reftext. Removed before the attribute-span
// scans below, because the printer's normal form for an anchor's
// reftext PUTS a space after the comma (`[[id, Reftext]]`) where an
// attribute list's takes one away: two constructs, two directions, and
// only the attribute list's is a pad this order ranks. That the two run
// opposite ways is issue #225, filed rather than settled here.
const ANCHOR_SPAN = /\[\[[^\[\]]*\]\]/gv;

// A bracketed attribute span on one line, without nesting: what the
// pad and quote recognizers read inside.
const BRACKET_SPAN = /\[[^\[\]]*\]/gv;

// A comma followed by a pad, inside an attribute span.
const COMMA_PAD = /,[ \t]/gv;

// A double quote, inside an attribute span.
const ATTRIBUTE_QUOTE = /"/gv;

// An attribute entry whose value is held off by more than one space.
const ATTRIBUTE_ENTRY_PAD = /^:[^\s:]+:(?<gap>[ \t]{2,})\S/v;

// A psv cell's leading pad: a cell separator with a space behind it.
const CELL_PAD = /\|[ \t]/gv;

// An attribute unset written with the bang after the name. The printer
// writes the bang-first spelling; the two are the same construct at the
// same cost.
const TRAILING_BANG_UNSET = /^:[^\s:!][^:]*!:[ \t]*$/v;

// The delimiter lines, by what their interior is. A leaf delimiter's
// interior is replayed byte for byte; a compound one's is read as
// syntax; a table's is rows; and a Markdown fence closes on three
// backticks whatever hint its opening line carried. The runs and their
// minimums are `DELIMITER_SOURCES` (src/parse/line-shapes.ts).
const VERBATIM_DELIMITER = /^(?<mark>[\-.+\/])\k<mark>{3,}$/v;
const COMPOUND_DELIMITER = /^(?<mark>[=*_~])\k<mark>{3,}$/v;
const TABLE_DELIMITER = /^[\|,:!]={3,}$/v;
const MARKDOWN_FENCE = /^```(?!`)/v;

// A leaf or compound delimiter run, for the length comparison: four is
// every one of those kinds' minimum.
const LEAF_OR_COMPOUND_DELIMITER = /^(?<mark>[\-.+\/=*_~])\k<mark>{3,}$/v;

// The byte-order mark, which `prepare_source_string` takes off before
// the first line is read.
const BYTE_ORDER_MARK = /^\uFEFF/v;

// Trailing whitespace, which the reader strips from every line.
const TRAILING_WHITESPACE = /\s+$/v;

// A document title on the first line. What follows it, up to the first
// blank, is header metadata: `parse_header_metadata` (parser.rb:1815)
// reads the AUTHOR line and then the REVISION line with `read_line` and
// no test at all, so `----` under a doctitle is an author, not a
// delimiter. Modelling that is what keeps a printer-supplied closing
// delimiter from reading as a section underline.
const DOCTITLE = /^=[ \t]+\S/v;

// How many lines `parse_header_metadata` can swallow: the author line
// and the revision line.
const HEADER_METADATA_LINES = 2;

/** What a delimited block opened by one line is like. */
interface OpenBlock {
  /** The line that closes it: a delimiter closes on its own bytes. */
  readonly close: string;
  /** True when its interior is replayed rather than read as syntax. */
  readonly verbatim: boolean;
  /** True when its interior is table rows. */
  readonly table: boolean;
}

/**
 * What one line is doing, as far as the order needs to know.
 *
 * `delimiter` covers both ends of a delimited block and a setext
 * underline is its own role, because the two are the same bytes in
 * different positions and every recognizer wants them apart. `header`
 * is the author and revision lines under a doctitle, which `read_line`
 * takes whatever they look like: they open nothing, underline nothing,
 * and are replayed rather than respelled.
 */
type LineRole = "delimiter" | "verbatim" | "underline" | "header" | "text";

/** One line with its role and whether it stands inside a table. */
interface ScannedLine {
  /** The line, with trailing whitespace removed. */
  readonly text: string;
  /** What the line is doing. */
  readonly role: LineRole;
  /** True when some enclosing open block is a table. */
  readonly inTable: boolean;
}

/**
 * The block a delimiter line opens, or undefined when the line opens
 * none.
 *
 * The runs and their minimums are `DELIMITER_SOURCES`
 * (src/parse/line-shapes.ts): four of a leaf character, three `=`
 * behind a table hint, `--` exactly, and a three-backtick fence whose
 * fourth backtick is refused.
 * @param text - one rstripped line
 * @returns what it opens, or undefined
 */
function opens(text: string): OpenBlock | undefined {
  if (VERBATIM_DELIMITER.test(text)) {
    return { close: text, verbatim: true, table: false };
  }
  if (COMPOUND_DELIMITER.test(text) || text === "--") {
    return { close: text, verbatim: false, table: false };
  }
  if (TABLE_DELIMITER.test(text)) {
    return { close: text, verbatim: false, table: true };
  }
  return MARKDOWN_FENCE.test(text)
    ? { close: "```", verbatim: true, table: false }
    : undefined;
}

/**
 * Whether a line underlines the line above it as a section title.
 *
 * `parse_section_title` admits an underline within one character of
 * the title's own length, which is the whole test; which level it
 * spells is not the order's business. A line ALREADY marked as a
 * heading is a whole title on its own and takes no underline.
 * @param text - the candidate underline, rstripped
 * @param above - the line above it, rstripped
 * @returns true when the pair is a title and its underline
 */
function underlines(text: string, above: string): boolean {
  const [mark = ""] = text;
  if (text.length < 2 || !SETEXT_MARKS.includes(mark)) {
    return false;
  }
  if (text !== mark.repeat(text.length) || MARKED_HEADING.test(above)) {
    return false;
  }
  return above.length > 0 && Math.abs(text.length - above.length) <= 1;
}

/**
 * Reads the document as lines with their roles, by carrying a stack of
 * open delimited blocks.
 *
 * The decisions, each matching the order Asciidoctor's own reader takes
 * them in: the lines a doctitle swallows are header metadata and are
 * syntax to nobody; a line matching an OPEN block's delimiter closes it
 * (and force-closes anything still open inside it) and is never
 * anything else; inside a verbatim block every line is content; and a
 * section title's underline is recognized before the same bytes could
 * open a block, because `is_section_title?` runs on the paragraph's
 * first line before its second line is offered to anything else.
 *
 * The first two exist because of what they cost when they were missing:
 * each let a closing delimiter the PRINTER supplied read as a section
 * underline, minting a compatibility form out of nothing on the
 * registry sweep's grids.
 * @param source - the whole document
 * @returns one entry per line, in document order
 */
function lineRoles(source: string): ScannedLine[] {
  // Read the way `prepare_source_string` reads: a leading byte-order
  // mark is not part of the first line, and every trailing whitespace
  // byte comes off, so a `----` closed with a carriage return or a
  // vertical tab behind it is the same delimiter line. Doing less here
  // would leave a block open that the reader closed.
  const texts = source
    .replace(BYTE_ORDER_MARK, "")
    .split("\n")
    .map((line) => line.replace(TRAILING_WHITESPACE, ""));
  const stack: OpenBlock[] = [];
  const scanned: ScannedLine[] = [];
  const header = headerMetadataLines(texts);
  for (const [at, text] of texts.entries()) {
    const inTable = stack.some((block) => block.table);
    const role: LineRole =
      at > 0 && at <= header ? "header" : roleOf(text, scanned[at - 1], stack);
    scanned.push({ text, role, inTable });
  }
  return scanned;
}

/**
 * The last line index the document header swallows, or -1 when the
 * document has no header.
 *
 * The header's lines are read by `read_line`, which tests nothing: a
 * `----` under a doctitle is the AUTHOR and a second one the REVISION,
 * neither opens a block, and nothing there underlines anything. Bounded
 * at two lines and at the first blank so a document that opens with a
 * title cannot suppress the rest of itself.
 * @param texts - the document's rstripped lines
 * @returns the index of the last header line, or -1
 */
function headerMetadataLines(texts: readonly string[]): number {
  if (!DOCTITLE.test(texts[0] ?? "")) {
    return -1;
  }
  let last = 0;
  while (last < HEADER_METADATA_LINES && (texts[last + 1]?.length ?? 0) > 0) {
    last += 1;
  }
  return last;
}

/**
 * What one line is doing, given what stands above it and which blocks
 * are open. MUTATES the stack: reading a line is what opens and closes
 * a block.
 * @param text - the rstripped line
 * @param above - the line before it, already scanned
 * @param stack - the open blocks, innermost last
 * @returns the line's role
 */
function roleOf(
  text: string,
  above: ScannedLine | undefined,
  stack: OpenBlock[],
): LineRole {
  const top = stack.at(-1);
  if (top?.close === text) {
    stack.pop();
    return "delimiter";
  }
  if (top?.verbatim === true) {
    return "verbatim";
  }
  // An OUTER block's terminator closes it and force-closes everything
  // still open inside it, exactly as `read_lines_until` does: it stops
  // at its own delimiter whatever the inner blocks left open. Asking
  // the whole stack rather than its top is what keeps the delimiter the
  // printer supplies for an unterminated block from reading as a
  // section underline of the line above it. A verbatim frame is never
  // below another, because a verbatim interior opens none, so the
  // unwind can never cut through one.
  const outer = stack.findLastIndex((block) => block.close === text);
  if (outer !== -1) {
    stack.length = outer;
    return "delimiter";
  }
  if (above?.role === "text" && underlines(text, above.text)) {
    return "underline";
  }
  const opened = opens(text);
  if (opened === undefined) {
    return "text";
  }
  stack.push(opened);
  return "delimiter";
}

/**
 * How many occurrences a global pattern has in a string.
 * @param text - what to scan
 * @param pattern - a global regular expression
 * @returns the match count
 */
function occurrences(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

/**
 * How much of a quantity the attribute spans on one line carry.
 * @param text - one line
 * @param pattern - what to count inside each span
 * @returns the total across the line's spans
 */
function inAttributeSpans(text: string, pattern: RegExp): number {
  const withoutAnchors = text.replaceAll(ANCHOR_SPAN, "");
  let total = 0;
  for (const [span] of withoutAnchors.matchAll(BRACKET_SPAN)) {
    total += occurrences(span, pattern);
  }
  return total;
}

/**
 * How many compatibility forms the document spells.
 * @param lines - the scanned document
 * @returns the count
 */
function compatibilityForms(lines: readonly ScannedLine[]): number {
  let count = 0;
  for (const line of lines) {
    if (line.role === "underline") {
      count += 1;
      continue;
    }
    if (line.role !== "text" && line.role !== "delimiter") {
      continue;
    }
    if (
      MARKDOWN_HEADING.test(line.text) ||
      MARKDOWN_THEMATIC_BREAK.test(line.text) ||
      MARKDOWN_FENCE.test(line.text)
    ) {
      count += 1;
    }
  }
  return count;
}

/**
 * How many constructs the document says through a general-purpose slot
 * that has a dedicated spelling.
 * @param lines - the scanned document
 * @returns the count
 */
function generalPurposeForms(lines: readonly ScannedLine[]): number {
  let count = 0;
  for (const [at, line] of lines.entries()) {
    if (line.role !== "text") {
      continue;
    }
    if (ANCHOR_SHORTHAND.test(line.text)) {
      count += 1;
      continue;
    }
    const below = lines[at + 1];
    if (ADMONITION_STYLE.test(line.text) && belowIsParagraph(below)) {
      count += 1;
    }
  }
  return count;
}

/**
 * Whether the line under an admonition style line is the paragraph the
 * style folds into: text, and not the blank that would end the block.
 * @param below - the next scanned line, if there is one
 * @returns true when the style line stands over a paragraph
 */
function belowIsParagraph(below: ScannedLine | undefined): boolean {
  return below?.role === "text" && below.text.length > 0;
}

/**
 * How many bytes of a delimiter line stand past its kind's minimum.
 * @param text - a line whose role is `delimiter`
 * @returns the excess, or 0 when the kind has one spelling only
 */
function delimiterExcess(text: string): number {
  const varies =
    LEAF_OR_COMPOUND_DELIMITER.test(text) || TABLE_DELIMITER.test(text);
  return varies ? text.length - 4 : 0;
}

/**
 * How much syntax the document spells past the shortest spelling of
 * the same construct.
 * @param lines - the scanned document
 * @returns the count
 */
function redundantSyntax(lines: readonly ScannedLine[]): number {
  let count = 0;
  for (const line of lines) {
    if (line.role === "delimiter") {
      count += delimiterExcess(line.text);
      continue;
    }
    if (line.role !== "text") {
      continue;
    }
    if (PAGE_BREAK.test(line.text)) {
      count += line.text.length - 3;
    }
    if (CLOSED_HEADING.test(line.text)) {
      count += 1;
    }
    count += occurrences(line.text.replace(LIST_MARKER_RUN, ""), DOUBLED_MARK);
    count += inAttributeSpans(line.text, ATTRIBUTE_QUOTE);
  }
  return count;
}

/**
 * How much whitespace the document spells past the shortest spelling
 * of the same construct.
 * @param lines - the scanned document
 * @returns the count
 */
function padding(lines: readonly ScannedLine[]): number {
  let count = 0;
  let blankRun = 0;
  for (const line of lines) {
    blankRun = line.text.length === 0 ? blankRun + 1 : 0;
    if (blankRun > 1) {
      count += 1;
    }
    if (line.role === "text") {
      count += linePadding(line);
    }
  }
  return count;
}

/**
 * The pad one text line carries: a psv cell's leading space inside a
 * table, or an attribute list's and an attribute entry's own padding
 * anywhere else.
 * @param line - a scanned line whose role is `text`
 * @returns the count
 */
function linePadding(line: ScannedLine): number {
  if (line.inTable && line.text.startsWith("|")) {
    return occurrences(line.text, CELL_PAD);
  }
  const gap = ATTRIBUTE_ENTRY_PAD.exec(line.text)?.groups?.gap ?? "";
  return inAttributeSpans(line.text, COMMA_PAD) + Math.max(0, gap.length - 1);
}

/**
 * How many equal-cost axes the document spells on the losing side.
 * @param lines - the scanned document
 * @returns the count
 */
function nonPreferredForms(lines: readonly ScannedLine[]): number {
  return lines.filter(
    (line) => line.role === "text" && TRAILING_BANG_UNSET.test(line.text),
  ).length;
}

/**
 * Weighs one document.
 * @param source - the document's whole source text
 * @returns its five counts
 */
export function weigh(source: string): SpellingWeight {
  const lines = lineRoles(source);
  return {
    compatibilityForms: compatibilityForms(lines),
    generalPurposeForms: generalPurposeForms(lines),
    redundantSyntax: redundantSyntax(lines),
    padding: padding(lines),
    nonPreferredForms: nonPreferredForms(lines),
  };
}

/**
 * Compares two weights lexicographically, highest component first.
 * @param left - one weight
 * @param right - the other
 * @returns negative when `left` is smaller, zero when equal, positive
 *   when `left` is larger
 */
export function compareWeight(
  left: SpellingWeight,
  right: SpellingWeight,
): number {
  for (const component of WEIGHT_COMPONENTS) {
    const difference = left[component] - right[component];
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

/**
 * One weight as the text a failing gate prints.
 * @param weight - the weight to spell
 * @returns the components in order, named
 */
export function describeWeight(weight: SpellingWeight): string {
  return WEIGHT_COMPONENTS.map(
    (component) => `${component}=${String(weight[component])}`,
  ).join(" ");
}

/**
 * The NON-INCREASE half of the order's obligation, checked on one
 * format.
 *
 * Formatting is a chain of rule applications, so a format that raised
 * the order applied a rule another rule could undo - a loop, which is
 * what termination forbids. This is the guard the idempotency
 * batteries only ever saw the shadow of: they catch a loop on the
 * second pass, and only when its two rules disagree about the bytes;
 * this catches the non-decreasing step itself.
 *
 * The STRICT-DECREASE half - every landed conversion descends the
 * order - is measured over the conversion roster in
 * reduction-order.test.ts rather than here, because a real document's
 * output differs from its input for layout reasons the order does not
 * rank, as the module comment sets out.
 * @param input - the document as written
 * @param formatted - what the formatter made of it
 * @returns the breach, or undefined when the order did not rise
 */
export function reductionBreach(
  input: string,
  formatted: string,
): string | undefined {
  const before = weigh(input);
  const after = weigh(formatted);
  if (compareWeight(after, before) <= 0) {
    return undefined;
  }
  return `formatting raised the reduction order: ${describeWeight(before)} -> ${describeWeight(after)}`;
}
