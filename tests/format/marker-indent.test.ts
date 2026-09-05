/**
 * A marker's own leading indent is DATA, the way its spelling is: the
 * classifier already read it, `ListItemNode.markerIndent` carries it,
 * and the printer writes it back in front of the marker.
 *
 * The indent is load-bearing because of where Ruby tests it. Under a
 * live `+` an indented line matches `LiteralParagraphRx` first
 * (parser.rb l.1488), so the item slurps it with `read_lines_until
 * break_on_blank_lines, break_on_list_continuation` (l.1495) and
 * every line behind it up to the next blank - the sibling marker that
 * would have ended the item included. The nested list that
 * `next_block` then reads out of the slurped run owns the lines that
 * follow it. Flush left the same marker takes the arm below
 * (l.1502-04), raises `within_nested_list`, and leaves the sibling to
 * `is_sibling_list_item?` (l.1430).
 *
 * So `"* a\n+\n  ** z\n* a\n"` renders the trailing `* a` as a CHILD
 * of `z`, and de-indented it renders as a sibling of the outer item.
 * Before the indent was recorded the printer had nothing to write it
 * back from and produced exactly that de-indent (issue #121).
 */
import { describe, test } from "vitest";
import { expectFormatted } from "../helpers.js";

describe("an indented marker keeps its indent", () => {
  // Red before `markerIndent`: every row printed its marker at column
  // 0, and all five rows that carry a `+` changed what the document
  // renders as - the trailing item moved from child to sibling.
  test.each([
    ["the minimal witness", "* a\n+\n  ** z\n* a\n"],
    ["ordered markers", ". a\n+\n  .. z\n. a\n"],
    ["a wider indent", "* a\n+\n    ** z\n* a\n"],
    ["a tab", "* a\n+\n\t** z\n* a\n"],
    ["a chain of indented markers", "* a\n+\n  ** z\n  *** q\n* a\n"],
    // No `+`, so the slurp never starts and the render was already
    // preserved; the bytes were not, and a marker the author indented
    // is a marker this printer writes back indented wherever it sits.
    ["no continuation", "* a\n  ** z\n* a\n"],
    ["a top-level list", "  * a\n  * b\n"],
  ])("%s", async (_name, input) => {
    await expectFormatted(input, input);
  });
});
