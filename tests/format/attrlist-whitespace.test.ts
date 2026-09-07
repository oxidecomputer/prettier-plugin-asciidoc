/**
 * Issue #77: the attrlist field trims in src/parse/attrlist.ts used
 * JS `.trim()`, which strips a no-break space (U+00A0) and the rest
 * of Unicode's space separators. Ruby's `AttributeList` never does -
 * `skip_blank` runs `BlankRx`, which is `/[ \t]+/` (attribute_list.rb
 * :46), and the boundary that ends an unquoted value is `[ \t]*`
 * (`BoundaryRx[',']`, attribute_list.rb:30-34) - so a trailing NBSP
 * inside `[NOTE\u00A0]` is not blank to Ruby: the style is
 * "NOTE\u00A0", which is not the literal `NOTE` any `ADMONITION_STYLES`
 * membership test matches, and the oracle renders a plain paragraph.
 * Before the fix, `.trim()` stripped the NBSP, our formatter printed
 * the bracket line as `[NOTE]`, and THAT is what changed a paragraph
 * into an admonition on the round trip - the corruption is in what we
 * print, not in what we read.
 *
 * tests/parser/attrlist.test.ts pins the parser-level boundary
 * (attrlistFields/canonicalAttrlist/parseAttrlist, one row per side).
 * This file adds the two things a parser-level row cannot show: that
 * the printed document round-trips through the pinned oracle, and
 * that the fix reaches the SECOND place a trimmed style is read - not
 * just the printed bracket line (blocks.ts/printer.ts's
 * `canonicalAttrlist`), but the STYLE ITSELF, which several open
 * decisions branch on (`open-style.ts`'s `admonitionVariant`,
 * `paragraphFormVariant`, `verbatimStyledVariant`). A held style of
 * "source\u00A0" must NOT match `paragraphFormVariant`'s `source` key,
 * or a paragraph the oracle reflows like any other gets built as a
 * verbatim listing instead - a structural corruption, not just a
 * byte one, measured below.
 *
 * `[%hardbreaks]` is deliberately NOT exercised here across a
 * multi-line body, and the reason is a boundary rather than a gap.
 * The option IS read now - the whitespace record's hardbreaks row
 * binds every run of such a block to its source spelling
 * (src/whitespace-fact.ts), pinned in tests/format/hardbreaks.test.ts
 * - but what THIS issue is about is the trim a held style gets, and a
 * multi-line body here would pin the option's own behaviour under
 * this issue's name. attrlist.test.ts's `.role%hardbreaks\u00A0` rows
 * are the trim's coverage of the option's spelling; the one-line-body
 * row below stays inside this issue's boundary (attrlistFields' trim,
 * not paragraph reflow).
 */
import { describe, expect, test } from "vitest";
import {
  expectFormatted,
  expectStableRender,
  formatAdoc,
  renderedHtml,
} from "../helpers.js";

describe("[NOTE + NBSP] does not become an admonition (issue #77)", () => {
  test("a trailing NBSP survives and the block stays a plain paragraph", async () => {
    const input = "[NOTE\u00A0]\nSome text here.\n";
    const output = await formatAdoc(input);
    await expectFormatted(input, input);
    const html = await renderedHtml(output);
    expect(html).toContain('<div class="paragraph">');
    expect(html).not.toContain("admonitionblock");
  });

  // The ASCII-blank twins ARE the NOTE style: the blank is not part of
  // the interior to either authority, so the style line stands over a
  // paragraph and the whole thing is the `NOTE: ` label spelled the
  // long way. Red before `admonitionStyleLabel` (open-style.ts), where
  // the output was `[NOTE]` over the paragraph - and the canonical
  // interior it compares is what the last assertion here holds it to,
  // since a raw comparison answers no on pass one and yes on pass two.
  test.each([
    ["ASCII space", "[NOTE ]\nSome text here.\n"],
    ["ASCII tab", "[NOTE\t]\nSome text here.\n"],
  ])(
    "the other direction: a trailing %s is still blank and stays an admonition",
    async (_name, input) => {
      const output = await formatAdoc(input);
      expect(output).toBe("NOTE: Some text here.\n");
      expect(await renderedHtml(output)).toContain("admonitionblock");
      await expectStableRender(input);
    },
  );
});

