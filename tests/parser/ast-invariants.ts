/**
 * The invariants every AST must satisfy, whatever the input — the
 * replacement for `expectStreamInvariants` (once in reader-lists.test.ts),
 * which asserted them of a token stream that no longer exists
 * (the grammar's LL(1) proof and its role as an independent
 * well-formedness check on the reader's emission order were knowingly
 * retired with Chevrotain, and these take their place).
 *
 * They are deliberately structural: nothing here knows which node
 * kinds exist, so the same file keeps working after the reader builds
 * the AST itself. The walk itself — the node shape, the narrowings,
 * document order, sibling grouping — lives in ./ast-walk.ts.
 */
import { expect } from "vitest";
import { rstrip } from "../../src/parse/line-shapes.js";
import { parse } from "../../src/parser.js";
import {
  isArray,
  isNode,
  isRecord,
  locationOf,
  preorder,
  siblingGroups,
  siblingsOf,
  type AnyNode,
} from "./ast-walk.js";

/**
 * (i) Positions are well formed: inside the source, non-inverted, and
 * their line/column agree with their offset.
 *
 * The one documented exception is an exclusive END that sits one past
 * a newline. A text run that ended at a line break reports its end on
 * the line the break is on (column = the break's column + 1) rather
 * than at column 1 of the next line — both spellings name the same
 * OFFSET, which is the coordinate Prettier reads, and the AST has
 * always spelled it this way.
 * @param source - the whole document
 * @param nodes - every node, in document order
 */
function expectPositionsWellFormed(source: string, nodes: AnyNode[]): void {
  for (const node of nodes) {
    const {
      position: { start, end },
    } = node;
    expect(start.offset, `${node.type} start in range`).toBeGreaterThanOrEqual(
      0,
    );
    expect(end.offset, `${node.type} end in range`).toBeLessThanOrEqual(
      source.length,
    );
    expect(end.offset, `${node.type} end before start`).toBeGreaterThanOrEqual(
      start.offset,
    );
    expect(
      [start.line, start.column],
      `${node.type} start line/column`,
    ).toEqual(Object.values(locationOf(source, start.offset)));
    if (source[end.offset - 1] === "\n") continue;
    expect([end.line, end.column], `${node.type} end line/column`).toEqual(
      Object.values(locationOf(source, end.offset)),
    );
  }
}

/**
 * A `text` node whose span swallows the node before it whole.
 *
 * An inline text run has a loose START by construction: the paragraph
 * reader splits a line it must re-emit verbatim out of the run it
 * interrupts (`paragraph-reader.ts#take`, which closes the run and
 * pushes a `raw` piece), while the inline builder starts the NEXT
 * `text` node where the previous INLINE node ended — which is before
 * the split-out line. `a *b*\nendif::[]\nc` gives `bold@2..5`,
 * `rawLine@6..15` and `text@5..17`: the text's span reaches back over
 * the raw line, though its value is only `c`. The value is right —
 * invariant (iii) checks it as the tail of the span and passes — so
 * this is the ordering rule being mis-stated for inline text, not a
 * node emitted out of order.
 *
 * The reach-back is not limited to the raw line: everything the run
 * emitted after the previous split is inside the span too, so
 * `. a\nimage::a[]\nifdef::x[]\nimage::a[]\n.T\n` ends on
 * `text@14..39` swallowing both `rawLine@15..25` and the second
 * `inlineMacro@26..36`. Hence "swallows the previous node whole"
 * rather than a rule about raw lines.
 *
 * Found by the reader-soup property (smallest counterexample
 * `* a\nimage::a[]\nendif::[]\n:a: b`), never by the corpus: 0 of
 * 1,614 corpus documents put a raw line inside a text run that
 * follows an inline construct.
 * @param previous - the node that comes first in the walk
 * @param current - the node after it
 * @returns whether the pair is that known nesting
 */
function swallowsPrevious(previous: AnyNode, current: AnyNode): boolean {
  return (
    current.type === "text" &&
    current.position.start.offset <= previous.position.start.offset &&
    current.position.end.offset >= previous.position.end.offset
  );
}

