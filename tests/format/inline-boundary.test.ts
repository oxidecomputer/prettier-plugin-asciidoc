/**
 * The constrained-mark boundary set, mark by mark and character by
 * character, at FORMAT level - the killing table for
 * src/parse/inline/quote-boundaries.ts (issue #36).
 *
 * Every row's span-or-text expectation was measured against the
 * oracle (`@asciidoctor/core`), not imagined: the LEFT frame
 * `x{c}*b* y` makes a span exactly when `c` is outside Ruby's
 * excluded-left class for the mark (`QUOTE_SUBS`,
 * asciidoctor.rb l.448-464), and the RIGHT frame
 * `x *b*{c}y` exactly when `c` fails the right lookahead
 * `(?!\p{Word})`. The two sides are DIFFERENT sets - `;` `:` `}` are
 * excluded on the left only - and monospace adds the curved-quote
 * characters on both of its sides. `<` `>` `&` are excluded on the
 * left because `sub_specialchars` has already rewritten them to
 * entities ending in `;` when the quote pass runs.
 *
 * Each row asserts three things: the parse reads span-vs-text the way
 * the oracle renders it, the formatted bytes are pinned (every frame
 * here is a fixed point), and the output is render-equal and
 * idempotent. The agreement controls (word characters, ordinary
 * punctuation, whitespace) are in the table on purpose: they kill
 * mutants of the OTHER clause of each predicate.
 */
import { describe, expect, test } from "vitest";
import { asParagraph, formatAdoc, renderedHtml } from "../helpers.js";
import { parse } from "../../src/parser.js";
import type { InlineNode } from "../../src/ast.js";

/** The four constrained marks and the span kind each one spells. */
const MARKS = [
  ["*", "bold"],
  ["_", "italic"],
  ["`", "monospace"],
  ["#", "highlight"],
] as const;

/**
 * Whether any node in an inline tree is a span of the given kind.
 * @param nodes - inline nodes to scan
 * @param type - the span kind to look for
 * @returns true when a span of that kind appears at any depth
 */
function hasSpan(nodes: readonly InlineNode[], type: string): boolean {
  return nodes.some(
    (node) =>
      node.type === type ||
      ("children" in node && hasSpan(node.children, type)),
  );
}

/**
 * The inline nodes of a one-paragraph document.
 * @param input - the document source
 * @returns the paragraph's inline children
 */
function paragraphInline(input: string): InlineNode[] {
  const document = parse(input);
  const [block] = document.children;
  return asParagraph(block).children;
}

/**
 * Characters the oracle accepts in FRONT of every constrained mark
 * (outside the excluded-left class), and word-adjacent controls it
 * rejects. `"` and `'` sit in neither list: they are per-mark
 * (monospace excludes them, the other three do not).
 */
const LEFT_OPENS = [
  ",",
  "!",
  "?",
  ".",
  "(",
  ")",
  "[",
  "]",
  "{",
  "/",
  "-",
  "=",
  "~",
  "|",
  "@",
  "^",
  "+",
  " ",
];
// Superscript two (U+00B2) and one half (U+00BD) are `\p{No}`: word
// characters to the ORACLE's class (CC_WORD,
// `@asciidoctor/core/build/node/index.cjs` l.54, which spells it
// `\p{N}`) and not to Ruby's `\p{Word}` (`\p{Nd}`). Ordinary prose
// carries them ("m2", "1/2 cup"), and reading them Ruby's way
// destroys spans - the unconstrained rows at the end of this file.
const LEFT_STAYS_TEXT = [
  ";",
  ":",
  "}",
  "_",
  "<",
  ">",
  "&",
  "a",
  "0",
  "\u00E9",
  "\u00B2",
  "\u00BD",
];

/**
 * Characters the oracle accepts BEHIND a closing mark (they fail the
 * `(?!\p{Word})` lookahead's class), and the word characters it does
 * not. `;` `:` `}` appear in the span list deliberately: the left
 * exclusions do NOT apply on the right.
 */
const RIGHT_CLOSES = [
  ";",
  ":",
  "}",
  "&",
  "-",
  "=",
  "~",
  "|",
  "@",
  "\\",
  ",",
  ".",
  "(",
  ")",
  " ",
];
const RIGHT_STAYS_TEXT = ["a", "0", "_", "\u00E9", "\u00B2", "\u00BD"];

/**
 * One row's full verdict: parse shape, byte fixpoint, render
 * equality, idempotence.
 * @param input - the row's document
 * @param type - the span kind under test
 * @param spans - whether the oracle makes a span of that kind here
 */
