/**
 * The family classification's unit tests: which mechanism a reading
 * signature is, and - the half that matters - which ones it is NOT.
 *
 * A family is a mechanism with an issue behind it, so a test that
 * matches more than its mechanism quietly grows that issue's row count
 * with rows its fix will not remove. Every row here is either a
 * measured signature or the near miss that must fall out of the
 * family beside it.
 */
import { describe, expect, test } from "vitest";
import { readingFamily } from "./reading-ledger.js";

describe("readingFamily", () => {
  test.each([
    // The measured inventory: the depth-5 sweep spells the first, and
    // tests/format/reading-invariant.test.ts pins the second as #43's
    // render-corrupting face - the lone `+` joined into the prose
    // beside it, which then re-reads as a description-list term.
    ["[cont] -> []", "lone-plus-join"],
    ["[cont text] -> [dlist:::]", "lone-plus-join"],
    // The continuations go and the list structure beside them stays:
    // #17's trailing-marker collapse, seen from the reading side. The
    // sweep spells hundreds of these and spelled none of them until
    // every lone `+` got a token of its own.
    [
      "[cont marker:unordered:* cont] -> [marker:unordered:*]",
      "continuation-dropped",
    ],
    [
      "[cont marker:unordered:* attrline cont] -> [marker:unordered:* attrline]",
      "continuation-dropped",
    ],
    ["[admon:NOTE] -> [dlist:::]", "admonition-colon-run"],
    ["[indented] -> [text]", "tail-reading-flip"],
    ["[title] -> [text]", "tail-reading-flip"],
    // A de-indented line coming back as a marker, in the three
    // spellings measured over the depth-5 product once the sweep's
    // alphabet carries an indented nested marker. The first two are
    // the de-indented line itself landing inside a paragraph a `+`
    // attached, where the reader keeps a foreign marker as
    // unreflowable `textv`; the empty left side is the case where the
    // indented line FOLDED into the prose run above it and so had no
    // token of its own to lose. The third is the flip landing at a
    // block start, where a marker line is a marker line outright.
    ["[text] -> [textv]", "prose-reads-as-marker"],
    ["[] -> [textv]", "prose-reads-as-marker"],
    ["[text] -> [marker:unordered:*]", "prose-reads-as-marker"],
  ])("%s is %s", (signature, family) => {
    expect(readingFamily(signature)).toBe(family);
  });

  // The two continuation families are disjoint BY CONSTRUCTION, not by
  // arm order: lone-plus-join needs a losing side of nothing but `cont`
  // and `text`, continuation-dropped needs at least one token that is
  // neither. Neither signature can reach both tests.
  test("a cont-only loss stays lone-plus-join, not continuation-dropped", () => {
    expect(readingFamily("[cont cont] -> []")).toBe("lone-plus-join");
  });

  // The stronger half of continuation-dropped's claim: it says the
  // continuations were the ONLY thing that moved. Structure that moved
  // as well fails the equality and has to be named separately.
  test("structure moving alongside a dropped cont is unclassified", () => {
    expect(
      readingFamily("[cont marker:unordered:* cont] -> [marker:unordered:**]"),
    ).toBeUndefined();
  });

  // The narrowing that keeps #43's row count honest. A dropped `cont`
  // is not by itself the lone-plus-join mechanism: what makes it that
  // mechanism is that the `+` and the prose beside it are all that
  // entered the join. A `cont` lost alongside anything else got there
  // some other way and must not be counted against #43 - it lands in
  // another family or, matching none of them, in UNCLASSIFIED, where
  // the generator refuses to write it and asks for a name.
  test("a cont lost beside an admonition is not lone-plus-join", () => {
    expect(readingFamily("[cont admon:NOTE] -> [dlist:::]")).toBe(
      "admonition-colon-run",
    );
  });

  // prose-reads-as-marker is disjoint from the four beside it the same
  // way, and these are the two crossings a reader would doubt: a
  // marker on the winning side is not enough when a `cont` is on the
  // losing one, and a `text` on the winning side is not a marker
  // reading however the losing side was spelled.
  test("a marker won beside a dropped cont stays continuation-dropped", () => {
    expect(
      readingFamily("[cont marker:unordered:* cont] -> [marker:unordered:*]"),
    ).toBe("continuation-dropped");
  });

  test("an indented line flipping to text stays tail-reading-flip", () => {
    expect(readingFamily("[indented] -> [text]")).toBe("tail-reading-flip");
  });

  test.each([
    ["a cont lost beside a marker", "[cont marker:unordered:**] -> [text]"],
    ["a cont lost beside a delimiter", "[cont delim:listing] -> [text]"],
    ["a nesting flatten", "[marker:unordered:**] -> [marker:unordered:*]"],
    ["a section title swallowed", "[section:1] -> []"],
    ["an unparseable signature", "not a signature"],
    // #121 drops leading indent from lines of every shape, and
    // prose-reads-as-marker claims only the ones that come back as a
    // MARKER. A de-indented line that comes back as a delimiter or a
    // section title got there by the same byte change and still has to
    // be named and counted on its own, so the family must not reach
    // it.
    ["a de-indented line read as a delimiter", "[text] -> [delim:listing]"],
    ["a de-indented line read as a section title", "[text] -> [section:1]"],
    // Nor may it reach a losing side that was already structural: the
    // claim is that PROSE gained the marker reading.
    ["an indented reading turned marker", "[indented] -> [textv]"],
    ["a block title turned marker", "[title] -> [marker:unordered:*]"],
    // Nor a winning side carrying anything beside the marker: a
    // signature where more moved than the one line's reading is a
    // wider mechanism than this one.
    ["a marker won alongside prose", "[text] -> [textv text]"],
  ])("%s is unclassified", (_name, signature) => {
    expect(readingFamily(signature)).toBeUndefined();
  });
});
