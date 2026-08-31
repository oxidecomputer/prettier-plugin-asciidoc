/**
 * Flat token stream → InlineNode[] builder.
 *
 * Takes the merged, sorted inline token stream of one paragraph body
 * and turns it into nodes. WHICH marks pair into spans is decided
 * before this walk begins, by `resolveSpans` (span-pairing.ts), in
 * Asciidoctor's own `QUOTE_SUBS` row order; this file turns each
 * resolved span into its node and dispatches the atomic tokens
 * (links, macros) through a map-based dispatch table.
 *
 * A token carries only its bytes and its document offset, so line
 * and column come from the document's one location index, handed in
 * as `at`.
 */
import type {
  InlineNode,
  InlineMacroNode,
  PassthroughNode,
  RawLineNode,
  TextNode,
  BoldNode,
  ItalicNode,
  MonospaceNode,
  HighlightNode,
  CurvedQuoteNode,
  AttributeReferenceNode,
} from "../../ast.js";
import type { Fragment, LocationIndex } from "../positions.js";
import { DELIM_WIDTH } from "../../constants.js";
import type { InlineToken, InlineTokenType } from "./tokens.js";
import {
  resolveSpans,
  spanStart,
  type MarkSpanTokenKind,
  type ResolvedSpan,
} from "./span-pairing.js";
import {
  makeLinkFromUrl,
  makeLinkFromEmail,
  makeXrefFromShorthand,
  makeInlineAnchor,
  makeInlineBiblioAnchor,
  makeHardLineBreak,
} from "./inline-link-builder.js";

// Map from mark token kind to AST node type. `satisfies` is what ties
// it to the resolution table: a fifth mark kind added there fails to
// compile here until it is given a node type.
const MARK_TO_TYPE = {
  BoldMark: "bold",
  ItalicMark: "italic",
  MonoMark: "monospace",
  HighlightMark: "highlight",
} as const satisfies Record<MarkSpanTokenKind, string>;

/**
 * Build a TextNode from accumulated pending text.
 *
 * Adjacent non-structural tokens are coalesced into a single
 * text run. The position spans from the first contributing
 * token to the last, preserving source locations for the
 * printer's whitespace decisions.
 * @param value - The concatenated text content.
 * @param first - First token that contributed to this text.
 * @param last - Last token that contributed to this text.
 * @param at - The document's location index.
 * @returns A TextNode with the coalesced value and spanning
 *   position.
 */
function makeTextNode(
  value: string,
  first: Fragment,
  last: Fragment,
  at: LocationIndex,
): TextNode {
  return {
    type: "text",
    value,
    position: { start: at.start(first), end: at.end(last) },
  };
}

// Parameters for makeFormattingNode.
interface FormattingNodeOptions {
  markType: MarkSpanTokenKind;
  constrained: boolean;
  children: InlineNode[];
  openMark: Fragment;
  closeMark: Fragment;
  at: LocationIndex;
}

/**
 * Create a formatting AST node (bold, italic, monospace, or
 * highlight without a role).
 *
 * A single factory for all four formatting types avoids
 * duplicating the shared position/constrained/children
 * logic. The switch on the resolved type name ensures each
 * variant gets the correct discriminant for the AST union: the
 * four arms look identical because a spread with a UNION-typed
 * `type` does not narrow to a union member, so each member needs
 * its own literal — a TypeScript price, not a drifting spelling.
 * @param options - Mark type, constraint level, children,
 *   and the open/close mark tokens for position tracking.
 * @returns The typed formatting node for the AST.
 */
function makeFormattingNode(
  options: FormattingNodeOptions,
): BoldNode | ItalicNode | MonospaceNode | HighlightNode {
  const { markType, constrained, children, openMark, closeMark, at } = options;
  const type = MARK_TO_TYPE[markType];
  const position = { start: at.start(openMark), end: at.end(closeMark) };
  const base = { constrained, children, position };
  switch (type) {
    case "bold": {
      return { type, ...base };
    }
    case "italic": {
      return { type, ...base };
    }
    case "monospace": {
      return { type, ...base };
    }
    case "highlight": {
      return { type, role: undefined, ...base };
    }
  }
}

/**
 * Build an AttributeReferenceNode from a `{name}` token.
 *
 * Attribute references are resolved at render time by
 * Asciidoctor, so the AST preserves them verbatim. The
 * curly braces are stripped to extract just the attribute
 * name for the AST node.
 * @param fragment - The `{name}` token's span.
 * @param at - The document's location index.
 * @returns An AttributeReferenceNode with the extracted
 *   attribute name and source position.
 */
