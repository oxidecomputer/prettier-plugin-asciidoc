import { describe, test, expect } from "vitest";
import { expectFormatted, formatAdoc } from "../helpers.js";

describe("block macro formatting", () => {
  // image block macro preserved as-is.
  test("image block macro preserved", async () => {
    const input = "image::sunset.jpg[Sunset]\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // video block macro preserved.
  test("video block macro preserved", async () => {
    const input = "video::video.mp4[]\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // audio block macro preserved.
  test("audio block macro preserved", async () => {
    const input = "audio::podcast.wav[]\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // toc block macro preserved.
  test("toc block macro preserved", async () => {
    const input = "toc::[]\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Block macro between paragraphs has blank line
  // separation.
  test("block macro between paragraphs", async () => {
    const input = "Before.\n\nimage::photo.png[Photo]\n\nAfter.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Block macro with complex attributes preserved.
  test("block macro with complex attributes", async () => {
    const input = 'image::diagram.svg[Architecture,width=600,opts="inline"]\n';
    expect(await formatAdoc(input)).toBe(input);
  });
});

describe("block macro edge cases", () => {
  // A trailing `]` after the block macro's `[]` is not part
  // of the macro — it's a separate paragraph character.
  test("trailing ] after block macro is preserved", async () => {
    const input = "image::A[]]\n";
    expect(await formatAdoc(input)).toBe("image::A[]]\n");
  });
});

// Issue #183: an UNREGISTERED block macro name is paragraph text to
// the oracle, so the line under it never reaches a block-opening
// vocabulary (here the ATX heading spelling, #63). Before this fix
// BLOCK_MACRO accepted any `name::target[attrlist]` shape, so
// `footnote::[n]` opened a (nonexistent) macro block and the line
// below it became a block start; the ATX heading rewrote `# h#` to
// `= h#` where the oracle renders both lines as one paragraph's text.
describe("an unregistered block macro name stays paragraph text (#183)", () => {
  // Two lines, no blank line and no comment between them: the oracle
  // joins them into one paragraph (`<p>footnote::[n] # h#</p>`), and
  // reflow at the default width joins the two source lines too.
  // Before the fix: formatted to `footnote::[n]\n\n= h#\n`, a false
  // block macro followed by a promoted section title.
  test("footnote:: over an ATX-shaped line stays one paragraph", async () => {
    await expectFormatted("footnote::[n]\n# h#\n", "footnote::[n] # h#\n");
  });

  // A comment line between them keeps each line its own one-line
  // paragraph on both sides, so the fix shows up purely in the third
  // line's text, not in the paragraph shape. Before the fix: the
  // third line became `= h#`.
  test("footnote:: with a comment between still leaves the heading line alone", async () => {
    const input = "footnote::[n]\n// c\n# h#\n";
    await expectFormatted(input, input);
  });

  // Control: a REGISTERED name still opens a block macro, so the
  // line below it is still a block start and the ATX heading
  // vocabulary still normalizes it to `= h#`. This must keep passing
  // unchanged by the #183 narrowing.
  test("a registered macro name still opens a block and the heading below it still normalizes", async () => {
    await expectFormatted("image::a.png[]\n# h#\n", "image::a.png[]\n\n= h#\n");
  });
});
