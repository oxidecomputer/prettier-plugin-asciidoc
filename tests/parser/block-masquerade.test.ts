/**
 * Parser tests for block masquerading (style-driven content model).
 *
 * A style attribute on a delimited block changes its effective
 * content model. The critical cases for formatting correctness:
 *
 * - `[verse]` on `____` → verbatim (line breaks preserved)
 * - `[source]`/`[listing]`/`[literal]` on `--` → verbatim
 * - `[stem]`/`[latexmath]`/`[asciimath]` on `____` → verbatim
 *
 * Admonition handling (`[NOTE]`/`[TIP]` on `====`) is a
 * separate transformation (not masquerade) and is tested in
 * admonition.test.ts.
 *
 * Masquerades that don't change the content model (e.g.
 * `[source]` on `----`, `[quote]` on `--`) are not tested
 * here because they don't affect formatting behavior.
 */
import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import {
  delimitedBlockAt,
  expectFormatted,
  narrow,
  parentBlockAt,
} from "../helpers.js";
import { astShape, serializedKeys } from "./reader-helpers.js";

describe("[verse] on quote block (____)", () => {
  test("preserves exact line breaks in verse content", () => {
    const input = "[verse]\n____\nLine one.\n\nLine three.\n____\n";
    const { children } = parse(input);
    const block = delimitedBlockAt(children, 1);
    expect(block.content).toBe("Line one.\n\nLine three.");
  });
});

// Stem styles (`[stem]`, `[latexmath]`, `[asciimath]`) masquerade
// a quote block as `variant: "pass"`. The pass variant means the
// printer emits the content verbatim without inline substitutions —
// correct for math notation where `^`, `_`, and `\` are literal.
describe("[stem]/[latexmath]/[asciimath] on quote block (____)", () => {
  test("[latexmath] on quote block produces verbatim block", () => {
    const frac = String.raw`\frac{a}{b}`;
    const { children } = parse(`[latexmath]\n____\n${frac}\n____\n`);
    expect(children).toHaveLength(2);
    const block = delimitedBlockAt(children, 1);
    expect(block.variant).toBe("pass");
    expect(block.content).toBe(frac);
  });
});

describe("default behavior preserved (no masquerade)", () => {
  test("[.role] on open block does NOT masquerade", () => {
    const { children } = parse("[.role]\n--\nContent.\n--\n");
    expect(children).toHaveLength(2);
    expect(children[0].type).toBe("blockAttributeList");
    const block = parentBlockAt(children, 1);
    expect(block.variant).toBe("open");
  });
});

describe("masquerade with extended delimiters", () => {
  test("[verse] on extended quote block (______)", () => {
    const { children } = parse(
      "[verse]\n______\nLine one.\nLine two.\n______\n",
    );
    expect(children).toHaveLength(2);
    const block = delimitedBlockAt(children, 1);
    expect(block.variant).toBe("verse");
    expect(block.content).toBe("Line one.\nLine two.");
  });
});

// Key ORDER is part of the no-change claim: parity digests the JSON
// STRING (scripts/parity.ts), so a field that MOVES — same value,
// different position — is an AST difference with no ledger family
// (B2: 12 corpus cases carry sourceDelimiter). The key-order rows
// below hold the builders to today's serialized orders, measured
// against the baseline.
// Unknown-style downgrade at open (parser.rb:548-549): a style that
// matches no masquerade for the kind resolves to the delimiter's own
// model — except that today's uppercase-word rule claims any single
// alphabetic word as an admonition variant, `source` included. That
// divergence is recorded and kept byte-round-tripping; these
// rows pin the TREE and the BYTES so the open-time resolver cannot
// drift from the close-time pass it replaces.
describe("held styles on delimiters the style does not re-model", () => {
  test("[source] on ==== keeps today's tree and bytes", async () => {
    expect(astShape("[source]\n====\nx\n====\n")).toBe(
      "attrs admonition(source)",
    );
    const input = "[source]\n====\nx\n====\n";
    await expectFormatted(input, input);
  });

  test("[source] on **** keeps today's tree and bytes", async () => {
    expect(astShape("[source]\n****\nx\n****\n")).toBe(
      "attrs admonition(source)",
    );
    const input = "[source]\n****\nx\n****\n";
    await expectFormatted(input, input);
  });

  test("[#id] on ==== stays a compound example (no style matches)", () => {
    expect(astShape("[#id]\n====\nx\n====\n")).toBe("anchor example(p(t))");
  });

  test("a held title after the attribute line disables the masquerade", () => {
    expect(astShape("[verse]\n.Title\n____\nx\n____\n")).toBe(
      "attrs title quote(p(t))",
    );
  });

  test("a reader-eaten line after the attribute line is transparent", () => {
    expect(astShape("[verse]\n// c\n____\nx\n____\n")).toBe(
      "attrs comment verse[1]",
    );
  });

  // The three rows below are the pinned key orders that are NOT read
  // from the declarations, and this is why. A delimited block's
  // builder stamps `annotatedBy`, `fenced` and `language` after
  // `position` (src/parse/build/delimited.ts), where the reader's
  // older post-construction stamp had left them, so the wire order
  // here is a fact about the builder rather than about `src/ast.ts`;
  // {@link declaredKeyOrder} would put `position` last and disagree.
  // Five interfaces also share this discriminant, so there is no one
  // declared order to read. Written out, and the three spellings below
  // are the three the builder produces.
  //
  // `annotatedBy` cannot be an AST difference - the parity normalizer
  // drops the key before digesting (scripts/parity.ts, `annotatedBy`
  // to undefined), which is why (xi) and not parity is its pin. Every
  // other key keeps its baseline position.
  test("a masqueraded node's key order is the baseline's", () => {
    const [, node] = parse("[verse]\n____\nx\n____\n").children;
    expect(serializedKeys(node)).toEqual([
      "type",
      "variant",
      "form",
      "content",
      "sourceDelimiter",
      "position",
      "annotatedBy",
    ]);
  });

  test("a fence's key order is the baseline's", () => {
    const [node] = parse("```ruby\nfoo\n```\n").children;
    expect(serializedKeys(node)).toEqual([
      "type",
      "variant",
      "form",
      "content",
      "position",
      "fenced",
      "language",
    ]);
  });

  test("a confined-unterminated block's key order is the baseline's", () => {
    const document = parse("* item\n+\n----\nfoo\n\nafter\n");
    const [list] = document.children;
    narrow(list, "list");
    const [item] = list.children;
    const block = item.blocks.at(-1)?.block;
    expect(block?.type).toBe("delimitedBlock");
    expect(serializedKeys(block)).toEqual([
      "type",
      "variant",
      "form",
      "content",
      "position",
    ]);
  });
});