/**
 * (ii) Document order: a pre-order walk yields non-decreasing start
 * offsets, and siblings do not overlap or run backwards. The one
 * exception is a text run reaching back over a line the paragraph
 * reader split out of it — see `swallowsPrevious`.
 *
 * This is the AST form of the token stream's "offsets are monotone",
 * the invariant that found both of the reader's ordering bugs
 * (metadata held back and released after the token that followed it).
 * @param root - the document node
 * @param nodes - every node, in document order
 */
function expectDocumentOrder(root: unknown, nodes: AnyNode[]): void {
  for (let index = 1; index < nodes.length; index += 1) {
    const { [index - 1]: previous, [index]: node } = nodes;
    if (swallowsPrevious(previous, node)) continue;
    expect(
      node.position.start.offset,
      `${node.type} starts before the ${previous.type} the walk met first`,
    ).toBeGreaterThanOrEqual(previous.position.start.offset);
  }
  for (const group of siblingGroups(root)) {
    for (let index = 1; index < group.length; index += 1) {
      if (swallowsPrevious(group[index - 1], group[index])) continue;
      expect(
        group[index].position.start.offset,
        `${group[index - 1].type} overlaps the ${group[index].type} after it`,
      ).toBeGreaterThanOrEqual(group[index - 1].position.end.offset);
    }
  }
}

/**
 * A `text` node's value is the tail of the span it claims.
 *
 * A SUFFIX rather than the whole slice for two reasons, both verified
 * against the parser at `8c42f624`: a checklist item's first text node
 * has its `[x] ` prefix stripped (`trimCheckboxPrefix`) while keeping
 * the position it was parsed at, and a run interrupted by a line the
 * reader re-emits verbatim keeps the START of the run it continues, so
 * its span reaches back over that line (see `swallowsPrevious`).
 * @param slice - the source the node's position names
 * @param value - the node's text
 */
function expectTextValue(slice: string, value: string): void {
  // BOTH sides lose a trailing newline. The span may carry the
  // break that ended the run while the value does not — and the
  // value may carry one the run accumulated (a `|===` table line
  // inside a paragraph) while the span stops at it. Verified at
  // `8c42f624`: de-newlining only the slice fails 19 corpus
  // documents.
  const body = slice.endsWith("\n") ? slice.slice(0, -1) : slice;
  const text = value.endsWith("\n") ? value.slice(0, -1) : value;
  expect(
    body.endsWith(text),
    `text node ${JSON.stringify(value)} is not the tail of ${JSON.stringify(slice)}`,
  ).toBe(true);
}

/**
 * A verbatim block's content is inside the span it claims — exactly,
 * with no tolerance: the doubled-break allowance that stood here
 * masked precisely the bug issue #39 named, and a defense leaves WITH
 * its need.
 * @param slice - the source the node's position names
 * @param content - the block's verbatim content
 */
function expectVerbatimContent(slice: string, content: string): void {
  expect(
    slice.includes(content),
    `verbatim content is not inside ${JSON.stringify(slice)}`,
  ).toBe(true);
}

/**
 * (x) — a table node's content IS the source of its own extent: the
 * content is a PREFIX of the slice its position names — compared
 * against the SLICE, which derives from the position alone, so a
 * future builder that REBUILDS content instead of slicing it fails
 * here — and the position over-spans the content by at most one
 * character (zero on a terminator close and on a CONFINED forced
 * close — the extent-first slice ends at a line's own raw end, per
 * invariant (xii); one on the other forced closes — document-level EOF,
 * where the overhang is the final newline, and an outer terminator
 * in the same reader, where it is the newline before that line).
 * Invariant (x) is stated in rstripped-line terms because that is
 * the property the PRINTED side preserves; the builder slices raw, so this raw prefix check
 * is the same claim held a fortiori — the printed side is pinned by
 * the format rows in tests/format/table.test.ts, not here.
 * @param slice - the source the node's position names
 * @param content - the table's verbatim content
 */
function expectTableContent(slice: string, content: string): void {
  const over = slice.length - content.length;
  expect(
    over === 0 || over === 1,
    `table position spans ${String(over)} characters past its content`,
  ).toBe(true);
  expect(
    slice.startsWith(content),
    "table content is not the source of its own extent",
  ).toBe(true);
}

