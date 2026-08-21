/* eslint-disable @typescript-eslint/class-methods-use-this -- Chevrotain visitor dispatch */

/**
 * CST-to-AST visitor for AsciiDoc.
 *
 * Chevrotain's parser produces a Concrete Syntax Tree (CST) — a generic tree
 * of rule invocations and tokens. This visitor walks the CST and builds our
 * typed AST designed for Prettier.
 *
 * The CST is already NESTED the way the AST is: the BlockReader decided
 * every block end and the mechanical grammar consumed its boundary tokens,
 * so sections hold their blocks, list items hold their nested lists and
 * attached blocks, and compound blocks hold their children. Nothing here
 * repairs structure after the fact — each visitor reads its CST node's
 * children and builds the node. The one transform left is style-driven
 * (`[source]` + paragraph → listing block, `[verse]` masquerades,
 * `[NOTE]` block admonitions), which `convertParagraphFormBlocks` applies
 * to every container's children in turn.
 *
 * Position offsets are exclusive-end (one past last character) to match
 * Prettier conventions, so we add +1 to Chevrotain's inclusive endOffset.
 * The visitor receives `sourceText` as a parameter (Chevrotain's second
 * arg to visit()) so computeEnd() can calculate the document's end
 * position and delimited blocks can slice their content.
 */
import type {
  AttachedBlock,
  DocumentNode,
  ParagraphNode,
  CommentNode,
  DelimitedBlockNode,
  ParentBlockNode,
  AdmonitionNode,
  BlockNode,
  ItemContinuation,
  ListNode,
  ListItemNode,
  SectionNode,
  InlineNode,
  Location,
} from "../ast.js";
import type { CstNode, IToken } from "chevrotain";
import { asciidocParser } from "./grammar.js";
import {
  parseCheckbox,
  trimCheckboxPrefix,
  buildDelimitedBlock,
  buildParentBlock,
  findSubrule,
  buildBlockComment,
  buildAdmonitionParagraph,
} from "./block-helpers.js";
import { convertParagraphFormBlocks } from "./paragraph-form.js";
import { buildFromTokens } from "./inline-node-builder.js";
import {
  flattenInlineTokens,
  mergeSortedTokens,
  textLines,
} from "./inline-tokens.js";
import { delimiterKind, type DelimiterKind } from "./lines/classify.js";
import { listMarkerStyle } from "./line-shapes.js";
import { InlineNewline } from "./tokens.js";
import {
  AUTO_CALLOUT_NUMBER,
  EMPTY,
  FIRST,
  FIRST_COLUMN,
  FIRST_LINE,
  LAST_ELEMENT,
  NEXT,
  OUTERMOST_DEPTH,
} from "../constants.js";
import { unreachable } from "../unreachable.js";
import { buildTokenBlock, buildSection } from "./token-builders.js";
import {
  makeLocation,
  tokenStartLocation,
  tokenEndLocation,
  computeEnd,
} from "./positions.js";
import type {
  DocumentCstChildren,
  BlockCstChildren,
  SectionCstChildren,
  ParagraphCstChildren,
  AdmonitionParagraphCstChildren,
  ListCstChildren,
  ListItemCstChildren,
  ItemBlockCstChildren,
  ParagraphBodyCstChildren,
  VerbatimBlockCstChildren,
  CompoundBlockCstChildren,
  LiteralParagraphCstChildren,
} from "./cst-types.js";

// Callout lists are always flat — they don't support nesting like
// unordered or ordered lists. Every callout item is at depth 1.
const CALLOUT_DEPTH = 1;

// Regex extracting the number between angle brackets in a
// callout marker token: `<1> ` → "1", `<.> ` → ".".
const CALLOUT_NUMBER_RE = /<(?<inner>[^>]+)>/v;

// A fenced code block's opener is three backticks followed by the
// optional language hint: "```rust" → "rust".
const BACKTICK_COUNT = 3;

// getBaseCstVisitorConstructorWithDefaults generates a base class with no-op
// methods for every grammar rule, so we only override the rules we need.
const BaseCstVisitor = asciidocParser.getBaseCstVisitorConstructorWithDefaults<
  string,
  unknown
>();

/**
 * The start and end of a paragraph body, from its first to its last
 * CONTENT token — newlines are structural separators, not content; a
 * raw line IS content for this purpose, since it occupies a source
 * line of the paragraph.
 * @param tokens - the body's offset-sorted token stream
 * @returns the content span, or a zero-offset span for an empty body
 *   (recovery only: the reader never emits an empty paragraph)
 */
