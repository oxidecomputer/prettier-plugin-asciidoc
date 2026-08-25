/**
 * The plugin's registration surface — the half of the package Prettier
 * reads before any AsciiDoc is parsed.
 *
 * Three things live here and nowhere else in the suite. The
 * SupportLanguage descriptor (src/language.ts) is what tells Prettier
 * which files this plugin claims and which parser name they bind to;
 * the assembled Plugin object (src/index.ts) is what wires that parser
 * name to a parser and that parser's astFormat to a printer; and
 * locStart/locEnd (src/parser.ts) are the offset accessors Prettier
 * calls for cursor tracking and range formatting.
 *
 * None of it is a tautology. The extensions claimed and the names
 * bound ARE the contract with Prettier: a typo in any of them is a
 * plugin that silently formats nothing, and the format tests cannot
 * see it because they pass `parser: "asciidoc"` explicitly.
 * tests/format/identity.test.ts loads the built plugin from dist/ but
 * only formats through it, so it never reads the descriptor either.
 */
import { describe, expect, test } from "vitest";
import plugin, { locStart, locEnd } from "../src/index.js";
import { parse } from "../src/parser.js";

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
