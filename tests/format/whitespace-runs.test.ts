/**
 * Issue #32: a whitespace RUN the reader can see.
 *
 * Reflowing prose is what a formatter is for, and two spaces after a
 * full stop mean nothing. Inside a verbatim block, an inline
 * monospace span or a passthrough they are CONTENT, and collapsing
 * them is corruption - measured: `` `a  b` `` renders
 * `<code>a  b</code>`, both spaces kept, the same run Asciidoctor
 * keeps in a `<pre>` block. A BOLD, ITALIC or HIGHLIGHT span is not
 * held to that bar: those render `<strong>`/`<em>`/`<mark>`, plain
 * inline text with no preservation contract, so a run inside one
 * reflows the same as ordinary prose.
 *
 * Bytes rather than a render comparison for the inline-span and
 * passthrough groups, and that is the point of the file.
 * `tests/helpers.ts`'s `renderedHtml` folds whitespace runs outside
 * `<pre>` and `<code>`, so the shared comparison sees a monospace
 * span (it renders `<code>`) but CANNOT see a passthrough: a
 * passthrough renders as bare text with no wrapping element, so a
 * collapse there is invisible to every harness that compares
 * renderings. Each group below asserts which of the two it is, so
 * neither the formatter nor the normalizer can move without a row
 * failing.
 */
import { describe, expect, test } from "vitest";
import { formatAdoc, renderedHtml } from "../helpers.js";

/**
 * Byte-identical, render-equal, idempotent - the run survived.
 * @param input - the document
 */
async function expectByteFaithful(input: string): Promise<void> {
  const output = await formatAdoc(input);
  expect(output).toBe(input);
  expect(await renderedHtml(output)).toBe(await renderedHtml(input));
  expect(await formatAdoc(output)).toBe(output);
}

/**
 * Render-equal and idempotent, but not necessarily byte-identical -
 * for a row where a SEPARATE, deliberate normalization (the
 * unconstrained-to-constrained mark rewrite) changes the spelling
 * while the run inside it survives untouched.
 * @param input - the document
 * @param expected - the bytes the formatter produces, marks
 *   respelled, run intact
 */
async function expectRunFaithful(
  input: string,
  expected: string,
): Promise<void> {
  const output = await formatAdoc(input);
  expect(output).toBe(expected);
  expect(await renderedHtml(output)).toBe(await renderedHtml(input));
  expect(await formatAdoc(output)).toBe(output);
}

describe("a run inside a verbatim construct keeps its bytes", () => {
  test.each([
    ["a literal block", "....\na  b\n....\n"],
    ["a listing block", "----\na  b\n----\n"],
    ["a source block", "[source,ruby]\n----\na  b\n----\n"],
    ["an indented literal paragraph", " a  b\n"],
    ["a verse block", "[verse]\n____\na  b\n____\n"],
    // A table REPLAYS its cells' recorded bytes (issue #10), so a
    // literal cell's run survives as a side effect of that, not
    // because anything here reads cell styles.
    ["a literal table cell", "|===\nl|a  b\n|===\n"],
    ["the pass:[] macro", "Text pass:[a  b] more.\n"],
  ])("%s", async (_name, input) => {
    await expectByteFaithful(input);
  });
});

