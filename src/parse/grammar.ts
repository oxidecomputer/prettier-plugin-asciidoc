/* eslint-disable unicorn/consistent-function-scoping -- Chevrotain RULE lambdas must be class property initializers */

/**
 * Chevrotain CST parser for AsciiDoc.
 *
 * The grammar is intentionally flat: sections are parsed as individual block
 * tokens, not as nested rules. This avoids the complexity of recursive section
 * nesting at parse time. The AST builder handles grouping child blocks under
 * their heading after the CST is built.
 *
 * ## Paragraph and inline mode design
 *
 * The lexer uses a multi-mode architecture with THREE modes per block:
 *
 * - `default_mode` contains block-level tokens (section markers, list markers,
 *   delimiters, etc.). They apply to a block's FIRST line only. At the END of
 *   default_mode, `InlineModeStart` is a zero-length custom pattern that opens
 *   a paragraph — pushing to `paragraph` mode — when no block token matches.
 *
 * - `paragraph` mode is the "a paragraph is open" state. `ParagraphEnd` (also
 *   zero-length, and skipped) pops it when the coming line ends the paragraph;
 *   `ParagraphRawLine` takes a comment/directive line whole; otherwise
 *   `ParagraphLineStart` pushes `inline` mode for one line of text. This is
 *   what makes a mid-paragraph `.Title` or `* item` line plain TEXT, the way
 *   Asciidoctor reads it (issues #26, #27, #29).
 *
 * - `inline` mode contains formatting marks (`*`, `_`, `` ` ``, `#`),
 *   attribute references, backslash escapes, and plain text tokens.
 *   `InlineNewline` (`\n`) pops back to `paragraph` mode, where the next line
 *   is classified.
 *
 * The grammar expresses this as `paragraph := InlineModeStart inlineLine (sep
 * (inlineLine | ParagraphRawLine)?)*`, where `inlineLine` is one line of
 * inline content opening with `ParagraphLineStart`.
 *
 * ## Newline token distinction
 *
 * There are THREE newline tokens with different roles:
 * - `Newline` — in `default_mode`, a structural line separator
 * - `InlineNewline` — in `inline` mode, pops back to `paragraph` mode
 * - `ParagraphNewline` — in `paragraph` mode, ends a raw line (which never
 *   entered inline mode, so there is nothing to pop)
 *
 * A paragraph's line separator is therefore `InlineNewline | ParagraphNewline`
 * wherever the grammar loops over lines.
 *
 * `performSelfAnalysis()` runs once per class instantiation to build lookahead
 * tables. We create a single parser instance and reuse it by setting `.input`
 * before each parse.
 */
import { CstParser } from "chevrotain";
import type { CstNode, ParserMethod, TokenType } from "chevrotain";
import {
  allTokens,
  AttributeEntry,
  BlankLine,
  BlockCommentContent,
  BlockCommentDelimiter,
  BlockCommentEnd,
  DocumentTitle,
  ExampleBlockClose,
  ExampleBlockOpen,
  LineComment,
  ThematicBreak,
  PageBreak,
  FencedCodeClose,
  FencedCodeOpen,
  ListingBlockClose,
  ListingBlockOpen,
  LiteralBlockClose,
  LiteralBlockOpen,
  Newline,
  OpenBlockDelimiter,
  PassBlockClose,
  PassBlockOpen,
  QuoteBlockClose,
  QuoteBlockOpen,
  SectionMarker,
  SidebarBlockClose,
  SidebarBlockOpen,
  AttributeReference,
  BackslashEscape,
  BoldMark,
  HighlightMark,
  IndentedLine,
  InlineChar,
  InlineModeStart,
  InlineNewline,
  InlineText,
  ParagraphLineStart,
  ParagraphNewline,
  ParagraphRawLine,
  ItalicMark,
  MonoMark,
  RoleAttribute,
  UnorderedListMarker,
  OrderedListMarker,
  CalloutListMarker,
  VerbatimContent,
  BlockAttributeList,
  BlockTitle,
  BlockAnchor,
  BlockMacro,
  ConditionalDirective,
  IncludeDirective,
  AdmonitionMarker,
  InlineMacro,
  InlineUrl,
  XrefShorthand,
  InlineAnchor,
  HardLineBreak,
} from "./tokens.js";
import { LOOKAHEAD, LOOKAHEAD_2 } from "../constants.js";

/**
 * A single instance is created and reused — set `.input`
 * before each parse to reset state. performSelfAnalysis()
 * builds lookahead tables from the grammar rules; it must
 * run exactly once per class (not per parse call).
 */
