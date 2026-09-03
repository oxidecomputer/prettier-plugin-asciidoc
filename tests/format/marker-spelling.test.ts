/**
 * Marker spellings are DATA: the classifier's parse travels on
 * `ListItemNode.markerSpelling` and the printer replays it: `-`
 * stays `-`, a tab-gapped `**` keeps its depth (issue #42), and an
 * explicit ordered marker keeps the number the ORACLE reads its
 * `start` from (issue #12; `resolveOrderedListStart`,
 * `@asciidoctor/core` 4.0.11 `build/node/index.cjs` l.13396 - Ruby
 * 2.0.26 emits no `start` there, see the divergence note in
 * tests/format/explicit-ordered-list.test.ts). A CALLOUT item is the
 * one exception, printing from its parsed number rather than its
 * spelling; the "callout control" row pins that. What NESTS is a
 * separate field, `ListNode.marker`, which carries the style the
 * spelling resolves to. The gP names in row comments are opaque
 * probe ids.
 *
 * The describes are named for what they pin, and each names the rule
 * it belongs to rather than its neighbours' positions:
 *
 * - "a nested list that SHARES its parent's marker prints adjacent"
 *   is the shape the replay does not make impossible: two lists the
 *   author genuinely wrote with the same marker can still nest,
 *   because an item's read runs through an indented literal and its
 *   metadata, and such a pair must print ADJACENT or the re-read
 *   turns it into siblings.
 * - "a sibling boundary the re-read would swallow gets its blank"
 *   reads that same fact backwards: where the read runs that far, two
 *   SIBLINGS are spelled with a blank between them, and the printer
 *   DERIVES that blank from its own output lines rather than
 *   replaying what the author typed - so the rows run both ways,
 *   boundaries that gain a blank and boundaries that stay adjacent.
 * - "a slurp that stays inside the item needs no blank" is the OTHER
 *   rule, and the one that keeps the two from being one describe: it
 *   is about the gap between an item's own BLOCKS, where a slurp
 *   swallows only the item's own lines and no blank may be invented
 *   (`printedGap`, src/print/list.ts). The describe above it is about
 *   the boundary BETWEEN items, where a slurp reaches somebody else's
 *   marker line and a blank must be (`tailSwallowsMarker`).
 * - "the boundary survives a non-LF line terminator" is the boundary
 *   rule under the two non-LF spellings a document can ask for; the
 *   probe renders its lines at LF, so the spelling must not change
 *   the verdict.
 */
import { describe, expect, test } from "vitest";
import { formatAdoc, renderedHtml } from "../helpers.js";

