/**
 * The pair grid's coverage claim for the separator COUNT after an
 * item whose body a head drain takes.
 *
 * `pairGrid()` is swept by the registry sweep's deep tier and measured
 * by the reparse ledger, but neither of those notices a shape the grid
 * never mints: a missing coordinate is a green run. The census pins
 * the grid's SIZE, which catches a join being deleted only in the
 * arithmetic; this pins the DOCUMENTS the join exists for, so the
 * shape survives a refactor of the alphabet, the ids or the container
 * subset.
 *
 * WHAT THE SHAPE IS. A list item or a description whose body is a
 * `//`-headed run, then two blank lines, then a block that would
 * ATTACH to the item across one blank line. The head drain swallows
 * the comment run, and the printer then has to re-emit a separator
 * wide enough that the block stays outside the item; one blank line is
 * the attaching spelling, so a formatter that closed the gap with one
 * blank changed what the document renders as. Every join the grid had
 * before spelled one blank at most, so the whole family was
 * unreachable and eighteen such documents regressed under a green
 * suite (issue #264).
 *
 * Matched on the realized DOCUMENT rather than on a row id, because
 * the claim is about the bytes reaching the sweep.
 */
import { describe, expect, test } from "vitest";
import { pairGrid } from "../../scripts/shape-registry.js";

/** The realized documents, as a set, so membership is one lookup. */
const REALIZED = new Set(pairGrid().map((shape) => shape.input));

/** The item body a head drain takes, leaving the item head shielded. */
const DRAINED_BODY = "// c";

/**
 * The blocks that attach to an item across ONE blank line, which is
 * what makes the two-blank spelling a different document rather than a
 * longer one.
 *
 * Issue #264 names FOUR kinds and three are here. The fourth, a bare
 * paragraph line, is not a member of the pair alphabet: every member
 * is a `CONSTRUCTS` body, and the registry has no construct whose
 * body is ordinary prose - the paragraph spelling the grid used to
 * reach was `indented-line`'s near miss, and near misses left the
 * pair alphabet with issue #285. The mechanism is the separator
 * COUNT, which is a property of the item head and the drain rather
 * than of the tail's kind, so the three that remain still spell it;
 * what is no longer spelled is the tail an author is likeliest to
 * type.
 */
const ATTACHABLE: ReadonlyArray<{
  readonly what: string;
  readonly block: string;
}> = [
  { what: "a listing", block: "----\nfoo\n----" },
  { what: "block metadata", block: ".T" },
  { what: "a section title", block: "== T" },
];

/** The two item kinds the separator count is decided differently in. */
const ITEMS: ReadonlyArray<{
  readonly what: string;
  readonly head: string;
}> = [
  { what: "a description item", head: "term::" },
  { what: "a marker item", head: "* item\n+" },
];

describe("the pair grid reaches the detached tail of a drained item", () => {
  test.each(
    ITEMS.flatMap((item) =>
      ATTACHABLE.map((tail) => ({
        item: item.what,
        tail: tail.what,
        document: `${item.head}\n${DRAINED_BODY}\n\n\n${tail.block}\n`,
      })),
    ),
  )("$item, a drained body, two blanks, $tail", ({ document }) => {
    expect(REALIZED).toContain(document);
  });
});
