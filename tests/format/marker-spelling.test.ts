/**
 * Marker spellings are DATA: the classifier's parse travels on
 * `ListNode.marker` and the printer replays it — `-` stays `-`, and a
 * tab-gapped `**` keeps its depth (issue #42). The third describe
 * pins the shape the replay does NOT make impossible: two lists the
 * author genuinely wrote with the SAME marker can still nest, because
 * an item's read runs through an indented literal and its metadata,
 * and such a pair must print ADJACENT or the re-read turns it into
 * siblings. The gP names in row comments are opaque probe ids.
 */
import { describe, expect, test } from "vitest";
import { formatAdoc, renderedHtml } from "../helpers.js";

describe("g3-nesting-fidelity: the oracle reads the output nested where it read the input nested", () => {
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
    expect(renderedHtml(out)).toBe(renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});

describe("g3-marker-spelling: author spellings replay render-neutrally", () => {
  test.each([
    ["gP9 dash list", "- a\n- b\n", "- a\n- b\n"],
    ["star list", "* a\n* b\n", "* a\n* b\n"],
    ["ordered list", ". a\n. b\n", ". a\n. b\n"],
    ["star nesting", "* a\n** b\n", "* a\n** b\n"],
    ["deep ordered nesting", ". a\n.. b\n... c\n", ". a\n.. b\n... c\n"],
    ["callout control", "<1> a\n<2> b\n", "<1> a\n<2> b\n"],
  ])("%s round-trips byte for byte", async (_name, input, expected) => {
    const out = await formatAdoc(input);
    expect(out).toBe(expected);
    expect(renderedHtml(out)).toBe(renderedHtml(input));
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
    expect(renderedHtml(out)).toBe(renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  // The arm replays only a LIVE `+` gap; any other gap — here a
  // blank — is dropped so the nested reading survives the re-read.
  // The dropped-blank spelling is the recorded sibling-fidelity loss
  // (the oracle reads the INPUT as two siblings), so there is no
  // render assert: this row pins bytes and idempotence only.
  test("a blank gap before the same-marker twin is dropped", async () => {
    const out = await formatAdoc("* a\n\n  lit\n[[anc]]\n\n* a\n");
    expect(out).toBe("* a\n\n  lit\n[[anc]]\n* a\n");
    expect(await formatAdoc(out)).toBe(out);
  });
});
