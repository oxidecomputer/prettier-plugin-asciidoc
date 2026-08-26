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
 * patterns (`\*\*(.+?)\*\*` and kin, asciidoctor.rb l.448-464) test
 * no boundary and take any content. For every non-mark kind the
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

// The inline macro names, enumerated ONCE: interpolated into the
// InlineMacro rule and into InlineText's stop lookahead, so the two
// spellings cannot drift (they had: `footnoteref|footnote` here,
// `footnote(?:ref)?` there — same language, two dialects).
// `footnoteref` precedes `footnote` so the longer name wins.
const MACRO_NAMES =
  "link|mailto|xref|image|kbd|btn|menu|footnoteref|footnote|pass";

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
  // `<<target>>` / `<<target,text>>` — InlineXrefMacroRx shorthand.
  { type: "XrefShorthand", match: pattern(/<<[^>\n]+(?:,[^>\n]+)?>>/v) },
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
  // stops the run BEFORE a URL, a macro name or a hard break, which
  // is how first-match-wins produces longest-match behaviour without
  // a longest-match engine. `<` is excluded so `<<ref>>` is not eaten
  // as text, and `+` so a passthrough is not: a run that swallowed the
  // `+` in `a +text+ b` would hide the opening delimiter from the
  // Passthrough rule, which is only ever tried at a position the run
  // has not already taken. The ` +\n` lookahead stays for the hard
  // break, whose match starts one character EARLIER, at the space.
  // Ruby has no equivalent: substitutors.rb rewrites the whole line
  // with `gsub`, so "everything else" is never named.
  {
    type: "InlineText",
    match: pattern(
      new RegExp(
        `(?:(?!https?://|(?:${MACRO_NAMES}):| \\+\\n)[^\\n*_\`#\\\\\\{\\[<+])+`,
        "v",
      ),
    ),
  },
];
