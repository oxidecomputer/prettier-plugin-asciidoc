/**
 * The ordered inline rule table — the single source of truth for
 * inline shapes, the way `src/parse/line-shapes.ts` is for line
 * shapes.
 *
 * FIRST MATCH WINS, in array order. That is not a simplification of
 * the lexer this replaces: that lexer had no `longer_alt`
 * on any token, so it was first-match-wins too, and "longest match"
 * behaviour was achieved inside the patterns (`InlineText`'s negative
 * lookahead, and `**` tried before `*` in the mark matcher). Building
 * a longest-match engine here would CHANGE behaviour.
 *
 * Every rule cites the Asciidoctor 2.0.26 source it mirrors
 * (`lib/asciidoctor/asciidoctor.rb`, `substitutors.rb`, `rx.rb`) — the
 * Ruby the oracle (`@asciidoctor/core` 4.0.11) is transpiled from.
 * Where our shape is deliberately narrower or wider than Ruby's, the
 * comment says so: the formatter only has to recognise the construct,
 * not resolve it.
 */
import type { InlineKind } from "./tokens.js";
import { canOpenAt, canCloseAt, type MarkKind } from "./quote-boundaries.js";
import { matchPassthrough } from "./passthrough.js";

/** One entry of the ordered table. */
interface InlineRule {
  /** The kind this rule produces. */
  readonly type: InlineKind;
  /**
   * How many characters match at `index`.
   * @param text - the fragment being tokenized
   * @param index - where to try, zero-based
   * @returns the match length, or 0 when the rule does not apply
   */
  readonly match: (text: string, index: number) => number;
}

// Which span kind each mark token spells - the key into
// quote-boundaries.ts's per-mark classes, for the matcher below and
// for {@link markFlags}, so the two consult the same record.
const MARK_KINDS: Partial<Record<InlineKind, MarkKind>> = {
  BoldMark: "bold",
  ItalicMark: "italic",
  MonoMark: "monospace",
  HighlightMark: "highlight",
};

/**
 * A constrained/unconstrained formatting mark — `strong`, `emphasis`,
 * `monospaced` and `mark` in the `QUOTE_SUBS` table, which is DEFINED
 * in asciidoctor.rb l.439-470 and consumed by substitutors.rb l.191.
 * The double mark is tried first (unconstrained, no boundary test at
 * all); the single one is a token only where Ruby's constrained
 * pattern could OPEN or CLOSE with it - `canOpenAt`/`canCloseAt`
 * (quote-boundaries.ts), each reading one neighbour and one content
 * edge. A single mark that can do neither is no mark: it falls to
 * `InlineText`/`InlineChar`. The pairing into spans is
 * inline-node-builder.ts's job, not the tokenizer's; the DIRECTION
 * facts ride on the token ({@link markFlags}).
 *
 * The boundary is computed against the FRAGMENT the reader handed us,
 * never the whole document: `* *bold*` after a list marker can open
 * at offset 0 because nothing precedes it in the fragment.
 * @param character - the mark character (`*`, `_`, `` ` ``, `#`)
 * @param kind - the span kind whose boundary classes apply
 * @returns the rule's match function
 */
function markMatcher(character: string, kind: MarkKind): InlineRule["match"] {
  return (text: string, index: number): number => {
    if (text.at(index) !== character) return 0;
    if (text.at(index + 1) === character) return 1 + 1;
    return canOpenAt(kind, text, index) || canCloseAt(kind, text, index)
      ? 1
      : 0;
  };
}

/**
 * The direction facts for a just-matched mark token: whether Ruby's
 * constrained pattern could OPEN a span here, and whether it could
 * CLOSE one. A DOUBLE mark answers `true` on both - the unconstrained
 * rows of `QUOTE_SUBS` (`\*\*(.+?)\*\*` and kin, asciidoctor.rb
 * l.444-468) test no boundary and take any content. For every non-mark
 * kind the
 * answer is undefined, and the token carries no flags.
 * @param type - the kind that matched at `index`
 * @param text - the fragment being tokenized
 * @param index - where the token starts
 * @param length - how many characters it matched
 * @returns the two flags, or undefined for a non-mark kind
 */
export function markFlags(
  type: InlineKind,
  text: string,
  index: number,
  length: number,
): { canOpen: boolean; canClose: boolean } | undefined {
  const kind = MARK_KINDS[type];
  if (kind === undefined) return undefined;
  if (length > 1) return { canOpen: true, canClose: true };
  return {
    canOpen: canOpenAt(kind, text, index),
    canClose: canCloseAt(kind, text, index),
  };
}

