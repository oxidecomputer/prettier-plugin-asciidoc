/**
 * The shape registry: the shared input vocabulary for shape-level
 * verification (spec D7.1, owner addendum). Three dimension classes —
 * containers (where a construct sits), constructs (everything
 * line-shapes.ts knows, one dimension per rule), perturbations
 * (terminations, codas, garnishes, and for every valid spelling its
 * near-misses) — each entry a named, DETERMINISTIC string generator.
 * The list-run grid lives in its sibling module,
 * scripts/shape-registry-list-run.ts, built from this file's Shape
 * vocabulary.
 *
 * Two consumption modes are designed for; β ships mode (1) only:
 * (1) deterministic exhaustive matrices (`scripts/shape-diff.ts`);
 * (2) weighted sampling for a later fuzzer rewrite — a named follow-on
 * OUT of β (spec D9): the dimension shape is merely built so that
 * consumer can be added without reshaping it. No weights, no sampling
 * machinery here.
 *
 * Completeness is HELD by `scripts/metrics/shape-census.ts` (a
 * `bun run metrics` gate): every `DELIMITER_KINDS` entry needs a
 * delimiter dimension, and every line-shapes.ts runtime export name
 * needs a dimension declaring `covers` or an in-gate exemption — a
 * parser that learns a new construct is thereby FORCED to teach these
 * generators (or write the exemption down) in the same commit.
 */
import {
  DELIMITER_KINDS,
  type DelimiterKind,
} from "../src/parse/line-shapes.js";

/** Where a construct sits: wraps a construct's lines into a document. */
export interface ContainerEntry {
  /** Stable name; shape ids are `kind/container/perturbation`. */
  readonly id: string;
  /** Embed the construct (no trailing newline) into a full document. */
  readonly wrap: (body: string) => string;
}

/** One construct dimension — a line shape the parser knows. */
export interface ConstructEntry {
  /** Stable name. */
  readonly id: string;
  /** The `DELIMITER_KINDS` entry this dimension is for (rule (i)). */
  readonly delimiter?: DelimiterKind;
  /** line-shapes.ts runtime export names this dimension covers (rule (ii)). */
  readonly covers?: readonly string[];
  /** The construct's canonical spelling, `\n`-joined lines. */
  readonly body: string;
  /** Spellings that miss the grammar by about one character. */
  readonly nearMisses: readonly string[];
}

/**
 * One delimited-block perturbation: how the block ends, and what rides
 * inside or after it.
 */
export interface PerturbationEntry {
  /** Stable name. */
  readonly id: string;
  /**
   * Build the block's lines from its parts; `document` post-processes
   * the whole wrapped document (the EOF toggle). Returning undefined
   * prunes the combination.
   */
  readonly block: (parts: DelimiterParts) => string | undefined;
  /** Whole-document rewrite applied after wrapping, if any. */
  readonly document?: (wrapped: string) => string;
}

/** The pieces a delimited-block perturbation composes. */
export interface DelimiterParts {
  /** The opening delimiter line. */
  readonly open: string;
  /** The closing delimiter line (the bare tip for a fence). */
  readonly close: string;
  /** One line of interior content. */
  readonly content: string;
  /** A longer same-character delimiter line, for the nesting rows. */
  readonly longer: string;
  /** A near-miss of the terminator, for the near-miss rows. */
  readonly nearMiss: string;
}

