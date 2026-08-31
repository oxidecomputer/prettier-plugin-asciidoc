/**
 * Reflow tests for inline macros under width pressure - split out of
 * reflow.test.ts to keep that file under the 450-line cap. Verifies
 * that image, kbd, btn, menu, footnote, pass, icon, and stem macros
 * are atomic units in fill()'s line-breaking: they are placed whole
 * on a line or wrapped to the next one, never split internally.
 */
import { describe, test, expect } from "vitest";
import { formatAdoc } from "../helpers.js";

describe("inline macro reflow", () => {
  // "See " (4) + "image:diagram.png[Architecture]" (31) = 35 > 30.
  // fill() breaks before the image macro, placing it on its own
  // line. "for the full" (12) fits on the next line, "picture."
  // wraps to a fourth line.
  test("inline image wraps at printWidth", async () => {
    const input = "See image:diagram.png[Architecture] for the full picture.\n";
    const result = await formatAdoc(input, { printWidth: 30 });
    expect(result).toBe(
      "See\nimage:diagram.png[Architecture]\nfor the full picture.\n",
    );
  });

  // "Press " (6) + "kbd:[Ctrl+Shift+T]" (18) = 24 < 30. Fits.
  // "to reopen the" (13) fits on the next line, "closed tab."
  // on a third.
  test("kbd macro wraps at printWidth", async () => {
    const input = "Press kbd:[Ctrl+Shift+T] to reopen the closed tab.\n";
    const result = await formatAdoc(input, { printWidth: 30 });
    expect(result).toBe(
      "Press kbd:[Ctrl+Shift+T] to\nreopen the closed tab.\n",
    );
  });

  // "Click " (6) + "btn:[OK]," (9) = 15. "then" (4) = 20.
  // "btn:[Apply]" (11) = 32 > 30. Wraps before btn:[Apply].
  // "to save changes." fits on a third line.
  test("btn macro wraps at printWidth", async () => {
    const input = "Click btn:[OK], then btn:[Apply] to save changes.\n";
    const result = await formatAdoc(input, { printWidth: 30 });
    expect(result).toBe("Click btn:[OK], then\nbtn:[Apply] to save changes.\n");
  });

  // "Navigate to " (12) + "menu:File[Export]" (16) = 28 < 30.
  // Fits on one line. "and select" (10) = 39 > 30. Wraps after
  // the macro. "the format." fits on the third line.
  test("menu macro wraps at printWidth", async () => {
    const input = "Navigate to menu:File[Export] and select the format.\n";
    const result = await formatAdoc(input, { printWidth: 30 });
    expect(result).toBe(
      "Navigate to menu:File[Export]\nand select the format.\n",
    );
  });

  // Footnote is glued to preceding word (no space before
  // "footnote:"). The unit "importantfootnote:[See the
  // reference guide.]" (49 chars) exceeds printWidth=40 but
  // is atomic - it cannot break. "and more text" fits after.
  test("footnote macro wraps at printWidth", async () => {
    const input =
      "This is importantfootnote:[See the reference guide.] and more text follows here.\n";
    const result = await formatAdoc(input, { printWidth: 40 });
    expect(result).toBe(
      "This is\nimportantfootnote:[See the reference guide.]\nand more text follows here.\n",
    );
  });

  // "Use " (4) + "pass:[<code>raw</code>]" (23) = 27 < 30.
  // "for inline" (10) = 38 > 30. Wraps after macro.
  test("pass macro wraps at printWidth", async () => {
    const input = "Use pass:[<code>raw</code>] for inline HTML content.\n";
    const result = await formatAdoc(input, { printWidth: 30 });
    expect(result).toBe(
      "Use pass:[<code>raw</code>]\nfor inline HTML content.\n",
    );
  });

  // `icon:heart[]` has no internal whitespace, so it cannot prove
  // atomicity - the wrap point is the same whether the token is
  // atomic or not. `title="Big Heart"` does have a space (a real
  // attrlist the oracle accepts: `icon:heart[title="Big Heart"]`
  // renders `<i class="fa fa-heart" title="Big Heart">` under
  // `icons=font`, confirmed against the pinned oracle), so this
  // case can tell the two readings apart.
  //
  // "See" (3) + " the" (4) + " icon:heart[title=\"Big Heart\"]"
  // (30, the 29-char macro plus its leading space) = 37 > 30, so
  // fill() wraps BEFORE the whole macro rather than splitting it at
  // the space inside the title - the macro stands whole on its own
  // line. Were the macro not atomic, fill() would read
  // `icon:heart[title="Big` (21) and `Heart"]` (7) as two separate
  // words: "See the icon:heart[title=\"Big" (29) fits under 30, so
  // fill() would break AFTER "Big" instead, landing
  // `Heart"]` on its own line - a line break inside the attrlist,
  // exactly the corruption this test guards against.
  test("icon macro with a spaced attrlist does not wrap internally", async () => {
    const input = 'See the icon:heart[title="Big Heart"] design now.\n';
    const result = await formatAdoc(input, { printWidth: 30 });
    expect(result).toBe(
      'See the\nicon:heart[title="Big Heart"]\ndesign now.\n',
    );
  });

  // "Given the equation" (19) + " stem:[x < y]" (13) = 32 > 30, so
  // fill() wraps BEFORE the macro rather than splitting it at the
  // space inside `x < y` - the space stays inert because the whole
  // bracketed expression is one atomic token, not two words. If the
  // macro were not atomic, fill() would have room to break after
  // `x <` (29 chars) instead, which is exactly the corruption this
  // test guards against.
  test("stem macro does not wrap internally under width pressure", async () => {
    const input = "Given the equation stem:[x < y] we conclude the proof.\n";
    const result = await formatAdoc(input, { printWidth: 30 });
    // `stem:[x < y]` stands whole on the second line - never split
    // into a fragment like "stem:[x <" at the space inside it.
    expect(result).toBe(
      "Given the equation\nstem:[x < y] we conclude the\nproof.\n",
    );
  });

  // Multiple macros in one paragraph: each is an atomic unit.
  // fill() packs greedily within printWidth=40.
  test("multiple inline macros wrap correctly", async () => {
    const input =
      "Press kbd:[Ctrl+S] to save, then click btn:[OK] and check image:status.png[Status] for confirmation.\n";
    const result = await formatAdoc(input, { printWidth: 40 });
    expect(result).toBe(
      "Press kbd:[Ctrl+S] to save, then click\nbtn:[OK] and check\nimage:status.png[Status] for\nconfirmation.\n",
    );
  });
});
