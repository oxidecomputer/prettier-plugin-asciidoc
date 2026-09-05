/**
 * Paragraph extent: the port of `Parser.read_paragraph_lines` and the
 * `Reader.read_lines_until` options it passes (`break_on_blank_lines`,
 * `break_on_list_continuation`, `preserve_last_line`, and the
 * `StartOfBlock…Proc` break condition, which line-shapes.ts holds as
 * the registry's interrupting sets).
 *
 * Split out of reader.ts by responsibility: this module decides how far
 * a paragraph-shaped block reaches and turns its lines into inline
 * tokens; reader.ts owns the read position and decides what a line
 * OPENS.
 *
 * PURE FACT FUNCTIONS over the lines, exactly as delimited-reader.ts
 * is: each takes the lines and an index, returns what it found and
 * the index the caller resumes at, and calls nothing back. There is no
 * reader interface here to satisfy and nothing to mis-wire — a scan
 * cannot advance a stream it does not own, so "who moved the read
 * position" has one answer everywhere. Every decision comes from the
 * {@link ParagraphScan} value the caller hands over; nothing scans
 * backwards or inspects a token history.
 */
import { tokenizeInline } from "../inline/tokenize.js";
import type { InlineToken } from "../inline/tokens.js";
import {
  LINE_COMMENT_HEAD,
  rawLineForm,
  type ParagraphContext,
  type ReaderContext,
} from "../line-shapes.js";
import {
  classifyLine,
  classifyTrace,
  holdsDescriptionListSeparator,
  isContinuationLine,
  isIndentedContinuationLine,
  isLiteralLine,
  type LineKind,
} from "./classify.js";
import type { SourceLine } from "./split.js";

/**
 * What a {@link Paragraph} is reading: a registry context, or the one
 * mode that is NOT a registry context — the `+`-headed fold. A
 * paragraph opened non-content-adjacent inside a list item does not
 * break at list-marker lines (`readParagraphLines` with a falsey
 * `breakAtList`, parser.js l.1065/l.3018-47); its break set is the
 * plain-paragraph one, which is exactly `listContinuation`'s
 * interrupting set, so the fold CLASSIFIES as that context and differs
 * in three reader-side behaviors only: the tagged `+` head keeps its
 * own raw line, a tagged `+` MET mid-paragraph folds through as a
 * raw line instead of interrupting (the oracle runs through
 * `ListContinuationString`, parser.js l.3023-25 — only a plain `+`
 * breaks), and an INDENTED line keeps its own raw line so the print
 * side cannot dedent it ({@link Paragraph.reflows}). Local to this
 * module: the mode exists only where the fold is read.
 */
type ParagraphMode = ParagraphContext | "continuationFold";

// The two paragraph contexts whose lines Asciidoctor re-reads through
// `next_block` with `text_only`: a list item's and a dlist item's own
// text (`parse_list_item`). Only there does an indented first rest-line
// open the literal-paragraph branch that strips the indent.
const ITEM_TEXT_CONTEXTS = new Set<ParagraphContext>([
  "listItemText",
  "dlistItem",
]);

/**
 * What one paragraph-shaped scan reads, beyond the index it starts
 * at: DATA, not a reader. Every field is a fact fixed for the whole
 * stream the scan runs over, which is why it can be handed across as
 * a value — the read position, the block sequence and the held-back
 * metadata all stay with the caller.
 */
export interface ParagraphScan {
  /** The whole document — inline runs are slices of it. */
  readonly source: string;
  /**
   * The lines the scan walks: the document's, or a list item's
   * buffer. Absolute offsets either way, so a token's image is a
   * verbatim slice of `source` whichever stream it came from.
   */
  readonly lines: readonly SourceLine[];
  /**
   * Marker style of the list open around these lines, if any — the
   * classifier's ancestry fact ({@link ReaderContext.openListStyle}).
   * Fixed for the stream: a confined buffer carries exactly its own
   * item's style.
   */
  readonly openListStyle: string | undefined;
}

/**
 * Where a paragraph-shaped extent's TEXT starts, and how a `//` line
 * inside it reads. Both are the caller's to fix before the first line
 * is read, and neither can be recovered from the lines alone: the
 * start sits past a marker or a label the reader parsed, and the
 * comment reading follows from WHICH construct the paragraph belongs
 * to.
 */
