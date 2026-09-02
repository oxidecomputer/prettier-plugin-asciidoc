/**
 * The list-run grid: the third consumption-mode-(1)
 * sub-grid, in its own module because scripts/shape-registry.ts is at
 * its `max-lines` ceiling and the coding standard splits rather than
 * condenses. It reads the registry's container dimension for its
 * composition rows, so the dependency runs ONE way — this module
 * imports the registry, never the reverse, and consumers
 * (scripts/shape-diff.ts, scripts/metrics/shape-census.ts) import
 * `listRunGrid` from here.
 *
 * A LIBRARY module, not a command, on the same terms as
 * `scripts/shape-registry.ts`.
 */
import {
  AUTHOR_PLUS_FAMILY,
  MARKER_SPELLING_FAMILY,
  NESTING_FIDELITY_FAMILY,
  PSEUDO_RUN_FOLD_FAMILY,
} from "./parity-ledger.js";
import { CONTAINERS, type Shape } from "./shape-registry.js";

/**
 * The anchor spellings the printed-line record classifies
 * (anchorLineShape). `reads` is the record's expected value — the
 * same per-spelling split the unit rows pin — and it decides the
 * family: a run ending in a LOOKALIKE is the pseudo-run-fold
 * corruption class; a run ending in a spelling that re-reads as an
 * anchor keeps today's fold bytes and must not move.
 *
 * `[[3-bad, ]]` (rejected id, whitespace reftext) is deliberately
 * ABSENT: its in-run shape moves bytes with NO passing render proof
 * (the respell half is the fenced gP47 corruption), so its net is the
 * named characterization rows in tests/format/anchor-spelling.test.ts
 * — the same fixture-is-the-net treatment recorded divergence R1 gets.
 */
const ANCHOR_SPELLINGS: ReadonlyArray<{
  readonly id: string;
  readonly line: string;
  readonly reads: "anchor" | "lookalike";
}> = [
  { id: "valid", line: "[[anc]]", reads: "anchor" },
  { id: "valid-reftext", line: "[[anc,Ref]]", reads: "anchor" },
  { id: "digit-id", line: "[[3-bad]]", reads: "lookalike" },
  { id: "illegal-char", line: "[[illegal$id]]", reads: "lookalike" },
  { id: "bare-digit", line: "[[9]]", reads: "lookalike" },
  { id: "empty-reftext", line: "[[id,]]", reads: "anchor" },
  { id: "ws-reftext", line: "[[id, ]]", reads: "anchor" },
  { id: "rejected-reftext", line: "[[3-bad,Ref]]", reads: "lookalike" },
  { id: "rejected-reftext-space", line: "[[3-bad, Ref]]", reads: "lookalike" },
];

/**
 * Item bases whose text reflow can reach the first rest line — the
 * hazard's precondition. Four shapes: the two-line and three-line
 * unordered items, the ordered twin, and a nested item carrying its
 * own run (the rule composes through nesting, probe gP36).
 */
const ITEM_BASES: ReadonlyArray<{
  readonly id: string;
  readonly body: string;
}> = [
  { id: "star-2line", body: "* a\npara" },
  { id: "star-3line", body: "* a\nb\nc" },
  { id: "ordered-2line", body: ". o\npara" },
  { id: "nested-2line", body: "* t\n** a\npara" },
];

/**
 * Follower codas: a non-transparent block after the `[role]` run —
 * today's invented-`+` classes (probes gP4/gP14/gP23), all
 * render-neutral respellings.
 */
const FOLLOWER_CODAS: ReadonlyArray<{
  readonly id: string;
  readonly tail: string;
}> = [
  { id: "adjacent-para", tail: "para" },
  { id: "plus-para", tail: "+\npara" },
  { id: "plus-listing", tail: "+\n----\nx\n----" },
  { id: "nested-marker", tail: "** b" },
  { id: "indented-literal", tail: "  lit" },
];

/**
 * The `+`-inside-run axis (the F1 dimension, probes
 * gP27–gP32). Per-entry family: an attrlist/anchor/comment tail is
 * the declared byte-change class (respelling); a pseudo tail is a
 * live-corruption member; a title tail is the unchanged CONTROL
 * (gP27 - the base already emits the held-break spelling).
 */
const PLUS_RUN_TAILS: ReadonlyArray<{
  readonly id: string;
  readonly tail: string;
  readonly family: string | undefined;
}> = [
  { id: "plus-attrlist", tail: "+\n[role2]", family: AUTHOR_PLUS_FAMILY },
  { id: "plus-anchor", tail: "+\n[[anc]]", family: AUTHOR_PLUS_FAMILY },
  { id: "plus-pseudo", tail: "+\n[[3-bad]]", family: PSEUDO_RUN_FOLD_FAMILY },
  { id: "plus-title", tail: "+\n.T", family: undefined },
  {
    id: "plus-comment-plus-attrlist",
    tail: "+\n// c\n+\n[role2]",
    family: AUTHOR_PLUS_FAMILY,
  },
];

/** Byte-stable run tails — controls that must never move (gP6/gP16). */
const STABLE_RUN_TAILS: ReadonlyArray<{
  readonly id: string;
  readonly tail: string;
}> = [
  { id: "dangling-attrlist", tail: "" },
  { id: "title-run", tail: "\n.T" },
];

/**
 * Marker-spelling rows: the dash/tab/collided shapes the
 * replay fixes (probes gP8/gP9/gP10/gP37/gP38) and the round-trip
 * controls that must not move.
 */
