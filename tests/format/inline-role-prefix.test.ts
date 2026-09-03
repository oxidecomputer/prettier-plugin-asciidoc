/**
 * A role prefix belongs to the SPAN it names, whatever mark spells
 * that span (issue #108).
 *
 * Ruby's attrlist group `(?:\[([^\]]+)\])?` sits inside every
 * `QUOTE_SUBS` row (asciidoctor.rb l.445-467), so `[a]**c**` renders
 * `<strong class="a">c</strong>` exactly as `[a]##c##` renders
 * `<span class="a">c</span>`. This parser used to read the group for
 * the HIGHLIGHT row alone; in front of the other three marks the
 * brackets were plain text, which put them in a node of their OWN.
 *
 * That placement is what corrupted documents. The block-start hazard
 * net (src/print/block-start-hazard.ts) trades a join for the author's
 * line break when the packed line re-reads as block syntax, and it can
 * only see the hazard when the span's opening atom carries the run's
 * `[` at its head. With the brackets in a sibling text node the mark
 * atom was glued to that sibling, the net's guard on a glued successor
 * bailed, and `"[.role]__\nb__ c]\n"` packed to `[.role]__ b__ c]` - a
 * BLOCK ATTRIBUTE LINE, whose paragraph renders EMPTY.
 *
 * These rows are the one-per-mark record that the modeling fix closed
 * that, and the mid-line counterparts that hold it to firing only
 * where the hazard is real. The highlight rows for the same shape live
 * in tests/format/inline-span-break.test.ts, where the net itself is
 * pinned.
 */
import { describe, expect, test } from "vitest";
import { formatAdoc, renderedHtml, asParagraph } from "../helpers.js";
import { parse } from "../../src/parser.js";
import { narrow } from "../../src/narrow.js";

/**
 * Format once, pin the bytes, and prove render equality and
 * idempotence.
 * @param input - the row's document
 * @param expected - the exact formatted bytes
 */
async function expectRow(input: string, expected: string): Promise<void> {
  const out = await formatAdoc(input);
  expect(out).toBe(expected);
  expect(await renderedHtml(out)).toBe(await renderedHtml(input));
  expect(await formatAdoc(out)).toBe(out);
}

describe("the role rides on the span, one row per mark", () => {
  // One document per mark kind, each asserting the node type AND the
  // role it carries: the type is what says which row resolved the
  // span, the role is the group that row took.
  const KINDS = [
    { mark: "bold", source: "[a]**c**\n" },
    { mark: "italic", source: "[a]__c__\n" },
    { mark: "monospace", source: "[a]``c``\n" },
    { mark: "highlight", source: "[a]##c##\n" },
  ] as const;

  test.each(KINDS)(
    "$source builds a $mark carrying the role",
    ({ mark, source }) => {
      const [node] = asParagraph(parse(source).children[0]).children;
      narrow(node, mark);
      expect(node.role).toBe("a");
    },
  );

  // The control: the same four marks with no bracket in front carry no
  // role at all, so the field is a fact about the source and not a
  // default the builder always fills in.
  test.each(KINDS)(
    "$mark with no bracket carries no role",
    ({ mark, source }) => {
      const [node] = asParagraph(
        parse(source.slice("[a]".length)).children[0],
      ).children;
      narrow(node, mark);
      expect(node.role).toBeUndefined();
    },
  );
});

describe("a role-prefixed span at a block start keeps the author's line", () => {
  // THE TIER-1 ROWS. Each one is a paragraph whose first source line
  // is the role plus the opening mark, whose content opens with the
  // break, and whose later `]` makes the packed join a block attribute
  // line. Packed, the render is the empty document; kept broken, it is
  // the author's own paragraph, which `renderedHtml` here asserts
  // rather than assumes.
  test.each([
    "[.a.b]**\nb** c]\n",
    "[.role]__\nb__ c]\n",
    "[.a]``\nb`` c]\n",
    "[.role]##\nb## c]\n",
  ])("%j is its own fixed point", async (input) => {
    await expectRow(input, input);
  });

  // The `]` glued to the closing mark instead of standing a word
  // further along: the packed line is a block attribute list either
  // way, and the last atom fuses rather than joining over a space.
  test.each(["[.a.b]**\nb**]\n", "[.role]__\nb__]\n", "[.a]``\nb``]\n"])(
    "%j is its own fixed point with the bracket glued",
    async (input) => {
      await expectRow(input, input);
    },
  );
});

