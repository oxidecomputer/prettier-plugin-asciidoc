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
import { nodeFieldsByType } from "../../scripts/ast-node-fields.js";
import { astFields } from "../../scripts/fact-inventory.js";
import { REPO_ROOT } from "../../scripts/metrics/model.js";
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

describe("every lens row names something src/ast.ts declares", () => {
  // The lens is keyed on `<node type>.<field>` strings typed out by
  // hand, and a row that matches nothing is not inert: the field
  // falls through to the DEFAULT lens, which is the widest licence
  // there is.
  //
  // WHAT THIS ADDS over the pair rows below, which is not "a red
  // where there was none": a misspelt row for a field some pair row
  // exercises is already caught by that pair, so
  // `paragraph.secondLineIndnt` reds three existing tests. What those
  // cannot catch is a row for a field no pair happens to reach, and
  // they say nothing at all about `VERBATIM_CONTEXTS` and
  // `VERBATIM_BY_VALUE`, which name node kinds and fields with no
  // lens row to owe a pair. This block is the check that does not
  // depend on some other row happening to cover the field.
  const byType = nodeFieldsByType(REPO_ROOT);
  const declared = new Set(astFields(REPO_ROOT).map((one) => one.property));

  test.each(Object.keys(REPARSE_LENS))("%s", (key) => {
    const [type, field] = key.split(".");
    // `*` is the row that applies to every node kind, so its field
    // has to be declared SOMEWHERE rather than on one interface; one
    // assertion over both, because a conditional one would be a
    // second claim nothing counted.
    const named =
      type === "*" ? declared.has(field) : byType.get(type)?.has(field);
    expect(named).toBe(true);
  });

  test.each([...VERBATIM_CONTEXTS])("%s is a node type", (type) => {
    expect(byType.has(type)).toBe(true);
  });

  test.each(VERBATIM_BY_VALUE.map((row) => [row.type, row] as const))(
    "%s's by-value row names its own fields",
    (_type, row) => {
      const fields = byType.get(row.type);
      expect(fields?.has(row.field)).toBe(true);
      expect(fields?.has(row.discriminant)).toBe(true);
    },
  );
});

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
      // The ALIKE pair is the JOIN: two source lines become one, so
      // the output has no second line to carry a run and records `""`
      // whatever the author wrote. The APART pair differs in the same
      // field AND in a word, which is what no license may launder.
      "the indent a paragraph's second source line carried",
      ["paragraph.secondLineIndent"],
      ["a\n b c\n", "a\nb c\n"],
      ["a\n b c\n", "a b d\n"],
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

describe("the lens sees each corruption, and one arm names it", () => {
  // Red-then-green in the other direction: these are documents whose
  // formatted output re-reads as something else, and every one of
  // them is a ledgered mechanism. If a future widening of the lens
  // silenced one, this file says so before the ledger does.
  //
  // Each row also names the FAMILY, and names it as the only one, so
  // the arm that recognizes the mechanism is exercised on a document
  // spelled here rather than only on whatever coordinate a generated
  // grid happens to reach. The `. T` row, the `term::` row above a
  // folded `+` and the four-backtick row are documents `gap-line-lost`
  // must REFUSE, and every one of them was red before it was narrowed
  // to the structure its family text names (issue #202) - it claimed
  // the four-backtick document outright and the folded `+` alongside
  // `plus-respelled`. The shapes that family OWNS are no longer
  // spelled here: issues #171 and #212 fixed every one of them, and
  // what keeps it live is a corpus reflow join with no description in
  // it.
  //
  // #73 had a row here ("[[3-blind-mice]]\n\n ----\n") and no longer
  // does: a paragraph whose whole line is a `[[...]]` anchor now records
  // the separation the author wrote under it
  // (`ParagraphNode.blankBelowAnchorLine`, src/ast.ts) and the printer
  // writes that separation back, so the document round-trips and the
  // family is empty in the ledger. A row asserting a breach that no
  // longer happens would be red, and there is no second document with
  // the mechanism to put in its place.
  //
  // #170 had one too ("* item\n+\n// c\n```\nfoo\n```\n") for the same
  // reason: a fence's `[source]` line is the block's FIRST printed
  // line, so the separator no longer stacks it under the line a list
  // item's region takes, and the whole `fence-style-detached` family
  // is empty in the ledger. That mechanism has no second document
  // either - every spelling of it was the same emission.
  test.each([
    // `===\n ----\n` used to stand here and no longer does: the
    // block-start hazard net writes the second line's own indent back
    // (`ParagraphNode.secondLineIndent`, src/ast.ts), so that document
    // round-trips. The family's other arm is still live - the net
    // bails on a first atom that may not end a line, and a lone `+`
    // is exactly that, so the indent under it is still dropped.
    [
      "a de-indented line becomes a block (#121)",
      "+\n ----\n",
      "indent-dropped",
    ],
    [
      // The same mechanism, one respelling later, and the row no arm
      // claimed until the arm stopped comparing whole line counts
      // (issue #248): the de-indented line here is a fence, so the
      // output spells it `[source]` over a `----` pair and comes out
      // longer than the source it corrupted.
      "the de-indented line is a fence (#121)",
      "+\n ```x -> y\n```\n",
      "indent-dropped",
    ],
    [
      // TWO changes inside one diff: a hard break keeps the item's
      // second line from joining, so its indent goes AND the `+`
      // under the ordered list is respelled, and the divergence
      // window spans both. Red until the arm asked the breach's own
      // diff for the block its family text names: a de-indent that
      // opens nothing is not this mechanism, and the byte test alone
      // answers about the document rather than about the breach, so
      // it claimed this alongside `plus-respelled`.
      "a de-indent that opens no block is not this (#116)",
      "* a +\n  b\n\n. T\n  +\n",
      "plus-respelled",
    ],
    [
      "a join closes a bracket and mints a macro (#124)",
      "image::a.png[\n[+1]\n",
      "join-changes-reading",
    ],
    [
      "a folded lone + comes back as {plus} (#116)",
      ". T\n  +\n",
      "plus-respelled",
    ],
    [
      // The same folded `+` with a description term in front of it,
      // which is a term, a line, a gap and a dropped `+` in that
      // order and no part of `gap-line-lost`'s item: the `+` belongs
      // to the ordered list four lines down. Red until the arm asked
      // for the four lines ADJACENT, which claimed this alongside
      // `plus-respelled`.
      "an unrelated term above a folded + (#116)",
      "term::\nbody\n\n. T\n  +\n",
      "plus-respelled",
    ],
    // #170 and every #171 coordinate had a row here and no longer do.
    // A fence's `[source]` line is now the block's FIRST printed line,
    // so it no longer detaches (`printsSourceAttributeLine`,
    // src/block-metadata.ts), and a description the head drain would
    // take now keeps the detached `+` that stops it
    // (`drainTakesWholeBody`, src/print/join.ts), as does the `// c`
    // body whose deleted line rendered nothing. Both families
    // round-trip every document that used to be spelled here, so
    // neither has a row to put in its place.
    [
      "a heading read under a bare term (#186)",
      "term::\n```x\n----\nfoo\n----\n",
      "heading-under-a-term",
    ],
    [
      "a shorthand xref whose text spans a break (#169)",
      "Want to learn <<tigers,\nabout tigers>>?\n\n[[tigers]]t\n",
      "xref-across-a-break",
    ],
    [
      // Four backticks are not a fence, so these are three lines of
      // prose that reflow folds into one, and the fold is visible
      // through the narrowed lens. The document is one line SHORTER
      // and says one word MORE (the unterminated `~~~~` prints as a
      // closed pair), which is what used to send it to `gap-line-lost`
      // and what the folded-break reading of the diff now keeps here.
      "a four-backtick fence is prose a fold rewrites (#124)",
      '````ruby\nputs "Hello, World!"\n````\n\n~~~~ javascript\nalert("Hello, World!")\n~~~~\n',
      "join-changes-reading",
    ],
  ])("%s", async (_what, document, family) => {
    const outcome = await reparseOutcomeOf(document);
    expect(outcome.breaches.length).toBeGreaterThan(0);
    for (const breach of outcome.breaches) {
      expect(
        matchingFamilies({
          source: document,
          once: outcome.once,
          signature: breach.signature,
        }),
        breach.signature,
      ).toEqual([family]);
    }
  });
});

