/**
 * Paragraph extent: the port of `Parser.read_paragraph_lines` and the
 * `Reader.read_lines_until` options it passes (`break_on_blank_lines`,
 * `break_on_list_continuation`, `preserve_last_line`, and the
 * `StartOfBlock…Proc` break condition, which classify.ts holds as the
 * registry's interrupting sets).
 *
 * Split out of reader.ts by responsibility: this module decides how far
 * a paragraph-shaped block reaches and turns its lines into inline
 * tokens; reader.ts owns the frame stack and decides what a line
 * OPENS. list-reader.ts is the third member and reads the reader
 * through the same {@link ParagraphHost} seam.
 *
 * Every decision here comes from the context the host hands over.
 * Nothing scans backwards or inspects a token history.
 */
import { NEXT } from "../../constants.js";
import { tokenizeInline } from "../inline/tokenize.js";
import type { InlineToken } from "../inline/tokens.js";
import type { ParagraphContext } from "../line-shapes.js";
import { classifyLine, type LineKind, type ReaderContext } from "./classify.js";
import type { SourceLine } from "./split.js";

// A line that is nothing but indentation and a `+` — the one line shape
// whose meaning `adjust_indentation!` can change (see Paragraph).
const INDENTED_PLUS = /^[ \t]+\+$/v;

// What `Reader#skip_line_comments` takes for a comment: any line that
// starts with two slashes, three-slash lines included.
const COMMENT_HEAD = "//";

// The two paragraph contexts whose lines Asciidoctor re-reads through
// `next_block` with `text_only`: a list item's and a dlist item's own
// text (`parse_list_item`). Only there does an indented first rest-line
// open the literal-paragraph branch that strips the indent.
const ITEM_TEXT_CONTEXTS = new Set<ParagraphContext>(["listItem", "dlistItem"]);

/**
 * What paragraph reading needs from the BlockReader, which stays the
 * ONLY owner of the frame stack and of the read position.
 */
export interface ParagraphHost {
  /** The whole document — inline runs are slices of it. */
  readonly source: string;
  /** The next unread line, or undefined at end of input. */
  readonly peek: () => SourceLine | undefined;
  /** Consume the line `peek` returned, ending any run of blanks. */
  readonly advance: () => void;
  /** The stack as `classifyLine` consumes it. */
  readonly context: (
    openParagraph?: ParagraphContext,
    firstLineAfterStart?: boolean,
  ) => ReaderContext;
  /** Release the metadata nodes held back for the block that follows. */
  readonly flushMetadata: () => void;
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
 * One paragraph being read. Owns the run bookkeeping only — the line
 * position and the stack stay the host's.
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
  private linesRead = NEXT;
  // The literal-plus rule's state: the candidate ` +` line (the first
  // line after an item's marker line, when it is indentation and a `+`
  // and nothing else) and the smallest indent of any content line
  // after it. See {@link Paragraph.finish}.
  private plusLine: SourceLine | undefined = undefined;
  private minIndentAfterPlus = Number.POSITIVE_INFINITY;

  /**
   * @param host - the reader that owns the stack and the read position
   * @param context - which interrupting set applies
   * @param line - the paragraph's first line
   * @param from - raw column index where the paragraph's text starts
   */
  constructor(
    private readonly host: ParagraphHost,
    private readonly context: ParagraphContext,
    line: SourceLine,
    from: number,
  ) {
    this.runEnd = line.offset + line.raw.length;
    if (context === "dlistItem" && line.text.startsWith(COMMENT_HEAD)) {
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
      const next = this.host.peek();
      if (next === undefined) {
        return;
      }
      const kind = classifyLine(
        next.text,
        this.host.context(this.context, this.linesRead === NEXT),
      );
      if (kind.kind !== "text" && kind.kind !== "raw") {
        return;
      }
      this.take(next, kind);
    }
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
    const { host } = this;
    const newline = host.source[run.end] === "\n" ? "\n" : "";
    const tokens = tokenizeInline(
      `${host.source.slice(run.start, run.end)}${newline}`,
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
   *
   * A `text` line carrying `verbatim` is a foreign list marker inside a
   * `+`-attached paragraph (Ruby's `within_nested_list`): reflowing it
   * off column 0 would silently change what the NEXT `+` means, so it
   * gets its own line the way a comment does — `rawLine` is the AST
   * node the printer already keeps on an output line of its own.
   * @param line - the line to add
   * @param kind - what the classifier made of it
   */
  private take(line: SourceLine, kind: LineKind): void {
    this.trackLiteralPlus(line, kind);
    if (kind.kind === "text" && kind.verbatim !== true) {
      this.runStart ??= line.offset;
      this.runEnd = line.offset + line.raw.length;
    } else {
      this.closeRun();
      this.pieces.push({ kind: "raw", line });
    }
    this.linesRead += NEXT;
    this.host.advance();
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
      this.linesRead === NEXT &&
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
 * Read a paragraph-shaped block starting at `line`, whose text begins
 * at column `from` (past an admonition label or a list marker).
 *
 * Yields the body's tokens — one tokenized run per RUN of reflowable
 * text lines, a `RawLine` token for each line kept verbatim, in source
 * order. The line that ENDED the paragraph is left unconsumed; the
 * caller never classifies it again.
 * @param host - the reader that owns the stack and the read position
 * @param context - which interrupting set applies (see ParagraphContext)
 * @param line - the paragraph's first line
 * @param from - raw column index where the paragraph's text starts
 * @returns the body's tokens
 */
export function readParagraph(
  host: ParagraphHost,
  context: ParagraphContext,
  line: SourceLine,
  from: number,
): InlineToken[] {
  host.flushMetadata();
  const paragraph = new Paragraph(host, context, line, from);
  host.advance();
  paragraph.read();
  return paragraph.finish();
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
 * @param host - the reader that owns the stack and the read position
 * @param line - the paragraph's first (indented) line
 * @returns the run's lines, in order; a blank line ends the run, so
 *   two literal paragraphs it separates never share one
 */
export function readLiteralParagraph(
  host: ParagraphHost,
  line: SourceLine,
): readonly SourceLine[] {
  host.flushMetadata();
  const lines = [line];
  host.advance();
  for (;;) {
    const next = host.peek();
    if (next === undefined) {
      break;
    }
    const kind = classifyLine(next.text, host.context("literalParagraph"));
    if (kind.kind !== "text" && kind.kind !== "raw") {
      break;
    }
    lines.push(next);
    host.advance();
  }
  return lines;
}

/**
 * Width of a line's leading whitespace.
 * @param text - one rstripped source line
 * @returns how many characters precede the first non-blank one
 */
function indentOf(text: string): number {
  return text.length - text.trimStart().length;
}
