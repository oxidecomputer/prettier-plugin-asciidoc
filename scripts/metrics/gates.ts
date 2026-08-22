/**
 * What makes `bun run metrics` fail.
 *
 * Eight ABSOLUTE gates, checked at HEAD with or without a base: an
 * import cycle (a cyclic group has no reading order), a relative import
 * that resolves to nothing (a hole in that graph, so the cycle gate
 * cannot see through it), an unused export under `src` (the residue of
 * a half-finished deletion), a resident agreement harness (a test that
 * holds two of our own components in permanent agreement), a stale
 * interior-validation registry entry (a registry that has rotted is
 * worse than no registry, because it reads as an audit), a registry
 * that cannot be READ at all, a defense marker split across two
 * comment lines, and a named seam that is missing or unmeasurable.
 *
 * The last three exist because of one property of this family: every
 * ratchet in it fires on RISE, so it can never see an UNDERCOUNT. A
 * deleted registry, a wrapped marker and a renamed seam all report
 * LESS, which a rise-only ratchet reads as progress. They are absolute
 * gates rather than ratchets for that reason, and they run on the head
 * snapshot only — an archived base with no registry and no marker
 * convention is measured, not judged.
 *
 * Four RATCHETS, checked only against a `--base`: cognitive MAX per
 * layer, the escape hatches, each named seam's width, and each defense
 * counter. None may rise. A layer with no files at the base is
 * skipped, since a layer that did not exist cannot have regressed —
 * and a seam or a defense marker the base does not carry is skipped
 * for the same reason.
 *
 * Deliberately NOT a gate: the count of functions over cyclomatic 10
 * (Ruling 35). Cyclomatic complexity cannot tell a flat `switch` over a
 * discriminated union from three nested loops, and this is a parser —
 * dispatch tables are the shape the code is supposed to have. Gating on
 * it would push the code towards handler tables that score better and
 * read worse, which is the wrong direction and the wrong metric. It
 * stays on the table, with its offenders named, for a human to read.
 * See `docs/simplicity-metrics.md`.
 */
import { LAYERS, ZERO, type Snapshot } from "./model.js";

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
  // Ruling 36: knip is a devDependency and runs every time, so
  // "it did not run" is a failure to report rather than a row to skip.
  // A hard gate that goes quiet when its tool is missing is not a gate.
  if (head.dead.unusedExports === undefined) {
    failures.push(
      "knip did not run, so the unused-export gate could not be checked",
    );
  } else if (head.dead.unusedExports > ZERO) {
    failures.push(
      `knip: ${String(head.dead.unusedExports)} unused export(s) under src/`,
    );
  }
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
 * The three checks that can see an UNDERCOUNT.
 *
 * Every ratchet in the design family fires on RISE, so it is blind in
 * exactly one direction: a deleted registry, a wrapped marker and a
 * renamed seam all report LESS, and less reads as progress. These are
 * absolute gates for that reason — the only place the family can catch
 * itself being switched off.
 *
 * They run against THIS repository only. All three read hand-maintained
 * registries that describe it — four seam names, five audited sites,
 * three marker spellings — so an archived `--base` revision or a
 * `--root <dir>` checkout is measured by them and not judged: neither
 * has our registry, and failing a stranger's tree for not being us
 * would make `--root` useless (it is how this CLI's own exit codes are
 * tested).
 * @param head - the snapshot for this checkout
 * @returns one message per undercount, empty when not our tree
 */
function undercountGates(head: Snapshot): string[] {
  if (!head.repository) return [];
  const failures: string[] = [];
  // "A hard gate that goes quiet when its tool is missing is not a
  // gate" (Ruling 36) applies to a registry as much as to knip: a
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
  failures.push(...seamFaults(head));
  return failures;
}

/**
 * The seam registry's own freshness.
 *
 * `SEAMS` is a hand-maintained list exactly as
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
    if (seam.fault !== undefined) return [`seam ${seam.fault}`];
    if (seam.members !== undefined) return [];
    return [
      `seam ${seam.name} is not declared in ${seam.file} (a renamed or deleted seam silently leaves the budget — update SEAMS in scripts/metrics/design.ts)`,
    ];
  });
}

/**
 * The seam ratchet: a named interface may not gain members.
 *
 * A seam the base does not name is skipped — both the case where the
 * interface did not exist yet and the case where this revision's
 * registry names one the base's file did not declare. Neither can
 * have widened.
 * @param head - the snapshot for this checkout
 * @param base - the base snapshot
 * @returns one message per widened seam
 */
function seamRatchets(head: Snapshot, base: Snapshot): string[] {
  const before = new Map(base.seams.map((seam) => [seam.name, seam.members]));
  return head.seams.flatMap((seam) => {
    const was = before.get(seam.name);
    if (was === undefined || seam.members === undefined) return [];
    return seam.members > was
      ? [`seam ${seam.name}: ${String(was)} -> ${String(seam.members)}`]
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
 * its gate until something re-enters it. `docs/simplicity-metrics.md`
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
    if (before === ZERO) continue;
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
    if (base.layers[layer].files === ZERO) continue;
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
