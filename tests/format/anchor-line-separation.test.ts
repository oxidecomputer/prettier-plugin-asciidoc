/**
 * The idempotence lemma for
 * {@link ParagraphNode.blankBelowAnchorLine}: the printer writes bytes
 * from which the reader re-derives the fact, so `read(print(A))`
 * agrees with `A` restricted to that field.
 *
 * The fact answers one question - did the author write a blank line
 * between a paragraph whose whole line is a `[[...]]` anchor and the
 * block under it - and the lemma is what makes the answer worth
 * recording: a fact the printer cannot write back is a fact consumed
 * and destroyed.
 *
 * Red before the field existed. The printer stacked such a paragraph
 * with the block below it the way it stacks real block metadata, so
 * every `blank` row here came out adjacent, the block below was
 * swallowed into the paragraph the next read starts on that text line,
 * and the re-read paragraph recorded `false` where the input recorded
 * `true`. Those documents are the 70 rows the reparse ledger carried
 * under `blank-dropped` (#73), which is empty now.
 *
 * DOMAIN, stated: a paragraph printing a lone `[[...]]` line, and the
 * separation between it and its next SIBLING block. The rows below
 * walk the two rejected-id spellings the block-anchor grammar refuses
 * (a leading digit, an illegal character) across the following
 * constructs whose first line reads differently once it is inside a
 * paragraph, in both separations. The perturbation rows go outside
 * that domain deliberately: a VALID anchor line, an ordinary
 * paragraph, and a run of blanks.
 */
import { describe, expect, test } from "vitest";
import { parse } from "../../src/parser.js";
import { DELIMITER_KINDS } from "../../src/parse/line-shapes.js";
import {
  asParagraph,
  expectFormatted,
  formatAdoc,
  renderedHtml,
} from "../helpers.js";

/**
 * The fact as the reader records it for a document's FIRST block.
 * @param document - the document to read
 * @returns `ParagraphNode.blankBelowAnchorLine` of its first block
 */
function factOf(document: string): boolean {
  const [block] = parse(document).children;
  return asParagraph(block).blankBelowAnchorLine;
}

/**
 * The same, for the rows whose first block need not be a paragraph at
 * all: only a paragraph carries the fact, so a `blockAnchor` first
 * block is a legitimate answer of "no fact here" rather than a setup
 * error.
 * @param document - the document to read
 * @returns the recorded fact, or undefined when the first block is
 *   not a paragraph
 */
function factOrNone(document: string): boolean | undefined {
  const [block] = parse(document).children;
  return block.type === "paragraph" ? block.blankBelowAnchorLine : undefined;
}

// The two `[[...]]` spellings BlockAnchorRx (rx.rb:164) refuses - an id
// opening on a digit, and an id carrying a character the grammar has
// no room for - which is what makes each a PARAGRAPH whose printed
// line is nonetheless an anchor line.
const REJECTED = ["[[3-blind-mice]]", "[[illegal$id]]"];

// What can stand under such a line as a block of its own. Each first
// line either opens a block (a delimiter, a marker, a macro) or is
// metadata, so the pair is two blocks with the blank and one
// paragraph without it - which is why the adjacent spelling of the
// same pair is a DIFFERENT document, not the same one reformatted.
const BELOW = [
  [".T", "a block title"],
  [":a: v", "an attribute entry"],
  ["image::a.png[]", "a block macro"],
  ["* a", "a list marker"],
  ["term:: def", "a description term"],
  ["<<<", "a page break"],
  ["'''", "a thematic break"],
  ["// c", "a line comment"],
  ["ifdef::x[]", "a preprocessor directive"],
  ["----\nx\n----", "a listing block"],
] as const;

