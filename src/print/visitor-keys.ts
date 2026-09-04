/**
 * Which properties of a node hold its children, one entry per node
 * kind -- the answer Prettier needs before it can walk our AST for
 * anything other than printing.
 *
 * Printing never walks the tree on its own: the printer asks for the
 * children it wants by name (`path.map(print, "children")`). Cursor
 * tracking DOES walk it, generically, and it asks the PRINTER which
 * keys to follow. With no answer Prettier falls back to
 * `Object.keys(node)` and descends into every enumerable property, and
 * `position` is the first one it meets: it calls the parser's
 * `locStart` on the `{start, end}` object ITSELF, reads that object's
 * own `position` as `undefined`, and throws dereferencing
 * `undefined.start`. It never gets as far as the `{offset, line,
 * column}` points inside. `formatWithCursor` therefore throws on every
 * document. Declaring the keys is what confines the walk to the arrays
 * that really do hold nodes.
 *
 * Cursor tracking is the only live reader of this table today. Range
 * formatting never consults it: `getSortedChildNodes` returns `[]` at
 * its `if (!filter) return []` guard unless the printer declares
 * `canAttachComment`, which this one does not, so the range walk stops
 * before it would ask for a key. Nor would the table help it if it did
 * ask. Prettier's `calculateRange` keeps the outermost node at each end
 * that `isSourceElement` accepts, and that function is a switch over
 * Prettier's OWN parser names whose default is `return false`. A
 * third-party parser gets no range back, and `formatRange` reads that
 * as the empty range, so a sub-range returns the document untouched.
 * Nothing here can lift that; the row in tests/plugin.test.ts holds
 * only that the path stays total. If `canAttachComment` is ever
 * declared, the range walk starts descending and this table becomes
 * load-bearing for it too. See issue #37.
 *
 * WHAT IS NOT DECLARED, and why it is not an oversight: a list item's
 * `blocks` is an array of `ItemBlock` records -- `{gap, block}` -- not
 * of nodes. The nodes are one level further in, behind the
 * verbatim separator lines the item was written with, and Prettier's
 * walk has no way to step through a wrapper: it calls `locStart` on
 * every array element it meets. Declaring `blocks` would reintroduce
 * exactly the throw this file exists to prevent, so it stays out, and
 * a cursor inside a list item's attached block resolves to the item
 * rather than to the block. That costs precision in the cursor's
 * translated position and nothing else -- the item is printed, so
 * Prettier still has a node to diff the cursor against.
 *
 * The table below is STATIC, not computed from a node's runtime shape,
 * because the keys Prettier may follow are a decision about our AST
 * rather than an accident of what a particular parse produced. Two
 * things keep it from going stale. {@link declareVisitorKeys} derives
 * the required keys FROM THE AST TYPES and refuses a table that omits
 * one, so a node kind that gains a child array fails `bun run check`
 * until it is declared. And tests/print/visitor-keys.test.ts walks real
 * parse trees and fails on any array of nodes the table does not name,
 * which is the same question asked of values instead of types.
 */
import type { AnyNode } from "./blocks.js";

/** The discriminant of every node kind the parser can produce. */
type NodeType = AnyNode["type"];

/**
 * The union members carrying one discriminant. Usually one interface;
 * `delimitedBlock` is six, which is why this is `Extract` over the
 * whole union rather than a lookup keyed to a single node.
 */
type NodeOfType<T extends NodeType> = Extract<AnyNode, Record<"type", T>>;

