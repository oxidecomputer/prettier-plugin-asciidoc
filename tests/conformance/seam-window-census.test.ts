/**
 * The seam-decidability table, pinned.
 *
 * scripts/seam-window-census.ts asks, for every cell of the
 * classification grid (every reachable open-paragraph reader state x
 * every registry construct), what the SHORTEST line-start prefix and
 * line-end suffix are that fix `classifyLine`'s
 * continue-or-interrupt verdict whatever bytes stand between them.
 * The answer prices a line packer's seam check: a windowed construct
 * costs O(1) per seam and can be compiled to a lookup; a whole-line
 * construct costs one classification per flushed line.
 *
 * WHAT THIS FILE ADDS to the census: the numbers, written down. A
 * census that only prints is one nobody notices moving, which is the
 * argument the shape-census pins already make in their own words
 * (scripts/metrics/shape-census.ts). Every row below goes red on a
 * registry row added or widened, a reachable state gained or lost, or
 * a classifier verdict that moves - all three of which are deliberate
 * changes whose effect on seam decidability should be read before
 * the number here is updated.
 *
 * WHAT IT DOES NOT CLAIM. A filler alphabet is finite and a line is
 * not, so a row reading "windowed at k bytes" says no probed filler
 * moved that window, not that none exists; a row reading "whole-line"
 * is the exact direction, since a filler that moved every window is a
 * witness. The two alphabets and what each covers are spelled at
 * `ordinaryTextAlphabet` and `registryAlphabet` in the census module.
 */
import { describe, expect, test } from "vitest";
import {
  ordinaryTextAlphabet,
  registryAlphabet,
  seamWindowCensus,
  tableLines,
} from "../../scripts/seam-window-census.js";

// Both sweeps once for the file: the tests below read different
// facts out of the same two runs rather than sweeping four times.
const registry = seamWindowCensus("registry");
const ordinary = seamWindowCensus("ordinary text");

