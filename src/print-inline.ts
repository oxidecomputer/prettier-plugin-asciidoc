/**
 * Inline node → ATOMS: turns a block's inline AST nodes (text, bold,
 * italic, monospace, highlight, attribute references, links, xrefs,
 * inline anchors, inline images, UI macros, footnotes, passthroughs,
 * raw lines and hard line breaks) into the flat atom list
 * {@link wrap} packs into output lines.
 *
 * The join between two neighbouring nodes is the whole protocol here,
 * and it is decided in ONE place: a running {@link Boundary} that each
 * node leaves behind and the next node's first atom carries. A node
 * that ends without whitespace leaves `"glue"`, so the next atom fuses
 * onto it with no space and no break — the alternation bookkeeping a
 * separator-slot representation needs has no analogue, because a join
 * is a fact ON an atom rather than an element beside it.
 *
 * Extracted from the main printer to keep file size within
 * the max-lines lint limit.
 */
import type {
  AttributeReferenceNode,
  InlineAnchorNode,
  InlineMacroNode,
  InlineNode,
  LinkNode,
  RawLineNode,
  TextNode,
  XrefNode,
  BoldNode,
  ItalicNode,
  MonospaceNode,
  HighlightNode,
} from "./ast.js";
import {
  inlineMacroToSource,
  linkToSource,
  xrefToSource,
  anchorToSource,
} from "./serialize-inline.js";
import {
  atomOf,
  type Atom,
  type BreakBefore,
  isBlockSyntaxAtLineStart,
  splitWords,
  wordsToAtoms,
} from "./reflow.js";

// The two characters a hard line break prints: the space is part of
// the syntax (`LineBreakRx` requires it), not a separator.
const HARD_BREAK_IMAGE = " +";

// A hard line break OWNS its line when nothing but whitespace
// precedes it there — which, in AST terms, means the text node in
// front of it ends with the newline that opened the line (plus any
// further indentation the token did not take).
const LINE_START_BEFORE_BREAK = /\n[ \t]*$/v;

// Siblings that do NOT share the enclosing block's packing: a raw
// line forces a break on both sides. The node before one still ENDS
// an output line, so a trailing `+` there is a hard line break and
// must be escaped, and a word after one starts a line rather than
// fusing. (Nested lists are not inline siblings — an item's `text`
// holds inline nodes only; its blocks print elsewhere.)
const OWN_LINE_SIBLINGS = new Set(["rawLine"]);

/** A formatting span: its marks ride on the atoms they touch. */
type SpanNode = BoldNode | ItalicNode | MonospaceNode | HighlightNode;

/** A construct the printer emits verbatim, never breaking inside it. */
type VerbatimNode =
  | AttributeReferenceNode
  | InlineMacroNode
  | LinkNode
  | XrefNode
  | InlineAnchorNode;

/**
 * The join between the atom just emitted and the next one.
 *
 * `"glue"` fuses with no space, `"space"` puts a space there but forbids
 * a break, `"break"` is an ordinary breakable space, and `"literal"` is
 * a mandatory break that opens its line at column 0. They are RANKED:
 * when two nodes each ask for a join, the stronger one stands — which is
 * how a raw line's mandatory break survives a neighbour's whitespace
 * asking only for a breakable space.
 */
type Boundary = "glue" | "space" | "break" | "literal";

// Weakest join first: a later index outranks an earlier one.
const BOUNDARY_ORDER: readonly Boundary[] = [
  "glue",
  "space",
  "break",
  "literal",
];

/**
 * The stronger of two joins.
 * @param left - the join already standing.
 * @param right - the join being asked for.
 * @returns whichever ranks higher.
 */
function strongerBoundary(left: Boundary, right: Boundary): Boundary {
  return BOUNDARY_ORDER.indexOf(right) > BOUNDARY_ORDER.indexOf(left)
    ? right
    : left;
}

/**
 * Stamp a join onto an atom. The atom's OWN break demand survives a
 * non-breaking join: a description-list hazard word that opens a
 * formatting span still demands its break, and {@link wrap} lifts the
 * demand to the front of the run the span belongs to.
 * @param atom - the atom the join lands on.
 * @param boundary - the join.
 * @returns the atom carrying it.
 */
