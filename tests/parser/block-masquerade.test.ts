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
import type { DelimitedBlockNode, ParentBlockNode } from "../../src/ast.js";
import { formatAdoc, narrow, renderedHtml } from "../helpers.js";
import { astShape, serializedKeys } from "./reader-helpers.js";

/**
 * Extracts the child at the given index as a
 * DelimitedBlockNode. Throws if the node type does not
 * match, catching test setup errors early.
 * @param children - parsed document children array
 * @param index - position of the expected delimited block
 * @returns the child narrowed to DelimitedBlockNode
 */
function delimitedBlockAt(
  children: ReturnType<typeof parse>["children"],
  index: number,
): DelimitedBlockNode {
  const { [index]: block } = children;
  narrow(block, "delimitedBlock");
  return block;
}

/**
 * Extracts the child at the given index as a
 * ParentBlockNode. Throws if the node type does not
 * match, catching test setup errors early.
 * @param children - parsed document children array
 * @param index - position of the expected parent block
 * @returns the child narrowed to ParentBlockNode
 */
function parentBlockAt(
  children: ReturnType<typeof parse>["children"],
  index: number,
): ParentBlockNode {
  const { [index]: block } = children;
  narrow(block, "parentBlock");
  return block;
}

describe("[verse] on quote block (____)", () => {
  test("produces a delimited block with variant verse", () => {
    const { children } = parse(
      "[verse]\n____\nRoses are red,\nViolets are blue.\n____\n",
    );
    expect(children).toHaveLength(2);
    expect(children[0].type).toBe("blockAttributeList");
    const block = delimitedBlockAt(children, 1);
    expect(block.variant).toBe("verse");
    expect(block.form).toBe("delimited");
    expect(block.sourceDelimiter).toBe("quote");
    expect(block.content).toBe("Roses are red,\nViolets are blue.");
  });

  test("preserves exact line breaks in verse content", () => {
    const input = "[verse]\n____\nLine one.\n\nLine three.\n____\n";
    const { children } = parse(input);
    const block = delimitedBlockAt(children, 1);
    expect(block.content).toBe("Line one.\n\nLine three.");
  });

  test("empty verse block", () => {
    const { children } = parse("[verse]\n____\n____\n");
    const block = delimitedBlockAt(children, 1);
    expect(block.variant).toBe("verse");
    expect(block.content).toBe("");
  });

  test("verse with attribution in attribute list", () => {
    const { children } = parse(
      "[verse, Carl Sandburg, Fog]\n____\nThe fog comes\non little cat feet.\n____\n",
    );
    expect(children).toHaveLength(2);
    // The full attribute string including positional params
    // (author, source) is preserved in the blockAttributeList
    // value, not in a dedicated field on the verse block.
    // Attribution is reconstructed from the attribute list at
    // render time, not stored as structured data.
    expect(children[0].type).toBe("blockAttributeList");
    const block = delimitedBlockAt(children, 1);
    expect(block.variant).toBe("verse");
    expect(block.content).toBe("The fog comes\non little cat feet.");
  });
});

describe("[source]/[listing]/[literal] on open block (--)", () => {
  test("[source] on open block produces verbatim listing", () => {
    const { children } = parse("[source]\n--\nputs 'hello'\n--\n");
    expect(children).toHaveLength(2);
    expect(children[0].type).toBe("blockAttributeList");
    const block = delimitedBlockAt(children, 1);
    expect(block.variant).toBe("listing");
    expect(block.form).toBe("delimited");
    expect(block.sourceDelimiter).toBe("open");
    expect(block.content).toBe("puts 'hello'");
  });

  test("[source,ruby] extra positional attribute still triggers masquerade", () => {
    // The `ruby` language hint is a second positional attribute.
    // `parseAttrlist` takes only the first token before the comma,
    // so `[source,ruby]` resolves to style "source" and triggers
    // the same masquerade as plain `[source]`. The `language`
    // field is NOT populated here — that field is only set by
    // fenced-code syntax (```lang), not by attribute lists.
    const { children } = parse("[source,ruby]\n--\nputs 'hello'\n--\n");
    expect(children).toHaveLength(2);
    const block = delimitedBlockAt(children, 1);
    expect(block.variant).toBe("listing");
    expect(block.content).toBe("puts 'hello'");
  });

  test("[listing] on open block produces verbatim listing", () => {
    const { children } = parse("[listing]\n--\ndef foo\n  bar\nend\n--\n");
    expect(children).toHaveLength(2);
    const block = delimitedBlockAt(children, 1);
    expect(block.variant).toBe("listing");
    expect(block.content).toBe("def foo\n  bar\nend");
  });

  test("[literal] on open block produces verbatim literal", () => {
    const { children } = parse("[literal]\n--\nfixed-width text\n--\n");
    expect(children).toHaveLength(2);
    const block = delimitedBlockAt(children, 1);
    expect(block.variant).toBe("literal");
    expect(block.content).toBe("fixed-width text");
  });
});

