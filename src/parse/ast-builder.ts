/* eslint-disable @typescript-eslint/class-methods-use-this -- Chevrotain visitor dispatch */

/**
 * CST-to-AST visitor for AsciiDoc.
 *
 * Chevrotain's parser produces a Concrete Syntax Tree (CST) — a generic tree
 * of rule invocations and tokens. This visitor walks the CST and builds our
 * typed AST designed for Prettier.
 *
 * Key design decisions:
 * - Sections are parsed flat in the grammar, then nested here using a
 *   stack-based algorithm: deeper sections become children of shallower
 *   ones. This keeps the grammar simple and the nesting logic in one place.
 * - Position offsets are exclusive-end (one past last character) to match
 *   Prettier conventions, so we add +1 to Chevrotain's inclusive endOffset.
 * - The visitor receives `sourceText` as a parameter (Chevrotain's second arg
 *   to visit()) so computeEnd() can calculate the document's end position.
 */
import type {
  DocumentNode,
  ParagraphNode,
  CommentNode,
  AttributeEntryNode,
  DelimitedBlockNode,
  ParentBlockNode,
  AdmonitionNode,
  BlockNode,
  ListNode,
} from "../ast.js";
import type { CstNode, IToken } from "chevrotain";
import { asciidocParser } from "./grammar.js";
import {
  nestListItems,
  buildListItemInlineChildren,
  trimCheckboxPrefix,
  type FlatListItem,
} from "./list-builder.js";
import {
  parseCheckbox,
  buildDelimitedBlock,
  buildParentBlock,
  findSubrule,
  buildRecoveredListItem,
  buildBlockComment,
  buildAdmonitionParagraph,
  buildRecoveredAttributeEntry,
  parseUnsetForm,
} from "./block-helpers.js";
import { nestSections } from "./section-builder.js";
import { convertParagraphFormBlocks } from "./paragraph-form.js";
import { convertDiscreteHeadings } from "./discrete-heading.js";

import { buildInlineNodesFromLines } from "./inline-node-builder.js";
import {
  flattenInlineTokens,
  inlineLinesToTextTokens,
  unwrapInlineLines,
} from "./inline-tokens.js";
import {
  AUTO_CALLOUT_NUMBER,
  EMPTY,
  FIRST,
  FIRST_COLUMN,
  FIRST_LINE,
  LAST_ELEMENT,
  NEXT,
} from "../constants.js";
import { unreachable } from "../unreachable.js";
import { buildTokenBlock } from "./token-builders.js";
import {
  makeLocation,
  tokenStartLocation,
  tokenEndLocation,
  computeEnd,
} from "./positions.js";
import type {
  DocumentCstChildren,
  BlockCstChildren,
  ParagraphCstChildren,
  UnorderedListCstChildren,
  ListItemCstChildren,
  OrderedListCstChildren,
  OrderedListItemCstChildren,
  CalloutListCstChildren,
  CalloutListItemCstChildren,
  BlockCommentCstChildren,
  ListingBlockCstChildren,
  LiteralBlockCstChildren,
  PassBlockCstChildren,
  ExampleBlockCstChildren,
  SidebarBlockCstChildren,
  OpenBlockCstChildren,
  QuoteBlockCstChildren,
  FencedCodeBlockCstChildren,
  LiteralParagraphCstChildren,
  AdmonitionParagraphCstChildren,
  AttributeEntryCstChildren,
} from "./cst-types.js";

// The UnorderedListMarker token image includes a trailing space
// (e.g. "* ", "** "). Subtracting this gives the nesting depth.
const TRAILING_SPACE_LEN = 1;

// Callout lists are always flat — they don't support nesting like
// unordered or ordered lists. Every callout item is at depth 1.
const CALLOUT_DEPTH = 1;

// Regex extracting the number between angle brackets in a
// callout marker token: `<1> ` → "1", `<.> ` → ".".
const CALLOUT_NUMBER_RE = /<(?<inner>[^>]+)>/v;

