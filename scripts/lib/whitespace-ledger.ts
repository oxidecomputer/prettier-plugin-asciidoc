/**
 * The whitespace battery's ledger: what the two programs did with
 * every perturbed position, pinned so a later run has to agree with
 * it.
 *
 * TWO SHAPES, for the same reason the registry sweep has two. The
 * template population is two hundred positions a person chose, and
 * its ledger names each one: the negative results are half the table
 * ("every replacement row but the em dash is free", "every mark but
 * monospace is free"), and a reader can only check those if the free
 * rows are written down. The document populations are five figures
 * wide, so they are pinned as CLUSTERS (count, five example ids, and
 * the sha256 of the cluster's full sorted id list) exactly as
 * `tests/conformance/registry-sweep-clusters.ts` pins its deep tier.
 * A cluster is still exact: a position that appears, vanishes, or
 * changes class changes a hash.
 *
 * WHAT A ROW MEANS. A position's class is measured, never declared:
 * the four spellings are rendered and the classes of the results are
 * read off. `FREE` means all four render alike, and it is as much a
 * measurement as any other row. The oracle column is the second
 * program (`@asciidoctor/core`, what every other harness renders
 * through) run over the same bytes, so a position where the two
 * programs partition the alphabet differently is a row about the
 * INSTRUMENT rather than about AsciiDoc.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { classOf, dimensionsOf } from "./whitespace-perturbation.js";
import type { PopulationName } from "./whitespace-populations.js";
import type { LineKind } from "./whitespace-positions.js";

/** Where the pinned results live. */
export const LEDGER_PATH = "scripts/whitespace-battery-ledger.json";

/** What the two programs did with one position. */
type Agreement = "agree" | "differ" | "reference-only";

/** One measured position of the template population. */
export interface PositionRow {
  /** `<template>/s<index>`. */
  readonly id: string;
  /** The template's construct family. */
  readonly group: string;
  /** The class name derived from {@link partition}, for readers. */
  readonly class: string;
  /** The reference's partition of the four spellings. */
  readonly partition: string;
  /** The oracle's partition, or `n/a` where only the reference ran. */
  readonly oracle: string;
  /** Whether the two programs partitioned the alphabet alike. */
  readonly programs: Agreement;
}

/** One cluster of a document population's positions. */
interface Cluster {
  /** `<construct guess>|<class>|<agreement>`. */
  readonly key: string;
  /** How many positions the cluster covers. */
  readonly count: number;
  /** The first five position ids in sorted order. */
  readonly examples: readonly string[];
  /** Hex sha256 of the sorted position ids joined by newlines. */
  readonly sha256: string;
}

/** The counts every population reports. */
export interface Counts {
  /** Whitespace positions measured. */
  readonly positions: number;
  /** Documents rendered: four per position. */
  readonly cases: number;
  /** Positions whose four spellings all render alike. */
  readonly free: number;
  /**
   * Positions the REFERENCE reads as free and the instrument does
   * not.
   *
   * Counted apart from {@link free} because the two numbers answer
   * different questions and a reader who takes `free` for both is
   * wrong on exactly these rows. `free` says the printer may spell
   * the run however it likes and still render what the author wrote;
   * these rows say the suite, which renders through the instrument,
   * can still redden there. Every one of them is also a
   * {@link programsDiffer} row.
   */
  readonly freeButInstrumentBound: number;
  /** Positions where two spaces render differently from one. */
  readonly lengthBound: number;
  /** Positions where a tab renders differently from one space. */
  readonly tabBound: number;
  /** Positions where a newline renders differently from one space. */
  readonly newlineBound: number;
  /** Positions where the two programs disagree about the partition. */
  readonly programsDiffer: number;
  /** Positions only the reference could render. */
  readonly referenceOnly: number;
}

/** What a document population's scan passed over. */
export interface ScanCounts {
  /** Documents read. */
  readonly documents: number;
  /** Lines skipped, by the kind that skipped them. */
  readonly skippedLines: Readonly<Record<LineKind, number>>;
  /** Runs found at a line edge, where the alphabet is not well formed. */
  readonly edgeRuns: number;
}

