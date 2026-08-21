/**
 * CST node child interfaces for the AsciiDoc parser.
 *
 * Chevrotain's CST nodes have optional arrays for each
 * token/subrule consumed. Typed here for safe access in
 * visitors (the raw CST uses `unknown` children).
 *
 * Extracted from ast-builder.ts to keep that file within the
 * max-lines lint limit.
 */
import type { CstNode, IToken } from "chevrotain";

/** Children of the top-level `document` rule. */
export interface DocumentCstChildren {
  /** Nested block-level elements (sections, paragraphs, etc.). */
  block?: CstNode[];
  /** Blank lines separating blocks in the document. */
  BlankLine?: IToken[];
  /** Lone newlines (e.g. a single `\n` at the start of input). */
  Newline?: IToken[];
}

// At most one field is populated per CstNode — the grammar's
// OR rule ensures each block matches exactly one alternative.

/** Children of the `block` rule (one block-level element). */
export interface BlockCstChildren {
  /** Paragraph sub-rule (inline text content). */
  paragraph?: CstNode[];
  /** Section heading marker (`== `, `=== `, etc.). */
  SectionMarker?: IToken[];
  /** Document title (`= Title`). */
  DocumentTitle?: IToken[];
  /** Single-line comment (`// ...`). */
  LineComment?: IToken[];
  /** Block attribute list (`[source,java]`, `[#id]`, etc.). */
  BlockAttributeList?: IToken[];
  /** Block title (`.Title` on the line before a block). */
  BlockTitle?: IToken[];
  /** Thematic break (`'''` or `---`). */
  ThematicBreak?: IToken[];
  /** Page break (`<<<`). */
  PageBreak?: IToken[];
  /** Block macro (`image::target[attrlist]`). */
  BlockMacro?: IToken[];
  /** Block-level anchor (`[[id]]` on its own line). */
  BlockAnchor?: IToken[];
  /** Include directive (`include::path[opts]`). */
  IncludeDirective?: IToken[];
  /** Conditional directive (`ifdef`, `ifndef`, etc.). */
  ConditionalDirective?: IToken[];
  /** Block comment sub-rule (`////...////`). */
  blockComment?: CstNode[];
  /** Attribute entry sub-rule (`:name: value`). */
  attributeEntry?: CstNode[];
  /** Unordered list sub-rule (`* item`). */
  unorderedList?: CstNode[];
  /** Ordered list sub-rule (`. item`). */
  orderedList?: CstNode[];
  /** Callout list sub-rule (`<1> explanation`). */
  calloutList?: CstNode[];
  /** Listing block sub-rule (`----` delimited). */
  listingBlock?: CstNode[];
  /** Fenced code block sub-rule (` ``` ` delimited). */
  fencedCodeBlock?: CstNode[];
  /** Literal block sub-rule (`....` delimited). */
  literalBlock?: CstNode[];
  /** Passthrough block sub-rule (`++++` delimited). */
  passBlock?: CstNode[];
  /** Example block sub-rule (`====` delimited). */
  exampleBlock?: CstNode[];
  /** Sidebar block sub-rule (`****` delimited). */
  sidebarBlock?: CstNode[];
  /** Open block sub-rule (`--` delimited). */
  openBlock?: CstNode[];
  /** Quote block sub-rule (`____` delimited). */
  quoteBlock?: CstNode[];
  /** Literal paragraph sub-rule (indented lines). */
  literalParagraph?: CstNode[];
  /** Admonition paragraph sub-rule (`NOTE:`, `TIP:`, etc.). */
  admonitionParagraph?: CstNode[];
}

/** Children of the `paragraph` rule. */
export interface ParagraphCstChildren {
  /**
   * Zero-length token marking where the paragraph opened
   * (default -> paragraph mode). Present in the CST so
   * visitors can read its `startOffset`.
   */
  InlineModeStart?: IToken[];
  /** Lines of inline content within the paragraph. */
  inlineLine?: CstNode[];
  /** Newlines separating inline lines (pops inline mode). */
  InlineNewline?: IToken[];
  /** Comment/directive lines kept verbatim inside the paragraph. */
  ParagraphRawLine?: IToken[];
  /** Newlines that terminate a ParagraphRawLine. */
  ParagraphNewline?: IToken[];
}