describe("a run inside a monospace span keeps its bytes", () => {
  test("constrained monospace", async () => {
    await expectByteFaithful("A sentence with `a  b` in it.\n");
  });

  test("unconstrained monospace, no edge padding", async () => {
    // The unconstrained-to-constrained rewrite is a separate,
    // deliberate normalization (flush edges make it legal); what #32
    // owns here is that the run inside it survives regardless.
    await expectRunFaithful(
      "A sentence with ``a  b`` in it.\n",
      "A sentence with `a  b` in it.\n",
    );
  });

  test("unconstrained monospace, edge padding", async () => {
    // Edge padding is content too - measured: `` ``  a  b  `` ``
    // renders `<code>  a  b  </code>`. Padding also refuses the
    // unconstrained-to-constrained shortening (constrained requires
    // flush edges), which this row pins as a side effect: the
    // spelling does NOT change, so byte-faithful holds here too.
    await expectByteFaithful("A sentence with ``  a  b  `` in it.\n");
  });

  test("monospace content that is only a line break", async () => {
    // The all-whitespace-content span (appendWhitespaceOnlySpan,
    // inline.ts) reached through literal territory: a text child whose
    // only bytes are a folded line break contributes no atom of its
    // own (splitPreservingSpaces returns nothing to keep), the same
    // shelter an all-whitespace node gets on the ordinary path - the
    // line break itself still folds to one space, same as everywhere
    // else, so the expected bytes are not the input's.
    //
    // The trailing byte matters: `` a ``\n``b `` (no space before `b`)
    // is refused constrained-respelling on its OWN, by the trailing
    // lookahead `(?!\w)` alone, regardless of spanIsFlush - a
    // constrained span may not be followed by a word character. That
    // masks whatever spanIsFlush answers, so it is not a witness for
    // the empty-content branch (`inner.length === 0`,
    // src/print/literal-span.ts). A SPACE before `b` removes that
    // separate refusal, so this row is what actually exercises the
    // branch.
    await expectRunFaithful("a ``\n`` b\n", "a `` `` b\n");
  });

  // The line-break-at-an-EDGE family:
  // splitPreservingSpaces cuts a line-break run away entirely, so the
  // edge atom's own bytes look flush even though appendLiteralText
  // still returns a "break" JOIN there - a line break itself still
  // folds to one space (the same fold every reflowed line break
  // gets), so these rows are NOT byte-identical to their input; what
  // spanIsFlush must not do is read the folded, flush-looking BYTE as
  // license to also shorten the span to constrained, which
  // Asciidoctor then refuses beside the leading/trailing space the
  // fold left behind and reads as literal text instead (measured
  // against the oracle below) - and left the leading-edge case
  // non-idempotent pre-fix (a second pass saw plain reflowable prose
  // where the first pass had destroyed the span).
  describe("a line break at a monospace edge does not fool the flush test", () => {
    test("leading edge", async () => {
      // Oracle: convert("a ``\nxy`` b") -> <p>a <code> xy</code> b</p>;
      // the pre-fix formatter shortened this to `` a ` xy` b ``, which
      // the oracle reads as literal text (the span destroyed).
      await expectRunFaithful("a ``\nxy`` b\n", "a `` xy`` b\n");
    });

    test("trailing edge", async () => {
      // Oracle: convert("a ``xy\n`` b") -> <p>a <code>xy </code> b</p>.
      await expectRunFaithful("a ``xy\n`` b\n", "a ``xy `` b\n");
    });

    test("both edges", async () => {
      // Oracle: convert("a ``\nx y\n`` b") -> <p>a <code> x y </code> b</p>.
      await expectRunFaithful("a ``\nx y\n`` b\n", "a `` x y `` b\n");
    });

    test("leading edge, with an interior run too", async () => {
      // Combines the edge fold with #32's own interior-run claim: the
      // line break at the edge folds to one
      // space, the `x  y` interior run survives untouched, and
      // idempotence is the load-bearing assertion here - pre-fix, a
      // SINGLE pass already destroyed the span (`` a ` x  y` b `` ,
      // literal text), so byte-fidelity against a fixed expectation
      // on that one pass alone could not have caught it; only a
      // SECOND pass showed the damage (the destroyed span's run then
      // folding like ordinary prose). expectRunFaithful's third
      // assertion (format(output) === output) is exactly that second
      // pass.
      await expectRunFaithful("a ``\nx  y`` b\n", "a `` x  y`` b\n");
    });
  });

  test("a nested span's own leading line break still routes through literal mode", async () => {
    // Witness for src/print/literal-span.ts's leadsWithLineBreak TRUE
    // arm: the text node whose OWN leading
    // whitespace holds the break is not the span's first child here -
    // a nested bold span is - so this exercises the fold from a
    // SECOND child's leading edge, not the span-level edge tests
    // above.
    await expectRunFaithful("a `*b*\nx  y` c\n", "a `*b* x  y` c\n");
  });

  test("a mark span nested inside monospace keeps its run too", async () => {
    // Measured: `` `a *x  y* b` `` renders `<code>a <strong>x  y</strong>
    // b</code>` - Asciidoctor keeps the nested strong's own run because
    // the whole thing is still inside <code>. literalInterior
    // (src/print/inline.ts) survives the recursion into the nested span.
    await expectByteFaithful("`a *x  y* b`\n");
  });

  test("monospace nested inside a mark span keeps its run", async () => {
    // The other nesting direction: the bold reflows normally, but its
    // monospace child still preserves its own interior run.
    await expectByteFaithful("*a `x  y` b*\n");
  });

  test("monospace around an inline literal keeps its run", async () => {
    // Fixed by issue #25: the `+a  b+` interior is a passthrough
    // atom replayed byte for byte, so the run inside it survives
    // regardless of the monospace span around it.
    await expectByteFaithful("A sentence with `+a  b+` in it.\n");
  });
});