function makeAttributeReference(
  fragment: Fragment,
  at: LocationIndex,
): AttributeReferenceNode {
  return {
    type: "attributeReference",
    name: fragment.image.slice(DELIM_WIDTH, -DELIM_WIDTH),
    position: { start: at.start(fragment), end: at.end(fragment) },
  };
}

/**
 * The spans resolved INSIDE another one, re-based onto the content
 * slice the recursion is about to walk.
 *
 * A span's indices only mean anything against the stream they were
 * resolved from, and the recursion hands its child a slice; shifting
 * them here is what lets the whole paragraph be resolved ONCE, before
 * any recursion, which is the only way the order can be Ruby's
 * (span-pairing.ts resolves a row over the whole text, as `sub_quotes`
 * does).
 * @param spans - every span of the current stream.
 * @param outer - the span being descended into.
 * @param base - index of its first content token, the shift amount.
 * @returns the spans strictly inside it, in the same order.
 */
function innerSpans(
  spans: readonly ResolvedSpan[],
  outer: ResolvedSpan,
  base: number,
): ResolvedSpan[] {
  return spans
    .filter((span) => spanStart(span) >= base && span.close < outer.close)
    .map((span) => ({
      type: span.type,
      open: span.open - base,
      close: span.close - base,
      role: span.role === undefined ? undefined : span.role - base,
    }));
}

/**
 * Build the node one resolved span stands for, recursing into the
 * tokens between its marks.
 *
 * A role-carrying highlight is built from a LITERAL here rather than
 * through {@link makeFormattingNode} even though the shape matches:
 * this literal spells the keys `type, constrained, role, children,
 * position`, the factory's highlight arm spells `type, role,
 * constrained, children, position`, and serialization order is a
 * contract — unifying them would move keys on every `[.role]#x#`
 * document.
 *
 * The switch on `span.type` is the completeness gate for the whole
 * resolved-span vocabulary: a kind added to `RESOLUTION_ORDER`
 * (span-pairing.ts) fails to compile here until it is given a node.
 * @param tokens - the stream the span was resolved from.
 * @param spans - every span of that stream, for the recursion.
 * @param span - the span to build.
 * @param at - The document's location index.
 * @returns the span's node, children and position included.
 */
function makeSpanNode(
  tokens: readonly InlineToken[],
  spans: readonly ResolvedSpan[],
  span: ResolvedSpan,
  at: LocationIndex,
): InlineNode {
  const base = span.open + 1;
  const openMark = tokens[span.open];
  const closeMark = tokens[span.close];
  // Span content: no trailing-newline strip (see buildFromTokens).
  const children = buildNodes(
    tokens.slice(base, span.close),
    innerSpans(spans, span, base),
    at,
  );
  switch (span.type) {
    case "BoldMark":
    case "ItalicMark":
    case "MonoMark":
    case "HighlightMark": {
      const constrained = openMark.image.length === DELIM_WIDTH;
      // A span carrying a role is a HIGHLIGHT, and this branch never
      // asks the span's own kind before saying so. What makes that
      // safe lives in another file: the RoleAttribute rule is
      // `/\[[^\]]+\](?=#)/v` (rules.ts), and that lookahead means a
      // role token can only ever be emitted directly in front of a
      // HighlightMark - never in front of a curved-quote mark, whose
      // DoubleQuoteMark/SingleQuoteMark case sits below as its own
      // switch arm, so this branch IS gated on `span.type` already.
      // The restriction is OURS, not Asciidoctor's - Ruby's
      // `QuoteAttributeListRxt` group sits inside all twelve quote
      // rows, so `[ _a_ ]*x*` really renders
      // `<strong class="...">x</strong>` while we print the brackets
      // as text, and `[role]"`a`" y` the same way: the bracket is
      // never tokenized as RoleAttribute (no `#` follows it), so it
      // prints as literal text in front of the curved span.
      if (span.role !== undefined) {
        const roleToken = tokens[span.role];
        const highlightNode: HighlightNode = {
          type: "highlight",
          constrained,
          role: roleToken.image.slice(DELIM_WIDTH, -DELIM_WIDTH),
          children,
          position: { start: at.start(roleToken), end: at.end(closeMark) },
        };
        return highlightNode;
      }
      return makeFormattingNode({
        markType: span.type,
        constrained,
        children,
        openMark,
        closeMark,
        at,
      });
    }
    case "DoubleQuoteMark":
    case "SingleQuoteMark": {
      const curvedNode: CurvedQuoteNode = {
        type: "curvedQuote",
        quote: span.type === "DoubleQuoteMark" ? "double" : "single",
        children,
        position: { start: at.start(openMark), end: at.end(closeMark) },
      };
      return curvedNode;
    }
  }
}