describe("nesting-fidelity: the oracle reads the output nested where it read the input nested", () => {
  // Corruption fixes — proof: head output vs the ORIGINAL INPUT (the
  // base flattened all four).
  test.each([
    ["gP8 dash parent, star child", "- Foo\n* Boo\n", "- Foo\n* Boo\n"],
    [
      "gP37 depth chain",
      "- parent\n* child\n** grandchild\n",
      "- parent\n* child\n** grandchild\n",
    ],
    ["gP10 tab-gapped nesting (#42)", "* a\n**\tb\n", "* a\n** b\n"],
    [
      "gP38 tab-gapped chain (#42)",
      "* a\n**\tb\n***\tc\n",
      "* a\n** b\n*** c\n",
    ],
  ])("%s", async (_name, input, expected) => {
    const out = await formatAdoc(input);
    expect(out).toBe(expected);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});

describe("marker-spelling: author spellings replay render-neutrally", () => {
  test.each([
    ["gP9 dash list", "- a\n- b\n", "- a\n- b\n"],
    ["star list", "* a\n* b\n", "* a\n* b\n"],
    ["ordered list", ". a\n. b\n", ". a\n. b\n"],
    ["star nesting", "* a\n** b\n", "* a\n** b\n"],
    ["deep ordered nesting", ". a\n.. b\n... c\n", ". a\n.. b\n... c\n"],
    ["callout control", "<1> a\n<2> b\n", "<1> a\n<2> b\n"],
    // An explicit ordered list is the one shape whose items do NOT
    // share a spelling: `5.` and `6.` resolve to the same style
    // (`1.`), so they are one list, and each replays its own bytes.
    // Rewriting either to the style would move the rendered `start`.
    ["explicit arabic", "1. a\n2. b\n", "1. a\n2. b\n"],
    ["explicit arabic off 1", "5. a\n6. b\n", "5. a\n6. b\n"],
    ["explicit loweralpha", "a. a\nb. b\n", "a. a\nb. b\n"],
    ["explicit upperalpha", "A. a\nB. b\n", "A. a\nB. b\n"],
    ["explicit lowerroman", "i) a\nii) b\n", "i) a\nii) b\n"],
    ["explicit upperroman", "I) a\nII) b\n", "I) a\nII) b\n"],
  ])("%s round-trips byte for byte", async (_name, input, expected) => {
    const out = await formatAdoc(input);
    expect(out).toBe(expected);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});

describe("a nested list that SHARES its parent's marker prints adjacent", () => {
  // Not a marker collision the printer invented — the oracle reads
  // these nested: an item's read runs THROUGH the indented literal and
  // the metadata behind it, so the second marker line lands inside the
  // item however it is spelled. A blank in front of it would read back
  // as a sibling boundary, and the sibling probe would then eat the
  // blank, so pass two would print different bytes.
  test.each([
    ["star inside star, behind an anchor", "* a\n\n  lit\n[[anc]]\n* a\n"],
    [
      "star inside star, behind a comment",
      "* a\n\n  lit\n[[anc]]\n// c\n* a\n",
    ],
    [
      "star inside star, behind an attrlist",
      "* a\n\n  lit\n* a\n[role]\n* a\n",
    ],
    ["double star inside double star", "* a\n** b\n+\n  lit\n[[anc]]\n** b\n"],
    // Callout lists share ONE recorded spelling (the `<>` sentinel),
    // so a callout pair nests under the same rule as the others.
    ["callout inside callout", "<1> a\n\n  lit\n[[anc]]\n<2> b\n"],
  ])("%s", async (_name, input) => {
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});

describe("a sibling boundary the re-read would swallow gets its blank", () => {
  // The mirror image of the describe above, and the same Ruby fact
  // read the other way (`read_lines_for_list_item`,
  // parser.rb l.1404-1592): a marker line ends the previous item only
  // if the reader's loop SEES it (:1430, :1519), and a literal's slurp
  // (:1488, :1539) hands it lines the loop never sees. Where the
  // previous item's tail slurps that far, "sibling" is spelled with a
  // blank line — so the printer writes one. These inputs are the
  // oracle's TWO SIBLINGS; the row that used to stand here pinned the
  // byte-for-byte corruption (issue #52), where the printed adjacency
  // re-read as parent-and-child.
  test.each([
    ["metadata behind the literal (#52)", "* a\n\n  lit\n[[anc]]\n\n* a\n"],
    ["an attrlist behind the literal", "* a\n\n  lit\n[role]\n\n* b\n"],
    [
      "a comment and an anchor behind it",
      "* a\n\n  lit\n[[anc]]\n// c\n\n* b\n",
    ],
    [
      "a delimited block behind the literal",
      "* a\n\n  lit\n----\nx\n----\n\n* b\n",
    ],
    [
      "an adjacent same-marker twin between the literal and the boundary",
      "* a\n\n  lit\n[[anc]]\n* a\n\n* c\n",
    ],
    [
      "the literal at the tail of a nested chain",
      "* a\n** b\n*** c\n\n    lit\n[[anc]]\n\n* d\n",
    ],
    [
      "a boundary between two NESTED siblings",
      "* a\n** b\n\n   lit\n[[anc]]\n\n** c\n",
    ],
    ["an ordered list", ". a\n\n  lit\n[[anc]]\n\n. b\n"],
    ["a callout list", "<1> a\n\n  lit\n[[anc]]\n\n<2> b\n"],
    ["a dash list", "- a\n\n  lit\n[[anc]]\n\n- b\n"],
    ["a checklist", "* [x] a\n\n  lit\n[[anc]]\n\n* [ ] b\n"],
    [
      "both boundaries of a three-item list",
      "* a\n\n  lit\n[[anc]]\n\n* b\n\n  lit2\n[[anc2]]\n\n* c\n",
    ],
    // A metadata line does not end a LIVE continuation (parser.rb
    // :1499), so the literal behind one still slurps and the blank is
    // still load-bearing — which is why the walk cannot ask whether
    // the literal's own gap is empty.
    [
      "a literal behind metadata under a live `+`",
      "* a\n+\n[role]\n  lit\n\n* b\n",
    ],
    // The slurp reaches the boundary from further in: through the
    // metadata AND the nested marker behind the literal, and out of a
    // nested item's own tail. Where the author already spelled the
    // blank, the derivation writes the same one back.
    [
      "lit, an attrlist, a nested marker, then a sibling",
      "* a\n\n  lit\n[role]\n** b\n\n* a\n",
    ],
    [
      "lit, metadata, an attached paragraph, then a sibling",
      "* a\n\n  lit\n[[anc]]\npara\n\n* a\n",
    ],
    [
      "a literal ending a nested item, then a sibling",
      "* a\n\n** b\n\n  lit\n\n* a\n",
    ],
  ])("%s", async (_name, input) => {
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  // DERIVED, not replayed: the printer decides the blank from the tree
  // it holds, so an authored blank RUN comes back as the one blank the
  // boundary needs.
  test("a blank run at a swallowing boundary prints as one blank", async () => {
    const input = "* a\n\n  lit\n[[anc]]\n\n\n* b\n";
    const out = await formatAdoc(input);
    expect(out).toBe("* a\n\n  lit\n[[anc]]\n\n* b\n");
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  // An indented line reached by neither a blank nor a live `+` opens
  // no literal at all: the reader's loop takes it through the final
  // else (parser.rb l.1560-69), so nothing is slurping when the item
  // ends and the sibling needs no blank.
  test("an indented line the loop reads as text swallows nothing", async () => {
    const input = "* a\n[role]\n  lit\n[[anc]]\n* b\n";
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  // The other direction, and the negative controls: where the tail is
  // harmless the boundary stays ADJACENT, whatever the author typed.
  // A blank invented here would be noise at best — and after a `+`
  // it would erase the continuation.
  test.each([
    ["plain siblings", "* a\n\n* b\n", "* a\n* b\n"],
    [
      "a literal cut off by a `+` gap",
      "* a\n\n  lit\n+\npara\n\n* b\n",
      "* a\n\n  lit\n+\npara\n* b\n",
    ],
    [
      "a literal behind an authored blank",
      "* a\n\n  lit\n\n** b\n\n* c\n",
      "* a\n\n  lit\n\n** b\n* c\n",
    ],
    [
      "a nested list of its own spelling",
      "* a\n** b\n\n* c\n",
      "* a\n** b\n* c\n",
    ],
    [
      "metadata behind a `+`-attached block",
      "* a\n+\n----\nx\n----\n[[anc]]\n\n* b\n",
      "* a\n+\n----\nx\n----\n[[anc]]\n* b\n",
    ],
    // The `+` an author left between a slurped literal and the next
    // marker is not a no-op: the literal's re-read carries it into the
    // `<pre>`. It is printed back, and the boundary takes no blank —
    // the `+` already stops the slurp, and a blank would put a line
    // between the tail and the `+` the source never had.
    [
      "an item ending on a trailing continuation",
      "* a\n\n  lit\n+\n* b\n",
      "* a\n\n  lit\n+\n* b\n",
    ],
  ])("%s stays adjacent", async (_name, input, expected) => {
    const out = await formatAdoc(input);
    expect(out).toBe(expected);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});

// The other half of the same rule: a slurp that runs INSIDE an item
// takes the item's own lines into the item's own buffer, which is
// re-parsed from those same lines and gives the same blocks back. So
// nothing is invented in front of them — a blank written here would
// end the item at the blank instead, detaching everything behind it
// and changing what the document says. Every one of these documents
// is its own output.
describe("a slurp that stays inside the item needs no blank", () => {
  test.each([
    ["metadata, then a nested marker", "* a\n\n  lit\n[[anc]]\n** b\n* a\n"],
    ["an attrlist, then a nested marker", "* a\n\n  lit\n[role]\n** b\n* a\n"],
    [
      "a nested item's literal, then metadata",
      "* a\n** b\n\n  lit\n[[anc]]\n* a\n",
    ],
    [
      "a nested item's literal, then an attrlist",
      "* a\n** b\n\n  lit\n[role]\n* a\n",
    ],
    [
      "a nested item's `+` literal, then metadata",
      "* a\n** b\n+\n  lit\n[[anc]]\n* a\n",
    ],
    [
      "a nested item's `+` literal, then an attrlist",
      "* a\n** b\n+\n  lit\n[role]\n* a\n",
    ],
    [
      "a `+` literal, metadata, then a nested marker",
      "* a\n+\n  lit\n[[anc]]\n** b\n* a\n",
    ],
    [
      "a `+` literal, an attrlist, then a nested marker",
      "* a\n+\n  lit\n[role]\n** b\n* a\n",
    ],
    // Longer than the sweep's product spells, and the shape the issue
    // was filed on: the slurp crosses metadata AND a paragraph before
    // it reaches the marker.
    [
      "a `+` literal, metadata, a paragraph, then a marker",
      "* a\n** b\n+\n  lit\n[[anc]]\npara\n* a\n",
    ],
  ])("%s", async (_name, input) => {
    const once = await formatAdoc(input);
    expect(once).toBe(input);
    expect(await renderedHtml(once)).toBe(await renderedHtml(input));
    expect(await formatAdoc(once)).toBe(once);
  });
});

// The boundary rule reads the printer's OWN OUTPUT LINES, and a
// document's line TERMINATOR is not part of any of them. Read at the
// document's own terminator the rule fails OPEN in two different
// spellings: under `crlf` every line carries a trailing `\r`, and
// under `cr` the output holds no `\n` at all, so the whole item
// arrives as ONE line. Either way no blank, no `+` and no delimiter
// is ever seen, no slurp is seen to start or stop, and every boundary
// blank is dropped - which the oracle, whose reader rewrites both
// spellings to `\n` before it splits, reads as the marker swallowed.
// The probe renders at `lf` instead (`printedLines`,
// src/print/list.ts), so all three terminators get the same answer.
//
// The output is normalized before ANY comparison, on both sides.
// That is issue #68: the oracle treats a bare `\r` as a line break
// and our own reader treats it as trailing whitespace, so a `cr`
// output fed back unnormalized is one line to us and seven to the
// oracle, and neither the render nor the fixed point would be asking
// about the same document.
describe("the boundary survives a non-LF line terminator", () => {
  const shapes: ReadonlyArray<readonly [string, string]> = [
    [
      "lit, [role], nested marker, then a sibling",
      "* a\n\n  lit\n[role]\n** b\n\n* a\n",
    ],
    [
      "lit, metadata, an attached paragraph, then a sibling",
      "* a\n\n  lit\n[[anc]]\npara\n\n* a\n",
    ],
    [
      "a literal ending a nested item, then a sibling",
      "* a\n\n** b\n\n  lit\n\n* a\n",
    ],
  ];
  const terminators: ReadonlyArray<readonly ["crlf" | "cr", string]> = [
    ["crlf", "\r\n"],
    ["cr", "\r"],
  ];
  test.each(
    terminators.flatMap(([endOfLine, terminator]) =>
      shapes.map(
        ([name, input]) =>
          [`${endOfLine}: ${name}`, input, endOfLine, terminator] as const,
      ),
    ),
  )("%s", async (_name, input, endOfLine, terminator) => {
    const out = await formatAdoc(input, { endOfLine });
    const normalized = out.replaceAll(terminator, "\n");
    // The bytes are the LF output with these terminators - blank line
    // and all - so the boundary held.
    expect(normalized).toBe(input);
    expect(await renderedHtml(normalized)).toBe(await renderedHtml(input));
  });

  // A crlf output re-fed at crlf is a byte-level fixed point. A cr
  // output gets no such row: our reader does not split on bare `\r`
  // (issue #68), so re-reading one would be asking about a different
  // document.
  test.each(shapes)(
    "crlf: %s is a byte-level fixed point",
    async (_name, input) => {
      const out = await formatAdoc(input, { endOfLine: "crlf" });
      expect(await formatAdoc(out, { endOfLine: "crlf" })).toBe(out);
    },
  );
});