export interface TextOpen {
  /** Raw column index where the paragraph's text starts. */
  readonly from: number;
  /**
   * The caller's answer for `read_paragraph_lines`'s
   * `skip_line_comments` argument: `skipped` drops a `//` line before
   * `adjust_indentation!` ever sees it, and `content` folds it into
   * the text like any other line. It is half an answer, because only
   * one of `next_block`'s two arms passes the caller's value on; the
   * extent supplies the other half (see
   * {@link Paragraph.foldsCommentLine}). Where both halves say
   * content the line IS text: its indent counts
   * ({@link Paragraph.adjustsIndentation}) and it reflows with the
   * words around it ({@link Paragraph.reflows}).
   */
  readonly comments: "content" | "skipped";
}

/** A run of reflowable paragraph text to tokenize as inline content. */
interface InlineRun {
  /** Document offset of the run's first character. */
  readonly start: number;
  /**
   * Document offset just past its last character: the offset of the
   * run's trailing newline, or the document length.
   */
  readonly end: number;
}

// What a paragraph is made of, in source order: runs of reflowable
// text lines (tokenized as one) and lines kept verbatim.
type Piece =
  | {
      /** Piece discriminant: a run of reflowable lines. */
      readonly kind: "run";
      /** Where the run sits in the document. */
      readonly run: InlineRun;
    }
  | {
      /** Piece discriminant: a line kept verbatim. */
      readonly kind: "raw";
      /** The line. */
      readonly line: SourceLine;
    };

/**
 * One paragraph being read. Owns the run bookkeeping AND its own read
 * position into the scan's lines — a local counter the caller reads
 * back as {@link Paragraph.end}, never a stream it shares with anyone.
 *
 * Nothing is tokenized until the paragraph is complete: `finish` turns
 * the pieces into tokens in one pass, once every line is in, so a rule
 * that needs the whole paragraph (the literal-plus rule, below) is
 * decided BEFORE the tokenizer runs — the reader never rewrites a
 * token it has already placed.
 */
/**
 * The first line after `at` that `next_block`'s metadata loop does
 * not take: a comment line is shifted away before the block's branch
 * is chosen (parser.rb l.519-523, l.2076-2081), so it is never the
 * line that decides one.
 *
 * The comment spelling here is `parse_block_metadata_line`'s own -
 * the classifier's `LINE_COMMENT`, which mirrors `CommentLineRx` and
 * EXEMPTS `///` (l.2080) - and NOT `Reader#skip_line_comments`'s bare
 * prefix. The two disagree on `///c`, and this is the site where the
 * exemption is the right half: a `///` line is ordinary text to the
 * metadata loop, so it stays and it decides.
 * @param scan - the lines and the stream-wide facts
 * @param at - index of the block's own first line
 * @returns that line's text, or `""` where the lines run out
 */
function firstUncommented(scan: ParagraphScan, at: number): string {
  let index = at + 1;
  while (rawLineForm(scan.lines.at(index)?.text ?? "") === "comment") {
    index += 1;
  }
  return scan.lines.at(index)?.text ?? "";
}

class Paragraph {
  // The pieces read so far, in source order.
  private readonly pieces: Piece[] = [];
  // Where the reflowable run in progress starts, or undefined right
  // after a line the reader had to keep verbatim.
  private runStart: number | undefined = undefined;
  // Document offset just past the run's last character.
  private runEnd: number;
  // Whether the line about to be read is the one directly after the
  // block's start line, which the constructor already consumed:
  // `firstLineAfterStart` is a rule of its own in the registry (a
  // block anchor, for one, only counts there). A FLAG rather than a
  // line COUNT, because the count answered nothing else - both of its
  // readers asked it for this one bit.
  private firstLineAfterStart = true;
  // The literal-plus rule's state: the candidate ` +` line (the first
  // line after an item's marker line, when it is indentation and a `+`
  // and nothing else) and the smallest indent of any content line
  // after it. See {@link Paragraph.finish}.
  private plusLine: SourceLine | undefined = undefined;
  private minIndentAfterPlus = Number.POSITIVE_INFINITY;
  // Index of the next unread line. The paragraph's own first line is
  // consumed here, at construction — `read_paragraph_lines` is called
  // on a reader whose first line the caller already took.
  private index: number;

