/**
 * Block-layer token vocabulary. None of these is ever LEXED: the
 * BlockReader builds instances with `createTokenInstance`, so every
 * pattern is `Lexer.NA` — the documented way to declare a token type
 * the lexer never matches. The parser still needs them in its
 * vocabulary (`CstParser`'s first constructor argument), which is what
 * {@link blockTokenVocabulary} is for.
 *
 * Line tokens carry the RAW source line as image (trailing whitespace
 * and all) so positions and verbatim slicing stay exact;
 * classification used the rstripped text. Boundary tokens are
 * zero-length and sit at the offset where the boundary falls.
 *
 * `createToken` assigns `tokenTypeIdx` at creation (`augmentTokenTypes`
 * runs there), so instances built later already carry the right index —
 * the reader never has to see a parser to produce parseable tokens.
 *
 * The parser's vocabulary is this list plus the INLINE one from
 * src/parse/tokens.ts. Chevrotain keys its `tokensMap` by name, so the
 * two must not share a name.
 */
import { createToken, Lexer, type TokenType } from "chevrotain";

/**
 * Declare a token type the lexer can never match.
 * @param name - the token's name, as it appears in parser errors
 * @returns the token type
 */
function na(name: string): TokenType {
  return createToken({ name, pattern: Lexer.NA });
}

// ── Leaf line tokens (one per source line) ───────────────────────────

/** `= Doc` — an ATX title of level 0. */
export const DocumentTitleLine = na("DocumentTitleLine");
/** `== Section` — a title that OPENS a section frame. */
export const SectionTitleLine = na("SectionTitleLine");
/** A title under a pending `[discrete]`: a leaf, not a section. */
export const DiscreteHeadingLine = na("DiscreteHeadingLine");
/** `[source,ruby]` — a block attribute list. */
export const BlockAttributeLine = na("BlockAttributeLine");
/** `[[id]]` — a block anchor acting as metadata. */
export const AnchorLine = na("AnchorLine");
/** `.Title` — a block title. */
export const BlockTitleLine = na("BlockTitleLine");
/** `:name: value` — an attribute entry. */
export const AttributeEntryLine = na("AttributeEntryLine");
/** A line kept verbatim: a comment, a directive, a dropped anchor. */
export const RawLine = na("RawLine");
/** `image::a.png[]` — a block macro. */
export const BlockMacroLine = na("BlockMacroLine");
/** `'''` — a thematic break. */
export const ThematicBreakLine = na("ThematicBreakLine");
/** `<<<` — a page break. */
export const PageBreakLine = na("PageBreakLine");
/** `NOTE: ` — the label prefix of a paragraph-form admonition. */
export const AdmonitionLabel = na("AdmonitionLabel");
/** `* ` — the marker of an unordered list item. */
export const UnorderedListMarker = na("UnorderedListMarker");
/** `. ` — the marker of an ordered list item. */
export const OrderedListMarker = na("OrderedListMarker");
/** `<1> ` — the marker of a callout list item. */
export const CalloutListMarker = na("CalloutListMarker");
/** One line of an indented literal paragraph. */
export const LiteralLine = na("LiteralLine");
/**
 * Closes an indented literal paragraph. Two literal paragraphs
 * separated by a blank line would otherwise be one run of LiteralLine
 * tokens — the blank itself emits nothing.
 */
export const LiteralParagraphEnd = na("LiteralParagraphEnd");
/** The opening delimiter of a block whose content is parsed as blocks. */
export const CompoundBlockOpen = na("CompoundBlockOpen");
/** The matching closing delimiter of a compound block. */
export const CompoundBlockClose = na("CompoundBlockClose");
/** The opening delimiter of a block whose content is verbatim. */
export const VerbatimBlockOpen = na("VerbatimBlockOpen");
/** The matching closing delimiter of a verbatim block. */
export const VerbatimBlockClose = na("VerbatimBlockClose");
/** One content line inside a verbatim block, whatever its shape. */
export const VerbatimLine = na("VerbatimLine");

// ── Boundary tokens (zero-length) ────────────────────────────────────

/** Opens a paragraph's inline body. */
export const ParagraphStart = na("ParagraphStart");
/** Closes a paragraph's inline body. */
export const ParagraphEnd = na("ParagraphEnd");
/** Closes one list item. */
export const ItemEnd = na("ItemEnd");
/** Closes a list. */
export const ListEnd = na("ListEnd");
/** A `+` that attaches nothing — kept so the printer can print it back. */
export const DanglingContinuation = na("DanglingContinuation");
/**
 * Inside a list item, ahead of its end: the item's text must keep its
 * last source-line break. Emitted when a TRAILING metadata run (no block
 * of the item follows it) ended item text of more than one line and
 * carries a block title — reflowed onto the first line after the marker
 * line its first line would fold and the title become text, and a `+`
 * there would re-parent whatever block follows the list (Ruling 28).
 */
export const KeepTextBreak = na("KeepTextBreak");
/**
 * Precedes a block inside a list item whose `+` was DETACHED — written
 * after a blank line. Asciidoctor reads a detached continuation
 * differently from an adjacent one inside nested lists
 * (`read_lines_for_list_item` deletes only the LAST detached `+` from
 * the outer item's buffer, so which item an earlier one's block lands
 * in depends on what follows), and the printer reproduces the spelling
 * — a blank line, then `+` — so a round trip never moves a block.
 *
 * The three "how did this block get here" marks: a block with none of
 * them was introduced by a `+` directly above it (or above the metadata
 * group it ends); DetachedContinuation, a blank line then a `+`;
 * NoContinuation, no `+` at all, directly under the line before it;
 * BlankSeparated, no `+`, after a blank line. The printer writes each
 * spelling back — never a `+` the author did not write (Ruling 24).
 */
export const DetachedContinuation = na("DetachedContinuation");
/** Precedes a block the item keeps with NO `+`, directly under the line before. */
export const NoContinuation = na("NoContinuation");
/** Precedes a block the item keeps with NO `+`, after a blank line. */
export const BlankSeparated = na("BlankSeparated");
/** Closes a section frame. */
export const SectionEnd = na("SectionEnd");
/**
 * Closes a delimited block that never met its terminator: an outer
 * terminator or EOF forced it shut. Distinct from
 * `CompoundBlockClose`/`VerbatimBlockClose` so the grammar can be
 * mechanical — no error recovery, no parser-state gate to tell an outer
 * close from a missing inner one.
 */
export const UnclosedEnd = na("UnclosedEnd");

/**
 * Every block-layer token type, in the order above.
 *
 * The parser vocabulary must contain each type the reader can emit;
 * grammar.ts builds it by concatenating this list with the inline
 * token set (`inlineModeTokens`).
 */
export const blockTokenVocabulary: TokenType[] = [
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
  LiteralParagraphEnd,
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
  SectionEnd,
  UnclosedEnd,
];
