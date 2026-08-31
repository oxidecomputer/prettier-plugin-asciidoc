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
 * The oracle's word class, spelled once.
 *
 * `MARK_BOUNDARY` below carries `\p{M}` and `\p{Join_Control}` on top of
 * this, kept from Ruby's CC_WORD (`\p{Word}`, asciidoctor.rb l.436)
 * because there a WIDER exclusion can only refuse a span, which costs
 * bytes and not meaning. The curved-quote patterns (curved-quotes.ts) may NOT carry
 * them: there a wider exclusion refuses a MATCH the oracle makes, which
 * loses a span the printer then reasons about wrongly. So the two
 * spellings are deliberately different and this constant is the half
 * they share.
 */
export const ORACLE_WORD_CLASS = String.raw`\p{Alphabetic}\p{N}\p{Pc}`;

/** Which curved pair spells a span: `"`...`"` or `'`...`'`. */
export type CurvedQuoteSpelling = "double" | "single";

/**
 * One row of the normal `QUOTE_SUBS` table this parser models.
 * Exported for its unit test (tests/parser/curved-quote-scan.test.ts)
 * and consumed by src/print/span-edges.ts, which reads a row's order
 * to derive what a span's neighbour looks like to the row that
 * resolves it.
 */
export type QuoteRowKey =
  | "boldUnconstrained"
  | "boldConstrained"
  | "curvedDouble"
  | "curvedSingle"
  | "monospaceUnconstrained"
  | "monospaceConstrained"
  | "italicUnconstrained"
  | "italicConstrained"
  | "highlightUnconstrained"
  | "highlightConstrained";

/**
 * The ten rows' positions, spelled as an enum rather than as literal
 * numbers beside each row below: TypeScript autonumbers an
 * initializer-free enum from its declaration order, so the sequence is
 * still "ten rows, ten indices, no arithmetic" and no member's number is
 * ever typed by hand where it could drift from a row moved above it.
 * `no-magic-numbers` exempts an enum's own initializers (`ignoreEnums`,
 * eslint.config.js) for the same reason it exempts index arithmetic:
 * this IS the one place these numbers are declared, not a place they
 * are used.
 */
enum QuoteRowOrder {
  boldUnconstrained,
  boldConstrained,
  curvedDouble,
  curvedSingle,
  monospaceUnconstrained,
  monospaceConstrained,
  italicUnconstrained,
  italicConstrained,
  highlightUnconstrained,
  highlightConstrained,
}

/**
 * Each modelled row's INDEX in `QUOTE_SUBS` and the first and last
 * character of what its replacement writes.
 *
 * `sub_quotes` runs one gsub per row over the whole text, in this order,
 * and each row sees what the earlier rows already wrote back
 * (substitutors.rb l.189-196, the table at asciidoctor.rb l.439-469). So
 * a row's boundary test is evaluated against text in which every earlier
 * row's match has become its replacement, and these two characters are
 * all a later row can see of it.
 *
 * The eight mark rows write an element, so their edges are `<` and `>`.
 * The two curved rows write `&#8220;`/`&#8221;` and `&#8216;`/`&#8217;`,
 * so their edges are `&` and `;` - and `;` is excluded on the LEFT of
 * every constrained row in the table, which is the whole of issue #74.
 *
 * MEASURED, not cited: the strings each type is converted to live in
 * `lib/asciidoctor/converter/html5.rb`, which is not one of the six
 * vendored Ruby sources, so the authority for them is the oracle's own
 * render. `x "`a`" y` renders `x &#8220;a&#8221; y` and
 * `x "`__a__`" y` renders `x &#8220;<em>a</em>&#8221; y`. The Ruby is
 * the authority for the ORDER and for the type symbols
 * (asciidoctor.rb l.446-464).
 *
 * Rows 10 and 11, superscript and subscript (asciidoctor.rb l.465-468),
 * are not modelled: they consume `^` and `~`, which no row here spells,
 * and they run after every row here. The compat table
 * (asciidoctor.rb l.471-486) is not modelled either; it is selected by a
 * document attribute this parser does not track.
 *
 * Exported for its unit test (tests/parser/curved-quote-scan.test.ts)
 * and consumed by src/print/span-edges.ts, the same way `QuoteRowKey`
 * is.
 */
