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
  TextNode,
  RawLineNode,
} from "./ast.js";
import {
  inlineMacroToSource,
  linkToSource,
  xrefToSource,
  anchorToSource,
} from "./serialize-inline.js";
import {
  EMPTY,
  FIRST,
  LAST_ELEMENT,
  NEXT,
  NOT_FOUND,
  SINGLE,
} from "./constants.js";
import {
  DLIST_HAZARD_BREAK,
  flattenForFill,
  isBlockSyntaxAtLineStart,
  splitWords,
  wordsToFillParts,
} from "./reflow.js";

const {
  builders: { line, literalline },
} = doc;

// The two characters a hard line break prints: the space is part of
// the syntax (`LineBreakRx` requires it), not a separator.
const HARD_BREAK_IMAGE = " +";

// A hard line break OWNS its line when nothing but whitespace
// precedes it there — which, in AST terms, means the text node in
// front of it ends with the newline that opened the line (plus any
// further indentation the token did not take).
const LINE_START_BEFORE_BREAK = /\n[ \t]*$/v;

/**
 * Whether the source gave the hard line break at `path` a line of
 * its own.
 *
 * A break that opens the block's inline content is NOT counted:
 * there is nothing in front of it to break away from, and emitting
 * a leading separator would open the block with a blank line.
 * @param path - Prettier's AstPath at the hard line break.
 * @returns True when only whitespace precedes it on its line.
 */
function ownsItsLine(path: PrintPath): boolean {
  const parent = path.getParentNode();
  const { index } = path;
  if (parent === null || index === null || !("children" in parent)) {
    return false;
  }
  if (index <= FIRST) {
    return false;
  }
  const previous = parent.children.at(index + LAST_ELEMENT);
  return (
    previous?.type === "text" && LINE_START_BEFORE_BREAK.test(previous.value)
  );
}

/**
 * Print a hard line break (` +` at end of a line).
 *
 * Uses literalline (not hardline) so the break resets to column 0
 * regardless of any enclosing align() context — e.g. inside list
 * items, where align() supplies the soft-wrap indentation.
 *
 * A ` +` the source put alone on its line keeps that line.
 * Asciidoctor's `LineBreakRx` captures everything before the space
 * (`^(.*)[ \t]\+$`), so ` +` alone renders `<br>` with the
 * preceding line's text AND its newline intact, while `text +`
 * renders `text<br>` — joining the two lines would drop a space from
 * the rendered output. The leading break is a separator;
 * flattenForFill collapses it against the preceding text node's own
 * boundary. The trailing break is emitted only when an inline sibling
 * follows in the same fill — see the body.
 * @param path - Prettier's AstPath at the hard line break.
 * @returns Fill parts for the break.
 */
