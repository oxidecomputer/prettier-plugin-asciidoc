/**
 * The `@internal` split of the `src` export surface, over planted
 * checkouts.
 *
 * knip cannot answer this question: a test importing a symbol is a
 * consumer to knip, so its zero says "nothing is orphaned" rather than
 * "the parser needs all of this". These pin the split itself and both
 * directions of the tag's staleness — the gate wiring is pinned in
 * `metrics.test.ts`, against a synthetic snapshot.
 */
import { describe, test, expect } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  readInternalSurface,
  type InternalFacts,
} from "../../scripts/metrics/internal-surface.js";

/**
 * Plant a checkout and read its internal surface.
 * @param files - `src` files, by name
 * @returns the facts for that tree
 */
function surfaceOf(files: Record<string, string>): InternalFacts {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "internal-")));
  try {
    mkdirSync(path.join(root, "src"));
    mkdirSync(path.join(root, "tests"));
    writeFileSync(path.join(root, "tests/x.test.ts"), "");
    for (const [name, contents] of Object.entries(files)) {
      writeFileSync(path.join(root, "src", name), contents);
    }
    return readInternalSurface(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// The half of the export surface knip cannot see: an export with no
// `src` consumer is still "used" as far as knip is concerned, because
// a test imports it. These pin the split and both staleness
// directions.
describe("the @internal surface", () => {
  test("an export another src file imports is not internal surface", () => {
    const facts = surfaceOf({
      "a.ts": "export const used = 1;\n",
      "b.ts": 'import { used } from "./a.js";\nexport const also = used;\n',
    });
    expect(facts.testOnly).toBe(1);
    expect(facts.untagged[0]).toContain("b.ts:also");
  });

  test("a tagged export naming a live consumer passes", () => {
    const facts = surfaceOf({
      "a.ts":
        "/**\n * Exported for its unit test (tests/x.test.ts).\n * @internal\n */\nexport const only = 1;\n",
    });
    expect(facts.testOnly).toBe(1);
    expect(facts.untagged).toEqual([]);
  });

  test("a tag naming a file that is not there does not count", () => {
    const facts = surfaceOf({
      "a.ts":
        "/**\n * Exported for tests/gone.test.ts.\n * @internal\n */\nexport const only = 1;\n",
    });
    expect(facts.untagged[0]).toContain("names no existing");
  });

  test("a tag on an export src does consume is stale", () => {
    const facts = surfaceOf({
      "a.ts":
        "/**\n * Exported for its unit test (tests/x.test.ts).\n * @internal\n */\nexport const used = 1;\n",
      "b.ts": 'import { used } from "./a.js";\nexport const also = used;\n',
    });
    expect(facts.staleTags[0]).toContain("a.ts:used");
  });

  test("the package entry is exempt: its exports are the API", () => {
    const facts = surfaceOf({ "index.ts": "export const published = 1;\n" });
    expect(facts.testOnly).toBe(0);
    expect(facts.untagged).toEqual([]);
  });
});