/** Children of the `inlineToken` rule (one inline element). */
export interface InlineTokenCstChildren {
  /** Bold formatting mark (`*`). */
  BoldMark?: IToken[];
  /** Italic formatting mark (`_`). */
  ItalicMark?: IToken[];
  /** Monospace formatting mark (`` ` ``). */
  MonoMark?: IToken[];
  /** Highlight formatting mark (`#`). */
  HighlightMark?: IToken[];
  /** Role attribute shorthand (`[.rolename]`). */
  RoleAttribute?: IToken[];
  /** Attribute reference (`{name}`). */
  AttributeReference?: IToken[];
  /** Backslash escape sequence (`\*`, etc.). */
  BackslashEscape?: IToken[];
  /** Unified inline macro (`name:target[attrlist]`). */
  InlineMacro?: IToken[];
  /** Bare inline URL (auto-linked). */
  InlineUrl?: IToken[];
  /** Shorthand cross-reference (`<<target>>`). */
  XrefShorthand?: IToken[];
  /** Inline anchor (`[[id]]` or `[#id]`). */
  InlineAnchor?: IToken[];
  /** Hard line break (` +` at end of line). */
  HardLineBreak?: IToken[];
  /** Run of non-special inline characters. */
  InlineText?: IToken[];
  /** Single fallback character (no higher-priority match). */
  InlineChar?: IToken[];
}

/** Children of the `inlineLine` rule (one line of inline content). */
export interface InlineLineCstChildren {
  /**
   * Zero-length token that pushes the lexer into inline mode
   * for this one line. Present in the CST so visitors can read
   * its `startOffset` as the start position of the line's
   * inline content.
   */
  ParagraphLineStart?: IToken[];
  /** Sequence of inline tokens on this line. */
  inlineToken?: CstNode[];
}

/** Children of the `unorderedList` rule. */
export interface UnorderedListCstChildren {
  /** Individual unordered list items. */
  listItem?: CstNode[];
}

/** Children of the `listItem` rule (one unordered list item). */
export interface ListItemCstChildren {
  /** Unordered list marker (`*`, `**`, etc.). */
  UnorderedListMarker?: IToken[];
  /**
   * Zero-length token marking where the item's text opened
   * (default -> paragraph mode).
   */
  InlineModeStart?: IToken[];
  /** Lines of inline content in this item. */
  inlineLine?: CstNode[];
  /** Newlines between inline lines (pops inline mode). */
  InlineNewline?: IToken[];
  /** Comment/directive lines kept verbatim inside the item. */
  ParagraphRawLine?: IToken[];
  /** Newlines that terminate a ParagraphRawLine. */
  ParagraphNewline?: IToken[];
  /**
   * Structural newlines that delimit list-item boundaries
   * (as opposed to InlineNewline tokens within the item's
   * inline content).
   */
  Newline?: IToken[];
  /** Continuation lines starting with whitespace. */
  IndentedLine?: IToken[];
}

/** Children of the `orderedList` rule. */
export interface OrderedListCstChildren {
  /** Individual ordered list items. */
  orderedListItem?: CstNode[];
}

/** Children of the `orderedListItem` rule. */
export interface OrderedListItemCstChildren {
  /** Ordered list marker (`.`, `..`, etc.). */
  OrderedListMarker?: IToken[];
  /**
   * Zero-length token marking where the item's text opened
   * (default -> paragraph mode).
   */
  InlineModeStart?: IToken[];
  /** Lines of inline content in this item. */
  inlineLine?: CstNode[];
  /** Newlines between inline lines (pops inline mode). */
  InlineNewline?: IToken[];
  /** Comment/directive lines kept verbatim inside the item. */
  ParagraphRawLine?: IToken[];
  /** Newlines that terminate a ParagraphRawLine. */
  ParagraphNewline?: IToken[];
  /**
   * Structural newlines that delimit list-item boundaries
   * (as opposed to InlineNewline tokens within the item's
   * inline content).
   */
  Newline?: IToken[];
  /** Continuation lines starting with whitespace. */
  IndentedLine?: IToken[];
}

