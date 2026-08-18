/**
 * Inline node printing — converts inline AST nodes (text,
 * bold, italic, monospace, highlight, attribute references,
 * links, xrefs, inline anchors, inline images, UI macros,
 * footnotes, passthroughs, and hard line breaks) to Prettier
 * Doc IR.
 *
 * Extracted from the main printer to keep file size within
 * the max-lines lint limit.
 */
import { doc, type AstPath, type Doc } from "prettier";
import type {
  BlockNode,
  DocumentNode,
  InlineNode,
  ListItemNode,
} from "./ast.js";
import {
  inlineMacroToSource,
  linkToSource,
  xrefToSource,
  anchorToSource,
} from "./serialize-inline.js";
import { EMPTY, FIRST, LAST_ELEMENT, NEXT } from "./constants.js";
import { flattenForFill, wordsToFillParts } from "./reflow.js";

const {
  builders: { line, literalline },
} = doc;

// Must match the AnyNode union in the main printer exactly.
// Prettier's AstPath<T> is invariant: path.map() and
// path.call() reject a narrower type at the call site, so
// we re-declare the same union here rather than narrowing
// to AstPath<InlineNode>.
type AnyNode = DocumentNode | BlockNode | InlineNode | ListItemNode;
type PrintPath = AstPath<AnyNode>;
type PrintFunction = (path: PrintPath) => Doc;

/**
 * Collapse source line breaks inside a serialized inline
 * construct to single spaces. Bracketed text (`url[text]`,
 * `xref:t[text]`, `<<t,text>>`) may span source lines — the
 * lexer matches it across `\n`. Re-emitting the raw newline
 * would make the output layout depend on the input layout
 * (breaking idempotency, issue #1) and would corrupt fill()
 * width measurement, which assumes Doc strings are single-line.
 * AsciiDoc renders the line break as a space, so this rewrite
 * is semantics-preserving; intra-line spacing is left alone.
 * Exception: a line ending in ` +` is a hard line break —
 * joining it would drop the break and expose a literal `+`, so
 * sources containing one are returned unchanged (their layout
 * stays source-dependent, matching pre-issue-#1 behavior).
 * @param source - Serialized AsciiDoc source for an atomic
 *   inline construct (link, macro, xref, anchor).
 * @returns The source with each newline run (including any
 *   surrounding indentation whitespace) replaced by one space,
 *   or unchanged when a hard line break is present.
 */
function collapseSourceNewlines(source: string): string {
  if (source.includes(" +\n")) {
    return source;
  }
  return source.replaceAll(/[^\S\n]*\n\s*/gv, " ");
}

/**
 * Check whether the node at `path` is a direct child of a
 * formatting span (bold, italic, monospace, highlight). Used
 * by the text case to decide whether a trailing `+` needs
 * escaping: inside a span the closing mark follows the text
 * in the output, so a `+` can never sit bare at end of line —
 * and escaping it would corrupt the span's content.
 * @param path - Prettier's AstPath at the current text node.
 * @returns True when the immediate parent is a formatting
 *   span.
 */
function isInsideFormattingSpan(path: PrintPath): boolean {
  const parent = path.getParentNode();
  return (
    parent !== null &&
    (parent.type === "bold" ||
      parent.type === "italic" ||
      parent.type === "monospace" ||
      parent.type === "highlight")
  );
}

/**
 * Check whether the node at `path` is followed by a sibling
 * that participates in the same enclosing fill(). Nested
 * lists inside a list item do NOT count: they print on their
 * own lines outside the fill, so a word at the end of the
 * text before them still ends an output line.
 * @param path - Prettier's AstPath at the current text node.
 * @returns True when an inline sibling directly follows.
 */
function hasFollowingInlineSibling(path: PrintPath): boolean {
  const parent = path.getParentNode();
  const { index } = path;
  if (parent === null || index === null || !("children" in parent)) {
    return false;
  }
  const next = parent.children.at(index + NEXT);
  return next !== undefined && next.type !== "list";
}

/**
 * Append a text node's trailing-whitespace boundary to its fill
 * parts. Normally the boundary is a breakable `line`; but when
 * the node's last word is a bare `+` and an inline sibling
 * follows, an explicit space is fused onto the `+` instead so
 * flattenForFill joins it with the sibling's first content —
 * fill() can then only break BEFORE the `+`, never after it
 * (where ` +` at end of line would become a hard line break).
 * @param parts - Fill parts for the text node (mutated).
 * @param words - The node's whitespace-split words.
 * @param glueToSibling - True when an inline sibling follows in
 *   the same fill and the trailing word needs forward gluing.
 */
