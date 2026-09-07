/**
 * The whitespace battery's own gates: the fold the reference is read
 * through is the fold the oracle is read through, and the pinned
 * ledger says what the battery measured.
 *
 * TWO KINDS OF ROW HERE. The fold-fidelity rows shell out to Ruby,
 * because the claim they make is about two programs; they skip by
 * name where the gem is not installed, the way the trailer test skips
 * where there is no colocated `.git`. Everything else reads the
 * committed ledger and needs neither program: a ledger whose counts
 * do not describe its own rows is a ledger nobody can hold anything
 * to, and that failure is worth catching in the always-on suite
 * rather than only in a batched run.
 */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  referenceFold,
  referenceVersion,
} from "../../scripts/lib/reference-runner.js";
import {
  classOf,
  dimensionsOf,
} from "../../scripts/lib/whitespace-perturbation.js";
import {
  countsOf,
  loadLedger,
  type PositionRow,
} from "../../scripts/lib/whitespace-ledger.js";
import { POPULATIONS } from "../../scripts/lib/whitespace-populations.js";
import {
  SLOT,
  TEMPLATES,
  type Template,
} from "../../scripts/lib/whitespace-roster.js";
import { conformanceFold } from "../helpers.js";

/** The committed raw-HTML samples both folds are applied to. */
const SAMPLES_PATH = "scripts/whitespace-fold-samples.json";

/** One committed sample. */
interface FoldSample {
  readonly id: string;
  readonly html: string;
}

/**
 * The samples where the two folds are known to differ: none.
 *
 * The empty set is the claim. Two shapes could once make the folds
 * disagree and both are now decided the same way in both of them: a
 * NUL sentinel naming no stashed region is left as it stands (rather
 * than becoming the string `undefined` in JavaScript and the empty
 * string in Ruby), and a numeric reference naming a surrogate is left
 * as it stands (rather than becoming a lone surrogate in JavaScript
 * and an invalid string that raises in Ruby). An empty set is a
 * stronger pin than a pinned pair: any new divergence fails here.
 */
const KNOWN_FOLD_DIVERGENCES = new Set<string>();

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- committed fixture in this repository, read back by the harness that wrote it
const samples: FoldSample[] = JSON.parse(
  readFileSync(SAMPLES_PATH, "utf8"),
) as FoldSample[];

const ledger = loadLedger();

/**
 * The position ids one template contributes, in slot order.
 * @param subject - a roster template
 * @returns `<name>/s<index>` for each of its slots
 */
function slotIds(subject: Template): string[] {
  const slots = subject.segments.filter((segment) => segment === SLOT).length;
  return Array.from(
    { length: slots },
    (_value, index) => `${subject.name}/s${String(index)}`,
  );
}

describe("the reference's fold is the harness's fold", () => {
  test("both folds agree on every sample a render can produce", ({ skip }) => {
    skip(referenceVersion() === undefined, "no Asciidoctor Ruby gem installed");
    const reference = referenceFold(samples.map((sample) => sample.html));
    expect(reference).toBeDefined();
    const differing = samples
      .filter(
        (sample, index) =>
          conformanceFold(sample.html) !== (reference ?? [])[index],
      )
      .map((sample) => sample.id);
    expect(new Set(differing)).toEqual(KNOWN_FOLD_DIVERGENCES);
  });

  test("the samples reach every branch of the fold", () => {
    // A fold-fidelity proof over samples that never enter a shelter
    // proves nothing about the shelters, so the sample set is held to
    // covering each region the fold treats specially.
    const all = samples.map((sample) => sample.html).join("\n");
    expect(all).toContain("<pre");
    expect(all).toContain("<code");
    expect(all).toContain("&#x");
    expect(all).toContain("\t");
    expect(all).toContain("\0");
    // The surrogate branch is the one a render cannot produce and
    // the one the two decoders would otherwise answer differently,
    // so a sample set that stopped covering it would stop proving
    // the thing that took the longest to find.
    expect(all).toContain("&#xD800;");
    expect(samples).toHaveLength(31);
  });
});

describe("the ledger describes its own rows", () => {
  test("every population is pinned", () => {
    expect(Object.keys(ledger.populations).toSorted()).toEqual(
      [...POPULATIONS].toSorted(),
    );
  });

  test("the template rows are exactly the roster's slots", () => {
    const entry = ledger.populations.templates;
    expect(entry.shape).toBe("positions");
    const expected = TEMPLATES.flatMap((subject) => slotIds(subject));
    const pinned =
      entry.shape === "positions" ? entry.positions.map((row) => row.id) : [];
    expect(pinned).toEqual(expected);
  });

  test("each row's class is the class its partition names", () => {
    const entry = ledger.populations.templates;
    const rows: readonly PositionRow[] =
      entry.shape === "positions" ? entry.positions : [];
    for (const row of rows) {
      expect(`${row.id}: ${row.class}`).toBe(
        `${row.id}: ${classOf(row.partition)}`,
      );
    }
  });

  test("the template counts are the counts of its rows", () => {
    const entry = ledger.populations.templates;
    const rows: readonly PositionRow[] =
      entry.shape === "positions" ? entry.positions : [];
    expect(entry.counts).toEqual(countsOf(rows));
  });

  test("each clustered population's counts are its clusters' counts", () => {
    for (const name of ["witnesses", "grid"]) {
      const entry = ledger.populations[name];
      expect(entry.shape).toBe("clusters");
      if (entry.shape !== "clusters") {
        continue;
      }
      const covered = entry.clusters.reduce(
        (total, cluster) => total + cluster.count,
        0,
      );
      expect(`${name}: ${String(covered)}`).toBe(
        `${name}: ${String(entry.counts.positions)}`,
      );
      const free = entry.clusters
        .filter((cluster) => cluster.key.split("|")[1] === "FREE")
        .reduce((total, cluster) => total + cluster.count, 0);
      expect(`${name} free: ${String(free)}`).toBe(
        `${name} free: ${String(entry.counts.free)}`,
      );
      const differ = entry.clusters
        .filter((cluster) => cluster.key.endsWith("|differ"))
        .reduce((total, cluster) => total + cluster.count, 0);
      expect(`${name} differ: ${String(differ)}`).toBe(
        `${name} differ: ${String(entry.counts.programsDiffer)}`,
      );
    }
  });

  test("a bound population is bound in the dimensions its rows name", () => {
    // The battery exists because the three dimensions are
    // independent. A ledger where every bound position moved in all
    // three would say the alphabet has one axis, and the row that
    // proves otherwise is worth pinning by name: the em dash reads a
    // space and a newline alike and reads two spaces differently,
    // while a mid-line plus reads two spaces and a tab alike and
    // reads a newline differently.
    const entry = ledger.populations.templates;
    const rows: readonly PositionRow[] =
      entry.shape === "positions" ? entry.positions : [];
    const byId = new Map(rows.map((row) => [row.id, row]));
    const emdash = byId.get("emdash/s0");
    expect(emdash?.partition).toBe("0120");
    expect(dimensionsOf(emdash?.partition ?? "")).toMatchObject({
      lengthBound: true,
      newlineBound: false,
    });
    const plus = byId.get("plus-midline/s1");
    expect(dimensionsOf(plus?.partition ?? "")).toMatchObject({
      lengthBound: false,
      newlineBound: true,
    });
  });
});
