/**
 * The item scan's THIRD cut, crossed against the oracle: a block
 * attribute line or a block anchor inside a `+`-attached styled
 * verbatim run in a DESCRIPTION item (`read_lines_for_list_item`,
 * parser.rb l.1462-1482).
 *
 * A FILE OF ITS OWN rather than another table in
 * interruption.test.ts, which holds every other registry row: this
 * cut is the one whose verdict is not a fact about the line, so its
 * rows carry a reading ({@link AttributeRunReading}) that no other
 * row varies, and the two suites would otherwise share one
 * `max-lines` budget for two different claims.
 *
 * WHAT DECIDES IT IS NOT THE LINE. Ruby reads FORWARD past the
 * `[...]` line, over the run of further attribute lines and blanks
 * (l.1464-1470), and lets the first line PAST the run decide, so
 * `[a]` / `[b]` / `* n` and `[a]` / `[b]` / `x` part only on their
 * third line and no single following line can tell them apart. The
 * verdict rides in as {@link ReaderContext.attributeRun}.
 *
 * The same oracle question as every other registry row, through the
 * same {@link oracleInterrupts}: does the construct grow the block
 * count of the document it stands in. What the FORMATTER does with
 * the same shapes is pinned separately, in
 * tests/format/description-item-attribute-cut.test.ts.
 */
import { describe, test, expect } from "vitest";
import type {
  AttributeRunReading,
  ReaderContext,
} from "../../src/parse/line-shapes.js";
import { interruptsParagraph } from "../../src/parse/line-shapes-interruption.js";
import { oracleInterrupts } from "./interruption-probes.js";

// The filler that pushes the construct off the block's opening line,
// the same spelling POSITIONS gives it (interruption-probes.ts).
const LATER_LINE_FILLER = "mid line\n";

// The rows cross the reading's two verdicts with the shapes that can
// stand below the run, and each is measured against the oracle rather
// than read off the Ruby.
//
// RED BEFORE THE READING EXISTED: the registry answered "continues"
// at every one of these positions, so the five `runEndsTheItem` rows
// failed. Answering "ends" at every one of them instead is the other
// failure, and it is not a model one: it cut the run early, the lines
// below were read as a nested item's text, and the printer joined
// them INSIDE the listing block, printing `[note]` / `* n b` where
// the oracle keeps the break inside `<pre>`. The formatted rows carry
// that witness (tests/format/description-item-attribute-cut.test.ts).
describe("the block attribute cut inside a description item", () => {
  const PREFIX = "term1:: desc\n+\n[source]\nfirst content line";
  const readerFor = (attributeRun: AttributeRunReading): ReaderContext => ({
    openParagraph: "verbatimStyled",
    openList: { kind: "description", delimiter: "::" },
    firstLineAfterStart: false,
    nextLine: undefined,
    substitutedContentAbove: false,
    markerLineWins: false,
    attributeRun,
  });

  // [what stands below the run, the whole construct, the reading, ends]
  const ROWS: Array<[string, string, AttributeRunReading, boolean]> = [
    // An ordinary line: `else` at l.1473-1474, so the item ends.
    ["an ordinary line", "[source]", "runEndsTheItem", true],
    // A non-sibling list item: l.1471-1472 concatenates the run.
    ["a foreign list item", "[source]\n* n", "runIsInTheItem", false],
    // The same two, one further down, so a single following line
    // cannot tell them apart: both open with `[source]` / `[b]`.
    [
      "a foreign item past a second attribute line",
      "[source]\n[b]\n* n",
      "runIsInTheItem",
      false,
    ],
    [
      "an ordinary line past a second attribute line",
      "[source]\n[b]\nx",
      "runEndsTheItem",
      true,
    ],
    // A SIBLING term is a list item too, and l.1471's `&&
    // !(is_sibling_list_item? ...)` is what keeps it out of the
    // concatenating branch.
    ["a sibling term", "[source]\nterm2:: d", "runEndsTheItem", true],
    // The one shape with its own arm, l.1466-1467.
    ["a delimited block", "[source]\n----\nc\n----", "runEndsTheItem", true],
    // The anchor spelling of `BlockAttributeLineRx`, both ways.
    ["an ordinary line under an anchor", "[[x]]", "runEndsTheItem", true],
    [
      "a foreign list item under an anchor",
      "[[x]]\n* n",
      "runIsInTheItem",
      false,
    ],
  ];

  // A BLANK below the run is deliberately absent. The look-ahead
  // consumes one and the item runs on (`next_line.empty?`, parser.rb
  // l.1468).

  // A blank ALSO ends the styled run in its own right, through the
  // `break_on_blank_lines` that `read_lines_until` is passed for a
  // verbatim content model (parser.rb l.1028), so the block count
  // this probe reads cannot say which of the two lines moved it.
  // `term1:: desc` / `+` / `[source]` / `a` / `[note]` / blank / `b`
  // is pinned as a formatted row instead
  // (tests/format/description-item-attribute-cut.test.ts).
  test.each(ROWS)("%s", async (_below, construct, attributeRun, ends) => {
    const [line] = construct.split("\n");
    expect(
      await oracleInterrupts(construct, PREFIX, LATER_LINE_FILLER),
      `the oracle disagrees with this row for ${JSON.stringify(construct)}`,
    ).toBe(ends);
    expect(
      interruptsParagraph(line, "verbatimStyled", readerFor(attributeRun)),
      `the registry disagrees with the oracle for ${JSON.stringify(construct)}`,
    ).toBe(ends);
  });
});