/** One population's pinned result. */
export type PopulationLedger =
  | {
      /** A population small enough to pin one row per position. */
      readonly shape: "positions";
      /** The headline counts. */
      readonly counts: Counts;
      /** Every position, in population order. */
      readonly positions: readonly PositionRow[];
    }
  | {
      /** A population pinned as clusters because it is five figures wide. */
      readonly shape: "clusters";
      /** The headline counts. */
      readonly counts: Counts;
      /** What the document scan passed over. */
      readonly scan: ScanCounts;
      /** Every cluster, sorted by key. */
      readonly clusters: readonly Cluster[];
    };

/** The whole ledger. */
export interface Ledger {
  /** The reference gem's version; a different one exits 2. */
  readonly reference: string;
  /** The oracle package's version; a different one exits 2. */
  readonly oracle: string;
  /** One entry per population, keyed by name. */
  readonly populations: Readonly<Record<string, PopulationLedger>>;
}

/** What one position's rendering produced. */
export interface Measured {
  /** The position's id. */
  readonly id: string;
  /** Its reporting group. */
  readonly group: string;
  /** The reference's four renders, in alphabet order. */
  readonly reference: readonly string[];
  /** The oracle's four renders, or undefined where it did not run. */
  readonly oracle: readonly string[] | undefined;
}

/** How many ids a cluster lists by name. */
const EXAMPLE_LIMIT = 5;

/**
 * Reads a measured position as the row the ledger pins.
 * @param measured - one position's renders from both programs
 * @param partitionOf - the partition function, passed in so this
 *   module holds no rendering knowledge of its own
 * @returns the pinned row
 */
export function rowOf(
  measured: Measured,
  partitionOf: (renders: readonly string[]) => string,
): PositionRow {
  const partition = partitionOf(measured.reference);
  const oracle =
    measured.oracle === undefined ? "n/a" : partitionOf(measured.oracle);
  return {
    id: measured.id,
    group: measured.group,
    class: classOf(partition),
    partition,
    oracle,
    programs:
      oracle === "n/a"
        ? "reference-only"
        : oracle === partition
          ? "agree"
          : "differ",
  };
}

/**
 * Counts a set of rows the way the ledger header reports them.
 * @param rows - every row of one population
 * @returns the population's counts
 */
export function countsOf(rows: readonly PositionRow[]): Counts {
  const dimensions = rows.map((row) => dimensionsOf(row.partition));
  const perturbationsPerPosition = 4;
  return {
    positions: rows.length,
    cases: rows.length * perturbationsPerPosition,
    free: rows.filter((row) => row.class === "FREE").length,
    freeButInstrumentBound: rows.filter(
      (row) => row.class === "FREE" && row.programs === "differ",
    ).length,
    lengthBound: dimensions.filter((one) => one.lengthBound).length,
    tabBound: dimensions.filter((one) => one.tabBound).length,
    newlineBound: dimensions.filter((one) => one.newlineBound).length,
    programsDiffer: rows.filter((row) => row.programs === "differ").length,
    referenceOnly: rows.filter((row) => row.programs === "reference-only")
      .length,
  };
}

/**
 * Groups rows into the clusters a five-figure population is pinned
 * as: one per construct guess, class and agreement.
 * @param rows - every row of one population
 * @returns the clusters, sorted by key
 */