// One row per DELIMITER_KINDS entry (the census's rule (i) checks the
// derived list below against the imported array — a Record over the
// kind type makes a missing kind a compile error first).
const DELIMITER_PARTS: Record<DelimiterKind, DelimiterParts> = {
  listing: {
    open: "----",
    close: "----",
    content: "foo",
    longer: "-----",
    nearMiss: "---",
  },
  literal: {
    open: "....",
    close: "....",
    content: "foo",
    longer: ".....",
    nearMiss: "...",
  },
  pass: {
    open: "++++",
    close: "++++",
    content: "foo",
    longer: "+++++",
    nearMiss: "+++",
  },
  example: {
    open: "====",
    close: "====",
    content: "inner",
    longer: "=====",
    nearMiss: "===",
  },
  sidebar: {
    open: "****",
    close: "****",
    content: "inner",
    longer: "*****",
    nearMiss: "***",
  },
  quote: {
    open: "____",
    close: "____",
    content: "inner",
    longer: "_____",
    nearMiss: "___",
  },
  commentBlock: {
    open: "////",
    close: "////",
    content: "x",
    longer: "/////",
    nearMiss: "///",
  },
  openBlock: {
    open: "--",
    close: "--",
    content: "inner",
    longer: "---",
    nearMiss: "-- x",
  },
  fencedCode: {
    open: "```",
    close: "```",
    content: "foo",
    longer: "````",
    nearMiss: "``x",
  },
  tablePipe: {
    open: "|===",
    close: "|===",
    content: "|a",
    longer: "|====",
    nearMiss: "|==",
  },
  tableComma: {
    open: ",===",
    close: ",===",
    content: "a,b",
    longer: ",====",
    nearMiss: ",==",
  },
  tableColon: {
    open: ":===",
    close: ":===",
    content: "a:b",
    longer: ":====",
    nearMiss: ":==",
  },
  tableBang: {
    open: "!===",
    close: "!===",
    content: "!a",
    longer: "!====",
    nearMiss: "!==",
  },
};

/**
 * The delimiter dimensions, DERIVED from the imported kind list —
 * never copied — so a new kind reaches the grid the moment the
 * registry compiles (spec D7.1).
 */
export const DELIMITER_CONSTRUCTS: readonly ConstructEntry[] =
  DELIMITER_KINDS.map((kind) => {
    const { open, close, content, nearMiss } = DELIMITER_PARTS[kind];
    return {
      id: `delimiter-${kind}`,
      delimiter: kind,
      body: `${open}\n${content}\n${close}`,
      nearMisses: [nearMiss, `${open}x`, ` ${open}`],
    };
  });

/**
 * Every non-delimiter construct dimension, each covering the
 * line-shapes.ts runtime export(s) it exercises (the census's rule
 * (ii) reconciles the `covers` names against the module's actual
 * export list — both directions).
 */
export const OTHER_CONSTRUCTS: readonly ConstructEntry[] = [
  {
    id: "block-anchor",
    covers: ["BLOCK_ANCHOR"],
    body: "[[id]]",
    nearMisses: ["[[id", "[[3-blind-mice]]", "[[illegal$id]]"],
  },
  {
    id: "attrlist",
    covers: ["BLOCK_ATTRIBUTE_LINE"],
    body: "[.role]",
    nearMisses: ["[+1]", "[*bold*]"],
  },
  {
    id: "block-title",
    covers: ["BLOCK_TITLE"],
    body: ".T",
    nearMisses: [". T", "."],
  },
  {
    id: "attribute-entry",
    covers: ["ATTRIBUTE_ENTRY"],
    body: ":a: v",
    nearMisses: [": a: v", ":a:v"],
  },
  {
    id: "section-title",
    covers: ["SECTION_TITLE"],
    body: "== T",
    nearMisses: ["==T", "======= T"],
  },
  {
    id: "list-marker",
    covers: ["LIST_MARKER_LINE"],
    body: "* a",
    nearMisses: ["*a"],
  },
  {
    id: "callout",
    covers: ["CALLOUT_MARKER_LINE", "CALLOUT_STYLE"],
    body: "<1> a",
    nearMisses: ["<1>a", " <1> a"],
  },
  {
    id: "dlist-term",
    covers: ["DLIST_SEPARATOR_WORD", "parseDescriptionListLine"],
    body: "term:: def",
    nearMisses: ["term: : def"],
  },
  {
    id: "admonition-label",
    covers: ["ADMONITION_LABEL"],
    body: "NOTE: x",
    nearMisses: ["NOTE:x", "note: x"],
  },
  {
    id: "block-macro",
    covers: ["BLOCK_MACRO"],
    body: "image::a.png[]",
    nearMisses: ["image::a.png[", "image:a.png[]"],
  },
  {
    id: "thematic-break",
    covers: ["THEMATIC_BREAK"],
    body: "'''",
    nearMisses: ["''"],
  },
  { id: "page-break", covers: ["PAGE_BREAK"], body: "<<<", nearMisses: ["<<"] },
  {
    id: "continuation",
    covers: ["CONTINUATION_LINE"],
    body: "+",
    nearMisses: ["+ x", "++"],
  },
  {
    id: "indented-line",
    covers: ["LITERAL_LINE"],
    body: "  lit",
    nearMisses: ["lit"],
  },
  {
    id: "line-comment",
    covers: ["LINE_COMMENT"],
    body: "// c",
    nearMisses: ["///c", "/ c"],
  },
  {
    id: "conditional",
    covers: ["CONDITIONAL_DIRECTIVE"],
    body: "ifdef::x[]",
    nearMisses: ["ifdef:x[]", "ifdef::x["],
  },
  {
    id: "include",
    covers: ["INCLUDE_DIRECTIVE"],
    body: "include::p[]",
    nearMisses: ["include:p[]", "include::p["],
  },
  { id: "styled-verbatim-opener", body: "[source]\ntext", nearMisses: [] },
  { id: "styled-paragraph-opener", body: "[quote]\ntext", nearMisses: [] },
];

