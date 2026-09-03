/**
 * The KEY-IGNORING half of parity's AST comparison, and the blanket
 * `Parity-Diff:` trailer that stands on it.
 *
 * `differingCases` (scripts/parity.ts) decides a case by
 * `baseRow.ast !== headRow.ast`. Everything here is that same
 * comparison with a declared set of keys removed from both sides — the
 * question a SCHEMA change asks, where a node kind starts recording a
 * fact and every case carrying that node kind moves in the serialized
 * tree while no case's bytes move at all.
 *
 * It reads the dumper's OWN serialization rather than adding a second
 * one: the strings come back from a verbatim `dump` of the same
 * `normalizeTree` output, are parsed here, stripped, and re-serialized.
 *
 * A module of its own only because scripts/parity.ts and
 * scripts/parity-ledger.ts are both at the `max-lines` ceiling, which
 * docs/coding-standards.md answers with a split rather than with
 * shorter comments. It imports from NEITHER of them — the two things
 * it would want, `Row` and `FamilySets`, are taken structurally, so
 * the pair stays acyclic (the metrics gate holds import cycles at 0).
 */

/** The rows a verbatim dump produces, as this module reads them. */
interface DumpedTexts {
  /** The formatted output, verbatim. */
  readonly formatted: string;
  /** `JSON.stringify(normalizeTree(parse(input)))`, verbatim. */
  readonly ast: string;
}

/**
 * What {@link blanketCoverage} needs of the family enumeration: which
 * families exist, and which of them declare AST keys. Structural, so
 * `FamilySets` (scripts/parity-ledger.ts) satisfies it without this
 * module importing that one.
 */
interface KeyedFamilies {
  /** Every family a trailer may cite. */
  readonly families: ReadonlySet<string>;
  /** The families a BARE trailer may declare, with the keys each owns. */
  readonly blanketKeys: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * One per-id ledger entry, as this module reads it. Structural, so
 * `ExpectedDiff` (scripts/parity-ledger.ts) satisfies it without this
 * module importing that one.
 */
interface PerIdEntry {
  /** Corpus case id, or `fixture:<name>`. */
  readonly id: string;
  /** The family that explains the difference. */
  readonly family: string;
}

/**
 * A parsed tree with a set of object keys removed, everywhere they
 * appear. Rebuilds rather than mutating, so nothing it is handed can
 * be observed changed, and `Object.fromEntries` keeps the surviving
 * keys in their original order — which is what lets the two results be
 * compared as strings.
 * @param value - a node, an array of them, or a leaf
 * @param keys - the key names to remove
 * @returns the same shape without those keys
 */
function withoutKeys(value: unknown, keys: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) {
    return value.map((item: unknown) => withoutKeys(item, keys));
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !keys.has(key))
      .map(([key, item]) => [key, withoutKeys(item, keys)]),
  );
}

/**
 * Both serialized ASTs parsed, or undefined when either is not JSON.
 * The dumper writes `<<THREW>> …` for a case that threw, and a case
 * that threw on either side is not one a schema key can excuse.
 * @param base - the baseline's serialized AST
 * @param head - this checkout's serialized AST
 * @returns the two trees, or undefined
 */
function parseBoth(
  base: string,
  head: string,
): { base: unknown; head: unknown } | undefined {
  try {
    return { base: JSON.parse(base), head: JSON.parse(head) };
  } catch {
    return undefined;
  }
}

/**
 * Whether two serialized ASTs become the same tree once a set of keys
 * is ignored on BOTH sides.
 *
 * `JSON.stringify` of the stripped trees is the comparison, and it is
 * exact rather than approximate: key order is insertion order, so a
 * tree that lost only the declared keys spells identically on both
 * sides, and every other difference — a value, a node kind, an array
 * length — survives the strip and shows up in the string.
 * @param base - the baseline's serialized AST
 * @param head - this checkout's serialized AST
 * @param keys - the key names to ignore on both sides
 * @returns true when the two agree once the keys are gone
 */
export function astAgreesIgnoringKeys(
  base: string,
  head: string,
  keys: ReadonlySet<string>,
): boolean {
  const trees = parseBoth(base, head);
  if (trees === undefined) {
    return false;
  }
  return (
    JSON.stringify(withoutKeys(trees.base, keys)) ===
    JSON.stringify(withoutKeys(trees.head, keys))
  );
}

/**
 * The proof a BARE trailer needs, as a predicate over one case:
 * identical formatted bytes, and two ASTs that agree once the family's
 * declared keys are ignored.
 *
 * The BYTE conjunct is load-bearing: {@link blanketCoverage} is the
 * canonical statement of why. tests/scripts/parity-keys.test.ts drives
 * exactly that shape through this predicate.
 *
 * The gate's own two dumps carry DIGESTS, which no key can be stripped
 * from, so the trees come from a verbatim re-dump — ONCE per side,
 * memoized here, and only when a bare trailer was actually written. A
 * per-id re-dump the way `reportCase` works would be two child
 * processes per differing case, which for a schema change is two
 * thousand.
 * @param dumpVerbatim - runs the dumper in verbatim mode in one
 *   checkout; injected so this module never imports scripts/parity.ts
 * @param roots - the two checkouts to compare
 * @param roots.base - the materialized baseline checkout
 * @param roots.head - this checkout
 * @returns the predicate {@link blanketCoverage} calls per id
 */