describe("the fact survives its own printing", () => {
  const rows = REJECTED.flatMap((anchor) =>
    BELOW.map(
      ([below, what]) => [`${what} under ${anchor}`, anchor, below] as const,
    ),
  );

  test.each(rows)(
    "%s: the blank the author wrote comes back",
    async (_name, anchor, below) => {
      const input = `${anchor}\n\n${below}\n`;
      // Not vacuous: the input really is in the fact's domain, and the
      // fact really is true there.
      expect(factOf(input)).toBe(true);
      const output = await formatAdoc(input);
      expect(factOf(output)).toBe(true);
      expect(await formatAdoc(output)).toBe(output);
      expect(await renderedHtml(output)).toBe(await renderedHtml(input));
    },
  );

  // The ADJACENT half of the lemma needs a second block, and most of
  // the constructs above do not give one: a title, a marker, a macro
  // and their kin do not interrupt a paragraph, so written directly
  // under the anchor line they are that paragraph's own second line
  // and there is no separation to record. These three do interrupt,
  // and each is a shape that had NO recorded separation before the
  // field: a delimiter, a valid anchor line (which the two-anchor
  // exception used to force apart) and a lone `+` (which the
  // would-merge exception used to force apart). Both of the last two
  // gained a blank line the author never wrote.
  test.each(
    REJECTED.flatMap((anchor) =>
      (
        [
          ["a listing block", "----\nx\n----"],
          ["a valid anchor line", "[[id]]"],
          ["a lone continuation", "+"],
        ] as const
      ).map(
        ([what, below]) => [`${what} under ${anchor}`, anchor, below] as const,
      ),
    ),
  )(
    "%s: the adjacency the author wrote comes back",
    async (_name, anchor, below) => {
      const input = `${anchor}\n${below}\n`;
      // Not vacuous: the pair really is two blocks, so a separation
      // exists to be recorded and replayed.
      expect(parse(input).children.length).toBeGreaterThan(1);
      expect(factOf(input)).toBe(false);
      const output = await formatAdoc(input);
      expect(output).toBe(input);
      expect(factOf(output)).toBe(false);
      expect(await renderedHtml(output)).toBe(await renderedHtml(input));
    },
  );
});

describe("outside the domain the fact is false, and stays false", () => {
  // The perturbation half. Each row differs from a row above in
  // exactly one way that takes it out of the fact's domain, and the
  // recorded answer must be `false` on BOTH sides of the print - a
  // `true` here would be a fact the printer's own normalization
  // contradicts.
  test.each([
    [
      "a VALID anchor line is a blockAnchor node, not a paragraph",
      "[[id]]",
      undefined,
    ],
    ["ordinary prose is not an anchor line", "para", false],
    ["a bibliography anchor prints three brackets", "[[[bib]]]", false],
    [
      "an anchor with text beside it is not a lone anchor line",
      "[[3-bad]] x",
      false,
    ],
  ])("%s", async (_name, first, expected) => {
    const input = `${first}\n\n.T\n`;
    expect(factOrNone(input)).toBe(expected);
    expect(factOrNone(await formatAdoc(input))).toBe(expected);
  });

  test("a run of blank lines records the same fact one blank does", async () => {
    const many = "[[3-blind-mice]]\n\n\n\n.T\n";
    expect(factOf(many)).toBe(true);
    const output = await formatAdoc(many);
    expect(output).toBe("[[3-blind-mice]]\n\n.T\n");
    expect(factOf(output)).toBe(true);
  });

  test("a trailing blank run with no block under it records false", async () => {
    // The printer drops a document's trailing blanks, so a `true`
    // here would be a fact its own output could not carry.
    const trailing = "[[3-blind-mice]]\n\n";
    expect(factOf(trailing)).toBe(false);
    expect(factOf(await formatAdoc(trailing))).toBe(false);
  });
});

/**
 * One delimited opener, and the block the printer writes when that
 * opener stands under a rejected anchor line with nothing to close
 * it.
 *
 * Checked in as data rather than derived, because what the printer
 * does with an unterminated opener is not one rule: ten kinds gain a
 * closing delimiter, the Markdown fence is respelled as a source
 * listing, and the four table openers are left exactly as the author
 * wrote them. A derivation would have to restate the printer to say
 * which is which.
 */
