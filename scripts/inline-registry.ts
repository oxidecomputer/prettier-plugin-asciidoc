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
 * The header that gives {@link CANONICAL_ATTRIBUTE_REFERENCE_ID}'s
 * spelling something to expand to.
 *
 * `--` is not a placeholder; it is the reproduction the #149 fix
 * itself measured. `NORMAL_SUBS` substitutes attributes before it
 * substitutes replacements (`:attributes` before `:replacements`,
 * substitutors.rb:16), so a reference whose value is `--` puts two
 * literal hyphens into the run at print time, no earlier - the text a
 * whole-fragment scan (the em-dash replacement's own rule) reads
 * never existed at parse time, only at render time, in a text node
 * this tree does not hold. Ruby's em-dash rule reads exactly one
 * ASCII space flanking a substituted `--`; a tab does not qualify, so
 * a formatter that folds a whitespace run standing beside the
 * reference into a plain space turns bytes that render literally into
 * an actual dash. Every generated document a row of this alphabet
 * member reaches gets this header, so the expansion is live wherever
 * the construct's own boundary meets a neighbour - which is the axis
 * `AttributeReference` exists to test and no other member can stand
 * in for.
 *
 * The other two `AttributeReference` spellings need no header:
 * `{counter:n}` is a self-initializing counter that expands with no
 * definition at all, so it was never vacuous, and `{a.b-c}` is not a
 * reference the oracle recognizes in the first place - Ruby's
 * `AttributeReferenceRx` (rx.rb:153) takes a name of `\p{Word}` and
 * hyphen only, no dot, so `{a.b-c}` reaches Asciidoctor as literal
 * text regardless of what is defined. That spelling is this
 * tokenizer's own regex accepting a dot Ruby's does not - a
 * classification gap in `src/parse/inline/rules.ts`, not a definable
 * one here.
 */
const ATTRIBUTE_REFERENCE_HEADER = ":attr: --\n\n";

/** The alphabet id {@link ATTRIBUTE_REFERENCE_HEADER} answers. */
const CANONICAL_ATTRIBUTE_REFERENCE_ID = "AttributeReference";

/** The body {@link ATTRIBUTE_REFERENCE_HEADER} was written to answer. */
const CANONICAL_ATTRIBUTE_REFERENCE_BODY = "{attr}";

// Fails at import time, loudest possible: attributeHeaderFor arms the
// header by ID, not by body, so a reorder of AttributeReference's
// spellings tuple would silently move the canonical ID onto a
// different body and reintroduce the vacuous rows #151 closed.
if (
  INLINE_SPELLINGS.AttributeReference.spellings[0] !==
  CANONICAL_ATTRIBUTE_REFERENCE_BODY
) {
  throw new Error(
    `inline registry: AttributeReference's first spelling is ${JSON.stringify(INLINE_SPELLINGS.AttributeReference.spellings[0])}, not ${JSON.stringify(CANONICAL_ATTRIBUTE_REFERENCE_BODY)} - ATTRIBUTE_REFERENCE_HEADER defines :attr: for that exact body; move the header's attribute name with the reorder`,
  );
}

/**
 * The header to prepend for one alphabet member's realized document,
 * or the empty string when the member's construct needs no
 * definition to mean something.
 * @param ids - the alphabet member id(s) landing in this document
 * @returns the header text, or `""`
 */
function attributeHeaderFor(...ids: readonly string[]): string {
  return ids.includes(CANONICAL_ATTRIBUTE_REFERENCE_ID)
    ? ATTRIBUTE_REFERENCE_HEADER
    : "";
}

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
    const header = attributeHeaderFor(member.id);
    for (const neighbourhood of NEIGHBOURHOODS) {
      for (const context of CONTEXTS) {
        const input = header + context.wrap(neighbourhood.wrap(member.body));
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
  // A REPLACEMENT standing between the two members, with the tabs that
  // refuse it. This is the one join that is itself a construct, and it
  // is a join rather than a third member because the class it spells
  // is "a construct on each side of the reference": the em-dash row
  // (`(?: |\n|^|\\)--(?: |\n|$)`, asciidoctor.rb l.498) reads the one
  // character beside the dashes, both of those characters here sit at
  // an inline NODE boundary, and folding either of them is what turns
  // the tabbed spelling into the replacement (issue #145). The pair
  // product supplies the constructs; nothing else in either grid can
  // put one on both sides of a reference.
  { id: "tab-dash", glue: "\t--\t" },
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
 * The pair grid: any two alphabet members inside ONE inline run.
 *
 * This is the dimension that found the bidirectional mark corruption
 * the throwaway generators turned up (issues #85, #88): a span whose
 * printing is correct on its own stops being correct when a second
 * span stands beside it, because the two answer to the same
 * whole-fragment scans. Nothing in the standing grid asks that
 * question, and nothing in the line registry can.
 *
 * EVERY alphabet member pairs: no filter stands in front of the
 * alphabet, because a filter here hides rows this grid exists to
 * find, and a member whose verdict is decided by something other than
 * the pairing costs rows rather than hiding them. The pair grid-size
 * pin in `scripts/inline-census.ts` is the guard: any filter added
 * here shrinks the realized count and fails that pin.
 * @returns the realized rows, in a stable order
 */
export function inlinePairGrid(): InlineShape[] {
  const alphabet = inlineAlphabet();
  const contexts = CONTEXTS.filter((context) =>
    PAIR_CONTEXT_IDS.has(context.id),
  );
  const shapes: InlineShape[] = [];
  const seen = new Set<string>();
  for (const first of alphabet) {
    for (const second of alphabet) {
      const header = attributeHeaderFor(first.id, second.id);
      for (const join of PAIR_JOINS) {
        for (const context of contexts) {
          const input =
            header + context.wrap(first.body + join.glue + second.body);
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
