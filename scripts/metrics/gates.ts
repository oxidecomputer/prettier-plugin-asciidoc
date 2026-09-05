/**
 * What makes `bun run metrics` fail.
 *
 * Fourteen ABSOLUTE gates, checked at HEAD with or without a base: an
 * import cycle (a cyclic group has no reading order), a relative import
 * that resolves to nothing (a hole in that graph, so the cycle gate
 * cannot see through it), an edge a LAYER RULE forbids (the direction
 * the stack is supposed to run in), an unused export under `src`,
 * `scripts` OR `tests` (the residue of
 * a half-finished deletion), a duplication ceiling exceeded (jscpd's
 * clone percentage over the same three trees), a resident agreement
 * harness (a test that holds two of our own components in permanent
 * agreement), a stale interior-validation registry entry (a registry
 * that has rotted is worse than no registry, because it reads as an
 * audit), a registry that cannot be READ at all, a defense marker
 * split across two comment lines, an unregistered or stale
 * cross-directory crossing, a named seam that is missing or
 * unmeasurable, a `src` export with no `src` consumer that does not
 * say so with `@internal`, a quarantine manifest that has left its
 * conformance pin, and a minimums file that no longer describes the
 * source tree.
 *
 * Separately from all of them, {@link measuredNothing} is the floor:
 * a `src` too small to be this repository's is not a failing gate, it
 * is a scorecard that measured nothing, and the caller exits 2 for it.
 *
 * The last five exist because of one property of this family: every
 * ratchet in it fires on RISE, so it can never see an UNDERCOUNT. A
 * deleted registry, a wrapped marker, a renamed seam, a shrinking
 * minimums file and a quarantine manifest that grew all report FEWER
 * PROBLEMS, which a rise-only ratchet reads as progress. They are absolute
 * gates rather than ratchets for that reason, and they run on the head
 * snapshot only — an archived base with no registry and no marker
 * convention is measured, not judged.
 *
 * Four RATCHETS, checked only against a `--base`: cognitive MAX per
 * layer, the escape hatches, each named CONTRACT's width, and each
 * defense counter. None may rise. A layer with no files at the base is
 * skipped, since a layer that did not exist cannot have regressed —
 * and a contract or a defense marker the base does not carry is
 * skipped for the same reason. A VOCABULARY seam is reported and not
 * ratcheted: it is judged by precision, not width.
 *
 * Deliberately NOT a gate: the count of functions over cyclomatic 10.
 * Cyclomatic complexity cannot tell a flat `switch` over a
 * discriminated union from three nested loops, and this is a parser —
 * dispatch tables are the shape the code is supposed to have. Gating on
 * it would push the code towards handler tables that score better and
 * read worse, which is the wrong direction and the wrong metric. It
 * stays on the table, with its offenders named, for a human to read.
 * See `docs/harnesses.md`.
 */
import { LAYERS, ZERO, type Snapshot } from "./model.js";

/**
 * The MEASURED-NOTHING floor: how small `src` may be before the
 * scorecard refuses to report on it at all.
 *
 * Every other harness in `scripts/` has one — `parity.ts` has
 * `MINIMUM_CASES`, `shape-diff.ts` names its missing ids — and the
 * scorecard was the one that would have printed a full green table
 * for an empty `src/`: no files means no cycles, no unused exports,
 * no escape hatches and no layer violations. The numbers are FLOORS,
 * not ratchets: they say "the tree is there", nothing about its size,
 * and the tree is 36 files and 214 exported names as this is written.
 */
const MINIMUM_SOURCE_FILES = 10;

/** The exported-name floor; see {@link MINIMUM_SOURCE_FILES}. */
const MINIMUM_EXPORTED_SYMBOLS = 40;

/**
 * The duplication CEILING: the highest jscpd duplicated-line
 * percentage `src`, `scripts` and `tests` together may report.
 *
 * jscpd was widened from `src` alone to all three trees once a survey
 * found duplication the narrower scan never saw: 84 hand-spelled
 * copies of one format-assert trailer, eight hand-rolled recursive
 * directory walkers, and more. Fixing that pile is its own body of
 * work, so this pins where the tree stands TODAY (1.7%, rounded up
 * for headroom) as a ceiling rather than leaving the number to drift
 * upward unnoticed the way it did before anything read `tests` and
 * `scripts` at all. Lowering it rides the commit that consolidates
 * one of those copies away.
 */
