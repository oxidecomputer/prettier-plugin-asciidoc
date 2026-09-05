/**
 * The spelling variants the confluence gate compares, and the
 * candidates it deliberately leaves outside its domain.
 *
 * A VARIANT is a pair of source fragments that say the same thing in
 * two spellings. The gate places each pair in every reader state a
 * block can stand in, renders both through the oracle to prove they
 * really are render-equal, formats both, and requires the same bytes
 * out. So the tables here are the axis roster: what the formatter is
 * being asked to canonicalize.
 *
 * Every axis is derived from the reader's own vocabulary rather than
 * sampled. The delimiter rows come from `DELIMITER_SOURCES`
 * (src/parse/line-shapes.ts) one per key whose pattern admits a run
 * longer than the tip; the marker rows from the style keys
 * `listMarkerStyle` resolves onto (LIST_MARKER_STYLES,
 * reader-context-space.ts), grouped into the classes Asciidoctor
 * renders alike; the section rows from `SETEXT_LEVEL_MARKS`. Where an
 * axis covers less than its whole vocabulary the row says why.
 *
 * {@link RENDER_RELEVANT} is the other half of the same question. A
 * candidate variation that turns out to CHANGE the render is not a
 * confluence exception at all - it is outside the property, and the
 * formatter keeping the two spellings apart is correctness rather
 * than a debt. Each row there is asserted non-render-equal by the
 * gate, so the exclusion is measured on every run instead of assumed.
 */
import {
  DELIMITER_KINDS,
  type DelimiterKind,
} from "../../src/parse/line-shapes.js";

/**
 * One render-equal spelling pair, as document body text. Neither side
 * carries a trailing newline; the placement adds what it needs.
 */
export interface Variant {
  /** Unique within its axis; half of the pair id the gate reports. */
  readonly id: string;
  /** One spelling. */
  readonly left: string;
  /** The other spelling of the same content. */
  readonly right: string;
  /**
   * Which placements the fragment may stand in.
   *
   * `everyBlockStart` is the default and the whole point: the state
   * axis is exhaustive there. `document` is for fragments whose
   * reading is decided by what already surrounds them, where a
   * placement would make the pair unequal for a reason that is not
   * the formatter's. Two kinds qualify, and each row says which it
   * is: a LIST fragment, whose markers are read against the list the
   * placement already opened (a nested `*` run continues the
   * enclosing `*` list where a `-` run opens a child of it); and a
   * SECTION TITLE, which is document structure and is not a section
   * at all inside an item's continuation.
   */
  readonly stands: "document" | "everyBlockStart";
}

// A delimited block of `kind`, spelled at `length` repeats of its tip
// character, wrapped around `body`. The tip runs are what
// DELIMITER_SOURCES spells `-{4,}` and its kin; the four table rows
// are a hint character then `={3,}`.
const DELIMITED: Readonly<
  Partial<Record<DelimiterKind, { tip: string; minimum: number; body: string }>>
> = {
  listing: { tip: "-", minimum: 4, body: "code" },
  literal: { tip: ".", minimum: 4, body: "code" },
  pass: { tip: "+", minimum: 4, body: "code" },
  example: { tip: "=", minimum: 4, body: "body text" },
  sidebar: { tip: "*", minimum: 4, body: "body text" },
  quote: { tip: "_", minimum: 4, body: "body text" },
  commentBlock: { tip: "/", minimum: 4, body: "dropped" },
  openBlockTilde: { tip: "~", minimum: 4, body: "body text" },
  tablePipe: { tip: "=", minimum: 3, body: "|a" },
  tableComma: { tip: "=", minimum: 3, body: "a,b" },
  tableColon: { tip: "=", minimum: 3, body: "a:b" },
  tableBang: { tip: "=", minimum: 3, body: "!a" },
};

// The hint character in front of a table delimiter's `=` run; the
// non-table kinds have none.
const TABLE_HINTS: Readonly<Partial<Record<DelimiterKind, string>>> = {
  tablePipe: "|",
  tableComma: ",",
  tableColon: ":",
  tableBang: "!",
};

/**
 * The delimiter kinds whose spelling has no length to vary, with the
 * reason from `DELIMITER_SOURCES` (src/parse/line-shapes.ts).
 *
 * The gate holds {@link DELIMITED} and this set to a partition of
 * `DELIMITER_KINDS`, so a new delimited block joins the axis or
 * declares itself fixed-length; it cannot arrive uncovered.
 */
export const FIXED_LENGTH_DELIMITERS: ReadonlySet<DelimiterKind> =
  new Set<DelimiterKind>([
    // `--` exactly, no run (parser.rb l.976-1010).
    "openBlock",
    // ```` ```(?!`) ````: a fourth backtick is refused, so three is the
    // only spelling. What follows is a language hint, not more fence.
    "fencedCode",
  ]);