describe("a role's own bytes count on the line", () => {
  // The role is written onto the line VERBATIM, so a role holding the
  // mark character is a mark standing where a later `QUOTE_SUBS` row
  // can read it. The unconstrained row that resolves the span writes
  // the run into an HTML attribute rather than consuming it as
  // delimiters, and the constrained row then matches the marks left
  // in there - so shortening ANOTHER span of the same kind on that
  // line pairs its single marks with the role's. Unshortened, the
  // oracle reads `<strong class="b**c">d</strong> <strong>a</strong>`;
  // shortened, `<strong class="b*<strong>c">d</strong> *a</strong>`,
  // the second span destroyed and the first one's class rewritten -
  // and that corruption is a FIXED POINT, so nothing walks it back.
  //
  // The refusal is the block-wide scan's (`carriesMark`,
  // src/print/inline.ts), which reads every OTHER node on the line;
  // the role-carrying span's own run is a different question, asked
  // by `attrlistAllowsIt` (src/print/span-edges.ts).
  test.each([
    "[b**c]**d** **a**\n",
    "x [b**c]**d** **a**\n",
    "**a** [b**c]**d**\n",
    "[b__c]__d__ __a__\n",
    "[b`c]``d`` ``a``\n",
    "[b##c]##d## ##a##\n",
  ])("%j keeps both doubled spellings", async (input) => {
    await expectRow(input, input);
  });

  // The same shape written across a source line break: the reflow
  // joins the two lines and the refusal is the same one.
  test("the pair written on two lines joins without shortening", async () => {
    await expectRow("[b**c]**d**\n**a**\n", "[b**c]**d** **a**\n");
  });

  // THE DISCRIMINATOR. A role holding no mark character refuses
  // nothing: both spans take the constrained spelling, and the render
  // is the same document. Without this row the rule above would read
  // as "a role refuses", which is not what the oracle does.
  test("a role holding no mark leaves both shortenings legal", async () => {
    await expectRow("[bc]**d** **a**\n", "[bc]*d* *a*\n");
  });

  // The other discriminator: a role holding a mark of a DIFFERENT
  // kind. Ruby's rows are one gsub each, so a `**` in the run is
  // nothing to the emphasis row, and the emphasis still shortens.
  test("a role holding another kind's mark refuses nothing", async () => {
    await expectRow("[b**c]**d** __a__\n", "[b**c]**d** _a_\n");
  });
});

describe("the counterparts where the net stays out", () => {
  // MID-LINE. A word in front of the span means the block's first atom
  // is that word, so the span can never reach column 0 however the
  // packer arranges it and the recorded first-line fact is false. The
  // break inside the span replays as the ordinary space.
  test.each([
    ["x [.a.b]**\nb** c]\n", "x [.a.b]** b** c]\n"],
    ["x [.role]__\nb__ c]\n", "x [.role]__ b__ c]\n"],
    ["x [.a]``\nb`` c]\n", "x [.a]`` b`` c]\n"],
  ])("%j packs mid-paragraph", async (input, expected) => {
    await expectRow(input, expected);
  });

  // THE DISCRIMINATOR. The same span at a block start with a word past
  // the `]`: the packed line `[.role]__ b__ c] d` has bytes after the
  // bracket, so it is no block attribute line and the paragraph stays
  // a paragraph. The net reads the whole line, not the `[` at its
  // head.
  test("a word past the ] lets the line pack", async () => {
    await expectRow("[.role]__\nb__ c] d\n", "[.role]__ b__ c] d\n");
  });

  // The already-packed spellings are fixed points: there is no break
  // to keep and the net invents none.
  test.each([
    "x [.a.b]** b** c]\n",
    "x [.role]__ b__ c]\n",
    "x [.a]`` b`` c]\n",
  ])("%j is a fixed point", async (input) => {
    await expectRow(input, input);
  });

  // The CONSTRAINED twin, which is no span at all: a constrained mark
  // may not open with whitespace behind it
  // (`canOpenAt`, src/parse/inline/quote-boundaries.ts), so the marks
  // stay literal text and no role token claims them either. The line
  // is still kept, by the plain-text half of the same net.
  test("the constrained spelling opens no span and is still kept", async () => {
    await expectRow("[.role]_\nb_ c]\n", "[.role]_\nb_ c]\n");
  });

  // The idiom the golden token file is full of: a role-prefixed
  // italic mid-sentence, which has no hazard anywhere near it and must
  // come back byte for byte.
  test("a role-prefixed path in running text is untouched", async () => {
    await expectRow("x [.path]_file_ y\n", "x [.path]_file_ y\n");
  });
});