const MAXIMUM_DUPLICATED_PERCENT = 1.8;

// The escape-hatch rows, with the label each gets in a failure.
const HATCHES = [
  ["eslint-disable", "eslintDisable"],
  ["as assertions", "asAssertions"],
  ["non-null assertions", "nonNull"],
  ["any", "anyType"],
] as const;

// The defense-inventory counters that ratchet, with the label each
// gets in a failure. `interiorValidation` is not here: it is
// `number | undefined` and gets its own check below.
const DEFENSES = [
  ["unreachable() sites", "unreachableCalls"],
  ["Caller contract: markers", "callerContract"],
  ["Total fallback: markers", "totalFallback"],
  ["Valid only when markers", "validOnlyWhen"],
] as const;

/**
 * The unused-export gate, over `src`, `scripts` AND `tests`.
 *
 * knip is a devDependency and runs every time, so "it did not run" is
 * a failure to report rather than a row to skip: a hard gate that goes
 * quiet when its tool is missing is not a gate.
 *
 * `scripts/` joined `src/` here once the harnesses became code we
 * maintain rather than scaffolding, and `tests/` joined both once the
 * harness's own shared modules (`tests/helpers.ts`, `tests/lib/*.ts`,
 * and the rest) grew large enough to leave the same kind of residue: a
 * per-file helper's last consumer moves during a consolidation, and
 * the export it left behind stays green forever with nothing counting
 * it. All three trees became gateable only once every entry point was
 * DECLARED in `knip.json` (every script, plus every `.test.ts` file
 * under `tests`); until knip was told which files are entry points,
 * its findings there were all false. The three counts stay separate
 * rows on the table so a reader can see which tree grew residue.
 * @param head - the snapshot for this checkout
 * @returns one message per failure
 */
function deadCodeGates(head: Snapshot): string[] {
  const failures: string[] = [];
  for (const [count, where] of [
    [head.dead.unusedExports, "src/"],
    [head.dead.unusedScriptExports, "scripts/"],
    [head.dead.unusedTestExports, "tests/"],
  ] as const) {
    if (count === undefined) {
      failures.push(
        `knip did not run, so the unused-export gate could not be checked for ${where}`,
      );
    } else if (count > ZERO) {
      failures.push(`knip: ${String(count)} unused export(s) under ${where}`);
    }
  }
  return failures;
}

/**
 * The duplication gate: jscpd's duplicated-line percentage over
 * `src`, `scripts` and `tests` may not exceed {@link
 * MAXIMUM_DUPLICATED_PERCENT}.
 *
 * jscpd is a devDependency and runs every time, the same as knip, so
 * "it did not run" is a failure to report rather than a row to skip.
 * @param head - the snapshot for this checkout
 * @returns one message per failure, empty when the ceiling holds
 */
function duplicationGate(head: Snapshot): string[] {
  const { duplicatedPercent } = head.dead;
  if (duplicatedPercent === undefined) {
    return [
      "jscpd did not run, so the duplication ceiling could not be checked",
    ];
  }
  return duplicatedPercent > MAXIMUM_DUPLICATED_PERCENT
    ? [
        `jscpd: ${String(duplicatedPercent)}% duplicated lines exceeds the ${String(MAXIMUM_DUPLICATED_PERCENT)}% ceiling`,
      ]
    : [];
}

/**
 * The gates that hold with or without a base.
 * @param head - the snapshot for this checkout
 * @returns one message per failure
 */
