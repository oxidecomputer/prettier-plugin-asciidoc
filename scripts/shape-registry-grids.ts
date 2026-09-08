/**
 * The two realized grids the shape registry builds from its own
 * dimension vocabulary: the standing selection (delimited-block
 * constructs by containers by perturbations) and the
 * heading-adjacency matrix.
 *
 * In their own module because scripts/shape-registry.ts is at its
 * `max-lines` ceiling and the coding standard splits rather than
 * condenses. The split also finishes a shape the registry had left
 * half-made: every realized grid now lives in a sibling module
 * (shape-registry-list-run.ts, shape-registry-pairs.ts and this one),
 * and the registry itself holds dimensions only.
 *
 * The dependency runs ONE way - this module imports the registry,
 * never the reverse - and consumers (scripts/shape-diff.ts,
 * scripts/metrics/shape-census.ts) reach both builders through the
 * registry's re-export, so no consumer import changed when they moved.
 *
 * A LIBRARY module, not a command, on the same terms as
 * `scripts/shape-registry.ts`.
 */
import { DELIMITER_KINDS } from "../src/parse/line-shapes.js";
import { gridRowFamily } from "./shape-registry-families.js";
import {
  FLOATING_TITLE_NODE_FAMILY,
  UNDERLINED_SECTION_TITLE_FAMILY,
} from "./parity-ledger.js";
import {
  CONTAINERS,
  DELIMITER_PARTS,
  PERTURBATIONS,
  type Shape,
} from "./shape-registry.js";

/**
 * The comment-run spellings a head drain takes whose PARAGRAPH
 * carries more than `//`-headed words: a second word, a hard break, a
 * formatting span, a macro. One per inline class, which is the axis
 * that separates them: `Reader#skip_line_comments` takes a line by
 * its bare `//` head (reader.rb l.332-345) while `CommentLineRx`
 * exempts a third slash, so every line here is one the drain deletes
 * and the classifier reads as a paragraph, and any predicate that
 * asks about the run's WORDS or its inline children instead of its
 * line head answers one of the four wrong (issue #267).
 *
 * The bare `// c` and `///c` spellings are the `line-comment`
 * dimension's own body and near miss and are not repeated here: both
 * were already answered, and neither carries anything past the head.
 */
const DRAINED_RUN_LINES: ReadonlyArray<{
  /** Stable name: the inline class the line's tail carries. */
  readonly id: string;
  /** The whole line, as it stands under the item's marker. */
  readonly line: string;
}> = [
  { id: "second-word", line: "///c x" },
  { id: "hard-break", line: "/// +" },
  { id: "span", line: "///*b*" },
  { id: "macro", line: "///https://x[y]" },
];

/**
 * The standing selection: the delimited-block constructs ×
 * all containers × the termination/coda/garnish perturbations.
 * The setext pins and the drained-run rows below stand outside that
 * product, each for a reason written where it is pushed.
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
        if (block === undefined) {
          continue;
        }
        const wrapped = container.wrap(block);
        const input =
          perturbation.document === undefined
            ? wrapped
            : perturbation.document(wrapped);
        // Which standing coordinates may differ, and under which
        // family, is answered in one place
        // (scripts/shape-registry-families.ts) because the answer
        // needs ALL THREE coordinates: a `tablePipe` row moves for a
        // reason its perturbation does not name, and a reading change
        // moves one kind inside one container while leaving the same
        // perturbation's siblings alone. Every coordinate that map
        // does not name is expected byte-identical and a diff there
        // fails the run.
        shapes.push({
          id: `${kind}/${container.id}/${perturbation.id}`,
          input,
          family: gridRowFamily(kind, container.id, perturbation.id),
          renderBlind: kind === "commentBlock",
        });
      }
    }
  }
  // The setext-shaped spellings. All three are RENDER-VISIBLE like
  // any other row: the reader takes a two-line title now (issue #16),
  // so the reading that used to diverge from the oracle here is the
  // oracle's. All three also DIFFER from a base that read no title,
  // so all three carry that reading's family - a differing row
  // without one still stops the run.
  shapes.push(
    {
      id: "setext/trailing-underline/doc",
      input: "====\nfoo\n====\nbar\n====\n",
      renderBlind: false,
      family: UNDERLINED_SECTION_TITLE_FAMILY,
    },
    {
      id: "setext/nested-listing/doc",
      input: "====\n----\nfoo\n====\nbar\n----\n",
      renderBlind: false,
      family: UNDERLINED_SECTION_TITLE_FAMILY,
    },
    // The construct in its own right, which is what the
    // `setext-title` dimension's canonical spelling reaches
    // (scripts/shape-registry.ts, rule (iv)).
    {
      id: "setext/underlined-title/doc",
      input: "Title\n-----\n\nbody\n",
      renderBlind: false,
      family: UNDERLINED_SECTION_TITLE_FAMILY,
    },
  );
  // The one position the head drain runs in, spelled explicitly
  // because no product reaches it. `parse_list_item` peeks past a
  // `//`-headed run before it reads an item's FIRST block (parser.rb
  // l.1362-71), so the run has to stand directly under the marker
  // line, and every item container puts a `+` between the two, which
  // is a line the peek stops on. The same four lines under `* item` /
  // `+`, at the top of a document, or under a `term::` (whose own
  // drain asks the LINE's head and takes all four already) reach no
  // decision these rows are for, so the container set spells no
  // coordinate that stands in for this one.
  //
  // The tail is the `+` the source wrote, and one blank above it: two
  // blanks and an ordered marker were measured to fail the same way
  // and are left to tests/format/list-item-trailing-comment.test.ts,
  // which pins them row by row.
  //
  // The spellings are NOT pair-alphabet members either. That route
  // needs two levers, and both were measured against these four rows:
  // members squared into the pair product, which spells no such
  // document on its own because the pair grid's item container wraps
  // its body in a marker line AND a `+`, and a fourth pair container
  // for the bare marker head. The alphabet also holds no near miss by
  // ruling (issue #285), and every spelling here is one.
  for (const run of DRAINED_RUN_LINES) {
    shapes.push({
      id: `drained-run/${run.id}/marker-item`,
      input: `* a\n${run.line}\n\n+\n`,
      renderBlind: false,
    });
  }
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
    // The `[float]` TWIN of the row above, and the level-0 shape
    // beside it. `discrete` and `float` are one style under two names
    // to both programs, so a base that reads them apart differs HERE
    // where the `[discrete]` row alone shows nothing.
    {
      id: "adjacency/float/comment-after",
      input: "[float]\n== D\n// c\n",
      family: FLOATING_TITLE_NODE_FAMILY,
      renderBlind: false,
    },
    {
      id: "adjacency/float/attribute-entry-after-h0",
      input: "[float]\n= D\n:a: 1\n",
      family: FLOATING_TITLE_NODE_FAMILY,
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