function withBoundary(atom: Atom, boundary: Boundary): Atom {
  const breakBefore: BreakBefore =
    boundary === "literal" ? "literal" : atom.breakBefore;
  return {
    ...atom,
    glueLeft: boundary === "glue",
    noBreakBefore: boundary === "space",
    breakBefore,
  };
}

/** Where a node sits among its inline siblings, and in which block. */
interface Cursor {
  /** The inline siblings the node sits among. */
  readonly siblings: readonly InlineNode[];
  /** The node's index among them. */
  readonly index: number;
  /** 1-based source line the enclosing BLOCK starts on. */
  readonly blockStartLine: number;
  /**
   * Whether the node is inside a formatting span, where the closing
   * mark follows the content in the output.
   */
  readonly insideSpan: boolean;
}

/**
 * Check whether the node at `cursor` is followed by a sibling
 * that participates in the same block packing.
 * @param cursor - where the node sits.
 * @returns True when an inline sibling directly follows.
 */
function hasFollowingInlineSibling(cursor: Cursor): boolean {
  const next = cursor.siblings.at(cursor.index + 1);
  return next !== undefined && !OWN_LINE_SIBLINGS.has(next.type);
}

/**
 * Check whether the node at `cursor` is preceded by a sibling that
 * participates in the same block packing. Mirrors
 * hasFollowingInlineSibling — see OWN_LINE_SIBLINGS for what does
 * not count.
 * @param cursor - where the node sits.
 * @returns True when an inline sibling directly precedes.
 */
function hasPrecedingInlineSibling(cursor: Cursor): boolean {
  if (cursor.index <= 0) {
    return false;
  }
  const previous = cursor.siblings.at(cursor.index - 1);
  return previous !== undefined && !OWN_LINE_SIBLINGS.has(previous.type);
}

/**
 * Whether the source gave the hard line break at `cursor` a line of
 * its own.
 *
 * A break that opens the block's inline content is NOT counted:
 * there is nothing in front of it to break away from, and emitting
 * a leading break would open the block with a blank line.
 * @param cursor - where the hard line break sits.
 * @returns True when only whitespace precedes it on its line.
 */
function ownsItsLine(cursor: Cursor): boolean {
  if (cursor.index <= 0) {
    return false;
  }
  const previous = cursor.siblings.at(cursor.index - 1);
  return (
    previous?.type === "text" && LINE_START_BEFORE_BREAK.test(previous.value)
  );
}

/**
 * Collapse source line breaks inside a serialized inline
 * construct to single spaces. Bracketed text (`url[text]`,
 * `xref:t[text]`, `<<t,text>>`) may span source lines — the
 * tokenizer's `InlineMacro`/`InlineUrl` rules
 * (src/parse/inline/rules.ts) match it across `\n`. Re-emitting the
 * raw newline would make the output layout depend on the input
 * layout (breaking idempotency, issue #1) and an atom's text must be
 * newline-free for the packer to measure it.
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
 * How many leading words of this text node sit on the enclosing
 * BLOCK's first source line. Feeds wordsToAtoms' dlist guard: a
 * `term::` word from a later source line is plain text where it
 * stands, but would become a description-list term if reflow packed
 * it onto the block's first output line.
 *
 * Source positions rather than a scan of earlier siblings at every
 * level: `Node.position` is required on every AST node (see
 * src/ast.ts) and is accurate inside nested spans, so one line
 * comparison replaces a recursive sibling walk that would also have
 * to reason about each ancestor's own newlines. A hazard word nested in
 * `*…*` belongs to the paragraph's line numbering, not the span's, so
 * the line compared against is the BLOCK's — stopping at the span would
 * silently disable the guard for `a line\n*term:: x*`.
 * @param node - The text node being printed.
 * @param cursor - where the node sits, for the block's first line.
 * @param words - The node's whitespace-split words, so the "no line
 *   break anywhere" answer costs no second split.
 * @returns The count of leading words still on the block's first
 *   source line; `words.length` when the whole node is on it.
 */
function firstSourceLineWordCount(
  node: TextNode,
  cursor: Cursor,
  words: readonly string[],
): number {
  if (node.position.start.line !== cursor.blockStartLine) {
    // The node itself begins on a later source line: none of its words
    // are on the block's first line.
    return 0;
  }
  const firstNewline = node.value.indexOf("\n");
  if (firstNewline === -1) {
    return words.length;
  }
  return splitWords(node.value.slice(0, firstNewline)).length;
}

