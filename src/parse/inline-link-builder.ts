/**
 * Factory functions for building LinkNode, XrefNode, and
 * InlineAnchorNode from their respective lexer tokens.
 *
 * Each public function takes the raw Chevrotain token produced
 * by the inline lexer and returns the corresponding AST node
 * with source positions. String splitting is used throughout
 * instead of regex to stay within the project's lint rules
 * (no named capture groups, no unicode flags, no magic-number
 * group indices).
 */
import type { IToken } from "chevrotain";
import type {
  LinkNode,
  XrefNode,
  InlineAnchorNode,
  HardLineBreakNode,
} from "../ast.js";
import { EMPTY, FIRST, NEXT, NOT_FOUND } from "../constants.js";
import { tokenStartLocation, tokenEndLocation } from "./positions.js";

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
 * grammar's InlineMacro token pattern).
 * @param image - String to split; either a full token image
 *   or the portion after a macro prefix has been removed
 * @returns Tuple of [beforeBracket, insideBracket].
 *   insideBracket is undefined only when no `[` is present
 *   (bare URL with no label, e.g. `"https://example.com"`).
 */
function splitAtBracket(image: string): [string, string | undefined] {
  const bracketIndex = image.indexOf("[");
  if (bracketIndex === NOT_FOUND) {
    return [image, undefined];
  }
  const before = image.slice(FIRST, bracketIndex);
  // Slice between `[` and the final `]`.
  const inside = image.slice(bracketIndex + NEXT, -NEXT);
  return [before, inside];
}

/**
 * Extract start/end source positions from a Chevrotain
 * token for AST location tracking.
 * @param token - Chevrotain token with offset/line/col
 * @returns Object with `start` and `end` pointing to the
 *   first and last characters of the token in the source,
 *   ready to attach to an AST node's `position` field
 */
function positionOf(token: IToken): {
  start: ReturnType<typeof tokenStartLocation>;
  end: ReturnType<typeof tokenEndLocation>;
} {
  return {
    start: tokenStartLocation(token),
    end: tokenEndLocation(token),
  };
}

// ── Public factory functions ────────────────────────────────

/**
 * Build a LinkNode from a bare-URL token.
 *
 * Handles both `https://example.com` (no display text)
 * and `https://example.com[label]` (with display text).
 * The form is always `"url"` to distinguish from the
 * explicit `link:` macro during round-trip formatting.
 * @param token - InlineUrl token from the lexer
 * @returns LinkNode with form `"url"`
 */
export function makeLinkFromUrl(token: IToken): LinkNode {
  const [target, text] = splitAtBracket(token.image);
  return {
    type: "link",
    form: "url",
    target,
    text: text === undefined || text.length === EMPTY ? undefined : text,
    position: positionOf(token),
  };
}

/**
 * Build an XrefNode from the `<<target>>` shorthand.
 *
 * Strips the `<<`/`>>` delimiters, then splits at the
 * first comma to separate target from optional display
 * text. The form is `"shorthand"` so the printer can
 * reproduce the angle-bracket syntax.
 * @param token - XrefShorthand token (image wrapped in
 *   `<<` and `>>`)
 * @returns XrefNode with form `"shorthand"`
 */
export function makeXrefFromShorthand(token: IToken): XrefNode {
  // Strip the `<<` prefix and `>>` suffix.
  const inner = token.image.slice(BRACKET_PAIR_LEN, -BRACKET_PAIR_LEN);
  const commaIndex = inner.indexOf(",");
  if (commaIndex === NOT_FOUND) {
    return {
      type: "xref",
      form: "shorthand",
      target: inner,
      text: undefined,
      position: positionOf(token),
    };
  }
  return {
    type: "xref",
    form: "shorthand",
    target: inner.slice(FIRST, commaIndex),
    text: inner.slice(commaIndex + NEXT),
    position: positionOf(token),
  };
}

/**
 * Build an InlineAnchorNode from a `[[id]]` token.
 *
 * Strips the `[[`/`]]` delimiters and splits at the
 * first comma to separate the anchor ID from optional
 * reftext (the default cross-reference display text).
 * Leading whitespace after the comma is trimmed to match
 * the `[[id, reftext]]` convention.
 * @param token - InlineAnchor token (image wrapped in
 *   `[[` and `]]`)
 * @returns InlineAnchorNode with id and optional reftext
 */
export function makeInlineAnchor(token: IToken): InlineAnchorNode {
  // Strip the `[[` prefix and `]]` suffix.
  const inner = token.image.slice(BRACKET_PAIR_LEN, -BRACKET_PAIR_LEN);
  const commaIndex = inner.indexOf(",");
  if (commaIndex === NOT_FOUND) {
    return {
      type: "inlineAnchor",
      id: inner,
      reftext: undefined,
      position: positionOf(token),
    };
  }
  const reftext = inner.slice(commaIndex + NEXT).trimStart();
  return {
    type: "inlineAnchor",
    id: inner.slice(FIRST, commaIndex),
    reftext: reftext.length > EMPTY ? reftext : undefined,
    position: positionOf(token),
  };
}

/**
 * Build a HardLineBreakNode from a ` +` line-ending token.
 *
 * Hard line breaks force a line break in output. They
 * are represented as standalone AST nodes (rather than
 * embedded in text) so the printer can emit the correct
 * Prettier Doc IR for line-break semantics.
 * @param token - HardLineBreak token from the lexer
 * @returns HardLineBreakNode with source position only
 */
export function makeHardLineBreak(token: IToken): HardLineBreakNode {
  return {
    type: "hardLineBreak",
    position: positionOf(token),
  };
}
