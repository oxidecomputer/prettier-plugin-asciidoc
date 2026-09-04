/**
 * The plugin's registration surface — the half of the package Prettier
 * reads before any AsciiDoc is parsed.
 *
 * Four things live here and nowhere else in the suite. The
 * SupportLanguage descriptor (src/language.ts) is what tells Prettier
 * which files this plugin claims and which parser name they bind to;
 * the assembled Plugin object (src/index.ts) is what wires that parser
 * name to a parser and that parser's astFormat to a printer;
 * locStart/locEnd (src/parser.ts) are the offset accessors Prettier
 * calls for cursor tracking and range formatting; and the last describe
 * exercises all THREE of Prettier's entry points, not just `format`.
 *
 * None of it is a tautology. The extensions claimed and the names
 * bound ARE the contract with Prettier: a typo in any of them is a
 * plugin that silently formats nothing, and the format tests cannot
 * see it because they pass `parser: "asciidoc"` explicitly.
 * tests/format/identity.test.ts loads the built plugin from dist/ but
 * only formats through it, so it never reads the descriptor either.
 * The rest of the suite goes through `format` alone, which is how
 * `formatWithCursor` could throw on every document for as long as it
 * did (issue #37).
 */
import { describe, expect, test } from "vitest";
import { format, formatWithCursor } from "prettier";
import plugin, { locStart, locEnd } from "../src/index.js";
import { parse } from "../src/parser.js";
import {
  asciidocOptions,
  tableStyle,
  type TableStyle,
} from "../src/options.js";
import { formatAdoc } from "./helpers.js";

describe("the SupportLanguage descriptor", () => {
  test("names the language, its parser, and the files it claims", () => {
    expect(plugin.languages).toEqual([
      {
        name: "AsciiDoc",
        parsers: ["asciidoc"],
        extensions: [".adoc", ".asciidoc", ".asc"],
        vscodeLanguageIds: ["asciidoc"],
      },
    ]);
  });

  test("claims the three AsciiDoc file extensions, each with its dot", () => {
    const [language] = plugin.languages ?? [];
    expect(language.extensions).toEqual([".adoc", ".asciidoc", ".asc"]);
    // The dot is part of the contract: Prettier matches an
    // extension against the end of the filename, so a bare
    // "adoc" would also claim "notadoc".
    for (const extension of language.extensions ?? []) {
      expect(extension.startsWith(".")).toBe(true);
    }
  });

  test("uses the editor's own id for AsciiDoc", () => {
    const [language] = plugin.languages ?? [];
    expect(language.vscodeLanguageIds).toEqual(["asciidoc"]);
  });
});

describe("the assembled Plugin object", () => {
  test("ships a non-empty languages array", () => {
    expect(plugin.languages).toHaveLength(1);
  });

  test("the parser name the descriptor binds is a parser the plugin ships", () => {
    const [language] = plugin.languages ?? [];
    expect(language.parsers).toEqual(["asciidoc"]);
    expect(Object.keys(plugin.parsers ?? {})).toEqual(["asciidoc"]);
  });

  test("the parser's astFormat is a printer the plugin ships", () => {
    expect(plugin.parsers?.asciidoc.astFormat).toBe("asciidoc-ast");
    expect(Object.keys(plugin.printers ?? {})).toEqual(["asciidoc-ast"]);
  });
});