/**
 * Decide how a text node's trailing `+` word must be protected
 * from landing bare at the end of an output line (where ` +`
 * becomes a hard line break). Three cases:
 *
 * - An inline sibling follows in the same block: fuse the `+`
 *   forward to that sibling so no break can land after it. No escape —
 *   escaping would put a literal `{plus}` mid-line.
 * - No sibling follows but this text is inside a formatting span: the
 *   closing mark lands directly after the `+` in the output, so it can
 *   never end a line bare. No escape — escaping would corrupt the
 *   span's content (issue #2's `` `+` `` case).
 * - Otherwise (block-level last child, or only a raw line follows —
 *   which owns its output line): the `+` truly ends an
 *   output line, so it must be escaped.
 * @param cursor - where the text node sits.
 * @param words - The node's whitespace-split words: a `+` that is
 *   the node's ONLY word, with nothing before it in the block, is
 *   alone on its output line, and `+` at column 0 is not a break.
 * @returns Whether to rewrite an unfused trailing `+` to
 *   `{plus}`, and whether to fuse it forward to a following
 *   inline sibling instead.
 */
function trailingPlusPolicy(
  cursor: Cursor,
  words: readonly string[],
): {
  escapeTrailingPlus: boolean;
  glueToSibling: boolean;
} {
  const followedInBlock = hasFollowingInlineSibling(cursor);
  const startsItsOwnLine =
    words.length === 1 && !hasPrecedingInlineSibling(cursor);
  return {
    escapeTrailingPlus:
      !followedInBlock && !cursor.insideSpan && !startsItsOwnLine,
    glueToSibling: followedInBlock,
  };
}

/**
 * The join a text node's LEADING whitespace asks for.
 *
 * Normally a breakable space. But when the node's FIRST word would
 * become block syntax at column 0 (a fenced-code prefix, `----`,
 * `.Title`) and an inline sibling precedes it, a break there is unsafe:
 * wordsToAtoms fuses such a word onto its predecessor WITHIN a node, and
 * the same must hold ACROSS the node boundary — so the join is a space
 * that forbids a break, and the word travels in the preceding run.
 * @param cursor - where the text node sits.
 * @param words - The node's whitespace-split words.
 * @returns the join asked for.
 */
function leadingBoundary(cursor: Cursor, words: readonly string[]): Boundary {
  return isBlockSyntaxAtLineStart(words[0]) && hasPrecedingInlineSibling(cursor)
    ? "space"
    : "break";
}

/**
 * Append a text node's atoms.
 * @param out - the block's atoms so far (mutated).
 * @param boundary - the join standing in front of this node.
 * @param cursor - where the node sits.
 * @param node - the text node.
 * @returns the join this node leaves behind.
 */
function appendText(
  out: Atom[],
  boundary: Boundary,
  cursor: Cursor,
  node: TextNode,
): Boundary {
  const words = splitWords(node.value);
  // All-whitespace text nodes (e.g. " " between adjacent formatting
  // marks, or " " as sole content of a formatting span like `_# #_`).
  // They contribute no atom, only the break opportunity their
  // whitespace stands for — dropping that would fuse adjacent siblings
  // or collapse content whitespace inside formatting marks.
  if (words.length === 0) {
    return strongerBoundary(boundary, "break");
  }
  const { escapeTrailingPlus, glueToSibling } = trailingPlusPolicy(
    cursor,
    words,
  );
  const atoms = wordsToAtoms(words, {
    escapeTrailingPlus,
    firstLineWordCount: firstSourceLineWordCount(node, cursor, words),
  });
  const lead = /^\s/v.test(node.value)
    ? strongerBoundary(boundary, leadingBoundary(cursor, words))
    : boundary;
  out.push(withBoundary(atoms[0], lead), ...atoms.slice(1));
  if (!/\s$/v.test(node.value)) {
    return "glue";
  }
  // A trailing `+` with a sibling after it keeps the source's space but
  // forbids the break, so no break can land after the `+` (where ` +`
  // at end of line would become a hard line break).
  return glueToSibling && words.at(-1) === "+" ? "space" : "break";
}

