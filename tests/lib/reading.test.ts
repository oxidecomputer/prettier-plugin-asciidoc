/**
 * The projection's own unit tests: what `readingOf` keeps and what it
 * is licensed to drop.
 *
 * This is where the judgement in tests/lib/reading.ts is pinned. A
 * too-generous projection rule hides a real hazard and a too-strict
 * one floods the net with deliberate formatting, so every rule gets a
 * row here, and the known-issue table of issue #58 gets rows in BOTH
 * directions: the clean spelling reads the way it should, and the
 * corrupted spelling produces the signature the net is supposed to
 * report. Nothing here formats anything - that is
 * tests/format/reading-invariant.test.ts's job.
 */
import { describe, expect, test } from "vitest";
import {
  diffSignature,
  readingBreaches,
  readingOf,
  untracedLines,
} from "./reading.js";

describe("the reading of a document", () => {
  // The verdicts that carry a payload the reading depends on, and the
  // normalizations that fold spelling the formatter may change.
  test.each([
    ["a section title carries its level", "== S\n", ["section:1"]],
    [
      "a marker carries its variant AND its style",
      "- a\n",
      ["marker:unordered:-"],
    ],
    [
      "another spelling of the same variant is another style",
      "* a\n",
      ["marker:unordered:*"],
    ],
    ["an ordered marker is its own variant", ". a\n", ["marker:ordered:."]],
    ["a delimiter carries its block kind", "----\n----\n", ["delim:listing"]],
    // The label line projects to the admonition AND its body text,
    // where the `[NOTE]` style line projects to the admonition alone:
    // the two spellings of one admonition read alike only if the
    // label's own text is a token of its own (tests/lib/reading.ts).
    [
      "an admonition carries its label, then its body",
      "NOTE: x\n",
      ["admon:NOTE", "text"],
    ],
    [
      "the style spelling of the same admonition reads alike",
      "[NOTE]\nx\n",
      ["admon:NOTE", "text"],
    ],
    [
      "a style line naming anything else is an attribute line",
      "[note]\nx\n",
      ["attrline", "text"],
    ],
    // The licence is no wider than the routing: the reader refuses to
    // fold a style line that stands under another attribute line, so
    // the projection refuses too. Before this the two read alike and
    // a respelling that changes the render was invisible.
    [
      "a style line under another attribute line is an attribute line",
      "[source]\n[NOTE]\nx\n",
      ["attrline", "attrline", "text"],
    ],
    [
      "and the label spelling under one is NOT the same reading",
      "[source]\nNOTE: x\n",
      ["attrline", "admon:NOTE", "text"],
    ],
    ["a block macro carries its name", "image::a.png[]\n", ["macro:image"]],
    ["a thematic break is its own token", "'''\n", ["break:thematic"]],
    ["a page break is its own token", "<<<\n", ["break:page"]],
    [
      "a lone + the reader classifies is a continuation",
      "para\n\n+\n\npara\n",
      ["text", "cont", "text"],
    ],
  ])("%s", (_name, source, expected) => {
    expect(readingOf(source)).toEqual(expected);
  });

  // The marker style is what tells an item from the nested item under
  // it, so a flatten - a `**` item re-emitted as `*` - has to move the
  // sequence. A variant-only projection read these two as the same
  // document, which is the corruption class the sweep alphabet spells
  // `* a` and `** b` to catch (issue #42).
  test("a nesting flatten changes the reading", () => {
    const nested = readingOf("* a\n** b\n");
    const flat = readingOf("* a\n* b\n");
    expect(nested).toEqual(["marker:unordered:*", "marker:unordered:**"]);
    expect(diffSignature(nested, flat)).toBe(
      "[marker:unordered:**] -> [marker:unordered:*]",
    );
  });

  // A byte-order mark is SKIPPED rather than cut out
  // (src/parse/lines/split.ts), so the first line's source offset is
  // the mark's width. A projection walking from zero missed that key,
  // the whole first line fell through to `opaque`, and the reading
  // came back empty - which is a PASS on both sides. The first row is
  // the corpus's own BOM fixture
  // (test/fixtures/file-with-utf8-bom.adoc), spelled in escapes to
  // keep this file ASCII.
  test.each([
    ["the corpus fixture", "\u{FEFF}= \u{4EBA}\n", ["section:0"]],
    [
      "a marked document with a body",
      "\u{FEFF}= T\n\npara\n",
      ["section:0", "text"],
    ],
  ])(
    "a byte-order mark does not hide the first line (%s)",
    (_name, source, expected) => {
      expect(readingOf(source)).toEqual(expected);
    },
  );

  // An attribute entry's NAME folds to lowercase because the printer
  // spells it lowercase (tests/format/attribute-entry.test.ts), and
  // both `!` spellings mean the same fact.
  test.each([
    [":Foo: bar\n", ["attrentry:foo"]],
    [":foo: bar\n", ["attrentry:foo"]],
    [":foo!:\n", ["attrentry:foo!"]],
    [":!foo:\n", ["attrentry:foo!"]],
  ])("attribute entry %j reads as %j", (source, expected) => {
    expect(readingOf(source)).toEqual(expected);
  });

  // EVERY lone `+` projects to `cont`, whatever the reader made of
  // it. Two of these three used to project to nothing at all: the one
  // the extent scan consumes never reaches `classifyLine`, and the one
  // the reader ERASES comes back as a blank. Both were invisible, so a
  // formatter that deleted the `+` moved no token and the invariant
  // held vacuously - which is why `lone-plus-join` could sit in the
  // family enumeration for months with no rows in it.
  test.each([
    ["a + between blocks", "para\n\n+\n\npara\n", 1],
    ["a + the extent scan consumes", "* a\n+\npara\n", 1],
    ["a + run the reader erases", "* a\n+\n+\n\npara\n", 2],
  ])("%s projects to a cont", (_name, source, expected) => {
    const conts = readingOf(source).filter((token) => token === "cont");
    expect(conts).toHaveLength(expected);
  });

  // `textv` is the verbatim-flagged foreign marker line. Its COLUMN
  // decides what the next `+` means, so it must NOT fold onto `text`:
  // its disappearance has to move the sequence.
  //
  // The `cont` in the middle is the `+` itself, and it is what the
  // reader ERASED: before every lone `+` projected to a token, this
  // document read with the `+` missing altogether, which is exactly
  // the blindness the token was added to end.
  test("a foreign marker line inside a +-attached paragraph stays textv", () => {
    expect(readingOf("* a\nX\n// c\n+\npara\n** b\n")).toEqual([
      "marker:unordered:*",
      "raw:comment",
      "cont",
      "text",
      "textv",
    ]);
  });
});