describe("the plugin's own options", () => {
  test("both table options are registered on the plugin", () => {
    expect(Object.keys(plugin.options ?? {}).toSorted()).toEqual([
      "asciidocTableAlignColumns",
      "asciidocTableLayout",
    ]);
  });

  // The two values name STYLES, not mechanisms. There is no "auto"
  // value: "auto" would name a mechanism rather than a spelling, and
  // both declared values name spellings instead. The width-driven
  // choice is the documented behaviour of the default value "row"
  // (src/print/table-layout.ts): printWidth picks the layout, the
  // option only names which style the document prefers.
  test("the layout option is a two-value choice defaulting to row", () => {
    const option = asciidocOptions.asciidocTableLayout;
    expect(option.type).toBe("choice");
    expect(option.default).toBe("row");
    expect(
      option.type === "choice"
        ? option.choices.map(
            (choice: { value: "row" | "cell" }) => choice.value,
          )
        : [],
    ).toEqual(["row", "cell"]);
  });

  test("the alignment option is a boolean defaulting to false", () => {
    const option = asciidocOptions.asciidocTableAlignColumns;
    expect(option.type).toBe("boolean");
    expect(option.default).toBe(false);
  });

  // The ONE read of the option names. The annotation is not
  // decoration: it is what names `TableStyle` from an entry point, and
  // the literal is what a `PrintOptions` satisfies structurally once
  // the module augmentation gives the names their types.
  //
  // BOTH KNOBS ARE FIELDS, and both are read by the emission
  // (src/print/table-layout.ts): a published field nothing reads is
  // what `scripts/metrics/unread-fields.ts` fails on, so this literal
  // going out of date in either direction is a gate failure and not
  // only a red row here.
  test("the option read renames the knobs into the printer's vocabulary", () => {
    const style: TableStyle = tableStyle({
      printWidth: 80,
      asciidocTableLayout: "cell",
      asciidocTableAlignColumns: true,
    });
    expect(style).toEqual({
      layout: "cell",
      printWidth: 80,
      alignColumns: true,
    });
  });

  test("an option the caller never set arrives at its default", async () => {
    // A ONE-ROW table, so the layout value cannot move a byte here
    // (the first row is never split): what this row owns is that
    // Prettier resolves the name, which a misspelled `name` field or a
    // missing registration breaks.
    await expect(
      formatAdoc("|===\n|a\n|===\n", { asciidocTableLayout: "cell" }),
    ).resolves.toBe("|===\n|a\n|===\n");
  });
});

describe("locStart and locEnd", () => {
  // One document with a leaf, a paragraph and a composite, so the
  // offsets are asserted against three different builders.
  const source = "= Title\n\nHello world.\n\n* one\n* two\n";
  const document = parse(source);

  test("the document's offsets span the whole source", () => {
    expect(locStart(document)).toBe(0);
    expect(locEnd(document)).toBe(source.length);
  });

  test("a block's offsets slice its own source text back out", () => {
    const sliced = document.children.map((child) =>
      source.slice(locStart(child), locEnd(child)),
    );
    expect(sliced).toEqual(["= Title", "Hello world.", "* one\n* two"]);
  });

  test("the end offset is exclusive, so blocks do not overlap", () => {
    const starts = document.children.map((child) => locStart(child));
    const ends = document.children.map((child) => locEnd(child));
    expect(starts).toEqual([0, 9, 23]);
    expect(ends).toEqual([7, 21, 34]);
    // Every block is non-empty, and consecutive blocks are apart by
    // the blank line between them -- which belongs to neither.
    expect(starts.map((start, index) => ends[index] - start)).toEqual([
      7, 12, 11,
    ]);
    expect(starts.slice(1).map((start, index) => start - ends[index])).toEqual([
      2, 2,
    ]);
  });

  test("an empty document reports a zero-width span at the origin", () => {
    const empty = parse("");
    expect(locStart(empty)).toBe(0);
    expect(locEnd(empty)).toBe(0);
  });

  // The pair Prettier actually calls is the one on the parser
  // descriptor, not the module's named exports; they are the same
  // functions and this is what says so.
  test("the parser descriptor exposes the same pair", () => {
    const parser = plugin.parsers?.asciidoc;
    expect(parser?.locStart(document)).toBe(locStart(document));
    expect(parser?.locEnd(document)).toBe(locEnd(document));
  });
});

/**
 * The three ways Prettier can be asked to format, exercised against
 * one document. `format` is what the rest of the suite uses;
 * `formatWithCursor` and the range options each take a code path of
 * their own inside Prettier, and both walk the AST GENERICALLY rather
 * than through the printer: the walk src/print/visitor-keys.ts
 * exists to steer.
 */
