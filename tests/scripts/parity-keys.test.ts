/**
 * Unit tests for scripts/parity-keys.ts: the key-ignoring AST
 * comparison and the BLANKET `Parity-Diff:` trailer that stands on it.
 *
 * Split out of tests/scripts/parity-ledger.test.ts and
 * tests/scripts/parity-trailers.test.ts the way those two were split
 * from each other - the `max-lines` ceiling - and it mirrors the
 * module split on the source side.
 */
import { describe, expect, test } from "vitest";
import {
  astAgreesIgnoringKeys,
  blanketCoverage,
  keyCoverage,
} from "../../scripts/parity-keys.js";
import {
  LEDGER_FAMILIES,
  expectedDiffFailures,
} from "../../scripts/parity-ledger.js";
import { parseExpectedDiffTrailers } from "../../scripts/parity-trailers.js";

// A synthetic family set, as in parity-ledger.test.ts: only
// `fam-keyed` may be declared with a BARE trailer, and the one key it
// owns is what the rows below strip from both sides.
const SYNTHETIC = {
  families: new Set(["fam-ast", "fam-bytes", "fam-keyed"]),
  formattedOnly: new Set(["fam-bytes"]),
  blanketKeys: new Map([["fam-keyed", new Set(["recorded"])]]),
};

/**
 * A `covers` predicate that answers yes for a fixed set of ids.
 * @param ids - the ids to cover
 * @returns the predicate blanketCoverage calls
 */
const coversOnly =
  (...ids: string[]) =>
  (id: string): boolean =>
    ids.includes(id);

/** One case's two texts, as a verbatim dump hands them over. */
interface DumpedCase {
  /** The formatted output, verbatim. */
  formatted: string;
  /** The serialized AST, verbatim. */
  ast: string;
}

/**
 * A `dumpVerbatim` over fixed rows, counting its calls so the
 * memoization can be asserted.
 * @param rows - each side's rows, by checkout name
 * @returns the dumper and its call count
 */
const dumperOver = (
  rows: Record<string, Map<string, DumpedCase>>,
): {
  dump: (root: string) => ReadonlyMap<string, DumpedCase>;
  calls: () => number;
} => {
  let calls = 0;
  return {
    dump: (root) => {
      calls += 1;
      return rows[root] ?? new Map();
    },
    calls: () => calls,
  };
};

/**
 * A `covers` predicate that answers yes for the id `"a"` alone.
 * @param id - the case id
 * @returns whether the blanket pass may remove it
 */
const coversA = (id: string): boolean => id === "a";

/** One case's two sides, as the production predicate reads them. */
interface CaseTexts {
  /** The baseline's serialized AST. */
  base: string;
  /** This checkout's serialized AST. */
  head: string;
  /** Whether the formatted bytes are identical. */
  bytes: boolean;
}

/**
 * The predicate scripts/parity-keys.ts builds from a verbatim
 * re-dump, with the two sides' texts supplied inline.
 * @param rows - each id's two sides
 * @returns the `covers` predicate blanketCoverage calls
 */
const coversFrom =
  (rows: Map<string, CaseTexts>) =>
  (id: string, keys: ReadonlySet<string>): boolean => {
    const row = rows.get(id);
    if (row === undefined) {
      return false;
    }
    return row.bytes && astAgreesIgnoringKeys(row.base, row.head, keys);
  };

const corpus = new Set(["a", "b"]);

// The two trees a schema change produces: identical but for one key
// on one node. The blanket form's whole claim is that this shape,
// and only this shape, may go undeclared per id.
const withKey = JSON.stringify({
  type: "document",
  children: [{ type: "paragraph", recorded: true, value: "x" }],
});
const withoutKey = JSON.stringify({
  type: "document",
  children: [{ type: "paragraph", value: "x" }],
});
const otherKeyMoved = JSON.stringify({
  type: "document",
  children: [{ type: "paragraph", recorded: true, value: "MOVED" }],
});

describe("astAgreesIgnoringKeys", () => {
  test("a diff confined to the declared key agrees", () => {
    expect(
      astAgreesIgnoringKeys(withoutKey, withKey, new Set(["recorded"])),
    ).toBe(true);
  });

  test("the key's VALUE moving is still confined to it", () => {
    const other = JSON.stringify({
      type: "document",
      children: [{ type: "paragraph", recorded: false, value: "x" }],
    });
    expect(astAgreesIgnoringKeys(other, withKey, new Set(["recorded"]))).toBe(
      true,
    );
  });

  test("a diff in any other key does not", () => {
    expect(
      astAgreesIgnoringKeys(withKey, otherKeyMoved, new Set(["recorded"])),
    ).toBe(false);
  });

  test("ignoring nothing is the plain comparison", () => {
    expect(astAgreesIgnoringKeys(withKey, withoutKey, new Set())).toBe(false);
    expect(astAgreesIgnoringKeys(withKey, withKey, new Set())).toBe(true);
  });

  test("a side that did not parse answers no, and does not throw", () => {
    expect(
      astAgreesIgnoringKeys("<<THREW>> boom", withKey, new Set(["recorded"])),
    ).toBe(false);
  });
});