describe("the reflow-invariance rules", () => {
  // A paragraph is ONE reading however many lines it wraps to
  // (tests/format/reflow.test.ts).
  test("consecutive text lines collapse to one token", () => {
    expect(readingOf("a\nb\nc\n")).toEqual(["text"]);
  });

  // `* a` / `X` formatting to `* a X` is ordinary reflow
  // (tests/format/unordered-list.test.ts).
  test("a marker line absorbs the text run after it", () => {
    expect(readingOf("* a\nX\nY\n")).toEqual(["marker:unordered:*"]);
  });

  // The reader deletes comment lines, so a comment interrupts no join
  // (tests/format/comment.test.ts). The comment itself still shows.
  test("the fold survives a comment line", () => {
    expect(readingOf("* a\n// c\nX\n")).toEqual([
      "marker:unordered:*",
      "raw:comment",
    ]);
  });

  // A blank ends every fold: the text after it opens a run of its own.
  test("a blank line ends the fold", () => {
    expect(readingOf("* a\n\nX\n")).toEqual(["marker:unordered:*", "text"]);
  });

  // A literal paragraph's body is one reading however many lines it
  // spans (tests/format/literal-paragraph.test.ts). The reader hands
  // back `indented` for the line that STARTS it and reads the rest as
  // the text run that folds to one token, so a three-line body is two
  // tokens whether it is three lines or thirty.
  test("a literal paragraph's body is one reading", () => {
    expect(readingOf("  lit\n  lit2\n  lit3\n")).toEqual(["indented", "text"]);
  });

  // The `indented` collapse is gated on the fold MODE rather than on
  // the trailing token, so a blank line ends it - otherwise deleting a
  // whole literal paragraph next to another one moved nothing.
  test("a blank between two literal paragraphs keeps them two tokens", () => {
    expect(readingOf("  lit\n\n  lit2\n")).toEqual(["indented", "indented"]);
  });

  // The measured shape: four blocks against three, with the second
  // literal paragraph deleted.
  test("deleting one of two adjacent literal paragraphs moves the sequence", () => {
    const four = readingOf("para\n\n  lit one\n\n  lit two\n\npara\n");
    const three = readingOf("para\n\n  lit one\n\npara\n");
    expect(four).toEqual(["text", "indented", "indented", "text"]);
    expect(diffSignature(four, three)).toBe("[indented] -> []");
  });

  // The printer respells a fence as `[source,...]` + `----`
  // (tests/format/fenced-code.test.ts), so the source side is
  // projected to what the output will read.
  test("a fence canonicalizes to the attrline/listing pair", () => {
    expect(readingOf("```rust\ncode\n```\n")).toEqual([
      "attrline",
      "delim:listing",
    ]);
  });

  // The synthesized `attrline` is the FENCE'S OWN. The printer emits
  // one whatever precedes the fence - `[role]` keeps its line and the
  // `[source,...]` goes below it - so an attrline already present is a
  // second token on both sides. A positional dedup here reported the
  // ordinary `[role]` document below as a violation.
  test.each([
    ["a metadata line before a fence", "[role]\n```rust\ncode\n```\n"],
    [
      "an attrline that already names the style",
      "[source,rust]\n```\ncode\n```\n",
    ],
  ])("%s keeps both attrlines", (_name, source) => {
    expect(readingOf(source)).toEqual([
      "attrline",
      "attrline",
      "delim:listing",
    ]);
  });

  // Marker synthesis is a modeled guess for lines the extent scan
  // consumed without classifying. Inside a verbatim interior the same
  // guess is made on both sides of a comparison, so it CANCELS: what
  // matters is that the two readings agree, not that the guess is
  // right.
  test("marker synthesis inside a verbatim interior cancels", () => {
    const inside = "----\n* a\n----\n";
    expect(readingOf(inside)).toEqual(["delim:listing", "marker:unordered:*"]);
    expect(diffSignature(readingOf(inside), readingOf(inside))).toBe("");
  });
});

