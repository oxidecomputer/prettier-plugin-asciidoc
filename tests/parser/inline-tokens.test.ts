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
 * tokens:tokenizeInline(text,0).map(({type,image,offset,canOpen,canClose})=>
 * ({type,image,offset,canOpen,canClose}))})}).join("\n")+"\n")'
 * ```
 *
 * (`JSON.stringify` drops the two flag fields where they are
 * undefined, so only mark tokens carry them in the file — the same
 * shape the tokenizer emits.)
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
  /** For mark tokens: whether the mark can open a span here. */
  canOpen?: boolean;
  /** For mark tokens: whether the mark can close a span here. */
  canClose?: boolean;
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
    typeof token.offset === "number" &&
    (token.canOpen === undefined || typeof token.canOpen === "boolean") &&
    (token.canClose === undefined || typeof token.canClose === "boolean")
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
        canOpen: token.canOpen,
        canClose: token.canClose,
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
    // An address stops the run too, but not through the pattern: its
    // start is no fixed prefix, so the run is matched whole and then
    // CUT where the email arm's own scan opens one (textMatcher).
    ["see a@b.com", ["InlineText", "InlineEmail"]],
    // The underscore is a WORD character to Ruby, so it belongs to the
    // local part rather than falling out of the run as a stray mark.
    ["see a_b@c.com", ["InlineText", "InlineEmail"]],
    // No left word boundary: the glued character joins the address,
    // because the scan matches at the first position that works.
    ["xa@b.com", ["InlineEmail"]],
    // Ruby's guard `([\\>:/])?` is CONSUMED, so a guarded address is
    // not retried one character to the right. Running the scan rather
    // than testing a position is what reproduces that, and the run
    // stays one stretch of plain text.
    ["x/a@b.com", ["InlineText"]],
    ["x:a@b.com", ["InlineText"]],
    [String.raw`\a@b.com`, ["InlineChar", "InlineText"]],
    // A word character behind the joiners refuses a start only while
    // it is UNCONSUMED: here the `m` is interior to the first address,
    // so the scan opens a second one behind the dot.
    ["a@b.com.c@d.com", ["InlineEmail", "InlineText", "InlineEmail"]],
    // A macro and a URL own the position outright.
    ["mailto:a@b.com[x]", ["InlineMacro"]],
    ["https://x/a@b.com", ["InlineUrl"]],
    // `**` is tried before `*`: unconstrained wins on a double mark.
    ["**b**", ["BoldMark", "InlineText", "BoldMark"]],
    // Constrained at fragment offset 0: index -1 is out of range and
    // therefore a boundary.
    ["*b*", ["BoldMark", "InlineText", "BoldMark"]],
    // Mid-word, no boundary either side: not a mark, one char of text.
    ["a*b", ["InlineText", "InlineChar", "InlineText"]],
    // ` +` only before a newline; a `+` that opens no passthrough is
    // one character of text, because `InlineText`'s class excludes
    // `+` so the Passthrough rule gets a look at every one of them.
    ["a +\n", ["InlineText", "HardLineBreak", "InlineNewline"]],
    ["a + b", ["InlineText", "InlineChar", "InlineText"]],
    // `\r` is not special: it stays inside the text run, which is why
    // ` +\r\n` is NOT a hard break (existing behaviour, preserved).
    ["a +\r\n", ["InlineText", "InlineChar", "InlineText", "InlineNewline"]],
    // The passthrough forms, matched as ONE token each: constrained
    // (`+text+`), unconstrained (`++text++`, `+++text+++`), and with
    // the attrlist Ruby's own patterns allow in front. Everything
    // between the delimiters is the token's bytes, marks included —
    // that is the whole point of the rule.
    ["+*b*+", ["Passthrough"]],
    ["a +*b*+ c", ["InlineText", "Passthrough", "InlineText"]],
    ["`+*b*+`", ["MonoMark", "Passthrough", "MonoMark"]],
    ["++*b*++", ["Passthrough"]],
    ["+++*b*+++", ["Passthrough"]],
    ["[x-]+*b*+", ["Passthrough"]],
    // The constrained boundary: a word character, `;`, `:` or `\`
    // in front refuses the opening (`[^#{CC_WORD};:\\]`, rx.rb
    // l.583), and a word character behind refuses the close.
    ["a+b+", ["InlineText", "InlineChar", "InlineText", "InlineChar"]],
    ["x;+b+", ["InlineText", "InlineChar", "InlineText", "InlineChar"]],
    ["+b+x", ["InlineChar", "InlineText", "InlineChar", "InlineText"]],
    // Content must begin and end with a non-space (`(\S|\S.*?\S)`),
    // so ` +` at a line end stays the hard break it was.
    ["+ b +\n", ["InlineChar", "InlineText", "HardLineBreak", "InlineNewline"]],
    // A NUL is ordinary text — nothing in the table treats it
    // specially, and `InlineText`'s class does not exclude it
    // (a trailing-NUL input must not start being "fixed").
    // The single-character fallback is exercised by the `a*b` row
    // above, where a mid-word `*` matches no mark rule.
    ["\u0000", ["InlineText"]],
    // The fragment's edges: start-of-text satisfies Ruby's left clause
    // (`^` in `(^|[^\p{Word};:}])`), and end-of-text satisfies the
    // right lookahead vacuously. These two rows are the whole of the
    // evidence for the `index > 0` guard in quote-boundaries.ts's
    // `before`: without it `text.at(-1)` returns the LAST character
    // rather than undefined, which hides the missing check whenever a
    // fragment happens to end in a character the classes admit.
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
 * The constrained-mark boundary classes, character by character —
 * Ruby's classes (`QUOTE_SUBS`, asciidoctor.rb l.448-464), consulted
 * through quote-boundaries.ts, not a hand list. The rarer members
 * (`—`, `–`, `…`, `?`, `/`, the specialchars pre-image `<` `>` `&`)
 * rest on these rows; the format-level oracle table lives in
 * tests/format/inline-boundary.test.ts.
 */
/**
 * The mark to probe a boundary character with, and the kind it should
 * produce.
 *
 * `*` for every character but `*` itself: `x**b` would take the
 * UNCONSTRAINED double-mark path, which never consults the boundary
 * classes, so that row could not fail however the classes are edited.
 * `x*_b` asks the same question of the `_` mark instead, whose left
 * neighbour is the `*` under test.
 * @param character - the boundary character being probed
 * @returns the mark character to write after it, and the kind that
 *   mark produces when the character admits an opening
 */
function probe(character: string): [string, string] {
  return character === "*" ? ["_", "ItalicMark"] : ["*", "BoldMark"];
}

describe("constrained marks and the boundary classes", () => {
  // A character OUTSIDE the excluded-left class admits an opening
  // mark (the content head `b` supplies the required `\S`).
  test.each([
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
    '"',
    "'",
    "—",
    "–",
    "…",
    "*",
    "`",
    "+",
    " ",
    "-",
    "=",
    "~",
    "|",
    "@",
    "^",
  ])("%j before a mark opens it", (character) => {
    const [mark, kind] = probe(character);
    expect(
      tokenizeInline(`x${character}${mark}b`, 0).map((t) => t.type),
    ).toContain(kind);
  });

  // The excluded-left class: `\p{Word}` (which holds `_`, `0` and the
  // non-ASCII `é`), Ruby's explicit `;` `:` `}`, and the specialchars
  // pre-image `<` `>` `&` (already `&lt;`/`&gt;`/`&amp;` — each
  // ending in `;` — when the quote pass runs). A mark after one of
  // these can still CLOSE, but here there is nothing open, so with
  // `b` (a word character) behind it the mark is no token at all.
  test.each(["a", "0", "\u00E9", "_", ";", ":", "}", "<", ">", "&"])(
    "%j before a mark does not",
    (character) => {
      const [mark, kind] = probe(character);
      expect(
        tokenizeInline(`x${character}${mark}b`, 0).map((t) => t.type),
      ).not.toContain(kind);
    },
  );

  // The RIGHT side is the negative lookahead `(?!\p{Word})`, a
  // different set from the left: `;` `:` `}` close fine, a word
  // character does not.
  test.each([";", ":", "}", "-", "&", " ", "\\"])(
    "a closing mark stands before %j",
    (character) => {
      expect(tokenizeInline(`a*${character}`, 0).map((t) => t.type)).toContain(
        "BoldMark",
      );
    },
  );
  test.each(["a", "0", "\u00E9", "_"])(
    "a closing mark does not stand before %j",
    (character) => {
      expect(
        tokenizeInline(`a*${character}`, 0).map((t) => t.type),
      ).not.toContain("BoldMark");
    },
  );

  // Monospace's per-mark extras — the curved-quote compounds: `"` and
  // `'` join the excluded-left class and the right lookahead for the
  // backtick only (`a "\`code\`" b` renders the curved quotes and no
  // span). The same characters are fine beside `*`.
  test.each(['"', "'"])(
    "%j dissolves a monospace open, not a bold one",
    (character) => {
      expect(
        tokenizeInline(`x${character}\`b`, 0).map((t) => t.type),
      ).not.toContain("MonoMark");
      expect(tokenizeInline(`x${character}*b`, 0).map((t) => t.type)).toContain(
        "BoldMark",
      );
    },
  );
  test.each(['"', "'"])(
    "%j dissolves a monospace close, not a bold one",
    (character) => {
      expect(
        tokenizeInline(`a\`${character}`, 0).map((t) => t.type),
      ).not.toContain("MonoMark");
      expect(tokenizeInline(`a*${character}`, 0).map((t) => t.type)).toContain(
        "BoldMark",
      );
    },
  );

  // The content edge: `(\S|\S.*?\S)` must start and end with a
  // non-space, so a mark with whitespace on BOTH sides — or at a
  // fragment edge facing whitespace — is no token in either
  // direction.
  test("a mark between spaces is no mark at all", () => {
    expect(tokenizeInline("x * b", 0).map((t) => t.type)).not.toContain(
      "BoldMark",
    );
  });
  test("a newline is whitespace to the content edge", () => {
    expect(tokenizeInline("x\n* b\n* c\n", 0).map((t) => t.type)).not.toContain(
      "BoldMark",
    );
  });
});
