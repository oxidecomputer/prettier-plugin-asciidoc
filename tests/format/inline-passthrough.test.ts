/**
 * The inline passthrough, read as ONE unit (issues #25 and #82).
 *
 * Asciidoctor pulls `+text+`, `++text++`, `+++text+++` and `$$text$$`
 * out of the line before it substitutes anything else
 * (`extract_passthroughs`, substitutors.rb l.1018), so everything
 * between the delimiters is literal: `+*not bold*+` renders the
 * asterisks. Reading the interior as ordinary inline content is what
 * corrupted output - the closing `+` came out as a separate word,
 * which reflow's dangling-`+` rule rewrote to `{plus}`, and
 * `+*not bold*+` was printed `+*not bold*{plus}`: a literal `+`, a
 * REAL bold span, and a `+` that renders as `&#43;`.
 *
 * The `$$` delimiter was the same construct read as prose. Its bytes
 * survived, so nothing here corrupted, but its interior was reflowed:
 * a run of spaces collapsed and a wrap could put a line break between
 * two words the oracle keeps together, both invisible to a renderer
 * that flows text and both real changes to the bytes the backend
 * receives.
 *
 * Every expectation here was measured against the oracle
 * (`@asciidoctor/core`) rather than imagined, and every row asserts
 * four things: the parse produces one passthrough node (or refuses
 * to, where the oracle refuses), the formatted bytes are pinned,
 * the output renders the same as the input, and formatting is a fixed
 * point.
 */
import { describe, expect, test } from "vitest";
import { formatAdoc, oracleHtml, renderedHtml } from "../helpers.js";
import { parse } from "../../src/parser.js";

/**
 * The verbatim bytes of every passthrough node in a parsed document,
 * at any depth and under any field name.
 *
 * A generic walk rather than a paragraph's `children`, because the
 * table below puts the same construct in a list item (whose inline
 * content is `text`), an admonition and a plain paragraph, and the
 * point of those rows is that the node comes out the same in all
 * three. It is also one level DOWN in issue #25's own second row,
 * where monospace wraps the passthrough.
 * @param value - anything reachable from the parsed document
 * @returns each passthrough's source, in document order
 */
function passthroughs(value: unknown): string[] {
  if (Array.isArray(value)) {
    return (value as unknown[]).flatMap((item) => passthroughs(item));
  }
  if (typeof value !== "object" || value === null) {
    return [];
  }
  const node: Record<string, unknown> = { ...value };
  if (node.type === "passthrough" && typeof node.value === "string") {
    return [node.value];
  }
  return Object.values(node).flatMap((field) => passthroughs(field));
}

/**
 * Format twice and render both sides: the four facts every row
 * asserts, gathered in one place so a row is a table entry rather
 * than a script.
 * @param source - the document source
 * @returns the formatted output, the second pass, and both renderings
 */
async function measure(source: string): Promise<{
  formatted: string;
  again: string;
  before: string;
  after: string;
}> {
  const formatted = await formatAdoc(source);
  return {
    formatted,
    again: await formatAdoc(formatted),
    before: await renderedHtml(source),
    after: await renderedHtml(formatted),
  };
}

/**
 * The shapes the oracle reads AS a passthrough. Each row is the
 * source, the passthrough bytes the parse must produce, and the
 * formatted output - every one a fixed point, because a passthrough
 * is re-emitted exactly as written.
 */
