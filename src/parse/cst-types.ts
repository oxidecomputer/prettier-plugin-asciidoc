/**
 * CST node child interfaces for the AsciiDoc parser.
 *
 * Chevrotain's CST nodes have optional arrays for each token/subrule
 * consumed. Typed here for safe access in visitors (the raw CST uses
 * `unknown` children). One interface per grammar rule in
 * src/parse/grammar.ts; a property is present exactly when the rule
 * consumed that token type or subrule at least once.
 *
 * Extracted from ast-builder.ts to keep that file within the
 * max-lines lint limit.
 */
import type { CstNode, IToken } from "chevrotain";

/** Children of the top-level `document` rule. */
export interface DocumentCstChildren {
  /** The document's blocks, in source order. */
  block?: CstNode[];
}

// At most one field is populated per CstNode — the grammar's OR rule
// ensures each block matches exactly one alternative.

/** Children of the `block` rule (one block-level element). */
export interface BlockCstChildren {
  /** Section sub-rule (`== Title` … `SectionEnd`). */
  section?: CstNode[];
  /** Document title line (`= Title`). */
  DocumentTitleLine?: IToken[];
  /** A heading under `[discrete]` — a leaf, not a section. */
  DiscreteHeadingLine?: IToken[];
  /** Block attribute list line (`[source,java]`, `[#id]`, etc.). */
  BlockAttributeLine?: IToken[];
  /** Block anchor line (`[[id]]` on its own line). */
  AnchorLine?: IToken[];
  /** Block title line (`.Title` on the line before a block). */
  BlockTitleLine?: IToken[];
  /** Attribute entry line (`:name: value`). */
  AttributeEntryLine?: IToken[];
  /** A comment or preprocessor line kept verbatim between blocks. */
  RawLine?: IToken[];
  /** Block macro line (`image::target[attrlist]`). */
  BlockMacroLine?: IToken[];
  /** Thematic break line (`'''`). */
  ThematicBreakLine?: IToken[];
  /** Page break line (`<<<`). */
  PageBreakLine?: IToken[];
  /** Paragraph sub-rule (inline text content). */
  paragraph?: CstNode[];
  /** Admonition paragraph sub-rule (`NOTE:`, `TIP:`, etc.). */
  admonitionParagraph?: CstNode[];
  /** List sub-rule (unordered, ordered or callout items). */
  list?: CstNode[];
  /** Verbatim delimited block sub-rule (listing, literal, pass, …). */
  verbatimBlock?: CstNode[];
  /** Compound delimited block sub-rule (example, sidebar, open, quote). */
  compoundBlock?: CstNode[];
  /** Literal paragraph sub-rule (indented lines). */
  literalParagraph?: CstNode[];
}

/** Children of the `section` rule. */
export interface SectionCstChildren {
  /** The section's title line (`== Title`). */
  SectionTitleLine?: IToken[];
  /** The section's blocks, nested sections included. */
  block?: CstNode[];
  /** Zero-length token where the reader closed the section. */
  SectionEnd?: IToken[];
}

/** Children of the `paragraphBody` rule — every paragraph's inline body. */
export interface ParagraphBodyCstChildren {
  /** Inline tokens, one CST node per token. */
  inlineToken?: CstNode[];
  /** Newlines between the paragraph's text lines. */
  InlineNewline?: IToken[];
  /** Comment/directive lines kept verbatim inside the paragraph. */
  RawLine?: IToken[];
}

/** Children of the `paragraph` rule. */
export interface ParagraphCstChildren {
  /** Zero-length token where the paragraph opened. */
  ParagraphStart?: IToken[];
  /** The paragraph's inline body. */
  paragraphBody?: CstNode[];
  /** Zero-length token where the paragraph closed. */
  ParagraphEnd?: IToken[];
}

/** Children of the `admonitionParagraph` rule. */
export interface AdmonitionParagraphCstChildren {
  /** The label prefix (`NOTE: `). */
  AdmonitionLabel?: IToken[];
  /** Zero-length token where the body paragraph opened. */
  ParagraphStart?: IToken[];
  /** The admonition's inline body. */
  paragraphBody?: CstNode[];
  /** Zero-length token where the body paragraph closed. */
  ParagraphEnd?: IToken[];
}

/** Children of the `list` rule. */
export interface ListCstChildren {
  /** The list's items, in source order. */
  listItem?: CstNode[];
  /** Zero-length token where the reader closed the list. */
  ListEnd?: IToken[];
}

/** Children of the `listItem` rule. */
export interface ListItemCstChildren {
  /** Unordered list marker (`* `, `** `, `- `), gap included. */
  UnorderedListMarker?: IToken[];
  /** Ordered list marker (`. `, `.. `), gap included. */
  OrderedListMarker?: IToken[];
  /** Callout list marker (`<1> `, `<.> `), gap included. */
  CalloutListMarker?: IToken[];
  /** Zero-length token where the item's principal paragraph opened. */
  ParagraphStart?: IToken[];
  /** The item's principal text. */
  paragraphBody?: CstNode[];
  /** Zero-length token where the principal paragraph closed. */
  ParagraphEnd?: IToken[];
  /**
   * Every block inside the item, in source order: nested lists,
   * `+`-attached blocks and in-item blocks alike, each wrapped with
   * the reader's detached-continuation note.
   */
  itemBlock?: CstNode[];
  /** Present when the item's text must keep its last source-line break. */
  KeepTextBreak?: IToken[];
  /** A trailing `+` that attached nothing. */
  DanglingContinuation?: IToken[];
  /** Zero-length token where the item ended. */
  ItemEnd?: IToken[];
}

/** Children of the `itemBlock` rule — one block inside a list item. */
export interface ItemBlockCstChildren {
  /** Present when the block's `+` was written after a blank line. */
  DetachedContinuation?: IToken[];
  /** Present when no `+` introduced the block and it follows directly. */
  NoContinuation?: IToken[];
  /** Present when no `+` introduced the block and a blank line precedes it. */
  BlankSeparated?: IToken[];
  /** The block itself. */
  block?: CstNode[];
}

/** Children of the `verbatimBlock` rule. */
export interface VerbatimBlockCstChildren {
  /** The opening delimiter line. */
  VerbatimBlockOpen?: IToken[];
  /** The content lines, one token each (blank lines included). */
  VerbatimLine?: IToken[];
  /** The matching closing delimiter line. */
  VerbatimBlockClose?: IToken[];
  /** Zero-length token where an outer terminator or EOF forced the close. */
  UnclosedEnd?: IToken[];
}

/** Children of the `compoundBlock` rule. */
export interface CompoundBlockCstChildren {
  /** The opening delimiter line. */
  CompoundBlockOpen?: IToken[];
  /** The block's children, in source order. */
  block?: CstNode[];
  /** The matching closing delimiter line. */
  CompoundBlockClose?: IToken[];
  /** Zero-length token where an outer terminator or EOF forced the close. */
  UnclosedEnd?: IToken[];
}

/** Children of the `literalParagraph` rule. */
export interface LiteralParagraphCstChildren {
  /** The indented lines, leading whitespace included. */
  LiteralLine?: IToken[];
  /** Zero-length token where the reader closed the paragraph. */
  LiteralParagraphEnd?: IToken[];
}

/** Children of the `inlineToken` rule — one token per node. */
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
