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
 * WHY A SCAN AND NOT A RULE. `extract_passthroughs` runs over the
 * block's whole pass text, which is its KEPT lines joined - a `//`
 * line is gone before the parser sees it - and every one of the
 * three content groups crosses a newline (`/m`, or a class that
 * simply does not exclude one). So `+**a` / `// c` / `b**+ d` is one
 * passthrough to the oracle, and its closing delimiter stands in a
 * fragment the opening one cannot see. A rule row decides from its
 * own neighbourhood and cannot answer that, which is the same reason
 * the curved rows and the doubled marks are scans (the "why a scan"
 * test in docs/coding-standards.md). {@link scanPassthroughs} is
 * therefore the one place a passthrough's extent is decided, and the
 * `Passthrough` rule row (rules.ts) reads what it recorded.
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
 * The third form, `pass:[text]`, is a named macro and keeps the rule
 * of its own it has always had (`InlineMacro` in rules.ts). The scan
 * still records it, for two reasons: its content is invisible to the
 * quote pass exactly as the delimiter forms' is, so the mask must
 * cover it; and its content group crosses a newline too, so the one
 * spelling a rule row cannot reach - a `pass:[` and its `]` with a
 * dropped line between them - is the scan's to answer. A `pass:[]`
 * one fragment holds WHOLE is still the macro row's, so its extent
 * is decided once rather than by two rows that could disagree.
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
 *    `trailingPlusPolicy` (src/print/text-edges.ts): the trailing
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

import { NEWLINE_LENGTH } from "../../constants.js";

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
// oracle at `index.cjs` l.726-728) with its `pass:` arm split off
// into {@link PASS_MACRO}. `\+\+\+?` prefers the longer
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
 * Match a DELIMITER-spelled passthrough at `index`, unconstrained
 * form first - the order `extract_passthroughs` runs the two
 * patterns in.
 *
 * Not exported: {@link scanPassthroughs} is the only caller, so a
 * passthrough's extent is decided in one place. The constrained form
 * needs the preceding character, which a sticky pattern anchored at
 * `index` cannot see; that is the same split, for the same reason,
 * that puts the constrained MARK boundaries in quote-boundaries.ts.
 * @param text - the pass text being scanned
 * @param index - where to try, zero-based
 * @returns the match length, or 0 when no passthrough starts here
 */