export class AsciidocParser extends CstParser {
  constructor() {
    // recoveryEnabled activates Chevrotain's four built-in
    // recovery strategies (token insertion, deletion,
    // repetition re-sync, general re-sync). This lets the
    // parser produce a partial CST even when rules fail —
    // e.g. an unclosed delimited block missing its end
    // delimiter. Without this, such inputs would throw a
    // parse error, crashing the formatter instead of
    // degrading gracefully.
    super(allTokens, { recoveryEnabled: true });
    this.performSelfAnalysis();
  }

  /**
   * Top-level rule: sequence of blocks separated by blank
   * lines. The Newline alternative handles edge cases like a
   * lone \n at the start of input (not enough for BlankLine,
   * which requires \n...\n).
   */
  document = this.RULE("document", () => {
    this.MANY(() => {
      this.OR([
        { ALT: () => this.CONSUME(BlankLine) },
        { ALT: () => this.CONSUME(Newline) },
        { ALT: () => this.SUBRULE(this.block) },
      ]);
    });
  });

  /**
   * A block-level element: section heading, comment, attribute
   * entry, list, or paragraph. Attribute entry must precede
   * paragraph because an attribute line like `:toc:` would also
   * match as inline text. Unordered list must precede paragraph
   * because `* text` would also match as inline text.
   */
  block = this.RULE("block", () => {
    this.OR([
      { ALT: () => this.CONSUME(SectionMarker) },
      { ALT: () => this.CONSUME(DocumentTitle) },
      { ALT: () => this.CONSUME(LineComment) },
      { ALT: () => this.CONSUME(BlockAttributeList) },
      { ALT: () => this.CONSUME(BlockTitle) },
      { ALT: () => this.CONSUME(ThematicBreak) },
      { ALT: () => this.CONSUME(PageBreak) },
      { ALT: () => this.CONSUME(ConditionalDirective) },
      { ALT: () => this.CONSUME(IncludeDirective) },
      { ALT: () => this.CONSUME(BlockMacro) },
      { ALT: () => this.CONSUME(BlockAnchor) },
      { ALT: () => this.SUBRULE(this.blockComment) },
      { ALT: () => this.SUBRULE(this.attributeEntry) },
      { ALT: () => this.SUBRULE(this.unorderedList) },
      { ALT: () => this.SUBRULE(this.orderedList) },
      { ALT: () => this.SUBRULE(this.calloutList) },
      { ALT: () => this.SUBRULE(this.listingBlock) },
      { ALT: () => this.SUBRULE(this.fencedCodeBlock) },
      { ALT: () => this.SUBRULE(this.literalBlock) },
      { ALT: () => this.SUBRULE(this.passBlock) },
      { ALT: () => this.SUBRULE(this.exampleBlock) },
      { ALT: () => this.SUBRULE(this.sidebarBlock) },
      { ALT: () => this.SUBRULE(this.openBlock) },
      { ALT: () => this.SUBRULE(this.quoteBlock) },
      { ALT: () => this.SUBRULE(this.literalParagraph) },
      { ALT: () => this.SUBRULE(this.admonitionParagraph) },
      { ALT: () => this.SUBRULE(this.paragraph) },
    ]);
  });

  /**
   * Block comment: opening delimiter, optional content lines,
   * closing delimiter. The lexer handles mode switching —
   * BlockCommentDelimiter pushes into block_comment mode, and
   * BlockCommentEnd pops back. Content between delimiters can
   * be any mix of text and blank lines.
   */
  blockComment = this.RULE("blockComment", () => {
    this.CONSUME(BlockCommentDelimiter);
    this.MANY(() => {
      this.OR2([
        { ALT: () => this.CONSUME(BlockCommentContent) },
        { ALT: () => this.CONSUME(Newline) },
        { ALT: () => this.CONSUME(BlankLine) },
      ]);
    });
    this.CONSUME(BlockCommentEnd);
    // Consume optional trailing newline after closing delimiter.
    this.OPTION(() => {
      this.CONSUME2(Newline);
    });
  });

