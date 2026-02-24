import { describe, test, expect } from "vitest";
import { formatAdoc } from "../helpers.js";

describe("conditional directive formatting", () => {
  // ifdef preserved as-is.
  test("ifdef preserved", async () => {
    const input = "ifdef::backend[]\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // ifdef with content preserved.
  test("ifdef with content preserved", async () => {
    const input = "ifdef::backend[Content here]\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // ifndef preserved.
  test("ifndef preserved", async () => {
    const input = "ifndef::attr[]\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // ifeval preserved.
  test("ifeval preserved", async () => {
    const input = "ifeval::[{version} > 1]\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // endif preserved.
  test("endif preserved", async () => {
    const input = "endif::[]\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Comma-separated attributes preserved.
  test("comma-separated attributes preserved", async () => {
    const input = "ifdef::attr1,attr2[]\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Between paragraphs with blank line separation.
  test("between paragraphs", async () => {
    const input = "Before.\n\nifdef::backend[]\n\nAfter.\n";
    expect(await formatAdoc(input)).toBe(input);
  });
});