const PASSTHROUGHS: Array<[string, string[], string]> = [
  // Issue #25's own two rows. The bare one is what corrupted; the
  // backticked one is monospace WRAPPING a passthrough, so the
  // passthrough is a child of the span.
  ["+*not bold*+", ["+*not bold*+"], "+*not bold*+\n"],
  ["`+*not bold*+`", ["+*not bold*+"], "`+*not bold*+`\n"],
  // Content that is inline syntax of every other kind the tokenizer
  // knows: a mark, a monospace span, an attribute reference, a bare
  // URL with an attrlist, an xref shorthand, a comment head.
  ["+`tick`+", ["+`tick`+"], "+`tick`+\n"],
  ["+{attr}+", ["+{attr}+"], "+{attr}+\n"],
  ["+http://x.com[t]+", ["+http://x.com[t]+"], "+http://x.com[t]+\n"],
  ["+<<ref>>+", ["+<<ref>>+"], "+<<ref>>+\n"],
  ["+// c+", ["+// c+"], "+// c+\n"],
  // Plain content: already a fixed point before the fix, kept as the
  // control that says the rule did not start rewriting anything.
  ["+plain+", ["+plain+"], "+plain+\n"],
  ["`+literal+`", ["+literal+"], "`+literal+`\n"],
  // The unconstrained macro spellings, which take no boundary test at
  // all (InlinePassMacroRx, rx.rb l.597) and are extracted FIRST - the
  // reason `+++raw+++` is not read as `+` plus `++raw+`.
  ["++*b*++", ["++*b*++"], "++*b*++\n"],
  ["+++*b*+++", ["+++*b*+++"], "+++*b*+++\n"],
  ["a ++*b*++ c", ["++*b*++"], "a ++*b*++ c\n"],
  // `C++ and D++` really is a passthrough to Asciidoctor: it renders
  // `C and D`. The bytes are the author's either way, which is why
  // reading it correctly costs nothing.
  ["C++ and D++", ["++ and D++"], "C++ and D++\n"],
  // The attrlist Ruby's own patterns allow in front. `[x-]` asks for
  // the old monospaced behaviour, `[.role]` for a styled span; both
  // belong to the construct, so both ride on the node.
  ["[x-]+*b*+", ["[x-]+*b*+"], "[x-]+*b*+\n"],
  ["[.role]+a+", ["[.role]+a+"], "[.role]+a+\n"],
  // Mid-paragraph, and inside the three block bodies whose inline
  // content is read by a different caller than a plain paragraph's.
  ["para\n+*b*+\nmore", ["+*b*+"], "para +*b*+ more\n"],
  ["* item +*b*+", ["+*b*+"], "* item +*b*+\n"],
  ["NOTE: +*b*+", ["+*b*+"], "NOTE: +*b*+\n"],
  // A passthrough may span source lines (Ruby matches under `/m`).
  // The break becomes a space, which is what it renders as.
  ["+a\nb+", ["+a\nb+"], "+a b+\n"],
  // A ` +` INSIDE a passthrough is content, not a hard line break:
  // the construct is out of the line before `sub_post_replacements`
  // looks for one. Collapsing its newline is therefore safe, and
  // required - an atom carrying a newline would print as two lines.
  ["+a +\nb+", ["+a +\nb+"], "+a + b+\n"],
  // The `+++` form is the exception, and the reason
  // `passthroughText` (src/print/serialize-inline.ts) exists: it
  // carries `subs: []` (substitutors.rb l.1049), so its bytes reach
  // the backend output verbatim and an interior newline can be the
  // content of a `<pre>` the page really emits. The break is kept.
  [
    "+++<pre>a\nb</pre>+++",
    ["+++<pre>a\nb</pre>+++"],
    "+++<pre>a\nb</pre>+++\n",
  ],
  ["+++a\nb+++", ["+++a\nb+++"], "+++a\nb+++\n"],
  // The front boundary is `[^CC_WORD;:\\]` and `CC_WORD` is
  // `\p{Alphabetic}\p{N}\p{Pc}` EXACTLY (the oracle's own class,
  // build/node/index.cjs l.54). A combining mark is none of the
  // three, so a DECOMPOSED accent - the normal form macOS produces -
  // leaves the delimiter free to open. Widening the class with
  // `\p{M}` refuses these and prints the `{plus}` escape, which is
  // the issue-#25 corruption itself, so these rows are that
  // widening's killing table. Every non-ASCII character is spelled
  // as a `\uXXXX` escape, because two of the three are invisible.
  ["cafe\u0301+*chaud*+", ["+*chaud*+"], "cafe\u0301+*chaud*+\n"],
  // `\p{Join_Control}`: the zero-width non-joiner and joiner.
  ["x\u200C+*b*+", ["+*b*+"], "x\u200C+*b*+\n"],
  ["x\u200D+*b*+", ["+*b*+"], "x\u200D+*b*+\n"],
  // The attrlist class is `[^\[\]]+` (`QuoteAttributeListRxt`,
  // index.cjs l.59), which refuses a NESTED `[`: `[a[b]` is text and
  // only `+*x*+` is the construct.
  ["[a[b]+*x*+", ["+*x*+"], "[a[b]+*x*+\n"],
  // A `+` LEFT OVER beside a passthrough is not escaped: it prints
  // hard against the construct's last byte, where it can neither open
  // a line (a lone `+` is a list continuation) nor stand behind a
  // space at a line end (` +` is a hard line break). Escaping it
  // wrote `{plus}`, which renders `&#43;` where the author wrote `+`.
  ["+a++", ["+a+"], "+a++\n"],
  ["++a+++", ["++a++"], "++a+++\n"],
  ["+*a++", ["+*a+"], "+*a++\n"],
  ["x +++++", ["++++"], "x +++++\n"],
  // The `$$` delimiter (issue #82). It is the unconstrained row's
  // third alternative, so it takes no boundary test either: the same
  // rows the `+` spellings answer, answered the same way.
  ["$$*b*$$", ["$$*b*$$"], "$$*b*$$\n"],
  ["a $$*b*$$ c", ["$$*b*$$"], "a $$*b*$$ c\n"],
  ["$$pass:[x]$$", ["$$pass:[x]$$"], "$$pass:[x]$$\n"],
  // Monospace WRAPPING a passthrough, the mirror of the `+literal+`
  // row above: the span is the node's parent, so the backticks belong
  // to the monospace and the dollars to the construct inside it.
  ["`$$literal$$`", ["$$literal$$"], "`$$literal$$`\n"],
  ["$$<<ref>>$$", ["$$<<ref>>$$"], "$$<<ref>>$$\n"],
  ["$$`tick`$$", ["$$`tick`$$"], "$$`tick`$$\n"],
  ["[.role]$$a$$", ["[.role]$$a$$"], "[.role]$$a$$\n"],
  ["* item $$*b*$$", ["$$*b*$$"], "* item $$*b*$$\n"],
  ["NOTE: $$*b*$$", ["$$*b*$$"], "NOTE: $$*b*$$\n"],
  // Content may be EMPTY: the group is `(#{CC_ALL}*?)`, not `+?`.
  ["$$$$", ["$$$$"], "$$$$\n"],
  // Two passthroughs, not one: the lazy content group closes at the
  // FIRST `$$` behind the opener, and the walk resumes behind it.
  ["$$a$$$$b$$", ["$$a$$", "$$b$$"], "$$a$$$$b$$\n"],
  // The delimiters do not nest. Whichever opens first owns the run,
  // because `gsub` takes the leftmost match start and the closer is a
  // backreference to the opener - so the other spelling is content.
  ["$$a+++b$$", ["$$a+++b$$"], "$$a+++b$$\n"],
  ["+++a$$b+++", ["+++a$$b+++"], "+++a$$b+++\n"],
  // `$$` carries `BASIC_SUBS`, like `++` and unlike `+++`, so its
  // content reaches the backend as flowed text and a source line
  // break there renders as a space. Collapsing it is what keeps the
  // node one atom the packer can measure.
  ["$$a\nb$$", ["$$a\nb$$"], "$$a b$$\n"],
];