/**
 * The keys of `N` whose value is an array OF NODES.
 *
 * The element test is what makes the derivation trustworthy in the
 * direction that matters most: a list item's `blocks` is an array too,
 * and it is excluded here by the same rule that admits `children` --
 * its elements are not nodes.
 *
 * `-?` and `NonNullable` do different jobs and both are needed. `-?`
 * suppresses the `| undefined` that a mapped read of an OPTIONAL
 * property injects into the indexed access; `NonNullable` is what makes
 * an optional child array derivable at all, because without it
 * `kids?: AnyNode[]` reads as `AnyNode[] | undefined`, which extends no
 * array type and so derives `never` -- a child array the table would
 * then never be asked to name. Three cases pin the behaviour, each
 * checked against the compiler:
 *
 * - `kids?: AnyNode[]` derives `"kids"`, the optional case.
 * - `kids: AnyNode[] | undefined` derives `"kids"`, the same case
 *   spelled with an explicit widening rather than a `?`.
 * - `{ fenced?: undefined; kids: AnyNode[] }` derives exactly `"kids"`
 *   and not `"fenced"`, which is the shape the six delimited-block
 *   members really have: `NonNullable<undefined>` is `never`, the
 *   inferred `Element` is `never`, and `Element extends AnyNode`
 *   distributes over it to `never`.
 *
 * Two shapes this derivation does NOT catch, both documented rather
 * than fixed because neither exists in the AST today. A SINGLE-NODE
 * child property (`caption: BlockTitleNode`) would be a legitimate
 * Prettier child -- `getChildren` yields a non-array value when
 * `isMatchedNode(value)` -- but it is invisible to both this type gate
 * and the runtime guard in tests/print/visitor-keys.test.ts, which
 * inspects arrays only, so the walk would silently stop there. And a
 * HETEROGENEOUS array such as `(BlockNode | ItemBlock)[]` is REQUIRED
 * by this gate rather than excluded by it -- `Element extends AnyNode`
 * distributes over the element union and one node-typed member is
 * enough -- so declaring it would hand `locStart` an `ItemBlock` and
 * crash. The only backstop there is that same test file's row on every
 * declared key holding an array of nodes only.
 */
type ChildArrayKeys<N> = N extends unknown
  ? {
      [K in keyof N]-?: NonNullable<N[K]> extends ReadonlyArray<infer Element>
        ? Element extends AnyNode
          ? K & string
          : never
        : never;
    }[keyof N]
  : never;

/**
 * The shape of the table: every node kind gets a row, and a row may
 * name only that kind's own child arrays. A kind with none gets
 * an empty tuple type, which only `[]` satisfies.
 */
type VisitorKeyTable = {
  readonly [T in NodeType]: ReadonlyArray<ChildArrayKeys<NodeOfType<T>>>;
};

/**
 * The child arrays a candidate table FAILS to name. `never` is the
 * passing value; anything else is the key that was forgotten.
 */
type UndeclaredChildArrays<T extends VisitorKeyTable> = {
  [T2 in NodeType]: Exclude<ChildArrayKeys<NodeOfType<T2>>, T[T2][number]>;
}[NodeType];

/**
 * `unknown` when the table names every child array, and an object with
 * a property no table literal has when it does not -- so the omission
 * surfaces at the call site, naming the missing key, instead of
 * silently shrinking the walk.
 */
type Complete<T extends VisitorKeyTable> = [UndeclaredChildArrays<T>] extends [
  never,
]
  ? unknown
  : {
      /** The child array the table below never names. */
      readonly undeclaredChildArrayKey: UndeclaredChildArrays<T>;
    };

/**
 * Identity on the table, with completeness as the price of admission.
 *
 * `VisitorKeyTable` alone rules out a key that is not a child array;
 * the `Complete<T>` intersection rules out the other direction, a
 * child array the table forgot. Intersecting with `unknown` in the
 * passing case leaves the parameter's type exactly `T`, so the
 * function needs no assertion to return it.
 * @param table - the child keys, one row per node kind
 * @returns the same table, with its literal row types preserved
 */
function declareVisitorKeys<const T extends VisitorKeyTable>(
  table: T & Complete<T>,
): T {
  return table;
}

/**
 * The child keys, per node kind. Rows are in the order the node kinds
 * are declared in src/ast.ts: the document, the inline spans, then the
 * blocks.
 *
 * Where a kind has two child arrays, they are listed in DOCUMENT
 * ORDER, because Prettier's cursor walk keeps the last containing node
 * it meets and its `nodeBeforeCursor`/`nodeAfterCursor` pair comes from
 * the order the children arrive in. An admonition's `text` (the
 * `NOTE: text` body) precedes its `children` (the delimited body) --
 * exactly one of the two is ever non-empty, so the order is a
 * statement of intent here rather than something a parse can expose.
 */