/** Children of the `calloutList` rule. */
export interface CalloutListCstChildren {
  /** Individual callout list items. */
  calloutListItem?: CstNode[];
}

/** Children of the `calloutListItem` rule. */
export interface CalloutListItemCstChildren {
  /** Callout list marker (`<1>`, `<2>`, etc.). */
  CalloutListMarker?: IToken[];
  /**
   * Zero-length token marking where the item's text opened
   * (default -> paragraph mode).
   */
  InlineModeStart?: IToken[];
  /** Lines of inline content in this item. */
  inlineLine?: CstNode[];
  /** Newlines between inline lines (pops inline mode). */
  InlineNewline?: IToken[];
  /** Comment/directive lines kept verbatim inside the item. */
  ParagraphRawLine?: IToken[];
  /** Newlines that terminate a ParagraphRawLine. */
  ParagraphNewline?: IToken[];
  /**
   * Structural newlines that delimit list-item boundaries
   * (as opposed to InlineNewline tokens within the item's
   * inline content).
   */
  Newline?: IToken[];
  /** Continuation lines starting with whitespace. */
  IndentedLine?: IToken[];
}

/** Children of the `blockComment` rule. */
export interface BlockCommentCstChildren {
  /**
   * Opening `////` delimiter (pushes into block_comment mode).
   * Chevrotain requires separate token types for push and pop
   * even when the surface syntax is identical, so this is
   * distinct from `BlockCommentEnd`.
   */
  BlockCommentDelimiter?: IToken[];
  /**
   * Closing `////` delimiter (pops back to default mode).
   * Syntactically identical to `BlockCommentDelimiter` but a
   * separate token type because Chevrotain's multi-mode lexer
   * associates push_mode with the opener and pop_mode with the
   * closer.
   */
  BlockCommentEnd?: IToken[];
  /** Text lines inside the comment. */
  BlockCommentContent?: IToken[];
  /** Newlines within the comment body. */
  Newline?: IToken[];
  /** Blank lines within the comment body. */
  BlankLine?: IToken[];
}

// CST children for delimited leaf blocks. Each has an open
// token, a close token, and optional verbatim content between
// them.

/** Children of the `listingBlock` rule (`----` delimited). */
export interface ListingBlockCstChildren {
  /** Opening `----` delimiter. */
  ListingBlockOpen?: IToken[];
  /** Closing `----` delimiter. */
  ListingBlockClose?: IToken[];
  /** Verbatim content lines (not inline-parsed). */
  VerbatimContent?: IToken[];
  /** Newlines within the block body. */
  Newline?: IToken[];
  /** Blank lines within the block body. */
  BlankLine?: IToken[];
}

/** Children of the `fencedCodeBlock` rule (` ``` ` delimited). */
export interface FencedCodeBlockCstChildren {
  /** Opening ` ``` ` delimiter. */
  FencedCodeOpen?: IToken[];
  /** Closing ` ``` ` delimiter. */
  FencedCodeClose?: IToken[];
  /** Verbatim content lines (not inline-parsed). */
  VerbatimContent?: IToken[];
  /** Newlines within the block body. */
  Newline?: IToken[];
  /** Blank lines within the block body. */
  BlankLine?: IToken[];
}

/** Children of the `literalBlock` rule (`....` delimited). */
export interface LiteralBlockCstChildren {
  /** Opening `....` delimiter. */
  LiteralBlockOpen?: IToken[];
  /** Closing `....` delimiter. */
  LiteralBlockClose?: IToken[];
  /** Verbatim content lines (not inline-parsed). */
  VerbatimContent?: IToken[];
  /** Newlines within the block body. */
  Newline?: IToken[];
  /** Blank lines within the block body. */
  BlankLine?: IToken[];
}