describe.each(PASSTHROUGHS)("%j", (source, values, formatted) => {
  test("parses as one passthrough carrying its own bytes", () => {
    expect(passthroughs(parse(source))).toEqual(values);
  });

  test("formats to pinned bytes, render-equal and idempotent", async () => {
    const result = await measure(source);
    expect(result.formatted).toBe(formatted);
    expect(result.after).toBe(result.before);
    expect(result.again).toBe(result.formatted);
  });
});

/**
 * The shapes the oracle does NOT read as a passthrough, and which the
 * tokenizer must therefore leave alone. Reading one of these as a
 * passthrough would freeze bytes that are ordinary text - and, worse,
 * hide a real construct: the last row's ` +` is a hard line break.
 */
const NOT_PASSTHROUGHS: Array<[string, string]> = [
  // A word character in front refuses the opening, and one behind
  // refuses the close (`[^#{CC_WORD};:\\]` and `(?!#{CG_WORD})`,
  // rx.rb l.583). Asciidoctor renders all three literally.
  ["a+b+c", "a+b+c\n"],
  ["word+plus+word", "word+plus+word\n"],
  ["0+a+", "0+a+\n"],
  // `;`, `:` and `\` are excluded in front alongside the word class;
  // the backslash is the escape Asciidoctor honours by printing the
  // delimiters.
  ["x;+a+", "x;+a+\n"],
  ["x:+a+", "x:+a+\n"],
  [String.raw`\+a+`, `${String.raw`\+a+`}\n`],
  // `_` is a word character to Ruby, so a `+...+` flush against an
  // italic mark is not a passthrough - the oracle renders
  // `<em>+<strong>b</strong>+</em>` for the first and
  // `+<strong>b</strong>+<em>x</em>` for the second.
  ["_+*b*+_", "_+*b*+_\n"],
  ["+*b*+_x_", "+*b*+_x_\n"],
  // Content must begin and end with a non-space, so neither edge of
  // `+ b +` can be a delimiter. Inside `` ` ``, where the backticks
  // are the span, the same bytes are monospaced literally.
  ["`+ a +`", "`+ a +`\n"],
  // An unmatched delimiter is one character of text.
  ["+a", "+a\n"],
  ["a + b", "a + b\n"],
  // The `$$` delimiter with nothing to close it. Unlike `+`, a lone
  // `$` is ordinary prose, so these are the rows that say the new
  // alternative did not start freezing currency amounts and shell
  // variables into constructs.
  ["C$$D", "C$$D\n"],
  ["a $$ b", "a $$ b\n"],
  ["cost $5 and $9", "cost $5 and $9\n"],
  ["$PATH is $HOME/bin", "$PATH is $HOME/bin\n"],
  ["a $$b", "a $$b\n"],
];