  // Factory for leaf block rules. Listing, literal, and pass
  // blocks share identical grammar: open delimiter, verbatim
  // content (no inline parsing), close delimiter. The lexer
  // handles mode-switching for each block type.
  private leafBlockRule(
    name: string,
    openToken: TokenType,
    closeToken: TokenType,
  ): ParserMethod<[], CstNode> {
    return this.RULE(name, () => {
      this.CONSUME(openToken);
      this.MANY(() => {
        this.OR([
          { ALT: () => this.CONSUME(VerbatimContent) },
          { ALT: () => this.CONSUME(Newline) },
          { ALT: () => this.CONSUME(BlankLine) },
        ]);
      });
      this.CONSUME(closeToken);
      this.OPTION(() => {
        this.CONSUME2(Newline);
      });
    });
  }

  /** Listing block: `----` delimiters with verbatim content. */
  listingBlock = this.leafBlockRule(
    "listingBlock",
    ListingBlockOpen,
    ListingBlockClose,
  );
  /**
   * Markdown-style fenced code block: ` ``` ` delimiters with
   * optional language hint. Parsed into the same CST shape as
   * listing blocks so the AST builder can produce identical
   * nodes.
   */
  fencedCodeBlock = this.leafBlockRule(
    "fencedCodeBlock",
    FencedCodeOpen,
    FencedCodeClose,
  );
  /** Literal block: `....` delimiters with verbatim content. */
  literalBlock = this.leafBlockRule(
    "literalBlock",
    LiteralBlockOpen,
    LiteralBlockClose,
  );
  /** Passthrough block: `++++` delimiters with verbatim content. */
  passBlock = this.leafBlockRule("passBlock", PassBlockOpen, PassBlockClose);

  // Factory for parent block rules. All four types (example,
  // sidebar, open, quote) share identical grammar structure:
  // open delimiter, recursive block content, close delimiter.
  private parentBlockRule(
    name: string,
    openToken: TokenType,
    closeToken: TokenType,
  ): ParserMethod<[], CstNode> {
    return this.RULE(name, () => {
      this.CONSUME(openToken);
      // When open and close are the same token type (open
      // blocks), the GATE prevents the loop from consuming
      // the close delimiter. When they differ (example,
      // sidebar, quote), the GATE is redundant but harmless.
      this.MANY({
        GATE: () => this.LA(LOOKAHEAD).tokenType !== closeToken,
        DEF: () => {
          this.OR([
            { ALT: () => this.CONSUME(BlankLine) },
            { ALT: () => this.CONSUME(Newline) },
            { ALT: () => this.SUBRULE(this.block) },
          ]);
        },
      });
      // CONSUME2 because when openToken === closeToken (open
      // blocks), Chevrotain requires numerical suffixes for
      // the second occurrence of the same token type.
      this.CONSUME2(closeToken);
      this.OPTION(() => {
        this.CONSUME2(Newline);
      });
    });
  }

  /** Example block: `====` delimiters with recursive block content. */
  exampleBlock = this.parentBlockRule(
    "exampleBlock",
    ExampleBlockOpen,
    ExampleBlockClose,
  );
  /** Sidebar block: `****` delimiters with recursive block content. */
  sidebarBlock = this.parentBlockRule(
    "sidebarBlock",
    SidebarBlockOpen,
    SidebarBlockClose,
  );
  /** Open block: `--` delimiters with recursive block content. */
  openBlock = this.parentBlockRule(
    "openBlock",
    OpenBlockDelimiter,
    OpenBlockDelimiter,
  );
  /** Quote block: `____` delimiters with recursive block content. */
  quoteBlock = this.parentBlockRule(
    "quoteBlock",
    QuoteBlockOpen,
    QuoteBlockClose,
  );

  /**
   * Literal paragraph: consecutive lines starting with one or
   * more spaces. The indented content is preserved verbatim
   * (not reflowed). A blank line or non-indented line ends it.
   */
  literalParagraph = this.RULE("literalParagraph", () => {
    this.CONSUME(IndentedLine);
    this.MANY(() => {
      this.CONSUME(Newline);
      this.CONSUME2(IndentedLine);
    });
    this.OPTION(() => {
      this.CONSUME2(Newline);
    });
  });

  /**
   * Attribute entry: a single token consumed as a block-level
   * element. The lexer handles the pattern matching; the
   * grammar just needs to recognize that an AttributeEntry
   * token is a complete block.
   */
  attributeEntry = this.RULE("attributeEntry", () => {
    this.CONSUME(AttributeEntry);
    // Consume optional trailing newline, same as other single-line
    // block elements.
    this.OPTION(() => {
      this.CONSUME(Newline);
    });
  });