export const QUOTE_ROW: Record<
  QuoteRowKey,
  {
    readonly order: number;
    readonly opensWith: string;
    readonly closesWith: string;
  }
> = {
  boldUnconstrained: {
    order: QuoteRowOrder.boldUnconstrained,
    opensWith: "<",
    closesWith: ">",
  },
  boldConstrained: {
    order: QuoteRowOrder.boldConstrained,
    opensWith: "<",
    closesWith: ">",
  },
  curvedDouble: {
    order: QuoteRowOrder.curvedDouble,
    opensWith: "&",
    closesWith: ";",
  },
  curvedSingle: {
    order: QuoteRowOrder.curvedSingle,
    opensWith: "&",
    closesWith: ";",
  },
  monospaceUnconstrained: {
    order: QuoteRowOrder.monospaceUnconstrained,
    opensWith: "<",
    closesWith: ">",
  },
  monospaceConstrained: {
    order: QuoteRowOrder.monospaceConstrained,
    opensWith: "<",
    closesWith: ">",
  },
  italicUnconstrained: {
    order: QuoteRowOrder.italicUnconstrained,
    opensWith: "<",
    closesWith: ">",
  },
  italicConstrained: {
    order: QuoteRowOrder.italicConstrained,
    opensWith: "<",
    closesWith: ">",
  },
  highlightUnconstrained: {
    order: QuoteRowOrder.highlightUnconstrained,
    opensWith: "<",
    closesWith: ">",
  },
  highlightConstrained: {
    order: QuoteRowOrder.highlightConstrained,
    opensWith: "<",
    closesWith: ">",
  },
};

// Which row each mark's UNCONSTRAINED spelling is. In the normal table
// (asciidoctor.rb l.446-464) both members of a mark's pair sit on the
// same side of the two curved rows, so one key per mark answers the
// question below for either spelling. The compat-mode table breaks that
// property (compat.insert at l.486 moves constrained emphasis ahead of
// the single curved row), but compat mode is not modeled here.
const MARK_UNCONSTRAINED_ROW: Record<MarkKind, QuoteRowKey> = {
  bold: "boldUnconstrained",
  italic: "italicUnconstrained",
  monospace: "monospaceUnconstrained",
  highlight: "highlightUnconstrained",
};

/**
 * Whether `kind`'s rows run AFTER the two curved-quote rows - that is,
 * whether a mark of this kind sees `&#8220;`/`&#8221;` (or the single
 * pair) where the source wrote a curved delimiter.
 *
 * Read off {@link QUOTE_ROW} rather than written down: strong is rows 0
 * and 1 and answers NO, the other three are rows 4 and later and answer
 * YES. Measured, and the asymmetry is exactly this:
 *
 *   x "`**a**`" y  and  x "`*a*`" y   both render <strong>
 *   x "`__a__`" y  renders <em>;  x "`_a_`" y  does not
 *
 * Consumed by {@link canOpenAt}/{@link canCloseAt} in this same file
 * and by doubled-marks.ts, which picks each unconstrained row's source
 * the same way; asserted directly by
 * tests/parser/curved-quote-scan.test.ts.
 * @param kind - the mark whose rows are being asked about
 * @returns true when the curved rewrite is already in the text
 */
