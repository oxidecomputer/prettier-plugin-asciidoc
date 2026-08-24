/**
 * The conformance quarantine PIN: how many corpus cases this revision
 * admits it cannot format the way the oracle does.
 *
 * The quarantine manifest (`tests/conformance/quarantine.json`)
 * asserts EXACT agreement between a case's actual failures and its
 * entry, so a fix turns quarantined cases red and the entry has to be
 * deleted. That makes the manifest shrink monotonically BY
 * CONVENTION — and convention is the whole hole: nothing stops
 * `bun run triage --write` from writing a longer manifest, and a
 * longer manifest is a suite that goes green on strictly less. The
 * shrink is a fix somebody made; the growth is a gap somebody
 * accepted, and only one of those should be possible without saying
 * so.
 *
 * So the count is PINNED, in a file of its own, and the pin is
 * checked at HEAD by `bun run metrics`. The pin is EXACT rather than
 * a ceiling, and the two directions carry different messages:
 *
 * - the manifest GREW — a case was quarantined. The gate says move
 *   the pin in the same commit, which is what makes the growth a
 *   deliberate, reviewable act instead of a diff nobody reads;
 * - the manifest SHRANK — a case was fixed. Also a pin move, for the
 *   reason every other pin here is exact: a ceiling left above the
 *   real number is SLACK, and slack is exactly the room a later
 *   re-quarantine slips into unnoticed. A fix is already editing the
 *   manifest; the pin is one more line in the same diff.
 *
 * Everything here reads the MEASURED checkout. A revision with no pin
 * file reads as `undefined` — no pin — which is how this counter
 * ratchets from absent instead of from zero, the same tolerance
 * `design.ts` gives a registry that is not there yet. Whether an
 * absent pin FAILS is `gates.ts`'s decision, and it only asks that of
 * THIS repository.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { isArray, isObject, strictJson } from "./json.js";

/** Where the quarantine manifest lives, in every checkout. */
const MANIFEST_FILE = "tests/conformance/quarantine.json";

/** Where the pin lives, in every checkout. */
const PIN_FILE = "scripts/metrics/conformance-pin.json";

// Exactly the keys the pin file may carry. An unknown key is rejected
// rather than ignored, for the reason every registry here rejects
// one: a typo'd `"quarantned"` that is merely dropped takes the pin
// with it, and a missing pin is a gate that went quiet.
const PIN_KEYS = new Set(["quarantined", "note"]);

/** What this module contributes to one revision's snapshot. */
export interface ConformanceFacts {
  /**
   * Entries in the quarantine manifest, or undefined at a revision
   * whose manifest cannot be read as one.
   */
  readonly quarantined: number | undefined;
  /**
   * The pinned count, or undefined at a revision with no pin file —
   * which is how the counter ratchets from absent.
   */
  readonly pin: number | undefined;
  /**
   * Why the manifest or the pin could not be read, and — when both
   * read — why they disagree. At HEAD every one of these is a gate
   * failure; at an archived base nothing reads them.
   */
  readonly faults: readonly string[];
}

/**
 * Count the manifest's entries.
 * @param root - the measured checkout root
 * @returns the count, or the reason there is no count
 */
function readManifest(root: string): {
  quarantined: number | undefined;
  fault: string | undefined;
} {
  const file = path.join(root, MANIFEST_FILE);
  if (!existsSync(file)) {
    return { quarantined: undefined, fault: `${MANIFEST_FILE}: not found` };
  }
  const { value, fault } = strictJson(
    MANIFEST_FILE,
    readFileSync(file, "utf8"),
  );
  if (fault !== undefined) return { quarantined: undefined, fault };
  // An ARRAY is an object to `typeof`, and a manifest accidentally
  // written as `[]` would count zero quarantined cases — the shape
  // that reads as "everything passes now".
  if (!isObject(value) || isArray(value)) {
    return {
      quarantined: undefined,
      fault: `${MANIFEST_FILE}: not a JSON object keyed by case id`,
    };
  }
  return { quarantined: Object.keys(value).length, fault: undefined };
}

/**
 * Read the pin.
 * @param root - the measured checkout root
 * @returns the pinned count, or the reason there is none
 */
function readPin(root: string): {
  pin: number | undefined;
  fault: string | undefined;
} {
  const file = path.join(root, PIN_FILE);
  if (!existsSync(file)) return { pin: undefined, fault: undefined };
  const { value, fault } = strictJson(PIN_FILE, readFileSync(file, "utf8"));
  if (fault !== undefined) return { pin: undefined, fault };
  if (!isObject(value) || isArray(value)) {
    return { pin: undefined, fault: `${PIN_FILE}: not a JSON object` };
  }
  const unknown = Object.keys(value).filter((key) => !PIN_KEYS.has(key));
  if (unknown.length > 0) {
    return {
      pin: undefined,
      fault: `${PIN_FILE}: unknown key(s) ${unknown.join(", ")}`,
    };
  }
  const { quarantined, note } = value;
  if (typeof quarantined !== "number" || !Number.isInteger(quarantined)) {
    return {
      pin: undefined,
      fault: `${PIN_FILE}: quarantined must be an integer`,
    };
  }
  if (typeof note !== "string" || note === "") {
    return {
      pin: undefined,
      fault: `${PIN_FILE}: note must be a non-empty string saying what the pin is for`,
    };
  }
  return { pin: quarantined, fault: undefined };
}

/**
 * Measure one checkout's conformance pin.
 * @param root - the measured checkout root
 * @returns the manifest length, the pin, and every fault between them
 */
export function readConformance(root: string): ConformanceFacts {
  const { quarantined, fault: manifestFault } = readManifest(root);
  const { pin, fault: pinFault } = readPin(root);
  const faults: string[] = [];
  if (manifestFault !== undefined) faults.push(manifestFault);
  if (pinFault !== undefined) faults.push(pinFault);
  if (
    quarantined !== undefined &&
    pin === undefined &&
    pinFault === undefined
  ) {
    faults.push(
      `${PIN_FILE}: not found — the quarantine count is unpinned, so nothing stops \`bun run triage --write\` from growing ${MANIFEST_FILE}`,
    );
  }
  if (quarantined !== undefined && pin !== undefined && quarantined !== pin) {
    faults.push(
      quarantined > pin
        ? `${MANIFEST_FILE} holds ${String(quarantined)} quarantined case(s), above the pin of ${String(pin)} — a case was QUARANTINED. Growth is a deliberate act: move the pin in ${PIN_FILE} in the same commit, with the reason in its note`
        : `${MANIFEST_FILE} holds ${String(quarantined)} quarantined case(s), below the pin of ${String(pin)} — a case was FIXED. Lower the pin in ${PIN_FILE} in the same commit; a pin left above the real count is slack a later re-quarantine slips into`,
    );
  }
  return { quarantined, pin, faults };
}