async function expectRow(
  input: string,
  type: string,
  spans: boolean,
): Promise<void> {
  expect(hasSpan(paragraphInline(input), type)).toBe(spans);
  const out = await formatAdoc(input);
  expect(out).toBe(input);
  expect(await renderedHtml(out)).toBe(await renderedHtml(input));
  expect(await formatAdoc(out)).toBe(out);
}

for (const [mark, type] of MARKS) {
  describe(`${type} (${mark}) and the boundary classes`, () => {
    test.each(LEFT_OPENS.filter((character) => character !== mark))(
      `"x%s${mark}b${mark} y" is a span`,
      async (character) => {
        await expectRow(`x${character}${mark}b${mark} y\n`, type, true);
      },
    );

    test.each(LEFT_STAYS_TEXT.filter((character) => character !== mark))(
      `"x%s${mark}b${mark} y" stays text`,
      async (character) => {
        await expectRow(`x${character}${mark}b${mark} y\n`, type, false);
      },
    );

    test.each(RIGHT_CLOSES.filter((character) => character !== mark))(
      `"x ${mark}b${mark}%sy" is a span`,
      async (character) => {
        await expectRow(`x ${mark}b${mark}${character}y\n`, type, true);
      },
    );

    test.each(RIGHT_STAYS_TEXT.filter((character) => character !== mark))(
      `"x ${mark}b${mark}%sy" stays text`,
      async (character) => {
        await expectRow(`x ${mark}b${mark}${character}y\n`, type, false);
      },
    );
  });
}

describe("monospace's per-mark extras: the curved-quote characters", () => {
  // `"` and `'` join monospace's excluded-left class and its right
  // lookahead (`"\`` opens a curved double quote, `\`'` closes a
  // curved single one), while the other marks treat them as ordinary
  // punctuation. One pair of rows per side, both marks compared.
  test.each(['"', "'"])(
    "left %s: mono stays text, bold spans",
    async (character) => {
      await expectRow(`x${character}\`b\` y\n`, "monospace", false);
      await expectRow(`x${character}*b* y\n`, "bold", true);
    },
  );
  test.each(['"', "'"])(
    "right %s: mono stays text, bold spans",
    async (character) => {
      await expectRow(`x \`b\`${character}y\n`, "monospace", false);
      await expectRow(`x *b*${character}y\n`, "bold", true);
    },
  );
});

describe("the backslash escape stays an escape", () => {
  // `\*` is BackslashEscape, not a mark: the constrained pattern's
  // escape arm (convert_quoted_text, substitutors.rb l.1419-1424)
  // emits the match literally.
  test("an escaped open mark makes no span", async () => {
    const input = "x \\*b* y\n";
    expect(hasSpan(paragraphInline(input), "bold")).toBe(false);
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});

describe("direction rows: open and close are different questions", () => {
  // The oracle's opener needs a non-space AFTER the mark, its closer
  // a non-space BEFORE it - `(\S|\S.*?\S)` - so the same character in
  // the same neighbourhood answers differently by side.
  test.each<[string, string, boolean]>([
    // A mark with whitespace on its content side can do nothing.
    ["x * b * c\n", "bold", false],
    // The closing mark against a following word character dissolves
    // the WHOLE span, not just the closer.
    ["x *b*y z\n", "bold", false],
    // The same shape with the closer freed is a span again.
    ["x *b* yz\n", "bold", true],
  ])("%j", async (input, type, spans) => {
    await expectRow(input, type, spans);
  });

  test("*a*#b# keeps both spans", async () => {
    const input = "*a*#b# y\n";
    expect(hasSpan(paragraphInline(input), "bold")).toBe(true);
    expect(hasSpan(paragraphInline(input), "highlight")).toBe(true);
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});

describe("the word class is the oracle's, not Ruby's", () => {
  // The UNCONSTRAINED spelling beside a `\p{No}` neighbour. Ruby's
  // `\p{Word}` carries `\p{Nd}` only, so a Ruby reading calls the
  // superscript no word character, shortens the span, and the
  // oracle then renders the marks literally - the `<strong>` gone.
  // The oracle's own class (`\p{N}`) keeps the doubled marks. Each
  // row is a byte fixpoint AND render-equal, which is what the
  // shortened spelling could not be.
  test.each(["\u00B2", "\u00BD", "\u00B3"])(
    "%s in front keeps the doubled marks",
    async (character) => {
      const input = `x${character}**b c** y\n`;
      const out = await formatAdoc(input);
      expect(out).toBe(input);
      expect(await renderedHtml(out)).toBe(await renderedHtml(input));
      expect(await formatAdoc(out)).toBe(out);
    },
  );

  test("a superscript behind keeps the doubled marks", async () => {
    const input = "x **b c**\u00B2y\n";
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});