function pushTrailingBoundary(
  parts: Doc[],
  words: string[],
  glueToSibling: boolean,
): void {
  if (glueToSibling && words.at(LAST_ELEMENT) === "+") {
    const lastPart = parts.pop() ?? "";
    parts.push([lastPart, " "]);
  } else {
    parts.push(line);
  }
}

/**
 * Decide how a text node's trailing `+` word must be protected
 * from landing bare at the end of an output line (where ` +`
 * becomes a hard line break). See the text case in
 * printInlineNode for the three-way rationale.
 * @param path - Prettier's AstPath at the current text node.
 * @returns Whether to rewrite an unglued trailing `+` to
 *   `{plus}`, and whether to glue it forward to a following
 *   inline sibling instead.
 */
function trailingPlusPolicy(path: PrintPath): {
  escapeTrailingPlus: boolean;
  glueToSibling: boolean;
} {
  const followedInFill = hasFollowingInlineSibling(path);
  return {
    escapeTrailingPlus: !followedInFill && !isInsideFormattingSpan(path),
    glueToSibling: followedInFill,
  };
}

/**
 * Convert an inline AST node to Prettier Doc IR.
 * Dispatches on node type to produce the correct markup
 * (text reflow, formatting marks, attribute references,
 * links, macros, and hard line breaks).
 * @param node - The inline AST node to render; always an
 *   element of a parent block's or span's `children` array,
 *   dispatched here by the main printer.
 * @param path - Prettier's AstPath at the current inline
 *   node. Must carry the full AnyNode union (not just
 *   InlineNode) because AstPath<T> is invariant — narrowing
 *   it would break path.map() at the call site.
 * @param print - Prettier's recursive print callback;
 *   passed to path.map() to render child inline nodes.
 * @returns Doc IR for the inline node, ready to be composed
 *   into an enclosing fill() or concat by the caller.
 */