/**
 * (xii) — forced-close honesty: a source-sliced verbatim
 * node's extent `source.slice(start, end)` decomposes EXACTLY into
 * the opener line, the content, and at most one close line, joined
 * by single newlines — the overhang past the content is a line
 * terminator, a line terminator plus one newline-free close line, or
 * nothing. Never a partial content byte: the arithmetic that could
 * drop one (`boundary - 1` at a confined close, #44) no longer
 * exists, and this row is what keeps it gone on every corpus, fuzz
 * and shape-matrix document — including the render-blind comment
 * blocks. The empty-content forms collapse (a closed empty block is
 * `opener\ncloseLine`), which the tail derivation below accepts and
 * nothing else.
 * @param slice - the source the node's position names
 * @param content - the node's sliced content (delimiters excluded)
 */
function expectExtentDecomposition(slice: string, content: string): void {
  const newlineAt = slice.indexOf("\n");
  if (newlineAt === -1) {
    // The whole extent is the opener line (an empty unterminated
    // block at a raw EOF).
    expect(content, "one-line extent with content").toBe("");
    return;
  }
  const body = slice.slice(newlineAt + 1);
  if (body === content || body === `${content}\n`) return;
  const tail =
    content === ""
      ? body
      : body.startsWith(`${content}\n`)
        ? body.slice(content.length + 1)
        : undefined;
  expect(
    tail,
    `extent does not decompose around ${JSON.stringify(content)}`,
  ).toBeDefined();
  expect(
    tail !== undefined && !tail.includes("\n"),
    `close tail ${JSON.stringify(tail)} is not one line`,
  ).toBe(true);
}

/**
 * Check one node's value against the source it claims.
 * @param node - the node to check
 * @param slice - the source its position names
 */
function expectOneValue(node: AnyNode, slice: string): void {
  const { value, content } = node;
  if (node.type === "delimitedBlock" && typeof content === "string") {
    if (node.variant === "table") {
      // A table's content carries its own delimiter lines, so its
      // (xii) form is prefix + {"" | "\n"} — expectTableContent's
      // prefix check plus the bound below.
      expectTableContent(slice, content);
      const over = slice.slice(content.length);
      expect(over === "" || over === "\n", "table overhang").toBe(true);
      return;
    }
    expectVerbatimContent(slice, content);
    if (node.form === "delimited") expectExtentDecomposition(slice, content);
    return;
  }
  if (typeof value !== "string") return;
  switch (node.type) {
    case "text": {
      expectTextValue(slice, value);
      break;
    }
    // A header's attribution lines carry the SAME contract a raw line
    // does, and for the same reason: the bytes are the construct, so
    // the value has to be exactly the span it claims.
    case "rawLine":
    case "authorLine":
    case "revisionLine": {
      expect(slice, `${node.type} value is its own span`).toBe(value);
      break;
    }
    // A passthrough carries its WHOLE construct - delimiters and the
    // optional attrlist included - so its value and its span are the
    // same bytes. This row is what fails if the builder ever starts
    // stripping the delimiters the printer has to re-emit.
    case "passthrough": {
      expect(slice, "passthrough value is its own span").toBe(value);
      break;
    }
    // `includes`, not equality: the span covers a `//` prefix or a
    // directive's delimiters that the value does not.
    case "comment":
    case "preprocessorDirective": {
      expect(slice, `${node.type} value is inside its span`).toContain(value);
      if (node.type === "comment" && node.commentType === "block") {
        expectExtentDecomposition(slice, value);
      }
      break;
    }
    default: {
      break;
    }
  }
}

/**
 * (iii) Values are drawn from the span they claim.
 * @param source - the whole document
 * @param nodes - every node, in document order
 */
function expectValuesReconstruct(source: string, nodes: AnyNode[]): void {
  for (const node of nodes) {
    const {
      position: { start, end },
    } = node;
    expectOneValue(node, source.slice(start.offset, end.offset));
  }
}

// A list continuation is the one non-blank line the AST records
// without a span of its own: `ItemBlock.gap` spells it verbatim, and
// the block a gap introduces starts on the next line. A `+` at an
// item's END is recorded nowhere at all — it attaches nothing, Ruby
// pops it (the `ListContinuationMarker` arm, parser.rb l.1580-81) and
// the printer never writes it. This literal-`+` exemption in
// expectLineCoverage is load-bearing for both — the gap invariant
// (vii) below checks the ones a gap holds.
const CONTINUATION = "+";