describe("diffSignature", () => {
  test("equal readings produce no signature", () => {
    expect(diffSignature(["a", "b"], ["a", "b"])).toBe("");
  });

  // Localization is half the point of sequence equality: the common
  // prefix and suffix are stripped so a violation names the tokens
  // that actually moved.
  test("the common prefix and suffix are stripped", () => {
    expect(diffSignature(["x", "cont", "y"], ["x", "y"])).toBe("[cont] -> []");
  });

  test("an empty side prints as empty brackets", () => {
    expect(diffSignature([], ["text"])).toBe("[] -> [text]");
  });
});

describe("a breach says where", () => {
  // The tokens that moved are enough to read a six-line sweep
  // document and not enough to find the spot in a corpus document of
  // several hundred lines, so the breach carries the line the two
  // readings part company on. Hand-written pairs, so this holds
  // whether or not the formatter still produces them.
  test("the line is the earlier document's", () => {
    expect(
      readingBreaches(
        "para\n\n+\n\npara\n",
        "para\n\npara\n",
        "para\n\npara\n",
      ),
    ).toEqual([{ pass: "p1", signature: "[cont] -> []", line: 3 }]);
  });

  // When the later reading GREW a token, the earlier reading has run
  // out at the divergence and the line is the later document's.
  test("a token that appears is located in the later document", () => {
    expect(readingBreaches("para\n", "para\n\n* a\n", "para\n\n* a\n")).toEqual(
      [{ pass: "p1", signature: "[] -> [marker:unordered:*]", line: 3 }],
    );
  });

  // The second pass compares the once- and twice-formatted texts, so
  // its line is the once-formatted output's.
  test("a second-pass breach is located in the once-formatted output", () => {
    const once = "para\n\n+\n\npara\n";
    expect(readingBreaches(once, once, "para\n\npara\n")).toEqual([
      { pass: "p2", signature: "[cont] -> []", line: 3 },
    ]);
  });
});

