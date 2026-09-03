/**
 * The inline passthrough, matched as ONE unit.
 *
 * Asciidoctor pulls passthroughs OUT of the line before any other
 * substitution runs: `apply_subs` calls `extract_passthroughs`
 * (substitutors.rb l.1018) first, replacing each one with a
 * placeholder, and only then applies specialcharacters, quotes,
 * attributes, replacements and macros to what is left. Everything
 * between the delimiters is therefore invisible to the quote pass -
 * `+*not bold*+` renders the asterisks - and the formatter has to
 * read it the same way or its reflow rules will act on marks the
 * oracle never sees. That is the whole reason this module exists: a
 * passthrough is ONE token carrying its own bytes, so nothing
 * downstream can look inside it.
 *
 * Two of Asciidoctor's three delimiter-spelled forms live here:
 *
 * - the UNCONSTRAINED macro form `++text++` / `+++text+++` /
 *   `$$text$$` (`InlinePassMacroRx`, rx.rb l.597), which takes no
 *   boundary test at all and is extracted FIRST (substitutors.rb
 *   l.1021);
 * - the CONSTRAINED form `+text+` (`InlinePassRx[false]`, rx.rb
 *   l.583), extracted second (substitutors.rb l.1075), which does.
 *
 * The order matters and is Ruby's: `+++raw+++` read constrained-first
 * would match `+++raw+` and leave a stray `++` behind.
 *
 * `$$text$$` is the unconstrained row's THIRD delimiter, not a form
 * of its own: one alternation `(\+\+\+?|\$\$)` offers all three and
 * the closer is a backreference to whichever opened, so `$$a+++b$$`
 * is one passthrough holding `a+++b` and `+++a$$b+++` is one holding
 * `a$$b`. Which one wins where they abut is decided by nothing but
 * position - `gsub` takes the leftmost match start - so the
 * first-match-wins tokenizer reaches the same answer by walking left
 * to right.
 *
 * The third form, `pass:[text]`, is a named macro and already has a
 * rule of its own (`InlineMacro` in rules.ts).
 *
 * WHAT THE CONSTRAINED PATTERN REALLY SAYS. The pinned oracle spells
 * `InlinePassRx[false]` (`@asciidoctor/core` 4.0.11,
 * `node_modules/@asciidoctor/core/build/node/index.cjs` l.666-681,
 * `m` flag) as
 *
 * ```
 * ((?:^|[^CC_WORD;:\\])(?=(\[)|\+)|\\(?=\[)|(?=\\\+))
 * (?:\2(x-|[^\[\]]+ x-)\]|(?:\[([^\[\]]+)\])?(?=(\\)?\+))
 * (\5?(\+|`)(\S|\S[\s\S]*?\S)\7)(?!CG_WORD)
 * ```
 *
 * with `CC_WORD = \p{Alphabetic}\p{N}\p{Pc}` (l.54). Four branches of
 * that are deliberately NOT implemented, each because leaving the
 * shape on the ordinary text path prints the same bytes:
 *
 * 1. The two ESCAPE alternatives of group 1 (`\\(?=\[)` and
 *    `(?=\\\+)`) with group 5's optional `(\\)?`. To Ruby, `\+a+` and
 *    `\[x-]+a+` are MATCHES whose backslash is stripped and whose
 *    delimiters then print literally. Here the backslash is excluded
 *    from the front class instead, so an escaped passthrough is
 *    refused and stays TEXT - a different reading of the same line,
 *    reaching the same bytes. What makes that equivalence hold even
 *    where the interior carries a mark is the glued-`+` rule in
 *    `trailingPlusPolicy` (src/print/inline.ts): the trailing
 *    delimiter of `\+*b*+` lands hard against the span it follows, so
 *    it is not escaped, and the line comes back out as the author
 *    wrote it. Measured render-equal to the oracle's
 *    `+<strong>b</strong>+` for `\+*b*+`, `` \+`c`+ ``, `\+{attr}+`
 *    and `\[x-]+*b*+`. The reading is Ruby's outcome, not Ruby's
 *    route, which is why the branches are named here rather than
 *    implemented.
 * 2. The `x-` back-reference alternative `\2(x-|[^\[\]]+ x-)\]`, the
 *    legacy monospaced spelling. Its two shapes, `[x-]+text+` and
 *    `[foo x-]+text+`, are both matched by the ordinary attrlist
 *    alternative below, so one alternative covers what Ruby writes as
 *    two.
 * 3. The BACKTICK format mark group 7 allows beside `+`, reachable
 *    only behind an attrlist (`[x-]`text``). Refusing it leaves the
 *    author's bytes alone and costs only the chance to reflow around
 *    them.
 * 4. Group 1's `^`, which under `m` matches at every line start. A
 *    newline is outside the front class anyway, so the class test
 *    below answers for both.
 */