/**
 * (iv) Every non-blank source line is inside some node's span.
 *
 * A formatter may not silently drop a line the author wrote, and the
 * only way to see that in an AST is coverage. The exception list is
 * exactly one entry long and each entry names why it is there — a
 * NEW exception found by the corpus run is a finding to report, never
 * a widening of the rule.
 * @param source - the whole document
 * @param nodes - every node, in document order
 */
function expectLineCoverage(source: string, nodes: AnyNode[]): void {
  const covered = new Set<number>();
  for (const node of nodes) {
    const {
      position: { start, end },
    } = node;
    const { line: first } = start;
    const { line: last } = end;
    for (let row = first; row <= last; row += 1) covered.add(row);
  }
  const lines = source.split("\n");
  for (const [index, raw] of lines.entries()) {
    const text = raw.trim();
    if (text === "" || text === CONTINUATION) continue;
    expect(
      covered.has(index + 1),
      `line ${String(index + 1)} (${raw}) uncovered`,
    ).toBe(true);
  }
}

// The node kinds whose position spans their whole content, so a
// descendant must lie inside them. COMPLETENESS RULE (viii),
// unconditional: every child-bearing kind is in the set. `document`
// spans the whole source ([at(0), at(source.length)]), so covering it
// costs nothing — and no "deliberately absent" escape clause remains;
// sections are not modeled. The next container author
// (dlists, tables) meets this as a rule, not a list; the node-kind
// census row in architecture.test.ts is the reminder that fires when
// a kind is added.
const SPANNING_CONTAINERS = new Set([
  "document",
  "parentBlock",
  "list",
  "listItem",
  "delimitedBlock",
  "admonition",
]);

/**
 * One node lies inside the container it is nested in.
 * @param node - the nested node
 * @param container - the nearest enclosing spanning container
 */
function expectInside(node: AnyNode, container: AnyNode): void {
  expect(
    node.position.start.offset,
    `${node.type} starts before its ${container.type}`,
  ).toBeGreaterThanOrEqual(container.position.start.offset);
  expect(
    node.position.end.offset,
    `${node.type} ends after its ${container.type}`,
  ).toBeLessThanOrEqual(container.position.end.offset);
}

/**
 * The container a value's children are measured against: the value
 * itself when it spans its own content, otherwise the one it inherits.
 * @param value - the value the walk is at
 * @param container - the container in force above it
 * @returns the container for its children
 */
function containerFor(
  value: unknown,
  container: AnyNode | undefined,
): AnyNode | undefined {
  return isNode(value) && SPANNING_CONTAINERS.has(value.type)
    ? value
    : container;
}

/**
 * (v) Containment: every node inside a container that spans its
 * content lies within that container's span.
 *
 * This is the AST successor to `expectStreamInvariants`' third
 * invariant, "ParagraphStart/ParagraphEnd are balanced and never
 * negative". A stream can be unbalanced; a tree cannot — what a tree
 * CAN do is put a child outside the parent it is nested in, which is
 * the same failure (a block that escaped its container) seen from the
 * other side. Verified at `8c42f624`: 0 failures over the corpus and
 * 432 lists. Exported for its (viii) negative row in
 * tests/parser/ast-invariants.test.ts.
 * @param root - the document node
 */
export function expectContainment(root: unknown): void {
  const visit = (value: unknown, container?: AnyNode): void => {
    if (isArray(value)) {
      for (const element of value) visit(element, container);
      return;
    }
    if (!isRecord(value)) return;
    if (isNode(value) && container !== undefined) {
      expectInside(value, container);
    }
    const next = containerFor(value, container);
    for (const [key, child] of Object.entries(value)) {
      if (key === "position") continue;
      visit(child, next);
    }
  };
  visit(root);
}

/**
 * (vi) Every list has at least one item.
 *
 * Half of the AST successor to `expectStreamInvariants`' fourth
 * invariant, "one `ItemEnd` per list marker, and `ListEnd` follows
 * `ItemEnd`". The ordering half is structural in a tree and needs no
 * assertion; the counting half is the ORACLE comparison
 * (`itemCount(source) === oracleItems(source)`),
 * which lives on the characterization rows in reader-lists.test.ts
 * rather than here — the fuzz generators emit `ifdef::` lines that
 * Asciidoctor's preprocessor eats, so the oracle reads a different
 * document than we do and cannot judge generated soup.
 * @param nodes - every node, in document order
 */