describe("blanketCoverage", () => {
  // `coversOnly` stands for parity-keys.ts's own predicate
  // (identical bytes plus astAgreesIgnoringKeys over a verbatim
  // re-dump); the rows drive it directly, so the gate's arms are
  // testable without a checkout, the way the family sets are.
  test("a covered AST diff leaves the stream and needs no per-id row", () => {
    const pass = blanketCoverage(
      { blanket: ["fam-keyed"], entries: [] },
      { ast: ["a"], formatted: [] },
      SYNTHETIC,
      coversOnly("a"),
    );
    expect(pass.failures).toEqual([]);
    expect(pass.streams.ast).toEqual([]);
    expect(expectedDiffFailures([], pass.streams, corpus, SYNTHETIC)).toEqual(
      [],
    );
  });

  test("an AST diff the keys do not explain still fails", () => {
    const pass = blanketCoverage(
      { blanket: ["fam-keyed"], entries: [] },
      { ast: ["a", "b"], formatted: [] },
      SYNTHETIC,
      coversOnly("a"),
    );
    expect(pass.streams.ast).toEqual(["b"]);
    const failures = expectedDiffFailures([], pass.streams, corpus, SYNTHETIC);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("b");
    expect(failures[0]).toContain("not declared by a Parity-Diff trailer");
  });

  test("a BYTE mover is never covered", () => {
    // A byte mover is in the `formatted` stream, which the blanket
    // pass copies through untouched - so it still needs its own
    // per-id trailer.
    const pass = blanketCoverage(
      { blanket: ["fam-keyed"], entries: [] },
      { ast: [], formatted: ["a"] },
      SYNTHETIC,
      () => true,
    );
    expect(pass.streams.formatted).toEqual(["a"]);
    const failures = expectedDiffFailures([], pass.streams, corpus, SYNTHETIC);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("differs in formatted output");
  });

  test("a family with no declared keys may not be declared bare", () => {
    const pass = blanketCoverage(
      { blanket: ["fam-ast"], entries: [] },
      { ast: ["a"], formatted: [] },
      SYNTHETIC,
      () => true,
    );
    expect(pass.streams.ast).toEqual(["a"]);
    expect(pass.failures).toHaveLength(1);
    expect(pass.failures[0]).toContain("declares no AST keys");
  });

  test("a bare trailer naming no family at all fails", () => {
    const pass = blanketCoverage(
      { blanket: ["d9-typo"], entries: [] },
      { ast: ["a"], formatted: [] },
      SYNTHETIC,
      () => true,
    );
    expect(pass.streams.ast).toEqual(["a"]);
    expect(pass.failures).toHaveLength(1);
    expect(pass.failures[0]).toContain("unknown family");
  });

  test("no bare trailer covers nothing", () => {
    const pass = blanketCoverage(
      { blanket: [], entries: [] },
      { ast: ["a"], formatted: ["b"] },
      SYNTHETIC,
      () => true,
    );
    expect(pass.failures).toEqual([]);
    expect(pass.streams).toEqual({ ast: ["a"], formatted: ["b"] });
  });
});