function clustersOf(rows: readonly PositionRow[]): Cluster[] {
  const byKey = new Map<string, string[]>();
  for (const row of rows) {
    const key = `${row.group}|${row.class}|${row.programs}`;
    const ids = byKey.get(key) ?? [];
    ids.push(row.id);
    byKey.set(key, ids);
  }
  return [...byKey.entries()]
    .map(([key, ids]) => {
      const sorted = ids.toSorted();
      return {
        key,
        count: sorted.length,
        examples: sorted.slice(0, EXAMPLE_LIMIT),
        sha256: createHash("sha256").update(sorted.join("\n")).digest("hex"),
      };
    })
    .toSorted((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * Reads the pinned ledger.
 * @returns the ledger as it stands on disk
 */
export function loadLedger(): Ledger {
  // The ledger is written by this repository's own gate and read
  // back by it; a validator over it would restate the types above
  // and could only fail on a file somebody hand-edited into
  // nonsense, which the gate's own comparison catches on the next
  // run anyway.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- our own generated file, regenerated by --write
  return JSON.parse(readFileSync(LEDGER_PATH, "utf8")) as Ledger;
}

/**
 * The differences between a fresh run and the pinned ledger, as
 * lines a person can act on.
 *
 * Compared as JSON text per population entry rather than field by
 * field: every field of this ledger is a measurement, so any
 * difference is a finding, and a hand-written comparison would have
 * to be revisited every time the shape gains a field.
 * @param fresh - the populations this run measured
 * @param pinned - the populations the ledger holds
 * @returns one line per differing population entry, empty when they
 *   agree
 */
export function ledgerDifferences(
  fresh: Readonly<Record<string, PopulationLedger>>,
  pinned: Readonly<Record<string, PopulationLedger>>,
): string[] {
  // Read through maps rather than by index: an index into a
  // Record type answers with the value type whatever the key, so
  // "this population is missing" would not typecheck as a question.
  const measured = new Map(Object.entries(fresh));
  const recorded = new Map(Object.entries(pinned));
  const names = [
    ...new Set([...measured.keys(), ...recorded.keys()]),
  ].toSorted();
  const lines: string[] = [];
  for (const name of names) {
    const left = measured.get(name);
    const right = recorded.get(name);
    if (left === undefined) {
      lines.push(`${name}: pinned but not measured`);
      continue;
    }
    if (right === undefined) {
      lines.push(`${name}: measured but not pinned`);
      continue;
    }
    lines.push(...entryDifferences(name, left, right));
  }
  return lines;
}

/**
 * The differences between one population's fresh and pinned entries.
 * @param name - the population's name, for the message
 * @param fresh - what this run measured
 * @param pinned - what the ledger holds
 * @returns one line per difference
 */
function entryDifferences(
  name: string,
  fresh: PopulationLedger,
  pinned: PopulationLedger,
): string[] {
  if (fresh.shape !== pinned.shape) {
    return [`${name}: pinned as ${pinned.shape}, measured as ${fresh.shape}`];
  }
  const lines: string[] = [];
  if (JSON.stringify(fresh.counts) !== JSON.stringify(pinned.counts)) {
    lines.push(
      `${name}: counts ${JSON.stringify(pinned.counts)} -> ${JSON.stringify(fresh.counts)}`,
    );
  }
  const keyed = (entry: PopulationLedger): Map<string, string> =>
    new Map(
      entry.shape === "positions"
        ? entry.positions.map((row) => [row.id, JSON.stringify(row)])
        : entry.clusters.map((cluster) => [
            cluster.key,
            JSON.stringify(cluster),
          ]),
    );
  const left = keyed(fresh);
  const right = keyed(pinned);
  for (const [key, value] of left) {
    const other = right.get(key);
    if (other === undefined) {
      lines.push(`${name}: new ${key} ${value}`);
    } else if (other !== value) {
      lines.push(`${name}: ${key} ${other} -> ${value}`);
    }
  }
  for (const key of right.keys()) {
    if (!left.has(key)) {
      lines.push(`${name}: gone ${key}`);
    }
  }
  return lines;
}

/**
 * Builds one population's ledger entry from its measured positions.
 * @param name - which population these positions came from
 * @param rows - the measured rows
 * @param scan - what a document population's scan skipped
 * @returns the entry, in the shape that population is pinned in
 */
export function entryOf(
  name: PopulationName,
  rows: readonly PositionRow[],
  scan: ScanCounts | undefined,
): PopulationLedger {
  if (scan === undefined) {
    return { shape: "positions", counts: countsOf(rows), positions: rows };
  }
  return {
    shape: "clusters",
    counts: countsOf(rows),
    scan,
    clusters: clustersOf(rows),
  };
}
