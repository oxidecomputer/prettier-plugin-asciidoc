import { describe, test, expect } from "vitest";
import { formatAdoc } from "../helpers.js";

describe("include directive formatting", () => {
  // Basic include preserved as-is.
  test("basic include preserved", async () => {
    const input = "include::path/to/file.adoc[]\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Include with lines option preserved.
  test("include with lines option preserved", async () => {
    const input = "include::file.txt[lines=5..10]\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Include with tag option preserved.
  test("include with tag option preserved", async () => {
    const input = "include::file.txt[tag=section-name]\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Include with leveloffset preserved.
  test("include with leveloffset preserved", async () => {
    const input = "include::file.adoc[leveloffset=+1]\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Include between paragraphs has blank line separation.
  test("include between paragraphs", async () => {
    const input =
      "Before.\n\ninclude::chapter.adoc[]\n\nAfter.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Formatting is idempotent.
  test("idempotent formatting", async () => {
    const input = "include::path/to/file.adoc[]\n";
    const first = await formatAdoc(input);
    const second = await formatAdoc(first);
    expect(second).toBe(first);
  });
});