export function seesCurvedRewrite(kind: MarkKind): boolean {
  return (
    QUOTE_ROW[MARK_UNCONSTRAINED_ROW[kind]].order > QUOTE_ROW.curvedSingle.order
  );
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
 *
 * Built from {@link ORACLE_WORD_CLASS} plus the two widening classes
 * above, spliced through `new RegExp` rather than spelled four times
 * over as regex literals: a literal cannot interpolate, so a shared
 * class either lives in one place or drifts, and {@link boundaryPair}
 * is what keeps it in one place while still emitting one `RegExp`
 * object per mark (the shape every caller here already expects).
 */
const MARK_BOUNDARY_WORD_CLASS = String.raw`${ORACLE_WORD_CLASS}\p{M}\p{Join_Control}`;

// The three characters monospace excludes beyond the shared word
// class, on both sides (see the pattern table above): the two curved-
// quote marks' own characters, `"` and `'`, plus the backtick itself.
const MONOSPACE_EXTRA = "\"'`";

/**
 * One mark's front/behind boundary regexes, built from the shared
 * word class plus `extra` characters this mark alone excludes.
 * @param extra - characters excluded beyond the shared word class, on
 *   both sides (monospace's `"'` and backtick; empty for the other
 *   three marks)
 * @returns the mark's front/behind regex pair
 */
function boundaryPair(extra: string): { front: RegExp; behind: RegExp } {
  return {
    front: new RegExp(
      String.raw`[${MARK_BOUNDARY_WORD_CLASS};:${extra}\}]$`,
      "v",
    ),
    behind: new RegExp(`^[${MARK_BOUNDARY_WORD_CLASS}${extra}]`, "v"),
  };
}

export const MARK_BOUNDARY: Record<
  MarkKind,
  { readonly front: RegExp; readonly behind: RegExp }
> = {
  bold: boundaryPair(""),
  italic: boundaryPair(""),
  monospace: boundaryPair(MONOSPACE_EXTRA),
  // Ruby's mark clause also excludes a literal `&` in front. It is
  // not repeated here because it cannot survive afterSpecialchars: a
  // trailing `&` becomes `&amp;`, whose `;` this class already
  // excludes.
  highlight: boundaryPair(""),
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
 *
 * The neighbour is read from `view` rather than `text` when this
 * mark's own rows run after the two curved-quote rows
 * ({@link seesCurvedRewrite}): a curved delimiter behind the mark has
 * already become `&;` by the time this mark's row is tried, and
 * `view` is `text` with exactly that rewrite applied
 * (curved-quotes.ts). `view` and `text` are always the same length,
 * so `index` means the same position in either one.
 * @param kind - which mark's classes to consult
 * @param text - the fragment being tokenized
 * @param index - the mark character's position in it
 * @param view - the fragment with the curved-quote rows' delimiters
 *   replaced by their entity's own first and last character
 * @returns whether Ruby's constrained pattern could open here
 */
export function canOpenAt(
  kind: MarkKind,
  text: string,
  index: number,
  view: string,
): boolean {
  const next = text.at(index + 1);
  if (next === undefined || !NON_SPACE.test(next)) return false;
  // The neighbour as THIS mark's row reads it. `sub_specialchars` has
  // already run (afterSpecialchars); so have the two curved-quote rows,
  // for every kind but bold, and `view` is the fragment with their
  // delimiters replaced by the entity's own first and last characters
  // (curved-quotes.ts). Both rewrites put a `;` in front of a mark that
  // follows them, which every constrained pattern excludes.
  const source = seesCurvedRewrite(kind) ? view : text;
  const previous = before(source, index);
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
 * put a word character directly behind the mark - and the masked `&`
 * a curved delimiter becomes is that same first character, so the
 * trailing neighbour is read from `view` rather than `text` when this
 * mark's own rows run after the two curved-quote rows
 * ({@link seesCurvedRewrite}). `view` and `text` are always the same
 * length, so `index` means the same position in either one.
 * @param kind - which mark's classes to consult
 * @param text - the fragment being tokenized
 * @param index - the mark character's position in it
 * @param view - the fragment with the curved-quote rows' delimiters
 *   replaced by their entity's own first and last character
 * @returns whether Ruby's constrained pattern could close here
 */
export function canCloseAt(
  kind: MarkKind,
  text: string,
  index: number,
  view: string,
): boolean {
  const previous = before(text, index);
  if (previous === undefined || !NON_SPACE.test(previous)) return false;
  const source = seesCurvedRewrite(kind) ? view : text;
  const next = source.at(index + 1);
  return next === undefined || !MARK_BOUNDARY[kind].behind.test(next);
}
