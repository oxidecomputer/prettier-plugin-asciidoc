/**
 * Bare email autolinks at FORMAT level (issue #20), measured against
 * the oracle rather than imagined.
 *
 * Ruby recognises a bare address in `sub_macros`' email arm
 * (`substitutors.rb`; the `@asciidoctor/core` 4.0.11 transpile spells
 * the arm at `build/node/index.cjs` l.19882-19897) using
 * `InlineEmailRx` (`rx.rb`, transpiled at l.518). The tokenizer's
 * `InlineEmail` rule (src/parse/inline/rules.ts) transcribes that
 * pattern, so the address becomes ONE atomic inline node - the same
 * protection class a bare URL has - instead of a stretch of plain
 * text the tokenizer breaks apart at every `_`.
 *
 * Every row here states the ORACLE's verdict and then checks it
 * against the oracle in the same test, so the table cannot drift from
 * the renderer it claims to describe. Each row also pins the formatted
 * bytes (every frame is a fixed point), render equality, and
 * idempotency.
 */
import { describe, expect, test } from "vitest";
import { asParagraph, formatAdoc, renderedHtml } from "../helpers.js";
import { parse } from "../../src/parser.js";
import type { InlineNode } from "../../src/ast.js";

/**
 * Every link target in an inline tree, at any depth.
 * @param nodes - inline nodes to scan
 * @returns the `target` of every link node found, in order
 */
function linkTargets(nodes: readonly InlineNode[]): string[] {
  return nodes.flatMap((node) => {
    if (node.type === "link") return [node.target];
    return "children" in node ? linkTargets(node.children) : [];
  });
}

/**
 * The link targets of a one-paragraph document's inline content.
 * @param source - the document source
 * @returns the targets, in order
 */
function paragraphLinks(source: string): string[] {
  const [block] = parse(source).children;
  return linkTargets(asParagraph(block).children);
}

/**
 * Assert that formatting a source changes nothing a reader can see:
 * the bytes are a fixed point, the render is unchanged, and a second
 * pass is a no-op.
 * @param source - the document source, newline-terminated
 */
async function expectFixed(source: string): Promise<void> {
  const once = await formatAdoc(source);
  expect(once).toBe(source);
  expect(await renderedHtml(once)).toBe(await renderedHtml(source));
  expect(await formatAdoc(once)).toBe(once);
}