/**
 * A rule driven by a regex, matched AT an index rather than searched
 * for from it.
 *
 * The sticky flag is added here rather than written on every literal,
 * so no rule can forget it, and the sticky copy is private to the
 * returned function: `lastIndex` is per-rule state that nothing else
 * can observe.
 * @param regex - a `v`-flag regex, anchored implicitly at the index
 * @returns the rule's match function
 */
function pattern(regex: RegExp): InlineRule["match"] {
  const sticky = new RegExp(regex.source, "vy");
  return (text: string, index: number): number => {
    sticky.lastIndex = index;
    const match = sticky.exec(text);
    return match === null ? 0 : match[0].length;
  };
}

// How many characters of a bibliography anchor stand at an index -
// content narrowed the same way InlineAnchor's own pattern is (any
// non-`]` run rather than Ruby's precise id/reftext classes): the
// TOKEN only has to recognise the construct, and the printer
// (bibliographyAnchorToSource, serialize-inline.ts) replays the
// interior verbatim regardless.
const biblioAnchorMatch = pattern(/\[\[\[[^\]\n]+\]\]\]/v);

// The inline macro names, enumerated ONCE: interpolated into the
// InlineMacro rule and into InlineText's stop lookahead, so the two
// spellings cannot drift (they had: `footnoteref|footnote` here,
// `footnote(?:ref)?` there — same language, two dialects).
// `footnoteref` precedes `footnote` so the longer name wins.
//
// `icon` sits beside `image`: rx.rb l.476-486's InlineImageMacroRx is
// `i(?:mage|con):...`, one pattern for both names, and its target
// group has no leading boundary either - `microicon:x[]` matches from
// the `icon:` onward the same way `Textfootnote:[x]` matches from the
// `footnote:` onward (verified against the oracle).
//
// `stem` is InlineStemMacroRx (rx.rb l.543-551), which also covers
// `asciimath`/`latexmath` - out of scope here (issue #19 asks for
// `stem:` only), so only `stem` is added.
const MACRO_NAMES =
  "link|mailto|xref|image|icon|kbd|btn|menu|footnoteref|footnote|pass|stem";

// A bare email address - InlineEmailRx, which our ORACLE,
// `@asciidoctor/core` 4.0.11, spells at `build/node/index.cjs` l.518 as
//
//   ([\\>:/])?CG_WORD(?:&amp;|[CC_WORD\-.%+])*
//   @CG_ALNUM[CC_ALNUM_\-.]*\.[a-zA-Z]{2,5}\b
//
// with `sub_macros`' email arm at l.19882-19897. The classes are the
// TRANSPILE's (`index.cjs` l.49-55): `CC_WORD` is
// `\p{Alphabetic}\p{N}\p{Pc}` and `CC_ALNUM` is `\p{Alphabetic}\p{N}`.
// Ruby itself says something slightly different - asciidoctor.rb l.434
// and l.436 are `CC_ALNUM = CG_ALNUM = '\p{Alnum}'` and
// `CC_WORD = CG_WORD = '\p{Word}'`, and Onigmo's `\p{Word}` is
// Alphabetic + M + Nd + Pc while `\p{Alnum}` is Alphabetic + Nd - so
// the transpile drops `\p{M}` and widens `Nd` to `\p{N}`. The
// transpile is what is transcribed here, because the transpile is the
// oracle these tests measure against.
//
// One substitution, in the LOCAL part: Ruby's `&amp;` alternative
// becomes a bare `&`. The email arm runs inside `sub_macros`, after
// `sub_specialchars` has rewritten every `&` to `&amp;`; the tokenizer
// reads the AUTHOR's bytes, where the same address is spelled
// `a&b@example.com`.
const EMAIL_ADDRESS =
  String.raw`[\p{Alphabetic}\p{N}\p{Pc}](?:&|[\p{Alphabetic}\p{N}\p{Pc}\-.%+])*` +
  String.raw`@[\p{Alphabetic}\p{N}][\p{Alphabetic}\p{N}_\-.]*\.[a-zA-Z]{2,5}\b`;