const OPENERS = [
  ["commentBlock", "////", "////\n////"],
  ["example", "====", "====\n===="],
  ["fencedCode", "```", "[source]\n----\n----"],
  ["listing", "----", "----\n----"],
  ["literal", "....", "....\n...."],
  ["openBlock", "--", "--\n--"],
  // `~~~~` opens a block to @asciidoctor/core
  // (`DELIMITED_BLOCKS['~~~~']`) and to nothing in Ruby 2.0.26, which
  // reads the line as ordinary paragraph text. The two programs
  // disagree about the INPUT here, not about what this row does with
  // it: the closing delimiter keeps the render under the oracle and
  // moves it under the Ruby, which reads two text lines where it read
  // one. The oracle wins, as it does at the registry row that carries
  // the same divergence ({@link DELIMITER_KINDS}, issue #64), and the
  // render comparison below is the oracle's.
  ["openBlockTilde", "~~~~", "~~~~\n~~~~"],
  ["pass", "++++", "++++\n++++"],
  ["quote", "____", "____\n____"],
  ["sidebar", "****", "****\n****"],
  ["tableBang", "!===", "!==="],
  ["tableColon", ":===", ":==="],
  ["tableComma", ",===", ",==="],
  ["tablePipe", "|===", "|==="],
] as const;

describe("the blank above a delimited opener survives (#206)", () => {
  // #206 measured the whole grid failing: the first pass dropped the
  // blank, stacking the rejected anchor onto the opener as if it were
  // metadata, and the second pass joined the two lines
  // (`[[3-blind-mice]]\n\n ====\n` printed `[[3-blind-mice]] ====\n`
  // on the second pass, and the block was gone from the render). The
  // recorded separation `ParagraphNode.blankBelowAnchorLine` is what
  // keeps the blank now; these rows are the grid the issue named, one
  // per `DELIMITER_KINDS` member, in both of the separations that
  // reach it.

  test("the grid names every delimited kind", () => {
    // A delimited block added to the registry cannot arrive here
    // unpinned: the whole point of the issue's grid is that the
    // mechanism did not care which opener stood under the anchor.
    expect(new Set(OPENERS.map(([kind]) => kind))).toEqual(
      new Set(DELIMITER_KINDS),
    );
  });

  test.each(OPENERS)(
    "%s: an opener at column 0 keeps the blank above it",
    async (_kind, opener, printed) => {
      // The opener really does open a block, so the anchor line and
      // the block are two constructs the blank must keep apart.
      await expectFormatted(
        `[[3-blind-mice]]\n\n${opener}\n`,
        `[[3-blind-mice]]\n\n${printed}\n`,
      );
    },
  );

  test.each(OPENERS)(
    "%s: an indented opener keeps the blank above it",
    async (_kind, opener) => {
      // The issue's own spelling. An indented opener is not a
      // delimiter at all - it is a literal block - which is what made
      // this half of the grid a fidelity failure as well as an
      // idempotence one: the joined line rendered as prose.
      const input = `[[3-blind-mice]]\n\n ${opener}\n`;
      await expectFormatted(input, input);
    },
  );

  // The second rejected spelling the issue names, on the opener it
  // names it with. The grid above walks the digit-leading id; this
  // pins that an id the grammar refuses for its CHARACTERS reaches
  // the same recorded separation.
  test.each([
    ["at column 0", "----\n", "----\n----\n"],
    ["indented", " ----\n", " ----\n"],
  ])("an illegal id above a listing opener %s", async (_where, tail, out) => {
    await expectFormatted(
      `[[illegal$id]]\n\n${tail}`,
      `[[illegal$id]]\n\n${out}`,
    );
  });
});