// A delimited block of `kind` at `length` tip characters.
const delimitedAt = (kind: DelimiterKind, length: number): string => {
  const { [kind]: spec } = DELIMITED;
  if (spec === undefined) {
    throw new Error(`no delimited spec for ${kind}`);
  }
  const { [kind]: hint = "" } = TABLE_HINTS;
  const line = hint + spec.tip.repeat(length);
  return `${line}\n${spec.body}\n${line}`;
};

/**
 * Delimiter length: the tip run at its minimum against the same block
 * spelled two characters longer. Asciidoctor reads both as the same
 * block, so the length is spelling and nothing else.
 * @returns one variant per length-varying delimiter kind
 */
function delimiterLengthVariants(): Variant[] {
  return DELIMITER_KINDS.filter(
    (kind) => !FIXED_LENGTH_DELIMITERS.has(kind),
  ).map((kind) => ({
    id: kind,
    left: delimitedAt(kind, DELIMITED[kind]?.minimum ?? 0),
    right: delimitedAt(kind, (DELIMITED[kind]?.minimum ?? 0) + 2),
    stands: "everyBlockStart",
  }));
}

/**
 * Marker spelling: the styles Asciidoctor resolves to the same list.
 *
 * The unordered markers are one class at each nesting depth (the
 * bullet character Asciidoctor renders is the DEPTH's, not the
 * marker's), and the ordered dot run and the explicit arabic form are
 * one class because `1.` resolves to style `1.` and a single dot to
 * arabic numbering as well. The other explicit families
 * (`a.`, `A.`, `i)`, `I)`) each render their own numeration, so no
 * two of them are render-equal and none joins a class here.
 */
const MARKER_VARIANTS: readonly Variant[] = [
  {
    id: "ulist-star-dash",
    left: "* one\n* two",
    right: "- one\n- two",
    stands: "document",
  },
  {
    id: "ulist-star-bullet",
    left: "* one\n* two",
    right: "\u{2022} one\n\u{2022} two",
    stands: "document",
  },
  {
    id: "ulist-nested-star-dash",
    left: "* one\n** two",
    right: "* one\n- two",
    stands: "document",
  },
  {
    id: "olist-dot-arabic",
    left: ". one\n. two",
    right: "1. one\n2. two",
    stands: "document",
  },
  {
    id: "olist-nested-dot-arabic",
    left: ". one\n.. two",
    right: "1. one\n.. two",
    stands: "document",
  },
  // An auto-numbered callout (`<.>`) and the explicit `<1>` are the
  // same colist entry; CALLOUT_STYLE is one style for both.
  {
    id: "callout-explicit-auto",
    left: "----\nx // <1>\n----\n\n<1> note",
    right: "----\nx // <1>\n----\n\n<.> note",
    stands: "everyBlockStart",
  },
];

/**
 * Section title spelling: the one-line form against the underlined
 * one, at every level `SETEXT_LEVEL_MARKS` spells past the doctitle,
 * plus the closed one-line form and the underline's own length.
 *
 * Level 0 is ABSENT on purpose: an underlined doctitle sets
 * `compat-mode` document-wide (`DocumentHeaderNode.underline`,
 * src/ast.ts), so the two spellings render differently. It is a
 * {@link RENDER_RELEVANT} row instead. A level-0 underlined heading
 * that is NOT the header sets nothing, so it belongs here.
 */
const SECTION_VARIANTS: readonly Variant[] = [
  // `SETEXT_LEVEL_MARKS` is "=-~^+": one row per mark past the `=`
  // the doctitle owns, each against the one-line form of its level.
  {
    id: "atx-setext-1",
    left: "== Title",
    right: "Title\n-----",
    stands: "document",
  },
  {
    id: "atx-setext-2",
    left: "=== Title",
    right: "Title\n~~~~~",
    stands: "document",
  },
  {
    id: "atx-setext-3",
    left: "==== Title",
    right: "Title\n^^^^^",
    stands: "document",
  },
  {
    id: "atx-setext-4",
    left: "===== Title",
    right: "Title\n+++++",
    stands: "document",
  },
  // The underline is admitted within one character of the title
  // (`parse_section_title`), so these are the two lengths either
  // spelling can take. Shorter than that is a paragraph, not a title.
  {
    id: "setext-underline-length",
    left: "Title\n-----",
    right: "Title\n------",
    stands: "document",
  },
  {
    id: "atx-closed",
    left: "== Title",
    right: "== Title ==",
    stands: "document",
  },
  // A discrete level-0 heading is a heading, not the document header,
  // so its underline sets no attribute and the forms are equal.
  {
    id: "discrete-level-0",
    left: "[discrete]\n= Title",
    right: "[discrete]\nTitle\n=====",
    stands: "document",
  },
];