// Ruby's leading `([\\>:/])?` is no part of the address: where the
// group fires, the email arm returns the match UNLINKED
// (`if (p1) return p1 === RS ? match.slice(1) : match`), having
// CONSUMED it. Its `>` is absent here on purpose - under the default
// substitution list that one closes a TAG an earlier pass wrote
// (`<code>`, `</a>`) rather than standing in the author's own bytes,
// which `sub_specialchars` has already rewritten to `&gt;`;
// `a>user@example.com` DOES render as a link (measured). A block whose
// subs list drops `specialcharacters` keeps the author's `>` and
// guards on it, which we do not model - the same gap every other
// `subs` override already sits in.
const EMAIL_GUARD = new Set(["\\", ":", "/"]);

// The five non-word characters an address's LOCAL part admits:
// `[CC_WORD\-.%+]`'s punctuation, plus the `&` that stands where
// Ruby's alternation has `&amp;` (it reads a substituted document, we
// read the author's bytes). A set rather than a class, because a bare
// `&` inside a `v`-mode class is spelled one way by the compiler's
// reader and another by the linter's.
const EMAIL_PUNCT = new Set(["-", ".", "%", "+", "&"]);

// One character of Ruby's `CG_WORD`, which is what a local part has to
// OPEN with - so the walk back asks the pattern's own question.
const EMAIL_WORD = /[\p{Alphabetic}\p{N}\p{Pc}]/v;

/**
 * Whether a character may stand INSIDE an address's local part.
 * @param character - one character of the fragment
 * @returns true when the local part admits it
 */
function isLocal(character: string): boolean {
  return EMAIL_WORD.test(character) || EMAIL_PUNCT.has(character);
}

// How many characters of address stand at an index. A `pattern()`
// match function rather than a bare regex, so the sticky copy stays
// private the way every rule's does.
const addressAt = pattern(new RegExp(EMAIL_ADDRESS, "v"));

// Whitespace, which no match can cross: neither the guard characters,
// nor the local part, nor the domain admits any. That is what makes a
// whitespace-delimited WORD the unit {@link scanWord} can read on its
// own - Ruby's scan can never arrive in the middle of one with
// anything consumed.
const WHITESPACE = /\s/v;

// The word most recently scanned, and the addresses Ruby's scan
// accepts inside it. A cache of a pure function of (`text`, offset),
// not state: recomputing is always safe, and the tokenizer walks left
// to right, so consecutive questions land in the same word. The
// initial `scannedTo` of 0 is what makes the first question a miss,
// whatever `scannedText` holds.
let scannedText = "";
let scannedFrom = 0;
let scannedTo = 0;
const scannedStarts: number[] = [];
const scannedLengths: number[] = [];

/**
 * Where the local part ending at the `@` in `at` opens, or -1 when
 * there is none.
 *
 * Ruby matches at the FIRST position that works, and the local part
 * `CG_WORD(?:&amp;|[CC_WORD\-.%+])*` can start at any word character
 * of the run in front of the `@` - so the earliest one wins. `floor`
 * is where Ruby's scan may still begin: a character behind it is
 * already inside a match Ruby consumed, and cannot open a new one.
 * @param text - the fragment being tokenized
 * @param at - the `@`'s offset
 * @param floor - the first offset the scan may still match at
 * @returns the local part's first offset, or -1
 */
function localStart(text: string, at: number, floor: number): number {
  let start = at;
  while (start > floor && isLocal(text.charAt(start - 1))) start -= 1;
  while (start < at && !EMAIL_WORD.test(text.charAt(start))) start += 1;
  return start < at ? start : -1;
}

/** One match of Ruby's pattern: where the ADDRESS part of it sits. */
interface Match {
  /** The address's first offset. */
  readonly start: number;
  /** How many characters of address. */
  readonly length: number;
  /** Whether a guard character stands in front, still unconsumed. */
  readonly guarded: boolean;
}

/**
 * The match Ruby's pattern makes on the `@` at `at`, or undefined when
 * it makes none.
 *
 * There is at most one, because the local part cannot cross an `@`:
 * whatever start the scan takes, this is the `@` it reaches. And a
 * later start in the same local run would only shorten the local part,
 * which the pattern accepts either way - so if the earliest start
 * fails, every start fails, and one attempt settles the `@`.
 * @param text - the fragment being tokenized
 * @param at - the `@`'s offset
 * @param resume - the first offset the scan may still match at
 * @returns the match, or undefined
 */
