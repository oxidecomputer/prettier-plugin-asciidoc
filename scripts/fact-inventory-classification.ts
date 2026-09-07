/**
 * The EXEMPT half of the classification `scripts/fact-inventory.ts`
 * gates against: every `src/ast.ts` property that is NOT a recorded
 * fact - a discriminant, position bookkeeping, structural
 * containment, verbatim content, an unread record, a type-level
 * sentinel, or a container whose own arm's fields are classified
 * separately - each with a reason. The criterion, the verification
 * method, and the surprises it turned up are stated in
 * `scripts/fact-inventory.ts`'s own module doc.
 *
 * THE OTHER HALF IS THE LEDGER. A field that IS a recorded fact is
 * recorded once, as a row in `scripts/fact-inventory-ledger.json`,
 * whose key set is the FACTS map the census gates with and whose
 * `reason` is that map's value. The two lists were separate files
 * with the same 74 keys, so a landing fact was written twice and the
 * copies could disagree; there is now one place to write it.
 *
 * Reasons are kept SHORT here on purpose (most owe their length to a
 * long key, not a long reason).
 */

/** Selects which printer function runs; carries no spelling of its own. */
const TYPE_DISCRIMINANT =
  "type discriminant, not a print-shape choice of its own";
/**
 * Nothing under `src/print/` reads this coordinate.
 *
 * A CLAIM ABOUT READS rather than a judgement, and so held to the
 * compiler by `scripts/fact-inventory-reads.ts`. It read "not read by
 * the printer" while three rows carrying it were read in eight
 * printer files (issue #204); those rows are FACTS now, and the
 * wording names the directory the claim is about, because a claim
 * whose domain is unstated is one nobody can check.
 */
const POSITION = "position bookkeeping, not read under src/print";
/** Walked by Prettier's path.map or the printer's own recursive print. */
const STRUCTURAL = "structural containment, not a shape choice of its own";
/** Copied into the output unconditionally; no branch on its own value. */
const CONTENT = "verbatim leaf content, copied unconditionally";
/**
 * Constructed at parse time, and read by nothing under `src/print/`.
 *
 * The other claim about reads, and held the same way. It used to say
 * "verified by grep", which was true when it was written and is the
 * kind of thing that stops being true without anything saying so.
 */
const UNREAD = "recorded but unread under src/print";
/** `?: undefined`; never holds a runtime value. */
const SENTINEL = "type-level sentinel, never holds a value";
/** A record/union pointer whose own arms are classified separately. */
const CONTAINER = "container; its arm's fields are classified separately";

/**
 * The two EXEMPT reasons that assert the printer does not read the
 * field, as opposed to the five that judge WHY a read is not a
 * shape choice.
 *
 * The set exists so the assertion can be checked: an assertion about
 * reads is the only kind of reason a compiler can settle, and
 * `scripts/fact-inventory-reads.ts` settles exactly these. Keyed by
 * the reason STRING rather than by a second list of field names,
 * because the reason is the whole of what a row asserts and a
 * parallel list would be one more thing to keep in step.
 */
export const UNREAD_CLAIMS: ReadonlySet<string> = new Set([POSITION, UNREAD]);

/**
 * Fields that are NOT recorded facts, each with a reason (shared
 * constants above for the common buckets, a short bespoke string for
 * the rest).
 */
