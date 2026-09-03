/**
 * The declared visitor keys (src/print/visitor-keys.ts), asked of
 * VALUES instead of types.
 *
 * The table already carries a compile-time gate: `declareVisitorKeys`
 * derives each node kind's child arrays from the AST interfaces and
 * refuses a table that omits one. That gate reads the DECLARATIONS.
 * This file reads the trees the parser actually builds -- every case in
 * the conformance corpus, plus a hand-written document for the kinds a
 * corpus of Asciidoctor's own test heredocs need not contain -- and
 * asks the questions the declarations cannot answer on their own:
 *
 * - is every array of nodes the parser really produces declared? A
 *   builder that starts filling a field the interface types loosely
 *   would slip past the type gate and be caught here.
 * - is everything the table names really an array of NODES? This is
 *   the safety property the whole file exists for: Prettier calls
 *   `locStart` on every element it is pointed at, and `locStart` reads
 *   `position.start`.
 * - do the documents between them EXERCISE every node kind? Without
 *   that, the two questions above go unasked for whichever kind no
 *   document produces, and the rows about it pass by saying nothing.
 *
 * The one place the walk deliberately stops is a list item's `blocks`,
 * whose elements are `{gap, block}` records rather than nodes. The
 * last row pins that it is the ONLY such place: stepping through
 * `blocks` and nothing else has to reach every node in the tree.
 */
import { describe, expect, test } from "vitest";
import { parse } from "../../src/parser.js";
import {
  KNOWN_NODE_TYPES,
  getVisitorKeys,
} from "../../src/print/visitor-keys.js";
import { loadCorpus } from "../conformance/loader.js";
import {
  type AnyNode,
  isArray,
  isNode,
  preorder,
  siblingsOf,
} from "../parser/ast-walk.js";

/**
 * A document reaching the node kinds the corpus cannot be relied on to
 * carry, spelled out so the rows below are never vacuous for them:
 * both admonition forms, the inline spans, an anchor, a page break and
 * a thematic break.
 */
const HAND_WRITTEN = [
  "= Title",
  ":toc:",
  "",
  "// a line comment",
  "[[an-anchor]]",
  ".A block title",
  "[.lead]",
  "Some *bold* and _italic_ and `mono` and #marked# text,",
  "a \"`curved double`\" quote and a '`curved single`' quote,",
  "a ^super^ and a ~sub~ span, a (C) and an -- and a &copy; reference,",
  String.raw`an escaped \* mark that opens nothing (issue #84),`,
  "an {attribute} reference, a https://example.com[link], an",
  "<<xref,cross reference>>, an image:pic.png[alt] macro, an",
  "[[inline-anchor]] anchor, and a hard break +",
  "on the next line.",
  "",
  "NOTE: a paragraph-form admonition.",
  "",
  "[WARNING]",
  "====",
  "A delimited admonition.",
  "====",
  "",
  "====",
  "An example block.",
  "====",
  "",
  "ifdef::flag[]",
  "include::other.adoc[]",
  "endif::flag[]",
  "",
  ".Listing",
  "[source,rust]",
  "----",
  "let x = 1;",
  "----",
  "",
  "....",
  "literal",
  "....",
  "",
  "```rust",
  "let y = 2;",
  "```",
  "",
  "    an indented literal paragraph",
  "",
  "|===",
  "| a | b",
  "|===",
  "",
  "image::diagram.png[Diagram]",
  "",
  "[discrete]",
  "== A discrete heading",
  "",
  "* one",
  "** deep inner",
  "+",
  "attached para",
  "* [x] a checked item",
  "",
  ". ordered",
  ". items",
  "",
  "----",
  "callout source <1>",
  "----",
  "<1> a callout",
  "",
  "'''",
  "",
  "<<<",
  "",
].join("\n");

/**
 * Every document the rows run over: the whole conformance corpus, plus
 * the hand-written one above.
 * @returns the source text of each document, deduplicated by content
 */
