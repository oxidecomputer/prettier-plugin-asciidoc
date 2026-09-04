import path from "node:path";
import { describe, test, expect } from "vitest";
import {
  compareIds,
  loadCorpus,
  parseJsonl,
  _readDirectorySafe,
} from "./loader.js";
import { inCheckout } from "../lib/checkout.js";

// These assertions pin the loader to the real vendored corpus rather
// than fixtures: the corpus is checked in, so its gross shape is a
// stable fact of the repo (until a deliberate re-vendor).
describe("loadCorpus", () => {
  const groups = loadCorpus();

  test("includes the big Asciidoctor test groups", () => {
    const names = groups.map((g) => g.name);
    expect(names).toContain("lists_test");
    expect(names).toContain("blocks_test");
    expect(names).toContain("docs");
    expect(names).toContain("fixtures");
    expect(names).toContain("local");
  });

  test("yields a four-digit corpus overall", () => {
    const total = groups.reduce((n, g) => n + g.cases.length, 0);
    expect(total).toBeGreaterThan(1000);
  });

  test("every case has a unique id and non-empty input", () => {
    const ids = new Set<string>();
    for (const group of groups) {
      for (const c of group.cases) {
        expect(ids.has(c.id), `duplicate id ${c.id}`).toBe(false);
        ids.add(c.id);
        expect(c.input.length).toBeGreaterThan(0);
      }
    }
  });
});

/**
 * Asserts that `bad.jsonl` under a planted checkout fails to parse
 * with a `file:line` message naming the malformed second line.
 * @param root - the checkout root
 */
function expectMalformedLineThrows(root: string): void {
  const bad = path.join(root, "bad.jsonl");
  expect(() => parseJsonl(bad)).toThrowError(
    `${bad}:2: expected {id, input} strings`,
  );
}

describe("parseJsonl", () => {
  test("throws with file:line on a malformed line", () => {
    // A corrupted vendor file must fail loudly at collection time,
    // naming the exact line, instead of surfacing as confusing
    // per-case failures downstream.
    inCheckout(
      {
        "bad.jsonl":
          '{"id":"ok#t#0","input":"fine\\n"}\n{"id":"missing-input"}\n',
      },
      (root) => {
        expectMalformedLineThrows(root);
      },
    );
  });
});

describe("compareIds", () => {
  test("orders by code unit regardless of locale conventions", () => {
    // localeCompare("en") would say "a" < "B"; code-unit order says
    // the opposite. The manifest must sort identically on every
    // contributor's machine, so the locale-independent order wins.
    expect(compareIds("B", "a")).toBeLessThan(0);
    expect(compareIds("a", "B")).toBeGreaterThan(0);
    expect(compareIds("same", "same")).toBe(0);
  });
});

describe("_readDirectorySafe", () => {
  test("returns empty array for nonexistent directories", () => {
    const result = _readDirectorySafe(
      "nonexistent/directory/that/does/not/exist",
    );
    expect(result).toEqual([]);
  });

  test("returns files from existing directories", () => {
    const result = _readDirectorySafe("vendor/asciidoctor-corpus");
    expect(result.length).toBeGreaterThan(0);
    expect(result.some((f) => f.endsWith(".jsonl"))).toBe(true);
  });
});