describe("the trace-fidelity self-check", () => {
  // Every line of an ordinary document leaves a verdict.
  test("reports nothing on a fully classified document", () => {
    expect(untracedLines("= T\n\npara\n\n* a\n** b\n")).toEqual([]);
  });

  // The lines the list extent scan takes directly - a sibling or
  // nested marker, and a lone `+` - are accounted for without a
  // verdict.
  test("a marker and a lone + taken by the extent scan are accounted for", () => {
    expect(untracedLines("* a\n** b\n\n+\npara\n")).toEqual([]);
  });

  // The stated bound: a delimited interior and a literal body are
  // legitimately unclassified, and telling them apart from an
  // under-traced line needs a second reader dialect. Documents that
  // contain either report nothing at all.
  test.each(["----\nnot classified\n----\n", "  lit\n  body\n"])(
    "%j is outside the check's bound",
    (source) => {
      expect(untracedLines(source)).toEqual([]);
    },
  );
});

describe("the known-issue table, projection side", () => {
  // Each row is a PAIR of spellings: the reading the source has, and
  // the reading the corrupted output would have. The signature is
  // what the net reports when a formatter produces the second from
  // the first - measured here without formatting anything, so the
  // rows stay meaningful when a fix makes the corruption stop
  // reproducing.
  test.each([
    [
      "#43: a lone + joined with the term line after it manufactures a dlist",
      "+\nterm2:: def2\n",
      "+ term2:: def2\n",
      "[cont text] -> [dlist:::]",
    ],
    [
      "#45: the admonition label's surplus whitespace re-reads as a colon run",
      "NOTE:  : text\n",
      "NOTE:: : text\n",
      "[admon:NOTE text] -> [dlist:::]",
    ],
    [
      "#46 shape 1: an anchor that swallows the section title after it",
      "[[3-bad]]\n\n== S\n",
      "[[3-bad]] == S\n",
      "[section:1] -> []",
    ],
    [
      "#27: a reflowed line whose indentation starts a literal paragraph",
      "class Dog\n  def initialize breed\n  end\nend\n",
      "class Dog\n\n  def initialize breed\n\nend\n",
      "[] -> [indented text]",
    ],
    // Two #65 rows stood here, both pairing an item whose second
    // block's anchor was read as that block's metadata against the
    // joined spelling it produced. The anchor now ends any block
    // after the item's first, so the two spellings read ALIKE and
    // the pair has no signature left to assert. The shapes are kept
    // as clean-reading rows in tests/format/reading-invariant.test.ts.
  ])("%s", (_name, clean, corrupted, signature) => {
    expect(diffSignature(readingOf(clean), readingOf(corrupted))).toBe(
      signature,
    );
    // The other direction: each spelling is compatible with itself, so
    // the signature above is the pair's doing and not projection noise.
    expect(diffSignature(readingOf(clean), readingOf(clean))).toBe("");
    expect(diffSignature(readingOf(corrupted), readingOf(corrupted))).toBe("");
  });
});
