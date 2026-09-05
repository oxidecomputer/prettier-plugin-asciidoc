import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  CONTAINER_ROWS,
  EDGE_ROWS,
  FOLLOWER_ROWS,
  GAP_FAMILY_CASES,
  GAP_FAMILY_ROWS,
  MARKER_ROWS,
  TOKEN_ROWS,
  UNIFORM_ROWS,
  sweepFailures,
} from "./description-sweep.js";

/**
 * Every `gap:*` family either ledger records - the standing set of
 * line shapes Asciidoctor opens a block on and this parser reads as
 * something else.
 *
 * Read from the ledgers rather than copied, which is the whole point:
 * a family added by a `bun run block-structure --write` arrives here
 * without anybody remembering to add it, and turns the gate below red
 * until its row is written.
 * @returns the family names, sorted
 */
function ledgerGapFamilies(): string[] {
  const families = new Set<string>();
  for (const [file, key] of [
    ["scripts/block-structure-corpus.json", "cases"],
    ["scripts/block-structure-sweep.json", "signatures"],
  ]) {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    for (const family of familiesOf(parsed, key)) {
      families.add(family);
    }
  }
  return [...families].filter((name) => name.startsWith("gap:")).toSorted();
}

/**
 * The `family` of every entry under one key of a parsed ledger,
 * validated rather than asserted: a ledger whose shape moved throws
 * here instead of reading as an empty family set, which would make
 * the gate below pass vacuously.
 * @param parsed - the parsed ledger
 * @param key - the field holding its entries
 * @returns one family name per entry
 */
function familiesOf(parsed: unknown, key: string): string[] {
  const entries: unknown = readField(parsed, key);
  if (typeof entries !== "object" || entries === null) {
    throw new TypeError(`${key}: not an object`);
  }
  return Object.entries(entries).map(([id, entry]) => {
    const family: unknown = readField(entry, "family");
    if (typeof family !== "string") {
      throw new TypeError(`${key}.${id}: no family`);
    }
    return family;
  });
}

/**
 * One field of an unknown value, without an assertion.
 * @param value - the value to read
 * @param key - the field name
 * @returns the field, or undefined when the value has no such field
 */
function readField(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

/**
 * The grids the reflow verdict is measured over. Each row is formatted
 * twice and rendered against its source, so a row can fail as "not a
 * fixed point", as "renders differently", or as both.
 *
 * The sizes are pinned so that a grid cannot quietly shrink: a sweep
 * that stops spelling a token or a container reports nothing, and a
 * green empty sweep is the failure mode these rows exist for.
 */
describe("the description reflow sweep", () => {
  test("the grids are the size this suite was written against", () => {
    expect(TOKEN_ROWS).toHaveLength(675);
    expect(CONTAINER_ROWS).toHaveLength(240);
    expect(FOLLOWER_ROWS).toHaveLength(3456);
    expect(UNIFORM_ROWS).toHaveLength(160);
    expect(MARKER_ROWS).toHaveLength(180);
    expect(GAP_FAMILY_ROWS).toHaveLength(240);
    expect(EDGE_ROWS).toHaveLength(11);
  });

  test("every token row is render-equal and a fixed point", async () => {
    expect(await sweepFailures(TOKEN_ROWS)).toEqual([]);
  });

  test("every container row is render-equal and a fixed point", async () => {
    expect(await sweepFailures(CONTAINER_ROWS)).toEqual([]);
  });

  test("every follower row is render-equal and a fixed point", async () => {
    expect(await sweepFailures(FOLLOWER_ROWS)).toEqual([]);
  });

  test("every uniform-run row is render-equal and a fixed point", async () => {
    expect(await sweepFailures(UNIFORM_ROWS)).toEqual([]);
  });

  test("every marker row is render-equal and a fixed point", async () => {
    expect(await sweepFailures(MARKER_ROWS)).toEqual([]);
  });

  test("every edge row is render-equal and a fixed point", async () => {
    expect(await sweepFailures(EDGE_ROWS)).toEqual([]);
  });
});

/**
 * THE REGRESSION NET over the class no predicate in this tree can
 * close on its own: a line Asciidoctor opens a block on and this
 * parser reads as something else. A refusal set only ever holds the
 * members somebody has already met, so a set alone is the wrong
 * instrument; the block-structure ledgers at least enumerate the
 * members this tree HAS met, as their `gap:*` families.
 *
 * WHAT THIS GATE PROVES is that no ledgered family joins today, and
 * that a family added to either ledger arrives with nothing answering
 * for it. It is not a proof that the join is safe: it can only watch
 * shapes a ledger has already recorded, and it saw neither a
 * `\u{2022}` bullet nor a four-tilde fence before each was found by
 * hand. What the rows are and are not is stated at
 * {@link GAP_FAMILY_CASES}.
 *
 * This is that crossing. It is a gate rather than a sweep because the
 * ledger MOVES: every family it records must have a row saying what
 * the join does about it, so a family added by a later
 * `bun run block-structure --write` arrives red.
 */
describe("the block-structure gap families, crossed with the join", () => {
  test("every ledgered gap family has a row here", () => {
    expect(Object.keys(GAP_FAMILY_CASES).toSorted()).toEqual(
      ledgerGapFamilies(),
    );
  });

  test("every family's rows are render-equal and fixed points", async () => {
    expect(await sweepFailures(GAP_FAMILY_ROWS)).toEqual([]);
  });

  // A family whose shape no rest line can spell says so in words,
  // because an empty row and a missing row must not look alike. Both
  // arms are collected first and asserted once, so the assertion is
  // not inside the branch.
  test("every family row carries a shape or a stated reason", () => {
    const empty = Object.entries(GAP_FAMILY_CASES).filter(([, entry]) =>
      "unreachable" in entry
        ? entry.unreachable.length === 0
        : entry.restLines.length === 0,
    );
    expect(empty.map(([family]) => family)).toEqual([]);
  });
});
