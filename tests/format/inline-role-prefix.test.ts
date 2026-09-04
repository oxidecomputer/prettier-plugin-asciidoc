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

describe("the role is the oracle's own group, not the widest run (issue #114)", () => {
  // The group in front of a quoted span is `QuoteAttributeListRxt`,
  // `\[([^\[\]]+)\]`
  // (`node_modules/@asciidoctor/core/build/node/index.cjs` l.59), whose
  // interior crosses NEITHER bracket. So the `[` that opens it is the
  // LAST one standing in front of its `]`, and an earlier `[` opens
  // nothing at all: `[a[b]**c**` renders
  // `[a<strong class="b">c</strong>`, class `b`, with `[a` in front of
  // the group as ordinary text.
  //
  // The Ruby this repo vendors spells the same group inline as
  // `\[([^\]]+)\]` in each row (`QUOTE_SUBS`,
  // asciidoctor.rb l.445-467), an interior that DOES cross an open
  // bracket, and reading it that way recorded a role of `a[b` - a run
  // no row ever takes. Nothing rendered wrong for it: the printer
  // replays a role verbatim and the print-time scan re-reads the narrow
  // group either way, so the divergence lived in the tree alone, where
  // anything that starts consuming the field would have inherited it.
  const NARROW = [
    { mark: "bold", source: "[a[b]**c**\n", head: "[a", role: "b" },
    { mark: "italic", source: "[a[b]__c__\n", head: "[a", role: "b" },
    { mark: "monospace", source: "[a[b]``c``\n", head: "[a", role: "b" },
    { mark: "highlight", source: "[a[b]##c##\n", head: "[a", role: "b" },
    // The constrained spelling and the shorthand role syntax read the
    // same group. The byte in front of it is a hyphen and not a
    // letter on purpose: the constrained row's own left clause
    // CONSUMES the character in front of the `[`, so a word character
    // there leaves the oracle taking no group at all (`[a[.r]#c#`
    // renders `[a[.r]<mark>c</mark>`, group and all as literal text)
    // and the row would pin a role against a render that has none.
    { mark: "highlight", source: "[-[.r]#c#\n", head: "[-", role: ".r" },
    // The escaped form: the backslash stands in front of the group
    // rather than inside a wider interior, which is what makes it an
    // escape at all (the print-time twin is in
    // tests/format/inline-boundary.test.ts, issue #110).
    { mark: "bold", source: "[\\[a]**c**\n", head: "[\\", role: "a" },
    // The earlier bracket need not be at the head of the line.
    { mark: "bold", source: "a[b[c]**d**\n", head: "a[b", role: "c" },
  ] as const;

  test.each(NARROW)(
    "$source records the role $role behind the text $head",
    ({ mark, source, head, role }) => {
      const [text, span] = asParagraph(parse(source).children[0]).children;
      narrow(text, "text");
      expect(text.value).toBe(head);
      narrow(span, mark);
      expect(span.role).toBe(role);
    },
  );

  // The bytes do not move for any of them: a role prints inside its
  // own brackets and the text in front prints itself, so the line
  // comes back exactly as written and renders what it rendered.
  test.each(NARROW)("$source is its own fixed point", async ({ source }) => {
    await expectRow(source, source);
  });
});