function printHardLineBreak(path: PrintPath): Doc[] {
  // The trailing break ends the line only when something follows in
  // this fill; with nothing after it, the block joiner (or the item's
  // next block) supplies the break, and emitting one here would open
  // what follows with a blank line — one more on every pass.
  const printed: Doc[] = hasFollowingInlineSibling(path)
    ? [HARD_BREAK_IMAGE, literalline]
    : [HARD_BREAK_IMAGE];
  return ownsItsLine(path) ? [literalline, ...printed] : printed;
}

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
 * tokenizer's `InlineMacro`/`InlineUrl` rules
 * (src/parse/inline/rules.ts) match it across `\n`. Re-emitting the
 * raw newline would make the output layout depend on the input
 * layout (breaking idempotency, issue #1) and would corrupt fill()
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

// Siblings that do NOT share the enclosing fill(): a nested list
// prints on its own lines outside it, and a raw line forces a break
// on both sides. Either way the node before one still ENDS an output
// line, so a trailing `+` there is a hard line break and must be
// escaped, and a word after one starts a line rather than fusing.
const OWN_LINE_SIBLINGS = new Set(["list", "rawLine"]);

/**
 * Print a raw line — a comment, preprocessor or otherwise verbatim line
 * kept inside a paragraph.
 *
 * Such a line must start at column 0 to be one, so the breaks around
 * it are literalline (not hardline): literal breaks reset to column 0
 * regardless of any enclosing align(), which list items use for
 * soft-wrap indentation.
 *
 * Both breaks sit in fill() SEPARATOR slots. flattenForFill collapses
 * one against a neighbour's break, so a break is only emitted where a
 * neighbour exists to collapse it against: the TRAILING one is dropped
 * when nothing follows in this fill (the block joiner already supplies
 * that break — emitting it would open the next block with a blank
 * line), and the LEADING one when the raw line is the paragraph's first
 * node (a paragraph that is one verbatim line — the second of two
 * adjacent `+` lines in a list item — would otherwise open with a
 * blank).
 * @param node - The raw line node.
 * @param path - Prettier's AstPath at the node.
 * @returns Doc IR for the line and its breaks.
 */
function printRawLine(node: RawLineNode, path: PrintPath): Doc {
  const leading = path.index === FIRST ? [] : [literalline];
  return hasFollowingInlineSibling(path)
    ? [...leading, node.value, literalline]
    : [...leading, node.value];
}

/**
 * Check whether the node at `path` is followed by a sibling
 * that participates in the same enclosing fill().
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
  return next !== undefined && !OWN_LINE_SIBLINGS.has(next.type);
}

/**
 * Check whether the node at `path` is preceded by a sibling that
 * participates in the same enclosing fill(). Mirrors
 * hasFollowingInlineSibling — see OWN_LINE_SIBLINGS for what does
 * not count.
 * @param path - Prettier's AstPath at the current text node.
 * @returns True when an inline sibling directly precedes.
 */
function hasPrecedingInlineSibling(path: PrintPath): boolean {
  const parent = path.getParentNode();
  const { index } = path;
  if (parent === null || index === null || !("children" in parent)) {
    return false;
  }
  if (index <= FIRST) {
    return false;
  }
  const previous = parent.children.at(index + LAST_ELEMENT);
  return previous !== undefined && !OWN_LINE_SIBLINGS.has(previous.type);
}

/**
 * Prepend a text node's leading-whitespace boundary to its fill
 * parts.
 *
 * Normally the boundary is a breakable `line`. But when the node's
 * FIRST word would become block syntax at column 0 (a fenced-code
 * prefix, `----`, `.Title`) and an inline sibling precedes it, a break there
 * is unsafe: wordsToFillParts glues such a word to its predecessor
 * WITHIN a node, and the same must hold ACROSS the node boundary.
 * An explicit `" "` (content, not a separator) is emitted instead,
 * so flattenForFill fuses the word onto the sibling and neither
 * fill() nor the dlist guard can start a line with it. The space
 * goes after any leading hazard marker so the marker keeps leading
 * the node's parts — resolveHazardBreak then puts the break in
 * front of the whole fused run, which is the point.
 * @param parts - Fill parts for the text node (mutated).
 * @param path - Prettier's AstPath at the current text node.
 * @param value - The node's raw value, inspected for leading
 *   whitespace that must survive as a break opportunity.
 * @param words - The node's whitespace-split words.
 */
function unshiftLeadingBoundary(
  parts: Doc[],
  path: PrintPath,
  value: string,
  words: string[],
): void {
  if (!/^\s/v.test(value)) {
    return;
  }
  if (
    isBlockSyntaxAtLineStart(words[FIRST]) &&
    hasPrecedingInlineSibling(path)
  ) {
    const index = parts[FIRST] === DLIST_HAZARD_BREAK ? NEXT : FIRST;
    // splice rather than index assignment: no-param-reassign forbids
    // writing through a parameter.
    parts.splice(index, SINGLE, [" ", parts[index]]);
    return;
  }
  parts.unshift(line);
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

// Inline nodes that CONTAIN other inline nodes. Walking past them
// is how a text node finds the block it ultimately belongs to.
const FORMATTING_SPANS = new Set(["bold", "italic", "monospace", "highlight"]);

/**
 * First source line of the block (paragraph or list item) that
 * ultimately contains this node. Walks out through any formatting
 * spans: a hazard word nested in `*…*` belongs to the paragraph's
 * line numbering, not the span's, and stopping at the span would
 * silently disable the guard for `a line\n*term:: x*`.
 *
 * Uses source positions rather than scanning earlier siblings at
 * every level: `Node.position` is required on every AST node (see
 * src/ast.ts) and is accurate inside nested spans, so one line
 * comparison replaces a recursive sibling walk that would also have
 * to reason about each ancestor's own newlines.
 * @param path - Prettier's AstPath at the current text node.
 * @returns The 1-based line the enclosing block starts on, or
 *   undefined when no ancestor block was found.
 */
function enclosingBlockStartLine(path: PrintPath): number | undefined {
  for (let depth = FIRST; ; depth += NEXT) {
    const ancestor: AnyNode | null = path.getParentNode(depth);
    if (ancestor === null) {
      return undefined;
    }
    if (!FORMATTING_SPANS.has(ancestor.type)) {
      return ancestor.position.start.line;
    }
  }
}

/**
 * How many leading words of this text node sit on the enclosing
 * BLOCK's first source line. Feeds wordsToFillParts' dlist guard: a
 * `term::` word from a later source line is plain text where it
 * stands, but would become a description-list term if reflow packed
 * it onto the block's first output line.
 * @param node - The text node being printed.
 * @param path - Prettier's AstPath at that node, used to locate the
 *   enclosing block.
 * @param words - The node's whitespace-split words, so the "no line
 *   break anywhere" answer costs no second split.
 * @returns The count of leading words still on the block's first
 *   source line; `words.length` when the whole node is on it.
 */
function firstSourceLineWordCount(
  node: TextNode,
  path: PrintPath,
  words: string[],
): number {
  if (node.position.start.line !== enclosingBlockStartLine(path)) {
    // The node itself begins on a later source line (or the block
    // could not be located, in which case guarding is the safe
    // answer): none of its words are on the block's first line.
    return EMPTY;
  }
  const firstNewline = node.value.indexOf("\n");
  if (firstNewline === NOT_FOUND) {
    return words.length;
  }
  return splitWords(node.value.slice(FIRST, firstNewline)).length;
}

/**
 * Decide how a text node's trailing `+` word must be protected
 * from landing bare at the end of an output line (where ` +`
 * becomes a hard line break). See the text case in
 * printInlineNode for the three-way rationale.
 * @param path - Prettier's AstPath at the current text node.
 * @param words - The node's whitespace-split words: a `+` that is
 *   the node's ONLY word, with nothing before it in the fill, is
 *   alone on its output line, and `+` at column 0 is not a break.
 * @returns Whether to rewrite an unglued trailing `+` to
 *   `{plus}`, and whether to glue it forward to a following
 *   inline sibling instead.
 */
function trailingPlusPolicy(
  path: PrintPath,
  words: string[],
): {
  escapeTrailingPlus: boolean;
  glueToSibling: boolean;
} {
  const followedInFill = hasFollowingInlineSibling(path);
  const startsItsOwnLine =
    words.length === SINGLE && !hasPrecedingInlineSibling(path);
  return {
    escapeTrailingPlus:
      !followedInFill && !isInsideFormattingSpan(path) && !startsItsOwnLine,
    glueToSibling: followedInFill,
  };
}

/**
 * Fuse a formatting span's marks onto its flattened children and
 * hoist any hazard marker out of the span.
 *
 * The marks must fuse onto real content: fusing the opening mark
 * onto a leading DLIST_HAZARD_BREAK would hide the marker from the
 * enclosing flatten AND put a break inside `*…*`. Re-emitting the
 * marker ahead of the span instead lets the ENCLOSING fill resolve
 * it against the separator before the span, treating the whole span
 * as the fused run the break must not enter.
 * @param parts - The span's flattened fill parts (mutated).
 * @param openMark - Text opening the span, e.g. `*` or `[.red]#`.
 * @param closeMark - Text closing the span, e.g. `*` or `#`.
 * @returns Fill parts for the span, preceded by a hoisted marker
 *   when its content began with one.
 */
function spanParts(parts: Doc[], openMark: string, closeMark: string): Doc[] {
  const hoisted = parts[FIRST] === DLIST_HAZARD_BREAK;
  if (hoisted) {
    parts.shift();
  }
  const lastIndex = parts.length + LAST_ELEMENT;
  // splice rather than index assignment: `parts` is a caller's
  // parameter, which no-param-reassign forbids writing through.
  parts.splice(FIRST, SINGLE, [openMark, parts[FIRST]]);
  parts.splice(lastIndex, SINGLE, [parts[lastIndex], closeMark]);
  return hoisted ? [DLIST_HAZARD_BREAK, ...parts] : parts;
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
      const words = splitWords(node.value);
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
      const { escapeTrailingPlus, glueToSibling } = trailingPlusPolicy(
        path,
        words,
      );
      const parts = wordsToFillParts(words, {
        escapeTrailingPlus,
        firstLineWordCount: firstSourceLineWordCount(node, path, words),
      });
      unshiftLeadingBoundary(parts, path, node.value, words);
      if (/\s$/v.test(node.value)) {
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
      return spanParts(parts, mark, mark);
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
      return spanParts(parts, `${rolePrefix}${mark}`, mark);
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
    case "rawLine": {
      return printRawLine(node, path);
    }
    case "hardLineBreak": {
      return printHardLineBreak(path);
    }
  }
}
