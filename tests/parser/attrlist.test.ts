import { describe, expect, test } from "vitest";
import { parseAttrlist } from "../../src/parse/attrlist.js";

describe("parseAttrlist — the one first-positional spelling", () => {
  test.each([
    ["", ""],
    ["source,ruby", "source"],
    [" verse , x", "verse"],
    ["#myid", "#myid"],
    [".role", ".role"],
    ["a]b", "a]b"],
    ["NOTE", "NOTE"],
    ["quote, Firstname Lastname", "quote"],
  ])("interior %j has style %j", (raw, style) => {
    expect(parseAttrlist(raw)).toEqual({ raw, style });
  });
});