describe.each(NOT_PASSTHROUGHS)("%j is not a passthrough", (source, output) => {
  test("parses without one", () => {
    expect(passthroughs(parse(source))).toEqual([]);
  });

  test("formats to pinned bytes, render-equal and idempotent", async () => {
    const result = await measure(source);
    expect(result.formatted).toBe(output);
    expect(result.after).toBe(result.before);
    expect(result.again).toBe(result.formatted);
  });
});

/**
 * The hard line break survives beside the new rule. ` +` at end of a
 * line is `LineBreakRx`, and the passthrough content edge
 * (`(\S|\S...\S)`) is what keeps the two apart: a delimiter cannot be
 * followed by whitespace, and the break's `+` always is preceded by
 * one.
 */
describe("the hard line break is untouched", () => {
  test.each([
    ["a +\nb", "a +\nb\n"],
    ["+a+ +\nb", "+a+ +\nb\n"],
  ])("%j", async (source, output) => {
    const result = await measure(source);
    expect(result.formatted).toBe(output);
    expect(result.after).toBe(result.before);
    expect(result.again).toBe(result.formatted);
  });
});

/**
 * A passthrough is UNBREAKABLE: it contributes one atom, so the
 * packer places it whole. Breaking inside one would put a newline
 * where the author's bytes had a space - invisible in HTML for the
 * `+` form, but the `+++` form takes NO substitutions at all and its
 * bytes reach the output verbatim.
 */
test("a passthrough is not broken across the wrap", async () => {
  const source = `word word word word word word word word +a b c d e f g h i+`;
  const formatted = await formatAdoc(source);
  expect(formatted).toContain("+a b c d e f g h i+");
  expect(await renderedHtml(formatted)).toBe(await renderedHtml(source));
});

/**
 * Issue #82's own measurement, which no render comparison can carry.
 *
 * A passthrough renders as bare text with no wrapping element, so
 * `renderedHtml` - which collapses whitespace outside `<pre>` and
 * `<code>` - reads a collapsed interior run and an intact one as the
 * same string. The pin is the CONSTRUCT'S OWN BYTES in the output,
 * checked with `toContain`, which is the only lens that sees the
 * difference: before the `$$` delimiter was a passthrough, its
 * interior was prose, so `$$a  *b*$$` was reflowed to `$$a *b*$$` and
 * one of the author's two spaces was gone from the backend's input,
 * and a width break could fall between two of its words.
 *
 * Each row names the width it is measured at, because that is the
 * variable: a construct that survives at 80 columns and is taken
 * apart at 12 is not atomic, it is merely lucky.
 */
describe("the construct's bytes survive the reflow", () => {
  test.each<[string, string, number]>([
    // Issue #82's own probe, at the width where it fits and at one
    // where the paragraph must wrap around it.
    ["before $$a  *b*$$ after", "$$a  *b*$$", 80],
    ["before $$a  *b*$$ after", "$$a  *b*$$", 12],
    // An interior run of spaces in the middle of a line that has room
    // to spare: prose would have closed it up with no wrap involved.
    ["x $$one   two$$ y", "$$one   two$$", 80],
    // Interior WORDS under width pressure from both sides: the packer
    // places the construct whole or not at all.
    [
      "word word word word word word word word $$a b c d e f g h i$$",
      "$$a b c d e f g h i$$",
      40,
    ],
    [
      "$$a b c d e f g h i$$ word word word word word word word",
      "$$a b c d e f g h i$$",
      40,
    ],
    ["word word word $$a b c$$ word word word word", "$$a b c$$", 20],
    // The ATTRLIST rides on the node, so width pressure moves the two
    // together or not at all: a wrap between `[.role]` and its
    // delimiter would leave the brackets as a paragraph of their own
    // and the role would stop applying.
    ["word word word word [.role]$$a b c$$ word word", "[.role]$$a b c$$", 20],
  ])("%j keeps %j at width %i", async (source, construct, printWidth) => {
    const formatted = await formatAdoc(source, { printWidth });
    expect(formatted).toContain(construct);
    expect(await renderedHtml(formatted)).toBe(await renderedHtml(source));
    expect(await formatAdoc(formatted, { printWidth })).toBe(formatted);
  });
});