function absoluteGates(head: Snapshot): string[] {
  const failures: string[] = [];
  if (head.coupling.cycles.length > ZERO) {
    failures.push(
      `import cycle (a cycle has no reading order):\n  ${head.coupling.cycles.join("\n  ")}`,
    );
  }
  if (head.coupling.unresolved.length > ZERO) {
    failures.push(
      `relative import that resolves to nothing (a hole in the import graph):\n  ${head.coupling.unresolved.join("\n  ")}`,
    );
  }
  // An aspiration that is not enforced is not a layering; it is a
  // diagram. Each rule is a DIRECTION, so the fix is always to move the
  // declaration to the layer that owns it, never to add an exemption.
  if (head.coupling.layerViolations.length > ZERO) {
    failures.push(
      `layer rule violated (see LAYER_RULES in scripts/metrics/graph.ts):\n  ${head.coupling.layerViolations.join("\n  ")}`,
    );
  }
  failures.push(...deadCodeGates(head), ...duplicationGate(head));
  // Not a ratchet: an agreement harness is the shape that makes two
  // implementations of one rule permanently affordable, so the budget
  // is zero and the fix is to delete the second component, never to
  // hold the count steady. See `scripts/metrics/design.ts`.
  if (head.harnesses.length > ZERO) {
    failures.push(
      `agreement harness (a test holding two of OUR components in agreement — delete one component, or check the survivor against the oracle or pinned bytes):\n  ${head.harnesses.join("\n  ")}`,
    );
  }
  // A registry entry whose site is gone makes the registry read as an
  // audit of code that no longer exists, which is worse than no
  // registry at all.
  if (head.defense.staleEntries.length > ZERO) {
    failures.push(
      `stale interior-validation registry entry (the site is gone — delete the entry from scripts/metrics/defense-registry.json):\n  ${head.defense.staleEntries.join("\n  ")}`,
    );
  }
  failures.push(...undercountGates(head));
  return failures;
}

/**
 * The checks that can see an UNDERCOUNT.
 *
 * Every ratchet in the design family fires on RISE, so it is blind in
 * exactly one direction: a deleted registry, a wrapped marker and a
 * renamed seam all report LESS, and less reads as progress. These are
 * absolute gates for that reason — the only place the family can catch
 * itself being switched off.
 *
 * They run against THIS repository only. All three read hand-maintained
 * registries that describe it — the seam names, the audited sites,
 * the crossings rows, three marker spellings — so an archived
 * `--base` revision or a
 * `--root <dir>` checkout is measured by them and not judged: neither
 * has our registry, and failing a stranger's tree for not being us
 * would make `--root` useless (it is how this CLI's own exit codes are
 * tested).
 * @param head - the snapshot for this checkout
 * @returns one message per undercount, empty when not our tree
 */
function undercountGates(head: Snapshot): string[] {
  if (!head.repository) {
    return [];
  }
  const failures: string[] = [];
  // "A hard gate that goes quiet when its tool is missing is not a
  // gate" applies to a registry as much as to knip: a
  // deleted or corrupted registry file would otherwise disable the
  // whole interior-validation family with a green build.
  if (head.defense.registryFaults.length > ZERO) {
    failures.push(
      `the interior-validation registry could not be read, so the family could not be measured:\n  ${head.defense.registryFaults.join("\n  ")}`,
    );
  }
  if (head.defense.markerNearMisses.length > ZERO) {
    failures.push(
      `defense marker split across two comment lines, so it is not counted (rejoin it onto one line):\n  ${head.defense.markerNearMisses.join("\n  ")}`,
    );
  }
  failures.push(
    ...crossingFaults(head),
    ...seamFaults(head),
    ...internalSurfaceFaults(head),
    // The quarantine pin and the minimums file are undercounts of the
    // same family: the manifest shrinks by convention, the minimums
    // file goes stale by omission, and both failures read as fewer
    // problems. See `conformance.ts` and `score-minimums.ts`.
    ...head.conformance.faults,
    ...head.minimums.faults,
  );
  return failures;
}

/**
 * The `@internal` taxonomy, in both directions.
 *
 * It belongs with the undercounts for the reason they all do: the
 * transition it catches is INVISIBLE. An export loses its last `src`
 * consumer during an ordinary refactor — no line is deleted, no count
 * moves, knip still sees the test importing it — and the export
 * quietly becomes surface that exists for a test alone. Nothing else
 * on this scorecard can see that happen.
 *
 * Repository-scoped, like the other conventions here: the tag is ours,
 * an archived base predates it, and a `--root` checkout never agreed
 * to it.
 * @param head - the snapshot for this checkout
 * @returns one message per untagged export or stale tag
 */