// Each row: the frame, and the address the ORACLE turns into a
// `mailto:` anchor, undefined where it renders the bytes as text.
const FRAMES: ReadonlyArray<readonly [string, string, string | undefined]> = [
  ["mid-sentence", "Write to user@example.com today.\n", "user@example.com"],
  ["at line start", "user@example.com is the address.\n", "user@example.com"],
  ["at line end", "The address is user@example.com\n", "user@example.com"],
  ["a comma behind", "Mail user@example.com, then wait.\n", "user@example.com"],
  ["a period behind", "Mail user@example.com.\n", "user@example.com"],
  ["in parentheses", "Mail (user@example.com) now.\n", "user@example.com"],
  ["in square brackets", "Mail [user@example.com] now.\n", "user@example.com"],
  ["in angle brackets", "Mail <user@example.com> now.\n", "user@example.com"],
  // No left word boundary in Ruby's pattern: the glued word char is
  // part of the address, not a reason to refuse one.
  ["a word char glued on", "xuser@example.com here.\n", "xuser@example.com"],
  ["a digit glued on", "9user@example.com here.\n", "9user@example.com"],
  // The guard capture `([\\>:/])?`: where it fires, the email arm
  // returns the match unlinked.
  ["a backslash in front", "Mail \\user@example.com now.\n", undefined],
  ["a slash in front", "Mail a/user@example.com now.\n", undefined],
  ["a colon in front", "Mail a:user@example.com now.\n", undefined],
  // A local-part joiner in front is NOT a guard, and it is no earlier
  // start either: the pattern's first character has to be a word one,
  // so the address opens behind the joiner and the oracle links it.
  ["a dot in front", "Mail .user@example.com now.\n", "user@example.com"],
  ["a hyphen in front", "Mail -user@example.com now.\n", "user@example.com"],
  [
    "an ampersand in front",
    "Mail &user@example.com now.\n",
    "user@example.com",
  ],
  // The guard is only the character immediately in front, so a
  // joiner between it and the address disarms it.
  [
    "a guard behind a dot",
    "Mail /.user@example.com now.\n",
    "user@example.com",
  ],
  // A word character behind a joiner IS an earlier start, and the
  // whole run is the address.
  [
    "a word char behind a hyphen",
    "Mail a-user@example.com now.\n",
    "a-user@example.com",
  ],
  // The local part's own character set.
  [
    "a dotted local",
    "Mail doc.writer@example.com now.\n",
    "doc.writer@example.com",
  ],
  [
    "a plus-addressed local",
    "Mail user+tag@example.com now.\n",
    "user+tag@example.com",
  ],
  [
    "an underscore local",
    "Mail dan_rosen@example.com now.\n",
    "dan_rosen@example.com",
  ],
  [
    "a hyphen local",
    "Mail dan-rosen@example.com now.\n",
    "dan-rosen@example.com",
  ],
  ["a percent local", "Mail user%x@example.com now.\n", "user%x@example.com"],
  [
    "a local ending in a dot",
    "Mail user.@example.com now.\n",
    "user.@example.com",
  ],
  // The domain: `CG_ALNUM[CC_ALNUM_\-.]*\.[a-zA-Z]{2,5}\b`.
  [
    "a subdomain",
    "Mail user@mail.corp.example.com now.\n",
    "user@mail.corp.example.com",
  ],
  ["mixed case", "Mail User@Example.COM now.\n", "User@Example.COM"],
  ["a four-letter TLD", "Mail user@example.info now.\n", "user@example.info"],
  ["a six-letter TLD", "Mail user@example.museum now.\n", undefined],
  ["a one-letter TLD", "Mail user@example.c now.\n", undefined],
  ["no TLD", "Mail user@localhost now.\n", undefined],
  ["a numeric host", "Mail user@192.168.1.1 now.\n", undefined],
  ["no local part", "Mail @example.com now.\n", undefined],
  ["two ats", "Mail a@@example.com now.\n", undefined],
];

// The oracle writes its anchors into HTML, so a local part's `&`
// arrives as an entity and has to be read back before the targets can
// be compared with the author's bytes.
const ENTITY = /&(?<name>amp|lt|gt);/gv;
const ENTITY_TEXT: Record<string, string> = { amp: "&", lt: "<", gt: ">" };

/**
 * Every `mailto:` target the oracle produced, in document order, back
 * in the author's bytes.
 * @param source - the document source
 * @returns the targets
 */
async function oracleTargets(source: string): Promise<string[]> {
  const rendered = await renderedHtml(source);
  return [...rendered.matchAll(/href="mailto:(?<target>[^"]*)"/gv)].map(
    (href) =>
      href[1].replaceAll(ENTITY, (_m, name: string) => ENTITY_TEXT[name]),
  );
}

describe("bare email addresses, frame by frame", () => {
  test.each(FRAMES)("%s", async (_name, source, address) => {
    // The TARGET, not just the presence of an anchor: a row that named
    // an address the oracle does not produce would otherwise pass.
    const wanted = address === undefined ? [] : [address];
    expect(await oracleTargets(source), "the oracle's verdict").toEqual(wanted);
    expect(paragraphLinks(source)).toEqual(wanted);
    await expectFixed(source);
  });
});

describe("a construct that owns the position keeps it", () => {
  // Both frames render a link, so the FRAMES table above (which asks
  // for no link at all) cannot state them: what is measured here is
  // WHICH construct claims the address, not whether one does.
  test("a `mailto:` macro keeps the address in its target", async () => {
    const source = "Mail mailto:user@example.com[Email me] now.\n";
    const rendered = await renderedHtml(source);
    expect(rendered).toContain('href="mailto:user@example.com"');
    expect(paragraphLinks(source)).toEqual([]);
    await expectFixed(source);
  });

  test("a URL carrying an `@` stays one URL, not an address", async () => {
    const source = "See https://example.com/a@b.com now.\n";
    const rendered = await renderedHtml(source);
    expect(rendered).not.toContain('href="mailto:');
    expect(paragraphLinks(source)).toEqual(["https://example.com/a@b.com"]);
    await expectFixed(source);
  });
});

