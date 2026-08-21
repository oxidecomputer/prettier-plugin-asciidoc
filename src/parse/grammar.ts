/* eslint-disable unicorn/consistent-function-scoping -- Chevrotain RULE lambdas must be class property initializers */

/**
 * Chevrotain CST parser for AsciiDoc — the MECHANICAL block grammar.
 *
 * The parser's input is not a lexer's output: it is the token stream
 * the BlockReader (src/parse/lines/reader.ts) emits after walking the
 * source lines once with an explicit context stack. Every nesting
 * decision — where a paragraph, list item, list, section or delimited
 * block ENDS — was made there and is spelled out by a zero-length
 * boundary token (`ParagraphStart`/`ParagraphEnd`, `ItemEnd`,
 * `ListEnd`, `SectionEnd`, `UnclosedEnd`), and every line that is a
 * block by itself arrives as one pre-classified line token. So each
 * rule below is LL(1) on a distinct first token: no parser-state gate,
 * no OPTION that re-absorbs, no custom-pattern lookback, nothing that
 * derives block context. If a construct ever seems to need one of
 * those, the reader is missing a token — add it there.
 *
 * (Spelled "gate" rather than the Chevrotain keyword on purpose:
 * tests/parser/architecture.test.ts bans that keyword textually, and a
 * comment one colon away from tripping the guard is a trap.)
 *
 * Paragraph text is the one place Chevrotain still lexes: the reader
 * runs the inline lexer over each run of paragraph lines and splices
 * the inline tokens between the paragraph's boundary tokens, so the
 * `inlineToken` rule and the inline vocabulary are unchanged.
 *
 * `recoveryEnabled` stays on, but it is a belt against ONE failure:
 * a reader that emits its tokens in an order no rule accepts. It
 * cannot catch anything from the inline layer — the inline lexer's
 * own errors are discarded (lines/token-factory.ts keeps only
 * `tokens`) and `inlineToken` below accepts every token in the inline
 * vocabulary, so no inline input can fail a rule. When recovery does
 * fire the parse degrades quietly (src/parser.ts takes the partial
 * CST), which is why tests/parser/reader.test.ts asserts zero parser
 * errors over the whole conformance corpus and the reader's fuzz
 * properties assert it per generated document.
 *
 * `performSelfAnalysis()` runs once per class instantiation to build
 * the lookahead tables and throws on any ambiguity — that is the LL(1)
 * proof. A single parser instance is reused by setting `.input` before
 * each parse.
 */
import { CstParser } from "chevrotain";
import {
  inlineModeTokens,
  BoldMark,
  ItalicMark,
  MonoMark,
  HighlightMark,
  RoleAttribute,
  AttributeReference,
  BackslashEscape,
  InlineMacro,
  InlineUrl,
  XrefShorthand,
  InlineAnchor,
  HardLineBreak,
  InlineText,
  InlineChar,
  InlineNewline,
} from "./tokens.js";
import {
  blockTokenVocabulary,
  DocumentTitleLine,
  SectionTitleLine,
  DiscreteHeadingLine,
  BlockAttributeLine,
  AnchorLine,
  BlockTitleLine,
  AttributeEntryLine,
  RawLine,
  BlockMacroLine,
  ThematicBreakLine,
  PageBreakLine,
  AdmonitionLabel,
  UnorderedListMarker,
  OrderedListMarker,
  CalloutListMarker,
  LiteralLine,
  CompoundBlockOpen,
  CompoundBlockClose,
  VerbatimBlockOpen,
  VerbatimBlockClose,
  VerbatimLine,
  ParagraphStart,
  ParagraphEnd,
  ItemEnd,
  ListEnd,
  DanglingContinuation,
  KeepTextBreak,
  DetachedContinuation,
  NoContinuation,
  BlankSeparated,
  LiteralParagraphEnd,
  SectionEnd,
  UnclosedEnd,
} from "./lines/tokens.js";