function matchPassthrough(text: string, index: number): number {
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

// `pass:[text]` - the `pass:` arm of `InlinePassMacroRx` (rx.rb
// l.597), spelled the way the `InlineMacro` rule row spells every
// macro (`(?:MACRO_NAMES):[^\s\[]*\[[^\]]*\]`, rules.ts) so the bytes
// this scan masks and the bytes that row tokenizes are the same
// bytes. Ruby's own arm is narrower on two points - its subs list is
// `[a-z]+(?:,[a-z-]+)*` and a backslash escapes the closing bracket -
// and both differences are the macro row's already; copying Ruby here
// instead would give the two spellings a way to disagree about one
// macro's extent. The closing class `[^\]]` does not exclude a
// newline, so this arm crosses a dropped line the way Ruby's `/m`
// content group does.
const PASS_MACRO = /pass:[^\s\[]*\[[^\]]*\]/vy;

/**
 * One passthrough's bytes, as a half-open range of whatever text the
 * scan or the window it came from is in.
 */
export interface PassthroughSpan {
  /** The passthrough's first character. */
  readonly start: number;
  /** Just past its last. */
  readonly end: number;
  /**
   * What this text owes for those bytes. `token`: the tokenizer must
   * emit them as one `Passthrough` token, because no other row can.
   * `macroRow`: they are a `pass:[]` macro this text holds whole, and
   * the `InlineMacro` row reads it - the arm that keeps one macro's
   * extent decided once.
   */
  readonly emit: "token" | "macroRow";
}

/**
 * The passthrough starting at `index`, or undefined.
 *
 * The two arms cannot both match: a delimiter form starts with `+`,
 * `$` or the `[` of an attrlist, and the macro starts with `p`, so
 * trying them in either order reaches the same answer. Ruby offers
 * them as alternatives of ONE pattern for that reason.
 * @param text - the pass text being scanned
 * @param index - where to try, zero-based
 * @returns the span, or undefined when none starts here
 */
function passthroughAt(
  text: string,
  index: number,
): PassthroughSpan | undefined {
  const delimited = matchPassthrough(text, index);
  if (delimited > 0) {
    return { start: index, end: index + delimited, emit: "token" };
  }
  PASS_MACRO.lastIndex = index;
  const macro = PASS_MACRO.exec(text);
  if (macro === null) {
    return undefined;
  }
  return { start: index, end: index + macro[0].length, emit: "macroRow" };
}

/**
 * Every passthrough in one block's pass text, left to right.
 *
 * LEFTMOST WINS AND THE SCAN RESUMES BEHIND THE MATCH, which is what
 * `gsub` does. The ORDER is not Ruby's, though, and the difference is
 * real rather than theoretical. This walks the text ONCE, trying the
 * unconstrained delimiters and then the `pass:` macro and then the
 * constrained `+` at each position. `extract_passthroughs` runs the
 * whole macro alternation - `+++`, `++`, `$$` and `pass:[]` together -
 * over the WHOLE text first, replaces each match with a placeholder,
 * and only then runs the constrained pattern over the result
 * (substitutors.rb l.1018 and l.1075).
 *
 * The two agree everywhere except where passthroughs ABUT and where a
 * constrained pair OVERLAPS a macro, because that is where Ruby's
 * second pass reads bytes its first pass has already rewritten. It
 * goes in BOTH directions: this walk can find fewer spans than Ruby
 * and it can find more. The four measured witnesses, pinned as
 * characterizations in tests/parser/passthrough-scan-order.test.ts:
 *
 * - `x +a+pass:[b]c d` - Ruby takes `+a+` and `pass:[b]`; the walk
 *   takes only the macro, because the closing `+`'s `(?!CG_WORD)`
 *   lookahead reads the `p` of `pass:` where Ruby reads a placeholder.
 * - `x +++pass:[a]b c` - Ruby takes `+++` and `pass:[a]`; same cause,
 *   same direction.
 * - `x +cc++de+ f` - Ruby takes `+cc+` alone, because its first `+de+`
 *   candidate needs a preceding character the previous match already
 *   consumed; the walk takes both. This is the direction that finds
 *   MORE.
 * - `x +pass:[a+ b] c` - Ruby's macro pass takes `pass:[a+ b]` whole;
 *   the walk reaches the `+` first and takes `+pass:[a+`.
 *
 * Measured over 5995 pass texts from a `+`/`$`/`pass:`-heavy corpus,
 * the two disagree about which bytes are masked in 48 of them (0.8%).
 * Every one of those is render-equal and idempotent and prints the
 * bytes it was given, so nothing downstream of the mask can see the
 * difference - but a consumer that computes an EXCLUSION from these
 * spans rather than a mask inherits the divergence, and this is the
 * paragraph that says so.
 * @param text - the block's kept lines joined, exactly as the source
 *   spells them
 * @returns the spans, sorted by `start` and pairwise disjoint
 */
export function scanPassthroughs(text: string): readonly PassthroughSpan[] {
  const spans: PassthroughSpan[] = [];
  let index = 0;
  while (index < text.length) {
    const span = passthroughAt(text, index);
    if (span === undefined) {
      index += 1;
      continue;
    }
    spans.push(span);
    // Every pattern here consumes at least one character, so the walk
    // always advances and the loop is finite for any input.
    index = span.end;
  }
  return spans;
}

// The character a passthrough's bytes are replaced by before the four
// quote-pass scans read the text. Ruby's own PASS_START
// (substitutors.rb l.50), and picked for what it is rather than for
// what it looks like: the placeholder Ruby writes there begins with
// this character, so a constrained row's boundary test on either side
// of a passthrough reads the same CLASS in both programs (non-space,
// and outside `\p{Alphabetic}\p{N}\p{Pc}`).
//
// One per character rather than one per passthrough, so the mask is
// offset-preserving and every scan's offsets are still the pass
// text's - the property windowOf (quote-pass.ts) rests on. Ruby's
// placeholder is shorter than what it replaces, which it can afford
// because it restores the bytes before anything measures them.
const MASK = "\u0096";

/**
 * `text` with every passthrough's bytes replaced, character for
 * character, by {@link MASK}.
 *
 * This is `extract_passthroughs` (substitutors.rb l.1018) as the four
 * quote-pass scans need it: they run over the text the oracle's
 * substitution rows run over, and that text has no passthrough in it.
 * Without the mask a delimiter INSIDE a passthrough pairs with one
 * outside - `x +**a+ b** c` renders `**a` literally and leaves `b**`
 * alone, where an unmasked doubled scan pairs the two `**` and builds
 * a span the oracle never makes.
 *
 * Newlines inside a passthrough are masked with everything else. That
 * is Ruby's reading too: the placeholder replaces the whole match,
 * newlines included, so no row of the quote pass sees a line boundary
 * that a passthrough spans.
 * @param text - the block's pass text
 * @param spans - its passthroughs, from {@link scanPassthroughs}
 * @returns the same text with those ranges masked, same length
 */
export function maskPassthroughs(
  text: string,
  spans: readonly PassthroughSpan[],
): string {
  let masked = "";
  let cursor = 0;
  for (const span of spans) {
    masked +=
      text.slice(cursor, span.start) + MASK.repeat(span.end - span.start);
    cursor = span.end;
  }
  return masked + text.slice(cursor);
}

/**
 * How many characters the `Passthrough` rule row takes at `index`.
 *
 * The row's whole body: a passthrough's extent is the scan's, so the
 * row is a lookup rather than a second matcher. A span whose `emit`
 * is `macroRow` yields nothing here, which is what leaves an intact
 * `pass:[]` to the `InlineMacro` row.
 *
 * A PASSTHROUGH TOKEN NEVER ENDS WITH A NEWLINE, and the trailing one
 * is left for the tokenizer's own `InlineNewline` row. Only a half
 * cut off at a fragment's end can end that way - every closing
 * delimiter is `+`, `$` or `]` - and an atom that ends with a line
 * break is a break the output carries twice: once as the atom's own
 * byte and once as the separator the raw line behind it needs. A
 * `+++` passthrough is where that shows, because Ruby gives that
 * boundary `subs: []` and its bytes can be real markup, so the
 * printer copies its newlines out verbatim (`passthroughText`,
 * src/print/serialize-inline.ts) and `+++a` / `// c` / `b+++` printed
 * a blank line in front of the comment. Nothing is lost by leaving
 * the newline outside: the raw line that follows needs a break there
 * anyway, and it now gets exactly one.
 * @param text - the fragment being tokenized
 * @param index - where the tokenizer stands
 * @param spans - this fragment's passthroughs, in its coordinates
 * @returns the token's width, or 0 when no passthrough starts here
 */
export function passthroughTokenWidth(
  text: string,
  index: number,
  spans: readonly PassthroughSpan[],
): number {
  for (const span of spans) {
    if (span.start > index) {
      break;
    }
    if (span.start === index && span.emit === "token") {
      const trailingNewline = text.at(span.end - NEWLINE_LENGTH) === "\n";
      return span.end - span.start - (trailingNewline ? NEWLINE_LENGTH : 0);
    }
  }
  return 0;
}