  // Which interrupting set the lines classify under, and whether the
  // fold's two tagged-`+` behaviors are on — both derived from the
  // constructor's mode (see {@link ParagraphMode}).
  private readonly context: ParagraphContext;
  private readonly fold: boolean;
  // Whether a `//` line inside this extent is CONTENT (see
  // {@link Paragraph.foldsCommentLine}).
  private readonly commentsAreContent: boolean;

  /**
   * @param scan - the lines and the stream-wide facts (see
   *   {@link ParagraphScan})
   * @param at - index of the paragraph's first line
   * @param mode - which interrupting set applies, or the fold
   * @param text - where the paragraph's text starts and how its `//`
   *   lines read (see {@link TextOpen})
   */
  constructor(
    private readonly scan: ParagraphScan,
    at: number,
    mode: ParagraphMode,
    private readonly text: TextOpen,
  ) {
    this.fold = mode === "continuationFold";
    this.context = mode === "continuationFold" ? "listContinuation" : mode;
    const { context } = this;
    const line = scan.lines[at];
    this.index = at + 1;
    // `next_block` decides its branch on the first line AFTER this
    // one, and only the indented arm asks the caller how a `//` line
    // reads: `skip_line_comments: text_only` (parser.rb l.753-754),
    // against `skip_line_comments: true` in the arm beside it
    // (parser.rb l.764). So the caller's answer alone does not settle
    // it - see {@link Paragraph.foldsCommentLine}.
    //
    // The line that decides is the first NON-COMMENT one, not the
    // line at `at + 1`: `next_block` runs its metadata loop first and
    // shifts every line `parse_block_metadata_line` consumed
    // (parser.rb l.519-523), whose `//` arms take a comment line
    // outright (l.2076-2081). So `t:: item` / `// a` / `  x` is the
    // indented arm, and asking `// a` instead put it on the arm
    // beside it, where the comment is dropped from the render
    // (issue #115).
    this.commentsAreContent =
      text.comments === "content" && isLiteralLine(firstUncommented(scan, at));
    this.runEnd = line.offset + line.raw.length;
    if (this.fold) {
      // The fold's head is the tagged `+` itself, and a column-0 `+`
      // is never reflowed into prose: it keeps its own line the way a
      // comment does.
      this.pieces.push({ kind: "raw", line });
      return;
    }
    if (context === "dlistItem" && line.text.startsWith(LINE_COMMENT_HEAD)) {
      // A dlist term that begins with `//` (`///b::` — not a comment to
      // the classifier, which mirrors LineCommentRx) IS one to
      // `Reader#skip_line_comments`, which tests `start_with? '//'` and
      // which `parse_list_item` runs over an item's first block lines,
      // restoring what it skipped only when a line follows. Reflowing
      // the description onto the term line would make it the item's
      // last line and Asciidoctor would drop it, so the term keeps its
      // own line (ORACLE: `* a` / `///b::` / `c` renders the dlist;
      // `* a` / `///b:: c` renders nothing after `a`).
      this.pieces.push({ kind: "raw", line });
      return;
    }
    this.runStart = line.offset + this.text.from;
  }

  /**
   * Consume lines until one ends the paragraph. The ending line is left
   * unread — `read_lines_until` with `preserve_last_line: true`.
   */
  read(): void {
    for (;;) {
      const next = this.scan.lines.at(this.index);
      if (next === undefined) {
        return;
      }
      const kind = classifyLine(next.text, {
        openParagraph: this.context,
        openListStyle: this.scan.openListStyle,
        firstLineAfterStart: this.firstLineAfterStart,
      });
      classifyTrace.observer?.(next.offset, kind);
      if (kind.kind !== "text" && kind.kind !== "raw") {
        if (!this.foldsThrough(next)) {
          return;
        }
        // A tagged `+` met mid-fold is run through as content on its
        // own raw line — the oracle's `ListContinuationString` passes
        // both break tests (parser.js l.3023-25, reader.js's strict
        // `line === LIST_CONTINUATION`); only a PLAIN `+` interrupts.
        this.closeRun();
        this.pieces.push({ kind: "raw", line: next });
        this.firstLineAfterStart = false;
        this.index += 1;
        continue;
      }
      this.take(next, kind);
    }
  }