/**
 * The block grammar over the BlockReader's stream. One instance is
 * created and reused — set `.input` before each parse.
 */
class AsciidocParser extends CstParser {
  constructor() {
    // The vocabulary is the reader's block tokens plus the inline
    // tokens it splices into paragraphs. The two sets share no names
    // (the old block-side list-marker tokens are gone), which matters
    // because Chevrotain keys its tokensMap by name.
    super([...blockTokenVocabulary, ...inlineModeTokens], {
      recoveryEnabled: true,
    });
    this.performSelfAnalysis();
  }

  /** A document is a sequence of blocks; blank lines emit no token. */
  document = this.RULE("document", () => {
    this.MANY(() => {
      this.SUBRULE(this.block);
    });
  });

  /**
   * One block-level element. Every alternative starts on its own token
   * type, so the OR needs no ordering and no lookahead beyond one.
   */
  block = this.RULE("block", () => {
    this.OR([
      { ALT: () => this.SUBRULE(this.section) },
      { ALT: () => this.CONSUME(DocumentTitleLine) },
      { ALT: () => this.CONSUME(DiscreteHeadingLine) },
      { ALT: () => this.CONSUME(BlockAttributeLine) },
      { ALT: () => this.CONSUME(AnchorLine) },
      { ALT: () => this.CONSUME(BlockTitleLine) },
      { ALT: () => this.CONSUME(AttributeEntryLine) },
      { ALT: () => this.CONSUME(RawLine) },
      { ALT: () => this.CONSUME(BlockMacroLine) },
      { ALT: () => this.CONSUME(ThematicBreakLine) },
      { ALT: () => this.CONSUME(PageBreakLine) },
      { ALT: () => this.SUBRULE(this.paragraph) },
      { ALT: () => this.SUBRULE(this.admonitionParagraph) },
      { ALT: () => this.SUBRULE(this.list) },
      { ALT: () => this.SUBRULE(this.verbatimBlock) },
      { ALT: () => this.SUBRULE(this.compoundBlock) },
      { ALT: () => this.SUBRULE(this.literalParagraph) },
    ]);
  });

  /**
   * A section: its title line, its blocks (nested sections included),
   * and the SectionEnd the reader emitted where `next_section` would
   * have returned.
   */
  section = this.RULE("section", () => {
    this.CONSUME(SectionTitleLine);
    this.MANY(() => {
      this.SUBRULE(this.block);
    });
    this.CONSUME(SectionEnd);
  });

  /**
   * The inline body every paragraph-shaped block shares: inline tokens
   * and their newlines, plus the comment/directive lines the reader
   * kept verbatim inside the paragraph. One SUBRULE so `paragraph`,
   * `admonitionParagraph` and `listItem` have one CST shape and one
   * reader (`AstBuilder#bodyTokens` in ast-builder.ts).
   */
  paragraphBody = this.RULE("paragraphBody", () => {
    this.MANY(() => {
      this.OR([
        { ALT: () => this.SUBRULE(this.inlineToken) },
        { ALT: () => this.CONSUME(InlineNewline) },
        { ALT: () => this.CONSUME(RawLine) },
      ]);
    });
  });

  /** A plain paragraph. */
  paragraph = this.RULE("paragraph", () => {
    this.CONSUME(ParagraphStart);
    this.SUBRULE(this.paragraphBody);
    this.CONSUME(ParagraphEnd);
  });

  /**
   * A paragraph-form admonition: `NOTE: text`. The label is its own
   * token; the body is an ordinary paragraph (Ruling 21: ParagraphStart
   * is emitted uniformly, after a label too).
   */
  admonitionParagraph = this.RULE("admonitionParagraph", () => {
    this.CONSUME(AdmonitionLabel);
    this.CONSUME(ParagraphStart);
    this.SUBRULE(this.paragraphBody);
    this.CONSUME(ParagraphEnd);
  });