function internalSurfaceFaults(head: Snapshot): string[] {
  return [...head.internal.untagged, ...head.internal.staleTags];
}

/**
 * The crossings registry's own freshness, in BOTH directions.
 *
 * A crossing no row names is a coupling nobody argued for; a row whose
 * crossing is gone makes the registry read as an audit of code that no
 * longer exists. One direction alone would be worthless — and, like
 * every other registry here, a file that cannot be READ at all must
 * fail rather than go quiet, because a registry that reads short
 * reports FEWER unregistered crossings, which is the direction that
 * looks like progress.
 * @param head - the snapshot for this checkout
 * @returns one message per fault, unregistered crossing or stale row
 */
function crossingFaults(head: Snapshot): string[] {
  const { crossings } = head;
  if (crossings.faults.length > ZERO) {
    return [
      `the crossings registry could not be read, so no crossing could be checked:\n  ${crossings.faults.join("\n  ")}`,
    ];
  }
  const failures: string[] = [];
  if (crossings.unregistered.length > ZERO) {
    failures.push(
      `unregistered cross-directory crossing (name it, classify it and say why in scripts/metrics/crossings-registry.json):\n  ${crossings.unregistered.join("\n  ")}`,
    );
  }
  if (crossings.stale.length > ZERO) {
    failures.push(
      `stale crossings-registry row (the import is gone — delete the row from scripts/metrics/crossings-registry.json):\n  ${crossings.stale.join("\n  ")}`,
    );
  }
  return failures;
}

/**
 * The seam registry's own freshness.
 *
 * `CONTRACTS` + `VOCABULARY` is a hand-maintained list exactly as
 * `defense-registry.json` is, so it gets the same treatment: a named
 * seam that is not declared where the list says has left the budget,
 * and a rise-only ratchet reads its disappearance as nothing at all.
 * The flatness faults ride along here because they mean the same
 * thing — the number that would have been reported is not one a human
 * would agree with.
 * @param head - the snapshot for this checkout
 * @returns one message per unmeasurable or missing seam
 */
function seamFaults(head: Snapshot): string[] {
  return head.seams.flatMap((seam) => {
    if (seam.fault !== undefined) {
      return [`seam ${seam.fault}`];
    }
    if (seam.members !== undefined) {
      return [];
    }
    return [
      `${seam.kind} ${seam.name} is not declared in ${seam.file} (a renamed or deleted seam silently leaves the budget — update CONTRACTS/VOCABULARY in scripts/metrics/design.ts)`,
    ];
  });
}

/**
 * The contract ratchet: a named CONTRACT may not gain members.
 *
 * Vocabulary rows are skipped by construction. A contract is what an
 * implementer satisfies, so each member is a fact one module had to
 * publish and the count is a budget; vocabulary is data used in
 * interface definitions, judged by precision instead — a wide
 * vocabulary is fine, so a rise in one is not a regression to report.
 *
 * A contract the base does not name is skipped — both the case where
 * the interface did not exist yet and the case where this revision's
 * registry names one the base's file did not declare. Neither can
 * have widened.
 * @param head - the snapshot for this checkout
 * @param base - the base snapshot
 * @returns one message per widened contract
 */
function seamRatchets(head: Snapshot, base: Snapshot): string[] {
  const before = new Map(base.seams.map((seam) => [seam.name, seam.members]));
  return head.seams.flatMap((seam) => {
    if (seam.kind !== "contract") {
      return [];
    }
    const was = before.get(seam.name);
    if (was === undefined || seam.members === undefined) {
      return [];
    }
    return seam.members > was
      ? [`contract ${seam.name}: ${String(was)} -> ${String(seam.members)}`]
      : [];
  });
}

