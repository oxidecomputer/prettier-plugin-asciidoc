/**
 * Paragraph extent: the port of `Parser.read_paragraph_lines` and the
 * `Reader.read_lines_until` options it passes (`break_on_blank_lines`,
 * `break_on_list_continuation`, `preserve_last_line`, and the
 * `StartOfBlock…Proc` break condition, which classify.ts holds as the
 * registry's interrupting sets).
 *
 * Split out of reader.ts by responsibility: this module decides how far
 * a paragraph-shaped block reaches and turns its lines into inline
 * fragments; reader.ts owns the frame stack and decides what a line
 * OPENS. list-reader.ts is the third member and reads the reader
 * through the same {@link ParagraphHost} seam.
 *
 * Every decision here comes from the context the host hands over.
 * Nothing scans backwards or inspects a token history.
 */
import type { IToken, TokenType } from "chevrotain";
import { FIRST_COLUMN, NEXT } from "../../constants.js";
import type { ParagraphContext } from "../line-shapes.js";
import { classifyLine, type LineKind, type ReaderContext } from "./classify.js";
import type { SourceLine } from "./split.js";
import { lexInlineFragment, type InlineFragment } from "./token-factory.js";
import * as T from "./tokens.js";

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
  /** The whole document — inline fragments are slices of it. */
  readonly source: string;
  /** The token stream under construction, in emission order. */
  readonly tokens: IToken[];
  /** The next unread line, or undefined at end of input. */
  readonly peek: () => SourceLine | undefined;
  /** Consume the line `peek` returned, ending any run of blanks. */
  readonly advance: () => void;
  /** The stack as `classifyLine` consumes it. */
  readonly context: (
    openParagraph?: ParagraphContext,
    firstLineAfterStart?: boolean,
  ) => ReaderContext;
  /** Emit a whole-line token, optionally a slice of the line. */
  readonly emitLine: (
    type: TokenType,
    line: SourceLine,
    from?: number,
    to?: number,
  ) => void;
  /** Emit a zero-length boundary token at a 0-based column of a line. */
  readonly emitBoundaryAt: (
    type: TokenType,
    line: SourceLine,
    column?: number,
  ) => void;
  /** Release the metadata tokens held back for the block that follows. */
  readonly flushMetadata: () => void;
}