  /**
   * Whether an interrupting line is run through by the fold: only a
   * `+` still carrying the scan's marker tag (see
   * {@link ParagraphMode}).
   * @param line - the line the classifier just refused
   * @returns true when the fold keeps it as a raw piece
   */
  private foldsThrough(line: SourceLine): boolean {
    return (
      this.fold &&
      isContinuationLine(line.text) &&
      line.continuationTag === "marker"
    );
  }

  /**
   * Where the caller resumes: the index of the line that ENDED the
   * paragraph, left unread (`read_lines_until` with
   * `preserve_last_line: true`), or the lines' end.
   * @returns the index after everything the paragraph consumed
   */
  get end(): number {
    return this.index;
  }

  /**
   * Tokenize every run and place the raw lines between them, in
   * source order.
   *
   * THE LITERAL-PLUS RULE. `parse_list_item` re-reads an item's lines
   * through `next_block` with `text_only`, and when the first line
   * after the marker line is indented that is the literal-paragraph
   * branch (`indented && !style`): `read_paragraph_lines` then
   * `adjust_indentation!`, folded back into the item's text. The
   * common indent of those lines is stripped BEFORE `HardLineBreakRx`
   * (`^(.*) \+$`) ever runs, so a ` +` line no less indented than
   * every content line after it loses its space and is a bare `+` —
   * plain text, not a break. The tokenizer cannot know this on its
   * own: the decision needs the whole paragraph and the fact that its
   * first line is an item's marker line, both of which only the reader
   * has. So the reader decides first and retypes that line's break
   * (see {@link Paragraph.tokenizeRun}). Oracle: `. item` / ` +` /
   * `  more` renders `item + more`; with `more` flush left it renders
   * `item <br> more` (the common indent is 0), and `text` / ` +` /
   * `  more` is a break too (a plain paragraph is never re-indented).
   *
   * The indent is common to ALL of the item's rest lines, the ` +`
   * line included. So a ` +` with NO content line after it is the
   * only line that indent is taken over: its own indent IS the
   * common one, the space always goes, and the plus is literal.
   * That is what `minIndentAfterPlus` starting at `+Infinity` says,
   * and it is the reading the oracle gives rather than a vacuous
   * comparison to guard against - `. item` / ` +` / `. next` renders
   * `item +`, with no break anywhere.
   * @returns the body's tokens
   */
  finish(): InlineToken[] {
    this.closeRun();
    const { plusLine } = this;
    const literalPlus =
      plusLine !== undefined &&
      this.minIndentAfterPlus >= indentOf(plusLine.text)
        ? plusLine
        : undefined;
    const tokens: InlineToken[] = [];
    for (const piece of this.pieces) {
      if (piece.kind === "raw") {
        tokens.push({
          type: "RawLine",
          image: piece.line.raw,
          offset: piece.line.offset,
        });
      } else {
        tokens.push(...this.tokenizeRun(piece.run, literalPlus));
      }
    }
    return tokens;
  }

  /**
   * Tokenize one run of reflowable lines.
   *
   * The document's newline AT the run's end is included when it is
   * really there, so a trailing ` +` tokenizes as a hard break
   * exactly as it would mid-document and every token's image is still
   * a verbatim source slice. At EOF without a final newline nothing
   * is appended: inventing one would give a token an image the source
   * does not contain.
   *
   * The literal-plus rule's other half: a hard break on the line the
   * reader decided is literal is plain text — the tokenizer's output
   * is retyped here because only the reader knows which line that is.
   * @param run - where the run sits in the document
   * @param literalPlus - the line whose ` +` is literal text, if any
   * @returns the run's tokens, in document coordinates
   */
  private tokenizeRun(
    run: InlineRun,
    literalPlus: SourceLine | undefined,
  ): InlineToken[] {
    const { source } = this.scan;
    const newline = source[run.end] === "\n" ? "\n" : "";
    const tokens = tokenizeInline(
      `${source.slice(run.start, run.end)}${newline}`,
      run.start,
    );
    if (literalPlus === undefined) {
      return tokens;
    }
    const { offset: from } = literalPlus;
    const to = from + literalPlus.raw.length;
    return tokens.map((token) =>
      token.type === "HardLineBreak" &&
      token.offset >= from &&
      token.offset < to
        ? { ...token, type: "InlineText" }
        : token,
    );
  }

