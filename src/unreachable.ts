/**
 * Throws unconditionally, typed as `never` so TypeScript
 * treats call sites as unreachable.
 *
 * A bare `throw` inside a `??` or ternary expression does
 * not satisfy the type-checker — only a call whose return
 * type is `never` does. Wrapping the throw here gives us
 * that property without extra boilerplate at every site:
 *
 *   const groups = RE.exec(line.image)?.groups ?? unreachable(
 *     `Invalid attribute entry: ${line.image}`
 *   );
 *
 * Used in `src/parse/build/` and the reader's frame stack to
 * guard states that are impossible only because two places
 * agree — a line-shape pattern in the classifier and the
 * builder's own regex for the same shape, say. If one fires
 * it means those two drifted apart; it never means bad user
 * input, which the reader is total over.
 * @param message - A description of the violated
 *   invariant, including enough context (rule name, token
 *   kind, surrounding state) to diagnose the bug without
 *   a debugger.
 */
export function unreachable(message: string): never {
  throw new Error(message);
}

/**
 * Assert that a node has the expected `type` discriminant,
 * narrowing its TypeScript type accordingly. Throws via
 * {@link unreachable} if the node is undefined or has a
 * different type.
 *
 * Replaces the verbose
 * `if (x?.type !== "foo") unreachable(...)` pattern with
 * a single call: `narrow(x, "foo")`.
 * @param node - The node to narrow (may be undefined).
 * @param type - The expected value of `node.type`.
 */
export function narrow<T extends { type: string }, K extends T["type"]>(
  node: T | undefined,
  type: K,
): asserts node is Extract<T, { type: K }> {
  if (node?.type !== type) {
    unreachable(`expected ${type}, got ${String(node?.type)}`);
  }
}
