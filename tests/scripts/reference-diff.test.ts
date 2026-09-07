/**
 * The reference-diff ledger's own gates: the ledger describes its own
 * rows, every row names a declared family, the normalization does
 * what its comment says, and the instrument defect it records still
 * reproduces.
 *
 * The reproduction row shells out to Ruby and skips by name where the
 * gem is not installed. The rest read the committed ledger, so a
 * ledger whose counts stopped describing its rows is caught by the
 * always-on suite rather than only by a batched run.
 */
import { describe, expect, test } from "vitest";
import {
  familyOf,
  isReadingFamily,
  loadReferenceDiffLedger,
  normalizeForComparison,
  verdictOf,
  FAMILIES,
  NOT_A_READING,
  REFUSED,
} from "../../scripts/lib/reference-diff.js";
import {
  referenceRenders,
  referenceVersion,
} from "../../scripts/lib/reference-runner.js";
import { formatAdoc, renderedHtml } from "../helpers.js";

const ledger = loadReferenceDiffLedger();

describe("the ledger describes its own rows", () => {
  test("the counts are the counts of the rows", () => {
    const byFamily: Record<string, number> = {};
    for (const row of ledger.rows) {
      byFamily[row.family] = (byFamily[row.family] ?? 0) + 1;
    }
    expect(ledger.counts.byFamily).toEqual(byFamily);
    expect(ledger.counts.differing).toBe(ledger.rows.length);
    expect(ledger.counts.identical + ledger.counts.differing).toBe(
      ledger.counts.documents,
    );
  });

  test("every reading row carries a verdict and a reason", () => {
    // A reading row nobody has judged is the one the gate refuses:
    // the ledger is the only record there is, because nothing is
    // reported to any other repository.
    const unjudged = ledger.rows.filter(
      (row) =>
        isReadingFamily(row.family) &&
        (verdictOf(row.verdict) === "unjudged" || row.why.trim() === ""),
    );
    expect(unjudged.map((row) => row.id)).toEqual([]);
  });

  test("a converter row carries no verdict", () => {
    const wrong = ledger.rows.filter(
      (row) => !isReadingFamily(row.family) && row.verdict !== NOT_A_READING,
    );
    expect(wrong.map((row) => row.id)).toEqual([]);
  });

  test("the version skew the rows sit in is named in the header", () => {
    // Half the reading rows are that skew, and a reader who does not
    // know it reads them as defects.
    expect(ledger.versionSkew).toContain("2.0.26");
    expect(ledger.versionSkew).toContain("ae5891df");
  });

  test("every row names a declared family", () => {
    const declared = new Set(FAMILIES.map((family) => family.name));
    const named = new Set(ledger.rows.map((row) => row.family));
    expect([...named].filter((name) => !declared.has(name))).toEqual([]);
  });

  test("every family carries a classification and a reason", () => {
    for (const family of FAMILIES) {
      expect(`${family.name}: ${family.reason}`.length).toBeGreaterThan(
        family.name.length + 20,
      );
      expect(["environment", "converter", "reading"]).toContain(
        family.classification,
      );
    }
  });

  test("the row ids are unique and sorted", () => {
    const ids = ledger.rows.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(ids.toSorted());
  });
});

describe("the normalization two converters are compared through", () => {
  test("each program's own version is neutralized, other numbers are not", () => {
    expect(normalizeForComparison("<p>on 2.0.26 of 1.2.3</p>", "2.0.26")).toBe(
      "<p>on <version> of 1.2.3</p>",
    );
  });

  test("a clock value is neutralized, because two processes read two clocks", () => {
    expect(
      normalizeForComparison("<p>2026-09-06 21:50:17 -0400</p>", "2.0.26"),
    ).toBe("<p><date> <time></p>");
  });

  test("the conformance fold still applies, so a line break is not a difference", () => {
    expect(normalizeForComparison("<p>a\n  b</p>", "2.0.26")).toBe(
      "<p>a b</p>",
    );
  });
});

