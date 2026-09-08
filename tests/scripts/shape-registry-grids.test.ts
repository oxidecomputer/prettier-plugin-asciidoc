/**
 * The standing grid's coverage claim for the run a marker item's head
 * drain takes.
 *
 * The standing grid is swept by both tiers of the registry sweep and
 * measured by shape-diff, but neither notices a document the grid
 * never mints: a missing coordinate is a green run. The census pins
 * the grid's SIZE, which catches a row being deleted only in the
 * arithmetic; this pins the DOCUMENTS, so the shape survives a
 * refactor of the row ids or of the list they are built from.
 *
 * WHAT THE SHAPE IS. A marker item whose first block is a `//`-headed
 * line carrying more than `//`-headed words, a blank, then the `+` the
 * source wrote under it. `Reader#skip_line_comments` takes such a line
 * by its head and `parse_list_item` drops the run when it reaches the
 * item's buffer end, so the paragraph the line renders leaves the
 * document unless the `+` comes back. Every predicate that asked about
 * the run's words or its inline children instead of its line head
 * withheld that byte on one of the four spellings, and no grid could
 * say so: the four documents were reachable from no product the
 * registry generates (issue #267).
 *
 * Matched on the realized DOCUMENT rather than on a row id, because
 * the claim is about the bytes reaching the sweep.
 *
 * `renderBlind` is asserted beside it, because that flag is the whole
 * difference between a row that detects this and a row that only
 * exists. The sweep runs its fidelity check under `!row.renderBlind`
 * (tests/conformance/registry-sweep.ts), and fidelity is the only one
 * of the three properties these documents fail: the formatter neither
 * crashes on them nor prints them unstably, it drops a paragraph from
 * what Asciidoctor renders. A blind row is therefore a green row
 * whatever the printer does with it, and the four documents would
 * still be grid members with every gate passing.
 */
import { describe, expect, test } from "vitest";
import { standingGrid } from "../../scripts/shape-registry.js";

/** The realized shapes, keyed by document, so a match is one lookup. */
const REALIZED = new Map(
  standingGrid().map((shape) => [shape.input, shape] as const),
);

describe("the standing grid reaches a drained run past its head", () => {
  test.each([
    ["a second word", "* a\n///c x\n\n+\n"],
    ["a hard break", "* a\n/// +\n\n+\n"],
    ["a formatting span", "* a\n///*b*\n\n+\n"],
    ["a macro", "* a\n///https://x[y]\n\n+\n"],
  ])("a marker item whose run carries %s", (_name, document) => {
    const shape = REALIZED.get(document);
    expect(shape).toBeDefined();
    expect(shape?.renderBlind).toBe(false);
  });
});
