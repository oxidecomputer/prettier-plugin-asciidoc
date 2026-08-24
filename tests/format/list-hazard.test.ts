/**
 * hazard(item) — a pure predicate over the finished
 * node, with TWO answers: `"keepBreak"` (hold the text's last source
 * break so the re-reader meets the metadata where the author put it)
 * and `"none"` (replay the gap verbatim). There is no third answer,
 * because the printer never invents a continuation line. The rows
 * below mirror tests/format/list-item-blocks.test.ts and
 * list-continuation.test.ts, which pin the same facts as bytes. The
 * sufficiency argument for the two answers is stated once, in
 * src/print/list-hazard.ts's module comment; it is not re-derived
 * here or in those suites.
 */
import { describe, expect, test } from "vitest";
import type { ListItemNode } from "../../src/ast.js";
import { hazard } from "../../src/print/list-hazard.js";
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
    // metadata after reflow too — keep the spelling (the "more than
    // one line" clause; pinned: "metadata and its block").
    ["* a\n[role]\npara\n", "none"],
    // Multi-line text, metadata run, block follows: hold the text's
    // last break, so a TEXT line lands on the first rest line and the
    // re-reader's drain meets the run where the author wrote it
    // (pinned by the list-continuation suite).
    ["* a\nb\n[role]\npara\n", "keepBreak"],
    ["* a\nb\n[[anc]]\npara\n", "keepBreak"],
    ["* a\nb\n[role]\n.T\npara\n", "keepBreak"],
    // Trailing run with no title: a reflowed [role] on the first rest
    // line is still read as metadata — nothing to compensate for.
    ["* a\nb\n[role]\n", "none"],
    // A bare `.T` under item text is not metadata at all: BLOCK_TITLE
    // is in no interrupting set (Ruby's StartOfBlockProc), so it folds
    // into the item TEXT — zero blocks, no run, no hazard. Measured:
    // astShape = item(t / t / t), formatAdoc → "* a b .T\n".
    ["* a\nb\n.T\n", "none"],
    // Trailing run carrying a block title: keep the text's last break
    // (pinned at list-item-blocks "single-line item
    // text is untouched" / the `.T` re-parse rows).
    ["* a\nb\n[role]\n.T\n", "keepBreak"],
    ["* a\n  para\n[role]\n.T\n", "keepBreak"],
    // The listing does NOT enter the item (continuation is :inactive
    // at the `----` line, so l.1455-56 breaks the extent): the run is
    // TRAILING and carries a title → keepBreak.
    ["* a\nb\n[role]\n.T\n----\nx\n----\n", "keepBreak"],
    // An AUTHOR-written `+` ends the run: the run's members must each
    // be strictly adjacent, and a `+` in the gap means the gap already
    // speaks. The `+`-separated metadata line is therefore a FOLLOWER
    // — a block of the item after the run — and the run is held back
    // with a kept break. The `+` itself replays verbatim from the gap;
    // the printer adds nothing.
    ["* a\npara\n[role]\n+\n[role]\n", "keepBreak"],
    // Same answer as before this rule, new reason: the `.T` behind the
    // `+` FOLLOWS the run rather than joining it and carrying a title
    // into it.
    ["* a\npara\n[role]\n+\n.T\n", "keepBreak"],
    ["* a\n.T\n[[anc]]\n+\n.T\n", "keepBreak"],
    // A `+`-separated block that is not metadata follows the run the
    // same way — one rule, no special case.
    ["* a\npara\n[role]\n+\npara\n", "keepBreak"],
    // A `+`-separated line COMMENT is transparent to the follows
    // count, so nothing follows the run and the run
    // carries no title: no compensation.
    ["* a\npara\n[role]\n+\n// c\n", "none"],
    // …but a `////` comment BLOCK is not transparent:
    // `skip_line_comments` skips `//` LINES only, so the block is a
    // block of the item that follows the run (found by a mutation
    // pass — the mutants that let a comment block through
    // here changed real bytes and were killed by no test; also pinned
    // as bytes at list-item-blocks "a comment BLOCK behind the run").
    ["* a\npara\n[role]\n+\n////\nc\n////\n", "keepBreak"],
    ["* a\npara\n[role]\n// c\n+\n.T\n", "keepBreak"],
    // Line comments are transparent to the BLOCK side of the decision
    // too, not only to the first-rest-line count: the run reads
    // straight through a `// c` when it decides whether the run is
    // trailing, so these four rows pin both answers across one.
    ["* a\nb\n[role]\n// c\n", "none"],
    ["* a\nb\n[role]\n.T\n// c\n", "keepBreak"],
    ["* a\nb\n[role]\n// c\n.T\n", "keepBreak"],
    ["* a\nb\n[role]\n// c\npara\n", "keepBreak"],
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
