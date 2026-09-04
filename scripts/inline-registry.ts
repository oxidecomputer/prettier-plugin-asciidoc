/**
 * The inline registry: the generated input vocabulary for INLINE
 * syntax, the counterpart to `scripts/shape-registry.ts`.
 *
 * The line registry builds documents out of LINES and never varies
 * the text within one, so nothing it mints exercises a mark boundary,
 * an attrlist in front of a span, or an escape. This module varies
 * exactly that: three dimension classes -
 *
 * - CONSTRUCTS, one entry per row of `INLINE_RULES`
 *   (`src/parse/inline/rules.ts`), each carrying the valid spellings
 *   of its construct and the spellings that miss it by about one
 *   character;
 * - NEIGHBOURHOODS, what stands immediately before and after the
 *   construct inside one inline run - the axis every constrained mark
 *   rule reads, and the axis the line registry has no dimension for
 *   at all;
 * - CONTEXTS, which inline-bearing line the run belongs to.
 *
 * Completeness is HELD by `scripts/inline-census.ts`: a new row in
 * `INLINE_RULES` has no construct entry, and a `Record` over
 * `InlineKind` makes that a compile error before the census ever
 * runs.
 *
 * Byte operators are NOT re-declared here. The ingest bytes
 * Asciidoctor erases are one vocabulary, and inline syntax is where
 * one of them is load-bearing rather than cosmetic: a hard line break
 * IS a trailing ` +`, so the trailing-whitespace operators change
 * what a document means here where they only change bytes in the line
 * registry. `scripts/shape-registry-byte-operators.ts` is imported
 * for them.
 *
 * A LIBRARY module, not a command: the sweep
 * (`tests/conformance/inline-sweep.ts`) and the census import it. It
 * has no argument parsing and no exit code of its own.
 */
import { INLINE_KINDS, type InlineKind } from "../src/parse/inline/tokens.js";

/** One generated inline document, before the properties see it. */
export interface InlineShape {
  /** The registry coordinate, `<member>/<neighbourhood>/<context>`. */
  readonly id: string;
  /** The whole document, newline-terminated. */
  readonly input: string;
  /**
   * The failure class this shape belongs to, for the deep manifest:
   * the grid it came from, the KINDS it spells, and the axis that
   * placed them.
   *
   * Written here rather than parsed back out of the id, because here
   * is where the kind and the axis are known. The kinds rather than
   * the alphabet members: a triage decision is made about the
   * construct, not about which of its spellings reached the
   * coordinate. The individual row is still exact - a cluster
   * records the sha256 of its full sorted id list.
   */
  readonly cluster: string;
}

/**
 * How one inline construct is spelled, rightly and wrongly. Not
 * exported: the two things a consumer needs are the construct
 * dimension that extends it and the alphabet it is flattened into.
 */
interface InlineSpelling {
  /**
   * Valid spellings of the construct, canonical first. A non-empty
   * tuple: a construct dimension with no spelling would pass every
   * census rule while contributing nothing.
   */
  readonly spellings: readonly [string, ...string[]];
  /**
   * Spellings a character or so away from a valid one. The
   * almost-valid space is where classification flips live, so these
   * belong in the alphabet beside their valid twins.
   *
   * NOT a claim that the rule refuses them. Measured: 40 of the 65
   * entries here still produce a token of their own kind (`*b` is a
   * BoldMark wherever the constrained boundary lets a single mark
   * open), because "one character away from `*b*`" and "no longer a
   * bold mark" are different questions and only the first is what
   * this field selects for. What the census holds is the other list:
   * a SPELLING must tokenize to its kind (rule (ii)). These are
   * alphabet members either way, and reach every row a spelling
   * reaches.
   */
  readonly nearMisses: readonly string[];
}

/** One construct dimension: an inline rule and how to spell it. */
export interface InlineConstructEntry extends InlineSpelling {
  /** The `INLINE_RULES` row this dimension stands for. */
  readonly kind: InlineKind;
}

/** One alphabet member: a single spelling, with a stable name. */
export interface InlineAlphabetMember {
  /**
   * Stable name: the kind for the canonical spelling,
   * `<kind>-alt-<i>` for a further valid one, `<kind>-near-<i>` for a
   * near miss. Kind names carry no `-` and no `/`, so a row id parses
   * back to its kind on the first `-` or `/`.
   */
  readonly id: string;
  /** The kind this member spells, or misses. */
  readonly kind: InlineKind;
  /** The text the member contributes to a fragment. */
  readonly body: string;
}

