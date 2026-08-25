/**
 * The inline token vocabulary, as plain data.
 *
 * Fifteen kinds the tokenizer produces, in the order it tries them —
 * the SAME order the lexer it replaced (its `inlineModeTokens` array) had,
 * because that lexer is first-match-wins (there is no `longer_alt`
 * anywhere in the repository) and the order is therefore the
 * specification. Plus `RawLine`, which the tokenizer never produces:
 * the paragraph reader emits it for a line it kept verbatim inside a
 * paragraph body, and `inline-node-builder.ts` dispatches on it.
 *
 * A token carries the DOCUMENT offset of its first character and
 * nothing else about where it is: line and column come from the
 * document's one offset-to-Location index (`src/parse/positions.ts`),
 * so there is one place that knows how lines are counted.
 */

/**
 * Every kind the tokenizer can emit, in the order the rules are
 * tried. Priority is data here rather than a comment, because
 * `INLINE_RULES` is built in this order — `InlineChar` aside, which
 * is the tokenizer's else branch rather than a table row — and
 * tests/parser/inline-tokens.test.ts asserts the table's `type`s
 * against this one (minus `InlineChar`), so the two cannot drift.
 * Exported for its unit test (tests/parser/inline-tokens.test.ts); no
 * src consumer.
 * @internal
 */
export const INLINE_KINDS = [
  "BackslashEscape",
  "AttributeReference",
  "RoleAttribute",
  "InlineMacro",
  "InlineUrl",
  "XrefShorthand",
  "InlineAnchor",
  "BoldMark",
  "ItalicMark",
  "MonoMark",
  "HighlightMark",
  "HardLineBreak",
  "InlineNewline",
  "InlineText",
  "InlineChar",
] as const;

/** One of the fifteen kinds the tokenizer emits. */
export type InlineKind = (typeof INLINE_KINDS)[number];

/**
 * What an inline body is made of: the tokenizer's kinds plus
 * `RawLine`, the whole-line token the paragraph reader emits for a
 * comment or preprocessor line it kept inside a paragraph.
 */
export type InlineTokenType = InlineKind | "RawLine";

/**
 * One inline token: what it is, its exact bytes, and where it is.
 *
 * The type parameter narrows WHICH kinds a particular producer can
 * emit and defaults to all of them. `tokenizeInline` returns
 * `InlineToken<InlineKind>` because the tokenizer never produces a
 * `RawLine`; a consumer that takes both writes the bare
 * `InlineToken`.
 * @template Kind - the kinds this token may carry
 */
export interface InlineToken<Kind extends InlineTokenType = InlineTokenType> {
  /** Which kind matched. */
  readonly type: Kind;
  /** The matched source bytes, verbatim. */
  readonly image: string;
  /** Zero-based offset of the first character IN THE DOCUMENT. */
  readonly offset: number;
}
