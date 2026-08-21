/**
 * The parity harness's own unit tests.
 *
 * `scripts/parity.ts` is the gate the whole drop-chevrotain plan
 * leans on, and its two failure modes are silent ones: a dropped
 * `--base` comparing a checkout with itself, and a corpus that did
 * not load reporting "0 cases identical". Both are argument- and
 * bookkeeping-level bugs, so they are tested at that level.
 */
import { describe, expect, test } from "vitest";
import {
  describeDifference,
  isRow,
  isTiming,
  parseArguments,
} from "../../scripts/parity.js";

describe("parseArguments", () => {
  test.each([
    [["--base", "abc123"], "abc123", 20, false],
    [["--base=abc123"], "abc123", 20, false],
    [["--base", "abc123", "--limit", "3"], "abc123", 3, false],
    [["--base", "abc123", "--allow-parent-block-end"], "abc123", 20, true],
  ])("%j", (argv, revision, limit, allow) => {
    expect(parseArguments(argv)).toEqual({
      revision,
      limit,
      allowParentBlockEnd: allow,
    });
  });

  test("a missing --base is an error, never a self-comparison", () => {
    expect(() => parseArguments([])).toThrow("--base <rev> is required");
  });

  test("an unrecognised argument is an error, never a shrug", () => {
    expect(() => parseArguments(["--base", "x", "--fast"])).toThrow(
      "unrecognised argument --fast",
    );
  });
});

describe("isRow", () => {
  test.each([
    [{ id: "a", formatted: "f", ast: "t" }, true],
    [{ id: "a", formatted: "f" }, false],
    [{ id: 1, formatted: "f", ast: "t" }, false],
    ["not an object", false],
    [undefined, false],
  ])("%j → %s", (value, expected) => {
    expect(isRow(value)).toBe(expected);
  });
});

describe("isTiming", () => {
  test.each([
    [{ formatMs: 12 }, true],
    [{ formatMs: "12" }, false],
    // A case row must never read as the timing line, or the run would
    // drop a case from the comparison and still report parity.
    [{ id: "a", formatted: "f", ast: "t" }, false],
    [undefined, false],
  ])("%j → %s", (value, expected) => {
    expect(isTiming(value)).toBe(expected);
  });
});

describe("describeDifference", () => {
  test("identical texts have no difference", () => {
    expect(describeDifference("ast", "a\nb", "a\nb")).toBeUndefined();
  });
  test("the first differing line is reported with both sides", () => {
    const message = describeDifference("ast", "a\nb", "a\nc");
    expect(message).toContain("ast line 2");
    expect(message).toContain('"b"');
    expect(message).toContain('"c"');
  });
});
