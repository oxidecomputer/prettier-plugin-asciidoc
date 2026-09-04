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

// Number of characters in `[[[` or `]]]` - the bibliography anchor's
// wider delimiter (InlineBiblioAnchorRx, rx.rb l.457).
const BRACKET_TRIPLE_LEN = 3;

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
 *
 * An EMPTY bracket group stays an empty string rather than folding
 * into `undefined`. InlineLinkRx (rx.rb l.524) lets that group's
 * interior be empty, and the group is what ENDS the target's own run
 * of characters. Fold the two spellings together and the printer
 * writes back the shorter one, at which point the URL runs on into
 * whatever stands behind it: `https://e.com[]*b*` would print as
 * `https://e.com*b*`, one link whose target swallowed the span.
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
    text,
    position: positionOf(fragment, at),
  };
}

/**
 * Build a LinkNode from a bare email-address token.
 *
 * The whole token IS the target: an address has no bracket syntax, so
 * there is nothing to split and the display text is always undefined.
 * The `mailto:` scheme Ruby prepends when it renders one
 * (`substitutors.rb`'s email arm builds `mailto:#{address}`) is NOT
 * stored: it is not in the author's bytes, and the printer writes
 * the target back verbatim.
 * @param fragment - InlineEmail token span
 * @param at - the document's location index
 * @returns LinkNode with form `"email"`
 */
export function makeLinkFromEmail(
  fragment: Fragment,
  at: LocationIndex,
): LinkNode {
  return {
    type: "link",
    form: "email",
    target: fragment.image,
    text: undefined,
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
 * Shared core of {@link makeInlineAnchor} and
 * {@link makeInlineBiblioAnchor}: strip `width` delimiter characters
 * from each end of the token image and split the interior at the
 * first comma to separate the anchor id from optional reftext (the
 * default cross-reference display text). The two anchor forms use
 * IDENTICAL id/reftext grammar - InlineAnchorRx and
 * InlineBiblioAnchorRx both spell it
 * `[#{CC_ALPHA}_:][#{CC_WORD}\-:.]*` (rx.rb l.443 and l.457) - and
 * differ only in delimiter width and the `form` tag the printer reads
 * to choose two brackets or three, so one function builds both.
 *
 * The post-comma spelling is captured VERBATIM, whitespace-only
 * included: `[[id, ]]` and `[[id]]` are different author bytes, and
 * narrowing the first to the second is a respell the printer cannot
 * undo (issue #53). The two printers this feeds read that capture
 * differently: `anchorToSource` (two-bracket) takes a valid id's
 * `[[id, trimmed]]` normalized spelling and a rejected one's bytes
 * verbatim; `bibliographyAnchorToSource` (three-bracket) NEVER
 * normalizes, because a bibliography anchor's reftext is rendered
 * text rather than an inert `xreflabel` (serialize-inline.ts states
 * why beside each; the two-bracket case is pinned by
 * tests/format/anchor-spelling.test.ts, the three-bracket case by
 * tests/format/bibliography-anchor.test.ts).
 * @param fragment - the token span, delimiters included
 * @param at - the document's location index
 * @param width - how many delimiter characters stand on each side
 *   ({@link BRACKET_PAIR_LEN} or {@link BRACKET_TRIPLE_LEN})
 * @param form - which bracket syntax the author wrote
 * @returns InlineAnchorNode with id and optional reftext
 */
function splitAnchor(
  fragment: Fragment,
  at: LocationIndex,
  width: number,
  form: InlineAnchorNode["form"],
): InlineAnchorNode {
  const inner = fragment.image.slice(width, -width);
  const commaIndex = inner.indexOf(",");
  const position = positionOf(fragment, at);
  if (commaIndex === -1) {
    return {
      type: "inlineAnchor",
      form,
      id: inner,
      reftext: undefined,
      position,
    };
  }
  return {
    type: "inlineAnchor",
    form,
    id: inner.slice(0, commaIndex),
    reftext: inner.slice(commaIndex + 1),
    position,
  };
}

/**
 * Build an InlineAnchorNode from a `[[id]]` token.
 * @param fragment - InlineAnchor token span (image wrapped in
 *   `[[` and `]]`)
 * @param at - the document's location index
 * @returns InlineAnchorNode with `form: "inline"`
 */
export function makeInlineAnchor(
  fragment: Fragment,
  at: LocationIndex,
): InlineAnchorNode {
  return splitAnchor(fragment, at, BRACKET_PAIR_LEN, "inline");
}

/**
 * Build an InlineAnchorNode from a `[[[id]]]` bibliography anchor
 * token (InlineBiblioAnchorRx, rx.rb l.457) - recognised only at the
 * start of the fragment the tokenizer was handed (rules.ts's
 * `InlineBiblioAnchor` row), which is where a list item's own text
 * begins.
 * @param fragment - InlineBiblioAnchor token span (image wrapped in
 *   `[[[` and `]]]`)
 * @param at - the document's location index
 * @returns InlineAnchorNode with `form: "bibliography"`
 */
export function makeInlineBiblioAnchor(
  fragment: Fragment,
  at: LocationIndex,
): InlineAnchorNode {
  return splitAnchor(fragment, at, BRACKET_TRIPLE_LEN, "bibliography");
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