function expectListsNonEmpty(nodes: AnyNode[]): void {
  for (const node of nodes) {
    if (node.type !== "list") continue;
    const { children } = node;
    expect(
      isArray(children) && children.length > 0,
      "a list with no items",
    ).toBe(true);
  }
}

/**
 * (vii) Gaps are verbatim, with ONE exception: the lines strictly
 * between an item's pieces are the recorded gap, one entry per line
 * and in source order, and nothing but blank lines and `+` lines ever
 * sits in one — except a `+` that a nested item at the end of the
 * previous block prints back from its own tail
 * (`ListItemNode.trailingContinuation`), which is recorded on that
 * item and so is not recorded here as well.
 *
 * The exception is not a loosening. It is exactly as wide as the tail
 * facts standing under the previous block ({@link tailContinuations}):
 * a gap may omit that many `+` entries and not one more, may omit no
 * blank line at all, and keeps every entry it does record in source
 * order. Where no such tail stands below it — which is every gap in
 * the conformance corpus — the check is the equality it always was.
 *
 * Why the byte moves at all: an item's own read pops a trailing `+`
 * off its buffer (`ListContinuationMarker === buffer[-1]` and the
 * `buffer.pop` under it, parser.rb l.1580-82) and the item prints
 * that byte back itself, so the separator record must not spell it a
 * second time — the two spellings are one physical line, and writing
 * both puts an adjacent `+` pair in the output, which the
 * `ListContinuationMarker === this_line` arm freezes on re-read
 * (l.1443-46), moving the block under it out of the nested item.
 * Only a NESTED item can collide this way: its popped line is the
 * last of its own buffer, so no gap of its own blocks can span it,
 * and an enclosing item's gap spans it only because the enclosing
 * scan leaves a `+` inside a nested list standing rather than
 * blanking it (`within_nested_list`, l.1412-14 and l.1439).
 *
 * Exported for its rows in tests/parser/ast-invariants.test.ts, which
 * pin the exception's shapes and show the check still bites.
 * @param source - the whole document
 * @param nodes - every node, in document order
 */
export function expectGapsVerbatim(source: string, nodes: AnyNode[]): void {
  const lines = source.split("\n").map((line) => rstrip(line));
  for (const node of nodes) {
    if (node.type === "listItem") expectItemGaps(lines, node);
  }
}

/**
 * One item's gap walk — see {@link expectGapsVerbatim}.
 * @param lines - the source's rstripped lines
 * @param node - a `listItem` node
 */
function expectItemGaps(lines: readonly string[], node: AnyNode): void {
  const { text, blocks } = node;
  const inline = isArray(text) ? text : [];
  const lastText = inline.at(-1);
  let previousEnd = isNode(lastText)
    ? lastText.position.end.line
    : node.position.start.line;
  // The item's TEXT prints no trailing `+`, so the FIRST gap has no
  // allowance at all; each later one is measured against the block
  // standing directly above it.
  let allowance = 0;
  for (const entry of isArray(blocks) ? blocks : []) {
    if (!isRecord(entry)) continue;
    const { block, gap } = entry;
    if (!isNode(block)) continue;
    const between = lines.slice(previousEnd, block.position.start.line - 1);
    expect(
      between.every((line) => line === "" || line === "+"),
      `gap holds a content line: ${JSON.stringify(between)}`,
    ).toBe(true);
    expectGapOmitsOnlyTailPluses(
      gap,
      between.map((line) => (line === "+" ? "+" : "")),
      allowance,
    );
    previousEnd = block.position.end.line;
    allowance = tailContinuations(block);
  }
}

/**
 * How many `+` bytes a block prints AFTER its own last node — the
 * width of (vii)'s exception for the gap that follows it.
 *
 * Only a list can print one, and only at the end of its last item, so
 * the count is a walk down the last-item/last-block chain: an item
 * whose own last block is another list can have a tail under a tail.
 *
 * `detachedTail` is NOT counted. Its `+` is written under a blank
 * line the printer adds, and no measured document puts one inside an
 * enclosing gap; if one ever does, this invariant fires rather than
 * waving it through, which is the right direction for a fact nothing
 * has established.
 * @param block - the block standing above the gap
 * @returns how many `+` entries that gap may omit
 */
