/**
 * The curved-quote shape matrix: every wrapper crossed with every mark
 * crossed with every placement, plus the hand-written edge shapes.
 *
 * The matrix is what found issue #74 and it is what proves it stays
 * closed. Deterministic and committed, so a cell id in a failure
 * message names the same source every run (no runtime
 * input generation - the inputs ARE this file).
 */

/** One generated cell: a stable id and the document it formats. */
export interface CurvedShape {
  /** `wrapper/mark/placement`, or `edge/<name>` for a hand-written row. */
  readonly id: string;
  /** The whole one-paragraph document, without a trailing newline. */
  readonly source: string;
}

// The two curved-quote pairs: QUOTE_SUBS rows 3 and 4
// (asciidoctor.rb l.449-452).
const WRAPPERS = [
  { id: "double", open: '"`', close: '`"' },
  { id: "single", open: "'`", close: "`'" },
] as const;

// The four marks the parser already models, each in both spellings.
const MARKS = [
  { id: "bold", double: "**", single: "*" },
  { id: "italic", double: "__", single: "_" },
  { id: "monospace", double: "``", single: "`" },
  { id: "highlight", double: "##", single: "#" },
] as const;

/**
 * The five placements a mark can take against a curved-quote pair.
 * `head` and `tail` matter separately because only a mark ADJACENT to
 * the replacement's entity is blocked by its `;`.
 * @param wrapper - the curved pair
 * @param mark - the mark spelling
 * @returns the five cells, ids relative to the pair
 */
function placements(
  wrapper: (typeof WRAPPERS)[number],
  mark: (typeof MARKS)[number],
): CurvedShape[] {
  const { open, close } = wrapper;
  const base = `${wrapper.id}/${mark.id}`;
  return [
    {
      id: `${base}/inside-unconstrained`,
      source: `x ${open}${mark.double}a${mark.double}${close} y`,
    },
    {
      id: `${base}/inside-constrained`,
      source: `x ${open}${mark.single}a${mark.single}${close} y`,
    },
    {
      id: `${base}/tail`,
      source: `x ${open}b ${mark.double}a${mark.double}${close} y`,
    },
    {
      id: `${base}/head`,
      source: `x ${open}${mark.double}a${mark.double} b${close} y`,
    },
    {
      id: `${base}/crossing`,
      source: `x ${open}${mark.double}a${close}${mark.double} y`,
    },
  ];
}

// The hand-written rows: nesting, adjacency, escapes and near-misses that
// no placement generates. Every expectation was measured against the
// oracle; the sweep asserts render-equality, not these strings.
const EDGE_SHAPES: readonly CurvedShape[] = [
  { id: "edge/mono-inside-double", source: '"``a``"' },
  { id: "edge/plain-double", source: '"`a`"' },
  { id: "edge/plain-single", source: "'`a`'" },
  { id: "edge/mono-wraps-double", source: 'x `"`a`"` y' },
  { id: "edge/double-in-double", source: 'x "`a "`b`" c`" y' },
  { id: "edge/single-in-double", source: "x \"`a '`b`' c`\" y" },
  { id: "edge/role-before-double", source: 'x [.foo]"`a`" y' },
  { id: "edge/escaped-open", source: 'x \\"`a`" y' },
  { id: "edge/unmatched-open", source: 'x "`a' },
  { id: "edge/space-edged-content", source: 'x "` a `" y' },
  { id: "edge/semicolon-in-front", source: 'x ;"`a`" y' },
  { id: "edge/word-in-front", source: 'x a"`a`" y' },
  { id: "edge/word-behind", source: 'x "`a`"b y' },
  { id: "edge/parenthesised", source: 'x ("`a`") y' },
  { id: "edge/semicolon-behind", source: 'x "`a`";b y' },
  // The escaped-attrlist arm (substitutors.rb l.1421-1423): a
  // backslash-escaped `[attrlist]` in front of a curved pair still
  // converts in Ruby - the brackets print literally, but the pair
  // still becomes an entity around whatever follows them. Measured:
  // `x \[.foo]"`a`" y` renders `x [.foo]&#8220;a&#8221; y`.
  { id: "edge/escaped-attrlist-double", source: 'x \\[.foo]"`a`" y' },
  // The sibling that proves the fix covers the FAMILY, not one
  // string: an emphasis nested in the pair must still convert too.
  // `x \[.foo]"`__a__`" y` renders
  // `x [.foo]&#8220;<em>a</em>&#8221; y`.
  {
    id: "edge/escaped-attrlist-double-nested-italic",
    source: 'x \\[.foo]"`__a__`" y',
  },
];

/**
 * Every cell of the matrix, in a stable order: 44 generated (2 wrappers x
 * 4 marks x 5 placements, plus 2 plain rows per wrapper) and 17
 * hand-written.
 * @returns the 61 cells
 */
export const CURVED_SHAPES: readonly CurvedShape[] = [
  ...WRAPPERS.flatMap((wrapper) => [
    ...MARKS.flatMap((mark) => placements(wrapper, mark)),
    {
      id: `${wrapper.id}/plain/word`,
      source: `x ${wrapper.open}a${wrapper.close} y`,
    },
    {
      id: `${wrapper.id}/plain/words`,
      source: `x ${wrapper.open}a b${wrapper.close} y`,
    },
  ]),
  ...EDGE_SHAPES,
];