function matchOn(text: string, at: number, resume: number): Match | undefined {
  if (at < resume) return undefined;
  const start = localStart(text, at, resume);
  if (start === -1) return undefined;
  const length = addressAt(text, start);
  if (length === 0) return undefined;
  // The guard is part of the match, so it guards only while it is
  // itself unconsumed.
  const guarded = start > resume && EMAIL_GUARD.has(text.charAt(start - 1));
  return { start, length, guarded };
}

/**
 * The whitespace-free run holding `offset`, as `[from, to)`.
 * @param text - the fragment being tokenized
 * @param offset - an offset inside the run
 * @returns the run's bounds, end exclusive
 */
function wordAround(
  text: string,
  offset: number,
): { from: number; to: number } {
  let from = offset;
  while (from > 0 && !WHITESPACE.test(text.charAt(from - 1))) from -= 1;
  let to = offset;
  while (to < text.length && !WHITESPACE.test(text.charAt(to))) to += 1;
  return { from, to };
}

/**
 * Run Ruby's scan over the whitespace-delimited word holding `offset`
 * and record the addresses it ACCEPTS, into the module's one-word
 * cache.
 *
 * This is the email arm's own algorithm rather than a per-position
 * test, because the arm's answer at any one position depends on what
 * the scan has already consumed. `text.replace(globalRx(InlineEmailRx))`
 * takes the leftmost match, moves past the WHOLE of it - guard
 * character included - and repeats. Two consequences a one-character
 * left test cannot express, both measured against the oracle:
 *
 * - a word character behind the local part's joiners refuses a start
 *   only while it is UNCONSUMED. In `a@b.com.c@d.com` the `m` behind
 *   the `.` is interior to the first address, so Ruby starts a second
 *   match at `c` and so do we;
 * - and a start one character past an `@` is legal only when
 *   everything to the left of that `@` failed. `d_e@f.org-g.h@i.com`
 *   yields three addresses, not a `f.org-g.h@i.com` that the oracle
 *   never produces.
 *
 * Each `@` is visited once and its local part walked back at most to
 * the previous `@`, so the whole word costs one pass.
 * @param text - the fragment being tokenized
 * @param offset - any offset inside the word to scan
 */
function scanWord(text: string, offset: number): void {
  if (scannedText === text && offset >= scannedFrom && offset < scannedTo) {
    return;
  }
  const { from, to } = wordAround(text, offset);
  scannedText = text;
  scannedFrom = from;
  scannedTo = to;
  scannedStarts.length = 0;
  scannedLengths.length = 0;
  // Ruby's `lastIndex`: where the next match may begin.
  let resume = from;
  let at = text.indexOf("@", from);
  while (at !== -1 && at < to) {
    const found = matchOn(text, at, resume);
    if (found !== undefined) {
      if (!found.guarded) {
        scannedStarts.push(found.start);
        scannedLengths.push(found.length);
      }
      resume = found.start + found.length;
    }
    at = text.indexOf("@", at + 1);
  }
}

/**
 * The InlineEmail rule: the address Ruby's scan accepts AT this exact
 * offset, if any.
 * @param text - the fragment being tokenized
 * @param index - where to try
 * @returns the address's length, or 0
 */
function emailMatch(text: string, index: number): number {
  if (!EMAIL_WORD.test(text.charAt(index))) return 0;
  scanWord(text, index);
  const found = scannedStarts.indexOf(index);
  return found === -1 ? 0 : scannedLengths[found];
}

/**
 * Where the first accepted address inside `[from, limit)` starts, or
 * -1 when there is none.
 *
 * Driven by the `@`s rather than by the positions: every address holds
 * one, so finding them and asking their words is a single pass over
 * the range instead of a candidacy test at every character. A word can
 * open BEFORE `limit` while its `@` sits behind it - `Mail dan` stops
 * at the `_` of `dan_rosen@x.com` - so the `@` itself is not bounded,
 * only the word it belongs to.
 * @param text - the fragment being tokenized
 * @param from - the first offset an address may start at
 * @param limit - the first offset that is too far
 * @returns the address's start, or -1
 */
function firstAddressIn(text: string, from: number, limit: number): number {
  let at = text.indexOf("@", from);
  while (at !== -1) {
    scanWord(text, at);
    if (scannedFrom >= limit) return -1;
    for (const start of scannedStarts) {
      if (start >= from && start < limit) return start;
    }
    at = text.indexOf("@", scannedTo);
  }
  return -1;
}