function tailContinuations(block: AnyNode): number {
  if (block.type !== "list") return 0;
  const items = isArray(block.children) ? block.children : [];
  const last = items.at(-1);
  if (!isNode(last)) return 0;
  const own = last.trailingContinuation === true ? 1 : 0;
  const inner = isArray(last.blocks) ? last.blocks.at(-1) : undefined;
  return (
    own +
    (isRecord(inner) && isNode(inner.block)
      ? tailContinuations(inner.block)
      : 0)
  );
}

/**
 * (vii)'s comparison: the recorded gap is `between` with `allowance`
 * `+` entries dropped off its FRONT and nothing else changed.
 *
 * `allowance` is known independently of what the gap recorded
 * (`tailContinuations` counts the block standing above, not this
 * gap), so what the gap may omit is fixed before this walk ever reads
 * it: the allowance-many lines at the FRONT of `between`. A block's
 * own trailing `+` prints immediately after the block itself, never
 * after a line the enclosing item's own gap goes on to hold, so a
 * drop anywhere but the leading run would have the gap and the
 * printed output disagree on order, sliced rather than matched by a
 * cursor for exactly that reason: two adjacent `+` lines are the same
 * VALUE, so a cursor that prefers to match early cannot tell "dropped
 * the first" from "dropped the second" apart, and only a position
 * fixed in advance says which one this gap was allowed to drop.
 * @param gap - the recorded gap, as the node carries it
 * @param between - the source lines between the item's two pieces,
 *   each normalized to `""` or `"+"`
 * @param allowance - how many `+` entries the block above this gap
 *   prints back itself ({@link tailContinuations})
 */
function expectGapOmitsOnlyTailPluses(
  gap: unknown,
  between: readonly string[],
  allowance: number,
): void {
  const recorded = isArray(gap) ? gap : [];
  const seen = `gap ${JSON.stringify(recorded)} against ${JSON.stringify(between)}`;
  expect(between.length, `a gap dropped a + no tail prints back: ${seen}`).toBe(
    recorded.length + allowance,
  );
  for (const line of between.slice(0, allowance)) {
    expect(line, `a gap dropped a blank line: ${seen}`).toBe("+");
  }
  expect(
    between.slice(allowance),
    `a gap records a line the source has not got: ${seen}`,
  ).toEqual(recorded);
}

/**
 * (viii-b) — sibling monotonicity inside a list item: the item's text
 * ends at or before its first block starts, and each block ends at or
 * before the next begins. This is the assumption gapsOf
 * (src/parse/lines/list-reader.ts) consumes: it partitions a recorded
 * GapRecord by each block's (previousEnd, start) range, and BOTH
 * violation directions are now silent. An over-spanning end narrows
 * the next range and drops a recorded gap line with no throw; an
 * under-spanning end widens it and can pull in entries that belong to
 * a nested list, injecting spurious "" lines. Neither fails loudly any
 * more, which is exactly why this invariant and (vii) are the net
 * that catches a violation. Exported for its negative row in
 * tests/parser/ast-invariants.test.ts.
 * @param nodes - every node, in document order
 */
export function expectItemSiblingMonotonicity(nodes: AnyNode[]): void {
  for (const node of nodes) {
    if (node.type !== "listItem") continue;
    const { text, blocks } = node;
    const inline = isArray(text) ? text : [];
    const lastText = inline.at(-1);
    let previous = isNode(lastText)
      ? lastText.position.end.offset
      : node.position.start.offset;
    for (const entry of isArray(blocks) ? blocks : []) {
      if (!isRecord(entry)) continue;
      const { block } = entry;
      if (!isNode(block)) continue;
      expect(
        block.position.start.offset,
        `item block starts before the previous piece ends (line ${String(block.position.start.line)})`,
      ).toBeGreaterThanOrEqual(previous);
      previous = block.position.end.offset;
    }
  }
}