/**
 * The spans of one stream that no other span of it encloses — the
 * ones this walk emits directly, each of which carries the rest
 * inside it.
 *
 * `resolveSpans` returns its spans start-ascending, which for properly
 * nested spans puts an enclosing one in front of everything inside it,
 * so one forward pass with a high-water mark is enough: a span
 * starting behind the furthest close seen so far is inside something
 * already emitted.
 * @param spans - every span of the stream, start-ascending.
 * @returns the top-level ones, in source order.
 */
function outermostSpans(spans: readonly ResolvedSpan[]): ResolvedSpan[] {
  const top: ResolvedSpan[] = [];
  let reach = -1;
  for (const span of spans) {
    if (spanStart(span) > reach) {
      top.push(span);
      reach = span.close;
    }
  }
  return top;
}

/**
 * Build an InlineMacroNode from a unified `InlineMacro` token.
 *
 * Splits the token image at the first `:` (name) and first `[`
 * (target vs attrlist boundary). All `name:target[attrlist]`
 * inline macros share this same structure, so one builder
 * replaces the previous ten per-macro factories.
 * @param fragment - The InlineMacro token's span.
 * @param at - The document's location index.
 * @returns An InlineMacroNode with name, target, and attrlist.
 */
function makeInlineMacro(
  fragment: Fragment,
  at: LocationIndex,
): InlineMacroNode {
  const colonIndex = fragment.image.indexOf(":");
  const bracketIndex = fragment.image.indexOf("[");
  return {
    type: "inlineMacro",
    name: fragment.image.slice(0, colonIndex),
    target: fragment.image.slice(colonIndex + 1, bracketIndex),
    attrlist: fragment.image.slice(bracketIndex + 1, -1),
    position: { start: at.start(fragment), end: at.end(fragment) },
  };
}

/**
 * Build a PassthroughNode from a `+text+` / `++text++` / `+++text+++`
 * token.
 *
 * The whole image is the value, delimiters included: Asciidoctor
 * extracts the construct before any other substitution runs
 * (`extract_passthroughs`, substitutors.rb l.1018), so there is
 * nothing inside it for the
 * formatter to read, and re-emitting the author's own bytes is the
 * only spelling guaranteed to render the same.
 * @param fragment - The Passthrough token's span.
 * @param at - The document's location index.
 * @returns A PassthroughNode carrying the verbatim source.
 */
function makePassthroughNode(
  fragment: Fragment,
  at: LocationIndex,
): PassthroughNode {
  return {
    type: "passthrough",
    value: fragment.image,
    position: { start: at.start(fragment), end: at.end(fragment) },
  };
}

// Map from token kind to factory function for atomic
// (single-token) inline nodes, avoiding a long if/else chain.
type AtomicFactory = (fragment: Fragment, at: LocationIndex) => InlineNode;

// The kinds {@link buildNodes}'s own loop handles WITHOUT a factory:
// the raw line and the role attribute have branches of their own, the
// four marks pair into spans, a newline becomes `\n`, and the rest
// accumulate as plain text.
type LoopHandledKind =
  | "RawLine"
  | "RoleAttribute"
  | "BoldMark"
  | "ItalicMark"
  | "DoubleQuoteMark"
  | "SingleQuoteMark"
  | "MonoMark"
  | "HighlightMark"
  | "InlineNewline"
  | "InlineText"
  | "InlineChar"
  | "BackslashEscape";

// Everything left: the kinds that MUST have a factory below.
type AtomicKind = Exclude<InlineTokenType, LoopHandledKind>;

// The `satisfies` is the completeness gate, and it is the reason the
// table is an object rather than the pair array it used to be. A kind
// added to INLINE_KINDS (tokens.ts) and to neither list here fails to
// compile - where before it would silently become a TEXT node,
// because `handleAtomicToken` reads a missing key as "fall through to
// plain text". Both directions are checked: a missing key and a key
// that names no kind are each an error.
const ATOMIC_DISPATCH = new Map<string, AtomicFactory>(
  Object.entries({
    AttributeReference: makeAttributeReference,
    InlineMacro: makeInlineMacro,
    InlineUrl: makeLinkFromUrl,
    InlineEmail: makeLinkFromEmail,
    XrefShorthand: makeXrefFromShorthand,
    InlineBiblioAnchor: makeInlineBiblioAnchor,
    InlineAnchor: makeInlineAnchor,
    HardLineBreak: makeHardLineBreak,
    Passthrough: makePassthroughNode,
  } satisfies Record<AtomicKind, AtomicFactory>),
);