/** What stands around a construct inside one inline run. */
export interface NeighbourhoodEntry {
  /** Stable name; the middle segment of a row id. */
  readonly id: string;
  /**
   * Build the inline run from the construct's spelling.
   * @param body - the alphabet member's text
   * @returns the whole inline run, with no trailing newline
   */
  readonly wrap: (body: string) => string;
}

/** Which inline-bearing line the run belongs to. */
export interface ContextEntry {
  /** Stable name; the last segment of a row id. */
  readonly id: string;
  /**
   * Build a whole document around the inline run.
   * @param run - the inline run
   * @returns the document, newline-terminated
   */
  readonly wrap: (run: string) => string;
}

// Every construct dimension, one per InlineKind. A Record over the
// kind type rather than an array, so a rule added to INLINE_RULES is
// a COMPILE error here before it is a census failure - the same
// device DELIMITER_PARTS uses in scripts/shape-registry.ts.
//
// `InlineChar` is the one entry that is not an INLINE_RULES row: it
// is the tokenizer's else branch for a position no rule claims
// (src/parse/inline/tokens.ts), and its spellings are therefore the
// characters that reach that branch - a mark that can neither open
// nor close a span, and the characters InlineText's own class
// excludes.
const INLINE_SPELLINGS: Record<InlineKind, InlineSpelling> = {
  Passthrough: {
    spellings: ["+p+", "++p++", "+++p+++", "$$p$$", "[x]+p+"],
    nearMisses: ["+p", "+ p +", "$$p$", "++p+"],
  },
  BackslashEscape: {
    spellings: [String.raw`\*`, String.raw`\_`, "\\`", String.raw`\#`],
    // `\^` and `\~` are the two marks this rule deliberately does not
    // take (src/ast.ts's EscapedMarkNode names the gap), so they are
    // near misses of it rather than spellings.
    nearMisses: [
      String.raw`\^`,
      String.raw`\~`,
      String.raw`\\*`,
      String.raw`\a`,
    ],
  },
  AttributeReference: {
    spellings: ["{attr}", "{counter:n}", "{a.b-c}"],
    nearMisses: ["{ attr}", "{attr", "{}", String.raw`\{attr}`],
  },
  RoleAttribute: {
    spellings: ["[r]*b*", "[r]#h#", "[r]`m`"],
    // `[r]^s^` is the shape the rule refuses: superscript is one of
    // the eight QUOTE_SUBS rows this row does not front. `[ ]#h#` is
    // the whitespace-only attrlist, which is a role to the rule and
    // no role at all to the oracle.
    nearMisses: ["[r] *b*", "[]*b*", "[ ]#h#", "[r]^s^", "[r]*b"],
  },
  InlineMacro: {
    spellings: ["footnote:[n]", "image:a.png[alt]", "kbd:[F1]", "pass:[x]"],
    nearMisses: ["foo:[n]", "footnote:[n", "footnote[n]", "footnote::[n]"],
  },
  InlineUrl: {
    spellings: ["https://e.com", "https://e.com[t]", "http://e.com/a_b_c"],
    nearMisses: ["http:/e.com", "ftp://e.com", "https://e.com[t"],
  },
  InlineEmail: {
    spellings: ["a@b.com", "a&b@c.com"],
    nearMisses: ["a@b", "@b.com", "a@b.com.", String.raw`\a@b.com`],
  },
  XrefShorthand: {
    spellings: ["<<t>>", "<<t,x>>"],
    nearMisses: ["<<t>", "<t>>", "<<>>"],
  },
  InlineBiblioAnchor: {
    spellings: ["[[[b]]]", "[[[b,R]]]"],
    nearMisses: ["[[[b]]", "[[b]]]", "[[[]]]"],
  },
  InlineAnchor: {
    spellings: ["[[a]]", "[[a,R]]"],
    nearMisses: ["[[a]", "[ [a]]", "[[]]"],
  },
  BoldMark: {
    spellings: ["*b*", "**b**"],
    // The last two are the HALVES of a doubled mark. Alone they are
    // near misses; across a pair-grid join they spell the one shape
    // where the oracle pairs an unconstrained mark over text our
    // per-fragment scan reads separately.
    nearMisses: ["*b", "b*", "* b*", "*b *", "**b*", "**b", "b**"],
  },
  ItalicMark: {
    spellings: ["_i_", "__i__"],
    nearMisses: ["_i", "_ i_", "__i_", "__i", "i__"],
  },
  DoubleQuoteMark: {
    spellings: ['"`d`"'],
    nearMisses: ['"`d"', '"d`"', '" `d` "'],
  },
  SingleQuoteMark: {
    spellings: ["'`s`'"],
    nearMisses: ["'`s'", "'s`'", "' `s` '"],
  },
  MonoMark: {
    spellings: ["`m`", "``m``"],
    nearMisses: ["`m", "` m`", "``m`", "``m", "m``"],
  },
  HighlightMark: {
    spellings: ["#h#", "##h##"],
    nearMisses: ["#h", "# h#", "##h#", "##h", "h##"],
  },
  SuperscriptMark: {
    spellings: ["^s^", "x^2^"],
    nearMisses: ["^s", "^ s^"],
  },
  SubscriptMark: {
    spellings: ["~s~", "H~2~O"],
    nearMisses: ["~s", "~ s~"],
  },
  CharacterReference: {
    spellings: ["(C)", "(R)", "(TM)", "...", "->", "=>", "--"],
    // The last near miss carries HORIZONTAL TABS around the em-dash
    // spelling, which is the one place a tab decides a rendering
    // rather than only a byte: Ruby's replacement wants a space on
    // each side, so the tabbed form renders literally and the folded
    // one renders a dash. The tab rides an alphabet member rather
    // than a neighbourhood of its own on purpose - a tabbed
    // neighbourhood would fold a tab beside every member of the
    // alphabet and fill the manifest with one whitespace behaviour
    // measured 700 times.
    nearMisses: ["( C)", "(c)", "..", "-", "a\t--\tb"],
  },
  HardLineBreak: {
    // The rule matches ` +` with nothing after it but horizontal
    // blanks up to the newline or the end of the run, so every
    // spelling here ENDS a line and the near misses are the ways that
    // trailing position is missed. The third spelling is the break
    // that OWNS its line, which reaches the printer by a different
    // route than one riding the end of a text line.
    spellings: ["w +\nx", "w +", "w\n +\nx"],
    nearMisses: ["w +x", "w+\nx", "w  +\nx"],
  },
  InlineNewline: {
    spellings: ["w\nx"],
    nearMisses: ["w \nx", "w\n\nx"],
  },
  InlineText: {
    spellings: ["plain", "two words"],
    // The last near miss is a NO-BREAK SPACE between two words: to
    // the reader it is ordinary text, and to a packer that treats it
    // as a break opportunity it is a rendering change.
    nearMisses: ["$5", "a<b", "a{b", "a\u{00A0}b"],
  },
  InlineChar: {
    // A mark no boundary lets open or close, and the characters
    // InlineText's own class excludes so an earlier rule can be
    // tried: each of these falls through every row of the table.
    spellings: ["*", "+", "<"],
    nearMisses: ["{", "\\", "#"],
  },
};