describe("seam-window census", () => {
  // The grid this census runs over is the one
  // tests/conformance/reader-context-grid.test.ts pins, and the two
  // sizes are pinned in both places on purpose: a census reporting a
  // different cell count from the grid it claims to cover would be
  // measuring something else.
  test("is the grid the classification grid pins", () => {
    expect(registry.states).toBe(188);
    expect(registry.constructs).toBe(55);
    expect(registry.cells).toBe(10_340);
    expect(ordinary.cells).toBe(registry.cells);
  });

  // The alphabets are DERIVED from the construct roster (every
  // construct's own line, its tails, its heads, and runs of the bytes
  // it uses), so a registry row added widens them in the same change.
  // The sizes are pinned so that a derivation which quietly stops
  // deriving is a failure rather than a weaker census.
  test("probes the alphabets it says it probes", () => {
    expect(ordinaryTextAlphabet()).toHaveLength(9);
    expect(registryAlphabet()).toHaveLength(586);
  });

  // THE TABLE. One row per construct: the longest window that decides
  // every state it is windowed in, or how many of the 188 states
  // admit no window at all.
  test("is the table the census measures", () => {
    expect(tableLines(registry)).toEqual([
      "unordered list marker: whole-line in 16 of 188 states",
      "ordered list marker: whole-line in 16 of 188 states",
      "explicit arabic marker: whole-line in 16 of 188 states",
      "explicit arabic marker (a year): whole-line in 16 of 188 states",
      "explicit loweralpha marker: whole-line in 16 of 188 states",
      "explicit upperalpha marker: whole-line in 16 of 188 states",
      "explicit lowerroman marker: whole-line in 16 of 188 states",
      "explicit upperroman marker: whole-line in 16 of 188 states",
      "mixed-case roman marker (lower tail): whole-line in 16 of 188 states",
      "mixed-case roman marker (upper tail): whole-line in 16 of 188 states",
      "arabic with a paren, not a marker: whole-line in 112 of 188 states",
      "loweralpha with a paren, not a marker: whole-line in 112 of 188 states",
      "upperalpha with a paren, not a marker: whole-line in 112 of 188 states",
      "multi-letter alpha, not a marker: whole-line in 112 of 188 states",
      "non-roman letter with a paren, not a marker: whole-line in 112 of 188 states",
      "callout list marker: whole-line in 16 of 188 states",
      "list continuation: whole-line in 188 of 188 states",
      "block title: whole-line in 112 of 188 states",
      "line comment: windowed at 3 bytes",
      "attribute entry: whole-line in 112 of 188 states",
      "block attribute list: whole-line in 4 of 188 states",
      "bracketed text (leading +): whole-line in 112 of 188 states",
      "bracketed text (leading *): whole-line in 112 of 188 states",
      "block anchor: whole-line in 169 of 188 states",
      "listing delimiter: whole-line in 187 of 188 states",
      "literal delimiter: whole-line in 187 of 188 states",
      "pass delimiter: whole-line in 187 of 188 states",
      "example delimiter: whole-line in 187 of 188 states",
      "sidebar delimiter: whole-line in 187 of 188 states",
      "quote delimiter: whole-line in 187 of 188 states",
      "comment block delimiter: whole-line in 187 of 188 states",
      "open block delimiter: whole-line in 187 of 188 states",
      "open block delimiter (tilde): whole-line in 187 of 188 states",
      "fenced code: whole-line in 187 of 188 states",
      "table delimiter (psv): whole-line in 187 of 188 states",
      "table delimiter (csv): whole-line in 187 of 188 states",
      "table delimiter (dsv): whole-line in 187 of 188 states",
      "table delimiter (nested): whole-line in 187 of 188 states",
      "indented line: whole-line in 112 of 188 states",
      "admonition marker: whole-line in 108 of 188 states",
      "conditional directive: windowed at 10 bytes",
      "include directive: windowed at 12 bytes",
      "block macro: whole-line in 112 of 188 states",
      "dlist term: whole-line in 12 of 188 states",
      "dlist term (:::): whole-line in 12 of 188 states",
      "dlist term (::::): whole-line in 12 of 188 states",
      "dlist term (;;): whole-line in 12 of 188 states",
      "dlist term (bare ::): whole-line in 12 of 188 states",
      "dlist term (multi-word): whole-line in 12 of 188 states",
      "thematic break: whole-line in 112 of 188 states",
      "markdown thematic break (hyphens): whole-line in 187 of 188 states",
      "markdown thematic break (asterisks): whole-line in 187 of 188 states",
      "markdown thematic break (underscores): whole-line in 187 of 188 states",
      "page break: whole-line in 112 of 188 states",
      "section marker: whole-line in 112 of 188 states",
    ]);
  });

  // The totals the whole question reduces to. 52 of the 55
  // construct kinds need the whole line in at least one reachable
  // state; exactly one (`list continuation`, the bare `+`) needs it in
  // every state. Both readings are pinned because they are different
  // questions and the difference is 51 constructs.
  test("counts the construct kinds a window cannot decide", () => {
    expect(registry.wholeLineConstructs).toHaveLength(52);
    expect(registry.alwaysWholeLineConstructs).toEqual(["list continuation"]);
    expect(registry.windowedCells).toBe(4876);
    expect(registry.wholeLineCells).toBe(5464);
    expect(registry.windowBytes).toBe(15);
  });

  // The size of the table a generator would emit from these windows,
  // and whether it is a table at all. An entry is one (state, prefix,
  // suffix) row; a conflict is two rows of one state where every line
  // matching the longer also matches the shorter and the two carry
  // opposite verdicts, which is a lookup with no answer.
  //
  // Zero conflicts is what the registry alphabet buys. The
  // ordinary-text alphabet's 1,197 are the same measurement failing:
  // its windows are short enough to subsume one another (a bare `[`
  // saying "continues" under a `[s`...`]` saying "interrupts"), so
  // its 5,632 entries could not be compiled into a lookup even though
  // there are fewer whole-line constructs to compile around.
  test("prices the table a generator would emit", () => {
    expect(registry.tableEntries).toBe(3808);
    expect(registry.tableConflicts).toBe(0);
    expect(ordinary.tableEntries).toBe(5632);
    expect(ordinary.tableConflicts).toBe(1197);
  });

  // The contrast the second alphabet exists for: assuming the bytes
  // between the two ends carry no AsciiDoc punctuation cuts the
  // whole-line construct kinds from 52 to 20 and the whole-line cells
  // from 5,464 to 2,764. It does not cut them to zero, and the
  // assumption is not one a packer joining arbitrary source words can
  // make, so the number is a bound on what any interior restriction
  // could buy rather than a design.
  test("counts what an inert interior would buy", () => {
    expect(ordinary.wholeLineConstructs).toHaveLength(20);
    expect(ordinary.windowedCells).toBe(7576);
    expect(ordinary.wholeLineCells).toBe(2764);
  });
});
