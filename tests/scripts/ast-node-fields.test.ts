/**
 * The per-node-kind field derivation (`scripts/ast-node-fields.ts`):
 * what a `type` discriminant collects, and the two rules that make it
 * different from "the properties this interface writes down".
 *
 * Driven over PLANTED trees rather than only over `src/ast.ts`, for
 * the reason `tests/scripts/fact-inventory.test.ts` gives: a
 * derivation whose only evidence is "it agrees with our own file"
 * could be broken in a way nothing here would show.
 */
import { describe, expect, test } from "vitest";
import { nodeFieldsByType } from "../../scripts/ast-node-fields.js";
import { REPO_ROOT } from "../../scripts/metrics/model.js";
import { inCheckout } from "../lib/checkout.js";

/**
 * The fields one planted `src/ast.ts` gives one discriminant.
 * @param ast - the file's text
 * @param type - the discriminant to read
 * @returns the field names, sorted
 */
function fieldsOf(ast: string, type: string): string[] {
  return inCheckout({ "src/ast.ts": ast }, (root) =>
    [...(nodeFieldsByType(root).get(type) ?? [])].toSorted(),
  );
}

describe("what a discriminant collects", () => {
  test("an interface's own properties", () => {
    const ast = ["interface A {", '  type: "a";', "  x: string;", "}"].join(
      "\n",
    );
    expect(fieldsOf(ast, "a")).toEqual(["type", "x"]);
  });

  test("the properties of what it extends", () => {
    // `Node` and `ItemBody` are not exported and fix no discriminant
    // of their own, and their fields end up on real nodes all the
    // same. A table keyed on what a node CARRIES has to see them.
    const ast = [
      "interface Base {",
      "  position: number;",
      "}",
      "interface A extends Base {",
      '  type: "a";',
      "}",
    ].join("\n");
    expect(fieldsOf(ast, "a")).toEqual(["position", "type"]);
  });

  test("the UNION over every interface fixing the same discriminant", () => {
    // Five interfaces share `type: "delimitedBlock"` in the real
    // file. A tree read at runtime knows only the discriminant, so a
    // row naming any of the five's fields is a row that can match.
    const ast = [
      "interface A {",
      '  type: "shared";',
      "  x: string;",
      "}",
      "interface B {",
      '  type: "shared";',
      "  y: string;",
      "}",
    ].join("\n");
    expect(fieldsOf(ast, "shared")).toEqual(["type", "x", "y"]);
  });

  test("an interface fixing no discriminant contributes no key", () => {
    const ast = ["interface Loose {", "  type: string;", "}"].join("\n");
    expect(
      inCheckout({ "src/ast.ts": ast }, (root) => [
        ...nodeFieldsByType(root).keys(),
      ]),
    ).toEqual([]);
  });
});

describe("the real checkout", () => {
  const byType = nodeFieldsByType(REPO_ROOT);

  test("a paragraph carries its inherited position", () => {
    expect(byType.get("paragraph")?.has("position")).toBe(true);
  });

  test("a delimited block carries all five interfaces' fields", () => {
    const fields = byType.get("delimitedBlock");
    expect(fields?.has("sourceDelimiter")).toBe(true);
    expect(fields?.has("language")).toBe(true);
  });
});