  // Factory for list rules. All three list types (unordered,
  // ordered, callout) share identical grammar: one or more
  // items in sequence. Nesting is resolved later in the AST
  // builder by comparing marker depths.
  private listRule(
    name: string,
    itemRule: ParserMethod<[], CstNode>,
  ): ParserMethod<[], CstNode> {
    return this.RULE(name, () => {
      this.AT_LEAST_ONE(() => {
        this.SUBRULE(itemRule);
      });
    });
  }

  // Factory for list item rules. All three item types share
  // identical grammar: a marker token followed by inline
  // content with optional continuation lines.
  //
  // The grammar handles two distinct continuation patterns
  // because of how the lexer's modes interact with line
  // boundaries:
  //
  // Pattern 1 (MANY2): newline-separated inline lines
  //   The item's text opens a paragraph (InlineModeStart),
  //   and each of its lines is bracketed by
  //   ParagraphLineStart … InlineNewline. This loop walks
  //   that cycle. Two lines in it do NOT start with
  //   ParagraphLineStart:
  //   - a raw line (ParagraphRawLine + ParagraphNewline),
  //     lexed whole in paragraph mode, and
  //   - the first line after a `+` continuation, which the
  //     lexer hands back to default_mode (that is how the
  //     block a `+` attaches gets classified). When it is
  //     plain text it re-enters through InlineModeStart, and
  //     the OPTION3 inside this loop keeps it in the ITEM —
  //     see the comment there.
  //
  // Pattern 2 (MANY3): Newline-separated lines after indent
  //   An IndentedLine consumes the ENTIRE line as a single
  //   token in `default_mode`. It only reaches an item after
  //   a `+` (a paragraph swallows indented lines as text),
  //   where it makes the attached block a literal one. The
  //   next line boundary is then a Newline token (in
  //   default_mode), not an InlineNewline, which is what
  //   MANY3 exists for.
  //
  //   MANY3 requires a GATE because Newline is also used
  //   for blank lines (paragraph boundaries). Without the
  //   GATE, the parser would consume a blank line's Newline
  //   and then fail to match IndentedLine or InlineModeStart
  //   on the next line (which might be a new list marker or
  //   block-level construct). The GATE peeks at LA(2) — the
  //   token AFTER the Newline — and only allows the loop to
  //   continue if it's IndentedLine or InlineModeStart
  //   (legitimate continuation content).
  //
  // Example token sequences (PLS = ParagraphLineStart):
  //
  //   "* text\n  more\n"
  //   ULM InMS PLS InTx InNL PLS InTx InNL
  //             ^first line^  ^MANY2 loop^
  //   The indented line is ordinary paragraph text now, so
  //   it never becomes an IndentedLine token.
  //
  //   "* text\n+\n  indented\n"
  //   ULM InMS PLS InTx InNL InMS PLS InTx InNL IndL NL
  //             ^first^  ^MANY2: the `+` line^  ^MANY2^
  //
  //   "* text\n\nparagraph\n"
  //   ULM InMS PLS InTx InNL NL InMS PLS InTx InNL
  //             ^first line^
  //   MANY2 consumed InNL and found Newline, so OPTION2
  //   produces nothing; the loop then exits because LA(1) is
  //   Newline, not a line separator. The parser returns to
  //   the document level, where Newline is consumed as a
  //   blank line separator and "paragraph" becomes a
  //   separate paragraph block.
  private listItemRule(
    name: string,
    markerToken: TokenType,
  ): ParserMethod<[], CstNode> {
    return this.RULE(name, () => {
      this.CONSUME(markerToken);
      // First line of the list item. After the marker token
      // is consumed in default_mode, InlineModeStart (the
      // catch-all at the end of default_mode) fires and
      // opens a paragraph for the item's text; each of its
      // lines then opens with ParagraphLineStart.
      this.CONSUME(InlineModeStart);
      this.SUBRULE(this.inlineLine);
      // Continuation lines (Pattern 1): each iteration
      // starts with the newline that ended the previous
      // line, then optionally consumes the next line as
      // inline text, a verbatim raw line, or (Task 6 will
      // remove this now-unreachable branch) an indented line.
      this.MANY2(() => {
        this.OR3([
          { ALT: () => this.CONSUME(InlineNewline) },
          { ALT: () => this.CONSUME(ParagraphNewline) },
        ]);
        this.OPTION2(() => {
          this.OR([
            {
              ALT: () => {
                // A `+` continuation line ends the item's paragraph
                // in the LEXER, so the lines it attaches re-enter
                // through InlineModeStart. Consuming that here keeps
                // them inside the ITEM, which is what makes
                // `* a` / `+` / `para` / `* b` one list rather than
                // two with a paragraph wedged between them (and, for
                // an ordered list, one numbering rather than two).
                // continuation-builder.ts then splits the item's
                // stream at the `+`.
                this.OPTION3(() => {
                  this.CONSUME2(InlineModeStart);
                });
                this.SUBRULE2(this.inlineLine);
              },
            },
            {
              ALT: () => {
                this.CONSUME(ParagraphRawLine);
              },
            },
            {
              ALT: () => {
                // IndentedLine matches a line starting with
                // whitespace as a single token in
                // default_mode. No push to inline mode.
                this.CONSUME(IndentedLine);
                // Pattern 2: after an IndentedLine, more
                // lines may follow using Newline (in
                // default_mode) as the separator instead
                // of InlineNewline (which only exists in
                // inline mode).
                this.MANY3({
                  GATE: () => {
                    // Peek past the Newline to check if the
                    // next line is continuation content.
                    // LA(1) = Newline, LA(2) = next token.
                    // Only continue if LA(2) is IndentedLine
                    // or InlineModeStart. This rejects:
                    // - BlankLine (paragraph boundary)
                    // - List markers (new list item)
                    // - Block delimiters, etc.
                    const next = this.LA(LOOKAHEAD_2);
                    return (
                      next.tokenType === IndentedLine ||
                      next.tokenType === InlineModeStart
                    );
                  },
                  DEF: () => {
                    this.CONSUME(Newline);
                    this.OR2([
                      {
                        ALT: () => {
                          this.CONSUME2(IndentedLine);
                        },
                      },
                      {
                        ALT: () => {
                          // A flush line after an indented one now
                          // re-enters through InlineModeStart, same
                          // as in the loop above.
                          this.OPTION4(() => {
                            this.CONSUME3(InlineModeStart);
                          });
                          this.SUBRULE3(this.inlineLine);
                        },
                      },
                    ]);
                  },
                });
              },
            },
          ]);
        });
      });
    });
  }

