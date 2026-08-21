/**
 * The inline tokenizer, pinned to the Chevrotain lexer it replaces.
 *
 * The fixture was generated from `inlineLexer` before it was deleted
 * (spec Testing §4): the old lexer is the oracle for the new one, and
 * a difference is a finding — either a Chevrotain artefact we wanted
 * gone (none are expected: the lexer is a plain first-match-wins pass
 * over 15 ordered token types, with no `longer_alt` anywhere) or a
 * bug in the new rule table.
 *
 * Task 2 re-points the SUBJECT of this test from `inlineLexer` to
 * `tokenizeInline` without touching the fixture. That is the whole
 * point: the expectations were written by the code being replaced.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { inlineLexer } from "../../src/parse/tokens.js";

/** One pinned token: what the lexer made of a stretch of the text. */
interface PinnedToken {
  /** The token type's name. */
  type: string;
  /** The characters it matched. */
  image: string;
  /** Where it starts, relative to the row's text. */
  offset: number;
}

/** One pinned row: an input and the tokens the old lexer produced. */
interface PinnedRow {
  /** The exact text handed to the lexer, newline included. */
  text: string;
  /** The lexer's output: kind, image and fragment-relative offset. */
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

describe("inline tokenizer matches the pinned Chevrotain lexer", () => {
  test("the fixture is not empty", () => {
    expect(rows.length).toBeGreaterThan(100);
  });
  test.each(rows.map((row, index) => [index, row] as const))(
    "row %i",
    (_index, row) => {
      const actual = inlineLexer.tokenize(row.text).tokens.map((token) => ({
        type: token.tokenType.name,
        image: token.image,
        offset: token.startOffset,
      }));
      expect(actual, JSON.stringify(row.text)).toEqual(row.tokens);
    },
  );
});