describe("the family arms are told apart by what they say", () => {
  // A table whose rows are distinguished by the ORDER of its lines is
  // a table a reader cannot check one line at a time. Every ledgered
  // row is therefore claimed by EXACTLY one arm: none left without a
  // mechanism, and none claimed by two, with no exception list to
  // hold the difference. Red before the arm narrowing of issue #202:
  // ten rows were claimed twice, nine by `plus-respelled` alongside
  // `gap-line-lost` and one by `xref-across-a-break` alongside it.
  test("every ledgered row is claimed by exactly one arm", async () => {
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
    // Exactly one arm, and it is the family the row is pinned under.
    // One assertion over both halves, reported as the pair, because
    // "claimed by nobody" and "claimed by two" are the same hole seen
    // from either side and a reader wants to see which rows and by
    // what.
    expect(
      claims
        .filter(
          (one) => one.claimed.length !== 1 || one.claimed[0] !== one.family,
        )
        .map((one) => `${one.id} :: ${one.claimed.join("+")}`),
    ).toEqual([]);
  });

  // Documents no population spells, whose own TEXT holds the arrow
  // the projection diff is written with. The arms that read a diff
  // must split it at the last `] -> [` and not the first ` -> `, or
  // a title like `.a -> b` sends them half a side: they ask about
  // the START of a side, so a mis-split answers silently rather than
  // loudly. Each row is the same mechanism as a ledgered twin whose
  // text carries no arrow, and each must be CLAIMED - an allowlist
  // would record the hole instead of closing it.
  //
  // All three used to be spelt over the #73 mechanism (a rejected
  // anchor line above a blank), and two of them were then respelt
  // over #170's. Both mechanisms are fixed, so a document built on
  // either round-trips and asserts nothing; these are the second
  // replacements, one per LIVE family, each carrying the arrow
  // somewhere the projection diff reproduces it - a comment line's
  // text, a fence line's language token, a block macro's attrlist.
  test.each([
    ["a comment line carrying an arrow", "term::\n/// a -> b\n\n+\n"],
    [
      "a fence language that is an arrow pair",
      "term::\n```x -> y\n---------\n",
    ],
    ["a block macro whose attrlist holds one", "image::a.png[a -> b\n[+1]\n"],
  ])("%s is claimed by exactly one arm", async (_name, source) => {
    const outcome = await reparseOutcomeOf(source);
    // The row is a breach at all: a document that round-trips would
    // make the claim below vacuous.
    expect(outcome.breaches.length).toBeGreaterThan(0);
    for (const breach of outcome.breaches) {
      // One arm, the same rule the ledger's own rows are held to: a
      // mis-split that let a second arm through would otherwise read
      // as a claim.
      expect(
        matchingFamilies({
          source,
          once: outcome.once,
          signature: breach.signature,
        }),
        breach.signature,
      ).toHaveLength(1);
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
