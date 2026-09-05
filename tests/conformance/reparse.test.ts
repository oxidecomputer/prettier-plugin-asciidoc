/**
 * The reparse gate: the pin over the measurement, and the proof that
 * the lens the measurement looks through is not a hole.
 *
 * Two halves, and the second is the load-bearing one.
 *
 * THE PIN asserts set equality against
 * tests/conformance/reparse-ledger.json, so a printer change that
 * adds a breach turns this red and one that removes a breach has to
 * say which family it emptied. That is what makes a later predicate
 * deletion in `src/print` a measured claim rather than a hope.
 *
 * THE PERTURBATION PROOF is the answer to the obvious objection: a
 * lens wide enough to let the formatter's own normalizations through
 * could be wide enough to let a corruption through with them. Every
 * licensed difference in `REPARSE_LENS` therefore ships a PAIR here -
 * two documents that differ in exactly that field and must project
 * ALIKE, and two that differ in the same field for a reason the
 * license does not cover and must project APART. A row with only the
 * first half is an assertion that the lens is wide; a row with both
 * is a measurement of where it stops.
 */
import { describe, expect, test } from "vitest";
import {
  MINIMUM_DEFAULT_POPULATION,
  defaultTierCases,
  deepTierCases,
  isDefaultTier,
  ledgerKey,
  loadReparseLedger,
  matchingFamilies,
  measuredKeys,
} from "./reparse-ledger.js";
import {
  REPARSE_LENS,
  REPARSE_REWRITES,
  VERBATIM_BY_VALUE,
  VERBATIM_CONTEXTS,
  projectionOf,
  reparseBreachesOf,
  reparseOutcomeOf,
  verbatimByValueKey,
} from "./reparse.js";

/**
 * The tokens two documents project to, for the pair assertions.
 * @param document - the document to read
 * @returns its projection as one comparable string
 */
function projected(document: string): string {
  return projectionOf(document).tokens.join("\n");
}

