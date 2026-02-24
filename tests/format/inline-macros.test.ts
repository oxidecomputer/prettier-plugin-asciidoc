/**
 * Format tests for inline macros — verifies that the printer
 * produces correct output and that these constructs round-trip
 * cleanly through the formatter.
 */
import { describe, test, expect } from "vitest";
import { formatAdoc } from "../helpers.js";

// ── Inline image ────────────────────────────────────────────

describe("inline image — format output", () => {
  test("image with alt text is preserved", async () => {
    const input = "image:sunset.jpg[Sunset]\n";
    expect(await formatAdoc(input)).toBe("image:sunset.jpg[Sunset]\n");
  });

  test("image with empty brackets is preserved", async () => {
    const input = "image:logo.png[]\n";
    expect(await formatAdoc(input)).toBe("image:logo.png[]\n");
  });

  test("image in text is preserved", async () => {
    const input = "See image:icon.svg[Icon] here.\n";
    expect(await formatAdoc(input)).toBe("See image:icon.svg[Icon] here.\n");
  });

  test("image with path target is preserved", async () => {
    const input = "image:images/photo.jpg[A photo]\n";
    expect(await formatAdoc(input)).toBe("image:images/photo.jpg[A photo]\n");
  });
});

// ── Keyboard macro ──────────────────────────────────────────

describe("kbd macro — format output", () => {
  test("kbd macro is preserved", async () => {
    const input = "kbd:[Ctrl+C]\n";
    expect(await formatAdoc(input)).toBe("kbd:[Ctrl+C]\n");
  });

  test("kbd in text is preserved", async () => {
    const input = "Press kbd:[Enter] to continue.\n";
    expect(await formatAdoc(input)).toBe("Press kbd:[Enter] to continue.\n");
  });

  test("kbd with multi-key combo is preserved", async () => {
    const input = "kbd:[Ctrl+Shift+T]\n";
    expect(await formatAdoc(input)).toBe("kbd:[Ctrl+Shift+T]\n");
  });
});

// ── Button macro ────────────────────────────────────────────

describe("btn macro — format output", () => {
  test("btn macro is preserved", async () => {
    const input = "btn:[OK]\n";
    expect(await formatAdoc(input)).toBe("btn:[OK]\n");
  });

  test("btn in text is preserved", async () => {
    const input = "Click btn:[Save] to apply.\n";
    expect(await formatAdoc(input)).toBe("Click btn:[Save] to apply.\n");
  });
});

// ── Menu macro ──────────────────────────────────────────────

describe("menu macro — format output", () => {
  test("menu macro is preserved", async () => {
    const input = "menu:File[Save]\n";
    expect(await formatAdoc(input)).toBe("menu:File[Save]\n");
  });

  test("menu in text is preserved", async () => {
    const input = "Select menu:Edit[Paste] now.\n";
    expect(await formatAdoc(input)).toBe("Select menu:Edit[Paste] now.\n");
  });

  test("menu with submenu path is preserved", async () => {
    const input = "menu:View[Zoom > Reset]\n";
    expect(await formatAdoc(input)).toBe("menu:View[Zoom > Reset]\n");
  });
});

// ── Footnote macro ──────────────────────────────────────────

describe("footnote macro — format output", () => {
  test("footnote is preserved", async () => {
    const input = "Textfootnote:[A note.]\n";
    expect(await formatAdoc(input)).toBe("Textfootnote:[A note.]\n");
  });

  test("footnoteref is preserved", async () => {
    const input = "Textfootnoteref:[fn1,A note.]\n";
    expect(await formatAdoc(input)).toBe("Textfootnoteref:[fn1,A note.]\n");
  });
});

// ── Pass macro ──────────────────────────────────────────────

describe("pass macro — format output", () => {
  test("pass macro is preserved", async () => {
    const input = "pass:[<b>bold</b>]\n";
    expect(await formatAdoc(input)).toBe("pass:[<b>bold</b>]\n");
  });

  test("pass in text is preserved", async () => {
    const input = "See pass:[<em>this</em>] here.\n";
    expect(await formatAdoc(input)).toBe("See pass:[<em>this</em>] here.\n");
  });

  test("pass with empty content is preserved", async () => {
    const input = "pass:[]\n";
    expect(await formatAdoc(input)).toBe("pass:[]\n");
  });
});
