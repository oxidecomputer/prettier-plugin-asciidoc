/**
 * The inline tokenizer's own GOLDEN FILE.
 *
 * tests/parser/fixtures/inline-tokens.jsonl is 1,747 rows of
 * `{ text, tokens }`: an input fragment and the exact token stream
 * `tokenizeInline` (src/parse/inline/) produces for it. The rows are an
 * EQUALITY pin, not a sample — every one must match to the character,
 * and the tokens move only when someone deliberately regenerates the
 * file and reviews the result as a diff. An accidental change to the
 * token vocabulary shows up here as hundreds of failing rows, which is
 * the point.
 *
 * Regenerate, when the vocabulary changes ON PURPOSE, by rewriting each
 * row's `tokens` from the current tokenizer while keeping its `text`:
 *
 * ```
 * bun -e 'import{readFileSync,writeFileSync}from"node:fs";
 * import{tokenizeInline}from"./src/parse/inline/tokenize.ts";
 * const f="tests/parser/fixtures/inline-tokens.jsonl";
 * writeFileSync(f,readFileSync(f,"utf8").split("\n").filter(Boolean)
 * .map(l=>{const{text}=JSON.parse(l);return JSON.stringify({text,
 * tokens:tokenizeInline(text,0).map(({type,image,offset})=>
 * ({type,image,offset}))})}).join("\n")+"\n")'
 * ```
 *
 * That command is byte-identical to a no-op today, so a non-empty diff
 * after running it IS the vocabulary change, ready to read.
 *
 * There is NO in-tree generator for the row TEXTS, honestly: they were
 * harvested once from the fragments a since-deleted Chevrotain lexer
 * saw, and that harvest is not reproducible from this tree. Treat the
 * text column as a frozen, hand-extendable input set — add a row by
 * appending one `{ text, tokens }` object and running the command
 * above. Do not prune rows to make the file smaller; the rarer shapes
 * are exactly the ones nothing else covers.
 *
 * Row names are INDICES (`row 0`, `row 1`, …), so inserting a row
 * anywhere but the end renumbers every row after it. Append rather
 * than insert, or expect a diff that reads as if the whole file moved.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { tokenizeInline } from "../../src/parse/inline/tokenize.js";
import { INLINE_RULES } from "../../src/parse/inline/rules.js";
import { INLINE_KINDS } from "../../src/parse/inline/tokens.js";

/** One pinned token: what the tokenizer made of a stretch of the text. */
interface PinnedToken {
  /** The token type's name. */
  type: string;
  /** The characters it matched. */
  image: string;
  /** Where it starts, relative to the row's text. */
  offset: number;
}

/** One pinned row: an input and the tokens it must produce. */
interface PinnedRow {
  /** The exact text handed to `tokenizeInline`, newline included. */
  text: string;
  /** The expected output: kind, image and fragment-relative offset. */
  tokens: PinnedToken[];
}

/**
 * Narrow one parsed token of the fixture.
 *
 * A guard rather than a cast: a fixture that silently parsed as
 * `undefined` would make every row compare `[]` with `[]` and the pin
 * would pass without checking anything.
 * @param value - one element of a row's `tokens`
 * @returns whether it has the three fields a token needs
 */
function isToken(value: unknown): value is PinnedToken {
  if (typeof value !== "object" || value === null) return false;
  const token: Record<string, unknown> = { ...value };
  return (
    typeof token.type === "string" &&
    typeof token.image === "string" &&
    typeof token.offset === "number"
  );
}

/**
 * Narrow an unknown value to an array of unknowns — `Array.isArray`
 * alone narrows to `any[]`, which would make `isToken` below a
 * formality rather than a check.
 * @param value - a candidate `tokens` field
 * @returns whether it is an array
 */
function isArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/**
 * Parse one line of the fixture.
 * @param line - one JSONL line
 * @returns the row it describes
 * @throws {TypeError} when the line is not a row — a fixture that
 *   parsed to the wrong shape must not read as "no tokens expected"
 */
function toRow(line: string): PinnedRow {
  const parsed: unknown = JSON.parse(line);
  if (typeof parsed !== "object" || parsed === null) {
    throw new TypeError(`inline-tokens: bad row ${line}`);
  }
  const { text, tokens }: Record<string, unknown> = { ...parsed };
  if (typeof text !== "string" || !isArray(tokens) || !tokens.every(isToken)) {
    throw new TypeError(`inline-tokens: bad row ${line}`);
  }
  return { text, tokens: [...tokens] };
}

const rows: PinnedRow[] = readFileSync(
  "tests/parser/fixtures/inline-tokens.jsonl",
  "utf8",
)
  .split("\n")
  .filter((line) => line !== "")
  .map((line) => toRow(line));

describe("inline tokenizer matches its golden file", () => {
  test("the fixture is not empty", () => {
    expect(rows.length).toBeGreaterThan(100);
  });
  test.each(rows.map((row, index) => [index, row] as const))(
    "row %i",
    (_index, row) => {
      const actual = tokenizeInline(row.text, 0).map((token) => ({
        type: token.type,
        image: token.image,
        offset: token.offset,
      }));
      expect(actual, JSON.stringify(row.text)).toEqual(row.tokens);
    },
  );

  test("baseOffset shifts every offset and nothing else", () => {
    const zero = tokenizeInline("a *b*\n", 0);
    const shifted = tokenizeInline("a *b*\n", 17);
    expect(shifted.map((t) => t.offset)).toEqual(
      zero.map((t) => t.offset + 17),
    );
    expect(shifted.map((t) => t.type)).toEqual(zero.map((t) => t.type));
  });
});