/**
 * The InlineText rule: a run of ordinary characters, stopped where an
 * address begins.
 *
 * The run's other stops are fixed prefixes and ride in the pattern's
 * own negative lookahead. An address is not one: it can open at any
 * word character, and whether it does is a fact about Ruby's scan
 * rather than about the characters at that position. Putting the
 * address in the lookahead anyway costs an order of magnitude on
 * ordinary prose and turns a long `@`-bearing token quadratic (both
 * measured), because the lookahead is then tried, and scans forward,
 * at every character. So the run is matched first and cut afterwards,
 * by the same scan {@link emailMatch} reads point-wise.
 * @param source - InlineText's pattern, with no address stop in it
 * @returns the rule's match function
 */
function textMatcher(source: string): InlineRule["match"] {
  const sticky = new RegExp(source, "vy");
  return (text: string, index: number): number => {
    sticky.lastIndex = index;
    const found = sticky.exec(text);
    if (found === null) return 0;
    const [run] = found;
    const { length } = run;
    // From `index + 1`: an address AT `index` would have been this
    // rule's predecessor in the table, and a cut of zero is no cut.
    const cut = firstAddressIn(text, index + 1, index + length);
    return cut === -1 ? length : cut - index;
  };
}

/**
 * The table, in priority order (see {@link INLINE_KINDS}).
 *
 * The rules report a miss as a zero-length match rather than as a
 * sentinel, which is why the `unicorn/no-null` suppression the
 * old custom matcher needed is gone.
 */