/**
 * The opening and closing marks of a formatting span.
 *
 * Constrained marks (`*bold*`) require word boundaries; unconstrained
 * (`**bold**`) work anywhere, including mid-word. The AST preserves
 * which form was used so we round-trip it faithfully instead of
 * normalizing. A role attribute gives a highlight span semantic meaning
 * used by CSS, e.g. `[.red]#text#`: it is written as an inline attribute
 * list immediately before the mark, not as a block attribute list, so it
 * is emitted here and not through the block printer.
 * @param node - the span node.
 * @returns its opening and closing marks.
 */
function spanMarks(node: SpanNode): { open: string; close: string } {
  if (node.type === "highlight") {
    const mark = node.constrained ? "#" : "##";
    const rolePrefix = node.role === undefined ? "" : `[${node.role}]`;
    return { open: `${rolePrefix}${mark}`, close: mark };
  }
  const markMap = { bold: "*", italic: "_", monospace: "`" };
  const singleMark = markMap[node.type];
  const mark = node.constrained ? singleMark : `${singleMark}${singleMark}`;
  return { open: mark, close: mark };
}

/**
 * Append a formatting span's atoms: the span's content joins the
 * block's ONE flat atom list, with the marks fused onto the first and
 * last atoms so they stay adjacent to their words (required for
 * AsciiDoc constrained formatting) and the packer measures them.
 * @param out - the block's atoms so far (mutated).
 * @param boundary - the join standing in front of the span.
 * @param cursor - where the span sits.
 * @param node - the span node.
 * @returns the join the span leaves behind.
 */
function appendSpan(
  out: Atom[],
  boundary: Boundary,
  cursor: Cursor,
  node: SpanNode,
): Boundary {
  const { open, close } = spanMarks(node);
  const { atoms: inner, trailing } = collectAtoms(
    node.children,
    cursor.blockStartLine,
    true,
  );
  // The span's own whitespace lives INSIDE its marks: content whitespace
  // at either edge is a space in the output, never a break, because the
  // marks fuse onto the content they enclose. Both edges are read off
  // the joins themselves — the first atom carries the join its content
  // asked for, and `trailing` is the join the last one left behind.
  const openSpace = inner.length > 0 && inner[0].glueLeft ? "" : " ";
  const closeSpace = trailing === "glue" ? "" : " ";
  // Children that are all whitespace produce no atoms (e.g. `_# #_`
  // where highlight contains only a space). Emit the bare marks around
  // whatever whitespace they stood for. The other empty-span shape —
  // ZERO inner tokens, `____` — never arrives here: the builder's
  // adjacent-close skip (handleFormattingMark,
  // src/parse/inline/inline-node-builder.ts) refuses to build such a
  // node at all. Two conditions, two homes, both live.
  if (inner.length === 0) {
    out.push(withBoundary(atomOf(`${open}${closeSpace}${close}`), boundary));
    return "glue";
  }
  const last = inner.length - 1;
  inner[0] = { ...inner[0], text: `${open}${openSpace}${inner[0].text}` };
  inner[last] = {
    ...inner[last],
    text: `${inner[last].text}${closeSpace}${close}`,
  };
  out.push(withBoundary(inner[0], boundary), ...inner.slice(1));
  return "glue";
}

/**
 * Append a raw line — a comment, preprocessor or otherwise verbatim line
 * kept inside a paragraph.
 *
 * Such a line must start at column 0 to be one, so the joins around it
 * are LITERAL breaks: they open their line at column 0 whatever the
 * enclosing block's continuation indent is.
 *
 * A break is only demanded where a neighbour exists on that side: the
 * TRAILING one is dropped when nothing follows in this block (the block
 * joiner already supplies that break — demanding one here would open the
 * next block with a blank line), and the LEADING one when the raw line
 * is the block's first node (a paragraph that is one verbatim line —
 * the second of two adjacent `+` lines in a list item — would otherwise
 * open with a blank).
 * @param out - the block's atoms so far (mutated).
 * @param boundary - the join standing in front of the raw line.
 * @param cursor - where the raw line sits.
 * @param node - the raw line node.
 * @returns the join the raw line leaves behind.
 */
function appendRawLine(
  out: Atom[],
  boundary: Boundary,
  cursor: Cursor,
  node: RawLineNode,
): Boundary {
  const lead = cursor.index === 0 ? boundary : "literal";
  out.push(withBoundary(atomOf(node.value), lead));
  return hasFollowingInlineSibling(cursor) ? "literal" : "glue";
}