/**
 * The defense ratchet: the residual defense burden may not rise.
 *
 * A counter that is ZERO at the base is skipped, because a zero cannot
 * be told apart from "this marker was not a convention yet" and
 * introducing a marker must not read as a regression. The cost is
 * real and worth stating: a category driven all the way to zero loses
 * its gate until something re-enters it. `docs/harnesses.md`
 * carries that caveat.
 * @param head - the snapshot for this checkout
 * @param base - the base snapshot
 * @returns one message per risen counter
 */
function defenseRatchets(head: Snapshot, base: Snapshot): string[] {
  const failures: string[] = [];
  // Destructured once: `prefer-destructuring` with
  // `enforceForRenamedProperties` reads every member chain on an
  // assignment's right side as a destructuring it wants spelled out.
  const { defense: was } = base;
  const { defense: now } = head;
  for (const [name, key] of DEFENSES) {
    const { [key]: before } = was;
    const { [key]: after } = now;
    if (before === ZERO) {
      continue;
    }
    if (after > before) {
      failures.push(`${name}: ${String(before)} -> ${String(after)}`);
    }
  }
  const { interiorValidation: registryBefore } = was;
  const { interiorValidation: registryAfter } = now;
  if (
    registryBefore !== undefined &&
    registryAfter !== undefined &&
    registryAfter > registryBefore
  ) {
    failures.push(
      `interior validation sites: ${String(registryBefore)} -> ${String(registryAfter)}`,
    );
  }
  return failures;
}

/**
 * The ratchets: peak difficulty and escape hatches may not rise.
 *
 * Ratchets are what "apply the metrics constantly" means — a number
 * nobody has to answer for drifts.
 * @param head - the snapshot for this checkout
 * @param base - the base snapshot
 * @returns one message per regression
 */
function ratchets(head: Snapshot, base: Snapshot): string[] {
  const failures: string[] = [];
  for (const layer of LAYERS) {
    if (base.layers[layer].files === ZERO) {
      continue;
    }
    if (head.cognitive[layer].max > base.cognitive[layer].max) {
      failures.push(
        `cognitive MAX ${layer}: ${String(base.cognitive[layer].max)} -> ${String(head.cognitive[layer].max)}`,
      );
    }
  }
  for (const [name, key] of HATCHES) {
    if (head.hatches[key] > base.hatches[key]) {
      failures.push(
        `${name}: ${String(base.hatches[key])} -> ${String(head.hatches[key])}`,
      );
    }
  }
  failures.push(...seamRatchets(head, base), ...defenseRatchets(head, base));
  return failures;
}

/**
 * Every reason this measurement should fail the build.
 * @param head - the snapshot for this checkout
 * @param base - the snapshot for `--base`, when one was given; without
 * it only the absolute gates run
 * @returns the failure messages; empty means exit 0
 */
export function gateFailures(head: Snapshot, base?: Snapshot): string[] {
  return [
    ...absoluteGates(head),
    ...(base === undefined ? [] : ratchets(head, base)),
  ];
}

/**
 * Whether this measurement is too small to be a measurement.
 *
 * Not a gate and not a ratchet: a tree this small means the scorecard
 * was pointed at the wrong directory, or at a checkout that never
 * materialized. The caller turns it into exit 2 — the harness could
 * not run — rather than into exit 1, because failing the BUILD for it
 * would say the code regressed, and nothing here says anything about
 * the code.
 *
 * THIS repository only, like the other checks that read our own
 * conventions: `--root` is how this CLI's exit codes are tested, and
 * those planted checkouts are three files by design.
 * @param head - the snapshot for this checkout
 * @returns the reason it could not run, or undefined
 */
export function measuredNothing(head: Snapshot): string | undefined {
  if (!head.repository) {
    return undefined;
  }
  const { files } = head.layers.src;
  const symbols = head.coupling.exportedSymbols;
  if (files >= MINIMUM_SOURCE_FILES && symbols >= MINIMUM_EXPORTED_SYMBOLS) {
    return undefined;
  }
  return `the scorecard measured ${String(files)} file(s) and ${String(symbols)} exported name(s) under src/, below the floor of ${String(MINIMUM_SOURCE_FILES)} and ${String(MINIMUM_EXPORTED_SYMBOLS)} — the source tree did not load, so nothing was checked`;
}
