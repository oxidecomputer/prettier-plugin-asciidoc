/**
 * hazard(item) — Rulings 26–30 as a pure predicate over the finished
 * node (spec D2). The printer asks this function; the old reader's
 * streaming machinery (holdMark/startHeldRun/
 * reflowWouldReachFirstRestLine) is gone with the cut-over, and the
 * rows below — written against that reader's measured behaviour —
 * are the contract the predicate carried across it unchanged. They
 * mirror tests/format/list-item-blocks.test.ts and
 * list-continuation.test.ts, which pin the same facts as bytes.
 */
import { describe, expect, test } from "vitest";
import type { ListItemNode } from "../../src/ast.js";
import { hazard } from "../../src/print-list-hazard.js";
import { parse } from "../../src/parser.js";

/**
 * The first list item of a parsed document.
 * @param source - a document whose first block is a list
 * @returns its first item
 * @throws {Error} when the first block is not a list — a broken row
 *   input, which must say so rather than assert on the wrong node
 */
function firstItem(source: string): ListItemNode {
  const { children } = parse(source);
  const [list] = children;
  if (list.type !== "list") throw new Error("expected a list");
  const { children: items } = list;
  const [item] = items;
  return item;
}

describe("hazard", () => {
  test.each([
    // Single-line text: metadata on the first rest line reads as
    // metadata after reflow too — keep the spelling (Ruling 26's
    // "more than one line" clause; pinned: "metadata and its block").
    ["* a\n[role]\npara\n", "none"],
    // Multi-line text, metadata run, block follows: explicit `+`
    // (Ruling 26/27; pinned by the list-continuation suite). Today's
    // measured output for the third row is "* a b\n+\n[role]\n.T\npara\n".
    ["* a\nb\n[role]\npara\n", "plus"],
    ["* a\nb\n[[anc]]\npara\n", "plus"],
    ["* a\nb\n[role]\n.T\npara\n", "plus"],
    // Trailing run with no title: a reflowed [role] on the first rest
    // line is still read as metadata — no `+`, no kept break.
    ["* a\nb\n[role]\n", "none"],
    // A bare `.T` under item text is not metadata at all: BLOCK_TITLE
    // is in no interrupting set (Ruby's StartOfBlockProc), so it folds
    // into the item TEXT — zero blocks, no run, no hazard. Measured:
    // astShape = item(t / t / t), formatAdoc → "* a b .T\n".
    ["* a\nb\n.T\n", "none"],
    // Trailing run carrying a block title: keep the text's last break
    // (Rulings 28/29/30; pinned at list-item-blocks "single-line item
    // text is untouched" / the `.T` re-parse rows).
    ["* a\nb\n[role]\n.T\n", "keepBreak"],
    ["* a\n  para\n[role]\n.T\n", "keepBreak"],
    // The listing does NOT enter the item (continuation is :inactive
    // at the `----` line, so l.1445-46 breaks the extent): the run is
    // TRAILING and carries a title → keepBreak, not plus. Measured at
    // the pre-cut-over baseline:
    // "* a\n  b\n[role]\n.T\n\n----\nx\n----\n" — the kept break, no `+`.
    ["* a\nb\n[role]\n.T\n----\nx\n----\n", "keepBreak"],
    // Ruling 66: an AUTHOR-written `+` between two metadata lines does
    // not end the run — the `+` is replayed verbatim from the gap, so
    // the attachment needs no help and today's reader introduces
    // nothing. Measured: rows 1/2/3 print their input back unchanged
    // except for the text reflow the answer asks for, and rows 2/3 keep
    // the text break.
    ["* a\npara\n[role]\n+\n[role]\n", "none"],
    ["* a\npara\n[role]\n+\n.T\n", "keepBreak"],
    ["* a\n.T\n[[anc]]\n+\n.T\n", "keepBreak"],
    // …but a `+`-separated block that is NOT metadata really does
    // follow the run, and the reader really does introduce a `+` for it:
    // measured "* a para\n+\n[role]\n+\npara\n". This is why the rule
    // lives in the run, not in a "skip +-introduced blocks" filter on
    // the follows count — such a filter would answer "none" here.
    ["* a\npara\n[role]\n+\npara\n", "plus"],
    // Rulings 64 and 66 compose without double-counting: a comment
    // block behind an author `+` is read through by either clause, and
    // a comment INSIDE the run does not stop the `+` after it from
    // carrying the title into the run.
    ["* a\npara\n[role]\n+\n// c\n", "none"],
    // …but a `////` comment BLOCK is not transparent: `skip_line_comments`
    // skips `//` LINES only, so the block is a block of the item that
    // follows the run and earns the `+` (found by the plan's mutation
    // pass — the mutants that let a comment block through here changed
    // real bytes and were killed by no test; also pinned as bytes at
    // list-item-blocks "a comment BLOCK behind the run").
    ["* a\npara\n[role]\n+\n////\nc\n////\n", "plus"],
    ["* a\npara\n[role]\n// c\n+\n.T\n", "keepBreak"],
    // Line comments are transparent to the BLOCK side of the decision
    // too, not only to the first-rest-line count: today's reader reads
    // straight through a `// c` when it decides whether the run is
    // trailing, so these four rows pin all three answers across one.
    // Measured at the pre-cut-over baseline: the break is kept for the
    // two rows that carry a title; the `plus` row really does print
    // "* a b\n+\n[role]\n// c\npara\n".
    ["* a\nb\n[role]\n// c\n", "none"],
    ["* a\nb\n[role]\n.T\n// c\n", "keepBreak"],
    ["* a\nb\n[role]\n// c\n.T\n", "keepBreak"],
    ["* a\nb\n[role]\n// c\npara\n", "plus"],
    // Comment lines are transparent to the first-rest-line count
    // (Reader#skip_line_comments; pinned at list-item-blocks:152-160).
    ["* a\n// c\n[role]\npara\n", "none"],
    ["* a\n// c\n// d\n[[anc]]\n  lit\n", "none"],
    // A directive inside the text keeps its own line, so reflow can
    // never push the metadata onto the first rest line.
    ["* a\nifdef::x[]\nb\n[role]\npara\n", "none"],
    // A `+` above the run: the gap speaks, no hazard (the run is not
    // directly under the text).
    ["* a\n+\n[role]\n----\nx\n----\n", "none"],
    // A blank above the run: same.
    ["* a\n\n[role]\n  lit\n", "none"],
    // No metadata at all.
    ["* a\nb\npara\n", "none"],
    ["* a\n", "none"],
  ])("%j → %s", (source, expected) => {
    expect(hazard(firstItem(source))).toBe(expected);
  });
});