function bodyExtent(tokens: IToken[]): { start: Location; end: Location } {
  const content = tokens.filter((t) => t.tokenType !== InlineNewline);
  const start =
    content.length > EMPTY
      ? tokenStartLocation(content[FIRST])
      : makeLocation(FIRST, FIRST_LINE, FIRST_COLUMN);
  const last = content.at(LAST_ELEMENT);
  return { start, end: last === undefined ? start : tokenEndLocation(last) };
}

/**
 * The AST variant of a verbatim delimited block. Fenced code blocks are
 * listing blocks in the AST: AsciiDoc and Markdown fences serve the
 * same purpose — the distinction is syntactic, not semantic.
 * @param kind - the opener's delimiter kind (never a comment block)
 * @param open - the opener, for the error message
 * @returns the variant
 */
function verbatimVariant(
  kind: DelimiterKind,
  open: IToken,
): "listing" | "literal" | "pass" {
  const variant = kind === "fencedCode" ? "listing" : kind;
  if (variant !== "listing" && variant !== "literal" && variant !== "pass") {
    return unreachable(`not a verbatim delimiter: ${open.image}`);
  }
  return variant;
}

/**
 * The list-marker token of an item CST node, whichever kind it is.
 * @param context - the item's CST children
 * @returns the marker token
 */
function markerOf(context: ListItemCstChildren): IToken {
  return (
    context.UnorderedListMarker?.[FIRST] ??
    context.OrderedListMarker?.[FIRST] ??
    context.CalloutListMarker?.[FIRST] ??
    unreachable("list item without a marker")
  );
}

/**
 * Which list kind a list's first item's marker belongs to.
 * @param item - the first item's CST node, or undefined under recovery
 * @returns the variant the ListNode carries
 */
function variantOf(item: CstNode | undefined): ListNode["variant"] {
  const context = (item?.children ?? {}) as ListItemCstChildren;
  if (context.CalloutListMarker !== undefined) {
    return "callout";
  }
  return context.OrderedListMarker === undefined ? "unordered" : "ordered";
}

/**
 * How many `+` lines introduced an item block — see `AttachedBlock.pluses`.
 * @param continuation - how the block was introduced
 * @param context - the `itemBlock` CST children
 * @returns the count
 */
function plusesOf(
  continuation: ItemContinuation,
  context: ItemBlockCstChildren,
): number {
  switch (continuation) {
    case "plus": {
      return NEXT;
    }
    case "detached": {
      return context.DetachedContinuation?.length ?? NEXT;
    }
    default: {
      return EMPTY;
    }
  }
}

/**
 * How an item block was introduced, from the reader's mark ahead of it.
 * @param context - the `itemBlock` CST children
 * @returns the continuation kind (`"plus"` when unmarked)
 */
function continuationOf(context: ItemBlockCstChildren): ItemContinuation {
  if (context.DetachedContinuation !== undefined) {
    return "detached";
  }
  if (context.NoContinuation !== undefined) {
    return "none";
  }
  return context.BlankSeparated === undefined ? "plus" : "blank";
}

/**
 * The callout number of a callout marker: `<1> ` → 1, `<.> ` → 0 (auto).
 * @param marker - the CalloutListMarker token
 * @returns the number, or the auto sentinel
 */
function calloutNumberOf(marker: IToken): number {
  const inner = CALLOUT_NUMBER_RE.exec(marker.image)?.groups?.inner ?? ".";
  return inner === "." ? AUTO_CALLOUT_NUMBER : Number.parseInt(inner, 10);
}

/**
 * The value of the first inline child when it is a text node — the
 * only place a checklist prefix (`[x] `) can sit.
 * @param children - the item's inline children
 * @returns the text, or an empty string
 */
function firstTextValue(children: InlineNode[]): string {
  const [first] = children;
  return children.length > EMPTY && first.type === "text" ? first.value : "";
}

/**
 * Read a checklist prefix off an item's text and strip it. Only an
 * unordered item can be a checklist item (`parse_list_item`:
 * `if list_type == :ulist && text.start_with?('[')`); `. [x] text` is
 * an ordered item whose text begins with brackets.
 * @param context - the item's CST children
 * @param inlineChildren - the item's inline nodes, trimmed in place
 * @returns the checkbox state, or undefined
 */