/**
 * The rule table, in a form a reader can check without running
 * anything. The golden file above pins the tokenizer's output in bulk;
 * this pins the RULES themselves, one legible row per decision, and it
 * is the table that survives a regeneration of the fixture — which is
 * why a regenerated golden file is never on its own enough review.
 *
 * Every row's expectation was READ OFF the tokenizer rather than
 * imagined, so the table states today's behaviour rather than an
 * intention.
 */
describe("the rule table, by hand", () => {
  // rules.ts's own interface test: priority is DATA, and the only
  // thing that makes INLINE_KINDS the specification of that order is
  // this assertion. Reading the tokenizer's output cannot see it — a
  // table in a different order agrees with the fixture wherever no
  // two rules can match at the same position. InlineChar is excluded:
  // it is the tokenizer's else branch for a position no rule claims,
  // not a row in the table.
  test("is built in INLINE_KINDS order, one rule per kind but InlineChar", () => {
    expect(INLINE_RULES.map((rule) => rule.type)).toEqual(
      [...INLINE_KINDS].filter((kind) => kind !== "InlineChar"),
    );
  });

  test.each([
    // Ordering: the first rule that matches wins, so a mark inside a
    // macro's attrlist is text, not a mark.
    ["link:a[b *c*]", ["InlineMacro"]],
    // InlineText's negative lookahead is what stops a run BEFORE a URL.
    ["see https://x", ["InlineText", "InlineUrl"]],
    // `**` is tried before `*`: unconstrained wins on a double mark.
    ["**b**", ["BoldMark", "InlineText", "BoldMark"]],
    // Constrained at fragment offset 0: index -1 is out of range and
    // therefore a boundary.
    ["*b*", ["BoldMark", "InlineText", "BoldMark"]],
    // Mid-word, no boundary either side: not a mark, one char of text.
    ["a*b", ["InlineText", "InlineChar", "InlineText"]],
    // ` +` only before a newline; a bare `+` is ordinary text.
    ["a +\n", ["InlineText", "HardLineBreak", "InlineNewline"]],
    ["a + b", ["InlineText"]],
    // `\r` is not special: it stays inside the text run, which is why
    // ` +\r\n` is NOT a hard break (existing behaviour, preserved).
    ["a +\r\n", ["InlineText", "InlineNewline"]],
    // A NUL is ordinary text — nothing in the table treats it
    // specially, and `InlineText`'s class does not exclude it
    // (a trailing-NUL input must not start being "fixed").
    // The single-character fallback is exercised by the `a*b` row
    // above, where a mid-word `*` matches no mark rule.
    ["\u0000", ["InlineText"]],
    // Out of range IS a boundary, at BOTH ends. The
    // fragment's edges are the only place that rule is observable —
    // everywhere else a neighbouring character decides — and a
    // fragment usually ends in a newline, so these two rows are the
    // whole of the evidence. Without them the bounds check in
    // `isBoundary` can be deleted and every other test still passes:
    // `text.at(-1)` returns the LAST character rather than undefined,
    // which hides the missing check whenever a fragment happens to end
    // in punctuation.
    ["*b", ["BoldMark", "InlineText"]],
    ["a*", ["InlineText", "BoldMark"]],
    // The xref shorthand does not cross a line break: both halves of
    // its target exclude `\n`. The row matters because the OPTIONAL
    // `(?:,[^>\n]+)?` half is otherwise unobservable — `[^>\n]+` is
    // greedy and already eats the comma — so this is the only shape
    // that can tell the two classes apart.
    [
      "<<a,\n>>",
      ["InlineChar", "InlineChar", "InlineText", "InlineNewline", "InlineText"],
    ],
  ])("%j", (text, kinds) => {
    expect(tokenizeInline(text, 0).map((token) => token.type)).toEqual(kinds);
  });
});

/**
 * The constrained-mark boundary set, character by character.
 *
 * `BOUNDARY_PUNCTUATION` in src/parse/inline/rules.ts is a bare list of
 * characters — the kind of data the corpus pins only where a document
 * happens to use it, which leaves the rarer members (`—`, `–`, `…`, `?`,
 * `<`, `>`, `/`) resting on nothing. Every expectation below was read off
 * the tokenizer rather than imagined: all 26 boundaries open a
 * constrained mark, and the six controls do not.
 */
/**
 * The mark to probe a boundary character with, and the kind it should
 * produce.
 *
 * `*` for every character but `*` itself: `x**b` would take the
 * UNCONSTRAINED double-mark path, which never consults the boundary
 * set, so that row could not fail however the set is edited. `x*_b`
 * asks the same question of the `_` mark instead, whose left
 * neighbour is the `*` under test.
 * @param character - the boundary character being probed
 * @returns the mark character to write after it, and the kind that
 *   mark produces when the character IS a boundary
 */
function probe(character: string): [string, string] {
  return character === "*" ? ["_", "ItalicMark"] : ["*", "BoldMark"];
}

describe("constrained marks and the boundary set", () => {
  test.each([
    ",",
    ";",
    ":",
    "!",
    "?",
    ".",
    "(",
    ")",
    "[",
    "]",
    "{",
    "}",
    "<",
    ">",
    "/",
    '"',
    "'",
    "—",
    "–",
    "…",
    "*",
    "_",
    "`",
    "#",
    "+",
    " ",
  ])("%j before a mark opens it", (character) => {
    const [mark, kind] = probe(character);
    expect(
      tokenizeInline(`x${character}${mark}b`, 0).map((t) => t.type),
    ).toContain(kind);
  });

  test.each(["a", "0", "-", "=", "&", "~"])(
    "%j before a mark does not",
    (character) => {
      const [mark, kind] = probe(character);
      expect(
        tokenizeInline(`x${character}${mark}b`, 0).map((t) => t.type),
      ).not.toContain(kind);
    },
  );
});