/**
 * The construct dimensions, in `INLINE_KINDS` order - which is the
 * order `INLINE_RULES` tries its rows in, so the alphabet reads in
 * priority order.
 */
export const INLINE_CONSTRUCTS: readonly InlineConstructEntry[] =
  INLINE_KINDS.map((kind) => ({ kind, ...INLINE_SPELLINGS[kind] }));

/**
 * The alphabet: every spelling and every near miss of every
 * construct, each with a stable name.
 * @returns the alphabet, in construct order
 */
export function inlineAlphabet(): readonly InlineAlphabetMember[] {
  return INLINE_CONSTRUCTS.flatMap((entry) => [
    ...entry.spellings.map((body, index) => ({
      id: index === 0 ? entry.kind : `${entry.kind}-alt-${String(index)}`,
      kind: entry.kind,
      body,
    })),
    ...entry.nearMisses.map((body, index) => ({
      id: `${entry.kind}-near-${String(index)}`,
      kind: entry.kind,
      body,
    })),
  ]);
}

// The filler the two reflow neighbourhoods pack around a construct.
// `FILLER_BEFORE` plus `FILLER_AFTER` is long enough that the default
// 80-column width has to break the line somewhere, which is the only
// way a generated row asks whether the packer may move a span's
// delimiter away from its content.
const FILLER_BEFORE = "alpha bravo charlie delta echo foxtrot golf hotel";
const FILLER_AFTER = "india juliett kilo lima mike november oscar papa quebec";

/**
 * The filler `reflow-edge` puts IN FRONT of the construct, and the
 * one word it puts behind.
 *
 * Both are measured, not chosen. The front filler plus one space plus
 * a body of {@link REFLOW_EDGE_BODY_BUDGET} characters is exactly the
 * default 80-column width, so a body within the budget still fits the
 * first line; the word behind carries no break opportunity inside it
 * and cannot fit, so the LINE BOUNDARY lands immediately after the
 * construct. Exported because the census pins that arithmetic (a
 * filler one column longer silently moves the boundary in FRONT of
 * the longest bodies, which is the opposite coordinate).
 *
 * The DOMAIN of that claim is the contexts that prefix nothing,
 * `para` and `para-tail`. A list marker, a description separator or
 * an admonition label shifts the whole run right, so in those
 * contexts the break lands earlier; those rows are still generated
 * and still assessed, they just no longer sit on the boundary this
 * dimension is named for.
 */