  /**
   * Add one line the paragraph keeps.
   * @param line - the line to add
   * @param kind - what the classifier made of it
   */
  private take(line: SourceLine, kind: LineKind): void {
    this.trackLiteralPlus(line, kind);
    if (this.reflows(line, kind)) {
      this.runStart ??= line.offset;
      this.runEnd = line.offset + line.raw.length;
    } else {
      this.closeRun();
      this.pieces.push({ kind: "raw", line });
    }
    this.firstLineAfterStart = false;
    this.index += 1;
  }

  /**
   * Whether a kept line may join the reflowable run, or must keep its
   * own output line as a raw piece. Two shapes must not reflow:
   *
   * - a `text` line carrying `verbatim`, a foreign list marker inside a
   *   `+`-attached paragraph (Ruby's `within_nested_list`). Reflowing
   *   it off column 0 would silently change what the NEXT `+` means.
   * - an INDENTED line inside a fold. The fold is a paragraph to us,
   *   but the lines behind its `+` head are also what a re-read hands
   *   to a literal block's slurp
   *   (`read_lines_until break_on_blank_lines, break_on_list_continuation`),
   *   which copies them into `<pre>` byte for byte — dedenting one
   *   there rewrites verbatim content, or drops the block's
   *   `indented && !style` branch altogether. Only the fold needs the
   *   rule: an ordinary paragraph's indent is already stripped by
   *   `adjust_indentation!` before anything reads it.
   *
   * `rawLine` is the AST node the printer already keeps on an output
   * line of its own, so both stay put. A `//` line the extent reads
   * as CONTENT is not one of them: it is text, and holding it on a
   * line of its own under a folded description is what left it at
   * column 0, where a re-read takes it as the comment it no longer is
   * (issue #105; see {@link Paragraph.foldsCommentLine}). ONE such
   * line still stays put.
   *
   * A `//` line's own `term::` words are inert twice over:
   * `DescriptionListRx` refuses a line whose head is `//` outright
   * (rx.rb:336, the `(?!//[^/])` lookahead), and inside a
   * description's text a `term::` word stands behind the term the
   * source already wrote, which binds first because Ruby's term group
   * is non-greedy. Folding keeps the second and spends the first: the
   * words become ordinary words of the paragraph, and reflow may put
   * one at the HEAD of an output line. `term::` is the one block
   * shape the packer's line-start rule deliberately does not refuse
   * (`isBlockSyntaxAtLineStart`, src/print/reflow.ts), because on a
   * plain paragraph's later line such a word is text (ORACLE: `para
   * one` / `x:: y` renders one `<p>`); on a DESCRIPTION's rest line
   * it is a sibling term that ends the item (ORACLE: `t:: item` /
   * `x // x:: y` renders a second `<dt>`). So such a line keeps the
   * output line of its own that keeps its words out of the text. The
   * comment is then outside the description again and the render
   * loses it, which is issue #105's loss left standing for this one
   * shape: a lost comment is a smaller wrong than a fabricated list
   * item, and it is what the formatter already did here.
   * @param line - the line being added
   * @param kind - what the classifier made of it
   * @returns true when the line joins the run in progress
   */
  private reflows(line: SourceLine, kind: LineKind): boolean {
    if (this.foldsCommentLine(kind)) {
      return !holdsDescriptionListSeparator(line.text);
    }
    if (kind.kind !== "text" || kind.verbatim === true) {
      return false;
    }
    return !(this.fold && isLiteralLine(line.text));
  }