describe("[#id + NBSP] keeps the no-break space as part of the id (issue #77)", () => {
  test("byte preserved, and the oracle's id attribute carries the NBSP", async () => {
    const input = "[#id\u00A0]\nSome text here.\n";
    const output = await formatAdoc(input);
    await expectFormatted(input, input);
    expect(await renderedHtml(output)).toContain('id="id\u00A0"');
  });

  // The ASCII-space twin trims to a bare id and then, unlike its
  // no-break sibling, spells that id as the anchor line: `[#id]` and
  // `[[id]]` name one structure and the printer writes one of them
  // (buildAttributeLine, src/parse/build/metadata.ts). Red before
  // that routing, where the output was `[#id]` with no blank below.
  // The trailing space is why `attrlistAnchorId` asks the CANONICAL
  // interior: over the author's bytes this line answers no on pass
  // one and yes on pass two, and the last assertion here is what
  // catches that.
  test("the other direction: an ASCII trailing space trims to a bare id", async () => {
    const input = "[#id ]\nSome text here.\n";
    const output = await formatAdoc(input);
    expect(output).toBe("[[id]]\n\nSome text here.\n");
    const html = await renderedHtml(output);
    expect(html).toContain('id="id"');
    expect(html).not.toContain('id="id\u00A0');
    await expectStableRender(input);
  });
});

describe("[source,ruby + NBSP] keeps the no-break space as part of the language (issue #77)", () => {
  test("byte preserved, and the oracle's data-lang carries the NBSP", async () => {
    const input = "[source,ruby\u00A0]\n----\nputs 1\n----\n";
    const output = await formatAdoc(input);
    await expectFormatted(input, input);
    expect(await renderedHtml(output)).toContain('data-lang="ruby\u00A0"');
  });

  test("the other direction: an ASCII trailing space trims to a bare language", async () => {
    const input = "[source,ruby ]\n----\nputs 1\n----\n";
    const output = await formatAdoc(input);
    expect(output).toBe("[source,ruby]\n----\nputs 1\n----\n");
    const html = await renderedHtml(output);
    expect(html).toContain('data-lang="ruby"');
    expect(html).not.toContain('data-lang="ruby\u00A0"');
    await expectStableRender(input);
  });
});

describe("[%hardbreaks + NBSP], a one-line body (issue #77's own boundary only)", () => {
  // One physical line of body text, deliberately: a two-line body
  // would fold through the unrelated reflow gap the file header
  // documents, which would obscure this boundary rather than test
  // it. With one line there is nothing for reflow to join, so the
  // only thing left for these two rows to measure is the attrlist
  // trim itself.
  test("byte preserved with a trailing NBSP", async () => {
    const input = "[%hardbreaks\u00A0]\nSome text here.\n";
    await expectFormatted(input, input);
  });

  test("the other direction: an ASCII trailing space trims away", async () => {
    const input = "[%hardbreaks ]\nSome text here.\n";
    await expectFormatted(input, "[%hardbreaks]\nSome text here.\n");
  });
});

describe("interior whitespace is content, not a trim boundary (issue #77)", () => {
  test("a no-break space inside a positional value survives, alongside the comma-adjacent blank Asciidoctor never keeps", async () => {
    const input = "[quote, Author\u00A0Name]\nSome quoted text.\n";
    const output = await formatAdoc(input);
    // The leading blank right after the comma is not data (Ruby's own
    // `skip_blank`, attribute_list.rb l.200-202) and prints trimmed
    // away exactly as an ASCII space there always has - unrelated to
    // this issue's fix, which touches only the trim boundary, not
    // the one-spacing-scheme canonicalization already covered by
    // tests/format/block-attributes.test.ts.
    expect(output).toBe("[quote,Author\u00A0Name]\nSome quoted text.\n");
    expect(await renderedHtml(output)).toContain("Author\u00A0Name");
    await expectStableRender(input);
  });
});

describe("a held style with a trailing NBSP is not a recognized paragraph-form style (issue #77)", () => {
  // The second place a trimmed style matters:
  // {@link paragraphFormVariant} reads the SAME style `parseAttrlist`
  // computes, and Ruby's oracle does not treat `[source\u00A0]` as
  // `[source]` above a paragraph - it stays an ordinary,
  // reflow-eligible paragraph (measured: `[source ]` and `[source\t]`,
  // where Ruby's blank IS ASCII, both convert to a listing block;
  // `[source\u00A0]` converts to a plain paragraph). A held style that
  // keeps its NBSP must leave the body reflow- eligible too, or the
  // corruption is structural (verbatim content that should have
  // wrapped at the print width) rather than a trimmed byte.
  test("the body stays an ordinary paragraph and reflows at the print width", async () => {
    const input =
      "[source\u00A0]\nword1 word2 word3 word4 word5 word6 word7 word8\n";
    await expectFormatted(
      input,
      "[source\u00A0]\nword1 word2 word3\nword4 word5 word6\nword7 word8\n",
      { printWidth: 20 },
    );
  });

  test.each([
    ["ASCII space", "[source ]\n"],
    ["ASCII tab", "[source\t]\n"],
  ])(
    "the other direction: a trailing %s still selects the verbatim listing style, unwrapped",
    async (_name, opener) => {
      const input = `${opener}word1 word2 word3 word4 word5 word6 word7 word8\n`;
      await expectFormatted(
        input,
        "[source]\nword1 word2 word3 word4 word5 word6 word7 word8\n",
        { printWidth: 20 },
      );
    },
  );
});
