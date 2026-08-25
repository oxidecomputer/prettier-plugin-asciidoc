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
  LITERAL_LINE,
  type ParagraphContext,
  type ReaderContext,
} from "../line-shapes.js";
import { classifyLine, isContinuationLine, type LineKind } from "./classify.js";
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

// A line that is nothing but indentation and a `+` — the one line shape
// whose meaning `adjust_indentation!` can change (see Paragraph).
const INDENTED_PLUS = /^[ \t]+\+$/v;

// The two paragraph contexts whose lines Asciidoctor re-reads through
// `next_block` with `text_only`: a list item's and a dlist item's own
// text (`parse_list_item`). Only there does an indented first rest-line
// open the literal-paragraph branch that strips the indent.
const ITEM_TEXT_CONTEXTS = new Set<ParagraphContext>(["listItem", "dlistItem"]);

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
class Paragraph {
  // The pieces read so far, in source order.
  private readonly pieces: Piece[] = [];
  // Where the reflowable run in progress starts, or undefined right
  // after a line the reader had to keep verbatim.
  private runStart: number | undefined = undefined;
  // Document offset just past the run's last character.
  private runEnd: number;
  // How many lines have been read; `firstLineAfterStart` is a rule of
  // its own in the registry (a block anchor, for one, only counts there).
  private linesRead = 1;
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

  /**
   * @param scan - the lines and the stream-wide facts (see
   *   {@link ParagraphScan})
   * @param at - index of the paragraph's first line
   * @param mode - which interrupting set applies, or the fold
   * @param from - raw column index where the paragraph's text starts
   */
  constructor(
    private readonly scan: ParagraphScan,
    at: number,
    mode: ParagraphMode,
    from: number,
  ) {
    this.fold = mode === "continuationFold";
    this.context = mode === "continuationFold" ? "listContinuation" : mode;
    const { context } = this;
    const line = scan.lines[at];
    this.index = at + 1;
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
    this.runStart = line.offset + from;
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
        firstLineAfterStart: this.linesRead === 1,
      });
      if (kind.kind !== "text" && kind.kind !== "raw") {
        if (!this.foldsThrough(next)) return;
        // A tagged `+` met mid-fold is run through as content on its
        // own raw line — the oracle's `ListContinuationString` passes
        // both break tests (parser.js l.3023-25, reader.js's strict
        // `line === LIST_CONTINUATION`); only a PLAIN `+` interrupts.
        this.closeRun();
        this.pieces.push({ kind: "raw", line: next });
        this.linesRead += 1;
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
    this.linesRead += 1;
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
   * line of its own, so both stay put.
   * @param line - the line being added
   * @param kind - what the classifier made of it
   * @returns true when the line joins the run in progress
   */
  private reflows(line: SourceLine, kind: LineKind): boolean {
    if (kind.kind !== "text" || kind.verbatim === true) return false;
    return !(this.fold && LITERAL_LINE.test(line.text));
  }

  /**
   * Feed one consumed line to the literal-plus rule (see
   * {@link Paragraph.finish}): the first line after an item's own line
   * is the candidate when it is indentation and a `+`; every content
   * line after it lowers the common indent. Comment and preprocessor
   * lines do not count — `read_paragraph_lines` runs with
   * `skip_line_comments` here, so they never reach
   * `adjust_indentation!`.
   * @param line - the line being added to the paragraph
   * @param kind - what the classifier made of it
   */
  private trackLiteralPlus(line: SourceLine, kind: LineKind): void {
    if (kind.kind !== "text") {
      return;
    }
    if (this.plusLine !== undefined) {
      this.minIndentAfterPlus = Math.min(
        this.minIndentAfterPlus,
        indentOf(line.text),
      );
    } else if (
      this.linesRead === 1 &&
      ITEM_TEXT_CONTEXTS.has(this.context) &&
      INDENTED_PLUS.test(line.text)
    ) {
      this.plusLine = line;
    }
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
 * @param from - raw column index where the paragraph's text starts
 * @returns the body's tokens and the resume index
 */
export function paragraphExtent(
  scan: ParagraphScan,
  at: number,
  context: ParagraphContext,
  from: number,
): ParagraphBody {
  const paragraph = new Paragraph(scan, at, context, from);
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
  const paragraph = new Paragraph(scan, at, "continuationFold", 0);
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
 * :1026-1028 under default `Compliance.strict_verbatim_paragraphs`,
 * asciidoctor.rb:131; the registry's `verbatimStyled` row, pinned by
 * the interruption matrix). Issue #41's fix: the style is in hand
 * BEFORE any content line is read.
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
