/**
 * The shape registry: the shared input vocabulary for shape-level
 * verification. Four dimension classes:
 * containers (where a construct sits), constructs (everything
 * line-shapes.ts knows, one dimension per rule), perturbations
 * (terminations, codas, garnishes, and for every valid spelling its
 * near-misses), and byte operators (document-level transforms applied
 * to realized inputs). Each entry is a named, DETERMINISTIC string
 * generator. The list-run grid and the width-2 pair grid live in their
 * own sibling modules, scripts/shape-registry-list-run.ts and
 * scripts/shape-registry-pairs.ts, built from this file's Shape
 * vocabulary; the byte-operator dimension lives in its own sibling
 * module, scripts/shape-registry-byte-operators.ts, re-exported below.
 *
 * Two consumption modes are designed for; only mode (1) exists:
 * (1) deterministic exhaustive matrices (`scripts/shape-diff.ts`);
 * (2) weighted sampling for a later fuzzer rewrite — a named follow-on
 * that is NOT built: the dimension shape is merely built so
 * that consumer can be added without reshaping it. No weights, no
 * sampling machinery here.
 *
 * Completeness is HELD by `scripts/metrics/shape-census.ts` (a
 * `bun run metrics` gate): every `DELIMITER_KINDS` entry needs a
 * delimiter dimension, and every line-shapes.ts runtime export name
 * needs a dimension declaring `covers` or an in-gate exemption — a
 * parser that learns a new construct is thereby FORCED to teach these
 * generators (or write the exemption down) in the same commit.
 *
 * A LIBRARY module, not a command: `scripts/shape-diff.ts` and
 * `scripts/metrics/shape-census.ts` import it. It has no argument
 * parsing and no exit code of its own.
 */
import {
  DELIMITER_KINDS,
  type DelimiterKind,
} from "../src/parse/line-shapes.js";
import { NO_OP_CONTINUATION_FAMILY } from "./parity-ledger.js";

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
  /**
   * The family that explains a base-vs-head difference on rows this
   * perturbation generates, when one is expected at all. Only
   * `trailing-plus-after-close` carries one: inside an item container
   * the `+` it writes sits at the item's END, where it attaches
   * nothing and is no longer printed.
   */
  readonly family?: string;
}

/** The pieces a delimited-block perturbation composes. */
interface DelimiterParts {
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
    // Four coordinates in one content string, so the grid reaches
    // the decisions the layout makes without gaining a dimension: a
    // multi-cell line (the separator rule), a cell spec (the
    // CellSpecStartRx boundary, rx.rb:400), a blank after the first
    // line (the implicit_header_boundary rule, parser.rb:2340-2345),
    // and an interior line longer than the delimiter (the
    // minimal-length collision guard, which must NOT lengthen it).
    // Every row is complete: an incomplete last row makes the oracle
    // log an error and drop it (close_table, table.rb:685-688), which
    // would degrade every generated shape here.
    content: "|a 2+|b\n\n|c |d\n|====\n|e |f |g",
    close: "|===",
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
    // A top-level `!===` table cuts on `|`, not on `!` (the `!sv`
    // scheme belongs to a nested document, table.rb:466-474), so
    // this is a psv table with a literal first cell: the coordinate
    // for the flush exception, which a literal cell answers by
    // declining its whole table.
    content: "l|a |b",
    close: "!===",
    longer: "!====",
    nearMiss: "!==",
  },
};

/**
 * The delimiter dimensions, DERIVED from the imported kind list —
 * never copied — so a new kind reaches the grid the moment the
 * registry compiles.
 */
const DELIMITER_CONSTRUCTS: readonly ConstructEntry[] = DELIMITER_KINDS.map(
  (kind) => {
    const { open, close, content, nearMiss } = DELIMITER_PARTS[kind];
    return {
      id: `delimiter-${kind}`,
      delimiter: kind,
      body: `${open}\n${content}\n${close}`,
      nearMisses: [nearMiss, `${open}x`, ` ${open}`],
    };
  },
);

/**
 * Every non-delimiter construct dimension, each covering the
 * line-shapes.ts runtime export(s) it exercises (the census's rule
 * (ii) reconciles the `covers` names against the module's actual
 * export list — both directions).
 */