export const FILLER_EDGE =
  "alpha bravo charlie delta echo foxtrot golf hotel india romeo";

/**
 * The longest alphabet body `reflow-edge` can hold on its first line.
 * The census holds every member to it, so a longer spelling is a
 * failure rather than a member that silently gets the boundary on the
 * wrong side of itself.
 */
export const REFLOW_EDGE_BODY_BUDGET = 18;

const FILLER_UNBREAKABLE = "kilo-lima-mike-november-oscar-papa-quebec";

/**
 * The neighbourhood dimensions: what stands around the construct
 * inside one inline run.
 *
 * Three of them exist for a coordinate a hand-written fixture reached
 * before any generator did. `bracket-backslash` is the alphabet gap
 * the throwaway generators this registry replaces never reached (a
 * bracketed head followed by a backslash). `open-bracket` is the
 * unclosed bracket standing in front of a role attrlist, where our
 * span records a wider role than the oracle's own group takes. The
 * third is `reflow-edge`, which puts the LINE BOUNDARY immediately
 * after the construct, where a wrapped line ending in `]` re-reads as
 * block metadata; {@link FILLER_EDGE} says on what domain that
 * placement is exact.
 */
export const NEIGHBOURHOODS: readonly NeighbourhoodEntry[] = [
  { id: "bare", wrap: (body) => body },
  { id: "in-word", wrap: (body) => `a${body}b` },
  { id: "spaced", wrap: (body) => `a ${body} b` },
  { id: "escaped", wrap: (body) => `\\${body}` },
  { id: "bracketed", wrap: (body) => `[${body}]` },
  { id: "role-head", wrap: (body) => `[r]${body}` },
  { id: "open-bracket", wrap: (body) => `[a${body}` },
  { id: "bracket-backslash", wrap: (body) => `[\\${body}` },
  { id: "close-bracket", wrap: (body) => `] ${body}` },
  { id: "repeated", wrap: (body) => `${body}${body}` },
  { id: "in-bold", wrap: (body) => `*${body}*` },
  { id: "in-mono", wrap: (body) => `\`${body}\`` },
  { id: "trailing-mark", wrap: (body) => `${body} *` },
  {
    id: "reflow",
    wrap: (body) => `${FILLER_BEFORE} ${body} ${FILLER_AFTER}`,
  },
  {
    id: "reflow-edge",
    wrap: (body) => `${FILLER_EDGE} ${body} ${FILLER_UNBREAKABLE}`,
  },
];

/**
 * The context dimensions: which inline-bearing line the run sits on.
 *
 * `para-tail` is not decoration. A rule that reads its own offset
 * inside the fragment - `InlineBiblioAnchor`'s `index === 0`, and
 * every constrained mark's left boundary - answers differently on a
 * paragraph's second line, and no other dimension moves the run off
 * offset zero.
 */
export const CONTEXTS: readonly ContextEntry[] = [
  { id: "para", wrap: (run) => `${run}\n` },
  { id: "para-tail", wrap: (run) => `lead\n${run}\n` },
  { id: "item", wrap: (run) => `* ${run}\n` },
  { id: "dlist-desc", wrap: (run) => `t:: ${run}\n` },
  { id: "section-title", wrap: (run) => `== ${run}\n` },
  { id: "block-title", wrap: (run) => `.${run}\npara\n` },
  { id: "admonition", wrap: (run) => `NOTE: ${run}\n` },
  { id: "cell", wrap: (run) => `|===\n|${run}\n|===\n` },
];

/**
 * The standing grid: every alphabet member, in every neighbourhood,
 * in every context.
 *
 * Deduplicated on the realized document, because a near miss can
 * coincide with another member's spelling once a neighbourhood has
 * wrapped it (`*` in `in-bold` is `***`, and so is `*` repeated with
 * a mark behind it). A duplicate would run the same bytes twice under
 * two ids and let one of them fail while the other did not,
 * which is the one thing an exact manifest cannot express.
 * @returns the realized rows, in a stable order
 */