describe("a run inside a mark span is reflow, not corruption", () => {
  // The control group: bold, italic and highlight render
  // <strong>/<em>/<mark>, plain inline text with no preservation
  // contract, so a run inside one folds exactly like ordinary prose
  // (measured: `<strong>a  b</strong>` in the oracle's own output -
  // the RAW html text keeps the run same as everything else does, so
  // it is `renderedHtml`'s run-fold shelter that makes reflowing here
  // safe, not the oracle refusing to keep it. The render-equality
  // assertion below is that claim made load-bearing, not just an
  // assertion about bytes). These rows pin that marks are NOT swept
  // into #32's fix.
  test.each([
    ["bold", "*a  b* here\n", "*a b* here\n"],
    ["italic", "_a  b_ here\n", "_a b_ here\n"],
    ["highlight", "#a  b# here\n", "#a b# here\n"],
  ])("%s", async (_name, input, expected) => {
    const output = await formatAdoc(input);
    expect(output).toBe(expected);
    expect(await renderedHtml(output)).toBe(await renderedHtml(input));
    expect(await formatAdoc(output)).toBe(output);
  });
});

describe("a run inside a passthrough survives, and only bytes can see it", () => {
  // The masked class. A passthrough renders as bare text inside the
  // paragraph that carries it, so `renderedHtml`'s run fold hides a
  // collapse there from the conformance properties, the
  // local-documents harness and every other render comparison. These
  // rows are the ONLY thing holding it.
  //
  // Issue #25 made passthroughs atomic byte-replayed nodes, so the
  // rows that used to pin the collapsed bytes (issue #32's masked
  // half) are byte-faithful guards now.
  test.each([
    ["a triple-plus passthrough", "Text +++a  b+++ more.\n"],
    ["a single-plus passthrough", "Text +a  b+ more.\n"],
  ])("%s", async (_name, input) => {
    await expectByteFaithful(input);
  });

  test("the shared render comparison cannot see this class", async () => {
    // Asserted against a HAND-collapsed variant rather than the
    // formatter's output: the two documents render differently in a
    // browser, and `renderedHtml`'s run fold cannot tell them apart.
    // That is why the rows above hold this class by bytes.
    const input = "Text +++a  b+++ more.\n";
    const collapsed = "Text +++a b+++ more.\n";
    expect(await renderedHtml(collapsed)).toBe(await renderedHtml(input));
  });
});

describe("a run in ordinary prose is reflow, not corruption", () => {
  test("it collapses, and that is the intended behavior", async () => {
    expect(await formatAdoc("a  b\n")).toBe("a b\n");
  });
});