/** Every construct dimension the census reconciles. */
export const CONSTRUCTS: readonly ConstructEntry[] = [
  ...DELIMITER_CONSTRUCTS,
  ...OTHER_CONSTRUCTS,
];

/**
 * The container dimensions. The heading-adjacency positions (spec
 * D10) replace the old "inside a section" idea: flat headings make
 * ADJACENCY, not containment, the coordinate that matters.
 */
export const CONTAINERS: readonly ContainerEntry[] = [
  { id: "doc", wrap: (body) => `${body}\n` },
  { id: "item", wrap: (body) => `* item\n+\n${body}\n` },
  { id: "nested-item", wrap: (body) => `* a\n** b\n+\n${body}\n` },
  {
    id: "item-unterminated-example",
    wrap: (body) => `* item\n+\n====\n${body}\n`,
  },
  { id: "under-title", wrap: (body) => `.T\n${body}\n` },
  { id: "under-attrlist", wrap: (body) => `[.role]\n${body}\n` },
  { id: "in-example", wrap: (body) => `====\n${body}\n====\n` },
  { id: "in-open", wrap: (body) => `--\n${body}\n--\n` },
  { id: "in-sidebar", wrap: (body) => `****\n${body}\n****\n` },
  { id: "in-quote", wrap: (body) => `____\n${body}\n____\n` },
  { id: "after-fence", wrap: (body) => `\`\`\`\ncode\n\`\`\`\n${body}\n` },
  { id: "after-h0-adjacent", wrap: (body) => `= T\n${body}\n` },
  { id: "after-h0-blank", wrap: (body) => `= T\n\n${body}\n` },
  { id: "after-h1-adjacent", wrap: (body) => `== T\n${body}\n` },
  { id: "after-h1-blank", wrap: (body) => `== T\n\n${body}\n` },
  { id: "after-h2-adjacent", wrap: (body) => `=== T\n${body}\n` },
  { id: "before-h1-adjacent", wrap: (body) => `${body}\n== B\n` },
  { id: "before-h1-blank", wrap: (body) => `${body}\n\n== B\n` },
  // A [NOTE] attrlist above the construct: for the compound delimiter
  // kinds this is the buildDelimitedAdmonition path, which no realized
  // input reached before (the shape-census GRID_EXEMPT note this row
  // retires); for verbatim kinds it is the uppercase-word admonition
  // masquerade, pinned byte-stable by the same rows.
  { id: "under-note-attrlist", wrap: (body) => `[NOTE]\n${body}\n` },
];

/**
 * The delimited-block perturbations: terminations, codas, garnishes,
 * near-misses (the α lesson: valid-by-construction alphabets miss the
 * almost-valid space).
 */