describe("keyCoverage: the predicate the production gate runs", () => {
  // The trees a schema change produces, plus the same tree with one
  // other value moved.
  const before = JSON.stringify({ type: "p", value: "x" });
  const after = JSON.stringify({ type: "p", recorded: true, value: "x" });
  const elsewhere = JSON.stringify({ type: "p", recorded: true, value: "y" });
  const keys = new Set(["recorded"]);

  test("identical bytes plus a key-confined tree diff is covered", () => {
    const { dump } = dumperOver({
      base: new Map([["a", { formatted: "same", ast: before }]]),
      head: new Map([["a", { formatted: "same", ast: after }]]),
    });
    expect(keyCoverage(dump, { base: "base", head: "head" })("a", keys)).toBe(
      true,
    );
  });

  // THE ROW THE BYTE CONJUNCT OWNS. `differingCases` sorts on the AST
  // first, so a case that moved BOTH its bytes and its tree is in the
  // `ast` stream, and nothing but this equality refuses it: the tree
  // diff here is confined to the declared key, so the key comparison
  // alone would say yes.
  test("a byte mover is refused even when its tree diff is key-confined", () => {
    const { dump } = dumperOver({
      base: new Map([["a", { formatted: "one line\n", ast: before }]]),
      head: new Map([["a", { formatted: "one  line\n", ast: after }]]),
    });
    const covers = keyCoverage(dump, { base: "base", head: "head" });
    expect(astAgreesIgnoringKeys(before, after, keys)).toBe(true);
    expect(covers("a", keys)).toBe(false);
  });

  test("and the bare trailer then fails it, through the ast stream", () => {
    const { dump } = dumperOver({
      base: new Map([["a", { formatted: "one line\n", ast: before }]]),
      head: new Map([["a", { formatted: "one  line\n", ast: after }]]),
    });
    const pass = blanketCoverage(
      { blanket: ["fam-keyed"], entries: [] },
      { ast: ["a"], formatted: [] },
      SYNTHETIC,
      keyCoverage(dump, { base: "base", head: "head" }),
    );
    expect(pass.failures).toEqual([]);
    expect(pass.streams.ast).toEqual(["a"]);
    const failures = expectedDiffFailures([], pass.streams, corpus, SYNTHETIC);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("not declared by a Parity-Diff trailer");
  });

  test("a tree diff outside the declared keys is refused too", () => {
    const { dump } = dumperOver({
      base: new Map([["a", { formatted: "same", ast: before }]]),
      head: new Map([["a", { formatted: "same", ast: elsewhere }]]),
    });
    expect(keyCoverage(dump, { base: "base", head: "head" })("a", keys)).toBe(
      false,
    );
  });

  test("an id one side does not have is refused", () => {
    const { dump } = dumperOver({
      base: new Map(),
      head: new Map([["a", { formatted: "same", ast: after }]]),
    });
    expect(keyCoverage(dump, { base: "base", head: "head" })("a", keys)).toBe(
      false,
    );
  });

  test("the two dumps are fetched once, however many ids are asked about", () => {
    const rows = new Map([
      ["a", { formatted: "same", ast: after }],
      ["b", { formatted: "same", ast: after }],
    ]);
    const { dump, calls } = dumperOver({ base: rows, head: rows });
    const covers = keyCoverage(dump, { base: "base", head: "head" });
    covers("a", keys);
    covers("b", keys);
    covers("a", keys);
    expect(calls()).toBe(2);
  });
});

describe("a family declared BOTH ways in one range", () => {
  test("a per-id line for a covered id is a failure naming both", () => {
    const pass = blanketCoverage(
      { blanket: ["fam-keyed"], entries: [{ id: "a", family: "fam-keyed" }] },
      { ast: ["a"], formatted: [] },
      SYNTHETIC,
      coversA,
    );
    expect(pass.streams.ast).toEqual([]);
    expect(pass.entries).toEqual([]);
    expect(pass.failures).toHaveLength(1);
    expect(pass.failures[0]).toContain("a is covered by the bare");
    expect(pass.failures[0]).toContain("fam-keyed");
    expect(pass.failures[0]).toContain("delete the per-id line");
  });

  test("and the per-id gate no longer calls that id stale", () => {
    const pass = blanketCoverage(
      { blanket: ["fam-keyed"], entries: [{ id: "a", family: "fam-keyed" }] },
      { ast: ["a"], formatted: [] },
      SYNTHETIC,
      coversA,
    );
    const failures = expectedDiffFailures(
      pass.entries,
      pass.streams,
      corpus,
      SYNTHETIC,
    );
    expect(failures).toEqual([]);
  });

  test("a per-id line the blanket cannot prove is untouched", () => {
    const pass = blanketCoverage(
      {
        blanket: ["fam-keyed"],
        entries: [{ id: "b", family: "fam-ast" }],
      },
      { ast: ["a", "b"], formatted: [] },
      SYNTHETIC,
      coversA,
    );
    expect(pass.failures).toEqual([]);
    expect(pass.entries).toEqual([{ id: "b", family: "fam-ast" }]);
    expect(pass.streams.ast).toEqual(["b"]);
    expect(
      expectedDiffFailures(pass.entries, pass.streams, corpus, SYNTHETIC),
    ).toEqual([]);
  });
});

describe("the production enum's blanket declaration", () => {
  test("each family owns exactly the recorded-fact key it named", () => {
    expect([...LEDGER_FAMILIES.blanketKeys.keys()]).toEqual([
      "block-start-line-fact",
      "table-cell-column-index",
    ]);
    expect([
      ...(LEDGER_FAMILIES.blanketKeys.get("block-start-line-fact") ?? []),
    ]).toEqual(["firstWordEndsItsLine"]);
    expect([
      ...(LEDGER_FAMILIES.blanketKeys.get("table-cell-column-index") ?? []),
    ]).toEqual(["columnIndex"]);
    // A blanket family may not also be formatted-only: the two claims
    // contradict (one says the bytes are identical, the other says the
    // bytes are the only thing that moved).
    for (const family of LEDGER_FAMILIES.blanketKeys.keys()) {
      expect(LEDGER_FAMILIES.formattedOnly.has(family)).toBe(false);
      expect(LEDGER_FAMILIES.families.has(family)).toBe(true);
    }
  });
});