const CHILD_KEYS = declareVisitorKeys({
  document: ["children"],

  paragraph: ["children"],
  text: [],
  bold: ["children"],
  italic: ["children"],
  monospace: ["children"],
  highlight: ["children"],
  curvedQuote: ["children"],
  superscript: ["children"],
  subscript: ["children"],
  characterReference: [],
  // An escaped mark is an atomic leaf for the same reason: its two
  // bytes live in `value` and neither is a node.
  escapedMark: [],
  attributeReference: [],
  inlineMacro: [],
  link: [],
  xref: [],
  inlineAnchor: [],
  rawLine: [],
  hardLineBreak: [],
  // A passthrough is an atomic leaf: its bytes live in `value`, and
  // there is no child for a cursor walk to descend into.
  passthrough: [],

  heading: [],
  authorLine: [],
  revisionLine: [],
  // A header's lines are genuine nodes with positions of their own
  // (issue #18's closed HeaderLineNode union), so the cursor walk may
  // descend to the exact line it sits on. The PRINTER still never
  // asks: it prints the header as one run without path.map.
  documentHeader: ["lines"],
  discreteHeading: [],
  comment: [],
  attributeEntry: [],
  list: ["children"],
  listItem: ["text"],
  delimitedBlock: [],
  // A table's rows hold its cells and a cell holds no node at all -
  // its bytes are its opening and its runs, both records rather than
  // children. The walk descends to the cell a cursor sits in and
  // stops there.
  table: ["children"],
  tableRow: ["children"],
  tableCell: [],
  parentBlock: ["children"],
  admonition: ["text", "children"],
  thematicBreak: [],
  pageBreak: [],
  blockMacro: [],
  preprocessorDirective: [],
  frontMatter: [],
  blockAttributeList: [],
  blockTitle: [],
  blockAnchor: [],
});

/**
 * The one thing the lookup below reads. Wider than the node union on
 * purpose -- see {@link getVisitorKeys}.
 */
interface Discriminated {
  /** The node kind's tag. */
  readonly type: string;
}

// The rows again, keyed by the discriminant as a plain string and
// copied ONCE into the mutable arrays Prettier's signature asks for.
// The table's type is total over the node union, so every lookup a
// real node makes hits; the Map is what lets the function below answer
// for a discriminant it does not know WITHOUT indexing a typed record
// with an untyped key.
const KEYS_BY_TYPE = new Map<string, string[]>(
  Object.entries(CHILD_KEYS).map(([type, keys]): [string, string[]] => [
    type,
    [...keys],
  ]),
);

// The answer for a discriminant the table does not name. Shared, for
// the same reason the rows themselves are: see getVisitorKeys.
const NO_KEYS: string[] = [];

/**
 * Every node-kind discriminant the table declares a row for. The table
 * is total over the node union, so this is the whole discriminant list.
 *
 * Exported so tests/print/visitor-keys.test.ts can require its
 * documents to EXERCISE every kind, not just the ten that declare a
 * child key: a kind no document reaches makes that file's other rows
 * pass vacuously. No src consumer.
 * @internal
 */
export const KNOWN_NODE_TYPES: readonly string[] = [...KEYS_BY_TYPE.keys()];

/**
 * The keys Prettier may follow out of one node.
 *
 * Wired onto the printer as `getVisitorKeys`, which is where Prettier
 * looks for it: the parser descriptor has no such field, and a plugin
 * that leaves it unset gets the `Object.keys` fallback described at the
 * top of this file.
 *
 * The parameter is deliberately WIDER than the node union. Prettier
 * calls this on whatever its walk is holding, and the safe total answer
 * for something the table does not name is "no children" -- never a
 * guess that would point `locStart` at an object with no position.
 *
 * The stored row is returned as it is, not copied. Prettier's signature
 * says `string[]`, but nothing on the other side writes to it:
 * `getChildren` and `massageAst` only iterate the array and `isLeaf`
 * only reads its length. Copying would allocate once per node per walk
 * to protect against a mutation that never happens.
 * @param node - anything carrying a node discriminant
 * @returns its child-array property names, in document order
 */
export function getVisitorKeys(node: Discriminated): string[] {
  return KEYS_BY_TYPE.get(node.type) ?? NO_KEYS;
}