  /**
   * A single unordered list item: `*`{1,5} marker followed
   * by text content with optional continuation lines.
   */
  listItem = this.listItemRule("listItem", UnorderedListMarker);
  /** Unordered list: one or more unordered list items. */
  unorderedList = this.listRule("unorderedList", this.listItem);

  /**
   * Single ordered list item: `.`{1,5} marker, text content,
   * and optional continuation lines.
   */
  orderedListItem = this.listItemRule("orderedListItem", OrderedListMarker);
  /** Ordered list: one or more ordered list items. */
  orderedList = this.listRule("orderedList", this.orderedListItem);

  /**
   * Single callout list item: `<N>` marker, text content,
   * and optional continuation lines.
   */
  calloutListItem = this.listItemRule("calloutListItem", CalloutListMarker);
  /** Callout list: one or more callout list items. */
  calloutList = this.listRule("calloutList", this.calloutListItem);

  // ── Inline content subrules ───────────────────────────
  //
  // The lexer uses a multi-mode design for inline content.
  // Block-level tokens live in `default_mode`. When no
  // block token matches a line, InlineModeStart (a
  // zero-length custom pattern at the end of default_mode)
  // fires and pushes to `inline` mode without consuming
  // any characters. In inline mode, formatting marks
  // (BoldMark, ItalicMark, etc.), attribute references,
  // backslash escapes, and plain text are tokenized.
  //
  // InlineNewline (`\n` in inline mode) pops back to
  // default_mode, giving each new line a chance to match
  // block-level tokens. This creates a natural line-by-line
  // cycle: default_mode → InlineModeStart → inline mode →
  // InlineNewline → default_mode → next line.
  //
  // The grammar rules below consume this token stream.
  // `inlineLine` wraps one line's worth of inline tokens
  // (InlineModeStart + inlineToken*). Multi-line constructs
  // like paragraphs chain multiple inlineLines separated by
  // InlineNewline tokens.