  /**
   * Feed one consumed line to the literal-plus rule (see
   * {@link Paragraph.finish}): the first line after an item's own line
   * is the candidate when it is indentation and a `+`; every line the
   * indent is taken over after it lowers the common indent. A comment
   * line usually is not one of those: `read_paragraph_lines` runs
   * with `skip_line_comments`, so it never reaches
   * `adjust_indentation!`, and where it IS content
   * ({@link Paragraph.foldsCommentLine}) its indent counts like any
   * other line's. A conditional directive never counts: the
   * preprocessor removes it before either side's reader sees a
   * paragraph at all, so there is no line left here to disagree about.
   * An unresolved include DOES count, for the reason
   * {@link Paragraph.adjustsIndentation} gives: `t:: item` / ` +` /
   * `include::x[]` and the same shape under `*`, `.` and `<1>` all
   * render a break, and this reads one too.
   * @param line - the line being added to the paragraph
   * @param kind - what the classifier made of it
   */
  private trackLiteralPlus(line: SourceLine, kind: LineKind): void {
    if (!this.adjustsIndentation(kind)) {
      return;
    }
    if (this.plusLine !== undefined) {
      this.minIndentAfterPlus = Math.min(
        this.minIndentAfterPlus,
        indentOf(line.text),
      );
    } else if (
      this.firstLineAfterStart &&
      ITEM_TEXT_CONTEXTS.has(this.context) &&
      isIndentedContinuationLine(line.text)
    ) {
      this.plusLine = line;
    }
  }

  /**
   * Whether `adjust_indentation!` takes the common indent over this
   * line: every text line, a COMMENT line in the one paragraph the
   * oracle reads without skipping comments, and an unresolved INCLUDE
   * line.
   *
   * `read_paragraph_lines` passes `skip_line_comments: text_only`
   * (parser.rb l.754), and `parse_list_item` passes
   * `text_only: has_text ? nil : true` while keeping `has_text` for a
   * description list alone (parser.rb l.1367-74, where a ulist or
   * olist item's content-adjacent text clears it). So the description
   * of a dlist item that carries its own inline text is the paragraph
   * whose `//` lines Asciidoctor folds in as CONTENT: they render,
   * they reach `adjust_indentation!`, and a flush-left one there
   * takes the common indent to 0, which is what keeps the space on a
   * ` +` line above it and so keeps the break (issue #101; ORACLE:
   * `t:: item` / ` +` / `// c` renders `item <br> // c`).
   *
   * An `include::` line this reader leaves unresolved is a DIFFERENT
   * route to the same zero: the oracle's preprocessor runs before
   * `read_paragraph_lines` ever sees a line, and when the target does
   * not resolve it does not drop the line, it REPLACES it with a
   * flush-left message and hands that line on (`replace_next_line`,
   * reader.rb l.258-262; the include-not-found arm that calls it,
   * reader.rb l.1270-1277). `adjust_indentation!` then sees a line
   * whose own indent is 0, and one such line anywhere in the buffer
   * forces `block_indent` to `nil` for the whole scan, so nothing is
   * stripped from any line in it (parser.rb l.2723-2732). That is what
   * keeps the space, and so the break, on the ` +` line above an
   * include the target cannot resolve (#107; issue #101's rule and
   * this one land at the same zero by different Ruby paths). This
   * reader never resolves an include, so it treats every `include::`
   * line as if it were that unresolved case; it cannot be, since
   * resolving one would mean reading a file this formatter has no
   * business opening, and the oracle would not read this document's
   * lines from that point on either way.
   * @param kind - what the classifier made of the line
   * @returns true when the line's indent is one the common indent is
   *   taken over
   */
  private adjustsIndentation(kind: LineKind): boolean {
    return (
      kind.kind === "text" ||
      this.foldsCommentLine(kind) ||
      (kind.kind === "raw" && kind.form === "include")
    );
  }

  /**
   * Whether a `//` line in this extent is CONTENT: text that renders,
   * reflows and wraps like any other, rather than a line the printer
   * replays on an output line of its own.
   *
   * Two facts, and both are needed. The CALLER's is
   * {@link TextOpen.comments}: `read_paragraph_lines` takes
   * `skip_line_comments: text_only` (parser.rb l.754) and
   * `parse_list_item` passes `text_only: has_text ? nil : true` while
   * keeping `has_text` for a description list alone (parser.rb
   * l.1369-74, where a ulist or olist item's content-adjacent text
   * clears it). The EXTENT's is the branch that asks: only
   * `next_block`'s `indented && !style` arm reads the caller's answer
   * (parser.rb l.753), and which arm runs is decided by the first
   * line after the block's own (parser.rb l.571-588, where a leading
   * space or TAB is what indented means). The arm beside it passes
   * `skip_line_comments: true` whatever the caller said (parser.rb
   * l.764), which is why `term:: def` / `// c` / `more` renders
   * `def more` and drops the comment while `term:: def` / `  x` /
   * `// c` renders `x // c` and keeps it.
   *
   * The deciding line is read at a fixed offset from the block's own,
   * so a comment standing THERE answers no for the whole extent. For
   * that line itself the answer is exact: `next_block`'s metadata
   * drain shifts a leading `//` away before the branch test runs
   * (parser.rb l.519-523, `parse_block_metadata_line` answering for
   * `//`), so the oracle drops it and so does a re-read of the bytes
   * the printer leaves on a line of its own. For a comment FURTHER
   * down it is not: the drain walks on to the first line it cannot
   * take, and an indented one there opens the arm that folds later
   * `//` lines in. `t:: item` / `// a` / `  x` / `// b` drops `// a`
   * and KEEPS `// b`; we answer no for both and lose `// b` from the
   * render. Recorded here, not fixed here.
   * @param kind - what the classifier made of the line
   * @returns true for a `//` line this extent folds in as text
   */
  private foldsCommentLine(kind: LineKind): boolean {
    return (
      this.commentsAreContent && kind.kind === "raw" && kind.form === "comment"
    );
  }