/** Children of the `passBlock` rule (`++++` delimited). */
export interface PassBlockCstChildren {
  /** Opening `++++` delimiter. */
  PassBlockOpen?: IToken[];
  /** Closing `++++` delimiter. */
  PassBlockClose?: IToken[];
  /** Verbatim content lines (not inline-parsed). */
  VerbatimContent?: IToken[];
  /** Newlines within the block body. */
  Newline?: IToken[];
  /** Blank lines within the block body. */
  BlankLine?: IToken[];
}

// CST children for delimited parent blocks. Each has delimiter
// tokens and recursive block subrules for their content.

/** Children of the `exampleBlock` rule (`====` delimited). */
export interface ExampleBlockCstChildren {
  /** Opening `====` delimiter. */
  ExampleBlockOpen?: IToken[];
  /** Closing `====` delimiter. */
  ExampleBlockClose?: IToken[];
  /** Nested block-level elements inside the example. */
  block?: CstNode[];
  /** Newlines within the block body. */
  Newline?: IToken[];
  /** Blank lines within the block body. */
  BlankLine?: IToken[];
}

/** Children of the `sidebarBlock` rule (`****` delimited). */
export interface SidebarBlockCstChildren {
  /** Opening `****` delimiter. */
  SidebarBlockOpen?: IToken[];
  /** Closing `****` delimiter. */
  SidebarBlockClose?: IToken[];
  /** Nested block-level elements inside the sidebar. */
  block?: CstNode[];
  /** Newlines within the block body. */
  Newline?: IToken[];
  /** Blank lines within the block body. */
  BlankLine?: IToken[];
}

/** Children of the `openBlock` rule (`--` delimited). */
export interface OpenBlockCstChildren {
  /** Opening and closing `--` delimiter (same token type). */
  OpenBlockDelimiter?: IToken[];
  /** Nested block-level elements inside the open block. */
  block?: CstNode[];
  /** Newlines within the block body. */
  Newline?: IToken[];
  /** Blank lines within the block body. */
  BlankLine?: IToken[];
}

/** Children of the `quoteBlock` rule (`____` delimited). */
export interface QuoteBlockCstChildren {
  /** Opening `____` delimiter. */
  QuoteBlockOpen?: IToken[];
  /** Closing `____` delimiter. */
  QuoteBlockClose?: IToken[];
  /** Nested block-level elements inside the quote. */
  block?: CstNode[];
  /** Newlines within the block body. */
  Newline?: IToken[];
  /** Blank lines within the block body. */
  BlankLine?: IToken[];
}

/** Children of the `literalParagraph` rule. */
export interface LiteralParagraphCstChildren {
  /** Lines starting with whitespace (verbatim content). */
  IndentedLine?: IToken[];
  /** Newlines separating indented lines. */
  Newline?: IToken[];
}

/** Children of the `admonitionParagraph` rule. */
export interface AdmonitionParagraphCstChildren {
  /** Admonition label prefix (`NOTE: `, `TIP: `, etc.). */
  AdmonitionMarker?: IToken[];
  /**
   * Zero-length token marking where the body's paragraph
   * opened (default -> paragraph mode).
   */
  InlineModeStart?: IToken[];
  /** Lines of inline content after the label. */
  inlineLine?: CstNode[];
  /** Newlines between inline lines (pops inline mode). */
  InlineNewline?: IToken[];
  /**
   * Comment/directive lines inside the admonition body. Merged
   * into `content` in source order and re-emitted verbatim by
   * the printer: Asciidoctor drops a comment but CONSUMES a
   * conditional directive, so deleting them would both lose the
   * author's bytes and render `ifdef`-guarded text
   * unconditionally.
   */
  ParagraphRawLine?: IToken[];
  /** Newlines that terminate a ParagraphRawLine. */
  ParagraphNewline?: IToken[];
}

/** Children of the `attributeEntry` rule. */
export interface AttributeEntryCstChildren {
  /**
   * Token spanning the full `:name: value` line. The AST
   * builder extracts name and optional value from its image.
   */
  AttributeEntry?: IToken[];
  /** Optional trailing newline after the entry. */
  Newline?: IToken[];
}
