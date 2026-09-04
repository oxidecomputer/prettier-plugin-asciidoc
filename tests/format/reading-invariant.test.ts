/**
 * The REFLOW RE-CLASSIFICATION INVARIANT's named rows (issue #58).
 *
 * The invariant itself - `readingOf(format(d)) == readingOf(d)`, plus
 * the second-pass clause when the bytes moved - is defined in
 * tests/lib/reading.ts and gated in three places: the conformance
 * corpus (the `reading` property in tests/conformance/properties.ts),
 * the two list-shape sweeps (the ledger gate in
 * list-shape-sweep.test.ts and its deep twin), and here.
 *
 * THIS file holds the shapes no corpus case and no sweep alphabet
 * spells: the issues the invariant was designed against, each pinned
 * with its number in the test name. Two of them do NOT reproduce at
 * this revision and are asserted CLEAN on purpose - that is the whole
 * value of writing them down, because nothing else in the suite
 * guards them and a regression would otherwise be silent. The
 * projection-side companion rows (what the corrupted spelling WOULD
 * read as) live in tests/lib/reading.test.ts, so those keep their
 * meaning whether or not the corruption still happens.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { loadCorpus } from "../conformance/loader.js";
import { formatAdoc } from "../helpers.js";
import { readingBreachesOf, untracedLines } from "../lib/reading.js";

/**
 * The invariant's verdict for one document, as printable rows.
 * @param source - the document to format twice and assess
 * @returns one `pass signature` string per failing pass
 */
async function breachRows(source: string): Promise<string[]> {
  const breaches = await readingBreachesOf(source);
  return breaches.map((breach) => `${breach.pass} ${breach.signature}`);
}

describe("the invariant holds on ordinary documents", () => {
  test.each([
    ["a paragraph that reflows", "one two three four five six seven\n"],
    ["a list whose item text folds", "* a\nX\nY\n"],
    ["a nested list", "* a\n** b\n*** c\n"],
    ["a list continuation", "* a\n+\npara\n"],
    ["a fenced block respelled as a listing", "```rust\nfn main() {}\n```\n"],
    // The printer keeps a metadata line above the fence and puts its
    // own `[source,...]` under it, so both sides read two attrlines.
    // A projection that deduped by position reported this ordinary
    // document as a violation.
    ["a metadata line above a fence", "[role]\n```rust\nfn main() {}\n```\n"],
    [
      "an attrline above a fence that already names the style",
      "[source,rust]\n```\nfn main() {}\n```\n",
    ],
    ["an attribute entry", ":Foo: bar\n\npara\n"],
    ["a section with a title and an anchor", "[[anc]]\n.T\n== S\n\npara\n"],
    ["an admonition", "NOTE: a note that is short.\n"],
    ["a literal paragraph", "para\n\n  lit\n  more\n\npara\n"],
    ["a delimited block with list-shaped content", "----\n* a\n** b\n----\n"],
    // A table whose CELL TEXT is shaped like block syntax (issue #10).
    // Half of the old reason for these rows still holds and half does
    // not. What holds: a cell's text is still never re-read, so no
    // reflow can manufacture a list item or a heading out of it, and
    // that is the day these rows were written for. What does not: an
    // accepted table's bytes are no longer the author's, so the cell
    // text now MOVES between two separator-bounded positions, and the
    // reading has to survive the move rather than survive by nothing
    // happening. The last row is the control: it declines, so its
    // interior is replayed exactly as before.
    [
      "a table whose cells look like block syntax",
      "|===\n|* item\n|== heading\n|===\n",
    ],
    [
      "a table whose block-shaped cell text is relaid out",
      "|===\n|  * item\n|==   heading\n|===\n",
    ],
    [
      "a table whose second row is rejoined onto one line",
      "|===\n|a |b\n\n|* item\n|== heading\n|===\n",
    ],
    [
      "a table holding a dropped comment line",
      "|===\n|* item\n// c\n|== heading\n|===\n",
    ],
  ])("%s", async (_name, source) => {
    expect(await breachRows(source)).toEqual([]);
  });
});