/**
 * (xi) — the reader's recorded annotation pairs with the sibling
 * for every DelimitedBlockNode, `annotatedBy` is set iff
 * the immediately preceding sibling in its own container — ItemBlock
 * chains included — is a blockAttributeList, and then equals that
 * sibling's `value`. The parity normalizer blanks the field, which
 * REMOVES it from that net; this invariant is the pin, over every
 * corpus and fuzz parse. Walks the sibling arrays itself rather than
 * riding `siblingGroups`, whose length-greater-than-one filter would
 * skip a container holding a SINGLE block — a lone delimitedBlock
 * must still prove its `annotatedBy` is undefined. Exported for its
 * negative row in tests/parser/ast-invariants.test.ts (the check must
 * be shown to bite — and that row IS a singleton container).
 * @param root - the document node
 */
export function expectAnnotatedByPairing(root: unknown): void {
  const visit = (value: unknown): void => {
    if (isArray(value)) {
      let previous: AnyNode | undefined = undefined;
      for (const element of value) {
        for (const node of siblingsOf(element)) {
          if (node.type === "delimitedBlock") {
            const attribute =
              previous?.type === "blockAttributeList"
                ? previous.value
                : undefined;
            expect(
              node.annotatedBy,
              `annotatedBy pairing at offset ${String(node.position.start.offset)}`,
            ).toBe(attribute);
          }
          previous = node;
        }
        visit(element);
      }
      return;
    }
    if (!isRecord(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "position") continue;
      visit(child);
    }
  };
  visit(root);
}

// The delimited-block variants that only a masquerading style
// produces — each rides on a recorded source delimiter.
const MASQUERADE_VARIANTS = new Set<unknown>([
  "verse",
  "example",
  "sidebar",
  "quote",
]);

/**
 * (xiii) — a masquerade-variant delimited block always carries its
 * source delimiter: `form: "delimited"` with a variant
 * that has no leaf delimiter of its own can only arise from a style
 * re-modeling a parent block, and the open records the delimiter it
 * re-modeled. The printer's masquerade arm READS the field with no
 * fallback table; this row is what makes that read total. Exported
 * for its negative row in tests/parser/ast-invariants.test.ts.
 * @param nodes - every node, in document order
 */
export function expectMasqueradeSourceDelimiter(nodes: AnyNode[]): void {
  for (const node of nodes) {
    if (node.type !== "delimitedBlock" || node.form !== "delimited") continue;
    if (!MASQUERADE_VARIANTS.has(node.variant)) continue;
    expect(
      node.sourceDelimiter,
      `masquerade ${String(node.variant)} block at line ${String(node.position.start.line)} carries no sourceDelimiter`,
    ).toBeDefined();
  }
}

/**
 * (ix) — body exclusivity: an admonition body lives in exactly one
 * place — `text` for the paragraph form, `children` for a delimited
 * one. The always-meaningful empty array replaced three
 * `Valid only when` markers; this row checks structurally what those
 * asserted in prose.
 * @param nodes - every node, in document order
 */
function expectAdmonitionBodyExclusive(nodes: AnyNode[]): void {
  for (const node of nodes) {
    if (node.type !== "admonition") continue;
    if (node.form === "paragraph") {
      expect(node.children, "paragraph-form admonition with children").toEqual(
        [],
      );
    } else {
      expect(node.text, "delimited-form admonition with text").toEqual([]);
    }
  }
}

// The attribution slots a document header can fill, in the order
// `parse_header_metadata` fills them (parser.rb:1815): the author
// line first, then - inside the second nested `if` - the revision
// line.
const ATTRIBUTION_ORDER = ["authorLine", "revisionLine"];

// The only blocks that may stand ABOVE a document header: the lines
// `parse_block_metadata_lines` eats before the title is looked for.
// This is the SAME set the reader spells as BEFORE_HEADER
// (src/parse/lines/header-reader.ts), stated here as a property of
// every parse the corpus produces - the two are equal, member for
// member, and a divergence between them is a finding on both sides.
//
// `blockAttributeList` is a member of both, and whether a particular
// one is a barrier is decided ONCE, at hold time, by whether it names
// a style: `[foo]` demotes the title, `[#id]`, `[.role]`, `[%opt]`
// and `[separator=::]` do not (all measured; the rule is the pinned
// oracle's, not Ruby's - see `Attrlist.styleAttribute`). This
// invariant does not re-derive that condition; the oracle rows in
// tests/conformance/document-header.test.ts are where it is pinned.
//
// `frontMatter` is a member HERE and NOT in BEFORE_HEADER, and the
// difference is not drift. The block never reaches the reader's
// `push`: `readDocument` takes it off the stream before the
// BlockReader walks a line (src/parse/lines/front-matter.ts), the way
// Asciidoctor's own reader lifts it in `prepare_lines`, so there is
// no header-reachability bit to retire for it. The DOCUMENT's block
// sequence, which is what this invariant reads, still holds it above
// the header - and a header under front matter is the reading
// `skip-front-matter` gives, which is the one our tree models.
const ABOVE_HEADER = new Set([
  "comment",
  "attributeEntry",
  "preprocessorDirective",
  "blockAnchor",
  "blockAttributeList",
  "frontMatter",
]);