describe("shortening may not open an attributes group the source has not", () => {
  // The group in front of a span is read from the text as the ROW
  // that resolves it sees it, and the rows in front have rewritten
  // that text. A span they resolved is an element by then: its own
  // delimiters are gone and its role has become an attribute's value,
  // so the `[` and `]` it was written with are gone with them. A `[`
  // standing further back, which opened nothing while those brackets
  // were in the way, then reaches the `]` flush against the next
  // span's delimiter.
  //
  // The UNCONSTRAINED row runs before that rewrite and sees the
  // author's own brackets, so a doubled span carries no such group.
  // Shortening moves the span one row later, where the group is
  // waiting: `[a[b]**c**]**f**` renders
  // `[a<strong class="b">c</strong>]<strong>f</strong>` and
  // `[a[b]**c**]*f*` renders
  // `<strong class="a<strong class="b">c</strong>">f</strong>`, the
  // bracketed text swallowed into a class and `[a` and `]` gone from
  // the document.
  test.each<[string, string]>([
    ["[a[b]**c**]**f**\n", "[a[b]**c**]*f*\n"],
    ["[[a]**c**]**f**\n", "[[a]**c**]*f*\n"],
    ["[[.r]**c**]**f**\n", "[[.r]**c**]*f*\n"],
    ["[[ ]**c**]**f**\n", "[[ ]**c**]*f*\n"],
    // One row per mark: the group sits inside every `QUOTE_SUBS` row,
    // so the hazard is the same for all four.
    ["[a[b]__c__]__f__\n", "[a[b]__c__]_f_\n"],
    ["[a[b]``c``]``f``\n", "[a[b]``c``]`f`\n"],
    ["[a[b]##c##]##f##\n", "[a[b]##c##]#f#\n"],
  ])(
    "%j keeps its doubled spelling, because %j reads differently",
    async (input, shorter) => {
      await expectRow(input, input);
      expect(await renderedHtml(shorter)).not.toBe(await renderedHtml(input));
    },
  );

  // The other side. A run that opens no group after the rewrite -
  // because no `[` survives it, or because the `]` is not flush
  // against the delimiter - refuses nothing.
  test.each<[string, string]>([
    ["[a]**c**]**f**\n", "[a]*c*]*f*\n"],
    ["[a[b]**c**] **f**\n", "[a[b]**c**] *f*\n"],
  ])("%j still shortens to %j", async (input, expected) => {
    await expectRow(input, expected);
  });

  // The conservative edge: the refusal asks whether a group OPENS,
  // not whether the row would go on to take it. Here the row's own
  // left clause reads a word character in front of the `[` and would
  // not, so the shorter spelling would have survived - a refusal
  // costs bytes and no meaning.
  test.each<[string, string]>([
    ["x[a[b]**c**]**f**\n", "x[a[b]**c**]*f*\n"],
    ["[\\[a]**c**]**f**\n", "[\\[a]**c**]*f*\n"],
  ])(
    "%j is refused conservatively, and %j would have survived",
    async (input, shorter) => {
      await expectRow(input, input);
      expect(await renderedHtml(shorter)).toBe(await renderedHtml(input));
    },
  );
});

describe("a group may open at a bracket outside the enclosing span", () => {
  // A row is a regex over the whole LINE and reads straight through an
  // enclosing span's boundary: by the time a later row runs, the
  // enclosing span's own delimiters are gone from the text and a `[`
  // written in front of it stands as near to a nested span as any of
  // that span's own siblings. What a nested span can see, though, ends
  // at that boundary - its siblings, and the enclosing span's edge -
  // so the bracket that opens the group is invisible to it.
  //
  // Both refusals that read the bytes in front were therefore blind
  // one nesting level up. Measured before this: `[a[b]**__a__]__c__
  // z**` formatted to `[a[b]**_a_]_c_ z**`, whose class holds the
  // author's `_a_` where the input's holds an emphasis element - and
  // shortening either inner span alone is enough to change it.
  //
  // The answer is conservative: standing inside a span, a `]` with no
  // `[` of its own in front of it is treated as closing a group, and a
  // front with no `]` in it is treated as standing inside one. Both
  // only refuse, and the rows below the fixed ones record what that
  // costs.
  test.each<[string, string]>([
    ["[a[b]**__a__]__c__ z**\n", "[a[b]**_a_]_c_ z**\n"],
    ["[a[b]**__a__]__c__ z**\n", "[a[b]**__a__]_c_ z**\n"],
    ["[a**__a__]__c__ z**\n", "[a**_a_]_c_ z**\n"],
    ["[a[b]``__a__]__c__ z``\n", "[a[b]``_a_]_c_ z``\n"],
    ["[a[b]**``a``]``c`` z**\n", "[a[b]**`a`]`c` z**\n"],
  ])(
    "%j keeps its doubled spelling, because %j reads differently",
    async (input, shorter) => {
      await expectRow(input, input);
      expect(await renderedHtml(shorter)).not.toBe(await renderedHtml(input));
    },
  );

  // What the conservatism costs. No `[` stands in front of the
  // enclosing span in either row, so no group can open and the shorter
  // spelling renders the same - but the bytes that would say so are
  // outside what a nested span reads, and a refusal costs bytes and no
  // meaning.
  test.each<[string, string]>([
    ["*__a__]__c__ z*\n", "*_a_]_c_ z*\n"],
    ["x**__a__]__c__ z**\n", "x**_a_]_c_ z**\n"],
  ])(
    "%j is refused conservatively, and %j would have survived",
    async (input, shorter) => {
      await expectRow(input, input);
      expect(await renderedHtml(shorter)).toBe(await renderedHtml(input));
    },
  );
});
