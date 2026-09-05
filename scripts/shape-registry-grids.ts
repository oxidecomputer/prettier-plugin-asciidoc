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
  CONTAINERS,
  DELIMITER_PARTS,
  PERTURBATIONS,
  type Shape,
} from "./shape-registry.js";

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
        // reason its perturbation does not name, and a row inside a
        // description moves for a reason neither of the other two
        // names. Every coordinate that map does not name is expected
        // byte-identical and a diff there fails the run.
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
  // oracle's. A differing row still has no family and STOPS the run.
  shapes.push(
    {
      id: "setext/trailing-underline/doc",
      input: "====\nfoo\n====\nbar\n====\n",
      renderBlind: false,
    },
    {
      id: "setext/nested-listing/doc",
      input: "====\n----\nfoo\n====\nbar\n----\n",
      renderBlind: false,
    },
    // The construct in its own right, which is what the
    // `setext-title` dimension's canonical spelling reaches
    // (scripts/shape-registry.ts, rule (iv)).
    {
      id: "setext/underlined-title/doc",
      input: "Title\n-----\n\nbody\n",
      renderBlind: false,
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