describe("[comment]/[pass]/[verse] on open block (--)", () => {
  test("[pass] on open block produces verbatim pass block", () => {
    const { children } = parse("[pass]\n--\n<div>raw</div>\n--\n");
    expect(children).toHaveLength(2);
    const block = delimitedBlockAt(children, 1);
    expect(block.variant).toBe("pass");
    expect(block.content).toBe("<div>raw</div>");
  });

  test("[comment] on open block produces verbatim pass block", () => {
    // `[comment]` maps to the `pass` variant rather than a
    // dedicated `comment` variant. Both represent content the
    // renderer suppresses entirely. Re-using `pass` avoids
    // adding a variant that behaves identically in the printer.
    const { children } = parse("[comment]\n--\nThis is hidden.\n--\n");
    expect(children).toHaveLength(2);
    const block = delimitedBlockAt(children, 1);
    expect(block.variant).toBe("pass");
    expect(block.content).toBe("This is hidden.");
  });

  test("[verse] on open block produces verbatim verse block", () => {
    const { children } = parse(
      "[verse]\n--\nRoses are red,\nViolets are blue.\n--\n",
    );
    expect(children).toHaveLength(2);
    const block = delimitedBlockAt(children, 1);
    expect(block.variant).toBe("verse");
    expect(block.content).toBe("Roses are red,\nViolets are blue.");
  });
});

// Stem styles (`[stem]`, `[latexmath]`, `[asciimath]`) masquerade
// a quote block as `variant: "pass"`. The pass variant means the
// printer emits the content verbatim without inline substitutions —
// correct for math notation where `^`, `_`, and `\` are literal.
describe("[stem]/[latexmath]/[asciimath] on quote block (____)", () => {
  test("[stem] on quote block produces verbatim block", () => {
    const { children } = parse("[stem]\n____\nx = y^2\n____\n");
    expect(children).toHaveLength(2);
    const block = delimitedBlockAt(children, 1);
    expect(block.variant).toBe("pass");
    expect(block.form).toBe("delimited");
    expect(block.content).toBe("x = y^2");
  });

  test("[latexmath] on quote block produces verbatim block", () => {
    const frac = String.raw`\frac{a}{b}`;
    const { children } = parse(`[latexmath]\n____\n${frac}\n____\n`);
    expect(children).toHaveLength(2);
    const block = delimitedBlockAt(children, 1);
    expect(block.variant).toBe("pass");
    expect(block.content).toBe(frac);
  });

  test("[asciimath] on quote block produces verbatim block", () => {
    const { children } = parse("[asciimath]\n____\nsum_(i=1)^n i\n____\n");
    expect(children).toHaveLength(2);
    const block = delimitedBlockAt(children, 1);
    expect(block.variant).toBe("pass");
    expect(block.content).toBe("sum_(i=1)^n i");
  });
});

describe("default behavior preserved (no masquerade)", () => {
  test("quote block without style stays as parent block", () => {
    const { children } = parse("____\nContent.\n____\n");
    expect(children).toHaveLength(1);
    const block = parentBlockAt(children, 0);
    expect(block.variant).toBe("quote");
  });

  test("open block without style stays as parent block", () => {
    const { children } = parse("--\nContent.\n--\n");
    expect(children).toHaveLength(1);
    const block = parentBlockAt(children, 0);
    expect(block.variant).toBe("open");
  });

  test("[#myid] on quote block does NOT masquerade", () => {
    const { children } = parse("[#myid]\n____\nContent.\n____\n");
    expect(children).toHaveLength(2);
    expect(children[0].type).toBe("blockAttributeList");
    const block = parentBlockAt(children, 1);
    expect(block.variant).toBe("quote");
  });

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
    expect(await formatAdoc(input)).toBe(input);
    expect(await renderedHtml(await formatAdoc(input))).toBe(
      await renderedHtml(input),
    );
  });

  test("[source] on **** keeps today's tree and bytes", async () => {
    expect(astShape("[source]\n****\nx\n****\n")).toBe(
      "attrs admonition(source)",
    );
    const input = "[source]\n****\nx\n****\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  test("[#id] on ==== stays a compound example (no style matches)", () => {
    expect(astShape("[#id]\n====\nx\n====\n")).toBe("attrs example(p(t))");
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

  // A declared key-order exception: `annotatedBy` trails `position`
  // here. The builder writes it LAST in the node literal
  // (src/parse/build/delimited.ts), which is where the reader's older
  // post-construction stamp had left it, so this row holds the wire
  // order across that move. It cannot be an AST difference - the
  // parity normalizer drops the key before digesting
  // (scripts/parity.ts, `annotatedBy` → undefined), which is why (xi)
  // and not parity is its pin. Every other key keeps its baseline
  // position.
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