// The email arm is a SCAN, not a per-position test: `String.replace`
// with a global pattern takes the leftmost match, moves past the whole
// of it, and repeats. Every row here turns on that, and each is
// measured against the oracle's own target list in the same test.
describe("the scan resumes past what it consumed", () => {
  test.each([
    // The `m` of the first `.com` refuses a fresh start only while it
    // is unconsumed; here it is interior to the first address, so a
    // second one opens behind the dot. Every joiner does it.
    ["a dot between", "Mail a@b.com.c@d.com rest.\n"],
    ["a hyphen between", "Mail a@b.com-c@d.com rest.\n"],
    ["a percent between", "Mail a@b.com%c@d.com rest.\n"],
    ["a plus between", "Mail a@b.com+c@d.com rest.\n"],
    ["an ampersand between", "Mail a@b.com&c@d.com rest.\n"],
    ["a shorter first address", "Mail a@b.co.d@e.org rest.\n"],
    // Three in a row, the middle one opening one character past an
    // `@`: legal only because everything left of that `@` failed.
    ["three, one opening past an `@`", "Mail a@b.cox.d_e@f.org-g.h@i.com r.\n"],
    // The guard is consumed too, so the refused address is not
    // re-offered one character to the right.
    ["a guard swallowing the address", "Mail a@b.com/c@d.com rest.\n"],
  ])("%s", async (_name, source) => {
    expect(paragraphLinks(source)).toEqual(await oracleTargets(source));
    await expectFixed(source);
  });
});

