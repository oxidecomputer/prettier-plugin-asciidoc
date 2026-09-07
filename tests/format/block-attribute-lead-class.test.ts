/**
 * Format tests for the lead class of a block attribute line: the
 * character class Asciidoctor holds the FIRST byte inside `[...]` to,
 * and the two questions that class answers.
 *
 * Split out of block-attributes.test.ts, which reached its `max-lines`
 * ceiling: this file is one subject and reads as one, so it moved
 * whole rather than being condensed (docs/coding-standards.md forbids
 * cutting comments to fit a limit).
 */
import { describe, test } from "vitest";
import { expectFormatted } from "../helpers.js";

// The LEAD CLASS of a block attribute line (issue #257). Red before
// BLOCK_ATTRIBUTE_LINE_SOURCE stopped approximating Ruby's word class
// with `\w` (src/parse/line-shapes.ts): `[ünicode]` was prose to the
// reader, the paragraph under it joined onto the same line, and the
// render lost both the metadata and the paragraph's first line. Every
// row was measured through both programs before it was written.
//
// Only the FIRST character inside the brackets is held to the class,
// which is why `[café]` was already right and why `[ün icode]` - a
// space in the unconstrained tail - is an attribute line. `[ünicode]`
// carries a style, `[#ünicode]` an id and `[.ünicode]` a role, so the
// three shorthand routes off that first character are each pinned
// with a non-ASCII payload.
//
// The id route is the one that does not come back as it went in, and
// the reason is not this class: an interior that names an id and
// nothing else is RESPELLED as the anchor line it is (issue #203 and
// the `[#café]` row above), which is licensed here because both
// programs read `id="ünicode"` off `[#ünicode]` and off
// `[[ünicode]]` alike (measured through both). What this row adds is
// that the interior reaches that respelling at all, which it did not
// while the lead class was ASCII.
describe("a block attribute line's lead outside ASCII", () => {
  test.each([
    ["[ünicode]\npara\n", "[ünicode]\npara\n"],
    ["[日本]\npara\n", "[日本]\npara\n"],
    ["[café]\npara\n", "[café]\npara\n"],
    ["[ün icode]\npara\n", "[ün icode]\npara\n"],
    ["[#ünicode]\npara\n", "[[ünicode]]\n\npara\n"],
    ["[.ünicode]\npara\n", "[.ünicode]\npara\n"],
    ["[ünicode, role=x]\npara\n", "[ünicode,role=x]\npara\n"],
    ["[1x]\npara\n", "[1x]\npara\n"],
    ["[_x]\npara\n", "[_x]\npara\n"],
    ["para\n[ünicode]\nmore\n", "para\n\n[ünicode]\nmore\n"],
    // NOT attribute lines, and the paragraph under them is meant to
    // join: a blank lead is outside the class to both authorities,
    // and an empty interior is an attribute line that carries nothing.
    ["[ ünicode]\npara\n", "[ ünicode] para\n"],
    ["[]\npara\n", "[]\npara\n"],
  ])("%j formats to %j", async (input, expected) => {
    await expectFormatted(input, expected);
  });

  // The two class EDGES, where the authorities disagree and the
  // registry follows the oracle - the program every render assertion
  // in this suite runs. U+00BD is in the oracle's `\p{N}` and outside
  // Ruby's `\p{Digit}`, so its line is metadata here and comes back
  // unchanged; U+0301 is in Ruby's `\p{Word}` and outside the
  // oracle's `\p{Alphabetic}`, so its line is prose here and joins
  // whatever stands under it.
  //
  // How far that costs the reference implementation is NOT bounded by
  // the row below, and the comment says so rather than promising a
  // paragraph. Joining the line is the mild case; what the line joins
  // decides the rest, and `[\u0301x]\n----\ncode\n----` formats to
  // `== [\u0301x]\n\n== code\n`, two section titles where the
  // reference implementation rendered an attribute line and a listing
  // block. What is bounded is the REGRESSION: U+0301 is outside `\w`
  // as well, so every one of these outputs is what this formatter
  // already produced before the class was widened, and no byte the
  // author wrote leaves the output in any of them.
  test.each([
    ["[½x]\npara\n", "[½x]\npara\n"],
    ["[\u0301x]\npara\n", "[\u0301x] para\n"],
  ])("%j formats to %j", async (input, expected) => {
    await expectFormatted(input, expected);
  });

  // NOT PROTECTED BY DESIGN: the INTERIOR of a line only ONE
  // authority reads as metadata. `canonicalAttrlist` used to return
  // such an interior unchanged, so that comma respacing and a later
  // field's quote drop could not rewrite bytes the reference
  // implementation renders as prose. It respells them now. There is
  // nothing to preserve where the two programs disagree about what
  // the line even is, and a lead outside their agreement is one they
  // disagree about by construction: U+00BD is `\p{No}`, which the
  // oracle's `\p{N}` takes and Ruby's `\p{Digit}` does not.
  //
  // Measured on the first row. To the oracle both spellings are the
  // same attribute line and render `<div class="paragraph y">
  // <p>para</p></div>`. To Ruby 2.0.26 both are prose, and the
  // rendered text moves from `[½x, role=y]` to `[½x,role=y]`; on the
  // second row it moves from `[½x, "b c"]` to `[½x,b c]`, losing two
  // quotes and a blank. `[日本, role=y]` is the control: 日 is in
  // both classes, so its respelling was never in question.
  test.each([
    ["[½x, role=y]\npara\n", "[½x,role=y]\npara\n"],
    ['[½x, "b c"]\npara\n', "[½x,b c]\npara\n"],
    ["[日本, role=y]\npara\n", "[日本,role=y]\npara\n"],
  ])("%j formats to %j", async (input, expected) => {
    await expectFormatted(input, expected);
  });

  // An ASTRAL lead is inside the agreed class and must respell like
  // any other letter. U+10400 is alphabetic to both programs, so
  // every row here is the ordinary behaviour, not an edge: the
  // interior is respaced and a quoted first field loses its quotes.
  // Red before the two class questions read a CODE POINT instead of
  // indexing: a surrogate PAIR's leading unit is a lone surrogate in
  // no Unicode class at all, so the gate and the unquoting guard both
  // answered "outside the class" and refused, leaving
  // `[𐐀x, role=y]` unrespaced and `["𐐀x"]` quoted.
  test.each([
    ["[𐐀x]\npara\n", "[𐐀x]\npara\n"],
    ["[𐐀x, role=y]\npara\n", "[𐐀x,role=y]\npara\n"],
    ['["𐐀x"]\npara\n', "[𐐀x]\npara\n"],
  ])("%j formats to %j", async (input, expected) => {
    await expectFormatted(input, expected);
  });

  // The EMITTER half of the same class question. Dropping a first
  // field's quotes rewrites the line's own leading character, so it
  // may only fire where BOTH programs read the result as an attribute
  // line (ATTRLIST_LEADING_CHARACTER, src/parse/line-shapes.ts).
  //
  // Red on the first two rows before the guard's class was widened:
  // the quotes stayed on, because an ASCII `\w` refused a lead the
  // oracle and the Ruby both accept. The third row is the reason the
  // guard is NARROWER than the reader's class rather than equal to
  // it, and the reason this half survives where the whole-interior
  // half above did not: `["½x"]` is an attribute line to both
  // programs, so there IS a shared reading to preserve, and `[½x]` is
  // one to the oracle and a paragraph to the Ruby.
  test.each([
    ['["ünicode"]\npara\n', "[ünicode]\npara\n"],
    ['["日本"]\npara\n', "[日本]\npara\n"],
    ['["½x"]\npara\n', '["½x"]\npara\n'],
  ])("%j formats to %j", async (input, expected) => {
    await expectFormatted(input, expected);
  });
});
