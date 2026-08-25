/**
 * Assert that a node has the expected `type` discriminant, narrowing
 * its TypeScript type accordingly. Throws if the node is undefined or
 * has a different type.
 *
 * Replaces the verbose `if (x?.type !== "foo") throw ...` pattern
 * with a single call: `narrow(x, "foo")`.
 * @param node - The node to narrow (may be undefined).
 * @param type - The expected value of `node.type`.
 * Exported for the test helpers that narrow an AST node before
 * asserting on it (tests/helpers.ts); no src consumer.
 * @internal
 */
export function narrow<T extends { type: string }, K extends T["type"]>(
  node: T | undefined,
  type: K,
): asserts node is Extract<T, { type: K }> {
  if (node?.type !== type) {
    throw new Error(`expected ${type}, got ${String(node?.type)}`);
  }
}