export function keyCoverage(
  dumpVerbatim: (root: string) => ReadonlyMap<string, DumpedTexts>,
  roots: { base: string; head: string },
): (id: string, keys: ReadonlySet<string>) => boolean {
  let dumped:
    | {
        base: ReadonlyMap<string, DumpedTexts>;
        head: ReadonlyMap<string, DumpedTexts>;
      }
    | undefined = undefined;
  return (id, keys) => {
    dumped ??= {
      base: dumpVerbatim(roots.base),
      head: dumpVerbatim(roots.head),
    };
    const baseOne = dumped.base.get(id);
    const headOne = dumped.head.get(id);
    if (baseOne === undefined || headOne === undefined) {
      return false;
    }
    return (
      baseOne.formatted === headOne.formatted &&
      astAgreesIgnoringKeys(baseOne.ast, headOne.ast, keys)
    );
  };
}

/**
 * What a BARE trailer covers, and what it refuses.
 *
 * Runs BEFORE `expectedDiffFailures` (scripts/parity-ledger.ts) and
 * hands it the streams with the covered ids removed, so the per-id
 * form is untouched: an id a blanket family cannot prove still arrives
 * at the per-id gate and still needs its own trailer.
 *
 * The proof is `covers` ({@link keyCoverage} in production): a case is
 * covered when its formatted BYTES are identical and its two ASTs
 * agree once the family's keys are ignored on both sides. Neither
 * half is decoration. A case whose tree moved anywhere but in those
 * keys fails the second half. A case that moved BYTES fails the first
 * half - and it has to be the first half that catches it, because a
 * case whose bytes and tree both moved arrives HERE, in the `ast`
 * stream: `differingCases` sorts on the AST first and only puts a case
 * in `formatted` when its tree agreed. What the untouched `formatted`
 * stream covers is the other kind of byte mover, the one whose tree
 * did not move at all. The blanket is therefore a NARROWER claim than
 * a per-id trailer, which excuses whatever its case did.
 *
 * A per-id trailer for an id a bare trailer COVERS is reported as a
 * failure, and this is where that is decided. The two forms do
 * interact, and silence would be the wrong answer twice over: the
 * blanket form exists to delete per-id lines, so leaving them
 * accepted lets the ledger regrow exactly what it replaced; and a
 * per-id line the author wrote for some other reason would be
 * absorbed without a word. The entry is therefore removed from the
 * per-id gate's input - otherwise it reports the id as stale, which is
 * false, since the id does differ - and replaced by a message that
 * says what is actually wrong.
 *
 * A bare trailer for a family that declares no keys is a FAILED GATE,
 * not a cannot-run: the harness measured everything it needed and the
 * declaration is wrong, which is the same class as the per-id form's
 * unknown family. Exit 2 stays for the runs that measured nothing - an
 * unknown revision, an empty trailer range, a corpus that did not load
 * (docs/harnesses.md states the same split).
 * @param declared - what the range's trailers declared
 * @param declared.blanket - the families declared with a bare trailer
 * @param declared.entries - the per-id declarations, in first-seen
 *   order
 * @param streams - the two differing-id lists from differingCases
 * @param streams.ast - ids whose AST differs (or one side lacks)
 * @param streams.formatted - ids differing in formatted output only
 * @param familySets - the closed family enumeration
 * @param covers - proves one id against one family's declared keys
 * @returns the streams with the covered ids removed, the per-id
 *   entries the gate should still weigh, and one failure per unusable
 *   bare declaration or redundant per-id one
 */
export function blanketCoverage(
  declared: { blanket: readonly string[]; entries: readonly PerIdEntry[] },
  streams: { ast: readonly string[]; formatted: readonly string[] },
  familySets: KeyedFamilies,
  covers: (id: string, keys: ReadonlySet<string>) => boolean,
): {
  streams: { ast: string[]; formatted: string[] };
  entries: PerIdEntry[];
  failures: string[];
} {
  const failures: string[] = [];
  const covered = new Map<string, string>();
  for (const family of declared.blanket) {
    if (!familySets.families.has(family)) {
      failures.push(
        `expected-diffs: unknown family ${JSON.stringify(family)} on a bare trailer - the enum is ${[...familySets.families].join(" | ")}`,
      );
      continue;
    }
    const keys = familySets.blanketKeys.get(family);
    if (keys === undefined) {
      failures.push(
        `expected-diffs: ${family} declares no AST keys, so it cannot be declared bare - write one "Parity-Diff: ${family} <id>" per differing case, or give the family its keys in scripts/parity-ledger.ts`,
      );
      continue;
    }
    for (const id of streams.ast) {
      if (!covered.has(id) && covers(id, keys)) {
        covered.set(id, family);
      }
    }
  }
  for (const entry of declared.entries) {
    const by = covered.get(entry.id);
    if (by !== undefined) {
      failures.push(
        `expected-diffs: ${entry.id} is covered by the bare "Parity-Diff: ${by}" trailer, so its per-id trailer (${entry.family}) declares nothing - delete the per-id line`,
      );
    }
  }
  return {
    streams: {
      ast: streams.ast.filter((id) => !covered.has(id)),
      formatted: [...streams.formatted],
    },
    entries: declared.entries.filter((entry) => !covered.has(entry.id)),
    failures,
  };
}
