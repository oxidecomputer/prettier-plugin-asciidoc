/**
 * The render-equality gate over the list-item composition family.
 *
 * THE DEFECT CLASS THIS EXISTS FOR: output that renders DIFFERENTLY
 * from its input and is nevertheless a FIXED POINT. The formatter
 * changes what a document means, once, and then agrees with itself
 * about the changed document forever after.
 *
 * WHY THE OTHER GATES CANNOT SEE IT. Idempotence compares our output
 * against our output. Reparse and the reading ledger compare our
 * output against our own reader. The confluence pairs compare two of
 * our outputs against each other. Every one of them is a self-
 * comparison, and a self-comparison is satisfied by any output the
 * formatter is stable on, including a wrong one. Only a comparison of
 * the INPUT's render against the OUTPUT's render can see a meaning
 * that moved, and it has to be made on documents deep enough for the
 * reader to get the extent wrong.
 *
 * THE INCIDENT (2026-09-05, issue #200). A change to where a list
 * item's buffer stops made the reader cut a `[source]` run at a
 * bracketed line inside it and read the rest as list-item text; the
 * printer then reflowed two content lines into one, destroying a
 * newline inside a `<pre>`. 64 of these 700 documents rendered
 * differently after formatting. Every automated gate in the
 * repository stayed green: the corrupted output was stable, it
 * re-read as what it was printed as, and no corpus or sweep alphabet
 * contained the shape. It took a hand-built render comparison over
 * these 700 documents to see it, and this file is that comparison
 * made standing.
 *
 * SO: A GREEN HISTORY IS NOT EVIDENCE THIS GATE IS REDUNDANT. It is
 * redundant only when the reader's extent decisions over this
 * territory are proved rather than sampled (issue #185's retirement
 * criterion). Until then, every other gate over this shape is a
 * self-comparison, and deleting this one restores exactly the blind
 * spot the incident happened in.
 *
 * The pin is `list-item-composition-quarantine.json`, exact in both
 * directions on the same terms as the registry sweep's manifest: a
 * row that starts diverging fails, and a quarantined row that gets
 * fixed fails too until its entry is deleted. It is EMPTY: the 68
 * rows it held when the family was added were the one live defect
 * class it found (issue #201, a lone `+` inside a `+`-attached
 * styled verbatim run), and those rows render the same on both sides
 * now. So this file is a pure regression gate, which is the state its
 * second test says it spends the rest of its life in.
 */
import { describe, expect, test } from "vitest";
import { byId, expectedFailures } from "./generated-sweep.js";
import { listItemCompositionRows } from "./list-item-composition.js";
import { loadQuarantine } from "./quarantine.js";
import { sweepFailures } from "./registry-sweep.js";

/** Repo-relative manifest path for this family's known failures. */
const QUARANTINE_PATH =
  "tests/conformance/list-item-composition-quarantine.json";

/**
 * The incident's document, spelled here so the file carries it and so
 * the realization pin below holds a witness rather than an arbitrary
 * row.
 *
 * The recorded minimal witness spells its last marker `* n`; the
 * family reaches the same cell with the follower axis's own spelling,
 * `* n2`, which is one character different and the same document
 * otherwise. Both corrupt identically under the reading that caused
 * the incident, so the pin holds the family's realization - a pin on
 * bytes the family does not produce would be a pin on nothing.
 */
const INCIDENT_DOCUMENT = "term1:: desc\n+\n[source]\na\n[note]\n* n2\nb\n";

/** The row id the incident document sits at. */
const INCIDENT_ID = "term2/source/attribute/marker";

describe("list-item composition family", () => {
  test("the failing set is exactly the quarantine manifest", async () => {
    expect(byId(await sweepFailures(listItemCompositionRows()))).toEqual(
      expectedFailures(loadQuarantine(QUARANTINE_PATH)),
    );
  }, 300_000);

  // The manifest gate above compares a failing set against a failing
  // set, so it is blind to the family itself: a template that stopped
  // composing list items would sweep 700 documents that prove nothing
  // and agree with the manifest about them. That is not hypothetical:
  // with the manifest empty, EVERY perturbation of the template that
  // keeps the sweep green above - inserting a blank line after the
  // opener's `+`, dropping the style line, dropping the trailing `b` -
  // compares empty against empty and passes there. This test is what
  // the family stands on now that the gate above is a pure regression
  // gate.
  test("the family realizes list-item compositions", () => {
    const rows = listItemCompositionRows();
    expect(rows).toHaveLength(700);
    expect(rows.find((row) => row.id === INCIDENT_ID)?.input).toBe(
      INCIDENT_DOCUMENT,
    );
    // Every document attaches a bracketed style line to its opener
    // through a continuation, and ends with the trailing content line
    // that a destroyed newline shows up in.
    for (const row of rows) {
      expect(row.input).toContain("\n+\n[");
      expect(row.input.endsWith("\nb\n")).toBe(true);
    }
  });
});