function takeCheckbox(
  context: ListItemCstChildren,
  inlineChildren: InlineNode[],
): ListItemNode["checkbox"] {
  if (context.UnorderedListMarker === undefined) {
    return undefined;
  }
  const { checkbox, prefixLength } = parseCheckbox(
    firstTextValue(inlineChildren),
  );
  if (prefixLength > EMPTY) {
    trimCheckboxPrefix(inlineChildren, prefixLength);
  }
  return checkbox;
}

/**
 * The nesting depth an unordered or ordered marker asks for: a `-`
 * list is always one level deep; repeating markers spell their depth
 * in their length (`**` is level 2). The marker image is `marker +
 * gap`; the style is the marker.
 * @param marker - the marker token
 * @returns the depth
 */
function markerDepth(marker: IToken): number {
  const style = listMarkerStyle(marker.image) ?? "*";
  return style === "-" ? OUTERMOST_DEPTH : style.length;
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
   * Visit a container's block CST nodes in order and apply the
   * style-driven conversions (`[source]` + paragraph, masquerades,
   * block admonitions) to the result. Every container — the document,
   * a section, a compound block, a list item — goes through this, so
   * a `[source]` paragraph inside an example block or a list item is
   * converted exactly as one at the top level is.
   * @param blocks - the container's block CST nodes
   * @param sourceText - full source, passed through to subrule visitors
   * @returns the container's children
   */
  private visitBlocks(
    blocks: CstNode[] | undefined,
    sourceText: string,
  ): BlockNode[] {
    const visited = (blocks ?? []).map(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Chevrotain visitor returns unknown
      (cst) => this.visit(cst, sourceText) as BlockNode,
    );
    return convertParagraphFormBlocks(visited, sourceText);
  }

  /**
   * The document: its blocks, already nested by the reader.
   * @param context - CST children produced by the `document` rule.
   * @param sourceText - Full source for computing the document's end
   *   position (needed because the last token may not reach EOF).
   * @returns Root document node.
   */
  document(context: DocumentCstChildren, sourceText: string): DocumentNode {
    return {
      type: "document",
      children: this.visitBlocks(context.block, sourceText),
      position: {
        start: makeLocation(FIRST, FIRST_LINE, FIRST_COLUMN),
        end: computeEnd(sourceText),
      },
    };
  }

  /**
   * One block: a single-token block is built directly from its token;
   * the subrules are delegated to their visitor methods.
   * @param context - CST children for a single block rule invocation.
   * @param sourceText - Full source, passed through to subrule visitors
   *   and used for recovery fallback position.
   * @returns The appropriate AST block node, or a placeholder paragraph
   *   spanning the full document if recovery produced an empty CST node.
   */
  block(context: BlockCstChildren, sourceText: string): BlockNode {
    const tokenBlock = buildTokenBlock(context);
    if (tokenBlock !== undefined) {
      return tokenBlock;
    }
    const subrule = findSubrule(context);
    if (subrule === undefined) {
      // Recovery produced an empty block CST node. Return a placeholder
      // paragraph spanning the full document so the document structure
      // is preserved without crashing.
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
   * A section: its title line and the blocks the reader put inside it
   * (nested sections included). The node's position is the heading
   * line, as before.
   * @param context - CST children of the `section` rule.
   * @param sourceText - Passed through to child visitors.
   * @returns The section node with its children.
   */
  section(context: SectionCstChildren, sourceText: string): SectionNode {
    const node = buildSection(
      context.SectionTitleLine?.[FIRST] ?? unreachable("section without title"),
    );
    node.children = this.visitBlocks(context.block, sourceText);
    return node;
  }

  /**
   * A paragraph: its inline body, with its position spanning the
   * content tokens (trailing newlines excluded).
   * @param context - CST children of the `paragraph` rule.
   * @returns A paragraph node with inline children.
   */
  paragraph(context: ParagraphCstChildren): ParagraphNode {
    const tokens = this.bodyTokens(context.paragraphBody);
    return {
      type: "paragraph",
      children: buildFromTokens(tokens),
      position: bodyExtent(tokens),
    };
  }

  /**
   * The offset-sorted token stream of a `paragraphBody` CST node:
   * inline tokens, InlineNewline and RawLine tokens, in source order.
   * The reader emits ONE stream with one newline type and the raw lines
   * in place, so nothing is re-typed or unwrapped here.
   * @param context - CST children of the `paragraphBody` rule.
   * @returns The merged stream.
   */
  paragraphBody(context: ParagraphBodyCstChildren): IToken[] {
    return flattenInlineTokens(
      context.inlineToken ?? [],
      mergeSortedTokens(context.InlineNewline ?? [], context.RawLine ?? []),
    );
  }

  /**
   * The body tokens of a paragraph-shaped rule's `paragraphBody` child,
   * or none under recovery.
   * @param body - the `paragraphBody` CST nodes (at most one)
   * @returns the merged stream
   */
  private bodyTokens(body: CstNode[] | undefined): IToken[] {
    const node = body?.[FIRST];
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Chevrotain visitor returns unknown
    return node === undefined ? [] : (this.visit(node) as IToken[]);
  }

  /**
   * One block inside a list item, with how it was introduced — the
   * reader's mark ahead of it, or a `+` directly above when unmarked.
   * @param context - CST children of the `itemBlock` rule.
   * @param sourceText - Passed through to the block visitor.
   * @returns The block and its continuation kind; nested lists carry a
   *   kind too, which the item visitor drops.
   */
  itemBlock(context: ItemBlockCstChildren, sourceText: string): AttachedBlock {
    const cst =
      context.block?.[FIRST] ?? unreachable("item block without a block");
    const continuation = continuationOf(context);
    return {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Chevrotain visitor returns unknown
      block: this.visit(cst, sourceText) as BlockNode,
      continuation,
      pluses: plusesOf(continuation, context),
    };
  }

  /**
   * A paragraph-form admonition: `NOTE: text`. The label token image is
   * `"NOTE: "`; the body's lines become the node's `content` string,
   * raw lines as lines of their own, which the printer re-emits.
   * @param context - CST children of the `admonitionParagraph` rule.
   * @returns Admonition node with variant derived from the label.
   */
  admonitionParagraph(context: AdmonitionParagraphCstChildren): AdmonitionNode {
    return buildAdmonitionParagraph(
      context.AdmonitionLabel?.[FIRST],
      textLines(this.bodyTokens(context.paragraphBody)),
    );
  }

  /**
   * A list: its items, with the variant read off the first item's
   * marker (every item of one list has the same marker kind — the
   * reader opened the list on that kind and ends it at any other).
   * @param context - CST children of the `list` rule.
   * @param sourceText - Passed through to item visitors.
   * @returns The list node.
   */
  list(context: ListCstChildren, sourceText: string): ListNode {
    const itemCsts = context.listItem ?? [];
    const items = itemCsts.map(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Chevrotain visitor returns unknown
      (cst) => this.visit(cst, sourceText) as ListItemNode,
    );
    const first = items.at(FIRST);
    const last = items.at(LAST_ELEMENT);
    // The reader never emits an empty list; only recovery could. An
    // empty list prints as nothing, which beats a crash.
    const fallback = makeLocation(FIRST, FIRST_LINE, FIRST_COLUMN);
    return {
      type: "list",
      variant: variantOf(itemCsts.at(FIRST)),
      children: items,
      position: {
        start: first?.position.start ?? fallback,
        end: last?.position.end ?? fallback,
      },
    };
  }

  /**
   * A list item: its marker, its principal text, and every block the
   * reader put inside it in source order — nested lists go to
   * `children` after the inline nodes, everything else (`+`-attached
   * and in-item blocks alike) to `attachedBlocks`, which is the AST's
   * existing spelling of Asciidoctor's `list_item.blocks`, with the
   * reader's detached-continuation note alongside each.
   * @param context - CST children of the `listItem` rule.
   * @param sourceText - Passed through to block visitors.
   * @returns The item node.
   */
  listItem(context: ListItemCstChildren, sourceText: string): ListItemNode {
    const marker = markerOf(context);
    const bodyTokenStream = this.bodyTokens(context.paragraphBody);
    const inlineChildren = buildFromTokens(bodyTokenStream);
    const checkbox = takeCheckbox(context, inlineChildren);
    const itemBlocks = (context.itemBlock ?? []).map(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Chevrotain visitor returns unknown
      (cst) => this.visit(cst, sourceText) as AttachedBlock,
    );
    // The style-driven conversions replace a pair of blocks with a pair,
    // so each converted block keeps the continuation of the one it
    // replaced.
    const blocks = convertParagraphFormBlocks(
      itemBlocks.map(({ block }) => block),
      sourceText,
    ).map(
      (block, index): AttachedBlock => ({
        block,
        continuation: itemBlocks[index].continuation,
        pluses: itemBlocks[index].pluses,
      }),
    );
    const nested = blocks
      .map(({ block }) => block)
      .filter((block): block is ListNode => block.type === "list");
    const attachedBlocks = blocks.filter(({ block }) => block.type !== "list");
    const isCallout = context.CalloutListMarker !== undefined;
    return {
      type: "listItem",
      depth: isCallout ? CALLOUT_DEPTH : markerDepth(marker),
      checkbox,
      calloutNumber: isCallout ? calloutNumberOf(marker) : undefined,
      children: [...inlineChildren, ...nested],
      attachedBlocks,
      keepTextBreak: context.KeepTextBreak !== undefined,
      danglingContinuation: context.DanglingContinuation !== undefined,
      position: {
        start: tokenStartLocation(marker),
        end:
          blocks.at(LAST_ELEMENT)?.block.position.end ??
          (bodyTokenStream.length > EMPTY
            ? bodyExtent(bodyTokenStream).end
            : tokenEndLocation(marker)),
      },
    };
  }

  /**
   * A delimited block whose content is verbatim: listing, literal,
   * pass, fenced code — or a comment block, which is a CommentNode.
   * The kind comes from the opener's delimiter; content is sliced from
   * the source between the opener and wherever the block closed.
   * @param context - CST children of the `verbatimBlock` rule.
   * @param sourceText - Full source for verbatim content extraction.
   * @returns The delimited block, or a block comment.
   */
  verbatimBlock(
    context: VerbatimBlockCstChildren,
    sourceText: string,
  ): DelimitedBlockNode | CommentNode {
    const open =
      context.VerbatimBlockOpen?.[FIRST] ??
      unreachable("verbatim block without an opener");
    const at = {
      close: context.VerbatimBlockClose?.[FIRST],
      unclosed: context.UnclosedEnd?.[FIRST],
    };
    const kind =
      delimiterKind(open.image.trimEnd()) ??
      unreachable(`not a delimiter: ${open.image}`);
    if (kind === "commentBlock") {
      return buildBlockComment(open, at, sourceText);
    }
    const node = buildDelimitedBlock(
      open,
      at,
      verbatimVariant(kind, open),
      sourceText,
    );
    if (kind === "fencedCode") {
      // Fences imply the `source` style even without a language hint;
      // the printer uses this to decide whether to emit `[source]`.
      node.fenced = true;
      const lang = open.image.slice(BACKTICK_COUNT).trim();
      if (lang.length > EMPTY) node.language = lang;
    }
    return node;
  }

  /**
   * A delimited block whose content is parsed as blocks: example,
   * sidebar, open, quote.
   * @param context - CST children of the `compoundBlock` rule.
   * @param sourceText - Passed through to child visitors.
   * @returns The parent block with its visited children.
   */
  compoundBlock(
    context: CompoundBlockCstChildren,
    sourceText: string,
  ): ParentBlockNode {
    const open =
      context.CompoundBlockOpen?.[FIRST] ??
      unreachable("compound block without an opener");
    const kind = delimiterKind(open.image.trimEnd());
    const variant = kind === "openBlock" ? "open" : kind;
    if (
      variant !== "example" &&
      variant !== "sidebar" &&
      variant !== "open" &&
      variant !== "quote"
    ) {
      return unreachable(`not a compound delimiter: ${open.image}`);
    }
    return buildParentBlock(
      open,
      {
        close: context.CompoundBlockClose?.[FIRST],
        unclosed: context.UnclosedEnd?.[FIRST],
      },
      variant,
      this.visitBlocks(context.block, sourceText),
    );
  }

  /**
   * A literal paragraph: the reader's run of indented lines. Each
   * LiteralLine token preserves its leading spaces; they are joined
   * with newlines to form the verbatim content.
   * @param context - CST children of the `literalParagraph` rule.
   * @returns Delimited block node with variant "literal" and form
   *   "indented".
   */
  literalParagraph(context: LiteralParagraphCstChildren): DelimitedBlockNode {
    const lineTokens = context.LiteralLine ?? [];
    const [firstToken] = lineTokens;
    const lastToken = lineTokens.at(LAST_ELEMENT) ?? firstToken;
    return {
      type: "delimitedBlock",
      variant: "literal",
      form: "indented",
      content: lineTokens.map((t) => t.image).join("\n"),
      position: {
        start: tokenStartLocation(firstToken),
        end: tokenEndLocation(lastToken),
      },
    };
  }
}