/**
 * (xiv) - the document header's shape: at most one per document, with
 * nothing above it but the lines Asciidoctor's reader eats first, at
 * most one author line, at most one revision line, and never a
 * revision line without an author line above it.
 *
 * Sequence facts the type cannot carry, checked the way (ix) and
 * (xiii) carry theirs. The ATTRIBUTION half is Ruby's control flow
 * read as a shape: `parse_header_metadata` (parser.rb:1815) reads the
 * two attribution lines in two nested `if`s with no third sibling -
 * measured, `= T` / `A` / `B` / `C` puts `C` in the BODY. The
 * ONE-HEADER-PER-DOCUMENT half is `parse_document_header` running
 * once at the top of the document; what may stand above it is
 * {@link ABOVE_HEADER}, which is the pinned oracle's rule where a
 * style is involved.
 * @param root - the document node
 */
export function expectDocumentHeaderShape(root: unknown): void {
  const document = isRecord(root) ? root : {};
  const { children } = document;
  const blocks = isArray(children) ? children : [];
  const headers = blocks
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => isNode(block) && block.type === "documentHeader");
  expect(headers.length, "more than one document header").toBeLessThanOrEqual(
    1,
  );
  for (const { block, index } of headers) {
    const above = blocks
      .slice(0, index)
      .map((earlier) => (isNode(earlier) ? earlier.type : "?"))
      .filter((type) => !ABOVE_HEADER.has(type));
    expect(
      above,
      "blocks above a document header that are not metadata",
    ).toEqual([]);
    expectAttributionOrder(isNode(block) ? block : undefined);
  }
}

/**
 * The attribution half of (xiv): the header's lines carry the two
 * slots at most once each, in Ruby's order.
 * @param header - the header node
 */
function expectAttributionOrder(header: AnyNode | undefined): void {
  const lines = isArray(header?.lines) ? header.lines : [];
  const slots = lines
    .filter((line) => isNode(line))
    .map((line) => line.type)
    .filter((type) => ATTRIBUTION_ORDER.includes(type));
  expect(slots, "header attribution slots").toEqual(
    ATTRIBUTION_ORDER.slice(0, slots.length),
  );
}

/**
 * Assert every AST invariant for one document.
 *
 * The five invariants `expectStreamInvariants` asserted of the token
 * stream map onto these one for one:
 * 1. offsets monotone      → (ii) document order
 * 2. image == source slice → (iii) values reconstruct
 * 3. paragraph balance     → (v) containment
 * 4. one ItemEnd per marker → (vi) non-empty lists, plus the oracle
 *    item count on the characterization rows
 * 5. the grammar accepts   → RETIRED with the grammar (c331bfbd
 *    dropped Chevrotain). Nothing replaces it, on purpose: there is
 *    no second component left to disagree with the reader.
 * @param source - the AsciiDoc source to parse and check
 */
export function expectAstInvariants(source: string): void {
  const document = parse(source);
  const nodes = preorder(document);
  expectPositionsWellFormed(source, nodes);
  expectDocumentOrder(document, nodes);
  expectValuesReconstruct(source, nodes);
  expectLineCoverage(source, nodes);
  expectContainment(document);
  expectListsNonEmpty(nodes);
  expectGapsVerbatim(source, nodes);
  expectItemSiblingMonotonicity(nodes);
  expectAnnotatedByPairing(document);
  expectAdmonitionBodyExclusive(nodes);
  expectMasqueradeSourceDelimiter(nodes);
  expectDocumentHeaderShape(document);
}
