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
 * spelling resolves to. The third describe
 * pins the shape the replay does NOT make impossible: two lists the
 * author genuinely wrote with the SAME marker can still nest, because
 * an item's read runs through an indented literal and its metadata,
 * and such a pair must print ADJACENT or the re-read turns it into
 * siblings. The fourth reads that same fact backwards: where the read
 * runs that far, two SIBLINGS need a blank between them, and the
 * printer derives it. The gP names in row comments are opaque probe
 * ids.
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
  // read the other way (`read_lines_for_list_item`, parser.rb l.1404–
  // 1592): a marker line ends the previous item only if the reader's
  // loop SEES it (:1430, :1519), and a literal's slurp (:1488, :1539)
  // hands it lines the loop never sees. Where the previous item's tail
  // slurps that far, "sibling" is spelled with a blank line — so the
  // printer writes one. These inputs are the oracle's TWO SIBLINGS;
  // the row that used to stand here pinned the byte-for-byte
  // corruption (issue #52), where the printed adjacency re-read as
  // parent-and-child.
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

  // The CONSERVATIVE side of the question, pinned as the cost it is:
  // an indented block the reader recorded as a literal but Asciidoctor
  // folds into the item's text takes a blank it does not need. Bytes
  // move, meaning does not — and the walk cannot tell the two apart
  // without deciding, per block, whether a continuation is still live.
  test("a literal the oracle folds into text still takes the blank", async () => {
    const input = "* a\n[role]\n  lit\n[[anc]]\n* b\n";
    const out = await formatAdoc(input);
    expect(out).toBe("* a\n[role]\n  lit\n[[anc]]\n\n* b\n");
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
      "a literal cut off by the printer's own blank",
      "* a\n\n  lit\n[role]\n** b\n\n* a\n",
      "* a\n\n  lit\n[role]\n\n** b\n* a\n",
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
