/**
 * The run between a list marker and its text is DATA, the way the
 * marker's own indent is: the classifier already matched it,
 * `ListItemNode.markerGap` carries its bytes, and the printer writes
 * them back instead of the one space it used to normalize to.
 *
 * The gap is load-bearing because of what the marks around it can
 * spell. Asciidoctor reads a thematic break through
 * `ExtLayoutBreakRx` (rx.rb l.650, `/^(?:'{3,}|<{3,}|([-*_])( *)\1\2\1)$/`)
 * and `MarkdownThematicBreakRx` (rx.rb l.638,
 * `/^ {0,3}([-*_])( *)\1\2\1$/`), and both want THREE identical marks
 * with EQUAL runs of SPACES between them. `-  - -` fails that - the
 * runs are two columns then one - so `UnorderedListRx` (rx.rb l.284)
 * reads it as a one-item list whose text is `- -`. Normalized to
 * `- - -` it is an `<hr>` (issue #191, sub-mechanism A: the fold guard
 * is never consulted, because the item text's own run is already one
 * space and there is nothing left to fold).
 *
 * The same fact closes sub-mechanism B. The guard that refuses the
 * fold (`fuseRunsSpellingABreak`, src/print/whitespace-fold.ts) has to
 * know whether the SOURCE's line already spelled the rule, and the gap
 * in front of the value is half of that line. It used to be handed a
 * WIDTH, so ` \t` measured equal to a two-space run and the guard
 * concluded the author had already written the rule; handed the BYTES
 * it sees a tab, which neither pattern accepts, and holds the run.
 */
import { describe, test } from "vitest";
import { expectFormatted } from "../helpers.js";

describe("a list marker's gap keeps its bytes", () => {
  // Red before `markerGap`: every row printed `- - -` / `* * *` and
  // rendered an `<hr>` where the source rendered a one-item list.
  // Idempotence held on all of them, which is what made the class
  // render-only and invisible to the idempotency batteries.
  test.each([
    ["a wide gap, sub-mechanism A", "-  - -\n"],
    ["a tab gap, sub-mechanism A", "-\t- -\n"],
    ["a wide gap on stars", "*  * *\n"],
    ["a tab gap on stars", "*\t* *\n"],
    ["a mixed gap, sub-mechanism B", "- \t-  -\n"],
    ["a mixed gap on stars, sub-mechanism B", "* \t*  *\n"],
    ["a wider gap still", "-   - -\n"],
  ])("%s", async (_name, input) => {
    await expectFormatted(input, input);
  });

  // The same bytes on every other item, where no rule is at stake:
  // the run travels because it is the author's, not because the
  // printer weighed what it would spell.
  test.each([
    ["an ordinary wide gap", "*  a\n"],
    ["an ordinary tab gap", "*\ta\n"],
    ["an ordered marker", ".  a\n"],
    ["an explicit ordered marker", "1.  a\n"],
    ["a nested marker", "* a\n**  b\n"],
    ["an indented marker's gap", "* a\n  **  b\n"],
    ["a checklist item", "*  [x] a\n"],
    ["a wrapped item keeps its hanging indent", "*   aaaa bbbb cccc\n"],
  ])("%s", async (_name, input) => {
    await expectFormatted(input, input);
  });

  // A callout's gap travels the same way. `CalloutListRx` (rx.rb
  // l.358) allows no leading whitespace but does spell its own
  // `[ \t]+` between the marker and the text.
  test("a callout item's gap", async () => {
    await expectFormatted(
      "----\nx\n----\n<1>  a\n",
      "----\nx\n----\n\n<1>  a\n",
    );
  });
});
