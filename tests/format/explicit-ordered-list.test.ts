/**
 * EXPLICIT ordered list markers (issue #12): `1.`, `a.`, `A.`, `i)`,
 * `I)` - the five families `OrderedListRx` accepts beside the implicit
 * `.` run.
 *
 * The formatter PRESERVES the author's spelling rather than
 * normalizing it to the implicit form, and the reason is measured
 * here rather than argued. Three facts, each with its authority:
 *
 * 1. The ORACLE reads an ordered list's `start` off its FIRST item's
 *    marker (`resolveOrderedListStart`, `@asciidoctor/core` 4.0.11
 *    `build/node/index.cjs` l.13396, called from the olist branch of
 *    `parseListItem` at l.12154), so rewriting `5.` as `.` deletes
 *    `start="5"`. See the divergence note below.
 * 2. The numbering STYLE comes from the marker's family for an
 *    explicit marker and from the dot RUN's length for an implicit
 *    one (`ORDERED_LIST_STYLES[sibling_trait.length - 1]`, parser.rb
 *    l.1343), so a family collapses onto `.` only after a hand-chosen
 *    run (`a.` onto `..`, `i)` onto `...`), and never uniformly.
 * 3. `.` and `1.` are DIFFERENT styles, so `. outer` / `1. inner`
 *    nests; normalizing the inner marker fuses the two lists into
 *    one. Facts 2 and 3 hold under Ruby 2.0.26 as well.
 *
 * DIVERGENCE, recorded because a design decision turns on it: the
 * project's spec of record is Asciidoctor Ruby 2.0.26, but the oracle
 * this suite renders through is `@asciidoctor/core` 4.0.11, which
 * self-reports `2.0.26` (`ASCIIDOCTOR_CORE_VERSION`, `index.cjs`
 * l.23734) and is not it. Ruby
 * 2.0.26's own olist branch (`parser.rb` l.1337-1348) never sets
 * `list_block.attributes['start']`, and the 2.0.26 binary renders
 * `5. five` / `6. six` as a bare `<ol class="arabic">` with no
 * `start`. Fact 1 above is therefore the oracle's behavior, not
 * Ruby's. We follow the oracle - it is what this suite, the
 * conformance corpus and the sweeps all compare against - and the
 * decision would stand on facts 2 and 3 alone in any case.
 *
 * Three failure modes are pinned, and all three are the same root
 * cause, a marker line the classifier did not know:
 *
 * - the list folded into one paragraph, its numbers becoming prose;
 * - reflow MANUFACTURING a list, by landing a year (`2020.`) at an
 *   output line start where the oracle reads a marker;
 * - an unordered marker line under an explicit ordered item folded
 *   into that item's text, rendering literal asterisks.
 */
import { describe, expect, test } from "vitest";
import { formatAdoc, renderedHtml } from "../helpers.js";

/**
 * The three assertions every row makes: the exact bytes, the oracle's
 * rendering unchanged, and a second pass that changes nothing.
 * @param input - the source document
 * @param expected - the bytes the formatter must produce
 * @param printWidth - the width to reflow at, where a row varies it
 */
async function expectRow(
  input: string,
  expected: string,
  printWidth?: number,
): Promise<void> {
  const options = printWidth === undefined ? undefined : { printWidth };
  const out = await formatAdoc(input, options);
  expect(out).toBe(expected);
  expect(await renderedHtml(out)).toBe(await renderedHtml(input));
  expect(await formatAdoc(out, options)).toBe(out);
}

describe("an explicit ordered list is a LIST, and round-trips byte for byte", () => {
  test.each([
    ["arabic", "1. one\n2. two\n3. three\n"],
    ["loweralpha", "a. one\nb. two\n"],
    ["upperalpha", "A. one\nB. two\n"],
    ["lowerroman", "i) one\nii) two\niii) three\n"],
    ["upperroman", "I) one\nII) two\n"],
    ["multi-digit arabic", "10. ten\n11. eleven\n"],
    // Out-of-sequence numbers are the author's; Asciidoctor warns and
    // renders 1, 2, 3 either way, so there is nothing to renumber and
    // the bytes stand.
    ["out-of-sequence arabic", "1. one\n5. five\n2. two\n"],
    ["a single item", "1. lonely\n"],
  ])("%s", async (_name, input) => {
    await expectRow(input, input);
  });

  // Before the fix each of these folded into one paragraph: the
  // marker lines were prose, so `<li>one 2. two</li>` is what the
  // formatted output rendered.
  test("the fold that used to happen no longer does", async () => {
    const html = await renderedHtml(await formatAdoc("1. one\n2. two\n"));
    expect(html).toContain("<li>");
    expect(html).not.toContain("2. two");
  });
});

describe("the list's start offset survives the round trip", () => {
  // The oracle's `resolveOrderedListStart` (index.cjs l.13396) reads
  // the FIRST item's marker: an arabic number, a letter's position in
  // the alphabet, or a roman numeral's value. Normalizing any of
  // these to `.` would rewrite the start to 1, which is why the
  // spelling is data. Ruby 2.0.26 emits no `start` at all here - see
  // the divergence note in this file's header; the assertions below
  // are against the oracle, which is what every harness compares to.
  test.each([
    ["arabic from 5", "5. five\n6. six\n", 'start="5"'],
    ["arabic from 0", "0. zero\n1. one\n", 'start="0"'],
    ["loweralpha from c", "c. cee\nd. dee\n", 'start="3"'],
    ["upperalpha from C", "C. cee\nD. dee\n", 'start="3"'],
    ["lowerroman from iii", "iii) three\niv) four\n", 'start="3"'],
    ["upperroman from III", "III) three\nIV) four\n", 'start="3"'],
    // The shape the local-document sweep found: a year, alone as an
    // item, is an ordered list starting at 2020.
    ["a year", "2020. was a year\n", 'start="2020"'],
  ])("%s", async (_name, input, startAttribute) => {
    await expectRow(input, input);
    expect(await renderedHtml(input)).toContain(startAttribute);
  });
});

