/**
 * Shared helpers for the BlockReader characterization suites
 * (reader.test.ts and reader-lists.test.ts).
 *
 * A module rather than a test file so both suites read the SAME
 * definition of "the shape of a document" — two spellings would be two
 * contracts.
 */
import type {
  BlockNode,
  GapLine,
  InlineNode,
  ListItemNode,
  ListNode,
} from "../../src/ast.js";
import { parse } from "../../src/parser.js";
import { renderedHtml } from "../helpers.js";
import { preorder } from "./ast-invariants.js";

/**
 * Render a parsed document as a readable structure string — the AST
 * successor to `shape()`, which rendered the reader's token stream.
 *
 * The alphabet:
 *   p(…)                a paragraph and its inline content
 *   t                   one inline node; a RUN of them collapses to one
 *   /                   a line break INSIDE a text node
 *   raw                 a rawLine node (a comment or directive kept in place)
 *   section(…)          a section and the blocks inside it
 *   list(…) olist(…)    a list and its items — unordered, ordered,
 *   colist(…) item(…)   callout — and one item
 *   example(…) open(…)  a parent block and its children
 *   listing[n]          a verbatim block, n content lines
 *   literal-indented[n] an indented literal paragraph
 *   commentBlock[n] comment directive attrs title attr macro
 *   doctitle heading thematic pagebreak admonition(variant)
 *   + ~+ ~++ - ~        an in-item block's glyph, a pure function of
 *                       its recorded gap ({@link gapGlyph}): a live `+`
 *                       directly above it; a blank line then N `+`
 *                       lines; an empty gap; blanks only (or a `+` the
 *                       blank budget erased)
 *   !dangling           the item's trailing `+` (trailingContinuation)
 *
 * An item's blocks — nested lists and attached blocks alike — render
 * in SOURCE order.
 *
 * What it deliberately does NOT show, because the AST does not carry
 * it: whether a delimited block met its own terminator or was forced
 * shut. A row that pinned that carries an extra targeted assertion
 * instead.
 * @param source - the document to parse
 * @returns the structure string
 */
export function astShape(source: string): string {
  return parse(source).children.map(blockShape).join(" ");
}

// One-line blocks render as a single word.
const LEAF_NAMES: Record<string, string> = {
  documentTitle: "doctitle",
  discreteHeading: "heading",
  blockAttributeList: "attrs",
  blockTitle: "title",
  attributeEntry: "attr",
  preprocessorDirective: "directive",
  blockMacro: "macro",
  thematicBreak: "thematic",
  pageBreak: "pagebreak",
};

// A list renders under its own variant, so a row named for an ordered
// or a callout list visibly asserts it.
const LIST_NAMES: Record<ListNode["variant"], string> = {
  unordered: "list",
  ordered: "olist",
  callout: "colist",
};

/**
 * How many lines a verbatim block's content has.
 * @param content - the block's content, newline separated
 * @returns the line count; an empty block has none
 */
function lineCount(content: string): number {
  return content === "" ? 0 : content.split("\n").length;
}

/**
 * Render one inline run: every node is `t`, a line break inside a text
 * node is `/`, and a raw line is `raw`. Runs of `t` collapse, so a
 * shape reads as structure rather than length.
 * @param children - a paragraph's or item's inline nodes
 * @returns the rendered run
 */
function inlineShape(children: readonly InlineNode[]): string {
  const parts = children.map((child) => {
    if (child.type === "rawLine") return "raw";
    if (child.type === "text") {
      const breaks = child.value
        .split("\n")
        .slice(1)
        .flatMap(() => ["/", "t"]);
      return ["t", ...breaks].join(" ");
    }
    return "t";
  });
  // The word boundary is load-bearing: "p(t t" ends in `t t` and would
  // collapse into the surrounding name without it.
  return parts.join(" ").replaceAll(/\bt(?: t)+\b/gv, "t");
}