describe("end to end: a bare trailer over the PRODUCTION enum", () => {
  // The whole declaration path for a schema change, driven with the
  // real family enum and the real key comparison: the message a
  // landing commit would carry, the two serialized ASTs a
  // recorded-fact change produces, and the gate's verdict. Everything
  // between the commit message and `process.exitCode` is exercised
  // here; only the two child dumps that fetch the trees are stood in
  // for, because a checkout is not a unit test.
  const message = [
    "feat: read the block's first source line at parse time",
    "",
    "Every paragraph records one boolean, so every paragraph's",
    "serialized AST gains one key and no formatted byte moves.",
    "",
    "Parity-Diff: block-start-line-fact",
    "",
  ].join("\n");

  const baseAst = JSON.stringify({
    type: "document",
    children: [{ type: "paragraph", children: [], position: { line: 1 } }],
  });
  const headAst = JSON.stringify({
    type: "document",
    children: [
      {
        type: "paragraph",
        children: [],
        firstWordEndsItsLine: true,
        position: { line: 1 },
      },
    ],
  });
  const unrelatedAst = JSON.stringify({
    type: "document",
    children: [
      {
        type: "paragraph",
        children: [],
        firstWordEndsItsLine: true,
        position: { line: 2 },
      },
    ],
  });

  const corpus = new Set(["schema", "other", "bytes"]);

  test("the bare line is scanned as a family declaration", () => {
    const scan = parseExpectedDiffTrailers(message);
    expect(scan.entries).toEqual([]);
    expect(scan.blanket).toEqual(["block-start-line-fact"]);
    expect(scan.failures).toEqual([]);
  });

  test("it ACCEPTS a diff confined to the declared key", () => {
    const scan = parseExpectedDiffTrailers(message);
    const pass = blanketCoverage(
      { blanket: scan.blanket, entries: scan.entries },
      { ast: ["schema"], formatted: [] },
      LEDGER_FAMILIES,
      coversFrom(
        new Map([["schema", { base: baseAst, head: headAst, bytes: true }]]),
      ),
    );
    expect(pass.failures).toEqual([]);
    expect(pass.streams.ast).toEqual([]);
    expect(
      expectedDiffFailures(scan.entries, pass.streams, corpus, LEDGER_FAMILIES),
    ).toEqual([]);
  });

  test("it REFUSES an AST diff outside the declared key", () => {
    const scan = parseExpectedDiffTrailers(message);
    const pass = blanketCoverage(
      { blanket: scan.blanket, entries: scan.entries },
      { ast: ["other"], formatted: [] },
      LEDGER_FAMILIES,
      coversFrom(
        new Map([
          ["other", { base: baseAst, head: unrelatedAst, bytes: true }],
        ]),
      ),
    );
    expect(pass.streams.ast).toEqual(["other"]);
    const failures = expectedDiffFailures(
      scan.entries,
      pass.streams,
      corpus,
      LEDGER_FAMILIES,
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("other");
    expect(failures[0]).toContain("not declared by a Parity-Diff trailer");
  });

  test("it REFUSES a byte mover, whatever its tree did", () => {
    const scan = parseExpectedDiffTrailers(message);
    const pass = blanketCoverage(
      { blanket: scan.blanket, entries: scan.entries },
      { ast: [], formatted: ["bytes"] },
      LEDGER_FAMILIES,
      coversFrom(
        new Map([["bytes", { base: baseAst, head: headAst, bytes: false }]]),
      ),
    );
    const failures = expectedDiffFailures(
      scan.entries,
      pass.streams,
      corpus,
      LEDGER_FAMILIES,
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("differs in formatted output");
  });

  test("a bare line naming a keyless production family is refused", () => {
    const scan = parseExpectedDiffTrailers(
      "subject\n\nParity-Diff: gap-collapse\n",
    );
    const pass = blanketCoverage(
      { blanket: scan.blanket, entries: scan.entries },
      { ast: ["schema"], formatted: [] },
      LEDGER_FAMILIES,
      () => true,
    );
    expect(pass.streams.ast).toEqual(["schema"]);
    expect(pass.failures).toHaveLength(1);
    expect(pass.failures[0]).toContain("declares no AST keys");
  });
});