function documents(): string[] {
  const corpus = loadCorpus().flatMap((group) =>
    group.cases.map((entry) => entry.input),
  );
  return [...new Set([HAND_WRITTEN, ...corpus])];
}

const SOURCES = documents();

/**
 * The nodes reachable from a root by following the declared visitor
 * keys -- Prettier's own walk, run here without Prettier.
 *
 * With `stepThroughItemBlocks`, a list item's `blocks` is followed too,
 * and `siblingsOf` unwraps each `{gap, block}` record to the node
 * inside it. That is the hop the declared keys cannot express, and
 * having both walks under one function is what lets the two rows below
 * measure exactly the difference between them.
 * The root is taken as `unknown` and narrowed here, the same way
 * `preorder` takes it, so the two walks below can be compared without
 * either side asserting a type at the other.
 * @param root - a parsed document
 * @param stepThroughItemBlocks - follow a list item's `blocks` as well
 * @returns every node the walk reaches, root included
 */
function reachable(
  root: unknown,
  stepThroughItemBlocks: boolean,
): Set<AnyNode> {
  if (!isNode(root)) {
    return new Set();
  }
  const seen = new Set<AnyNode>([root]);
  const queue = [root];
  while (queue.length > 0) {
    const node = queue.pop();
    if (node === undefined) {
      break;
    }
    const wrapper =
      stepThroughItemBlocks && node.type === "listItem" ? ["blocks"] : [];
    for (const key of [...getVisitorKeys(node), ...wrapper]) {
      const value = node[key];
      if (!isArray(value)) {
        continue;
      }
      for (const child of value.flatMap(siblingsOf)) {
        if (seen.has(child)) {
          continue;
        }
        seen.add(child);
        queue.push(child);
      }
    }
  }
  return seen;
}

/**
 * Every own key of a node whose value is an array holding at least one
 * node -- what the declared keys have to be a superset of.
 * @param node - one node from a real parse tree
 * @returns the names of its node-bearing arrays
 */
function nodeArrayKeys(node: AnyNode): string[] {
  return Object.entries(node).flatMap(([key, value]) =>
    isArray(value) && value.some((element) => isNode(element)) ? [key] : [],
  );
}

/**
 * The node-bearing arrays of one node that the declared keys do NOT
 * name, tagged with the kind they were found on so a failure says
 * which builder outgrew the table.
 * @param node - one node from a real parse tree
 * @returns `kind.key` for each undeclared node-bearing array
 */
function undeclaredKeysOf(node: AnyNode): string[] {
  const declared = new Set(getVisitorKeys(node));
  return nodeArrayKeys(node)
    .filter((key) => !declared.has(key))
    .map((key) => `${node.type}.${key}`);
}

/**
 * The declared keys of one node that hold something OTHER than an array
 * of nodes -- the ones that would hand Prettier's `locStart` a value
 * with no position.
 *
 * An ABSENT key is not a complaint. Prettier tolerates it exactly:
 * `node[key]` is `undefined`, `Array.isArray(undefined)` is false and
 * `isMatchedNode(undefined)` is false, so the walk skips it and reads
 * it as "no children here". A union member that legitimately lacks one
 * of its kind's declared keys is therefore fine; a member that has the
 * key with a non-array value is not, because that value goes straight
 * into `locStart`.
 * @param node - one node from a real parse tree
 * @returns one complaint per offending key, empty when all are sound
 */
function unsafeKeysOf(node: AnyNode): string[] {
  return getVisitorKeys(node).flatMap((key) => {
    const value = node[key];
    if (value === undefined) {
      return [];
    }
    if (!isArray(value)) {
      return [`${node.type}.${key} is present but is not an array`];
    }
    return value.every(isNode) ? [] : [`${node.type}.${key} holds a non-node`];
  });
}

/**
 * The kinds of node in one tree that the declared keys do not reach
 * even once a list item's `blocks` wrapper is stepped through.
 * @param tree - a parsed document
 * @returns the discriminant of every node the walk misses
 */