/**
 * One gap's glyph. Empty → `-` (directly under). No `+` → `~` (blank
 * separated). Two or more trailing blanks after the last `+` → `~`
 * too: Ruby's budget erased that `+`, so it attached nothing. A lone
 * leading `+` (at most one trailing blank) → `+`. Anything else —
 * a detached or stacked-detached spelling — → `~` plus one `+` per
 * continuation line.
 * Exported for its table test (tests/parser/list-reader.test.ts).
 * @param gap - the recorded separator lines
 * @returns the glyph prefix for the block's shape
 */
export function gapGlyph(gap: readonly GapLine[]): string {
  if (gap.length === 0) return "-";
  let trailingBlanks = 0;
  while (gap.at(-1 - trailingBlanks) === "") trailingBlanks += 1;
  const core = gap.slice(0, gap.length - trailingBlanks);
  if (core.length === 0 || trailingBlanks >= 2) return "~";
  const { length: pluses } = core.filter((line) => line === "+");
  return core[0] === "+" && pluses === 1 ? "+" : `~${"+".repeat(pluses)}`;
}

/**
 * Render one list item: its principal text, then every block it holds
 * — nested lists and blocks alike, already in SOURCE order — plus the
 * trailing-`+` flag the printer reads. Each non-list block's glyph is
 * a pure function of its recorded gap ({@link gapGlyph}), chosen to
 * reproduce every spelling the old marks pinned.
 * @param item - the item node
 * @returns the rendered item
 */
function itemShape(item: ListItemNode): string {
  const parts = [inlineShape(item.text)];
  for (const { gap, block } of item.blocks) {
    // A nested list never carried a mark in the old shapes and keeps
    // that spelling (byte-identity across the cut-over); its gap is
    // pinned by the invariants and the format suites instead.
    parts.push(
      block.type === "list"
        ? blockShape(block)
        : `${gapGlyph(gap)}${blockShape(block)}`,
    );
  }
  if (item.trailingContinuation) parts.push("!dangling");
  return `item(${parts.filter((part) => part !== "").join(" ")})`;
}

/**
 * Render one block and everything under it.
 * @param node - the block node
 * @returns the rendered block
 */
function blockShape(node: BlockNode): string {
  switch (node.type) {
    case "section": {
      return `section(${node.children.map(blockShape).join(" ")})`;
    }
    case "paragraph": {
      return `p(${inlineShape(node.children)})`;
    }
    case "admonition": {
      return `admonition(${node.variant})`;
    }
    case "list": {
      const { [node.variant]: name } = LIST_NAMES;
      return `${name}(${node.children.map(itemShape).join(" ")})`;
    }
    case "parentBlock": {
      return `${node.variant}(${node.children.map(blockShape).join(" ")})`;
    }
    case "delimitedBlock": {
      const name = node.form === "indented" ? "literal-indented" : node.variant;
      return `${name}[${String(lineCount(node.content))}]`;
    }
    case "comment": {
      return node.commentType === "block"
        ? `commentBlock[${String(lineCount(node.value))}]`
        : "comment";
    }
    default: {
      return LEAF_NAMES[node.type] ?? node.type;
    }
  }
}

/**
 * `<li>` count from the oracle — the structure
 * `read_lines_for_list_item` exists to get right. {@link itemCount}
 * counts one `listItem` node per `<li>`, so the two must agree on
 * every row.
 * @param input - the document
 * @returns how many `<li>` elements Asciidoctor renders
 */
export function oracleItems(input: string): number {
  return (renderedHtml(input).match(/<li>/gv) ?? []).length;
}

/**
 * How many list items the parse produced — the AST successor to
 * counting `ItemEnd` tokens. Paired with {@link oracleItems} on every
 * list row: the structure `read_lines_for_list_item` exists to get
 * right is how many items there are.
 * @param source - the document to parse
 * @returns the number of listItem nodes anywhere in the tree
 */
export function itemCount(source: string): number {
  return preorder(parse(source)).filter((node) => node.type === "listItem")
    .length;
}