// Attribute entry: `:name: value`, `:name:`, `:!name:`, or
// `:name!:`. Groups: optional prefix `!`, the attribute name,
// optional suffix `!`, and optionally a space + value text.
const ATTRIBUTE_ENTRY_RE =
  /^:(?<prefixBang>!?)(?<name>[A-Za-z_][\w\-]*)(?<suffixBang>!?):\s?(?<value>.+)?$/v;

// getBaseCstVisitorConstructorWithDefaults generates a base class with no-op
// methods for every grammar rule, so we only override the rules we need.
const BaseCstVisitor = asciidocParser.getBaseCstVisitorConstructorWithDefaults<
  string,
  unknown
>();

/** Options for {@link AstBuilder.visitParentBlock}. */
interface VisitParentBlockOptions {
  /** CST sub-rule nodes to visit as child blocks. */
  blocks: CstNode[] | undefined;
  /** Opening delimiter tokens (e.g. `====`). */
  openTokens: IToken[] | undefined;
  /**
   * Closing delimiter tokens. May be `undefined` for
   * unclosed blocks (graceful degradation).
   */
  closeTokens: IToken[] | undefined;
  /** Block variant for the AST (example, sidebar, etc.). */
  variant: ParentBlockNode["variant"];
  /**
   * Full document source text, forwarded to child visitors
   * for position computation.
   */
  sourceText: string;
}

/**
 * Stateless: a single instance is reused across parse calls.
 * validateVisitor() catches mismatches between grammar rules
 * and visitor methods at construction time rather than at
 * first parse, so typos surface immediately.
 */
export class AstBuilder extends BaseCstVisitor {
  constructor() {
    super();
    this.validateVisitor();
  }

  /**
   * The grammar parses sections flat (a section heading is
   * just another block). We nest them here using a stack-based
   * algorithm rather than in the grammar because Chevrotain's
   * recursive rules would make section nesting much more
   * complex — and we'd need lookahead to know when a section
   * ends. The linear scan with a stack is simpler and matches
   * how AsciiDoc sections actually nest.
   * @param context - CST children produced by the `document`
   *   grammar rule, containing flat block sub-nodes.
   * @param sourceText - Full source for computing the
   *   document's end position (needed because the last token
   *   may not reach EOF).
   * @returns Root document node with sections nested by depth
   *   and paragraph-form / discrete-heading transforms applied.
   */
  document(context: DocumentCstChildren, sourceText: string): DocumentNode {
    const flatBlocks: BlockNode[] = [];

    if (context.block !== undefined) {
      for (const blockCst of context.block) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Chevrotain visitor returns unknown
        flatBlocks.push(this.visit(blockCst, sourceText) as BlockNode);
      }
    }

    // Convert paragraph-form blocks (e.g. [source] + paragraph →
    // DelimitedBlockNode with form: "paragraph") before section
    // nesting so they work correctly inside sections.
    const withParagraphForms = convertParagraphFormBlocks(
      flatBlocks,
      sourceText,
    );

    // Convert [discrete] + section pairs to DiscreteHeadingNode
    // before nesting, so they aren't used as nesting targets.
    const withDiscreteHeadings = convertDiscreteHeadings(withParagraphForms);
    const children = nestSections(withDiscreteHeadings);