  /** A list: its items, then the ListEnd that closed it. */
  list = this.RULE("list", () => {
    this.AT_LEAST_ONE(() => {
      this.SUBRULE(this.listItem);
    });
    this.CONSUME(ListEnd);
  });

  /**
   * A list item: its marker, its principal paragraph, then every block
   * the reader put INSIDE the item — nested lists, `+`-attached blocks
   * and in-item blocks alike, in source order (Asciidoctor makes the
   * same non-distinction: `list_item.blocks`) — the reader's note that
   * the text must keep its last line break, an optional `+` that
   * attached nothing, and the ItemEnd.
   */
  listItem = this.RULE("listItem", () => {
    this.OR([
      { ALT: () => this.CONSUME(UnorderedListMarker) },
      { ALT: () => this.CONSUME(OrderedListMarker) },
      { ALT: () => this.CONSUME(CalloutListMarker) },
    ]);
    this.CONSUME(ParagraphStart);
    this.SUBRULE(this.paragraphBody);
    this.CONSUME(ParagraphEnd);
    this.MANY(() => {
      this.SUBRULE(this.itemBlock);
    });
    this.OPTION(() => {
      this.CONSUME(KeepTextBreak);
    });
    this.OPTION2(() => {
      this.CONSUME(DanglingContinuation);
    });
    this.CONSUME(ItemEnd);
  });

  /**
   * One block inside a list item, with the reader's note of how it got
   * there — a `+` directly above it (no mark), a detached `+`, no `+`
   * directly under the line before, no `+` after a blank line — which
   * the printer writes back as the source spelled it.
   */
  itemBlock = this.RULE("itemBlock", () => {
    this.OPTION(() => {
      this.OR([
        {
          // One per detached `+` the block was introduced with.
          ALT: () => {
            this.AT_LEAST_ONE(() => {
              this.CONSUME(DetachedContinuation);
            });
          },
        },
        {
          ALT: () => {
            this.CONSUME(NoContinuation);
          },
        },
        {
          ALT: () => {
            this.CONSUME(BlankSeparated);
          },
        },
      ]);
    });
    this.SUBRULE(this.block);
  });

  /**
   * A delimited block whose content is verbatim (listing, literal,
   * pass, comment, fenced code): the opener, its lines, and either its
   * own terminator or the UnclosedEnd an outer terminator or EOF forced.
   */
  verbatimBlock = this.RULE("verbatimBlock", () => {
    this.CONSUME(VerbatimBlockOpen);
    this.MANY(() => {
      this.CONSUME(VerbatimLine);
    });
    this.OR([
      { ALT: () => this.CONSUME(VerbatimBlockClose) },
      { ALT: () => this.CONSUME(UnclosedEnd) },
    ]);
  });

  /**
   * A delimited block whose content is parsed as blocks (example,
   * sidebar, open, quote).
   */
  compoundBlock = this.RULE("compoundBlock", () => {
    this.CONSUME(CompoundBlockOpen);
    this.MANY(() => {
      this.SUBRULE(this.block);
    });
    this.OR([
      { ALT: () => this.CONSUME(CompoundBlockClose) },
      { ALT: () => this.CONSUME(UnclosedEnd) },
    ]);
  });

  /**
   * An indented literal paragraph: the reader grouped its lines and
   * closed the group (two literal paragraphs a blank line separates
   * would otherwise be one run of lines).
   */
  literalParagraph = this.RULE("literalParagraph", () => {
    this.AT_LEAST_ONE(() => {
      this.CONSUME(LiteralLine);
    });
    this.CONSUME(LiteralParagraphEnd);
  });

  // Matches any single inline-mode token. The alternatives correspond
  // to the inline lexer's vocabulary. InlineText matches runs of
  // non-special characters; InlineChar is a single-character fallback
  // for chars that didn't match any higher-priority token (e.g. a
  // stray `*` not at a word boundary). The AST builder merges adjacent
  // text tokens into combined TextNode values.
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
}

/** Singleton parser instance — set `.input` before each use. */
export const asciidocParser = new AsciidocParser();