export const INLINE_RULES: readonly InlineRule[] = [
  // `+text+`, `++text++`, `+++text+++`, each with an optional
  // `[attrlist]` in front — the passthrough forms `extract_passthroughs`
  // pulls out of the line BEFORE any other substitution runs
  // (substitutors.rb l.1018), which is why this is the first row: what
  // the oracle removes first, nothing else may claim. The two patterns
  // and the boundary they need live in passthrough.ts, the way the
  // constrained MARK boundaries live in quote-boundaries.ts.
  { type: "Passthrough", match: matchPassthrough },
  // Escaped inline formatting mark: `\*`, `\_`, `` \` ``, `\#`
  // (substitutors.rb strips the backslash when it applies quotes).
  { type: "BackslashEscape", match: pattern(/\\[*_`#]/v) },
  // `{name}` / `{counter:name}` — AttributeReferenceRx. Narrower than
  // Ruby's, which also takes `set:`/`counter2:`; the formatter only
  // has to leave the reference alone.
  { type: "AttributeReference", match: pattern(/\{[\w:.\-][\w:.\-]*\}/v) },
  // `[role]` immediately before `#` — the shorthand attrlist of a
  // constrained highlight. Ruby has no constant for it: it is the
  // optional `(?:\[([^\]]+)\])?` group inside every `QUOTE_SUBS`
  // pattern (asciidoctor.rb l.448-464).
  { type: "RoleAttribute", match: pattern(/\[[^\]]+\](?=#)/v) },
  // `name:target[attrlist]` — InlineMacroRx family, with the macro
  // names enumerated rather than `[a-z]+`: a generic name matches
  // mid-word (`Textfootnote:`) and collides with `https://url[text]`.
  // The names and their order come from {@link MACRO_NAMES}.
  {
    type: "InlineMacro",
    match: pattern(
      new RegExp(String.raw`(?:${MACRO_NAMES}):[^\s\[]*\[[^\]]*\]`, "v"),
    ),
  },
  // Bare URL, with or without an attrlist — InlineLinkRx.
  {
    type: "InlineUrl",
    match: pattern(/https?:\/\/[^\s\[\]]+(?:\[[^\]]*\])?/v),
  },
  // Bare email address - InlineEmailRx ({@link EMAIL_ADDRESS}) read
  // through Ruby's own scan ({@link scanWord}). Behind InlineMacro and
  // InlineUrl, which own the position outright; on the two shapes that
  // collide, `mailto:a@b.com[x]` and `https://x/a@b.com`, Ruby reaches
  // the same answer through its `:` and `/` guards. Not a general
  // agreement between the two rules and Ruby: Ruby's InlineLinkRx trims
  // trailing punctuation off a bare URL and lets the email arm read
  // what is left, so `https://ex.com/p,c@d.com` is an address to Ruby
  // and one long URL to our InlineUrl - a pre-existing, byte-neutral
  // difference in the URL rule, not in this one.
  { type: "InlineEmail", match: emailMatch },
  // `<<target>>` / `<<target,text>>` — InlineXrefMacroRx shorthand.
  { type: "XrefShorthand", match: pattern(/<<[^>\n]+(?:,[^>\n]+)?>>/v) },
  // `[[[id]]]` / `[[[id, reftext]]]` - InlineBiblioAnchorRx (rx.rb
  // l.457), tried BEFORE the plain two-bracket InlineAnchor row below
  // so the third bracket is never left as stray text: at a position
  // where both rules could match, InlineAnchor's own permissive
  // `[^\]\n]+` would otherwise claim the first two brackets and the
  // opening `[` of the id, exactly the corruption issue #8 reports.
  //
  // Ruby's own guard is `@context == :list_item &&
  // @parent.style == 'bibliography'` (substitutors.rb l.714), applied
  // with `.sub` (ONE substitution) against a pattern anchored `^`.
  // The inline layer has no view of block style (`tests/parser/
  // architecture.test.ts` forbids sniffing it from here), so this row
  // reproduces the "start of the text" half of that guard the way
  // {@link markMatcher}'s boundary already does: `index === 0` in the
  // FRAGMENT `tokenizeInline` was handed, which is where a list
  // item's own text starts once its marker is stripped
  // (src/parse/inline/tokenize.ts). That is deliberately WIDER than
  // Ruby's block-style half - a triple-bracket run opening an
  // ORDINARY paragraph is read as a bibliography anchor here too,
  // where Ruby's guard would refuse it, but harmlessly: our printer
  // only replays source bytes, never resolves a real bibliography
  // entry, so the extra recognition costs nothing a real document
  // would render differently by (measured: outside bibliography
  // context Ruby's own InlineAnchorRx falls back to the same
  // two-bracket misparse the InlineAnchor row below already
  // reproduces). Anywhere but index 0 this rule never matches, so
  // `[[[id]]]` mid-paragraph keeps that misparse unchanged.
  {
    type: "InlineBiblioAnchor",
    match: (text: string, index: number): number =>
      index === 0 ? biblioAnchorMatch(text, index) : 0,
  },
  // `[[id]]` / `[[id, reftext]]` — InlineAnchorRx.
  { type: "InlineAnchor", match: pattern(/\[\[[^\]\n]+\]\]/v) },
  { type: "BoldMark", match: markMatcher("*", "bold") },
  { type: "ItalicMark", match: markMatcher("_", "italic") },
  { type: "MonoMark", match: markMatcher("`", "monospace") },
  { type: "HighlightMark", match: markMatcher("#", "highlight") },
  // ` +` at end of line — HardLineBreakRx (`^(.*) \+$` after
  // `adjust_indentation!`). The newline is left for InlineNewline.
  // Context-free on purpose: the one shape Asciidoctor reads as a
  // literal `+` instead is decided by the reader's literal-plus rule
  // (lines/paragraph-reader.ts), which tells the caller.
  { type: "HardLineBreak", match: pattern(/ \+(?=\n)/v) },
  // Not an Asciidoctor construct: Ruby reads a paragraph line by line,
  // so the line break inside one is structure it never has to match.
  // We tokenize the whole run at once and need it as a token.
  { type: "InlineNewline", match: pattern(/\n/v) },
  // A run of ordinary characters. The negative lookahead is what
  // stops the run BEFORE a URL, a macro name or a hard break, which is
  // how first-match-wins produces longest-match behaviour without a
  // longest-match engine; an ADDRESS stops it too, but through
  // {@link textMatcher}'s cut rather than through this pattern. `<` is
  // excluded so `<<ref>>` is not eaten as text, and `+` so a
  // passthrough is not: a run that swallowed the `+` in `a +text+ b`
  // would hide the opening delimiter from the Passthrough rule, which
  // is only ever tried at a position the run has not already taken.
  // The ` +\n` lookahead stays for the hard break, whose match starts
  // one character EARLIER, at the space. Ruby has no equivalent:
  // substitutors.rb rewrites the whole line with `gsub`, so
  // "everything else" is never named.
  {
    type: "InlineText",
    match: textMatcher(
      `(?:(?!https?://|(?:${MACRO_NAMES}):| \\+\\n)[^\\n*_\`#\\\\\\{\\[<+])+`,
    ),
  },
];