export const PERTURBATIONS: readonly PerturbationEntry[] = [
  {
    id: "closed",
    block: ({ open, close, content }) => `${open}\n${content}\n${close}`,
  },
  { id: "unterminated", block: ({ open, content }) => `${open}\n${content}` },
  {
    id: "unterminated-then-blank-text",
    block: ({ open, content }) => `${open}\n${content}\n\nafter`,
  },
  {
    id: "terminator-trailing-ws",
    block: ({ open, close, content }) => `${open}\n${content}\n${close}   `,
  },
  {
    id: "closed-then-text-adjacent",
    block: ({ open, close, content }) => `${open}\n${content}\n${close}\nafter`,
  },
  {
    id: "trailing-plus-after-close",
    block: ({ open, close, content }) => `${open}\n${content}\n${close}\n+`,
  },
  {
    id: "metadata-above-close",
    block: ({ open, close, content }) => `${open}\n${content}\n.T\n${close}`,
  },
  {
    id: "heading-inside",
    block: ({ open, close, content }) => `${open}\n== T\n${content}\n${close}`,
  },
  {
    id: "foreign-marker-inside",
    block: ({ open, close, content }) => `${open}\n* x\n${content}\n${close}`,
  },
  {
    id: "longer-delimiter-inside",
    block: ({ open, close, content, longer }) =>
      `${open}\n${content}\n${longer}\n${close}`,
  },
  {
    id: "near-miss-terminator-inside",
    block: ({ open, close, content, nearMiss }) =>
      `${open}\n${content}\n${nearMiss}\n${close}`,
  },
  {
    id: "closed-no-final-newline",
    block: ({ open, close, content }) => `${open}\n${content}\n${close}`,
    document: (wrapped) =>
      wrapped.endsWith("\n") ? wrapped.slice(0, -1) : wrapped,
  },
];

/** One generated shape. */
export interface Shape {
  /** `kind/container/perturbation`. */
  readonly id: string;
  /** The whole document. */
  readonly input: string;
  /**
   * The expected-diff family this coordinate belongs to, when it is
   * allowed to differ base-vs-head at all — the closed enum lives in
   * scripts/parity-ledger.ts (GAMMA_FAMILIES); only listRunGrid()
   * coordinates carry one. Undefined everywhere else, and a differing
   * row with no family fails the run.
   */
  readonly family?: string;
  /**
   * True when render checks are SKIPPED for this row — spec D7.1's
   * two stated exceptions: a construct that renders nothing (comment
   * blocks — render equality is vacuous, the taxonomy's third arm;
   * the fixtures and invariant (xii) carry the proof), and the
   * setext-pinned spellings (P16/P18 — a PRE-existing oracle
   * divergence, where base-vs-head byte equality is the whole pin
   * and a diff is a STOP, never a family candidate).
   */
  readonly renderBlind: boolean;
}

/**
 * β's standing selection (spec D7.1): the delimited-block constructs ×
 * all containers × the termination/coda/garnish perturbations.
 * Deterministic and exhaustive; no randomness anywhere in this mode.
 * @returns the realized grid, in a stable order
 */
export function standingGrid(): Shape[] {
  const shapes: Shape[] = [];
  for (const kind of DELIMITER_KINDS) {
    const parts = DELIMITER_PARTS[kind];
    for (const container of CONTAINERS) {
      for (const perturbation of PERTURBATIONS) {
        const block = perturbation.block(parts);
        if (block === undefined) continue;
        const wrapped = container.wrap(block);
        const input =
          perturbation.document === undefined
            ? wrapped
            : perturbation.document(wrapped);
        // No family on any standing coordinate: the base revision
        // contains the #44 fix, so every standing row is expected
        // byte-identical and a diff here fails the run — there is no
        // family left to explain one.
        shapes.push({
          id: `${kind}/${container.id}/${perturbation.id}`,
          input,
          renderBlind: kind === "commentBlock",
        });
      }
    }
  }
  // The setext-shaped spellings (P16/P18): our read diverges from the
  // oracle PRE-β (recorded, out of scope — spec D9/#16/#18), so these
  // rows are pinned by base-vs-head BYTE equality only; a differing
  // row here has no family and STOPS the run (spec D7.1).
  shapes.push(
    {
      id: "setext/p16/doc",
      input: "====\nfoo\n====\nbar\n====\n",
      renderBlind: true,
    },
    {
      id: "setext/p18/doc",
      input: "====\n----\nfoo\n====\nbar\n----\n",
      renderBlind: true,
    },
  );
  return shapes;
}

