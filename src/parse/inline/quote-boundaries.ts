/**
 * The constrained quote patterns' BOUNDARY CLASSES — the one record of
 * what may stand beside a constrained formatting mark, shared by the
 * tokenizer (`rules.ts`, deciding whether a single mark can OPEN or
 * CLOSE a span at all) and the printer (`src/print/inline.ts`,
 * deciding whether an unconstrained span may be respelled with the
 * single mark) so the two sides of the round trip cannot disagree
 * about the boundary classes.
 *
 * Everything here mirrors the constrained entries of Asciidoctor's
 * `QUOTE_SUBS` table (asciidoctor.rb l.448-464, consumed by
 * substitutors.rb l.191), transcribed one mark at a time rather than
 * generalized, the way `src/parse/line-shapes.ts` transcribes the
 * line grammar. The WORD CLASS inside those patterns is taken from
 * the installed oracle rather than from Ruby, which spells it
 * slightly differently (see {@link MARK_BOUNDARY}).
 */

/** The four span kinds a constrained mark can spell. */
export type MarkKind = "bold" | "italic" | "monospace" | "highlight";

/**
 * The characters `sub_specialchars` replaces before the quote pass
 * ever runs, and what it replaces them with.
 */
const SPECIALCHARS: Record<string, string> = {
  "<": "&lt;",
  ">": "&gt;",
  "&": "&amp;",
};

/**
 * One neighbour's text as the QUOTE pass will see it.
 *
 * `sub_specialchars` runs first (`apply_subs`'s substitution order),
 * so a source `<` is already `&lt;` by the time a constrained pattern
 * is matched — and the character actually in front of the mark is
 * then `;`, which every one of those patterns EXCLUDES. Testing the
 * source character says legal where Asciidoctor says no match, and the
 * span is destroyed: `x <**b c** y` renders
 * `&lt;<strong>b c</strong>`, while `x <*b c* y` renders `&lt;*b c*`.
 *
 * Only the LEFT clause needs this. All three entities BEGIN with `&`,
 * so a substitution can never put a word character at the head of the
 * text that FOLLOWS a span — measured for all four marks.
 * @param text - a neighbouring text node's value
 * @returns the same text with the three entities substituted
 */
export function afterSpecialchars(text: string): string {
  return text.replaceAll(/<|>|&/gv, (character) => SPECIALCHARS[character]);
}

/**
 * What may not stand immediately in FRONT of each constrained mark,
 * and immediately BEHIND it — the two clauses of Asciidoctor's own
 * constrained quote patterns (`QUOTE_SUBS`, asciidoctor.rb l.448-464),
 * transcribed one mark at a time rather than generalized:
 *
 * ```
 * strong      (^|[^\p{Word};:}])      \*(\S|\S.*?\S)\*      (?!\p{Word})
 * emphasis    (^|[^\p{Word};:}])      _(\S|\S.*?\S)_        (?!\p{Word})
 * monospaced  (^|[^\p{Word};:"'`}])  `(\S|\S.*?\S)`        (?![\p{Word}"'`])
 * mark        (^|[^\p{Word}&;:}])     #(\S|\S.*?\S)#        (?!\p{Word})
 * ```
 *
 * Monospace's two extra exclusions are the curved-quote marks: `"\``
 * opens a double curved quote and `` \`' `` closes a single one, so a
 * backtick beside a straight quote is not a monospace mark at all.
 * `a "``code``" b` renders `&#8220;<code>code</code>&#8221;`;
 * `a "`code`" b` renders `&#8220;code&#8221;`, the span gone.
 *
 * `\p{Word}` above is Ruby's spelling. The word class transcribed
 * here is the ORACLE's, `@asciidoctor/core`'s `CC_WORD`
 * (`node_modules/@asciidoctor/core/build/node/index.cjs` l.54,
 * `'\p{Alphabetic}\p{N}\p{Pc}'`): that build is what every render
 * assertion and every sweep in this repo measures against, so it is
 * the authority where the two disagree. They DO disagree: Ruby's
 * `\p{Word}` carries `\p{Nd}` where the oracle carries all of
 * `\p{N}`, so a `\p{No}` neighbour (superscript two U+00B2, one half
 * U+00BD, the fraction and super/subscript characters of ordinary
 * prose) is a word character to the oracle and not to Ruby. Reading
 * it Ruby's way destroys spans: a superscript in front of
 * `**b c**`, shortened to `*b c*`, renders the literal marks with
 * the `<strong>` gone.
 *
 * `\p{M}` and `\p{Join_Control}` are kept from Ruby's class though
 * the oracle omits them: they widen what may NOT stand beside a
 * mark, so they can only refuse a span the oracle would allow, which
 * leaves the author's own bytes in place and costs bytes, not
 * meaning.
 *
 * JavaScript's `\w` is ASCII, and the difference from either class
 * is not academic — `p **b c**éq` renders differently once the mark
 * shortens.
 */
