/**
 * A block attribute line or a block anchor inside a `+`-attached
 * styled verbatim run in a DESCRIPTION item, which is where the
 * reference's item scan takes its third cut (`read_lines_for_list_item`,
 * parser.rb l.1462-1482).
 *
 * WHAT DECIDES THE CUT IS NOT THE LINE. Ruby reads FORWARD past the
 * `[...]` line, over the run of further attribute lines and blanks
 * (l.1464-1470), and lets the first line PAST the run decide: a list
 * item that is not a sibling of the open list keeps the whole run
 * inside the item (l.1471-1472), and anything else - an ordinary
 * line, a sibling term, a delimited block line - ends the item in
 * front of it (l.1466-1467, l.1473-1474). `[note]` / `[warn]` /
 * `* n` and `[note]` / `[warn]` / `x` therefore differ only on their
 * third line, and the rows below cross both answers with both
 * spellings of the shape.
 *
 * WHY IT IS A FORMAT TEST AND NOT ONLY A REGISTRY ONE. Reading the
 * cut off the line alone gets the KEPT rows wrong, and not as a lost
 * node: the run is cut at the attribute line, the lines below it are
 * read as a nested item's text, and the printer JOINS them - inside a
 * listing block, where the newline between them is content. The
 * first row printed `...\n[note]\n* n b\n` under that reading and
 * lost a break the render keeps inside `<pre>`.
 *
 * Every row here is already a fixed point, so `expectFormatted` is
 * passed its own input wherever the source is what the formatter
 * writes back. Each was measured to render the same before and after
 * formatting under BOTH programs: the pinned oracle through
 * `renderedHtml`, and Asciidoctor Ruby 2.0.26 through
 * `Asciidoctor.convert` on the vendored gem.
 */
import { describe, test } from "vitest";
import { expectFormatted } from "../helpers.js";

describe("the run below the attribute line keeps it in the item", () => {
  test("a foreign list item below it", async () => {
    const source = "term1:: desc\n+\n[source]\na\n[note]\n* n\nb\n";
    await expectFormatted(source, source);
  });

  // The pair a single following line cannot tell apart: this row and
  // the "an ordinary line past a second attribute line" row below
  // share their first two lines under `a`.
  test("a foreign list item past a second attribute line", async () => {
    const source = "term1:: desc\n+\n[source]\na\n[note]\n[warn]\n* n\nb\n";
    await expectFormatted(source, source);
  });

  test("a foreign list item below a block anchor", async () => {
    const source = "term1:: desc\n+\n[source]\na\n[[x]]\n* n\nb\n";
    await expectFormatted(source, source);
  });

  // A nested TERM is a list item to `AnyListRx` as much as a marker
  // is, and `:::` is not a sibling of the `::` list that is open.
  test("a nested term below it", async () => {
    const source = "term1:: desc\n+\n[source]\na\n[note]\nsub::: d\nb\n";
    await expectFormatted(source, source);
  });

  // Two runs in one item, so the second one's own look-ahead runs
  // with a nested list already open.
  test("two kept runs in one item", async () => {
    const source =
      "term1:: desc\n+\n[source]\na\n[note]\n* n\n[warn]\n* m\nb\n";
    await expectFormatted(source, source);
  });

  // The other verbatim style, since the run's extent is the style's
  // and not `[source]`'s.
  test("a literal style rather than a source one", async () => {
    const source = "term1:: desc\n+\n[literal]\na\n[note]\n* n\nb\n";
    await expectFormatted(source, source);
  });

  test("a delimiter other than the first", async () => {
    const source = "term1::: desc\n+\n[source]\na\n[note]\n* n\nb\n";
    await expectFormatted(source, source);
  });
});

describe("the run below the attribute line ends the item", () => {
  // The item ends in front of `[note]`, so the attribute line and the
  // line under it are a block of the document rather than of the
  // item, and the printer writes the blank line that separates them.
  test("an ordinary line below it", async () => {
    await expectFormatted(
      "term1:: desc\n+\n[source]\na\n[note]\nx\n",
      "term1:: desc\n+\n[source]\na\n\n[note]\nx\n",
    );
  });

  test("an ordinary line past a second attribute line", async () => {
    await expectFormatted(
      "term1:: desc\n+\n[source]\na\n[note]\n[warn]\nx\n",
      "term1:: desc\n+\n[source]\na\n\n[note]\n[warn]\nx\n",
    );
  });

  test("a sibling term below it", async () => {
    await expectFormatted(
      "term1:: desc\n+\n[source]\na\n[note]\nterm2:: d\n",
      "term1:: desc\n+\n[source]\na\n\n[note]\nterm2:: d\n",
    );
  });

  test("a delimited block below it", async () => {
    await expectFormatted(
      "term1:: desc\n+\n[source]\na\n[note]\n----\nc\n----\n",
      "term1:: desc\n+\n[source]\na\n\n[note]\n----\nc\n----\n",
    );
  });

  test("an ordinary line below a block anchor", async () => {
    await expectFormatted(
      "term1:: desc\n+\n[source]\na\n[[x]]\nb\n",
      "term1:: desc\n+\n[source]\na\n\n[[x]]\n\nb\n",
    );
  });

  test("a delimiter other than the first", async () => {
    await expectFormatted(
      "term1;; desc\n+\n[source]\na\n[note]\nx\n",
      "term1;; desc\n+\n[source]\na\n\n[note]\nx\n",
    );
  });

  // The look-ahead CONSUMES a blank line (l.1468) and the item runs
  // on, but the blank ends the styled run in its own right
  // (`read_lines_until break_on_blank_lines`, parser.rb l.1028), so
  // the attribute line stands at a block start either way. The row
  // is here because it is the one shape whose two rules disagree
  // about which line did it.
  test("a blank line below it", async () => {
    await expectFormatted(
      "term1:: desc\n+\n[source]\na\n[note]\n\nb\n",
      "term1:: desc\n+\n[source]\na\n\n[note]\nb\n",
    );
  });
});