/**
 * Attribute spelling: the separators and padding an attribute list or
 * an attribute entry admits without changing what it sets.
 *
 * The padding INSIDE the brackets is only tested after the first
 * character: `[ source]` is not a block attribute line at all
 * (`BlockAttributeLineRx` refuses the leading space), so that
 * spelling renders differently and is a {@link RENDER_RELEVANT} row.
 */
const ATTRIBUTE_VARIANTS: readonly Variant[] = [
  {
    id: "attrlist-comma-space",
    left: "[source,ruby]\n----\nx\n----",
    right: "[source, ruby]\n----\nx\n----",
    stands: "everyBlockStart",
  },
  {
    id: "attrlist-quoted-positional",
    left: "[source,ruby]\n----\nx\n----",
    right: '[source,"ruby"]\n----\nx\n----',
    stands: "everyBlockStart",
  },
  {
    id: "attrlist-named-space",
    left: "[quote,who,from]\n____\nx\n____",
    right: "[quote, who, from]\n____\nx\n____",
    stands: "everyBlockStart",
  },
  {
    id: "attrentry-value-space",
    left: ":name: value\n\n{name}",
    right: ":name:   value\n\n{name}",
    stands: "everyBlockStart",
  },
  // `:name!:` and `:!name:` are the two spellings of one unset.
  {
    id: "attrentry-unset-form",
    left: ":name!:\n\ntext",
    right: ":!name:\n\ntext",
    stands: "everyBlockStart",
  },
];

/**
 * Blank-count and thematic-break spelling: the two axes where the
 * reader collapses a run outright.
 *
 * A blank run between blocks is a separator whatever its length, and
 * the four thematic-break spellings (`'''` and the three Markdown
 * marks) all render one `<hr>`. The spaced Markdown forms (`- - -`)
 * are absent because the registry leaves them as text (THEMATIC_BREAK,
 * src/parse/line-shapes.ts) - a conformance question, not this one.
 */
const COLLAPSE_VARIANTS: readonly Variant[] = [
  {
    id: "blank-run-two",
    left: "a\n\nb",
    right: "a\n\n\nb",
    stands: "everyBlockStart",
  },
  {
    id: "blank-run-four",
    left: "a\n\nb",
    right: "a\n\n\n\n\nb",
    stands: "everyBlockStart",
  },
  {
    id: "thematic-hyphen",
    left: "a\n\n'''\n\nb",
    right: "a\n\n---\n\nb",
    stands: "everyBlockStart",
  },
  {
    id: "thematic-asterisk",
    left: "a\n\n'''\n\nb",
    right: "a\n\n***\n\nb",
    stands: "everyBlockStart",
  },
  {
    id: "thematic-underscore",
    left: "a\n\n'''\n\nb",
    right: "a\n\n___\n\nb",
    stands: "everyBlockStart",
  },
  // `PAGE_BREAK` is `<{3,}`: the run past three is spelling.
  {
    id: "page-break-length",
    left: "<<<",
    right: "<<<<<",
    stands: "everyBlockStart",
  },
];

/**
 * Inline spelling: the marks and macros that reach the same inline
 * node by two routes.
 *
 * Each quoted form has a CONSTRAINED and an UNCONSTRAINED spelling
 * (`*b*` and `**b**`, and their kin in src/parse/inline/rules.ts);
 * away from a word boundary the two are one node. A bare URL and the
 * `link:` macro around the same address are likewise one anchor.
 */
const INLINE_VARIANTS: readonly Variant[] = [
  {
    id: "strong-marks",
    left: "a *bold* b",
    right: "a **bold** b",
    stands: "everyBlockStart",
  },
  {
    id: "emphasis-marks",
    left: "a _it_ b",
    right: "a __it__ b",
    stands: "everyBlockStart",
  },
  {
    id: "monospace-marks",
    left: "a `c` b",
    right: "a ``c`` b",
    stands: "everyBlockStart",
  },
  {
    id: "mark-marks",
    left: "a #h# b",
    right: "a ##h## b",
    stands: "everyBlockStart",
  },
  {
    id: "url-macro",
    left: "see https://example.com here",
    right: "see link:https://example.com[] here",
    stands: "everyBlockStart",
  },
];

/**
 * Block form: two spellings that open the same block.
 *
 * A block anchor is `[[id]]` or the `[#id]` attribute shorthand, and
 * an admonition is the `NOTE: ` label or the `[NOTE]` style over an
 * ordinary paragraph. Both pairs are one block to Asciidoctor.
 */
