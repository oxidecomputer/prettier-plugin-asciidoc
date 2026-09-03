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
import {
  canOpenAt,
  canCloseAt,
  type MarkKind,
  type CurvedQuoteSpelling,
} from "./quote-boundaries.js";
import { CURVED_WIDTH, type CurvedScan } from "./curved-quotes.js";
import { UNCONSTRAINED_WIDTH } from "./doubled-marks.js";
import { matchPassthrough } from "./passthrough.js";
import { ASCII_HORIZONTAL_WHITESPACE } from "../line-shapes.js";
import { DELIM_WIDTH } from "../../constants.js";

/**
 * The two whole-fragment scans every rule is handed, taken once per
 * fragment by `tokenizeInline`.
 *
 * Both exist because their construct is not decidable from a
 * neighbourhood: a curved-quote pair (curved-quotes.ts) and a doubled
 * mark (doubled-marks.ts) each answer to text arbitrarily far away.
 * Together they are a fact about the same fragment every rule already
 * has, not a history of what has been matched. Not exported: the one
 * caller (tokenize.ts) builds the object inline from the two scans it
 * has just taken, so nothing needs the type by name.
 */
interface FragmentScan {
  /**
   * Where the two curved-quote rows matched. The two curved rules read
   * it to find their own delimiters, and `InlineText`'s own rule reads
   * it to cut its run before one, the way it already cuts before an
   * email address.
   */
  readonly curved: CurvedScan;
  /**
   * Every offset where an unconstrained (doubled) delimiter BEGINS.
   * {@link markMatcher} reads it to decide the doubled spelling; every
   * other rule ignores it.
   */
  readonly doubled: ReadonlySet<number>;
  /**
   * Every offset where a superscript or subscript delimiter stands
   * (super-sub.ts). {@link superSubMatcher} reads it, and
   * `InlineText`'s own rule reads it to cut its run before one, the
   * way it already cuts before a curved delimiter.
   */
  readonly superSub: ReadonlySet<number>;
  /**
   * Every character reference, by its first offset and its width
   * (replacements.ts). The `CharacterReference` rule reads it, and
   * `InlineText` cuts its run before one.
   */
  readonly replacements: ReadonlyMap<number, number>;
}