export function printInlineNode(
  node: InlineNode,
  path: PrintPath,
  print: PrintFunction,
): Doc {
  switch (node.type) {
    case "text": {
      // Split into words; wordsToFillParts interleaves with
      // `line` so the enclosing fill() can decide where to
      // break. Existing newlines in the source are treated as
      // word separators (reflow), not preserved.
      //
      // Two safety mechanisms in wordsToFillParts prevent
      // reflow from generating AsciiDoc syntax:
      // 1. Words dangerous at line START (e.g. list markers
      //    like `-`, `*`) are merged into the preceding word
      //    group so that fill() breaks BEFORE the pair, never
      //    between them.
      // 2. Words dangerous at line END (bare `+`) are merged
      //    with their successor so fill() breaks BEFORE them,
      //    preventing ` +\n` (hard line break) from appearing.
      //
      // When a text node has leading or trailing whitespace
      // (from inline formatting context, e.g. "This is "
      // before *bold*), we emit `line` at the boundary so
      // adjacent inline marks get proper spacing in fill().
      const words = node.value
        .split(/\s+/v)
        .filter((word) => word.length > EMPTY);
      // All-whitespace text nodes (e.g. " " between adjacent
      // formatting marks, or " " as sole content of a
      // formatting span like `_# #_`). Emit a single line
      // separator so the whitespace participates in fill()
      // as a break point — rather than being dropped entirely,
      // which would fuse adjacent siblings or collapse content
      // whitespace inside formatting marks.
      if (words.length === EMPTY) {
        return [line];
      }
      // A trailing `+` word needs care because ` +` at end of
      // an output line is a hard line break. Three cases:
      // - An inline sibling follows in the same fill(): glue
      //   the `+` forward to that sibling (below) so no break
      //   can land after it. No escape — escaping would put a
      //   literal `{plus}` mid-line.
      // - No sibling follows but this text is inside a
      //   formatting span: the closing mark lands directly
      //   after the `+` in the output, so it can never end a
      //   line bare. No escape — escaping would corrupt the
      //   span's content (issue #2's `` `+` `` case).
      // - Otherwise (block-level last child, or only a nested
      //   list follows — which prints outside the fill): the
      //   `+` truly ends an output line, so it must be
      //   escaped.
      const { escapeTrailingPlus, glueToSibling } = trailingPlusPolicy(path);
      const parts = wordsToFillParts(words, { escapeTrailingPlus });
      const hasLeadingSpace = /^\s/v.test(node.value);
      const hasTrailingSpace = /\s$/v.test(node.value);
      if (hasLeadingSpace) {
        parts.unshift(line);
      }
      if (hasTrailingSpace) {
        pushTrailingBoundary(parts, words, glueToSibling);
      }
      return parts;
    }
    case "bold":
    case "italic":
    case "monospace": {
      // Constrained marks (`*bold*`) require word boundaries;
      // unconstrained (`**bold**`) work anywhere, including
      // mid-word. The AST preserves which form was used so
      // we round-trip it faithfully instead of normalizing.
      // Computed destructuring picks the single-char mark for
      // the current node type without a separate if/switch.
      const markMap = { bold: "*", italic: "_", monospace: "`" };
      const { [node.type]: singleMark } = markMap;
      const mark = node.constrained ? singleMark : `${singleMark}${singleMark}`;
      // Flatten children so their fill-compatible parts
      // (word, line, word, ...) participate directly in the
      // enclosing fill(). flattenForFill (not .flat())
      // maintains fill() alignment when nested inline
      // nodes are present. Fuse the opening/closing marks
      // with the first/last content elements so the marks
      // stay adjacent to words (required for AsciiDoc
      // constrained formatting) and fill() accounts for
      // their width when deciding where to break.
      const parts = flattenForFill(path.map(print, "children"));
      // Children that are all whitespace flatten to an empty
      // array (e.g. `_# #_` where highlight contains only a
      // space). Emit the bare marks to avoid crashing on
      // undefined array access during fusing.
      if (parts.length === EMPTY) {
        return [`${mark}${mark}`];
      }
      const lastIndex = parts.length + LAST_ELEMENT;
      parts[FIRST] = [mark, parts[FIRST]];
      parts[lastIndex] = [parts[lastIndex], mark];
      return parts;
    }
    case "highlight": {
      // A role attribute gives the span semantic meaning used
      // by CSS, e.g. `[.red]#text#`. The role is written as
      // an inline attribute list immediately before the mark,
      // not as a block attribute list — so it must be emitted
      // inline here, not through the block printer.
      const mark = node.constrained ? "#" : "##";
      const rolePrefix = node.role === undefined ? "" : `[${node.role}]`;
      // Same flattening + fusing as bold/italic/monospace
      // above — see comment there for rationale.
      const parts = flattenForFill(path.map(print, "children"));
      if (parts.length === EMPTY) {
        return [`${rolePrefix}${mark}${mark}`];
      }
      const lastIndex = parts.length + LAST_ELEMENT;
      parts[FIRST] = [rolePrefix, mark, parts[FIRST]];
      parts[lastIndex] = [parts[lastIndex], mark];
      return parts;
    }
    // Source-preserved constructs: these nodes are emitted
    // verbatim from the AST without reformatting. Prettier
    // does not reflow them because their internal syntax
    // (URLs, target IDs, key combos, menu paths, etc.) is
    // opaque to the printer — changing whitespace or line
    // breaks would alter semantics or break rendering.
    case "attributeReference": {
      return `{${node.name}}`;
    }
    case "inlineMacro": {
      return collapseSourceNewlines(inlineMacroToSource(node));
    }
    case "link": {
      return collapseSourceNewlines(linkToSource(node));
    }
    case "xref": {
      // Defense-in-depth: the XrefShorthand and InlineAnchor
      // token patterns exclude `\n`, so today these nodes can
      // never contain a newline — only InlineUrl and InlineMacro
      // match across lines. The collapse is kept so a future
      // pattern change cannot silently reintroduce multi-line
      // output.
      return collapseSourceNewlines(xrefToSource(node));
    }
    case "inlineAnchor": {
      return collapseSourceNewlines(anchorToSource(node));
    }
    case "hardLineBreak": {
      // ` +` followed by a forced line break in the output.
      // Use literalline (not hardline) so the break resets
      // to column 0 regardless of any enclosing align()
      // context — e.g. inside list items where align() is
      // used for soft-wrap continuation indentation.
      return [" +", literalline];
    }
  }
}