/**
 * Dispatch an atomic (single-token) inline node through
 * the ATOMIC_DISPATCH map.
 *
 * Atomic tokens represent self-contained constructs like
 * links, xrefs, macros, and attribute references. Each
 * maps to a dedicated factory function. Returns undefined
 * for unrecognized token types, signaling the caller to
 * fall through to plain text accumulation.
 * @param token - The token to dispatch.
 * @param at - The document's location index.
 * @returns The built InlineNode, or undefined if the
 *   token type has no registered factory.
 */
function handleAtomicToken(
  token: InlineToken,
  at: LocationIndex,
): InlineNode | undefined {
  const factory = ATOMIC_DISPATCH.get(token.type);
  return factory === undefined ? undefined : factory(token, at);
}

/**
 * Build a RawLineNode from a whole-line RawLine token.
 *
 * The node exists so the printer can re-emit the line verbatim on a
 * line of its own; it is deliberately NOT a TextNode, which would be
 * reflowed into the surrounding words and turn a comment into visible
 * prose.
 * @param fragment - The RawLine token's span (the whole line).
 * @param at - The document's location index.
 * @returns A RawLineNode spanning exactly that line.
 */
function makeRawLineNode(fragment: Fragment, at: LocationIndex): RawLineNode {
  return {
    type: "rawLine",
    value: fragment.image,
    position: { start: at.start(fragment), end: at.end(fragment) },
  };
}

/**
 * Drop a trailing newline from a pending text run.
 * @param pending - Text accumulated so far.
 * @returns The text without its final `\n`, unchanged when there
 *   is none.
 */
function withoutTrailingNewline(pending: string): string {
  return pending.endsWith("\n") ? pending.slice(0, -1) : pending;
}

/**
 * Skip a newline token sitting at `index` — the one that terminates
 * a raw line, which the RawLineNode's own output break replaces.
 * @param tokens - The token stream being processed.
 * @param index - Position just after the raw line.
 * @returns The index to resume from.
 */
function skipStructuralNewline(
  tokens: readonly InlineToken[],
  index: number,
): number {
  return index < tokens.length && tokens[index].type === "InlineNewline"
    ? index + 1
    : index;
}

/**
 * After a hard line break (`+`), skip the structural
 * InlineNewline that follows.
 *
 * A hard line break token is always followed by a newline
 * in the source, but the HardLineBreakNode already
 * represents that break. Without this skip, the newline
 * would be double-counted as both a break and a `\n` text
 * node.
 * @param node - The node just built (checked for type).
 * @param tokens - The token stream being processed.
 * @param index - Current position after the hard break.
 * @returns The index to resume from — advanced by one if
 *   a newline was skipped, unchanged otherwise.
 */
function skipNewlineAfterHardBreak(
  node: InlineNode,
  tokens: readonly InlineToken[],
  index: number,
): number {
  const isHardBreakFollowedByNewline =
    node.type === "hardLineBreak" &&
    index < tokens.length &&
    tokens[index].type === "InlineNewline";
  return isHardBreakFollowedByNewline ? index + 1 : index;
}

/**
 * The BLOCK-LEVEL entry: strip the trailing InlineNewline runs, then
 * build.
 *
 * The strip belongs to this entry alone. The newline that ends a
 * BLOCK's last line is structure - the reader's line boundary, never
 * inline content - but the same walk also builds SPAN content
 * ({@link makeSpanNode} recurses back into it), and there a trailing
 * newline is content the oracle keeps: `sub_quotes` matches across
 * the joined lines and carries the `\n` into the span verbatim
 * (substitutors.rb l.189-196), where it renders as
 * whitespace. Stripping on recursion is what issue #55 measured as
 * `"x\n** b\n** c\n"` printing `"x ** b** c\n"` - the span's break
 * was gone before the printer could replay it as the space the
 * one-line spelling has.
 * @param allTokens - Flat, offset-sorted token stream
 *   from the inline tokenizer.
 * @param at - The document's location index.
 * @returns The built array of InlineNode AST nodes.
 */