/** One entry of the ordered table. */
interface InlineRule {
  /** The kind this rule produces. */
  readonly type: InlineKind;
  /**
   * How many characters match at `index`.
   * @param text - the fragment being tokenized
   * @param index - where to try, zero-based
   * @param scan - the fragment's two whole-text scans
   * @returns the match length, or 0 when the rule does not apply
   */
  readonly match: (text: string, index: number, scan: FragmentScan) => number;
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
 * The unconstrained (doubled) row is tried first, exactly as the table
 * orders it; the single mark is a token only where Ruby's constrained
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
 *
 * TWO ADJACENT MARKS ARE NOT A DOUBLED MARK. Whether they are is the
 * unconstrained row's own question, and that row is a gsub over the
 * whole text (`sub_quotes`, substitutors.rb l.189-196), so the answer
 * is not in this neighbourhood: `**a**` pairs and `**a*` does not.
 * `scan.doubled` (doubled-marks.ts) is that row's own walk, and a
 * doubled mark is a token at the offsets it names and nowhere else.
 * Taking every adjacent pair instead hides the single mark the
 * CONSTRAINED row pairs inside the same run, which is issue #72:
 * `####` renders `<mark>#</mark>#` and `[r]####`
 * `<span class="r">#</span>#`, where a greedy reading leaves plain
 * text. The same walk is what keeps a doubled monospace mark off a
 * backtick the curved rows already took, since it reads those rows'
 * masked view rather than the source.
 * @param character - the mark character (`*`, `_`, `` ` ``, `#`)
 * @param kind - the span kind whose boundary classes apply
 * @returns the rule's match function
 */
function markMatcher(character: string, kind: MarkKind): InlineRule["match"] {
  return (text: string, index: number, scan: FragmentScan): number => {
    if (text.at(index) !== character) return 0;
    if (scan.doubled.has(index)) return UNCONSTRAINED_WIDTH;
    return canOpenAt(kind, text, index, scan.curved.view) ||
      canCloseAt(kind, text, index, scan.curved.view)
      ? 1
      : 0;
  };
}

/**
 * A superscript or subscript delimiter, at an offset
 * {@link scanSuperSubMarks} named - `QUOTE_SUBS` rows 11 and 12
 * (asciidoctor.rb l.465-468), the last two of the table.
 *
 * A SCAN and not a neighbourhood test, for the reason super-sub.ts's
 * own header gives: each row is a gsub of
 * `\\?(?:\[([^\]]+)\])?X(\S+?)X` over
 * the whole text, so `x ^a^b^ y` renders `x <sup>a</sup>b^ y` and the
 * third caret is text only because the gsub had already consumed the
 * pair in front of it. The character is checked here as well as in the
 * scan so that each of the two rules claims only its own offsets - the
 * scan reports both rows' delimiters in one set, exactly as
 * {@link scanDoubledMarks} reports all four doubled rows' in one.
 * @param character - the delimiter character (`^`, `~`)
 * @returns the rule's match function
 */
function superSubMatcher(character: string): InlineRule["match"] {
  return (text: string, index: number, scan: FragmentScan): number =>
    text.at(index) === character && scan.superSub.has(index) ? DELIM_WIDTH : 0;
}

/**
 * A curved-quote delimiter, at an offset {@link scanCurvedQuotes} named.
 * The scan is the row's own gsub, so a delimiter here always belongs to a
 * real match; whether the span survives is span-pairing.ts's question.
 * @param quote - which pair this rule is for
 * @returns the rule's match function
 */
function curvedMatcher(quote: CurvedQuoteSpelling): InlineRule["match"] {
  return (text: string, index: number, scan: FragmentScan): number =>
    scan.curved.delimiters.get(index)?.quote === quote ? CURVED_WIDTH : 0;
}

/**
 * {@link markFlags}'s arguments, bundled into one object rather than
 * five positional parameters (the project's `max-params` ceiling is
 * four): what matched, where, how long, and the fragment's curved-quote
 * scan every rule was already handed. Not exported: `markFlags`'s only
 * caller (tokenize.ts) builds the object inline from values it already
 * has, so nothing needs the type by name.
 */
interface MarkFlagsInput {
  /** The kind that matched at `index`. */
  readonly type: InlineKind;
  /** The fragment being tokenized. */
  readonly text: string;
  /** Where the token starts. */
  readonly index: number;
  /** How many characters it matched. */
  readonly length: number;
  /**
   * Where the two curved-quote rows matched in this fragment
   * (curved-quotes.ts), the same scan `tokenizeInline` handed every
   * rule's `match`.
   */
  readonly curved: CurvedScan;
}

/**
 * The direction facts for a just-matched mark token: whether Ruby's
 * constrained pattern could OPEN a span here, and whether it could
 * CLOSE one. A DOUBLE mark answers `true` on both - the unconstrained
 * rows of `QUOTE_SUBS` (`\*\*(.+?)\*\*` and kin, asciidoctor.rb
 * l.444-468) test no boundary and take any content. A SUPER/SUB
 * delimiter answers `true` on both for the same reason and one more:
 * its rows are unconstrained too (asciidoctor.rb l.465-468), and
 * super-sub.ts has already settled which offsets carry a delimiter at
 * all, so there is no second question left to ask of the
 * neighbourhood. For every non-mark kind the
 * answer is undefined, and the token carries no flags.
 * @param input - what matched, where, and the fragment's curved scan
 * @returns the two flags, or undefined for a non-mark kind
 */
export function markFlags(
  input: MarkFlagsInput,
): { canOpen: boolean; canClose: boolean } | undefined {
  const { type, text, index, length, curved } = input;
  if (type === "SuperscriptMark" || type === "SubscriptMark") {
    return { canOpen: true, canClose: true };
  }
  if (type === "DoubleQuoteMark" || type === "SingleQuoteMark") {
    // Total by construction, not by defence: the token exists because a
    // rule matched this offset in this same map. Reading the side back
    // from it is a lookup, and a token that somehow had neither
    // direction would simply never pair, which is the safe answer.
    const side = curved.delimiters.get(index)?.side;
    return { canOpen: side === "open", canClose: side === "close" };
  }
  const kind = MARK_KINDS[type];
  if (kind === undefined) return undefined;
  if (length > 1) return { canOpen: true, canClose: true };
  return {
    canOpen: canOpenAt(kind, text, index, curved.view),
    canClose: canCloseAt(kind, text, index, curved.view),
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
 *
 * Returns the narrower two-parameter shape rather than
 * {@link InlineRule.match}'s three, because {@link addressAt} calls its
 * result directly with just `text` and `start` - a function with fewer
 * parameters is still a valid `match`, which is why every table entry
 * built from this still type-checks.
 * @param regex - a `v`-flag regex, anchored implicitly at the index
 * @returns the rule's match function
 */
function pattern(regex: RegExp): (text: string, index: number) => number {
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
// `stem`, `latexmath` and `asciimath` are one pattern in Ruby,
// InlineStemMacroRx (rx.rb l.551):
// `\\?(stem|(?:latex|ascii)math):([a-z]+(?:,[a-z-]+)*)?\[(#{CC_ALL}*?[^\\])\]`.
// Issue #19 added only `stem`; issue #76 adds the other two names the
// same pattern covers. The middle group - an optional subs list
// between the colon and the bracket, as in `stem:latexmath[x]` - needs
// no separate handling here: it lands in `target`, the same place a
// bare macro's empty target does, through the generic
// `name:target[attrlist]` split every row in this table already gets
// (inline-node-builder.ts's `makeInlineMacro`).
const MACRO_NAMES =
  "link|mailto|xref|image|icon|kbd|btn|menu|footnoteref|footnote|pass|stem|latexmath|asciimath";

// A hard line break, enumerated ONCE for the same reason MACRO_NAMES
// is: the HardLineBreak rule matches it and InlineText's stop
// lookahead has to refuse the very same shape, one character earlier.
//
// Ruby's HardLineBreakRx is `^(.*) \+$` (rx.rb), matched against the
// RSTRIPPED line - `Helpers.prepare_source_string` rstrips every line
// before any rule runs. This module reads the run's RAW bytes, where
// the line's trailing blanks are still there and where the last line
// of a document may have no newline at all. So the same rule spelled
// in the raw dialect is: a ` +` with nothing after it but horizontal
// blanks, up to the newline or the end of input.
//
// The blanks are consumed (they are not content); the newline is left
// for InlineNewline. The printer respells every hard break as the
// canonical " +" (HARD_BREAK_IMAGE, src/print/reflow.ts), so the wider
// image never reaches the output.
const HARD_BREAK = String.raw` \+${ASCII_HORIZONTAL_WHITESPACE.source}*(?=\n|$)`;

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
 *
 * `at` is never BEHIND `resume`. `EMAIL_ADDRESS` holds exactly one
 * `@` (neither its local class nor its domain class admits one), so
 * the next `@` the caller finds past a match's own is at or past that
 * match's end, which is what `resume` became.
 * @param text - the fragment being tokenized
 * @param at - the `@`'s offset
 * @param resume - the first offset the scan may still match at
 * @returns the match, or undefined
 */
function matchOn(text: string, at: number, resume: number): Match | undefined {
  const start = localStart(text, at, resume);
  if (start === -1) return undefined;
  const length = addressAt(text, start);
  if (length === 0) return undefined;
  // The guard is part of the match, so it guards only while it is
  // itself unconsumed - and `localStart` already floors the walk at
  // `resume`, so an unconsumed character is the only kind there is.
  // At `start === resume` the character behind is either the word's
  // own left edge (whitespace, or nothing at offset 0) or the last
  // character of the address just consumed, which `EMAIL_ADDRESS`
  // ends `[a-zA-Z]{2,5}` - never one of the three guards.
  const guarded = EMAIL_GUARD.has(text.charAt(start - 1));
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
 * Where the first offset one of the three whole-fragment scans named
 * inside `[from, limit)` is, or -1 when there is none.
 *
 * The same reason an address is not in {@link textMatcher}'s own
 * pattern applies to all three, twice over: a curved delimiter opens on
 * an ordinary `"` or `'`, a super/sub delimiter on a `^` or `~`, and a
 * character reference on a `(`, `-`, `.`, `<`, `=` or `&` - characters
 * prose is full of, so putting any of them in the lookahead would stop
 * the run at nearly every one whether or not the scan ever made a match
 * there. Driven by the scans' own offsets rather than a
 * position-by-position test, the way {@link firstAddressIn} is driven
 * by the `@`s.
 * @param offsets - the scan's offsets, in any order
 * @param from - the first offset a construct may start at
 * @param limit - the first offset that is too far
 * @returns the earliest offset in range, or -1
 */
function firstScannedOffsetIn(
  offsets: Iterable<number>,
  from: number,
  limit: number,
): number {
  let earliest = -1;
  for (const offset of offsets) {
    if (
      offset >= from &&
      offset < limit &&
      (earliest === -1 || offset < earliest)
    ) {
      earliest = offset;
    }
  }
  return earliest;
}

/**
 * The nearer of two rule cuts, `-1` meaning "no cut" for either.
 * @param left - one candidate cut offset, or -1
 * @param right - another, or -1
 * @returns the smaller of the two that is not -1, or -1 when both are
 */
function nearerCut(left: number, right: number): number {
  if (left === -1) return right;
  if (right === -1) return left;
  return Math.min(left, right);
}

/**
 * The InlineText rule: a run of ordinary characters, stopped where an
 * address or a curved-quote delimiter begins.
 *
 * The run's other stops are fixed prefixes and ride in the pattern's
 * own negative lookahead. An address is not one: it can open at any
 * word character, and whether it does is a fact about Ruby's scan
 * rather than about the characters at that position. Putting the
 * address in the lookahead anyway costs an order of magnitude on
 * ordinary prose and turns a long `@`-bearing token quadratic (both
 * measured), because the lookahead is then tried, and scans forward,
 * at every character. So the run is matched first and cut afterwards,
 * by the same scan {@link emailMatch} reads point-wise. A curved-quote
 * delimiter, a super/sub delimiter and a character reference are cut
 * the same way and for the same reason: their opening characters are
 * ordinary prose everywhere they are NOT one of those rows' matches, so
 * only the scan - not the pattern - knows where a cut is real.
 * @param source - InlineText's pattern, with no address, curved,
 *   super/sub or character-reference stop in it
 * @returns the rule's match function
 */
function textMatcher(source: string): InlineRule["match"] {
  const sticky = new RegExp(source, "vy");
  return (text: string, index: number, scan: FragmentScan): number => {
    sticky.lastIndex = index;
    const found = sticky.exec(text);
    if (found === null) return 0;
    const [run] = found;
    const { length } = run;
    // From `index + 1`: an address or a scanned construct AT `index`
    // would have been an earlier rule's, and a cut of zero is no cut.
    const from = index + 1;
    const limit = index + length;
    let cut = firstAddressIn(text, from, limit);
    for (const offsets of [
      scan.curved.delimiters.keys(),
      scan.superSub,
      scan.replacements.keys(),
    ]) {
      cut = nearerCut(cut, firstScannedOffsetIn(offsets, from, limit));
    }
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
  // "`double-quoted`" and '`single-quoted`' - QUOTE_SUBS rows 3 and 4
  // (asciidoctor.rb l.449-452). In front of MonoMark because they run
  // in front of the monospaced rows and consume the same backtick;
  // where the scan says a curved row matched, that row owns it.
  { type: "DoubleQuoteMark", match: curvedMatcher("double") },
  { type: "SingleQuoteMark", match: curvedMatcher("single") },
  { type: "MonoMark", match: markMatcher("`", "monospace") },
  { type: "HighlightMark", match: markMatcher("#", "highlight") },
  // `^superscript^` and `~subscript~` - QUOTE_SUBS rows 11 and 12
  // (asciidoctor.rb l.465-468), the last two of the table, so they sit
  // last among the mark rows here as well. Where the delimiters stand
  // is super-sub.ts's scan, not a neighbourhood test.
  //
  // BEHIND InlineMacro and InlineUrl, which is a DIVERGENCE from
  // Ruby's own pass order and a deliberate one. `sub_quotes` runs
  // before `sub_macros` (NORMAL_SUBS, substitutors.rb l.16, the list
  // `apply_subs` walks in order), so a
  // pair inside a bare URL truncates the link: `https://a.com/~u~/p`
  // renders the link as `https://a.com/` with a `<sub>u</sub>` behind
  // it. Reading the URL whole instead costs no byte - the link node
  // replays the author's characters either way, and a URL is one atom
  // the packer never breaks - and it keeps the one address a formatter
  // has to get right, the extent it prints back.
  { type: "SuperscriptMark", match: superSubMatcher("^") },
  { type: "SubscriptMark", match: superSubMatcher("~") },
  // `(C)`, `--`, `...`, `->` and the rest of the `REPLACEMENTS` table,
  // at the offsets replacements.ts's scan named - that module's header
  // cites the table and transcribes every row it reads.
  // `sub_replacements` (substitutors.rb l.282-286) runs AFTER
  // the quote pass and before the macro pass, which is why this row
  // sits behind every mark row and behind InlineMacro/InlineUrl: a
  // reference inside a construct an earlier row already claimed is
  // never offered this position at all, which is the same answer the
  // pass order reaches.
  {
    type: "CharacterReference",
    match: (text: string, index: number, scan: FragmentScan): number =>
      scan.replacements.get(index) ?? 0,
  },
  // ` +` at end of line - HardLineBreakRx, in the raw-run dialect
  // {@link HARD_BREAK} transcribes. Context-free on purpose: the one
  // shape Asciidoctor reads as a literal `+` instead is decided by the
  // reader's literal-plus rule (lines/paragraph-reader.ts), which
  // tells the caller.
  { type: "HardLineBreak", match: pattern(new RegExp(HARD_BREAK, "v")) },
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
  // The {@link HARD_BREAK} lookahead stays for the hard break, whose
  // match starts one character EARLIER, at the space; the run must
  // stop before EVERY break that rule accepts, or it takes the space
  // first and the break is gone. Ruby has no equivalent:
  // substitutors.rb rewrites the whole line with `gsub`, so
  // "everything else" is never named.
  {
    type: "InlineText",
    match: textMatcher(
      `(?:(?!https?://|(?:${MACRO_NAMES}):|${HARD_BREAK})[^\\n*_\`#\\\\\\{\\[<+])+`,
    ),
  },
];