export const EXEMPT: ReadonlyMap<string, string> = new Map([
  ["Node.type", TYPE_DISCRIMINANT],
  ["DocumentNode.type", TYPE_DISCRIMINANT],
  ["DocumentNode.children", STRUCTURAL],
  ["ParagraphNode.type", TYPE_DISCRIMINANT],
  ["ParagraphNode.children", STRUCTURAL],
  ["ParagraphNode.reading", UNREAD],
  ["TextNode.type", TYPE_DISCRIMINANT],
  ["TextNode.value", CONTENT],
  ["BoldNode.type", TYPE_DISCRIMINANT],
  ["BoldNode.role", CONTENT],
  ["BoldNode.children", STRUCTURAL],
  ["ItalicNode.type", TYPE_DISCRIMINANT],
  ["ItalicNode.role", CONTENT],
  ["ItalicNode.children", STRUCTURAL],
  ["MonospaceNode.type", TYPE_DISCRIMINANT],
  ["MonospaceNode.role", CONTENT],
  ["MonospaceNode.children", STRUCTURAL],
  ["HighlightNode.type", TYPE_DISCRIMINANT],
  ["HighlightNode.role", CONTENT],
  ["HighlightNode.children", STRUCTURAL],
  ["CurvedQuoteNode.type", TYPE_DISCRIMINANT],
  ["CurvedQuoteNode.children", STRUCTURAL],
  ["SuperscriptNode.type", TYPE_DISCRIMINANT],
  ["SuperscriptNode.children", STRUCTURAL],
  ["SubscriptNode.type", TYPE_DISCRIMINANT],
  ["SubscriptNode.children", STRUCTURAL],
  ["CharacterReferenceNode.type", TYPE_DISCRIMINANT],
  ["CharacterReferenceNode.value", CONTENT],
  ["EscapedMarkNode.type", TYPE_DISCRIMINANT],
  ["EscapedMarkNode.value", CONTENT],
  ["AttributeReferenceNode.type", TYPE_DISCRIMINANT],
  ["AttributeReferenceNode.name", CONTENT],
  ["LinkNode.type", TYPE_DISCRIMINANT],
  ["LinkNode.form", UNREAD],
  ["LinkNode.target", CONTENT],
  ["XrefNode.type", TYPE_DISCRIMINANT],
  ["XrefNode.form", 'fixed "shorthand"'],
  ["XrefNode.target", CONTENT],
  ["XrefNode.text", "ordinary optional content"],
  ["InlineAnchorNode.type", TYPE_DISCRIMINANT],
  ["InlineAnchorNode.id", CONTENT],
  ["InlineMacroNode.type", TYPE_DISCRIMINANT],
  ["InlineMacroNode.name", CONTENT],
  ["InlineMacroNode.target", CONTENT],
  ["InlineMacroNode.attrlist", CONTENT],
  ["HardLineBreakNode.type", TYPE_DISCRIMINANT],
  ["RawLineNode.type", TYPE_DISCRIMINANT],
  ["RawLineNode.value", CONTENT],
  ["PassthroughNode.type", TYPE_DISCRIMINANT],
  ["PassthroughNode.value", CONTENT],
  ["HeadingNode.type", TYPE_DISCRIMINANT],
  ["HeadingNode.title", CONTENT],
  ["AuthorLineNode.type", TYPE_DISCRIMINANT],
  ["AuthorLineNode.value", CONTENT],
  ["RevisionLineNode.type", TYPE_DISCRIMINANT],
  ["RevisionLineNode.value", CONTENT],
  ["DocumentHeaderNode.type", TYPE_DISCRIMINANT],
  ["DocumentHeaderNode.title", CONTENT],
  ["DocumentHeaderNode.lines", STRUCTURAL],
  ["DiscreteHeadingNode.type", TYPE_DISCRIMINANT],
  ["DiscreteHeadingNode.title", CONTENT],
  ["CommentNode.type", TYPE_DISCRIMINANT],
  ["CommentNode.value", CONTENT],
  ["AttributeEntryNode.type", TYPE_DISCRIMINANT],
  ["AttributeEntryNode.name", CONTENT],
  ["AttributeEntryNode.value", CONTENT],
  ["ListNode.type", TYPE_DISCRIMINANT],
  ["ListNode.children", STRUCTURAL],
  ["LeafDelimitedBlockNode.type", TYPE_DISCRIMINANT],
  ["LeafDelimitedBlockNode.content", CONTENT],
  ["FencedCodeBlockNode.type", TYPE_DISCRIMINANT],
  ["FencedCodeBlockNode.content", CONTENT],
  ["MasqueradedBlockNode.type", TYPE_DISCRIMINANT],
  ["MasqueradedBlockNode.content", CONTENT],
  ["IndentedLiteralBlockNode.type", TYPE_DISCRIMINANT],
  ["IndentedLiteralBlockNode.content", CONTENT],
  ["ParagraphFormBlockNode.type", TYPE_DISCRIMINANT],
  ["ParagraphFormBlockNode.content", CONTENT],
  ["LeafDelimitedBlockNode.sourceDelimiter", SENTINEL],
  ["LeafDelimitedBlockNode.fenced", SENTINEL],
  ["LeafDelimitedBlockNode.language", SENTINEL],
  ["FencedCodeBlockNode.sourceDelimiter", SENTINEL],
  ["FencedCodeBlockNode.fenced", "fixed literal true"],
  ["MasqueradedBlockNode.fenced", SENTINEL],
  ["MasqueradedBlockNode.language", SENTINEL],
  ["IndentedLiteralBlockNode.sourceDelimiter", SENTINEL],
  ["IndentedLiteralBlockNode.fenced", SENTINEL],
  ["IndentedLiteralBlockNode.language", SENTINEL],
  ["ParagraphFormBlockNode.sourceDelimiter", SENTINEL],
  ["ParagraphFormBlockNode.fenced", SENTINEL],
  ["ParagraphFormBlockNode.language", SENTINEL],
  ["OpenParentBlockNode.type", TYPE_DISCRIMINANT],
  ["OpenParentBlockNode.variant", 'fixed "open"'],
  ["OpenParentBlockNode.children", STRUCTURAL],
  ["CompoundParentBlockNode.type", TYPE_DISCRIMINANT],
  ["CompoundParentBlockNode.openDelimiter", SENTINEL],
  ["CompoundParentBlockNode.children", STRUCTURAL],
  ["AdmonitionNode.type", TYPE_DISCRIMINANT],
  ["AdmonitionNode.variant", "label text, case only"],
  ["AdmonitionNode.text", STRUCTURAL],
  ["AdmonitionNode.children", STRUCTURAL],
  ["AdmonitionNode.reading", UNREAD],
  ["ThematicBreakNode.type", TYPE_DISCRIMINANT],
  ["BlockMacroNode.type", TYPE_DISCRIMINANT],
  ["BlockMacroNode.name", CONTENT],
  ["BlockMacroNode.target", CONTENT],
  ["BlockMacroNode.attrlist", CONTENT],
  ["FrontMatterNode.type", TYPE_DISCRIMINANT],
  ["FrontMatterNode.content", CONTENT],
  ["PreprocessorDirectiveNode.type", TYPE_DISCRIMINANT],
  ["PreprocessorDirectiveNode.value", CONTENT],
  ["PageBreakNode.type", TYPE_DISCRIMINANT],
  ["ItemBody.text", STRUCTURAL],
  ["ItemBody.blocks", STRUCTURAL],
  ["ItemBody.reading", UNREAD],
  ["ListItemNode.type", TYPE_DISCRIMINANT],
  ["ItemBlock.block", STRUCTURAL],
  ["DescriptionListNode.type", TYPE_DISCRIMINANT],
  ["DescriptionListNode.delimiter", "grouping key, not bytes"],
  ["DescriptionListNode.children", STRUCTURAL],
  ["DescriptionTermNode.type", TYPE_DISCRIMINANT],
  ["DescriptionTermNode.children", STRUCTURAL],
  ["DescriptionListItemNode.type", TYPE_DISCRIMINANT],
  ["DescriptionListItemNode.terms", STRUCTURAL],
  ["DescriptionListItemNode.textLines", "replay bytes; printing is the fact"],
  ["TermEntry.term", STRUCTURAL],
  ["TermGapComment.comment", CONTENT],
  ["BlockAttributeListNode.type", TYPE_DISCRIMINANT],
  ["BlockAttributeListNode.value", CONTENT],
  ["BlockTitleNode.type", TYPE_DISCRIMINANT],
  ["BlockTitleNode.title", CONTENT],
  ["BlockAnchorNode.type", TYPE_DISCRIMINANT],
  ["BlockAnchorNode.id", CONTENT],
  ["BlockAnchorNode.reftext", "ordinary optional content"],
  ["TableNode.type", TYPE_DISCRIMINANT],
  ["TableNode.children", STRUCTURAL],
  ["TableNode.close", CONTAINER],
  ["TableNode.cutting", CONTAINER],
  ["TableNode.header", "own doc: derived predicate"],
  ["TableNode.footer", UNREAD],
  ["TableClose#0.image", UNREAD],
  ["TableColumnSpec.halign", UNREAD],
  ["TableColumnSpec.valign", UNREAD],
  ["TableRowNode.type", TYPE_DISCRIMINANT],
  ["TableRowNode.children", STRUCTURAL],
  ["TableCellNode.type", TYPE_DISCRIMINANT],
  ["TableCellNode.opening", CONTAINER],
  ["TableCellNode.runs", CONTAINER],
  ["TableCellNode.repeat", CONTAINER],
  ["TableCellOpening#0.parsed", CONTAINER],
  ["TableCellOpening#0.spec", "concatenated unconditionally into cellImage"],
  [
    "TableCellOpening#0.separator",
    "concatenated unconditionally into cellImage",
  ],
  ["TableCellOpening#0.offset", POSITION],
  ["TableCellOpening#1.offset", POSITION],
  ["TableTextRun.offset", POSITION],
  ["TableCellSpec.repeat", UNREAD],
  ["TableCellSpec.halign", UNREAD],
  ["TableCellSpec.valign", UNREAD],
]);