// `CC_WORD` as the pinned oracle spells it (`index.cjs` l.54-68: the
// class on the first line, applied with the `u` flag by the build's
// regexp helper on the last, so the properties are real).
// Transcribed EXACTLY, with no widening. quote-boundaries.ts adds
// `\p{M}` and `\p{Join_Control}` to its own copy, on the argument
// that a wider class can only refuse a span and refusing a span
// leaves the text alone. That argument does NOT hold here: refusing a
// passthrough does not leave its bytes alone, it drops the construct
// back on the text path, where the closing `+` becomes a lone word
// and `escapeDanglingPlus` (src/print/reflow.ts) rewrites it to
// `{plus}`. Measured on the DECOMPOSED spelling macOS produces - a
// combining acute is `\p{M}`, not `\p{Alphabetic}`, `\p{N}` or
// `\p{Pc}`, so the oracle reads `café+*chaud*+` as a
// passthrough while a widened class refuses it and prints
// `café+*chaud*{plus}`: the exact issue-#25 corruption, put
// back by the widening. Same for a zero-width non-joiner or joiner
// (`\p{Join_Control}`) in front of the delimiter.
const WORD = String.raw`\p{Alphabetic}\p{N}\p{Pc}`;

// `QuoteAttributeListRxt` (`index.cjs` l.59), the attrlist both pass
// patterns take: `\[([^\[\]]+)\]`. The inner class refuses a NESTED
// `[` as well as the closing `]`, so `[a[b]+*x*+` is `[a[b]` as text
// plus the passthrough `+*x*+`, not one construct.
const ATTRLIST = String.raw`\[[^\[\]]+\]`;

// `(?:(?:(\\?)\[([^\[\]]+)\])?(\\{0,2})(\+\+\+?|\$\$)(#{CC_ALL}*?)\4|…)`
// - InlinePassMacroRx (rx.rb l.597, the same three delimiters in the
// oracle at `index.cjs` l.726-728) with its `pass:` arm dropped, that
// arm being the InlineMacro rule's. `\+\+\+?` prefers the longer
// boundary and the closer is a backreference, so each length is its
// own alternative here, longer first; `\$\$` is a third, and its
// order among them is immaterial because no two of the three share a
// first character. No boundary condition of any kind: this form is
// unconstrained, which is why `C++ and D++` renders `C and D` and
// `C$$D` renders `C$$D` only because nothing closes it.
//
// The content group is `*?`, not `+?`: it may be EMPTY, so `++++` and
// `$$$$` are both passthroughs holding nothing.
const UNCONSTRAINED = new RegExp(
  String.raw`(?:${ATTRLIST})?(?:\+\+\+[\s\S]*?\+\+\+|\+\+[\s\S]*?\+\+|\$\$[\s\S]*?\$\$)`,
  "vy",
);

// `(?:\[([^\[\]]+)\])?(\+)(\S|\S#{CC_ALL}*?\S)\2(?!#{CG_WORD})` - the
// tail of the pattern quoted above, restricted to the `+` format
// mark. The content must begin and end with a non-space and may hold
// anything in between, newlines included (Ruby matches under `/m`).
const CONSTRAINED = new RegExp(
  String.raw`(?:${ATTRLIST})?\+(?:\S|\S[\s\S]*?\S)\+(?![${WORD}])`,
  "vy",
);

// `[^#{CC_WORD};:\\]` - the character the pattern consumes in front
// of a constrained passthrough. NO specialchars adjustment on this
// side, unlike the constrained QUOTE marks (quote-boundaries.ts):
// passthroughs are extracted BEFORE `sub_specialchars` runs, so the
// character Ruby tests here is the author's own. `<+a+>` is a
// passthrough; `<*a*>` is not bold.
const NO_OPEN_EXTRAS = String.raw`;:\\`;
const NO_OPEN_AFTER = new RegExp(`[${WORD}${NO_OPEN_EXTRAS}]`, "v");

// The three characters a passthrough can begin with: either
// delimiter, or the `[` of the attrlist in front of one. Checked
// before either pattern runs, so the rule costs one character
// comparison at the overwhelming majority of positions.
const OPENERS = new Set(["+", "$", "["]);

/**
 * Whether a constrained passthrough may OPEN at `index` - Ruby's
 * `(?:^|[^CC_WORD;:\\])` clause, read off the fragment the tokenizer
 * was handed. Index 0 is a boundary because Ruby's `^` matches there,
 * and so is a position after a newline for the same reason; a newline
 * is outside the excluded class anyway, so the class test answers
 * both.
 * @param text - the fragment being tokenized
 * @param index - where the passthrough would start
 * @returns whether the preceding character admits an opening
 */
function canOpenAt(text: string, index: number): boolean {
  if (index === 0) {
    return true;
  }
  const previous = text.at(index - 1);
  return previous === undefined || !NO_OPEN_AFTER.test(previous);
}

/**
 * Match an inline passthrough AT `index`, unconstrained form first -
 * the order `extract_passthroughs` runs the two patterns in.
 *
 * Exists as its own module rather than as another literal in
 * rules.ts because the constrained form needs the preceding
 * character, which a sticky pattern anchored at `index` cannot see:
 * the same split, for the same reason, that puts the constrained
 * MARK boundaries in quote-boundaries.ts.
 * @param text - the fragment being tokenized
 * @param index - where to try, zero-based
 * @returns the match length, or 0 when no passthrough starts here
 */
export function matchPassthrough(text: string, index: number): number {
  const head = text.at(index);
  if (head === undefined || !OPENERS.has(head)) {
    return 0;
  }
  UNCONSTRAINED.lastIndex = index;
  const unconstrained = UNCONSTRAINED.exec(text);
  if (unconstrained !== null) {
    return unconstrained[0].length;
  }
  if (!canOpenAt(text, index)) {
    return 0;
  }
  CONSTRAINED.lastIndex = index;
  const constrained = CONSTRAINED.exec(text);
  return constrained === null ? 0 : constrained[0].length;
}