export const MARK_BOUNDARY: Record<
  MarkKind,
  { readonly front: RegExp; readonly behind: RegExp }
> = {
  bold: {
    front: /[\p{Alphabetic}\p{M}\p{N}\p{Pc}\p{Join_Control};:\}]$/v,
    behind: /^[\p{Alphabetic}\p{M}\p{N}\p{Pc}\p{Join_Control}]/v,
  },
  italic: {
    front: /[\p{Alphabetic}\p{M}\p{N}\p{Pc}\p{Join_Control};:\}]$/v,
    behind: /^[\p{Alphabetic}\p{M}\p{N}\p{Pc}\p{Join_Control}]/v,
  },
  monospace: {
    front: /[\p{Alphabetic}\p{M}\p{N}\p{Pc}\p{Join_Control};:"'`\}]$/v,
    behind: /^[\p{Alphabetic}\p{M}\p{N}\p{Pc}\p{Join_Control}"'`]/v,
  },
  highlight: {
    // Ruby's mark clause also excludes a literal `&` in front. It is
    // not repeated here because it cannot survive
    // afterSpecialchars: a trailing `&` becomes `&amp;`, whose `;`
    // this class already excludes.
    front: /[\p{Alphabetic}\p{M}\p{N}\p{Pc}\p{Join_Control};:\}]$/v,
    behind: /^[\p{Alphabetic}\p{M}\p{N}\p{Pc}\p{Join_Control}]/v,
  },
};

// `(\S|\S.*?\S)`: the constrained content must START and END with a
// non-space - a newline counts as space - though it may hold both in
// the middle (the patterns run under /m over the joined lines).
const NON_SPACE = /\S/v;

/**
 * The character standing at `index - 1`, or undefined at the head of
 * the text. Spelled here because `at` counts a negative index from
 * the END of the string, which would answer about the last character
 * instead of about the absent one.
 * @param text - the fragment being tokenized
 * @param index - the mark's position
 * @returns the preceding character, or undefined when there is none
 */
function before(text: string, index: number): string | undefined {
  return index > 0 ? text.at(index - 1) : undefined;
}

/**
 * Whether a single mark at `index` can OPEN a constrained span - the
 * left half of Ruby's pattern, `(^|[^\p{Word};:}])` (per-mark extras
 * in {@link MARK_BOUNDARY}) plus the content's first `\S`: the
 * character AFTER an opening mark may not be whitespace, or
 * `(\S|\S.*?\S)` can never match. The preceding character is read
 * through {@link afterSpecialchars}, because `sub_specialchars` has
 * already rewritten `<` `>` `&` by the time the quote pass runs.
 * @param kind - which mark's classes to consult
 * @param text - the fragment being tokenized
 * @param index - the mark character's position in it
 * @returns whether Ruby's constrained pattern could open here
 */
export function canOpenAt(
  kind: MarkKind,
  text: string,
  index: number,
): boolean {
  const next = text.at(index + 1);
  if (next === undefined || !NON_SPACE.test(next)) return false;
  const previous = before(text, index);
  return (
    previous === undefined ||
    !MARK_BOUNDARY[kind].front.test(afterSpecialchars(previous))
  );
}

/**
 * Whether a single mark at `index` can CLOSE a constrained span - the
 * content's last `\S` (the character BEFORE a closing mark may not be
 * whitespace) plus the right half of Ruby's pattern, the negative
 * lookahead `(?!\p{Word})` (monospace adds `"` `'` and the backtick;
 * {@link MARK_BOUNDARY}). No specialchars adjustment on this side:
 * all three entities BEGIN with `&`, so the substitution can never
 * put a word character directly behind the mark.
 * @param kind - which mark's classes to consult
 * @param text - the fragment being tokenized
 * @param index - the mark character's position in it
 * @returns whether Ruby's constrained pattern could close here
 */
export function canCloseAt(
  kind: MarkKind,
  text: string,
  index: number,
): boolean {
  const previous = before(text, index);
  if (previous === undefined || !NON_SPACE.test(previous)) return false;
  const next = text.at(index + 1);
  return next === undefined || !MARK_BOUNDARY[kind].behind.test(next);
}