/**
 * The heading-adjacency matrix (spec D10(e)): every construct that can
 * sit beside a heading × the adjacency positions, plus the named
 * explicit rows (the A1 pseudo-anchor pair in its FLATTEN-CREATED
 * spelling, the discrete row, the level-jump row). Pseudo-anchor
 * lines are deliberately EXCLUDED from the blind product: the
 * top-level pseudo-anchor pair is the plan's R1 recorded divergence
 * (its net is the named characterization fixture, not this grid — see
 * the plan's G8(d)); the A1 spelling below is the pair the flatten
 * actually creates.
 * @returns the realized rows, in a stable order
 */
export function headingAdjacencyGrid(): Shape[] {
  const beside: ReadonlyArray<{ id: string; body: string }> = [
    { id: "line-comment", body: "// c" },
    { id: "conditional", body: "ifdef::x[]" },
    { id: "attribute-entry", body: ":a: 1" },
    { id: "block-title", body: ".T" },
    { id: "block-anchor", body: "[[id]]" },
    { id: "attrlist", body: "[.role]" },
    { id: "paragraph", body: "para" },
    { id: "heading", body: "== H" },
    { id: "metadata-run", body: "[[id]]\n.T" },
    { id: "attribute-run", body: ":a: 1\n:b: 2" },
  ];
  const positions: ReadonlyArray<{
    id: string;
    wrap: (body: string) => string;
  }> = [
    { id: "after-h0-adjacent", wrap: (body) => `= T\n${body}\n` },
    { id: "after-h0-blank", wrap: (body) => `= T\n\n${body}\n` },
    { id: "after-h1-adjacent", wrap: (body) => `== T\n${body}\n` },
    { id: "after-h1-blank", wrap: (body) => `== T\n\n${body}\n` },
    { id: "after-h2-adjacent", wrap: (body) => `=== T\n${body}\n` },
    { id: "before-h1-adjacent", wrap: (body) => `${body}\n== B\n` },
    { id: "before-h1-blank", wrap: (body) => `${body}\n\n== B\n` },
  ];
  const rows: Shape[] = [];
  for (const construct of beside) {
    for (const position of positions) {
      rows.push({
        id: `adjacency/${construct.id}/${position.id}`,
        input: position.wrap(construct.body),
        renderBlind: false,
      });
    }
  }
  rows.push(
    {
      id: "adjacency/a1-pseudo-anchor/flatten-created",
      input: "== A\n\n[[3-blind-mice]]\n\n== B\n",
      renderBlind: false,
    },
    {
      id: "adjacency/discrete/comment-after",
      input: "[discrete]\n== D\n// c\n",
      renderBlind: false,
    },
    {
      id: "adjacency/level-jump/h0-then-h2",
      input: "= D\n\n=== C\n",
      renderBlind: false,
    },
    {
      id: "adjacency/list-reader-eaten/before-h1",
      input: "== A\n* a\n+\nifdef::x[]\n== B\n",
      renderBlind: false,
    },
    // The R2 class (the recorded hoisted-raw-line divergence,
    // tests/format/heading-adjacency.test.ts): a level >= 1 heading,
    // held raw line(s), then a same-or-shallower heading. The base
    // bytes are already the uniform-blank spelling, so these rows are
    // byte-stable and family-free.
    {
      id: "adjacency/r2-comment/same-level",
      input: "== T\n// c\n== U\n",
      renderBlind: false,
    },
    {
      id: "adjacency/r2-conditional/same-level",
      input: "== T\nifdef::x[]\n== U\n",
      renderBlind: false,
    },
    {
      id: "adjacency/r2-comment/shallower",
      input: "=== T\n// c\n== U\n",
      renderBlind: false,
    },
    {
      id: "adjacency/r2-comment/deeper",
      input: "== T\n// c\n=== V\n",
      renderBlind: false,
    },
    {
      id: "adjacency/r2-comment/level0",
      input: "= T\n// c\n= U\n",
      renderBlind: false,
    },
  );
  return rows;
}