describe("classification", () => {
  test("a refusal on either side is a reading difference", () => {
    const family = familyOf(REFUSED, "<p>a</p>");
    expect(family.name).toBe("refusal-mismatch");
    expect(family.classification).toBe("reading");
  });

  test("two spellings of the same column width are a converter difference", () => {
    const family = familyOf(
      '<table><col style="width: 50%;"></table>',
      '<table><col width="50%"></table>',
    );
    expect(family.name).toBe("width-attribute-spelling");
    expect(family.classification).toBe("converter");
  });

  test("two DIFFERENT column widths are a reading difference", () => {
    // The rule that admits a width spelling proves the numbers are
    // equal first. Before it did, a column the two programs sized
    // differently was filed as a spelling of the same reading, which
    // is the shape this whole classification exists to refuse.
    const family = familyOf(
      '<table><col style="width: 50%;"></table>',
      '<table><col width="25%"></table>',
    );
    expect(family.name).toBe("reading");
    expect(family.classification).toBe("reading");
  });

  test("a section level is a reading difference, not markup around the same text", () => {
    // The same text under a different element is what the document
    // MEANS: a level-0 special section and a sect1 are different
    // documents, however alike their words are.
    const family = familyOf(
      '<div class="sect1"><h2 id="a">Title</h2></div>',
      '<h1 id="a" class="sect0">Title</h1>',
    );
    expect(family.classification).toBe("reading");
  });

  test("a resolved path is a reading difference, not an attribute spelling", () => {
    const family = familyOf(
      '<img src="images/rainbow.png" alt="rainbow">',
      '<img src="chapter-1/images/rainbow.png" alt="rainbow">',
    );
    expect(family.classification).toBe("reading");
  });

  test("a table CLASS is a reading difference, not a width spelling", () => {
    // The width rule used to reduce the whole <table> tag to a bare
    // tag, so a frame, a grid, a float or a stripe setting - each of
    // which is what the document asked for - rode along as a
    // spelling of the same reading. Only the width attribute is set
    // aside now.
    const family = familyOf(
      '<table class="tableblock frame-ends grid-all" style="width: 50%;"><col></table>',
      '<table class="tableblock frame-topbot grid-all" width="50%"><col></table>',
    );
    expect(family.classification).toBe("reading");
  });

  test("a LANGUAGE is a reading difference, not highlighter dressing", () => {
    // The dressing rule used to drop every class and every data-lang
    // from <pre> and <code>, which hid the language the block's
    // attrlist asked for and any id on it. Only the highlighter's own
    // class tokens are dropped now, and data-lang is compared.
    const language = familyOf(
      '<pre class="highlight"><code class="language-ruby" data-lang="ruby">x</code></pre>',
      '<pre class="highlight"><code class="language-js" data-lang="js">x</code></pre>',
    );
    expect(language.classification).toBe("reading");
    const id = familyOf(
      '<pre class="highlight" id="a"><code data-lang="ruby">x</code></pre>',
      '<pre class="highlight"><code data-lang="ruby">x</code></pre>',
    );
    expect(id.classification).toBe("reading");
  });

  test("a language spelled with a slash is still dressing", () => {
    // `[source, n/a]` writes class="language-n/a", and a token
    // pattern that admitted only word characters left that class
    // standing: the row read as a reading difference and was judged
    // with a reason belonging to another document. data-lang carries
    // the same language and is compared, so the token may be wide.
    const family = familyOf(
      '<pre class="CodeRay highlight"><code data-lang="n/a">x</code></pre>',
      '<pre class="highlight"><code class="language-n/a" data-lang="n/a">x</code></pre>',
    );
    expect(family.name).toBe("highlighter-dressing");
    expect(family.classification).toBe("environment");
  });

  test("the highlighter's dressing is an environment difference", () => {
    const family = familyOf(
      '<pre class="rouge highlight"><code data-lang="ruby">x</code></pre>',
      '<pre class="highlight"><code class="language-ruby" data-lang="ruby">x</code></pre>',
    );
    expect(family.name).toBe("highlighter-dressing");
    expect(family.classification).toBe("environment");
  });

  test("differing text is a reading difference, which is the last family", () => {
    const family = familyOf("<p>a</p>", "<p>b</p>");
    expect(family.name).toBe("reading");
    // The last family's rule is the constant true, which is what
    // makes the classification total: no pair of renders can fall
    // through it unnamed.
    expect(FAMILIES.at(-1)?.name).toBe("reading");
  });
});

describe("what a fidelity row says WE do is checked, not asserted", () => {
  test("each row's witness formats to what the row records, stably", async () => {
    // `ours` slipped a false statement past the first review because
    // nothing formatted a witness. The printer's own output is now
    // part of the row, and so is whether the reference still renders
    // it the same: one row's answer to that is NO, and saying so is
    // the point of the field.
    for (const row of ledger.instrumentFidelity) {
      // eslint-disable-next-line no-await-in-loop -- four rows, and a failing one has to be nameable
      const formatted = await formatAdoc(row.witness);
      expect(`${row.id}: ${formatted}`).toBe(`${row.id}: ${row.formatted}`);
      // eslint-disable-next-line no-await-in-loop -- as above
      const again = await formatAdoc(formatted);
      expect(`${row.id} again: ${again}`).toBe(`${row.id} again: ${formatted}`);
    }
  });

  test("each row's fixed-point claim is the reference's answer", ({ skip }) => {
    skip(referenceVersion() === undefined, "no Asciidoctor Ruby gem installed");
    const rows = ledger.instrumentFidelity;
    const renders = referenceRenders(
      rows.flatMap((row) => [
        { id: `${row.id}/witness`, src: row.witness, attrs: {} },
        { id: `${row.id}/formatted`, src: row.formatted, attrs: {} },
      ]),
      "lens",
    );
    for (const row of rows) {
      const holds =
        renders?.get(`${row.id}/witness`) ===
        renders?.get(`${row.id}/formatted`);
      expect(`${row.id} fixed point: ${String(holds)}`).toBe(
        `${row.id} fixed point: ${String(row.referenceFixedPoint)}`,
      );
    }
  });
});

describe("the instrument defects the ledger records still reproduce", () => {
  test("every fidelity row's witness renders as the row says", async ({
    skip,
  }) => {
    skip(referenceVersion() === undefined, "no Asciidoctor Ruby gem installed");
    const rows = ledger.instrumentFidelity;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      // Every row says what we do about it: a disagreement between
      // the two programs is a place this project chooses the simplest
      // behaviour, and the choice is part of the record.
      expect(`${row.id}: ${row.ours}`.length).toBeGreaterThan(
        row.id.length + 20,
      );
      expect(`${row.id}: ${row.covers}`.length).toBeGreaterThan(
        row.id.length + 10,
      );
    }
    const reference = referenceRenders(
      rows.map((row) => ({ id: row.id, src: row.witness, attrs: {} })),
      "lens",
    );
    for (const row of rows) {
      expect(`${row.id} reference: ${reference?.get(row.id) ?? ""}`).toBe(
        `${row.id} reference: ${row.reference}`,
      );
      // eslint-disable-next-line no-await-in-loop -- one witness at a time; there are a handful and a failing one has to be nameable
      const oracle = await renderedHtml(row.witness);
      expect(`${row.id} oracle: ${oracle}`).toBe(
        `${row.id} oracle: ${row.oracle}`,
      );
    }
  });
});
