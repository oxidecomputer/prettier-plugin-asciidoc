#!/usr/bin/env bun
/* eslint-disable no-console -- runner script, not library code */

/**
 * Conformance triage runner (issue #7). Assesses every corpus case
 * against the three differential properties and reports failures
 * grouped by failure signature. With --write, regenerates the
 * quarantine manifest: existing issue tags survive for cases that
 * still fail; new failures are tagged UNTRIAGED for a human to map to
 * gap issues; entries whose cases now pass (or vanished from the
 * corpus) are dropped, which is how fixes get pinned.
 *
 * Usage:
 *   bun scripts/conformance-triage.ts          # report only
 *   bun scripts/conformance-triage.ts --write  # regenerate manifest
 */
import { writeFileSync } from "node:fs";
import { format } from "prettier";
import { compareIds, loadCorpus } from "../tests/conformance/loader.js";
import {
  assessCase,
  type ConformanceProperty,
} from "../tests/conformance/properties.js";
import {
  loadQuarantine,
  QUARANTINE_PATH,
  type QuarantineEntry,
} from "../tests/conformance/quarantine.js";

const write = process.argv.includes("--write");
const existing = loadQuarantine();
const groups = loadCorpus();

const failing = new Map<
  string,
  { fails: ConformanceProperty[]; detail: string }
>();
let total = 0;
for (const group of groups) {
  for (const corpusCase of group.cases) {
    total += 1;
    // eslint-disable-next-line no-await-in-loop -- sequential on purpose: unbounded concurrency over ~1,600 cases would exhaust memory/process limits
    const { failures, detail } = await assessCase(corpusCase.input);
    if (failures.length > 0) {
      failing.set(corpusCase.id, { fails: failures, detail });
    }
  }
}

// Group by failure signature so triage happens in mechanical batches:
// all "idempotency" cases in tables_test likely share one gap issue.
const bySignature = new Map<string, string[]>();
for (const [id, { fails }] of failing) {
  const signature = fails.join("+");
  const ids = bySignature.get(signature) ?? [];
  ids.push(id);
  bySignature.set(signature, ids);
}

console.log(`${String(total)} cases, ${String(failing.size)} failing.\n`);
const sampleSize = 5;
for (const [signature, ids] of bySignature) {
  console.log(`[${signature}] ${String(ids.length)} cases`);
  for (const id of ids.slice(0, sampleSize)) {
    const detail = failing.get(id)?.detail ?? "";
    console.log(`  ${id}${detail === "" ? "" : ` — ${detail}`}`);
  }
  if (ids.length > sampleSize) {
    console.log(`  ... ${String(ids.length - sampleSize)} more`);
  }
  console.log("");
}

if (write) {
  const manifest: Record<string, QuarantineEntry> = {};
  for (const id of [...failing.keys()].toSorted(compareIds)) {
    const found = failing.get(id);
    if (found === undefined) continue;
    manifest[id] = {
      fails: found.fails,
      // A still-failing case keeps its issue tag even if its failure
      // SET changed (e.g. fidelity → idempotency+fidelity after a
      // partial fix). The tag usually still names the right feature
      // area, and dropping it would discard triage work; the cost is
      // that a signature change can leave a stale tag until re-triage.
      issue: existing.get(id)?.issue ?? "UNTRIAGED",
    };
  }
  // Emit Prettier-normal form so `fmt:check` passes immediately after
  // a --write, instead of failing until someone runs `bun run fmt`.
  writeFileSync(
    QUARANTINE_PATH,
    await format(JSON.stringify(manifest), { parser: "json" }),
  );
  console.log(`Wrote ${String(failing.size)} entries to ${QUARANTINE_PATH}.`);
}
