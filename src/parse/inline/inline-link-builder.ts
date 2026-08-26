/**
 * Factory functions for building LinkNode, XrefNode, and
 * InlineAnchorNode from their respective tokens.
 *
 * Each public function takes one token's span — its bytes and its
 * document offset — plus the document's location index, and returns
 * the corresponding AST node with source positions. These builders
 * split strings rather than match regexes because every field they
 * extract needs its own OFFSET in the document, and computing an
 * offset from a match index is a step a split gives for free.
 */
import type {
  LinkNode,
  XrefNode,
  InlineAnchorNode,
  HardLineBreakNode,
  Location,
} from "../../ast.js";
import type { Fragment, LocationIndex } from "../positions.js";

// Number of characters in `<<`, `>>`, `[[`, or `]]`.
const BRACKET_PAIR_LEN = 2;

// ── String splitting helpers ────────────────────────────────

/**
 * Split a string at the first `[` to separate the target
 * from the bracket-enclosed display text.
 *
 * Called with either a full token image (bare-URL tokens)
 * or the already-prefix-stripped portion of a macro token
 * (link:, mailto:, xref: callers strip their prefix first).
 * The input is always expected to end with `]` when a bracket
 * is present — the trailing `]` is consumed by the slice.
 *
 * Precondition: `image` ends with `]` (guaranteed by the
 * tokenizer's InlineMacro rule, src/parse/inline/rules.ts).
 * @param image - String to split; either a full token image
 *   or the portion after a macro prefix has been removed
 * @returns Tuple of [beforeBracket, insideBracket].
 *   insideBracket is undefined only when no `[` is present
 *   (bare URL with no label, e.g. `"https://example.com"`).
 */
function splitAtBracket(image: string): [string, string | undefined] {
  const bracketIndex = image.indexOf("[");
  if (bracketIndex === -1) {
    return [image, undefined];
  }
  const before = image.slice(0, bracketIndex);
  // Slice between `[` and the final `]`.
  const inside = image.slice(bracketIndex + 1, -1);
  return [before, inside];
}

/**
 * The position of one token's span.
 * @param fragment - the token, or any span with an image and offset
 * @param at - the document's location index
 * @returns the node position, end exclusive
 */
function positionOf(
  fragment: Fragment,
  at: LocationIndex,
): { start: Location; end: Location } {
  return { start: at.start(fragment), end: at.end(fragment) };
}

// ── Public factory functions ────────────────────────────────

/**
 * Build a LinkNode from a bare-URL token.
 *
 * Handles both `https://example.com` (no display text)
 * and `https://example.com[label]` (with display text).
 * The form is always `"url"` to distinguish from the
 * explicit `link:` macro during round-trip formatting.
 * @param fragment - InlineUrl token span
 * @param at - the document's location index
 * @returns LinkNode with form `"url"`
 */
export function makeLinkFromUrl(
  fragment: Fragment,
  at: LocationIndex,
): LinkNode {
  const [target, text] = splitAtBracket(fragment.image);
  return {
    type: "link",
    form: "url",
    target,
    text: text === undefined || text.length === 0 ? undefined : text,
    position: positionOf(fragment, at),
  };
}

/**
 * Build an XrefNode from the `<<target>>` shorthand.
 *
 * Strips the `<<`/`>>` delimiters, then splits at the
 * first comma to separate target from optional display
 * text. The form is `"shorthand"` so the printer can
 * reproduce the angle-bracket syntax.
 * @param fragment - XrefShorthand token span (image wrapped in
 *   `<<` and `>>`)
 * @param at - the document's location index
 * @returns XrefNode with form `"shorthand"`
 */
export function makeXrefFromShorthand(
  fragment: Fragment,
  at: LocationIndex,
): XrefNode {
  // Strip the `<<` prefix and `>>` suffix.
  const inner = fragment.image.slice(BRACKET_PAIR_LEN, -BRACKET_PAIR_LEN);
  const commaIndex = inner.indexOf(",");
  if (commaIndex === -1) {
    return {
      type: "xref",
      form: "shorthand",
      target: inner,
      text: undefined,
      position: positionOf(fragment, at),
    };
  }
  return {
    type: "xref",
    form: "shorthand",
    target: inner.slice(0, commaIndex),
    text: inner.slice(commaIndex + 1),
    position: positionOf(fragment, at),
  };
}

/**
 * Build an InlineAnchorNode from a `[[id]]` token.
 *
 * Strips the `[[`/`]]` delimiters and splits at the
 * first comma to separate the anchor ID from optional
 * reftext (the default cross-reference display text).
 * The post-comma bytes are kept verbatim; the printer trims
 * them only when the id is valid (`anchorToSource`).
 * @param fragment - InlineAnchor token span (image wrapped in
 *   `[[` and `]]`)
 * @param at - the document's location index
 * @returns InlineAnchorNode with id and optional reftext
 */
export function makeInlineAnchor(
  fragment: Fragment,
  at: LocationIndex,
): InlineAnchorNode {
  // Strip the `[[` prefix and `]]` suffix.
  const inner = fragment.image.slice(BRACKET_PAIR_LEN, -BRACKET_PAIR_LEN);
  const commaIndex = inner.indexOf(",");
  if (commaIndex === -1) {
    return {
      type: "inlineAnchor",
      id: inner,
      reftext: undefined,
      position: positionOf(fragment, at),
    };
  }
  // The post-comma spelling is captured VERBATIM, whitespace-only
  // included: `[[id, ]]` and `[[id]]` are different author bytes, and
  // narrowing the first to the second is a respell the printer cannot
  // undo (issue #53). The printer decides the spelling from the whole
  // pair - a valid id takes the normalized `[[id, trimmed]]`, a
  // grammar-rejected one replays these bytes verbatim (anchorToSource,
  // serialize-inline.ts; pinned by tests/format/anchor-spelling.test.ts).
  return {
    type: "inlineAnchor",
    id: inner.slice(0, commaIndex),
    reftext: inner.slice(commaIndex + 1),
    position: positionOf(fragment, at),
  };
}

/**
 * Build a HardLineBreakNode from a ` +` line-ending token.
 *
 * Hard line breaks force a line break in output. They
 * are represented as standalone AST nodes (rather than
 * embedded in text) so the printer can emit the correct
 * Prettier Doc IR for line-break semantics.
 * @param fragment - HardLineBreak token span
 * @param at - the document's location index
 * @returns HardLineBreakNode with source position only
 */
export function makeHardLineBreak(
  fragment: Fragment,
  at: LocationIndex,
): HardLineBreakNode {
  return {
    type: "hardLineBreak",
    position: positionOf(fragment, at),
  };
}
