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
    ["[admon:NOTE] -> [dlist:::]", "admonition-colon-run"],
    ["[indented] -> [text]", "tail-reading-flip"],
    ["[title] -> [text]", "tail-reading-flip"],
  ])("%s is %s", (signature, family) => {
    expect(readingFamily(signature)).toBe(family);
  });

  // The narrowing that keeps #43's row count honest. A dropped `cont`
  // is not by itself the lone-plus-join mechanism: what makes it that
  // mechanism is that the `+` and the prose beside it are all that
  // entered the join. A `cont` lost alongside anything else got there
  // some other way and must not be counted against #43 - it lands in
  // another family or, failing all three, in UNCLASSIFIED, where the
  // generator refuses to write it and asks for a name.
  test("a cont lost beside an admonition is not lone-plus-join", () => {
    expect(readingFamily("[cont admon:NOTE] -> [dlist:::]")).toBe(
      "admonition-colon-run",
    );
  });

  test.each([
    ["a cont lost beside a marker", "[cont marker:unordered:**] -> [text]"],
    ["a cont lost beside a delimiter", "[cont delim:listing] -> [text]"],
    ["a nesting flatten", "[marker:unordered:**] -> [marker:unordered:*]"],
    ["a section title swallowed", "[section:1] -> []"],
    ["an unparseable signature", "not a signature"],
  ])("%s is unclassified", (_name, signature) => {
    expect(readingFamily(signature)).toBeUndefined();
  });
});