export const BLOCK_FORM_VARIANTS: readonly Variant[] = [
  // A psv cell's leading whitespace is not cell text: `|a |b` and
  // `| a | b` are the same two cells.
  {
    id: "table-cell-padding",
    left: "|===\n|a |b\n|===",
    right: "|===\n| a | b\n|===",
    stands: "everyBlockStart",
  },
  {
    id: "anchor-form",
    left: "[[id]]\npara",
    right: "[#id]\npara",
    stands: "everyBlockStart",
  },
  {
    id: "admonition-form",
    left: "NOTE: text here",
    right: "[NOTE]\ntext here",
    stands: "everyBlockStart",
  },
];

/** Every block-shaped axis, keyed by the name the gate reports. */
export const BLOCK_VARIANTS: Readonly<Record<string, readonly Variant[]>> = {
  delimiterLength: delimiterLengthVariants(),
  markerSpelling: MARKER_VARIANTS,
  sectionTitleSpelling: SECTION_VARIANTS,
  attributeSpelling: ATTRIBUTE_VARIANTS,
  collapsedRun: COLLAPSE_VARIANTS,
  inlineSpelling: INLINE_VARIANTS,
  blockFormSpelling: BLOCK_FORM_VARIANTS,
};

/**
 * The join axis: word sequences the gate breaks across source lines
 * at every internal position.
 *
 * Reflow packs a paragraph's words into lines of its own, so WHERE
 * the author's breaks fell is spelling by definition - the same words
 * in the same order. Each seed carries a word the classifier reads as
 * block syntax at the head of a line, because that is where the
 * printer's hazard nets and held breaks make their decisions; a seed
 * of ordinary words exercises the packer and nothing else.
 *
 * The seeds are held to render-equality by the gate like every other
 * pair, which is what rules out a seed whose break changes the
 * reading (`* x` opening a list, say) rather than its layout.
 */
export const JOIN_SEEDS: ReadonlyArray<{ id: string; words: string }> = [
  { id: "plain", words: "alpha beta gamma delta" },
  { id: "open-delimiter", words: "value is -- a dash -- inside" },
  { id: "ordered-marker", words: "see the 1. item here" },
  { id: "block-title", words: "a .title thing here" },
  { id: "attribute-line", words: "x [source] y here" },
  { id: "anchor", words: "foo [[bar]] baz here" },
  { id: "listing-delimiter", words: "one ---- two three" },
  { id: "ulist-marker", words: "* not at start here" },
  { id: "dlist-separator", words: "some term:: def here" },
  { id: "thematic-break", words: "text ''' more text" },
  { id: "passthrough", words: "text +++ pass +++ here" },
];

/**
 * Candidate variations that CHANGE the render, with the measurement
 * that puts them outside the confluence property.
 *
 * These are not exceptions. A formatter that collapsed either
 * spelling onto the other would be editing the document, so keeping
 * them apart is the safety condition doing its job. The gate asserts
 * each row is non-render-equal, which is the reason itself: if a row
 * ever becomes render-equal the argument for excluding it is gone and
 * the gate says so.
 */
export const RENDER_RELEVANT: ReadonlyArray<{
  id: string;
  reason: string;
  left: string;
  right: string;
}> = [
  {
    id: "doctitle-underline",
    // `parse_document_header` sets `compat-mode` unless the doctitle
    // is ATX (parser.rb l.160-61), and under compat mode `'x'` is
    // emphasis document-wide (`DocumentHeaderNode.underline`,
    // src/ast.ts).
    reason: "an underlined doctitle sets compat-mode on the whole document",
    left: "= Title\n\n'emphasis' and +content+\n",
    right: "Title\n=====\n\n'emphasis' and +content+\n",
  },
  {
    id: "attrlist-leading-space",
    reason:
      "BlockAttributeLineRx refuses a space after the bracket, so the padded spelling is paragraph text",
    left: "[source,ruby]\n----\nx\n----\n",
    right: "[ source,ruby ]\n----\nx\n----\n",
  },
  {
    id: "setext-underline-too-short",
    reason:
      "an underline more than one character shorter than the title is not a section title",
    left: "== Title\n\nbody\n",
    right: "Title\n---\n\nbody\n",
  },
  {
    id: "whitespace-run-around-substitution",
    // Issue #167: the runs flanking a substituted em dash are what
    // makes the dash render as one, so collapsing them changes the
    // render. This is why the printer keeps whitespace runs it cannot
    // prove inert, and why that keeping is not a confluence debt.
    reason:
      "a whitespace run flanking an attribute substitution is render-relevant (issue #167)",
    left: ":d: --\n\nSee a  {d} b\n",
    right: ":d: --\n\nSee a {d} b\n",
  },
  {
    id: "whitespace-run-in-code-span",
    reason: "a whitespace run inside a code span is visible (issue #32)",
    left: "a `x  y` b\n",
    right: "a `x y` b\n",
  },
];
