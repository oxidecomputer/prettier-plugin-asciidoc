/**
 * THE MARK RECORD, read off the tree the reader built.
 *
 * The format suites assert what the printer WRITES; these rows assert
 * what the reader RECORDED about a span's two marks, which is the
 * half a byte pin cannot separate. A mark is `entangled` when the
 * content is flush against it - which is what every constrained row's
 * `(\S|\S#{CC_ALL}*?\S)` content group demands - and `isolated` when
 * the source put whitespace between the two.
 *
 * Every input is parsed, never hand-built: the record is made from
 * the same token slice the span's children are built from, and a
 * hand-built tree could agree with neither.
 *
 * The LEMMA rows at the end are what makes the record a fact and not
 * a cache: the printer writes bytes from which a second read
 * re-derives the same record, so reverting the recording reddens
 * them.
 */
import { describe, expect, test } from "vitest";
import { parse } from "../../src/parser.js";
import type { InlineNode } from "../../src/ast.js";
import type { SpanMarks } from "../../src/mark-record.js";
import { formatAdoc, narrow } from "../helpers.js";

const ENTANGLED = { kind: "entangled" } as const;
const ISOLATED = { kind: "isolated" } as const;

/** The span kinds a mark record is recorded on. */
const MARK_SPANS = new Set(["bold", "italic", "monospace", "highlight"]);

/**
 * Every inline node of a document's first paragraph, spans included,
 * in source order.
 * @param source - the document.
 * @returns the nodes, flattened.
 */
function inlineNodes(source: string): InlineNode[] {
  const [block] = parse(source).children;
  narrow(block, "paragraph");
  const out: InlineNode[] = [];
  const walk = (nodes: readonly InlineNode[]): void => {
    for (const node of nodes) {
      out.push(node);
      if ("children" in node) {
        walk(node.children);
      }
    }
  };
  walk(block.children);
  return out;
}

/**
 * The record on the document's first mark span.
 * @param source - the document.
 * @returns the span's two marks.
 */
function marksOf(source: string): SpanMarks {
  const span = inlineNodes(source).find((node) => MARK_SPANS.has(node.type));
  if (span === undefined || !("marks" in span)) {
    throw new Error(`no mark span in ${JSON.stringify(source)}`);
  }
  return span.marks;
}

describe("what a mark stands against", () => {
  test.each([
    ["x **a** y", { open: ENTANGLED, close: ENTANGLED }],
    ["x ** a** y", { open: ISOLATED, close: ENTANGLED }],
    ["x **a ** y", { open: ENTANGLED, close: ISOLATED }],
    ["x ** a ** y", { open: ISOLATED, close: ISOLATED }],
    ["x **\na** y", { open: ISOLATED, close: ENTANGLED }],
    ["x **a\n** y", { open: ENTANGLED, close: ISOLATED }],
    // Whitespace-only content: both marks face the same run.
    ["x ** ** y", { open: ISOLATED, close: ISOLATED }],
    // A tab is Ruby's `\s` as much as a space is.
    ["x **\ta** y", { open: ISOLATED, close: ENTANGLED }],
    // The constrained rows refuse an edge run themselves, so a
    // constrained span's marks are entangled by the pairing.
    ["x *a* y", { open: ENTANGLED, close: ENTANGLED }],
    // A nested construct flush against the mark is content: the mark
    // is entangled with it exactly as it would be with a letter.
    ["x **{v} a** y", { open: ENTANGLED, close: ENTANGLED }],
    ["x **__a__** y", { open: ENTANGLED, close: ENTANGLED }],
  ])("%j records %j", (source, marks) => {
    expect(marksOf(source)).toEqual(marks);
  });

  // The hard-break token's own image OPENS with the space
  // `HardLineBreakRx` reads (`^(.*) \+$`), so a span whose content
  // starts with one has whitespace against its opening mark. This is
  // the shape the printer could only see by looking inside an atom's
  // bytes, never at the join in front of it.
  test("a hard break's leading space isolates the mark in front of it", () => {
    expect(marksOf("x ** +\na** y")).toEqual({
      open: ISOLATED,
      close: ENTANGLED,
    });
  });

  // Issue #147: a run kept beside a lone `--` rides INSIDE the atom,
  // so the join in front of the content is glue and the printer's old
  // byte-plus-join test needed both halves to see it. The record
  // reads the source and needs one.
  test("a run kept beside a lone dash pair isolates the mark", () => {
    expect(marksOf("x **\t-- a** y")).toEqual({
      open: ISOLATED,
      close: ENTANGLED,
    });
  });
});

describe("the rows with a fixed spelling record nothing", () => {
  // `marksOf` (src/print/span-edges.ts) answers `entangled` for the
  // curved, superscript and subscript rows without reading a field,
  // because those rows' own content groups refuse whitespace at
  // either edge (asciidoctor.rb l.449-452, l.465-468). These rows are
  // what makes that a construction guarantee rather than an
  // assumption: the delimiters stay literal text and no span is
  // built at all.
  test.each([
    'x "` a `" y',
    'x "`\na`" y',
    "x '` a `' y",
    "x ^ a^ y",
    "x ~ a~ y",
  ])("%j builds no span", (source) => {
    const kinds = new Set(inlineNodes(source).map((node) => node.type));
    expect(kinds.has("curvedQuote")).toBe(false);
    expect(kinds.has("superscript")).toBe(false);
    expect(kinds.has("subscript")).toBe(false);
  });
});

describe("the record is re-derived from the bytes the printer writes", () => {
  // The lemma: format the document, read the OUTPUT back, and the
  // record is the same one. An isolated mark keeps at least one
  // whitespace byte against it and an entangled one keeps none, so
  // neither arm is a fact the printer destroys.
  test.each([
    "x **a** y",
    "x ** a** y",
    "x **a ** y",
    "x **\na** y",
    // The close side reached through a break, which the packer folds
    // to the fusion's space: the arm survives, the spelling does not.
    "x **a\n** y",
    "x ** ** y",
    "x **\t-- a** y",
  ])("%j", async (source) => {
    const output = await formatAdoc(source);
    expect(marksOf(output)).toEqual(marksOf(source));
  });
});