  /** Close the run in progress as one piece. */
  private closeRun(): void {
    if (this.runStart === undefined) {
      return;
    }
    this.pieces.push({
      kind: "run",
      run: { start: this.runStart, end: this.runEnd },
    });
    this.runStart = undefined;
  }
}

/**
 * The tokens a paragraph-shaped extent holds, and where it ends.
 * NOT exported (knip's types bucket gates dead exported types at 0):
 * the caller destructures the function's result.
 */
interface ParagraphBody {
  /** The body's tokens, in source order. */
  readonly tokens: InlineToken[];
  /** Index (into the scan's lines) after everything the extent held. */
  readonly end: number;
}

/**
 * The lines a verbatim extent holds, and where it ends. NOT exported,
 * for the same reason as {@link ParagraphBody}.
 */
interface VerbatimRun {
  /** The run's lines, in order, the opening line first. */
  readonly lines: readonly [SourceLine, ...SourceLine[]];
  /** Index (into the scan's lines) after the run. */
  readonly end: number;
}

/**
 * Read a paragraph-shaped block opening at `at`, whose text begins at
 * column `from` (past an admonition label or a list marker).
 *
 * Yields the body's tokens — one tokenized run per RUN of reflowable
 * text lines, a `RawLine` token for each line kept verbatim, in source
 * order — and the index the caller resumes at. The line that ENDED the
 * paragraph is NOT consumed: `end` points AT it, so the caller
 * classifies it once, as a block start.
 * @param scan - the lines and the stream-wide facts
 * @param at - index of the paragraph's first line
 * @param context - which interrupting set applies (see ParagraphContext)
 * @param text - where the paragraph's text starts and how its `//`
 *   lines read (see {@link TextOpen})
 * @returns the body's tokens and the resume index
 */
export function paragraphExtent(
  scan: ParagraphScan,
  at: number,
  context: ParagraphContext,
  text: TextOpen,
): ParagraphBody {
  const paragraph = new Paragraph(scan, at, context, text);
  paragraph.read();
  return { tokens: paragraph.finish(), end: paragraph.end };
}

/**
 * Read the `+`-headed FOLD opening at `at` — the paragraph a confined
 * reader opens on a tagged `+` after one or more skipped blanks. Such
 * a paragraph is non-content-adjacent to the oracle (`skipped === 0 &&
 * options.list_type` is false, parser.js l.1065), so it does not break
 * at list-marker lines: they fold in as raw pieces (a foreign marker
 * classifies verbatim under `listContinuation`), and the read stops at
 * a blank, a plain `+`, a block-attribute line, or a delimiter — the
 * plain-paragraph set (see {@link ParagraphMode}).
 * @param scan - the lines and the stream-wide facts
 * @param at - index of the tagged `+` line
 * @returns the body's tokens and the resume index
 */
export function continuationFoldExtent(
  scan: ParagraphScan,
  at: number,
): ParagraphBody {
  // The fold's own `+` head is its first line, so its text starts at
  // column 0; a `//` line inside it is the comment it looks like
  // (`read_paragraph_lines` skips comments on every path but the
  // literal branch's).
  const paragraph = new Paragraph(scan, at, "continuationFold", {
    from: 0,
    comments: "skipped",
  });
  paragraph.read();
  return { tokens: paragraph.finish(), end: paragraph.end };
}