    return {
      type: "document",
      children,
      position: {
        start: makeLocation(FIRST, FIRST_LINE, FIRST_COLUMN),
        end: computeEnd(sourceText),
      },
    };
  }

  /**
   * Sections and line comments are single-token rules that
   * can be built directly from the token. Other block types
   * are subrules delegated to their visitor methods.
   * @param context - CST children for a single block rule
   *   invocation — may contain a token (section heading,
   *   line comment, break) or a subrule (paragraph, list,
   *   delimited block, etc.).
   * @param sourceText - Full source, passed through to
   *   subrule visitors and used for recovery fallback
   *   position.
   * @returns The appropriate AST block node, or a placeholder
   *   paragraph spanning the full document if recovery
   *   produced an empty CST node.
   */
  block(context: BlockCstChildren, sourceText: string): BlockNode {
    // Try single-token block types first.
    const tokenBlock = buildTokenBlock(context);
    if (tokenBlock !== undefined) {
      return tokenBlock;
    }

    // Subrules (block comments, attribute entries, lists,
    // paragraphs) are delegated to their visitor methods.
    const subrule = findSubrule(context);
    if (subrule === undefined) {
      // Recovery produced an empty block CST node. Return
      // a placeholder paragraph spanning the full document
      // so the document structure is preserved without
      // crashing.
      return {
        type: "paragraph",
        children: [],
        position: {
          start: makeLocation(FIRST, FIRST_LINE, FIRST_COLUMN),
          end: computeEnd(sourceText),
        },
      };
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Chevrotain visitor returns unknown
    return this.visit(subrule, sourceText) as BlockNode;
  }

  /**
   * Converts a paragraph's CST inline lines into AST
   * inline nodes. Computes the paragraph's position from
   * the first to the last content token, deliberately
   * excluding trailing newlines (structural separators).
   * @param context - CST children containing inline
   *   lines and newlines from the paragraph rule.
   * @returns A paragraph node with inline children and
   *   content-based position.
   */
  paragraph(context: ParagraphCstChildren): ParagraphNode {
    const inlineLines = context.inlineLine ?? [];
    const inlineNewlines = context.InlineNewline ?? [];
    const children = buildInlineNodesFromLines(inlineLines, inlineNewlines);

    // Position excludes trailing newlines — they are
    // structural separators, not paragraph content. Use
    // only inline content tokens (not InlineNewline) for
    // position tracking.
    const contentTokens = flattenInlineTokens(
      unwrapInlineLines(inlineLines),
      [],
    );

    const start =
      contentTokens.length > EMPTY
        ? tokenStartLocation(contentTokens[FIRST])
        : makeLocation(FIRST, FIRST_LINE, FIRST_COLUMN);

    const lastToken = contentTokens.at(LAST_ELEMENT);
    const end = lastToken === undefined ? start : tokenEndLocation(lastToken);

    return {
      type: "paragraph",
      children,
      position: { start, end },
    };
  }

  /**
   * Visits each unordered list item CST to produce a flat
   * item array, then delegates to `nestListItems` to
   * build the nested tree based on marker depth.
   * @param context - CST children containing the list
   *   item sub-rules from the unorderedList grammar rule.
   * @returns A root ListNode with nested children.
   */
  unorderedList(context: UnorderedListCstChildren): ListNode {
    const itemCsts = context.listItem ?? [];
    // Collect flat items with their depth and AST data.
    const flatItems = itemCsts.map(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Chevrotain visitor returns unknown
      (cst) => this.visit(cst) as FlatListItem,
    );

    return nestListItems(flatItems);
  }

  /**
   * Extracts a flat list item with depth, inline children,
   * checkbox state, and position. "Flat" because nesting
   * happens later in nestListItems — here we just read
   * the marker depth and parse the content line.
   * @param context - CST children for a single unordered
   *   list item: the marker token (e.g. "* ") and inline
   *   content tokens.
   * @returns Flat item with nesting depth derived from
   *   marker length, checkbox state if present, and
   *   inline AST children for the item text.
   */
  listItem(context: ListItemCstChildren): FlatListItem {
    const markerToken = context.UnorderedListMarker?.[FIRST];
    if (markerToken === undefined) {
      return buildRecoveredListItem(
        inlineLinesToTextTokens(
          context.inlineLine ?? [],
          context.InlineNewline ?? [],
        ),
      );
    }

    const depth = markerToken.image.length - TRAILING_SPACE_LEN;

    const { inlineChildren, attachedBlocks, danglingContinuation, lastToken } =
      buildListItemInlineChildren(context, markerToken);

    // Checkbox detection only inspects the first few characters,
    // so we just look at the first TextNode's value rather than
    // re-scanning all tokens.
    const [firstChild] = inlineChildren;
    const rawValue =
      inlineChildren.length > EMPTY && firstChild.type === "text"
        ? firstChild.value
        : "";
    const { checkbox, prefixLength } = parseCheckbox(rawValue);

    if (prefixLength > EMPTY) {
      trimCheckboxPrefix(inlineChildren, prefixLength);
    }

    return {
      depth,
      inlineChildren,
      attachedBlocks,
      danglingContinuation,
      checkbox,
      calloutNumber: undefined,
      start: tokenStartLocation(markerToken),
      end: tokenEndLocation(lastToken),
    };
  }

  /**
   * Visits each ordered list item CST to produce a flat
   * item array, then nests them by dot-marker depth
   * (e.g. `.` = depth 1, `..` = depth 2).
   * @param context - CST children containing the ordered
   *   list item sub-rules.
   * @returns A root ListNode with variant `"ordered"`.
   */
  orderedList(context: OrderedListCstChildren): ListNode {
    const itemCsts = context.orderedListItem ?? [];
    const flatItems = itemCsts.map(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Chevrotain visitor returns unknown
      (cst) => this.visit(cst) as FlatListItem,
    );

    return nestListItems(flatItems, "ordered");
  }

  /**
   * Extracts a flat ordered list item with depth, inline
   * children, and position. Ordered markers use dots
   * (e.g. ". ", ".. ") — depth is marker length minus
   * trailing space, same as unordered.
   * @param context - CST children for a single ordered
   *   list item: the marker token and inline content.
   * @returns Flat item with depth from marker length and
   *   inline AST children. No checkbox support — ordered
   *   lists don't use checklists.
   */
  orderedListItem(context: OrderedListItemCstChildren): FlatListItem {
    const markerToken = context.OrderedListMarker?.[FIRST];
    if (markerToken === undefined) {
      return buildRecoveredListItem(
        inlineLinesToTextTokens(
          context.inlineLine ?? [],
          context.InlineNewline ?? [],
        ),
      );
    }

    const depth = markerToken.image.length - TRAILING_SPACE_LEN;
    const { inlineChildren, attachedBlocks, danglingContinuation, lastToken } =
      buildListItemInlineChildren(context, markerToken);

    return {
      depth,
      inlineChildren,
      attachedBlocks,
      danglingContinuation,
      checkbox: undefined,
      calloutNumber: undefined,
      start: tokenStartLocation(markerToken),
      end: tokenEndLocation(lastToken),
    };
  }

  /**
   * Builds a callout list from its item CSTs. Unlike
   * unordered and ordered lists, callouts are always
   * flat — they cannot nest. The resulting tree is
   * still passed through `nestListItems` for uniform
   * structure, but depth is always 1.
   * @param context - CST children containing the
   *   callout list item sub-rules.
   * @returns A root ListNode with variant `"callout"`.
   */
  calloutList(context: CalloutListCstChildren): ListNode {
    const itemCsts = context.calloutListItem ?? [];
    const flatItems = itemCsts.map(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Chevrotain visitor returns unknown
      (cst) => this.visit(cst) as FlatListItem,
    );

    return nestListItems(flatItems, "callout");
  }

  /**
   * Extracts a flat callout list item. Callout markers use
   * angle brackets (e.g. "<1> ", "<.> "). Unlike unordered
   * and ordered lists, callouts are always flat — depth is
   * fixed at 1 and the meaningful data is the callout
   * number (or 0 for auto-numbering with "<.>").
   * @param context - CST children for a single callout
   *   item: the marker token and inline content.
   * @returns Flat item with the parsed callout number,
   *   fixed depth, and inline AST children.
   */
  calloutListItem(context: CalloutListItemCstChildren): FlatListItem {
    const markerToken = context.CalloutListMarker?.[FIRST];
    if (markerToken === undefined) {
      return buildRecoveredListItem(
        inlineLinesToTextTokens(
          context.inlineLine ?? [],
          context.InlineNewline ?? [],
        ),
      );
    }

    // Extract callout number: "<1> " → 1, "<.> " → 0 (auto).
    const innerMatch = CALLOUT_NUMBER_RE.exec(markerToken.image);
    const inner = innerMatch?.groups?.inner ?? ".";
    const calloutNumber =
      inner === "." ? AUTO_CALLOUT_NUMBER : Number.parseInt(inner, 10);

    const { inlineChildren, attachedBlocks, danglingContinuation, lastToken } =
      buildListItemInlineChildren(context, markerToken);

    return {
      depth: CALLOUT_DEPTH,
      inlineChildren,
      attachedBlocks,
      danglingContinuation,
      checkbox: undefined,
      calloutNumber,
      start: tokenStartLocation(markerToken),
      end: tokenEndLocation(lastToken),
    };
  }

  /**
   * Extracts verbatim content between block comment
   * delimiters (`////`). Content is sliced from the source
   * text rather than reconstructed from tokens, because the
   * CST groups tokens by type and would lose blank lines.
   * @param context - CST children containing the opening
   *   delimiter and optional closing delimiter / end token.
   * @param sourceText - Full source for substring extraction
   *   of the comment body. Also used to compute end position
   *   when the closing delimiter is missing (unclosed comment
   *   extends to EOF).
   * @returns Comment node with verbatim content between
   *   the delimiters.
   */
  blockComment(
    context: BlockCommentCstChildren,
    sourceText: string,
  ): CommentNode {
    const delimiterToken =
      context.BlockCommentDelimiter?.[FIRST] ??
      unreachable("Block comment must have an opening delimiter");
    return buildBlockComment(
      delimiterToken,
      context.BlockCommentEnd?.[FIRST],
      sourceText,
    );
  }

  /**
   * Builds a listing block (`----`) from its delimiter tokens.
   * Content is extracted verbatim from the source text between
   * the delimiters — not from CST tokens — to preserve blank
   * lines and exact whitespace.
   * @param context - CST children with the opening and
   *   optional closing delimiter tokens.
   * @param sourceText - Full source for verbatim content
   *   extraction between delimiters.
   * @returns Delimited block node with variant "listing".
   */
  listingBlock(
    context: ListingBlockCstChildren,
    sourceText: string,
  ): DelimitedBlockNode {
    return buildDelimitedBlock(
      context.ListingBlockOpen,
      context.ListingBlockClose,
      "listing",
      sourceText,
    );
  }

  /**
   * Shared implementation for parent block visitors
   * (example, sidebar, quote). These blocks all follow
   * the same pattern: visit child block CSTs recursively,
   * then wrap them in a ParentBlockNode with the given
   * variant and delimiter positions.
   * @param options - Block definition (see
   *   {@link VisitParentBlockOptions}).
   * @returns Parent block node with visited children.
   */
  private visitParentBlock(options: VisitParentBlockOptions): ParentBlockNode {
    const children = (options.blocks ?? []).map(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Chevrotain visitor returns unknown
      (cst) => this.visit(cst, options.sourceText) as BlockNode,
    );
    return buildParentBlock(
      options.openTokens,
      options.closeTokens,
      options.variant,
      children,
    );
  }

  /**
   * Builds a listing block from a Markdown-style fenced code
   * block (` ``` `). Extracts the optional language hint from
   * the open fence token image (e.g. "rust" from ` ```rust `).
   * Fenced code blocks are treated as listing blocks in the
   * AST because AsciiDoc and Markdown fences serve the same
   * purpose — the distinction is syntactic, not semantic.
   * @param context - CST children with the opening and
   *   optional closing fence tokens.
   * @param sourceText - Full source for verbatim content
   *   extraction between the fences.
   * @returns Delimited block node with variant "listing" and
   *   an optional `language` property parsed from the fence.
   */
  fencedCodeBlock(
    context: FencedCodeBlockCstChildren,
    sourceText: string,
  ): DelimitedBlockNode {
    const node = buildDelimitedBlock(
      context.FencedCodeOpen,
      context.FencedCodeClose,
      "listing",
      sourceText,
    );

    // Extract language from the open fence: "```rust" → "rust".
    // The token image is the full matched text including the
    // backticks. Everything after the 3 backticks is the hint.
    const BACKTICK_COUNT = 3;
    const openImage = context.FencedCodeOpen?.[FIRST]?.image ?? "";
    const lang = openImage.slice(BACKTICK_COUNT).trim();
    if (lang.length > EMPTY) {
      node.language = lang;
    }

    return node;
  }

  /**
   * Builds a literal block (`....`) from its delimiter tokens.
   * Content is extracted verbatim from the source text between
   * the delimiters — not from CST tokens — to preserve blank
   * lines and exact whitespace. Literal blocks preserve all
   * whitespace and render in a monospace font without
   * interpretation.
   * @param context - CST children with the opening and
   *   optional closing delimiter tokens.
   * @param sourceText - Full source for verbatim content
   *   extraction between delimiters.
   * @returns Delimited block node with variant "literal".
   */
  literalBlock(
    context: LiteralBlockCstChildren,
    sourceText: string,
  ): DelimitedBlockNode {
    return buildDelimitedBlock(
      context.LiteralBlockOpen,
      context.LiteralBlockClose,
      "literal",
      sourceText,
    );
  }

  /**
   * Builds a passthrough block (`++++`) from its delimiter
   * tokens. Content is extracted verbatim from the source text
   * between the delimiters — not from CST tokens — to preserve
   * blank lines and exact whitespace. Passthrough content is
   * sent to the output unprocessed — no substitutions or
   * interpretation. This is the AsciiDoc escape hatch for
   * raw HTML/XML.
   * @param context - CST children with the opening and
   *   optional closing delimiter tokens.
   * @param sourceText - Full source for verbatim content
   *   extraction between delimiters.
   * @returns Delimited block node with variant "pass".
   */
  passBlock(
    context: PassBlockCstChildren,
    sourceText: string,
  ): DelimitedBlockNode {
    return buildDelimitedBlock(
      context.PassBlockOpen,
      context.PassBlockClose,
      "pass",
      sourceText,
    );
  }

  /**
   * Builds an example block (`====`). Delegates to
   * `visitParentBlock` — example blocks contain nested
   * block-level children, not verbatim text.
   * @param context - CST children with delimiters and
   *   nested block sub-rules.
   * @param sourceText - Passed through to child visitors.
   * @returns Parent block with variant `"example"`.
   */
  exampleBlock(
    context: ExampleBlockCstChildren,
    sourceText: string,
  ): ParentBlockNode {
    return this.visitParentBlock({
      blocks: context.block,
      openTokens: context.ExampleBlockOpen,
      closeTokens: context.ExampleBlockClose,
      variant: "example",
      sourceText,
    });
  }

  /**
   * Builds a sidebar block (`****`). Sidebars are
   * supplemental content displayed outside the main
   * flow, containing nested block-level children.
   * @param context - CST children with delimiters and
   *   nested block sub-rules.
   * @param sourceText - Passed through to child visitors.
   * @returns Parent block with variant `"sidebar"`.
   */
  sidebarBlock(
    context: SidebarBlockCstChildren,
    sourceText: string,
  ): ParentBlockNode {
    return this.visitParentBlock({
      blocks: context.block,
      openTokens: context.SidebarBlockOpen,
      closeTokens: context.SidebarBlockClose,
      variant: "sidebar",
      sourceText,
    });
  }

  /**
   * Builds an open block (`--`). Unlike other parent
   * blocks, open blocks use a single token type for
   * both open and close delimiters — the CST array has
   * open at `[0]` and close at `[1]`, so we split
   * before delegating to `visitParentBlock`.
   * @param context - CST children with the combined
   *   delimiter array and nested block sub-rules.
   * @param sourceText - Passed through to child visitors.
   * @returns Parent block with variant `"open"`.
   */
  openBlock(
    context: OpenBlockCstChildren,
    sourceText: string,
  ): ParentBlockNode {
    // Split the shared delimiter array into open/close.
    const delimiters = context.OpenBlockDelimiter ?? [];
    return this.visitParentBlock({
      blocks: context.block,
      openTokens: delimiters.slice(FIRST, NEXT),
      closeTokens: delimiters.slice(NEXT),
      variant: "open",
      sourceText,
    });
  }

  /**
   * Builds a quote block (`____`). Quote blocks contain
   * block-level children — nested lists, paragraphs,
   * and other blocks are all allowed inside.
   * @param context - CST children with delimiters and
   *   nested block sub-rules.
   * @param sourceText - Passed through to child visitors.
   * @returns Parent block with variant `"quote"`.
   */
  quoteBlock(
    context: QuoteBlockCstChildren,
    sourceText: string,
  ): ParentBlockNode {
    return this.visitParentBlock({
      blocks: context.block,
      openTokens: context.QuoteBlockOpen,
      closeTokens: context.QuoteBlockClose,
      variant: "quote",
      sourceText,
    });
  }

  /**
   * Builds a literal paragraph from consecutive indented lines.
   * Each IndentedLine token preserves its leading spaces; we
   * join them with newlines to form the verbatim content.
   * Literal paragraphs are the implicit form of literal
   * blocks — any line starting with one or more spaces is
   * treated as literal, no delimiters needed.
   * @param context - CST children containing IndentedLine
   *   tokens, each with its leading whitespace preserved in
   *   the token image.
   * @returns Delimited block node with variant "literal" and
   *   form "indented", content joined from the token images.
   */
  literalParagraph(context: LiteralParagraphCstChildren): DelimitedBlockNode {
    const lineTokens = context.IndentedLine ?? [];
    const content = lineTokens.map((t) => t.image).join("\n");

    const [firstToken] = lineTokens;
    const lastToken = lineTokens.at(LAST_ELEMENT) ?? firstToken;

    return {
      type: "delimitedBlock",
      variant: "literal",
      form: "indented",
      content,
      position: {
        start: tokenStartLocation(firstToken),
        end: tokenEndLocation(lastToken),
      },
    };
  }

  /**
   * Admonition paragraph: `NOTE: text`, `TIP: text`, etc.
   * The marker token image is `"NOTE: "` — we strip the
   * trailing colon-space to get the variant name. Text content
   * tokens (if any) are joined with newlines into the `content`
   * string on the resulting node, which the printer may reflow.
   * @param context - CST children with the admonition marker
   *   token (e.g. "NOTE: ") and inline content lines.
   * @returns Admonition node with variant derived from the
   *   marker and inline text content for the body.
   */
  admonitionParagraph(context: AdmonitionParagraphCstChildren): AdmonitionNode {
    return buildAdmonitionParagraph(
      context.AdmonitionMarker?.[FIRST],
      inlineLinesToTextTokens(
        context.inlineLine ?? [],
        context.InlineNewline ?? [],
      ),
    );
  }

  /**
   * Parses an attribute entry line (`:name: value`) into its
   * components. Handles three forms: set (`:name: value`),
   * prefix-unset (`:!name:`), and suffix-unset (`:name!:`).
   * Falls back to a recovered stub node when the token is
   * missing or unparseable due to error recovery.
   * @param context - CST children containing the single
   *   AttributeEntry token whose image holds the full line.
   * @returns Attribute entry node with parsed name, optional
   *   trimmed value, and unset form indicator.
   */
  attributeEntry(context: AttributeEntryCstChildren): AttributeEntryNode {
    const token = context.AttributeEntry?.[FIRST];
    const groups =
      token === undefined
        ? undefined
        : ATTRIBUTE_ENTRY_RE.exec(token.image)?.groups;
    // Recovery: missing token or unparseable phantom token.
    if (token === undefined || groups === undefined) {
      return buildRecoveredAttributeEntry(token);
    }
    const { prefixBang, name, suffixBang } = groups;
    const unset = parseUnsetForm(prefixBang, suffixBang);
    // TypeScript types regex groups as `string`, but unmatched
    // optional groups are `undefined` at runtime.
    const rawValue = groups.value as string | undefined;
    const trimmed = rawValue?.trim();
    return {
      type: "attributeEntry",
      name,
      value:
        trimmed === undefined || trimmed.length === EMPTY ? undefined : trimmed,
      unset,
      position: {
        start: tokenStartLocation(token),
        end: tokenEndLocation(token),
      },
    };
  }
}
