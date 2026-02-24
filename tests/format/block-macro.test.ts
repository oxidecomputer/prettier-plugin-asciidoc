import { describe, test, expect } from "vitest";
import { formatAdoc } from "../helpers.js";

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