describe("the lens licenses what the printer normalizes", () => {
  // Each row: [what the license is, two spellings that must project
  // alike, two that must not]. The "apart" half of every row differs
  // in the SAME field as the "alike" half, so it cannot pass by
  // accident on some other difference.
  const rows: Array<
    [string, readonly string[], [string, string], [string, string]]
  > = [
    [
      "byte positions, which every rewrite moves",
      ["*.position", "*.offset"],
      ["para\n\nsecond\n", "para\n\n\nsecond\n"],
      ["para\n\nsecond\n", "para\n\nthird\n"],
    ],
    [
      "a span's constraint spelling",
      ["*.constrained"],
      ["**a** x\n", "*a* x\n"],
      ["**a** x\n", "**b** x\n"],
    ],
    [
      "whitespace runs inside prose",
      [],
      ["one  two\n", "one two\n"],
      ["one two\n", "onetwo\n"],
    ],
    [
      "a delimiter's length",
      ["delimitedBlock.sourceDelimiter"],
      ["====\nx\n====\n", "=====\nx\n=====\n"],
      ["====\nx\n====\n", "----\nx\n----\n"],
    ],
    [
      "where the first word of a paragraph ended its line",
      ["paragraph.firstWordEndsItsLine"],
      ["a\nb c\n", "a b c\n"],
      ["a\nb c\n", "a b d\n"],
    ],
    [
      "whether an item's text lines were indented",
      ["*.everyTextLineIndented"],
      ["* a\n  b\n", "* a\nb\n"],
      ["* a\n  b\n", "* a\n  c\n"],
    ],
    [
      "a table's opening line as written",
      ["table.open"],
      ["|===\n|a\n|===\n", "|=== \n|a\n|===\n"],
      ["|===\n|a\n|===\n", ",===\n|a\n,===\n"],
    ],
    [
      "the runs a table consumed before its first cell",
      ["table.leadingRuns"],
      ["|===\n\n|a\n|===\n", "|===\n|a\n|===\n"],
      ["|===\n\n|a\n|===\n", "|===\n\n|b\n|===\n"],
    ],
    [
      "a table cell's padding blanks",
      ["tableCell.opening", "tableCell.runs", "rewrite:tableCellFields"],
      ["|===\n| a | b\n|===\n", "|===\n|a|b\n|===\n"],
      ["|===\n|a|b\n|===\n", "|===\n|a|c\n|===\n"],
    ],
    [
      "blanks after an attribute list's commas",
      ["blockAttributeList.value", "delimitedBlock.annotatedBy"],
      ["[source, ruby]\n----\nx\n----\n", "[source,ruby]\n----\nx\n----\n"],
      ["[source,ruby]\n----\nx\n----\n", "[source,perl]\n----\nx\n----\n"],
    ],
    [
      // The blank tightened is the FIELD-separating one, outside the
      // quotes: the comma inside `"1,1"` is data (it is what keeps
      // `cols` reading as one two-column spec rather than two fields)
      // and the printer never touches a quoted value's interior
      // (tests/format/attrlist-whitespace.test.ts's own "interior
      // whitespace is content" row states the same boundary).
      "blanks after a table attribute line's commas",
      ["table.annotatedBy"],
      [
        '[cols="1,1", format=csv]\n|===\n|a|b\n|===\n',
        '[cols="1,1",format=csv]\n|===\n|a|b\n|===\n',
      ],
      [
        '[cols="1,1"]\n|===\n|a|b\n|===\n',
        '[cols="1,1,1"]\n|===\n|a|b\n|===\n',
      ],
    ],
    [
      "blanks after a block macro attrlist's commas",
      ["blockMacro.attrlist"],
      ["image::a.png[Tiger, link=self]\n", "image::a.png[Tiger,link=self]\n"],
      ["image::a.png[Tiger,link=self]\n", "image::a.png[Tiger,link=other]\n"],
    ],
    [
      "blanks after an inline macro attrlist's commas",
      ["inlineMacro.attrlist"],
      ["x image:a.png[Tiger, 2] y\n", "x image:a.png[Tiger,2] y\n"],
      ["x image:a.png[Tiger,2] y\n", "x image:a.png[Tiger,3] y\n"],
    ],
    [
      "an attribute entry's name case",
      ["attributeEntry.name"],
      [":He-Man: v\n\nx\n", ":he-man: v\n\nx\n"],
      [":he-man: v\n\nx\n", ":she-man: v\n\nx\n"],
    ],
    [
      "the blank a block anchor's reftext takes from the comma",
      ["blockAnchor.reftext"],
      ["[[a, R]]\nx\n", "[[a,R]]\nx\n"],
      ["[[a,R]]\nx\n", "[[a,S]]\nx\n"],
    ],
    [
      "the blank an inline anchor's reftext takes from the comma",
      ["inlineAnchor.reftext"],
      ["x [[a, R]] y\n", "x [[a,R]] y\n"],
      ["x [[a,R]] y\n", "x [[a,S]] y\n"],
    ],
    [
      "the source lines a description item replays, and its printing mode",
      [
        "descriptionTerm.line",
        "descriptionListItem.textLines",
        "descriptionListItem.printing",
      ],
      ["term::\nsome words\n", "term:: some words\n"],
      ["term:: some words\n", "term:: other words\n"],
    ],
    [
      "a shorthand xref's LEADING blank, and not its trailing one",
      ["xref.text"],
      ["<<a, b>> x\n\n[[a]]y\n", "<<a,b>> x\n\n[[a]]y\n"],
      ["<<a,b >> x\n\n[[a]]y\n", "<<a,b>> x\n\n[[a]]y\n"],
    ],
    [
      "a verbatim block's interior, which is content and not layout",
      ["verbatim:delimitedBlock"],
      ["----\ncode\n----\n", "----\ncode \n----\n"],
      ["----\n    code\n----\n", "----\n  code\n----\n"],
    ],
    [
      "a monospace span's interior run",
      ["verbatim:monospace"],
      ["`a b` x\n", "`a b` x\n"],
      ["`a  b` x\n", "`a b` x\n"],
    ],
    [
      "a passthrough's interior run",
      ["verbatim:passthrough"],
      ["+++a b+++ x\n", "+++a b+++ x\n"],
      ["+++a  b+++ x\n", "+++a b+++ x\n"],
    ],
    [
      "front matter's interior run",
      ["verbatim:frontMatter"],
      ["---\na: b\n---\nx\n", "---\na: b\n---\nx\n"],
      ["---\na:  b\n---\nx\n", "---\na: b\n---\nx\n"],
    ],
    [
      "a pass macro's text, which is its content",
      ["verbatim:inlineMacro.pass"],
      ["pass:[a b] x\n", "pass:[a b] x\n"],
      ["pass:[a  b] x\n", "pass:[a b] x\n"],
    ],
    [
      "whether a table was ever closed, and not its closing length",
      ["rewrite:tableFields"],
      ["|===\n|a\n|===\n", "|=======\n|a\n|=======\n"],
      ["|===\n|a\n", "|===\n|a\n|===\n"],
    ],
    [
      "a fenced block's respelling as a source listing",
      ["rewrite:fencedBlockFields"],
      ["```ruby\nx\n```\n", "[source,ruby]\n----\nx\n----\n"],
      ["```ruby\nx\n```\n", "[source,perl]\n----\nx\n----\n"],
    ],
    [
      "a block's trailing whitespace, and not its leading",
      [],
      ["para \n", "para\n"],
      [" para\n", "para\n"],
    ],
    [
      "the gap spelling between an item's blocks, and not the attachment",
      [],
      ["* a\n+\npara\n", "* a\n+\n\npara\n"],
      ["* a\n+\npara\n", "* a\n\npara\n"],
    ],
  ];
  test.each(rows)("%s", (_what, _covers, alike, apart) => {
    expect(projected(alike[0])).toBe(projected(alike[1]));
    expect(projected(apart[0])).not.toBe(projected(apart[1]));
  });

  // Completeness: a lens row with no pair above is a licensed
  // difference nobody has measured the edge of, which is exactly the
  // hole this file exists to rule out.
  test("every declared lens row has a pair", () => {
    const covered = new Set(rows.flatMap(([, keys]) => keys));
    // The verbatim CONTEXTS are lens rows too - they say a string
    // reaches the comparison as bytes rather than as layout - so they
    // owe the same pair, spelled `verbatim:<type>`. The `pass` macro
    // is one such context, and it is DERIVED from
    // `VERBATIM_BY_VALUE` rather than written out here, so a second
    // by-value exception cannot be added without owing a pair. So do
    // the node
    // REWRITES, which are the licensed differences a field row cannot
    // spell: each restates a recorded spelling as the fact it stands
    // for, and each can be too generous.
    const declared = [
      ...Object.keys(REPARSE_LENS),
      ...[...VERBATIM_CONTEXTS].map((type) => `verbatim:${type}`),
      ...VERBATIM_BY_VALUE.map((row) => verbatimByValueKey(row)),
      ...REPARSE_REWRITES.map((name) => `rewrite:${name}`),
    ];
    expect(declared.toSorted()).toEqual([...covered].toSorted());
  });
});