describe("the known-issue table (issue #58, section 4.4)", () => {
  // FIXED, and pinned clean. #43's render-corrupting face: the lone
  // `+` was joined with the term line after it, and the join
  // MANUFACTURED a description-list term (`+ term2:: def2`). The `+`
  // now keeps the output line the source gave it, which is what
  // emptied the depth-5 ledger's 710-row lone-plus-join family. The
  // projection-side row - what the corrupted spelling reads as - lives
  // in tests/lib/reading.test.ts, so it keeps its meaning here.
  test("#43: a lone + before a term line keeps its own line", async () => {
    expect(await breachRows("+\nterm2:: def2\n")).toEqual([]);
  });

  // FIXED, and pinned clean. #45 appeared on the pass-1/pass-2 PAIR,
  // not on pass 1: the label split kept the surplus blanks in the
  // variant, the printer wrote a second colon after them
  // (`NOTE:  : text`), and only the second pass read the residue as a
  // description-list delimiter. No corpus case and no sweep document
  // shows this shape, so this row is the whole guard.
  test("#45: an admonition label keeps one colon run", async () => {
    expect(await breachRows("NOTE:    text\n")).toEqual([]);
  });

  // NON-REPRODUCING at this revision, and pinned clean. Pass 1 is
  // already a fixed point; the historical corrupted spelling
  // (`[[3-bad]] == S`) is inside the net - see the projection row in
  // tests/lib/reading.test.ts - so this row guards the regression.
  test("#46 shape 1: an anchor before a section heading stays clean", async () => {
    expect(await breachRows("[[3-bad]]\n\n== S\n")).toEqual([]);
  });

  // #46 shape 2 was a blank-line wobble, which is OUTSIDE this net by
  // design (blank placement is owned by the idempotence and
  // render-equality nets - a gap-sensitive projection was measured
  // and floods). The row records that boundary; the wobble itself is
  // FIXED - the printed-line record now counts out the children the
  // printer emits nothing for, and the pass-1 spelling and its
  // render-equality are pinned in tests/format/block-attributes.test.ts.
  // The reading was compatible either way, which is why it took a
  // different net to catch it.
  test("#46 shape 2 is reading-compatible whichever blank it takes", async () => {
    expect(await breachRows("[[3-bad]]  \n----\nfoo\n----\n")).toEqual([]);
  });

  // NON-REPRODUCING at this revision: both corpus cases the issue
  // names format cleanly and reading-stably, and no #27 row remains
  // in quarantine.json. The mechanism is armed - a reflow that
  // promotes an indented remainder to a literal paragraph reads as
  // `[] -> [indented text]`, pinned in tests/lib/reading.test.ts - so
  // these two rows are the regression guard.
  test.each([
    [
      "the ruby class body (reader_test.rb)",
      "class Dog\n  def initialize breed\n    @breed = breed\n  end\n\n  def bark\n    if @breed == 'beagle'\n      'woof woof woof woof woof'\n    else\n      'woof woof'\n    end\n  end\nend\n",
    ],
    [
      "the hanging-indent list items (lists_test.rb)",
      "== Example 1\n\n- Foo\n  Bar\n. Foo\n\n== Example 2\n\n* Item\n  text\nterm:: def\n",
    ],
  ])("#27: %s stays clean", async (_name, source) => {
    expect(await breachRows(source)).toEqual([]);
  });

  // #57's two faces are provably OUTSIDE the net: the divergence lives
  // in Asciidoctor's own reading, and our classifier reads both sides
  // the same. They stay pinned by the deep sweep's render-equality
  // allowlist. Asserted here so the boundary is a fact in the suite
  // rather than a claim in a document.
  test.each([
    ["face 1, within_nested_list fold", "* a\nX\n// c\n+\npara\n** b\n"],
    [
      "face 2, the .T our parser reads as text",
      "* a\n[role]\npara\n[[anc]]\n.T\npara\n",
    ],
  ])(
    "#57 %s is outside the net (our own reading is unchanged)",
    async (_name, source) => {
      expect(await breachRows(source)).toEqual([]);
    },
  );

  // #65's tail-reading-flip mechanism, in the two shapes the depth-5
  // sweep spells. Both used to breach: an anchor standing in the
  // item's SECOND block was read as that block's own metadata, so the
  // line behind it reflowed into prose and its reading flipped. The
  // anchor now ends any block after the item's first
  // (INTERRUPTERS_BY_CONTEXT's `listItem` row,
  // src/parse/line-shapes.ts), the line behind it keeps its own line,
  // and the flip is gone. They stay here as the regression guard.
  test.each([
    [
      "a trailing indented line stays a literal",
      "* a\n[role]\npara\npara\n[[anc]]\n  lit\n",
    ],
    [
      "a trailing .T stays a block title",
      "* a\n[role]\npara\npara\n[[anc]]\n.T\n",
    ],
  ])("#65: %s", async (_name, source) => {
    expect(await breachRows(source)).toEqual([]);
  });
});

// The format fixtures are hand-written documents nobody generated, so
// they occasionally spell shapes the sweep alphabets and the corpus do
// not. Running the invariant over them is two parses each.
const FIXTURE_DIR = "tests/format/fixtures/identity";
const fixtures = readdirSync(FIXTURE_DIR).filter((name) =>
  name.endsWith(".adoc"),
);

describe("the invariant holds over the format fixtures", () => {
  // A floor, not a formality: an empty fixture directory would make
  // every row below vacuous and the suite would still be green.
  test("the fixture directory is not empty", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  test.each(fixtures)("%s", async (name) => {
    const source = readFileSync(path.join(FIXTURE_DIR, name), "utf8");
    expect(await breachRows(source)).toEqual([]);
    // Their OUTPUT too: a fixture is an identity fixture, so this is
    // usually the same document, but it costs nothing to say so.
    expect(await breachRows(await formatAdoc(source))).toEqual([]);
  });

  // The trace-fidelity self-check over the same inputs: under-tracing
  // would make the rows above pass on a projection that measured less
  // than it thinks it did.
  test.each(fixtures)("%s leaves no untraced line", (name) => {
    const source = readFileSync(path.join(FIXTURE_DIR, name), "utf8");
    expect(untracedLines(source)).toEqual([]);
  });
});

// The same self-check over the CORPUS, which is where it belongs and
// where it had never been pointed: the generator runs it over the
// sweep products, whose alphabet spells no byte-order mark, and the
// loop above runs it over a handful of hand-written files. The one
// corpus input that opens with a mark had its whole first line fall
// through to `opaque`, so its reading was empty on both sides and the
// `reading` property passed it vacuously - a shape this check was
// written to notice, going unnoticed because nothing asked it about
// real documents. Two parses per case, ~40 ms over the whole corpus.
describe("the trace-fidelity self-check over the corpus", () => {
  const cases = loadCorpus().flatMap((group) => group.cases);

  // A floor, for the fixture loop's reason: an empty corpus would
  // make the row below vacuous and green.
  test("the corpus is not empty", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  test("no corpus case leaves an untraced line", () => {
    const untraced = cases
      .filter((corpusCase) => untracedLines(corpusCase.input).length > 0)
      .map((corpusCase) => corpusCase.id);
    expect(untraced).toEqual([]);
  });
});