const MARKER_ROWS: ReadonlyArray<{
  readonly id: string;
  readonly input: string;
  readonly family: string | undefined;
}> = [
  {
    id: "marker/dash-pair/doc",
    input: "- a\n- b\n",
    family: MARKER_SPELLING_FAMILY,
  },
  {
    id: "marker/dash-star-nest/doc",
    input: "- Foo\n* Boo\n",
    family: NESTING_FIDELITY_FAMILY,
  },
  {
    id: "marker/depth-chain/doc",
    input: "- parent\n* child\n** grandchild\n",
    family: NESTING_FIDELITY_FAMILY,
  },
  {
    id: "marker/tab-gap/doc",
    input: "* a\n**\tb\n",
    family: NESTING_FIDELITY_FAMILY,
  },
  {
    id: "marker/tab-chain/doc",
    input: "* a\n**\tb\n***\tc\n",
    family: NESTING_FIDELITY_FAMILY,
  },
  { id: "marker/star-pair/doc", input: "* a\n* b\n", family: undefined },
  { id: "marker/ordered-pair/doc", input: ". a\n. b\n", family: undefined },
  { id: "marker/callout-pair/doc", input: "<1> a\n<2> b\n", family: undefined },
  { id: "marker/star-nested/doc", input: "* a\n** b\n", family: undefined },
];

/** Explicit probe shapes the products above do not generate. */
const EXPLICIT_LIST_ROWS: ReadonlyArray<{
  readonly id: string;
  readonly input: string;
  readonly family: string | undefined;
}> = [
  {
    id: "explicit/gp22-plus-above-run/doc",
    input: "* a\n+\n[role]\n----\nx\n----\n",
    family: undefined,
  },
  {
    id: "explicit/gp13-pseudo-in-run-plus-block/doc",
    input: "* a\npara\n[role]\n[[3-bad]]\n+\npara\n",
    family: AUTHOR_PLUS_FAMILY,
  },
  {
    id: "explicit/gp15-comment-transparent-pseudo/doc",
    input: "* a\npara\n[role]\n// c\n[[3-bad]]\n",
    family: PSEUDO_RUN_FOLD_FAMILY,
  },
  // A STABILITY pin, not a proof of the wrap-direction repair:
  // pass-1 output is byte-identical base-vs-head (only pass 2 changes),
  // and the harness runs proofs on differing rows only — the repair's
  // net is the named gP35 row in tests/format/list-item-blocks.test.ts.
  {
    id: "explicit/gp35-wrap-direction/doc",
    input:
      "* aaaaaaaa bbbbbbbb cccccccc dddddddd eeeeeeee ffffffff gggggggg hhhhhhhh iiiiiiii\n[role]\npara\n",
    family: undefined,
  },
  {
    id: "explicit/gp25-title-then-literal/doc",
    input: "* a\npara\n[role]\n.T\n  lit\n",
    family: AUTHOR_PLUS_FAMILY,
  },
  {
    id: "explicit/gp26-plus-then-literal/doc",
    input: "* a\npara\n[role]\n+\n  lit\n",
    family: AUTHOR_PLUS_FAMILY,
  },
];

// The pseudo-run shape re-probed inside containers (composition rows).
const RUN_CONTAINER_IDS = new Set([
  "doc",
  "in-example",
  "in-open",
  "under-title",
  "after-h1-blank",
]);

/**
 * The list-run grid: deterministic, exhaustive over its
 * sub-products, realized size pinned by the census (rule (v)). Family
 * annotations mark the coordinates PERMITTED to differ base-vs-head
 * under the landed fold and marker families; a differing row anywhere
 * else fails the run.
 * @returns the realized rows, in a stable order
 */
export function listRunGrid(): Shape[] {
  const rows: Shape[] = [];
  for (const base of ITEM_BASES) {
    for (const spelling of ANCHOR_SPELLINGS) {
      rows.push({
        id: `run/${base.id}/${spelling.id}`,
        input: `${base.body}\n[role]\n${spelling.line}\n`,
        family:
          spelling.reads === "lookalike" ? PSEUDO_RUN_FOLD_FAMILY : undefined,
        renderBlind: false,
      });
    }
    for (const coda of FOLLOWER_CODAS) {
      rows.push({
        id: `coda/${base.id}/${coda.id}`,
        input: `${base.body}\n[role]\n${coda.tail}\n`,
        family: AUTHOR_PLUS_FAMILY,
        renderBlind: false,
      });
    }
    for (const tail of PLUS_RUN_TAILS) {
      rows.push({
        id: `plusrun/${base.id}/${tail.id}`,
        input: `${base.body}\n[role]\n${tail.tail}\n`,
        family: tail.family,
        renderBlind: false,
      });
    }
    for (const tail of STABLE_RUN_TAILS) {
      rows.push({
        id: `stable/${base.id}/${tail.id}`,
        input: `${base.body}\n[role]${tail.tail}\n`,
        renderBlind: false,
      });
    }
  }
  for (const container of CONTAINERS) {
    if (!RUN_CONTAINER_IDS.has(container.id)) {
      continue;
    }
    rows.push({
      id: `composed/pseudo-run/${container.id}`,
      input: container.wrap("* a\npara\n[role]\n[[3-bad]]"),
      family: PSEUDO_RUN_FOLD_FAMILY,
      renderBlind: false,
    });
  }
  for (const row of [...MARKER_ROWS, ...EXPLICIT_LIST_ROWS]) {
    rows.push({
      id: row.id,
      input: row.input,
      family: row.family,
      renderBlind: false,
    });
  }
  return rows;
}