/**
 * The oracle's own bytes, for the one shape whose output layout does
 * not move: at 80 columns the paragraph fits on one line either way,
 * so a byte comparison against {@link oracleHtml} is a comparison of
 * the interior alone. This is the assertion that would have failed
 * before issue #82 - `renderedHtml` passed throughout, which is why
 * the gap survived as long as it did.
 */
test("the oracle receives the interior byte for byte", async () => {
  const source = "before $$a  *b*$$ after\n";
  const formatted = await formatAdoc(source);
  expect(formatted).toBe(source);
  expect(await oracleHtml(formatted)).toBe(await oracleHtml(source));
});

/**
 * A verbatim construct that would be BLOCK syntax at column 0 travels
 * in its predecessor's run rather than opening an output line
 * (`verbatimBoundary`, src/print/inline.ts).
 *
 * `++++` is what made the net necessary: Asciidoctor reads it as a
 * passthrough with empty content, and reads it at the head of a line
 * as a delimited-block delimiter - so the packer opening a line with
 * it deletes the rest of the paragraph. The INLINE ANCHOR row is the
 * same hazard, and was live before the passthrough existed: a
 * trailing `[[anc]]` pushed to column 0 becomes a BLOCK anchor and
 * the rendered `<a id="anc">` disappears from the paragraph
 * altogether.
 */
describe("block syntax never opens an output line", () => {
  const PAD = "wordword ".repeat(9).trim();
  test.each([`${PAD} ++++`, `${PAD} ++++ tail`, `${PAD} [[anc]]`])(
    "%j",
    async (source) => {
      const result = await measure(source);
      expect(result.formatted.split("\n").at(1)).toMatch(/^wordword /v);
      expect(result.after).toBe(result.before);
      expect(result.again).toBe(result.formatted);
    },
  );
});

/**
 * The block's own SECOND line keeps the break the author wrote, even
 * when the word-level net has already fused its first word backwards
 * (`keepBlockStartBreak`, src/print/block-start-hazard.ts).
 *
 * A paragraph whose first line is a bare `*` and whose second opens
 * with another one packs to `* *...` at column 0, which the reader
 * takes for a list item and the oracle does not. Both nets see that
 * hazard: `wordsToAtoms` fuses the second `*` backwards because a
 * lone `*` is block syntax at a line start, and the block-start net
 * wants the author's break instead. Fusing protects nothing at the
 * head of a block - there is no earlier atom for the break to land
 * in front of - so the net owns the decision and clears the fuse.
 *
 * The `+a+` rows reach that shape because a passthrough is its own
 * node, which splits `*+a+` into two atoms where it used to be one
 * word. The four rows below it are the same hazard with the other
 * verbatim node kinds, and they were live before this change: the
 * atom split is what every verbatim node already did.
 */
describe("the source break behind a block's first word is kept", () => {
  test.each([
    // The passthrough shapes, in all three marker alphabets, both
    // delimiter spellings, and with content behind the construct.
    ["*\n*+a+", "*\n*+a+\n"],
    ["*\n*+a+ c", "*\n*+a+ c\n"],
    ["*\n*++a++", "*\n*++a++\n"],
    [".\n.+a+", ".\n.+a+\n"],
    ["-\n-+a+", "-\n-+a+\n"],
    // The other verbatim node kinds, corrupting identically before.
    ["*\n*[[x]]", "*\n*[[x]]\n"],
    ["*\n*{attr}", "*\n*{attr}\n"],
    ["*\n*<<r>>", "*\n*<<r>>\n"],
    ["*\n*http://e.com/", "*\n*http://e.com/\n"],
  ])("%j", async (source, formatted) => {
    const result = await measure(source);
    expect(result.formatted).toBe(formatted);
    expect(result.after).toBe(result.before);
    expect(result.again).toBe(result.formatted);
  });
});