describe("the lens still sees the corruptions the printer can make", () => {
  // Red-then-green in the other direction: these are documents whose
  // formatted output re-reads as something else, and every one of
  // them is a ledgered mechanism. If a future widening of the lens
  // silenced one, this file says so before the ledger does.
  test.each([
    ["a de-indented line becomes a block (#121)", "===\n ----\n"],
    [
      "a join closes a bracket and mints a macro (#124)",
      "image::a.png[\n[+1]\n",
    ],
    [
      "a dropped blank stacks a rejected anchor as metadata (#73)",
      "[[3-blind-mice]]\n\n ----\n",
    ],
    ["a folded lone + comes back as {plus} (#116)", ". T\n  +\n"],
    [
      "a fence's style line detaches from its block (#170)",
      "* item\n+\n// c\n```\nfoo\n```\n",
    ],
    ["a term gap's + is not written back (#171)", "term::\n///\n\n+\n"],
  ])("%s", async (_what, document) => {
    const breaches = await reparseBreachesOf(document);
    expect(breaches.length).toBeGreaterThan(0);
  });
});

describe("the family arms are told apart by what they say", () => {
  // A table whose rows are distinguished by the ORDER of its lines is
  // a table a reader cannot check one line at a time. Every ledgered
  // row must therefore be claimed by exactly one arm, with the
  // exceptions the arm table documents and this asserts by name.
  // Both come from `gap-line-lost`'s deliberately loose test ("fewer
  // lines, and the text no longer says the same words"):
  //
  // - a respelt `+` is also a document that lost a line, so
  //   `plus-respelled` and `gap-line-lost` both claim those rows;
  // - a reflow join in a document that ALSO respells a bracket line
  //   is fewer lines and different words for the same reason, so
  //   `xref-across-a-break` and `gap-line-lost` both claim the row
  //   whose `[#tigers]` prints as `[[tigers]]`.
  //
  // Each pair must be exercised, below, so an exception cannot
  // outlive the overlap it excuses.
  const OVERLAPS = [
    ["plus-respelled", "gap-line-lost"],
    ["xref-across-a-break", "gap-line-lost"],
  ];

  test("every ledgered row is claimed by one arm, or the documented pair", async () => {
    const sources = new Map(deepTierCases().map((one) => [one.id, one.source]));
    const ledger = loadReparseLedger();
    const claims: Array<{ id: string; family: string; claimed: string[] }> = [];
    for (const row of ledger) {
      const source = sources.get(row.id) ?? "";
      // eslint-disable-next-line no-await-in-loop -- one document at a time, as scripts/reparse-ledger.ts explains
      const outcome = await reparseOutcomeOf(source);
      claims.push({
        id: row.id,
        family: row.family,
        claimed: matchingFamilies({
          source,
          once: outcome.once,
          signature: row.signature,
        }),
      });
    }
    // Every row is in the populations: a `""` source would claim
    // nothing and make the two assertions below vacuous.
    expect(claims.filter((one) => !sources.has(one.id))).toEqual([]);
    // The first arm to claim a row is the family it is pinned under.
    expect(
      claims
        .filter((one) => one.claimed[0] !== one.family)
        .map((one) => one.id),
    ).toEqual([]);
    // No row is claimed twice, except by a documented pair.
    const documented = new Set(OVERLAPS.map((pair) => pair.join("+")));
    expect(
      claims
        .filter(
          (one) =>
            one.claimed.length > 1 && !documented.has(one.claimed.join("+")),
        )
        .map((one) => one.id),
    ).toEqual([]);
    // Each exception is USED, not merely allowed: an assertion that
    // tolerates an overlap nothing exercises would pass a table that
    // had quietly become disjoint and left the exception behind.
    const seen = new Set(claims.map((one) => one.claimed.join("+")));
    expect([...documented].filter((pair) => !seen.has(pair))).toEqual([]);
  });

  // Documents no population spells, whose own TEXT holds the arrow
  // the projection diff is written with. The arms that read a diff
  // must split it at the last `] -> [` and not the first ` -> `, or
  // a title like `.a -> b` sends them half a side: they ask about
  // the START of a side, so a mis-split answers silently rather than
  // loudly. Each row is the same mechanism as a ledgered twin whose
  // text carries no arrow, and each must be CLAIMED - an allowlist
  // would record the hole instead of closing it.
  test.each([
    [
      "a block title carrying an arrow",
      "[[3-blind-mice]]\n\n.a -> b\n------\n",
    ],
    [
      "a block title that is only an arrow pair",
      "[[3-blind-mice]]\n\n.x -> y\n",
    ],
    [
      "a block macro whose attrlist holds one",
      "[[3-blind-mice]]\n\nimage::a.png[a -> b]\n",
    ],
  ])("%s is claimed by an arm", async (_name, source) => {
    const outcome = await reparseOutcomeOf(source);
    // The row is a breach at all: a document that round-trips would
    // make the claim below vacuous.
    expect(outcome.breaches.length).toBeGreaterThan(0);
    for (const breach of outcome.breaches) {
      expect(
        matchingFamilies({
          source,
          once: outcome.once,
          signature: breach.signature,
        }),
        breach.signature,
      ).not.toEqual([]);
    }
  });
});

describe("the reparse ledger, default tier", () => {
  test("the measured breaches are exactly the ledgered ones", async () => {
    const cases = defaultTierCases();
    // The measured-nothing floor, asserted BEFORE the comparison: set
    // equality is green when both sides are empty, so a corpus that
    // did not load would pass this gate rather than fail it.
    expect(cases.length).toBeGreaterThanOrEqual(MINIMUM_DEFAULT_POPULATION);
    const measured = await measuredKeys(cases);
    const pinned = loadReparseLedger()
      .filter((row) => isDefaultTier(row))
      .map((row) => ledgerKey(row));
    expect(measured.toSorted()).toEqual(pinned.toSorted());
  });
});
