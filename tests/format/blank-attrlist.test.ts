/**
 * An attrlist that names NO attribute, and what it costs the span in
 * front of it (issue #118).
 *
 * `convertQuotedText` turns a `mark` into an `unquoted` the moment any
 * attrlist stands in front of it
 * (`node_modules/@asciidoctor/core/build/node/index.cjs` l.20922-20950),
 * and an `unquoted` naming neither an id nor a role converts to its own
 * text and nothing more. So the highlight mark alone has a spelling
 * that renders no element at all: `##c##` is `<mark>c</mark>`,
 * `[a]##c##` is `<span class="a">c</span>`, and `[ ]##c##` is a bare
 * `c`.
 *
 * These rows are the format-level record of what that costs a
 * highlight span standing in FRONT of one, and of where it costs
 * nothing. They read as a section of the constrained-mark boundary
 * set in tests/format/inline-boundary.test.ts and are here instead
 * because that file has no room for them: it stands at its 450-line
 * `max-lines` ceiling.
 */
import { describe, expect, test } from "vitest";
import { formatAdoc, renderedHtml } from "../helpers.js";

describe("a blank attrlist behind bares the span behind (issue #118)", () => {
  // An attrlist naming NO attribute is not a role, and on a highlight
  // it is not even an element: `convertQuotedText` turns a `mark` into
  // an `unquoted` the moment any attrlist stands in front of it, and
  // an `unquoted` naming neither an id nor a role converts to its own
  // text and nothing more. So `[ ]##c##` renders a bare `c` where
  // `[a]##c##` renders `<span class="a">c</span>`.
  //
  // That is a hazard for the span in FRONT, and only for a highlight
  // one. Shortening moves a span onto its constrained row, and the row
  // that runs directly in front of that one is the same mark's
  // unconstrained row - so this neighbour has already become its bare
  // text where the constrained clause looks behind the closing mark,
  // and the clause reads a word character instead of an element's `<`.
  // `##a##[ ]##c##` renders `<mark>a</mark>c`; the shortened
  // `#a#[ ]##c##` renders `#a#c`, the first span destroyed - which is
  // what these rows formatted to before the refusal existed.
  test.each<[string, string]>([
    ["##a##[ ]##c##", "#a#[ ]##c##"],
    // The first positional attribute is the only one read, so a run
    // whose first field is blank names nothing however much follows.
    ["##a##[,]##c##", "#a#[,]##c##"],
    ["##a##[ ,a]##c##", "#a#[ ,a]##c##"],
    // The shorthand role syntax with no role in it: the dots separate
    // roles and become spaces, and what is left is trimmed away.
    ["##a##[.]##c##", "#a#[.]##c##"],
    ["##a##[..]##c##", "#a#[..]##c##"],
    ["##a##[...]##c##", "#a#[...]##c##"],
    ["##a##[ . ]##c##", "#a#[ . ]##c##"],
  ])(
    "%s keeps its bytes, because %s reads differently",
    async (source, shorter) => {
      const input = `${source}\n`;
      const out = await formatAdoc(input);
      expect(out).toBe(input);
      expect(await formatAdoc(out)).toBe(out);
      expect(await renderedHtml(out)).toBe(await renderedHtml(input));
      expect(await renderedHtml(`${shorter}\n`)).not.toBe(
        await renderedHtml(input),
      );
    },
  );

  // The other side, so this is no blanket refusal of an attrlist
  // behind. A run that DOES name a role leaves an element there, whose
  // `<` no boundary class excludes; a neighbour on another mark's row
  // is an element by then too; a neighbour that is not the immediate
  // sibling is not what the clause reads at all; and the bared text
  // itself is only a hazard when it OPENS with a word character.
  test.each<[string, string]>([
    ["##a##[a]##c##", "#a#[a]##c##"],
    ["##a##[a,b]##c##", "#a#[a,b]##c##"],
    ["##a##[x.y]##c##", "#a#[x.y]##c##"],
    ["##a##[.r]##c##", "#a#[.r]##c##"],
    ["##a##[.a.b]##c##", "#a#[.a.b]##c##"],
    ["##a##[ ]__c__", "#a#[ ]_c_"],
    ["**a**[ ]##c##", "*a*[ ]#c#"],
    ["##a## [ ]##c##", "#a# [ ]#c#"],
    ["##a##[ ]##.c##", "#a#[ ]##.c##"],
  ])("%s still shortens to %s", async (source, expected) => {
    const input = `${source}\n`;
    const out = await formatAdoc(input);
    expect(out).toBe(`${expected}\n`);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  // The conservative edge: an attribute reference is substituted
  // before the run is parsed, so what it names is not a fact this tree
  // holds and the refusal fires without reading it. Here the reference
  // resolves to nothing and the run stays a role, so the shorter
  // spelling would have survived - a refusal costs bytes and no
  // meaning.
  test("an attrlist holding an attribute reference is refused unread", async () => {
    const input = "##a##[{x}]##c##\n";
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    expect(await formatAdoc(out)).toBe(out);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await renderedHtml("#a#[{x}]##c##\n")).toBe(
      await renderedHtml(input),
    );
  });
});