/**
 * Read an indented literal paragraph: `next_block`'s
 * `indented && !style` branch, which calls `read_paragraph_lines` with
 * the plain break condition, so the block runs on through FLUSH lines
 * and stops only at a blank line or a block start.
 *
 * Comment lines stay inside it. `read_paragraph_lines` passes
 * `skip_line_comments: text_only`, so a `//` line in a document-level
 * literal paragraph is NOT dropped — the oracle renders it as content
 * (ORACLE SURPRISE, recorded in classify.ts and pinned in
 * tests/parser/reader.test.ts).
 *
 * ORACLE DISAGREEMENT, kept deliberately, for the OTHER raw shapes:
 * `PreprocessorReader#process_line` eats `ifdef::x[]` before the parser
 * sees a line at all, and with the attribute unset it eats the lines up
 * to the matching `endif` too — so `  lit` / `ifdef::x[]` / `more`
 * renders as `<pre>lit</pre>` and `more` is GONE. The reader keeps all
 * three lines anyway: a formatter may never delete source, and the
 * conditional's own body is text the author wrote. The oracle's output
 * is a subset of ours, never a reordering of it, so no rendered content
 * moves. Pinned in tests/parser/reader.test.ts.
 * @param scan - the lines and the stream-wide facts
 * @param at - index of the paragraph's first (indented) line
 * @returns the run's lines, in order, the opening line first — a blank
 *   line ends the run, so two literal paragraphs it separates never
 *   share one — and the resume index
 */
export function literalParagraphExtent(
  scan: ParagraphScan,
  at: number,
): VerbatimRun {
  return verbatimRunExtent(scan, at, "literalParagraph");
}

/**
 * Read a verbatim-STYLED paragraph's lines: `[source]`/`[listing]`/
 * `[literal]`/`[verse]` in hand, the extent runs to a blank line, a
 * lone `+`, or an enclosing terminator ONLY (parser.rb:561-567 →
 * parser.rb:1026-1028, where `read_lines_until` breaks on blank lines
 * and on a list continuation, under default
 * `Compliance.strict_verbatim_paragraphs`, asciidoctor.rb:131; the
 * registry's `verbatimStyled` row, pinned by the interruption matrix).
 * Issue #41's fix: the style is in hand BEFORE any content line is
 * read.
 * @param scan - the lines and the stream-wide facts
 * @param at - index of the block's first content line
 * @returns the block's lines, in order, and the resume index
 */
export function verbatimStyledExtent(
  scan: ParagraphScan,
  at: number,
): VerbatimRun {
  return verbatimRunExtent(scan, at, "verbatimStyled");
}

/**
 * The shared verbatim-lines loop: take the opening line, then consume
 * every line the CONTEXT keeps — text and raw alike stay in the run (a
 * `//` line is CONTENT here; Ruby passes no `skip_line_comments` on
 * these paths) — leaving the ending line unread.
 *
 * One ReaderContext for the whole loop: `firstLineAfterStart` is false
 * at every position a verbatim run classifies, because the run's own
 * opening line is taken without being classified at all.
 * @param scan - the lines and the stream-wide facts
 * @param at - index of the run's first line
 * @param context - which interrupting set applies
 * @returns the run's lines and the resume index
 */
function verbatimRunExtent(
  scan: ParagraphScan,
  at: number,
  context: ParagraphContext,
): VerbatimRun {
  const reader: ReaderContext = {
    openParagraph: context,
    openListStyle: scan.openListStyle,
    firstLineAfterStart: false,
  };
  const lines: [SourceLine, ...SourceLine[]] = [scan.lines[at]];
  let index = at + 1;
  for (;;) {
    const next = scan.lines.at(index);
    if (next === undefined) {
      break;
    }
    const kind = classifyLine(next.text, reader);
    classifyTrace.observer?.(next.offset, kind);
    if (kind.kind !== "text" && kind.kind !== "raw") {
      break;
    }
    lines.push(next);
    index += 1;
  }
  return { lines, end: index };
}

/**
 * Width of a line's leading whitespace.
 * @param text - one rstripped source line
 * @returns how many characters precede the first non-blank one
 */
function indentOf(text: string): number {
  return text.length - text.trimStart().length;
}
