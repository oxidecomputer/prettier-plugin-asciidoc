import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";

// TOTALITY. `parse` is a total function: every string is a document.
// There is no recognition step that can fail and no error-recovery
// mode to fall into — a line no rule claims becomes paragraph text
// through the reader's fall-through arm. These rows pin that on the
// shapes most likely to have been a parse error in a grammar-based
// parser. (The file keeps its name so its history stays findable.)
describe("parser totality", () => {
  // Plain prose with no AsciiDoc constructs should parse as a simple
  // paragraph — the reader's fall-through arm opens one for any line
  // no other rule claims. This is the baseline "no crash" case.
  test("plain prose parses without throwing", () => {
    const document = parse("Just some regular text.\n");
    expect(document.type).toBe("document");
    expect(document.children.length).toBeGreaterThan(0);
  });

  // Mixed well-formed and malformed constructs: the reader classifies
  // what it recognises and makes paragraph text of the rest, never
  // throwing.
  test("mixed recognized and unrecognized constructs", () => {
    const input = [
      "= Title",
      "",
      "A paragraph.",
      "",
      "````unknown-fence",
      "some content",
      "````",
      "",
      "Another paragraph.",
      "",
    ].join("\n");
    const document = parse(input);
    expect(document.type).toBe("document");
    expect(document.children.length).toBeGreaterThan(0);
  });

  // Unclosed delimited block: EOF arrives before the closing
  // delimiter. The parser should not throw — it should produce
  // whatever partial result it can.
  test("unclosed listing block does not throw", () => {
    const input = "----\nsome code\nmore code\n";
    const document = parse(input);
    expect(document.type).toBe("document");
  });

  // Unclosed literal block similarly should not throw.
  test("unclosed literal block does not throw", () => {
    const input = "....\nliteral content\n";
    const document = parse(input);
    expect(document.type).toBe("document");
  });

  // Unclosed pass block.
  test("unclosed pass block does not throw", () => {
    const input = "++++\npass content\n";
    const document = parse(input);
    expect(document.type).toBe("document");
  });

  // Malformed attribute entry: missing the closing colon. The
  // classifier does not recognise it as an attribute entry, so it is
  // paragraph text — a document either way, never a throw.
  test("malformed attribute entry does not throw", () => {
    const input = ":incomplete-attr\n\nSome text.\n";
    const document = parse(input);
    expect(document.type).toBe("document");
  });

  // A document that is entirely blank lines and whitespace —
  // already works, but verify it stays non-throwing.
  test("whitespace-only input produces empty document", () => {
    const document = parse("   \n   \n");
    expect(document.type).toBe("document");
  });

  // Unclosed block comment should not throw.
  test("unclosed block comment does not throw", () => {
    const input = "////\ncomment content\n";
    const document = parse(input);
    expect(document.type).toBe("document");
  });

  // Unclosed example block.
  test("unclosed example block does not throw", () => {
    const input = "====\nexample content\n";
    const document = parse(input);
    expect(document.type).toBe("document");
  });

  // Unclosed sidebar block.
  test("unclosed sidebar block does not throw", () => {
    const input = "****\nsidebar content\n";
    const document = parse(input);
    expect(document.type).toBe("document");
  });

  // Unclosed quote block: `____` with no close delimiter.
  test("unclosed quote block does not throw", () => {
    const input = "____\nquote content\n";
    const document = parse(input);
    expect(document.type).toBe("document");
  });

  // Unclosed open block: `--` with no close delimiter.
  test("unclosed open block does not throw", () => {
    const input = "--\nopen block content\n";
    const document = parse(input);
    expect(document.type).toBe("document");
  });
});