  // Matches any single inline-mode token. The alternatives
  // correspond to the tokens defined in the `inline` mode
  // of the lexer's multiModeDefinition. InlineText matches
  // runs of non-special characters; InlineChar is a
  // single-character fallback for chars that didn't match
  // any higher-priority token (e.g. a stray `*` not at a
  // word boundary). The AST builder merges adjacent text
  // tokens into combined TextNode values.
  inlineToken = this.RULE("inlineToken", () => {
    this.OR([
      { ALT: () => this.CONSUME(BoldMark) },
      { ALT: () => this.CONSUME(ItalicMark) },
      { ALT: () => this.CONSUME(MonoMark) },
      { ALT: () => this.CONSUME(HighlightMark) },
      { ALT: () => this.CONSUME(RoleAttribute) },
      { ALT: () => this.CONSUME(AttributeReference) },
      { ALT: () => this.CONSUME(BackslashEscape) },
      // Self-contained inline tokens — each is a single token
      // representing the full construct.
      { ALT: () => this.CONSUME(InlineMacro) },
      { ALT: () => this.CONSUME(InlineUrl) },
      { ALT: () => this.CONSUME(XrefShorthand) },
      { ALT: () => this.CONSUME(InlineAnchor) },
      { ALT: () => this.CONSUME(HardLineBreak) },
      { ALT: () => this.CONSUME(InlineText) },
      { ALT: () => this.CONSUME(InlineChar) },
    ]);
  });

  // A single line of inline content. ParagraphLineStart pushes
  // from paragraph mode to inline mode (zero-length match),
  // then MANY consumes inline tokens until InlineNewline or
  // EOF. Extracted as a subrule to keep callback nesting
  // within the max-nested-callbacks lint limit, and to give
  // the CST a clear per-line grouping that the AST builder
  // can unwrap.
  inlineLine = this.RULE("inlineLine", () => {
    this.CONSUME(ParagraphLineStart);
    this.MANY(() => {
      this.SUBRULE(this.inlineToken);
    });
  });

  /**
   * An admonition paragraph: `NOTE: text`, `TIP: text`, etc.
   * The AdmonitionMarker token consumes the label prefix
   * (`NOTE: `); the remaining first-line text and any
   * continuation lines form the admonition content.
   *
   * The first inlineLine is optional because empty
   * admonitions (just `NOTE:`) are valid AsciiDoc.
   * Continuation lines use InlineNewline (which pops
   * inline mode) as the separator, matching the paragraph
   * pattern.
   */
  admonitionParagraph = this.RULE("admonitionParagraph", () => {
    this.CONSUME(AdmonitionMarker);
    this.OPTION(() => {
      this.CONSUME(InlineModeStart);
      this.SUBRULE(this.inlineLine);
    });
    this.MANY2(() => {
      this.OR([
        { ALT: () => this.CONSUME(InlineNewline) },
        { ALT: () => this.CONSUME(ParagraphNewline) },
      ]);
      this.OPTION2(() => {
        this.OR2([
          { ALT: () => this.SUBRULE2(this.inlineLine) },
          { ALT: () => this.CONSUME(ParagraphRawLine) },
        ]);
      });
    });
  });

  // A paragraph: one or more lines of inline content.
  //
  // The first inlineLine is mandatory (a paragraph must
  // have content). Continuation lines are separated by
  // InlineNewline — each newline pops to default_mode,
  // where the lexer checks for block-level tokens. If
  // none match, InlineModeStart fires and pushes back to
  // inline mode for the next line.
  //
  // The OPTION on subsequent lines allows InlineNewline
  // at the end of the paragraph (trailing newline) without
  // requiring more content. The trailing InlineNewline is
  // part of the CST but the AST builder strips it during
  // inline node construction.
  //
  // Paragraph boundaries: a BlankLine, a block-level token,
  // or EOF ends the paragraph. When InlineNewline pops to
  // default_mode and a BlankLine or block token matches,
  // the grammar returns to the document rule instead of
  // continuing the MANY2 loop.
  paragraph = this.RULE("paragraph", () => {
    // InlineModeStart opens the paragraph (default -> paragraph
    // mode); every LINE of it then opens with ParagraphLineStart
    // inside inlineLine.
    this.CONSUME(InlineModeStart);
    this.SUBRULE(this.inlineLine);
    this.MANY2(() => {
      // A text line ends with InlineNewline (popping inline mode
      // back to paragraph mode); a raw line ends with
      // ParagraphNewline, lexed in paragraph mode because a raw
      // line never enters inline mode at all.
      this.OR([
        { ALT: () => this.CONSUME(InlineNewline) },
        { ALT: () => this.CONSUME(ParagraphNewline) },
      ]);
      this.OPTION(() => {
        this.OR2([
          { ALT: () => this.SUBRULE2(this.inlineLine) },
          { ALT: () => this.CONSUME(ParagraphRawLine) },
        ]);
      });
    });
  });
}

/** Singleton parser instance — set `.input` before each use. */
export const asciidocParser = new AsciidocParser();