function unreachableKinds(tree: unknown): string[] {
  const walked = reachable(tree, true);
  return preorder(tree)
    .filter((node) => !walked.has(node))
    .map((node) => node.type);
}

/**
 * Whether the declared keys ALONE leave part of a tree unvisited --
 * true exactly when some list item holds an attached block.
 * @param tree - a parsed document
 * @returns whether the keys-only walk falls short of the whole tree
 */
function fallsShort(tree: unknown): boolean {
  return reachable(tree, false).size < preorder(tree).length;
}

const TREES = SOURCES.map((source) => parse(source));
const ALL_NODES = TREES.flatMap((tree) => preorder(tree));

describe("the declared visitor keys, against real parse trees", () => {
  // Vacuity guard, the whole-table half. A row below that passes
  // because the documents contain no node of the kind it is about
  // proves nothing, and the kind most likely to be missing is exactly
  // the one the rows exist to catch: a new kind whose builder starts
  // filling an UNDECLARED node array contributes nothing to the
  // with-children list under it, because getVisitorKeys answers `[]`
  // for it. So the documents are required to reach every discriminant
  // the table declares, not just the ones that declare a child key.
  // That turns "a new kind must be declared" -- already enforced at
  // compile time -- into "a new kind must also be EXERCISED".
  test("the documents reach every node kind the table declares", () => {
    const reached = new Set(ALL_NODES.map((node) => node.type));
    expect([...reached].toSorted()).toEqual([...KNOWN_NODE_TYPES].toSorted());
  });

  // Vacuity guard, the with-children half. Kept as an exact list
  // because it fails loudly if a declaration is ever dropped from a
  // kind that has one, and it is stable against corpus churn: the
  // hand-written document above reaches all fourteen on its own: its
  // `= Title` plus `:toc:` open a documentHeader whose `lines` hold
  // the attribute entry (issue #18), its curved-quote phrases
  // (issue #74) reach `curvedQuote`, and its `^super^`/`~sub~` phrases
  // (issue #14) reach the two span kinds the last two `QUOTE_SUBS`
  // rows spell.
  test("the documents reach every kind that declares a child key", () => {
    const withChildren = ALL_NODES.filter(
      (node) => getVisitorKeys(node).length > 0,
    );
    const kinds = new Set(withChildren.map((node) => node.type));
    expect([...kinds].toSorted()).toEqual([
      "admonition",
      "bold",
      "curvedQuote",
      "document",
      "documentHeader",
      "highlight",
      "italic",
      "list",
      "listItem",
      "monospace",
      "paragraph",
      "parentBlock",
      "subscript",
      "superscript",
    ]);
  });

  // The direction the type gate cannot see: a field the parser fills
  // with nodes that the table does not name.
  test("every array of nodes the parser builds is declared", () => {
    expect([...new Set(ALL_NODES.flatMap(undeclaredKeysOf))]).toEqual([]);
  });

  // The safety property itself. Prettier calls locStart on every array
  // element a declared key leads it to, so every one of them must be a
  // node with a position -- which is exactly what `isNode` asks. A key
  // that is simply absent is not a violation; see `unsafeKeysOf`.
  test("every declared key present holds an array of nodes only", () => {
    expect([...new Set(ALL_NODES.flatMap(unsafeKeysOf))]).toEqual([]);
  });

  // The blind spot, pinned. A list item's `blocks` is the one hop the
  // declared keys skip; stepping through it and nothing else has to
  // close the gap completely. A second wrapper appearing anywhere in
  // the AST fails here rather than quietly shrinking what cursor
  // tracking can see.
  test("a list item's blocks is the only place the walk stops short", () => {
    expect([...new Set(TREES.flatMap(unreachableKinds))]).toEqual([]);
  });

  // ... and the gap is real, so the row above is not a tautology: the
  // keys alone leave the attached blocks of at least one item behind.
  test("the declared keys alone do not reach a list item's blocks", () => {
    expect(TREES.some(fallsShort)).toBe(true);
  });
});