describe("style equality decides what nests, exactly as the oracle does", () => {
  // `is_sibling_list_item?` compares RESOLVED markers, so every
  // arabic spelling continues one list while an implicit `.` opens a
  // nested one, and the reverse. Each row's nesting is the oracle's;
  // expectRow's rendering assertion is what checks it.
  test.each([
    ["implicit nested under explicit", "1. one\n. sub\n2. two\n"],
    ["explicit nested under implicit", ". one\n1. sub\n. two\n"],
    ["loweralpha nested under arabic", "1. one\na. sub\nb. sub2\n2. two\n"],
    ["arabic nested under loweralpha", "a. one\n2. sub\nb. two\n"],
    ["roman nested under arabic", "1. one\ni) sub\n2. two\n"],
    ["a dot run nested under explicit", "1. one\n.. sub\n2. two\n"],
    // Two spellings of the SAME style are siblings, not a nesting.
    ["different arabic spellings are one list", "1. one\n7. seven\n"],
  ])("%s", async (_name, input) => {
    await expectRow(input, input);
  });
});

describe("shapes one character away from a marker stay prose", () => {
  // `OrderedListRx` takes `\d+\.`, `[a-zA-Z]\.` and `[IVXivx]+\)` and
  // nothing else, so each of these is a paragraph the formatter is
  // free to reflow into one line.
  test.each([
    ["arabic with a paren", "1) one\n2) two\n", "1) one 2) two\n"],
    ["loweralpha with a paren", "a) one\nb) two\n", "a) one b) two\n"],
    ["multi-letter alpha", "ab. one\nac. two\n", "ab. one ac. two\n"],
    ["a letter outside IVXivx", "l) one\nc) two\n", "l) one c) two\n"],
  ])("%s", async (_name, input, expected) => {
    await expectRow(input, expected);
  });
});

describe("reflow may not MANUFACTURE an ordered list", () => {
  // A paragraph is greedy, so a year mid-paragraph is prose wherever
  // the packer puts it EXCEPT at a line start inside a list item,
  // where `read_lines_for_list_item` reads a nested marker. Reflow
  // does not know which kind of paragraph it is printing, so the word
  // is fused backwards in both - a line longer by one word where the
  // hazard was not real, and the source's own structure where it was.
  test("a year fused backwards inside a nested item", async () => {
    await expectRow(
      "* a\n** bbb ccc ddd eee fff ggg hhh iii jjj 2020. was notable and words\n",
      "* a\n** bbb ccc ddd eee fff ggg hhh iii\n   jjj 2020. was notable and words\n",
      40,
    );
  });

  test("a year fused backwards in a plain paragraph", async () => {
    await expectRow(
      "aaa bbb ccc ddd eee fff ggg hhh iii jjj 2020. was notable and more\n",
      "aaa bbb ccc ddd eee fff ggg hhh iii\njjj 2020. was notable and more\n",
      40,
    );
  });

  // A `+`-attached paragraph breaks at the OPEN list's own style, so
  // inside an explicit arabic list a `2020.` line at column 0 ends the
  // paragraph and starts a sibling ITEM. Fusing it backwards is what
  // keeps the continuation whole.
  test("a year fused backwards in a continuation paragraph", async () => {
    await expectRow(
      "1. one\n+\naaa bbb ccc ddd eee fff ggg hhh iii 2020. was notable\n",
      "1. one\n+\naaa bbb ccc ddd eee fff ggg hhh\niii 2020. was notable\n",
      40,
    );
  });

  // The author's own break is a different case: the source already
  // has the marker at a line start, so the reading is already a list
  // and replaying the break preserves it.
  test("a year the AUTHOR put at a line start keeps its line", async () => {
    await expectRow(
      "* bullet text that runs on for a while so the packer has room\n2020. was a year of note\n",
      "* bullet text that runs on for a while so the packer has room\n2020. was a year of note\n",
    );
  });

  // The block-start net, on the plain-text path: `.` alone on a line
  // is not a marker, but `.` with anything after it is. The break the
  // author wrote behind it is kept even though the word after it is
  // itself fused backwards as block syntax.
  test("a lone dot keeps the break the author wrote behind it", async () => {
    await expectRow(".\n1. c\n", ".\n1. c\n");
  });
});

describe("an unordered marker under an explicit ordered item nests", () => {
  // The third measured failure mode, and the same root cause: while
  // `1. First step` was a PARAGRAPH, the `* sub` line under it was
  // greedy prose and folded in, rendering a literal asterisk. As a
  // list item's text it is `read_lines_for_list_item`'s nested-list
  // marker instead.
  test.each([
    [
      "star under arabic",
      "1. First step\n* sub bullet\n* another\n2. Second\n",
    ],
    ["dash under arabic", "1. First\n- sub\n"],
    ["star under loweralpha", "a. First\n* sub\n"],
    ["star under lowerroman", "i) First\n* sub\n"],
  ])("%s", async (_name, input) => {
    await expectRow(input, input);
  });

  test("the bullet is a list, not an asterisk in the prose", async () => {
    const html = await renderedHtml(
      await formatAdoc("1. First step\n* sub bullet\n"),
    );
    expect(html).toContain('<div class="ulist">');
    expect(html).not.toContain("* sub bullet");
  });
});
