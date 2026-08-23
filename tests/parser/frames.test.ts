/**
 * The shared vocabulary's pure units: `fragmentOfLine` and
 * `heldMetadataNode` in src/parse/lines/frames.ts.
 *
 * Table-driven because each is `(input) → value` with no context: the
 * rows are the specification. The reader's characterization suites
 * (reader.test.ts, reader-lists.test.ts) pin what the reader DOES with
 * these; this file pins what they are.
 */
import { describe, expect, test } from "vitest";
import type { BlockNode } from "../../src/ast.js";
import {
  classifyLine,
  BLOCK_START_CONTEXT,
} from "../../src/parse/lines/classify.js";
import {
  fragmentOfLine,
  heldMetadataNode,
  isHeldMetadata,
} from "../../src/parse/lines/frames.js";
import { splitLines, type SourceLine } from "../../src/parse/lines/split.js";
import { makeLocationIndex } from "../../src/parse/positions.js";

describe("fragmentOfLine", () => {
  // The third line carries trailing whitespace: `raw` keeps it, `text`
  // does not, and a node is built from RAW.
  const [first, second, third] = splitLines("ab\ncde\nfg  \n");

  const rows: Array<
    [string, { line: SourceLine; from?: number; to?: number }, string, number]
  > = [
    ["the whole first line", { line: first }, "ab", 0],
    ["the whole second line", { line: second }, "cde", 3],
    ["the third line, trailing space included", { line: third }, "fg  ", 7],
    ["from a column to the end", { line: second, from: 1 }, "de", 4],
    ["a slice inside the line", { line: second, from: 1, to: 2 }, "d", 4],
    [
      "an empty slice at the line's end",
      { line: second, from: 3, to: 3 },
      "",
      6,
    ],
  ];
  test.each(rows)("%s", (_name, { line, from, to }, image, offset) => {
    expect(fragmentOfLine(line, from, to)).toEqual({ image, offset });
  });
});

describe("heldMetadataNode / isHeldMetadata", () => {
  // One line per kind `parse_block_metadata_line` claims, plus the
  // kinds it does not: an attribute ENTRY is processed where it stands,
  // and text, a marker and a title open blocks of their own. A block
  // anchor is its own node kind (spec D6, build/metadata.ts).
  const held: Array<[string, BlockNode["type"]]> = [
    ["[[id]]", "blockAnchor"],
    ["[source]", "blockAttributeList"],
    [".Title", "blockTitle"],
    ["// comment", "comment"],
    ["ifdef::x[]", "preprocessorDirective"],
  ];
  const notHeld = [":name: value", "text", "* item", "== Title", "----"];

  test.each(held)("%j is held, as a %s node", (text, type) => {
    const source = `${text}\n`;
    const [line] = splitLines(source);
    const kind = classifyLine(line.text, BLOCK_START_CONTEXT);
    expect(isHeldMetadata(kind)).toBe(true);
    const node = heldMetadataNode(kind, line, makeLocationIndex(source));
    expect(node?.type).toBe(type);
    // Built from the line's own span: the node starts where the line does.
    expect(node?.position.start).toEqual({ offset: 0, line: 1, column: 1 });
  });

  test.each(notHeld)("%j is not held", (text) => {
    const source = `${text}\n`;
    const [line] = splitLines(source);
    const kind = classifyLine(line.text, BLOCK_START_CONTEXT);
    expect(isHeldMetadata(kind)).toBe(false);
    expect(heldMetadataNode(kind, line, makeLocationIndex(source))).toBe(
      undefined,
    );
  });
});