const OTHER_CONSTRUCTS: readonly ConstructEntry[] = [
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
    id: "indented-continuation",
    covers: ["INDENTED_PLUS"],
    body: "  +",
    nearMisses: ["  + x", "  ++"],
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
 * The container dimensions. The heading-adjacency positions replace
 * the old "inside a section" idea: flat headings make
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
  // The dlist description's two beginnings: inline after the `::`
  // separator (the position `term:: [` occupies in the known
  // idempotency failure) and alone on the line the separator ends,
  // with the body flowing into the description's continuation lines
  // either way.
  { id: "dlist-desc", wrap: (body) => `term:: ${body}\n` },
  { id: "dlist-desc-line", wrap: (body) => `term::\n${body}\n` },
];

/**
 * The delimited-block perturbations: terminations, codas, garnishes,
 * near-misses (valid-by-construction alphabets miss the almost-valid
 * space).
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
    family: NO_OP_CONTINUATION_FAMILY,
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

// The byte-operator dimension lives in its own module, on the same
// "split rather than condense" terms as shape-registry-list-run.ts:
// this file is at its max-lines ceiling. `BYTE_OPERATORS` is
// re-exported here so it still reads as this registry's vocabulary;
// `ByteOperatorEntry` stays declared where it is used (no consumer
// needs the type by name, only the value).
export { BYTE_OPERATORS } from "./shape-registry-byte-operators.js";

// The width-2 pair grid lives in its own module for the same
// max-lines reason. `pairGrid` and `pairAlphabet` are re-exported here
// so they still read as this registry's vocabulary; `PairAlphabetMember`
// stays declared where it is used.
export { pairAlphabet, pairGrid } from "./shape-registry-pairs.js";

/** One generated shape. */
export interface Shape {
  /** `kind/container/perturbation`. */
  readonly id: string;
  /** The whole document. */
  readonly input: string;
  /**
   * The expected-diff family this coordinate belongs to, when it is
   * allowed to differ base-vs-head at all — the closed enum lives in
   * scripts/parity-ledger.ts (LEDGER_FAMILIES); only listRunGrid()
   * coordinates carry one. Undefined everywhere else, and a differing
   * row with no family fails the run.
   */
  readonly family?: string;
  /**
   * True when render checks are SKIPPED for this row — the two
   * exceptions the registry allows: a construct that renders nothing
   * (comment blocks — render equality is vacuous, the taxonomy's
   * third arm; the fixtures and invariant (xii) carry the proof), and
   * the setext-pinned spellings (a PRE-existing oracle
   * divergence, where base-vs-head byte equality is the whole pin
   * and a diff is a STOP, never a family candidate).
   */
  readonly renderBlind: boolean;
}

/**
 * The standing selection: the delimited-block constructs ×
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
        // One standing coordinate carries a family — the trailing `+`
        // this perturbation writes, which an ITEM container puts at an
        // item's end where the byte is retired. Every other standing
        // row is expected byte-identical (the base revision contains
        // the #44 fix) and a diff there fails the run.
        shapes.push({
          id: `${kind}/${container.id}/${perturbation.id}`,
          input,
          family: perturbation.family,
          renderBlind: kind === "commentBlock",
        });
      }
    }
  }
  // The setext-shaped spellings: our read already diverges from the
  // oracle (recorded, out of scope — issues #16 and #18), so these
  // rows are pinned by base-vs-head BYTE equality only; a differing
  // row here has no family and STOPS the run.
  shapes.push(
    {
      id: "setext/trailing-underline/doc",
      input: "====\nfoo\n====\nbar\n====\n",
      renderBlind: true,
    },
    {
      id: "setext/nested-listing/doc",
      input: "====\n----\nfoo\n====\nbar\n----\n",
      renderBlind: true,
    },
  );
  return shapes;
}

/**
 * The heading-adjacency matrix: every construct that can
 * sit beside a heading × the adjacency positions, plus the named
 * explicit rows (the A1 pseudo-anchor pair in its FLATTEN-CREATED
 * spelling, the discrete row, the level-jump row). Pseudo-anchor
 * lines are deliberately EXCLUDED from the blind product: the
 * top-level pseudo-anchor pair is recorded divergence R1, whose net
 * is the named characterization fixture in
 * tests/format/heading-adjacency.test.ts rather than this grid; the
 * A1 spelling below is the pair the flatten actually creates.
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
