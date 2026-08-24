/**
 * The generic tree walk the AST invariants run over: the node shape
 * they recognise, the narrowings that keep them cast-free, document
 * order, sibling grouping, and the offset→line/column recomputation.
 *
 * Nothing here knows which node kinds exist — the walk is over any
 * object carrying `type` and `position`, which is every AST node and
 * nothing else. Split out of ast-invariants.ts so each file stays
 * under the line ceiling; the invariants themselves live there.
 */
import type { Location } from "../../src/ast.js";

/**
 * The shape the walk recognises: a node with a source position. The
 * index signature is what keeps the rest of the file cast-free — a
 * node's other fields (`value`, `children`, ...) are read as
 * `unknown` and guarded, never asserted into existence.
 */
export interface AnyNode extends Record<string, unknown> {
  /** The node's discriminant. */
  readonly type: string;
  /** Its source span, end exclusive. */
  readonly position: {
    /** Where the node begins. */
    readonly start: Location;
    /** One past where it ends. */
    readonly end: Location;
  };
}

/**
 * Narrow an unknown value to a plain object.
 * @param value - anything reachable from the AST
 * @returns whether it is a non-null object
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Narrow an unknown value to an array of unknowns.
 *
 * `Array.isArray` alone narrows `unknown` to `any[]`, which spreads
 * an `any` into every element that follows; this predicate keeps the
 * elements `unknown` so the guards downstream stay real.
 * @param value - anything reachable from the AST
 * @returns whether it is an array
 */
export function isArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/**
 * Narrow an unknown value to a Location.
 * @param value - a candidate `position.start` / `position.end`
 * @returns whether it has the three numeric coordinates
 */
export function isLocation(value: unknown): value is Location {
  return (
    isRecord(value) &&
    typeof value.offset === "number" &&
    typeof value.line === "number" &&
    typeof value.column === "number"
  );
}

/**
 * Narrow an unknown value to a positioned AST node.
 * @param value - anything reachable from the AST
 * @returns whether it is a node with a full position
 */
export function isNode(value: unknown): value is AnyNode {
  if (!isRecord(value)) return false;
  const { type, position } = value;
  return (
    typeof type === "string" &&
    isRecord(position) &&
    isLocation(position.start) &&
    isLocation(position.end)
  );
}

/**
 * Every node in DOCUMENT ORDER (pre-order), parents before children.
 *
 * A generic `Object.entries` walk suffices for every node: a list
 * item's field order (`text` before `blocks`, spec D1) makes even the
 * one node with two child arrays document-ordered by construction.
 *
 * Exported for `itemCount` in reader-helpers.ts, which counts
 * `listItem` nodes anywhere in the tree: one walker, not two, so the
 * two files cannot disagree about what "anywhere in the tree" means.
 * @param root - the document node
 * @returns the nodes, in the order a reader meets them
 */
export function preorder(root: unknown): AnyNode[] {
  const nodes: AnyNode[] = [];
  const visit = (value: unknown): void => {
    if (isArray(value)) {
      for (const element of value) visit(element);
      return;
    }
    if (!isRecord(value)) return;
    if (isNode(value)) nodes.push(value);
    const children = Object.entries(value)
      .filter(([key]) => key !== "position")
      .map(([, child]) => child);
    for (const child of children) visit(child);
  };
  visit(root);
  return nodes;
}

/**
 * The nodes one array element contributes to its sibling group. An
 * `ItemBlock` entry is `{gap, block}` rather than a node, so it
 * contributes the nodes DIRECTLY on it.
 * @param element - one element of an array in the tree
 * @returns the nodes it holds
 */
export function siblingsOf(element: unknown): AnyNode[] {
  if (isNode(element)) return [element];
  if (!isRecord(element)) return [];
  return Object.values(element).filter((inner) => isNode(inner));
}

/**
 * Every array of siblings in the tree, as node arrays.
 * @param root - the document node
 * @returns one entry per sibling array
 */
export function siblingGroups(root: unknown): AnyNode[][] {
  const groups: AnyNode[][] = [];
  const visit = (value: unknown): void => {
    if (isArray(value)) {
      const group: AnyNode[] = [];
      for (const element of value) {
        group.push(...siblingsOf(element));
        visit(element);
      }
      if (group.length > 1) groups.push(group);
      return;
    }
    if (!isRecord(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "position") continue;
      visit(child);
    }
  };
  visit(root);
  return groups;
}

/**
 * The line and column an offset really has, recomputed from the
 * source the same way tests/parser/reader.test.ts recomputed them for
 * tokens.
 * @param source - the whole document
 * @param offset - a zero-based character offset
 * @returns the 1-based line and column
 */
export function locationOf(
  source: string,
  offset: number,
): { line: number; column: number } {
  const before = source.slice(0, offset);
  return {
    line: before.split("\n").length,
    column: offset - (before.lastIndexOf("\n") + 1) + 1,
  };
}