/**
 * Append a hard line break (` +` at end of a line).
 *
 * The break it forces is LITERAL, so the line after it starts at column
 * 0 regardless of the block's continuation indent — a list item's text
 * indent must not reach the line Asciidoctor reads after the `<br>`.
 *
 * A ` +` the source put alone on its line keeps that line.
 * Asciidoctor's `LineBreakRx` captures everything before the space
 * (`^(.*)[ \t]\+$`), so ` +` alone renders `<br>` with the
 * preceding line's text AND its newline intact, while `text +`
 * renders `text<br>` — joining the two lines would drop a space from
 * the rendered output. The trailing break is demanded only when an
 * inline sibling follows in the same block.
 * @param out - the block's atoms so far (mutated).
 * @param boundary - the join standing in front of the break.
 * @param cursor - where the break sits.
 * @returns the join the break leaves behind.
 */
function appendHardLineBreak(
  out: Atom[],
  boundary: Boundary,
  cursor: Cursor,
): Boundary {
  const lead = ownsItsLine(cursor) ? "literal" : boundary;
  out.push(withBoundary(atomOf(HARD_BREAK_IMAGE), lead));
  return hasFollowingInlineSibling(cursor) ? "literal" : "glue";
}

/**
 * The verbatim text of a source-preserved construct: these nodes are
 * emitted from the AST without reformatting, because their internal
 * syntax (URLs, target IDs, key combos, menu paths, etc.) is opaque to
 * the printer — changing whitespace or line breaks would alter
 * semantics or break rendering.
 * @param node - the construct.
 * @returns its one-line source text.
 */
function verbatimText(node: VerbatimNode): string {
  switch (node.type) {
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
      // Defense-in-depth: the XrefShorthand and InlineAnchor token
      // patterns exclude `\n`, so today these nodes can never contain a
      // newline — only InlineUrl and InlineMacro match across lines. The
      // collapse is kept so a future pattern change cannot silently
      // reintroduce multi-line output.
      return collapseSourceNewlines(xrefToSource(node));
    }
    case "inlineAnchor": {
      return collapseSourceNewlines(anchorToSource(node));
    }
  }
}

/**
 * Append one inline node's atoms to the block's list.
 * @param out - the block's atoms so far (mutated).
 * @param boundary - the join standing in front of this node.
 * @param cursor - where the node sits.
 * @returns the join this node leaves behind.
 */
function appendNode(out: Atom[], boundary: Boundary, cursor: Cursor): Boundary {
  const node = cursor.siblings[cursor.index];
  switch (node.type) {
    case "text": {
      return appendText(out, boundary, cursor, node);
    }
    case "bold":
    case "italic":
    case "monospace":
    case "highlight": {
      return appendSpan(out, boundary, cursor, node);
    }
    case "rawLine": {
      return appendRawLine(out, boundary, cursor, node);
    }
    case "hardLineBreak": {
      return appendHardLineBreak(out, boundary, cursor);
    }
    default: {
      out.push(withBoundary(atomOf(verbatimText(node)), boundary));
      return "glue";
    }
  }
}

/**
 * Build the atoms for a run of inline siblings.
 * @param nodes - the inline siblings, in order.
 * @param blockStartLine - 1-based source line the enclosing BLOCK
 *   starts on, for the dlist first-line guard.
 * @param insideSpan - whether these siblings sit inside a formatting
 *   span, where a closing mark follows the content.
 * @returns the atoms, in order, and the join the last one leaves behind.
 */
function collectAtoms(
  nodes: readonly InlineNode[],
  blockStartLine: number,
  insideSpan: boolean,
): { atoms: Atom[]; trailing: Boundary } {
  const out: Atom[] = [];
  let boundary: Boundary = "glue";
  for (const index of nodes.keys()) {
    boundary = appendNode(out, boundary, {
      siblings: nodes,
      index,
      blockStartLine,
      insideSpan,
    });
  }
  return { atoms: out, trailing: boundary };
}

/**
 * Convert a block's inline content to atoms.
 * @param nodes - the block's inline children, in order.
 * @param blockStartLine - 1-based source line the block starts on.
 * @returns the block's atoms, ready for {@link wrap}.
 */
export function inlineAtoms(
  nodes: readonly InlineNode[],
  blockStartLine: number,
): Atom[] {
  return collectAtoms(nodes, blockStartLine, false).atoms;
}
