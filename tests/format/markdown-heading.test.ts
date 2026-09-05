/**
 * Markdown-marker section titles, end to end (issue #63).
 *
 * `ExtAtxSectionTitleRx` takes `#` beside `=` at the same levels, so
 * the two spellings are one construct and the printer writes every
 * level as a run of `=`. What the normalization is worth is the
 * CLOSED form and the joins: `## S ##` reprinted with its closing run
 * would be a different heading, and `## S` next to prose used to be
 * reflow-joined into it.
 */
import { describe, expect, test } from "vitest";
import { expectFormatted, formatAdoc, renderedHtml } from "../helpers.js";

describe("a markdown-marker title normalizes to the = spelling", () => {
  test.each([
    ["# Doc", "= Doc"],
    ["## Section", "== Section"],
    ["###### Deepest", "====== Deepest"],
  ])("%j prints as %j", async (input, expected) => {
    await expectFormatted(
      `para\n\n${input}\n\nbody\n`,
      `para\n\n${expected}\n\nbody\n`,
    );
  });

  // The closing run is not part of the title, so it does not come
  // back. Both spellings of the input render the same heading.
  test.each([
    ["a markdown closing run", "## S ##\n\nb\n", "== S\n\nb\n"],
    ["an asciidoc closing run", "== S ==\n\nb\n", "== S\n\nb\n"],
    ["a document title's closing run", "# Doc #\n\nb\n", "= Doc\n\nb\n"],
  ])("%s is dropped", async (_name, input, expected) => {
    await expectFormatted(input, expected);
  });

  // A closing run that does not repeat the opening one is title text,
  // so it stays.
  test("a mismatched closing run stays in the title", async () => {
    await expectFormatted("== S ===\n\nb\n", "== S ===\n\nb\n");
  });

  // The join the gap cost: a heading and the prose under it were one
  // paragraph, so the heading swallowed the body.
  test("prose under a markdown heading keeps its own block", async () => {
    await expectFormatted("## Section One\nbody\n", "== Section One\n\nbody\n");
  });

  // A markdown document title carries its author line, as the `=`
  // spelling does.
  test("a markdown document title keeps its author line", async () => {
    await expectFormatted(
      "# Doc\nAuthor Name\n\nbody\n",
      "= Doc\nAuthor Name\n\nbody\n",
    );
  });
});

describe("what the markdown marker refuses", () => {
  // Seven markers are past the group's five-repeat tail, no gap is no
  // title, and the two marker classes do not mix.
  test.each([
    ["seven markers", "####### Seven\n\nb\n"],
    ["no gap", "#Nope\n\nb\n"],
    ["mixed markers", "=# Mixed\n\nb\n"],
  ])("%s is not a heading", async (_name, input) => {
    const out = await formatAdoc(input);
    expect(out.startsWith("=")).toBe(input.startsWith("="));
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});