describe("an address is one construct, not a stretch of text", () => {
  // `&` stands where the oracle's pattern has `&amp;`: the email arm
  // runs inside sub_macros, AFTER sub_specialchars has rewritten every
  // `&`, while the tokenizer reads the author's own bytes.
  test("an ampersand in the local part is part of the address", async () => {
    const source = "Mail a&b@example.com now.\n";
    const rendered = await renderedHtml(source);
    expect(rendered).toContain('href="mailto:a&amp;b@example.com"');
    expect(paragraphLinks(source)).toEqual(["a&b@example.com"]);
    await expectFixed(source);
  });

  test("two addresses on one line are two links", async () => {
    const source = "Mail a@example.com and b@example.org now.\n";
    expect(paragraphLinks(source)).toEqual(["a@example.com", "b@example.org"]);
    await expectFixed(source);
  });

  // The point of the construct: reflow packs ATOMS, and an address is
  // one atom, so no break can land inside it however narrow the width.
  test.each([20, 24, 30, 40])(
    "reflow never breaks inside an address at width %i",
    async (printWidth) => {
      const source =
        "Please contact the maintainer at doc.writer@example.com about it.\n";
      const out = await formatAdoc(source, { printWidth });
      expect(out).toContain("doc.writer@example.com");
      const [before, after] = await Promise.all([
        renderedHtml(source),
        renderedHtml(out),
      ]);
      expect(after).toBe(before);
      expect(await formatAdoc(out, { printWidth })).toBe(out);
    },
  );

  // An atom fuses with the punctuation around it, and a bracket pair at column
  // 0 is a block attribute list. Reflow may not open a line with that
  // run, so the width break in front of it is refused (`wrap`,
  // src/print/reflow.ts) - the same protection `wordsToAtoms` gives a
  // block-syntax WORD, which this run is not because no single node
  // holds it.
  test.each([80, 40, 30, 24, 20])(
    "an address in brackets never opens a line at width %i",
    async (printWidth) => {
      const source = "Mail [user@mail.corp.example.com] now.\n";
      const out = await formatAdoc(source, { printWidth });
      expect(out).not.toMatch(/^\[/mv);
      const [want, got] = await Promise.all([
        renderedHtml(source),
        renderedHtml(out),
      ]);
      expect(got).toBe(want);
      expect(await formatAdoc(out, { printWidth })).toBe(out);
    },
  );

  // A `+` word in front of an address now fuses to it rather than
  // taking a breakable space, the same protection a URL gives: a bare
  // `+` at the end of an output line would be a hard line break. This
  // `+` is UNPAIRED, so it is an ordinary text word and not a
  // passthrough delimiter (issue #25); the paired case is below, where
  // the passthrough swallows the address outright.
  test.each([10, 14, 20, 80])(
    "a `+` word in front of an address cannot end line at width %i",
    async (printWidth) => {
      const source = "See foo+ user@example.com today.\n";
      const out = await formatAdoc(source, { printWidth });
      expect(out).not.toMatch(/ \+\n/v);
      const [before, after] = await Promise.all([
        renderedHtml(source),
        renderedHtml(out),
      ]);
      expect(after).toBe(before);
    },
  );
});

// An inline passthrough is pulled out of the line BEFORE any
// substitution runs (`extract_passthroughs`), so the email arm never
// sees what is inside one. We reach the same answer for a different
// reason: the Passthrough rule is first in the table (issue #25), so
// the address inside is never a position the email rule is offered.
//
// Before #25 landed, this was a divergence - we read the address and
// the oracle did not. It is a divergence no longer, and these rows are
// what keeps it that way.
describe("an address inside a passthrough is not an address", () => {
  test.each([
    ["single plus", "Mail +user@example.com+ now.\n"],
    ["triple plus", "Mail +++user@example.com+++ now.\n"],
    ["an address the plus run splits", "Mail +9@q_w@e.org+- rest.\n"],
  ])("%s", async (_name, source) => {
    expect(await oracleTargets(source), "the oracle's verdict").toEqual([]);
    expect(paragraphLinks(source)).toEqual([]);
    await expectFixed(source);
  });

  // The `+` INSIDE an address is no delimiter: a plus-addressed local
  // part is one atom, and the passthrough rule never opens on it
  // because it is only tried where the address has not already been
  // taken.
  test("a plus-addressed local part is still one address", async () => {
    const source = "Mail user+tag@example.com now.\n";
    expect(await oracleTargets(source)).toEqual(["user+tag@example.com"]);
    expect(paragraphLinks(source)).toEqual(["user+tag@example.com"]);
    await expectFixed(source);
  });
});

describe("an address behind a tag an earlier pass wrote", () => {
  // A DELIBERATE divergence, and a byte-neutral one. Ruby's guard
  // class holds `>`, which by the time the email arm runs is the `>`
  // that closes a tag an EARLIER pass wrote: sub_quotes has already
  // turned `` `a@b.com` `` into `<code>a@b.com</code>` and sub_macros'
  // own link arm has already turned `link:x[t]` into `<a ...>t</a>`,
  // so an address flush behind either sits behind a `>` and stays
  // text. An AUTHOR's `>` does not guard under the default
  // substitution list: sub_specialchars rewrote it to `&gt;` first,
  // and `a>user@example.com` does render as a link (measured). The
  // tokenizer reads author bytes, so it keeps `>` out of its guard and
  // reads the address as a construct in all of these.
  //
  // Nothing a reader can see moves: the printer writes an address node
  // as its own source bytes, and an address begins and ends with a word
  // character, so every span-respelling clause that asks about a
  // neighbour (constrainedIsLegal, src/print/inline.ts) answers exactly
  // as it did when the address was text.
  test.each([
    ["monospace", "Mail `user@example.com` now.\n"],
    ["bold", "Mail *user@example.com* now.\n"],
    ["italic", "Mail _user@example.com_ now.\n"],
    ["highlight", "Mail #user@example.com# now.\n"],
    ["behind a closed span", "Mail **b**user@example.com now.\n"],
    // The macro family: `</a>` in front of the address, not `</em>`.
    ["behind a link macro", "See link:x[t]c@d.com now.\n"],
    ["behind an image macro", "See image:p.png[t]c@d.com now.\n"],
  ])("%s keeps the author's bytes", async (_name, source) => {
    await expectFixed(source);
  });

  test("the oracle really does refuse the address behind a tag", async () => {
    const rendered = await renderedHtml("See link:x[t]c@d.com now.\n");
    expect(rendered).not.toContain('href="mailto:');
    expect(paragraphLinks("See link:x[t]c@d.com now.\n")).toEqual(["c@d.com"]);
  });

  test("an address with a span behind it still respells the span", async () => {
    const source = "Mail user@example.com and **b** now.\n";
    expect(await formatAdoc(source)).toBe(
      "Mail user@example.com and *b* now.\n",
    );
    expect(await renderedHtml(await formatAdoc(source))).toBe(
      await renderedHtml(source),
    );
  });
});