// What a paragraph is made of, in source order: runs of reflowable
// text lines (one inline fragment each) and lines kept verbatim.
type Piece =
  | {
      /** Piece discriminant: a run of reflowable lines. */
      readonly kind: "run";
      /** Where the run sits in the document. */
      readonly fragment: InlineFragment;
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
 * Nothing is lexed until the paragraph is complete: `finish` turns the
 * pieces into tokens in one pass, once every line is in, so a rule
 * that needs the whole paragraph (the literal-plus rule, below) is
 * decided BEFORE the inline lexer runs — the reader never rewrites a
 * token it has already emitted.
 */
class Paragraph {
  // The pieces read so far, in source order.
  private readonly pieces: Piece[] = [];
  // The reflowable run in progress, or undefined right after a line the
  // reader had to keep verbatim.
  private run: Omit<InlineFragment, "end"> | undefined = undefined;
  // Document offset just past the run's last character.
  private runEnd: number;
  // The last line the paragraph CONSUMED, raw lines included: it is
  // where ParagraphEnd goes. A paragraph whose last line is a comment
  // would otherwise close before that comment's own token.
  private last: SourceLine;
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
   * @param host - the reader that owns the stack and the token stream
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
    this.last = line;
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
    this.run = {
      start: line.offset + from,
      line: line.line,
      column: from + FIRST_COLUMN,
    };
  }

  /**
   * Consume lines until one ends the paragraph. The ending line is left
   * unread — `read_lines_until` with `preserve_last_line: true`.
   * @returns the kind of the line that ended it, or undefined at EOF
   */
  read(): LineKind | undefined {
    for (;;) {
      const next = this.host.peek();
      if (next === undefined) {
        return undefined;
      }
      const kind = classifyLine(
        next.text,
        this.host.context(this.context, this.linesRead === NEXT),
      );
      if (kind.kind !== "text" && kind.kind !== "raw") {
        return kind;
      }
      this.take(next, kind);
    }
  }

  /**
   * Emit the paragraph's tokens — every run lexed now, every raw line
   * in its place — and close it.
   *
   * THE LITERAL-PLUS RULE. `parse_list_item` re-reads an item's lines
   * through `next_block` with `text_only`, and when the first line
   * after the marker line is indented that is the literal-paragraph
   * branch (`indented && !style`): `read_paragraph_lines` then
   * `adjust_indentation!`, folded back into the item's text. The
   * common indent of those lines is stripped BEFORE `HardLineBreakRx`
   * (`^(.*) \+$`) ever runs, so a ` +` line no less indented than
   * every content line after it loses its space and is a bare `+` —
   * plain text, not a break. The inline lexer cannot know this on its
   * own: the decision needs the whole paragraph and the fact that its
   * first line is an item's marker line, both of which only the reader
   * has. So the reader decides first and tells the fragment lexer which
   * line's ` +` is literal. Oracle: `. item` / ` +` / `  more` renders
   * `item + more`; with `more` flush left it renders `item <br> more`
   * (the common indent is 0), and `text` / ` +` / `  more` is a break
   * too (a plain paragraph is never re-indented).
   */
  finish(): void {
    this.closeRun();
    const { plusLine } = this;
    const literalPlusLine =
      plusLine !== undefined &&
      this.minIndentAfterPlus >= indentOf(plusLine.text)
        ? plusLine.line
        : undefined;
    for (const piece of this.pieces) {
      if (piece.kind === "raw") {
        this.host.emitLine(T.RawLine, piece.line);
      } else {
        this.host.tokens.push(
          ...lexInlineFragment(this.host.source, piece.fragment, {
            literalPlusLine,
          }),
        );
      }
    }
    this.host.emitBoundaryAt(T.ParagraphEnd, this.last);
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
      this.run ??= {
        start: line.offset,
        line: line.line,
        column: FIRST_COLUMN,
      };
      this.runEnd = line.offset + line.raw.length;
    } else {
      this.closeRun();
      this.pieces.push({ kind: "raw", line });
    }
    this.last = line;
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
    if (this.run === undefined) {
      return;
    }
    this.pieces.push({
      kind: "run",
      fragment: { ...this.run, end: this.runEnd },
    });
    this.run = undefined;
  }
}

/**
 * Read a paragraph-shaped block starting at `line`, whose text begins
 * at column `from` (past an admonition label or a list marker).
 *
 * Emits ParagraphStart, one inline fragment per RUN of reflowable text
 * lines, a RawLine for each line kept verbatim, and ParagraphEnd. The
 * line that ENDED the paragraph is left unconsumed.
 * @param host - the reader that owns the stack and the token stream
 * @param context - which interrupting set applies (see ParagraphContext)
 * @param line - the paragraph's first line
 * @param from - raw column index where the paragraph's text starts
 * @returns the kind of the line that ended the paragraph, or undefined
 *   at end of input; the caller never classifies it again
 */
export function readParagraph(
  host: ParagraphHost,
  context: ParagraphContext,
  line: SourceLine,
  from: number,
): LineKind | undefined {
  host.flushMetadata();
  host.emitBoundaryAt(T.ParagraphStart, line, from);
  const paragraph = new Paragraph(host, context, line, from);
  host.advance();
  const stop = paragraph.read();
  paragraph.finish();
  return stop;
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
 * @param host - the reader that owns the stack and the token stream
 * @param line - the paragraph's first (indented) line
 */
export function readLiteralParagraph(
  host: ParagraphHost,
  line: SourceLine,
): void {
  host.flushMetadata();
  host.emitLine(T.LiteralLine, line);
  host.advance();
  let last = line;
  for (;;) {
    const next = host.peek();
    if (next === undefined) {
      break;
    }
    const kind = classifyLine(next.text, host.context("literalParagraph"));
    if (kind.kind !== "text" && kind.kind !== "raw") {
      break;
    }
    host.emitLine(T.LiteralLine, next);
    host.advance();
    last = next;
  }
  // The end is a token of its own: a blank line emits nothing, so two
  // literal paragraphs it separates would otherwise run together.
  host.emitBoundaryAt(T.LiteralParagraphEnd, last);
}

/**
 * Width of a line's leading whitespace.
 * @param text - one rstripped source line
 * @returns how many characters precede the first non-blank one
 */
function indentOf(text: string): number {
  return text.length - text.trimStart().length;
}