export function inlineStandingGrid(): InlineShape[] {
  const shapes: InlineShape[] = [];
  const seen = new Set<string>();
  for (const member of inlineAlphabet()) {
    for (const neighbourhood of NEIGHBOURHOODS) {
      for (const context of CONTEXTS) {
        const input = context.wrap(neighbourhood.wrap(member.body));
        if (seen.has(input)) {
          continue;
        }
        seen.add(input);
        shapes.push({
          id: `${member.id}/${neighbourhood.id}/${context.id}`,
          input,
          cluster: `standing/${member.kind}/${neighbourhood.id}`,
        });
      }
    }
  }
  return shapes;
}

/** How two alphabet members meet inside one inline run. */
const PAIR_JOINS: ReadonlyArray<{
  /** Stable name; a segment of the pair row's id. */
  readonly id: string;
  /** What stands between the two members. */
  readonly glue: string;
}> = [
  { id: "adjacent", glue: "" },
  { id: "spaced", glue: " " },
  { id: "bracket", glue: "][" },
  // A comment line the reader keeps INSIDE the paragraph. The
  // whole-fragment scans (doubled marks, curved quotes) have to
  // decide whether a pair reaches across it, where the oracle's own
  // quote pass runs on a line the comment never interrupted.
  { id: "comment", glue: "\n// c\n" },
];

/** The pair joins' ids, for the census's roster rule. */
export const PAIR_JOIN_IDS: readonly string[] = PAIR_JOINS.map(
  (join) => join.id,
);

/**
 * The contexts pairs run in. A subset, because the pair product is
 * quadratic in the alphabet where the standing grid is linear: one
 * unconfined line, one confined by a list marker, one confined by a
 * cell delimiter.
 *
 * Exported for the census's roster rule. Without one, a rename in
 * {@link CONTEXTS} would drop a context out of this filter and shrink
 * the pair grid, and the only gate that noticed would be the
 * grid-size pin, whose message points at the grid rather than at the
 * rename.
 */
export const PAIR_CONTEXT_IDS: ReadonlySet<string> = new Set([
  "para",
  "item",
  "cell",
]);

/**
 * Alphabet members the PAIR grid leaves out, each with the reason.
 *
 * A member belongs here when its verdict is decided by something that
 * is not the pairing: the pair grid asks whether two constructs
 * standing in one run read differently than either does alone, and a
 * member that fails on its own fails beside all 145 others as well,
 * for a reason the standing grid has already recorded once. Measured:
 * the tabbed em-dash spelling accounts for 2,189 of 2,199 pair
 * failures, all of them the same whitespace fold.
 *
 * TWO GUARDS, and they are not the same guard. A STALE entry - one
 * naming a member the alphabet no longer has - is caught by name, in
 * the census's rule (v). A NEW entry is caught by the pair grid-size
 * pin: excluding a member removes its rows, the realized count moves,
 * and rule (vi) fails until the pin is moved deliberately in the same
 * change. Rule (v) also reports an excluded member whose body still
 * appears in a realized pair input, but that is a SUBSTRING check and
 * it is vacuous for an entry whose body no other member contains (as
 * this one's does not), so the pin is what a reader should look for.
 */
export const PAIR_EXCLUSIONS: ReadonlyMap<string, string> = new Map([
  [
    "CharacterReference-near-4",
    "the tabbed em-dash spelling: its verdict is the tab-to-space fold, which the standing grid already records at every neighbourhood, and which would otherwise decide 99% of this grid's rows",
  ],
]);

/**
 * The pair grid: any two alphabet members inside ONE inline run.
 *
 * This is the dimension that found the bidirectional mark corruption
 * the throwaway generators turned up (issues #85, #88): a span whose
 * printing is correct on its own stops being correct when a second
 * span stands beside it, because the two answer to the same
 * whole-fragment scans. Nothing in the standing grid asks that
 * question, and nothing in the line registry can.
 * @returns the realized rows, in a stable order
 */
export function inlinePairGrid(): InlineShape[] {
  const alphabet = inlineAlphabet().filter(
    (member) => !PAIR_EXCLUSIONS.has(member.id),
  );
  const contexts = CONTEXTS.filter((context) =>
    PAIR_CONTEXT_IDS.has(context.id),
  );
  const shapes: InlineShape[] = [];
  const seen = new Set<string>();
  for (const first of alphabet) {
    for (const second of alphabet) {
      for (const join of PAIR_JOINS) {
        for (const context of contexts) {
          const input = context.wrap(first.body + join.glue + second.body);
          if (seen.has(input)) {
            continue;
          }
          seen.add(input);
          shapes.push({
            id: `pair/${first.id}/${second.id}/${join.id}/${context.id}`,
            input,
            cluster: `pair/${first.kind}/${second.kind}/${join.id}`,
          });
        }
      }
    }
  }
  return shapes;
}