describe("Prettier's entry points", () => {
  // One document per thing that can hold a cursor: a heading leaf, a
  // paragraph with a collapsible whitespace run, a list, a nested
  // list, and a block attached to an item behind a `+`. The runs are
  // deliberate: a document the formatter would not change cannot
  // tell a correct cursor translation from a cursor left where it was.
  const source = [
    "= Title",
    "",
    "Some    paragraph text here.",
    "",
    "* one",
    "** deep    inner",
    "+",
    "attached    para",
    "* two",
    "",
  ].join("\n");
  const expected = [
    "= Title",
    "",
    "Some paragraph text here.",
    "",
    "* one",
    "** deep inner",
    "+",
    "attached para",
    "* two",
    "",
  ].join("\n");
  const options = { parser: "asciidoc", plugins: [plugin] };

  test("format collapses the whitespace runs", async () => {
    expect(await format(source, options)).toBe(expected);
  });

  test("formatWithCursor produces the same text as format", async () => {
    const result = await formatWithCursor(source, {
      ...options,
      cursorOffset: 0,
    });
    expect(result.formatted).toBe(expected);
  });

  // The regression this file's fourth entry exists for. Before
  // src/print/visitor-keys.ts, Prettier's cursor walk read every
  // enumerable property of every node and called locStart on
  // `position` itself, which has no `position` of its own, so it threw
  // `undefined is not an object` dereferencing `undefined.start`. Any
  // offset reproduced it; every offset is checked so the row cannot
  // pass by landing on the one node the walk stopped short of.
  //
  // `0 <= cursorOffset <= formatted.length` holds for THIS document,
  // not universally, so do not read the row as an invariant if the
  // document is ever swapped. Two upstream-owned shapes legitimately
  // return -1: a whitespace-only document, where coreFormat returns
  // `{formatted: "", cursorOffset: -1}` without parsing at all, and
  // offset 0 of a document with a byte-order mark, where
  // normalizeInputAndOptions strips the mark and decrements the cursor
  // past 0 and nothing re-tracks it. Neither is anything this plugin
  // causes or can fix.
  test("formatWithCursor tracks a cursor at every offset", async () => {
    const offsets = Array.from(
      { length: source.length },
      (_gap, index) => index,
    );
    const results = await Promise.all(
      offsets.map(
        async (cursorOffset) =>
          await formatWithCursor(source, { ...options, cursorOffset }),
      ),
    );
    const outOfRange = results.filter(
      (result) =>
        result.cursorOffset < 0 ||
        result.cursorOffset > result.formatted.length,
    );
    expect(outOfRange).toEqual([]);
  });

  // Translation fidelity, as far as it is well defined: an offset
  // sitting ON a word character comes back sitting on THAT character.
  // Offsets inside a collapsed whitespace run have no such answer --
  // the run they pointed into is gone -- so they are only held to
  // being in range, above.
  test("a cursor on a word character stays on that character", async () => {
    const wordOffsets = Array.from(
      { length: source.length },
      (_gap, index) => index,
    ).filter((index) => /\w/v.test(source.charAt(index)));
    const landed = await Promise.all(
      wordOffsets.map(async (cursorOffset) => {
        const result = await formatWithCursor(source, {
          ...options,
          cursorOffset,
        });
        return result.formatted[result.cursorOffset];
      }),
    );
    expect(landed).toEqual(wordOffsets.map((offset) => source[offset]));
  });

  test("a range covering the whole document formats the whole document", async () => {
    expect(
      await format(source, {
        ...options,
        rangeStart: 0,
        rangeEnd: source.length,
      }),
    ).toBe(expected);
  });

  // A SUB-range returns the document untouched, and that is Prettier's
  // own limit rather than something this plugin can lift. `calculateRange`
  // narrows a range by finding the outermost node at each end that
  // `isSourceElement` accepts, and `isSourceElement` is a switch over
  // Prettier's OWN parser names with `return false` as its default --
  // there is no plugin hook. Every third-party parser therefore gets
  // `undefined` back, which `formatRange` reads as the empty range
  // `[0, 0]`, so it formats the empty string and splices it into
  // nothing. What this row holds is that the path stays TOTAL: with the
  // visitor keys declared it walks children instead of position points,
  // and it returns rather than throwing.
  test("a sub-range returns the source unchanged, and does not throw", async () => {
    const middle = source.indexOf("Some");
    expect(
      await format(source, {
        ...options,
        rangeStart: middle,
        rangeEnd: middle + "Some    paragraph text here.".length,
      }),
    ).toBe(source);
  });
});