export function buildFromTokens(
  allTokens: readonly InlineToken[],
  at: LocationIndex,
): InlineNode[] {
  const { length: tokenCount } = allTokens;
  let end = tokenCount;
  while (end > 0 && allTokens[end - 1].type === "InlineNewline") {
    end -= 1;
  }
  const body = end < tokenCount ? allTokens.slice(0, end) : allTokens;
  // ONE resolution for the whole body, before any recursion: a
  // `QUOTE_SUBS` row is a gsub over the whole text, so which spans a
  // row wins cannot be decided a slice at a time.
  return buildNodes(body, resolveSpans(body), at);
}

/**
 * Walk the flat, sorted token stream and build
 * InlineNode[].
 *
 * The spans are already resolved and properly nested when this runs,
 * so the walk only has to step over each one and recurse into its
 * content. Tokens that don't match any structural category are
 * coalesced into text runs.
 *
 * The function delegates to handler functions that each
 * own one token category (formatting spans, atomic macros/links,
 * plain text).
 * @param tokens - Flat, offset-sorted token stream: a whole block's
 *   (via {@link buildFromTokens}) or one span's content.
 * @param spans - the spans resolved over THAT stream, with indices
 *   into it.
 * @param at - The document's location index.
 * @returns The built array of InlineNode AST nodes.
 */
function buildNodes(
  tokens: readonly InlineToken[],
  spans: readonly ResolvedSpan[],
  at: LocationIndex,
): InlineNode[] {
  const nodes: InlineNode[] = [];
  const top = outermostSpans(spans);
  let pendingText = "";
  let pendingStart: InlineToken | undefined = undefined;
  let pendingEnd: InlineToken | undefined = undefined;
  let index = 0;
  let spanIndex = 0;

  /** Flush accumulated plain text into a TextNode. */
  function flushText(): void {
    if (
      pendingText.length > 0 &&
      pendingStart !== undefined &&
      pendingEnd !== undefined
    ) {
      nodes.push(makeTextNode(pendingText, pendingStart, pendingEnd, at));
      pendingText = "";
      pendingStart = undefined;
      pendingEnd = undefined;
    }
  }

  /**
   * Accumulate a token's text into the pending run.
   *
   * `text` may differ from `token.image` for newlines,
   * which are normalized to `\n` regardless of source image.
   * @param token - Source token (used for position
   *   tracking).
   * @param text - The text to append.
   */
  function accumulate(token: InlineToken, text: string): void {
    pendingStart ??= token;
    pendingEnd = token;
    pendingText += text;
  }

  while (index < tokens.length) {
    // A span that begins here was resolved before this walk started,
    // marks and extent already decided (span-pairing.ts), so the walk
    // does not look for one: it steps over the whole span and lets
    // the recursion inside {@link makeSpanNode} take the content.
    //
    // `spanIndex` only ever advances when `index` LANDS on a span's
    // first token, so a jump past one would strand it and lose every
    // later span. The two jumps below cannot do that: both skip an
    // InlineNewline and nothing else, and a span starts on a mark or
    // a RoleAttribute.
    const span = top.at(spanIndex);
    if (span !== undefined && spanStart(span) === index) {
      flushText();
      nodes.push(makeSpanNode(tokens, spans, span, at));
      index = span.close + 1;
      spanIndex += 1;
      continue;
    }

    const token = tokens[index];
    const { type } = token;

    // A raw line owns its output line, so the newlines that bound
    // it are structural: the one that ended the previous line was
    // accumulated into the pending text and is trimmed off here,
    // and the one that ends the raw line is skipped below. Leaving
    // them in would put stray "\n" into text runs; the printer's
    // atoms are newline-free by contract (src/print/reflow.ts, Atom).
    if (type === "RawLine") {
      pendingText = withoutTrailingNewline(pendingText);
      flushText();
      nodes.push(makeRawLineNode(token, at));
      index = skipStructuralNewline(tokens, index + 1);
      continue;
    }

    // Atomic single-token nodes: attribute references,
    // links, xrefs, inline anchors, macros.
    const atomicNode = handleAtomicToken(token, at);
    if (atomicNode !== undefined) {
      flushText();
      nodes.push(atomicNode);
      index += 1;
      // After a hard line break, skip the structural
      // InlineNewline that follows — the HardLineBreakNode
      // already represents the line break.
      index = skipNewlineAfterHardBreak(atomicNode, tokens, index);
      continue;
    }

    // InlineNewline → \n, everything else → literal image. A mark
    // and a `[role]` that no resolved span claimed arrive here: they
    // are the bytes the author wrote and nothing more.
    accumulate(token, type === "InlineNewline" ? "\n" : token.image);
    index += 1;
  }

  flushText();
  return nodes;
}
