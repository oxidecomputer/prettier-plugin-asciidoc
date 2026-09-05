/**
 * List printing for the AsciiDoc printer: lists, list items, and the
 * blocks inside an item (nested lists and `+`-attached blocks) in the
 * spelling Asciidoctor's `read_lines_for_list_item` will read back the
 * same way. Split out of src/print/blocks.ts by responsibility.
 */
import { doc, type Doc } from "prettier";
import type { GapLine, ListItemNode, ListNode } from "../ast.js";
import { MARKER_OFFSET } from "../constants.js";
import {
  CONTINUATION_LINE,
  LITERAL_LINE,
  continuationMetadataKind,
  isDelimiterLine,
  rstrip,
} from "../parse/line-shapes.js";
import { inlineAtoms } from "./inline.js";
import { hazard, markerLineGuard } from "./list-hazard.js";
import {
  type Atom,
  type BreakBefore,
  blockBody,
  keepTextOnFirstRestLine,
} from "./reflow.js";
import {
  printedText,
  type PrintFunction,
  type PrintOptions,
  type PrintPath,
} from "./blocks.js";

const {
  builders: { hardline },
} = doc;

/**
 * Prints a list node: items separated by hard line
 * breaks.
 *
 * Items at different depths are handled by the nested
 * ListNode structure — each ListItemNode prints its own
 * nested children recursively.
 * @param path - Prettier's AST path, used to recurse
 *   into list items via `path.map(print, "children")`.
 * @param print - Prettier's recursive print callback.
 * @param options - the print options in force, for rendering an
 *   item's finished Doc back to the lines it will be written as
 *   ({@link printedLines}).
 * @returns Doc IR for the formatted list.
 */
export function printList(
  path: PrintPath,
  print: PrintFunction,
  options: PrintOptions,
): Doc {
  const items = path.map(print, "children");
  const parts: Doc[] = [];
  for (const [index, item] of items.entries()) {
    if (index > 0) {
      // Siblings print ADJACENT, and the blank a source wrote between
      // two items is not replayed — except where adjacency would stop
      // spelling "sibling". A marker line ends the previous item only
      // if the reader's loop SEES it (`is_sibling_list_item?`,
      // parser.rb l.1430 and l.1519); a line the previous item's tail
      // slurps up first reaches neither check. So the blank is
      // DERIVED, not recorded: it is printed exactly where the tail
      // would swallow this marker, whatever the author typed, and
      // nowhere else.
      parts.push(
        tailSwallowsMarker(printedLines(items[index - 1], options))
          ? [hardline, hardline]
          : hardline,
      );
    }
    parts.push(item);
  }
  return parts;
}

/**
 * The lines one item will actually be written as: THE Doc renderer
 * ({@link printedText}, src/print/blocks.ts) split at its line breaks.
 *
 * An item's Doc carries its indentation as literal spaces (the packer
 * writes them, src/print/reflow.ts) and no enclosing `indent`, so
 * rendering it apart from its list produces exactly the lines the list
 * will contain.
 *
 * Each line is RSTRIPPED on top of that, so the probe's dialect is
 * the reader's by construction rather than by an argument spanning
 * three files. It is a normalization, not a defence, and the
 * difference is worth stating: the reader rstrips every source line
 * as it splits, and Prettier trims spaces and tabs off a line as it
 * breaks, so between them nothing with trailing whitespace reaches
 * this probe today - measured over the depth-4 sweep's 11,128
 * documents and the 1,614-document conformance corpus, where no
 * probe line differs from its rstripped self. What the two do NOT
 * share is the vertical tab and the form feed, which the reader
 * calls blank and Prettier's trim leaves standing; keeping the map
 * means this rule does not depend on the reader continuing to strip
 * them upstream.
 * @param item - one item's finished Doc
 * @param options - the print options in force; only the width is read
 *   as given, the terminator being fixed by the renderer
 * @returns the item's output lines, in order
 */
function printedLines(item: Doc, options: PrintOptions): string[] {
  return printedText(item, options)
    .split("\n")
    .map((line) => rstrip(line));
}

/**
 * What the lines read so far leave open, as far as a literal
 * paragraph's slurp is concerned — the only state
 * {@link tailSwallowsMarker} has to carry. ONE value rather than a
 * set of flags: the four are mutually exclusive, because the reader
 * is either inside a slurp, or standing where one could start, or in
 * neither, and never in two of those at once.
 */
type SlurpState =
  /** Nothing pending: no slurp, and no position one could start from. */
  | "settled"
  /** A blank line stands here (parser.rb l.1513-19). */
  | "afterBlank"
  /** A `+` is live, metadata still playing out (parser.rb l.1435-40). */
  | "underContinuation"
  /** An indented literal's read is running. */
  | "slurping";

/**
 * Whether the item's OWN OUTPUT LINES leave a literal paragraph's
 * slurp running when they end, so that a marker line written directly
 * under them is read as part of the item instead of as the sibling it
 * is — the question printList asks at every item boundary.
 *
 * Asked of the LINES, because that is the only unit in which it has
 * an answer. The reader ends an item at a sibling marker only when
 * its own loop reads that line (`is_sibling_list_item?`, parser.rb
 * l.1430 and l.1519), and one thing takes the line away from the
 * loop: an indented literal's slurp (`read_lines_until
 * break_on_blank_lines, break_on_list_continuation`, parser.rb l.1495
 * and l.1546), which runs through metadata, delimiters and marker
 * lines alike and stops only at a blank or a `+`. So the item
 * swallows the boundary exactly when one is still running on its last
 * line.
 *
 * The lines are walked in the reader's own order, and every shape
 * that moves the state is the line-shape registry's
 * (src/parse/line-shapes.ts) rather than a guess at one:
 *
 * - a slurp starts only from a blank or a live `+`, and only on a
 *   line that is itself indented ({@link LITERAL_LINE}). After a
 *   blank the branch tests a sibling marker, a `+` and a nestable
 *   marker first and breaks the item on anything else (parser.rb
 *   l.1522-49); under a `+` block metadata "plays out until we find
 *   the block" ({@link continuationMetadataKind}, parser.rb
 *   l.1483-1501), so the slurp can start several lines below it —
 *   `* a\n+\n[role]\n  lit\n\n* a\n` slurps from a literal the `+`
 *   does not touch.
 * - a DELIMITED block is opaque. Its lines never reach the item's
 *   loop at all: the delimiter is buffered and `read_lines_until
 *   terminator:` takes the body whole (parser.rb l.1455-61), so an
 *   indented line inside an example block opens nothing. A slurp
 *   already running swallows the delimiter like any other line, which
 *   is why the skip is asked only when none is.
 *
 * An item ending on a blank or a `+` has nothing after it to open a
 * slurp, which is how a printed trailing continuation
 * ({@link ListItemNode.trailingContinuation}) and a detached tail
 * ({@link ListItemNode.detachedTail}) answer: both write a `+` last.
 *
 * KNOWN CONSERVATIVE in one place: a `+` that is the second of an
 * adjacent run is FROZEN (parser.rb l.1443-49) and starts no
 * continuation, so a literal under one is slurped by nothing. Such an
 * item takes a blank it does not need, which costs a byte and no
 * meaning.
 * @param lines - the item's output lines ({@link printedLines})
 * @returns true when the marker line needs a blank in front of it
 * Exported for its unit test (tests/print/list.test.ts); no src
 * consumer.
 * @internal
 */
export function tailSwallowsMarker(lines: readonly string[]): boolean {
  let state: SlurpState = "settled";
  let index = 0;
  while (index < lines.length) {
    if (state !== "slurping" && isDelimiterLine(lines[index])) {
      index = closingDelimiter(lines, index) + 1;
      state = "settled";
      continue;
    }
    state = afterLine(state, lines[index]);
    index += 1;
  }
  return state === "slurping";
}

/**
 * The state one more line leaves behind.
 * @param state - what the lines before it left open
 * @param line - the next output line
 * @returns the state after reading it
 */
function afterLine(state: SlurpState, line: string): SlurpState {
  if (line === "") {
    return "afterBlank";
  }
  if (CONTINUATION_LINE.test(line)) {
    return "underContinuation";
  }
  if (state === "slurping") {
    return "slurping";
  }
  if (
    state === "underContinuation" &&
    continuationMetadataKind(line) !== undefined
  ) {
    return "underContinuation";
  }
  return state !== "settled" && LITERAL_LINE.test(line)
    ? "slurping"
    : "settled";
}

/**
 * Where a delimited block opened at `open` closes: the next line
 * SPELLED the same way, which is the `terminator` Ruby matches
 * (parser.rb l.1460). An unterminated block runs to the item's end,
 * and the index past the last line is what says so.
 * @param lines - the item's output lines
 * @param open - the index of the opening delimiter
 * @returns the closing delimiter's index, or the line count
 */
function closingDelimiter(lines: readonly string[], open: number): number {
  const terminator = lines[open];
  for (let index = open + 1; index < lines.length; index += 1) {
    if (lines[index] === terminator) {
      return index;
    }
  }
  return lines.length;
}

/**
 * The marker string for a list item: callout items print from their
 * recorded number; every other item replays its OWN recorded spelling
 * (`ListItemNode.markerSpelling` - the classifier's parse). Nothing
 * is reconstructed from a depth or from the list's style, so a
 * spelling the author wrote can no longer be normalized into a
 * DIFFERENT list's spelling. Two lists genuinely written with the
 * SAME marker can still nest (the reader follows the oracle there),
 * and {@link printedGap} is what keeps that pair printing nested.
 *
 * PER ITEM rather than per list because an explicit ordered list's
 * items do not share a spelling: `5.` and `6.` are one list (both
 * resolve to the style `1.`), the ORACLE reads the list's `start` off
 * the FIRST spelling (`resolveOrderedListStart`, `@asciidoctor/core`
 * 4.0.11 `build/node/index.cjs` l.13396), and printing either item's
 * marker from the list's style would rewrite that start to 1.
 *
 * The callout arm is the one variant that does NOT replay the
 * recorded spelling, and nothing here changes that: a colist numbers
 * its items by position, so rebuilding `<n>` from the parsed number
 * is render-neutral and `<01>` comes back as `<1>`. The per-variant
 * contract is written out on {@link ListItemNode.markerSpelling}.
 * @param node - The list item whose marker to build.
 * @param parentList - The parent list node, for the variant alone.
 *   Prettier's path typing cannot promise the parent; a missing one
 *   is simply not a callout list, and the item's own spelling answers
 *   without a fallback.
 * @returns The marker string (e.g. `-`, `**`, `...`, `2020.`, `<1>`).
 * Exported for its unit test (tests/print/list.test.ts); no src
 * consumer.
 * @internal
 */
export function buildMarker(
  node: ListItemNode,
  parentList: ListNode | undefined,
): string {
  if (parentList?.variant === "callout") {
    // Auto-numbered callouts store 0 as calloutNumber.
    const calloutLabel =
      node.calloutNumber === 0 ? "." : String(node.calloutNumber);
    return `<${calloutLabel}>`;
  }
  return node.markerSpelling;
}

// The two spellings Asciidoctor reads as a CHECKED box, and the one
// the printer writes. `list_item.attributes['checked']` is set unless
// the text opens `[ ` (parser.rb l.1332), so `[x]` and `[*]` are one
// state to the reader and `[x]` is the canonical way back.
const CHECKED_MARK = "[x]";
const CHECKED_ALIAS = "[*]";

/**
 * Formats a checklist checkbox into its canonical string
 * representation.
 *
 * Normalizes `[*]` to `[x]` (the canonical checked
 * form). Returns an empty string for non-checklist items
 * so the caller can unconditionally prepend the result.
 * @param checkbox - The checkbox state: "checked",
 *   "unchecked", or undefined for non-checklist items.
 * @returns The checkbox prefix string, or empty string
 *   if the item has no checkbox.
 * Exported for its unit test (tests/print/list.test.ts); no src
 * consumer.
 * @internal
 */
export function formatCheckbox(checkbox: ListItemNode["checkbox"]): string {
  if (checkbox === "checked") {
    return `${CHECKED_MARK} `;
  }
  if (checkbox === "unchecked") {
    return "[ ] ";
  }
  return "";
}

/**
 * Respell a marker line's head as the reader will write it back.
 *
 * Only reached where the line is going to be read as a checked item
 * whatever the printer does ({@link markerLineGuard}'s
 * `canonicalHead`). The two checked spellings are one state to the
 * reader, and the printer writes {@link CHECKED_MARK} for it, so a head
 * left spelling {@link CHECKED_ALIAS} would be moved by the NEXT
 * format - the same document, two spellings, neither of them a fixed
 * point. Every other head already spells itself back: `[x]` is the
 * canonical mark, and `[` then `]` is what `[ ] ` prints as.
 * @param atoms - the item's atoms; its head is atoms[0].
 * @returns the atoms, head canonical.
 */
function canonicalChecklistHead(atoms: readonly Atom[]): readonly Atom[] {
  return atoms[0].text === CHECKED_ALIAS
    ? atoms.with(0, { ...atoms[0], text: CHECKED_MARK })
    : atoms;
}

/**
 * The item's atoms with both reflow guards applied, in the order the
 * two questions are answered.
 *
 * The first-rest-line guard runs first because it chooses which run
 * opens the line UNDER the marker line, and it chooses the LAST one it
 * can, to leave the most reflow intact. The marker-line guard then
 * reads the atoms it produced: a break already demanded at the atom it
 * would name means the line already ends there, and the guard says
 * nothing further.
 * @param node - the item node.
 * @param parentList - the list the item belongs to.
 * @param atoms - the item's atoms, straight from the inline printer.
 * @param guard - what {@link hazard} answered for this item.
 * @returns the atoms the block body is packed from.
 */
function guardedAtoms(
  node: ListItemNode,
  parentList: ListNode | undefined,
  atoms: readonly Atom[],
  guard: BreakBefore,
): readonly Atom[] {
  const held = guard === "none" ? atoms : keepTextOnFirstRestLine(atoms, guard);
  const marker = markerLineGuard(node, parentList, held);
  switch (marker.kind) {
    case "asPacked": {
      return held;
    }
    case "holdBreak": {
      return held.with(marker.at, {
        ...held[marker.at],
        breakBefore: "hard",
      });
    }
    case "canonicalHead": {
      return canonicalChecklistHead(held);
    }
  }
}

/**
 * Prints a single list item to Doc IR.
 *
 * Produces marker + space + text content, with the text packed by THE
 * block-body engine. The marker's columns are the item's continuation
 * indent, so wrapped text lines up under the text start rather than the
 * marker. The item's blocks — nested lists and `+`-attached blocks
 * alike — follow in source order, each behind its gap replayed
 * VERBATIM ({@link gapParts}); the only spelling the printer decides
 * itself is the hazard's kept break (`hazard()`) — it
 * never invents a `+`. A `+` at the item's END comes back only where
 * the reader could not prove it inert
 * ({@link ListItemNode.trailingContinuation}) — behind an indented
 * literal or a raw-line paragraph, or inside another item's buffer,
 * the line is content of the block above it rather than the byte
 * Ruby's pop discards.
 * @param node - The list item AST node.
 * @param path - Prettier's AST path, used to recurse
 *   into the text and blocks and access the parent list node.
 * @param print - Prettier's recursive print callback.
 * @param printWidth - the column budget for a whole output line.
 * @returns Doc IR for the formatted list item.
 */
export function printListItem(
  node: ListItemNode,
  path: PrintPath,
  print: PrintFunction,
  printWidth: number,
): Doc {
  // KEPT, deliberately. `getParentNode()` is typed over the whole
  // node union, and an item's parent is a list by construction — the
  // reader builds items only into `ListNode.children`. The narrowing
  // that would delete this assertion (`p?.type === "list" ? p :
  // undefined`) buys nothing: it writes a branch whose false arm
  // cannot be reached and whose degrade is a silently wrong marker,
  // which is the shape the interior-validation registry existed to
  // forbid. The assertion states the boundary instead of hiding it.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- an item's parent is its list by construction; narrowing here would add an unreachable branch with a silent wrong-marker degrade
  const parentList = path.getParentNode() as ListNode | undefined;
  // The marker's own leading whitespace goes back in front of it.
  // Written rather than normalized to column 0 because it is what
  // decides whether the line UNDER this item reads as its sibling or
  // as its child (see ListItemNode.markerIndent), and it counts
  // toward the continuation indent the way the marker does - the
  // item's text still starts one column past the marker.
  const indentedMarker = node.markerIndent + buildMarker(node, parentList);
  const checkboxPrefix = formatCheckbox(node.checkbox);
  const markerWidth = indentedMarker.length + MARKER_OFFSET;
  // The width of the prefix the printer just wrote — "" for no
  // checkbox, `[x] `/`[ ] ` otherwise. It used to be the parser's
  // CHECKBOX_PREFIX_LEN, which made the printer reach into the
  // builders for the length of a string it was holding.
  const checkboxWidth = checkboxPrefix.length;

  // The marker written below holds column 0 of the item's first line.
  const atoms = inlineAtoms(node.text, node.position.start.line, {
    atColumnZero: false,
  });
  // The hazard, as a pure predicate over the finished node: reflow
  // may not push leading metadata onto the first rest line.
  const guard = hazard(node);
  const item: Doc[] = [
    indentedMarker,
    " ",
    checkboxPrefix,
    ...blockBody(
      guardedAtoms(node, parentList, atoms, guard),
      printWidth,
      markerWidth + checkboxWidth,
    ),
  ];

  const printedBlocks = path.map(
    (blockPath) => blockPath.call(print, "block"),
    "blocks",
  );
  const parts: Doc[] = [item];
  // `path.map` walked `blocks`, so the printed docs are that array's
  // parallel — the index is the item block's own.
  for (const [index, printedBlock] of printedBlocks.entries()) {
    const adjusted = printedGap(node, parentList, index);
    parts.push(...gapParts(adjusted), printedBlock);
  }
  if (node.trailingContinuation) {
    // ONE hardline, unconditionally — including after a nested list.
    // The trailing `+` of `* a\n** b\n+\n` belongs to the OUTER item
    // (a's scan buffers it via the final else and pops it in
    // finish(); b's buffer ends before it), and printing it back
    // directly under the nested list re-parses to the SAME node. A
    // blank line here would turn the `+` DETACHED on re-parse, l.1576
    // would erase it, and the second format would drop it.
    parts.push(hardline, "+");
  }
  if (node.detachedTail) {
    // One blank line, then the `+` — the DETACHED spelling, and the
    // only correct one: an ADJACENT `+` under the item's `+` paragraph
    // would freeze onto it on re-read and the marked pop would take
    // the paragraph (both arms test `ListContinuationMarker`,
    // parser.rb l.1443-46 and l.1580-81). Detached, the
    // `+` erases into the shield (l.1576) that absorbs the pop and
    // keeps the paragraph alive ({@link ListItemNode.detachedTail}).
    // Blank-run multiplicity collapses to the one blank, the same
    // collapse gapParts applies before a `+`.
    parts.push(hardline, hardline, "+");
  }
  return parts;
}

/**
 * The gap one block prints behind — the recorded one, adjusted in the
 * ONE case where verbatim replay would not read back as the same
 * structure: a nested list may SHARE its parent item's marker, and
 * then it must print ADJACENT.
 *
 * Behavior is Ruby's (`read_lines_for_list_item`, parser.rb
 * l.1404-1592): the item's read runs THROUGH an indented literal and
 * the metadata behind it, so the marker line after them lands INSIDE
 * the item however it is spelled — the oracle reads the second `* a`
 * of `* a\n\n  lit\n[[anc]]\n* a\n` as a nested list, and reads the
 * same document with one blank line more as two siblings. So any
 * blank-only gap in front of such a list reads back as a SIBLING
 * boundary — worse, the sibling probe eats the blank, so a second
 * pass prints different bytes. A gap carrying a `+` is left alone: the
 * `+` is live and must survive. Pinned by the same-marker rows in
 * tests/format/marker-spelling.test.ts and by the list-shape sweep.
 *
 * NO blank is invented in front of a nested list the item's own
 * literal slurp would swallow, and the asymmetry with
 * {@link tailSwallowsMarker} is the whole point: a slurp that runs
 * INSIDE the item takes the item's own lines into the item's own
 * buffer, which is re-parsed from those same lines and gives the same
 * blocks back. It is only where a slurp runs PAST the item's last
 * line that it reaches a line belonging to somebody else, and the
 * blank that stops it belongs there, at the boundary, not several
 * lines above it — an invented blank here ends the item early instead
 * and detaches everything behind it.
 *
 * The comparison is between the two RECORDED STYLES, not a
 * reconstruction and not the printed bytes: `ListNode.marker` is the
 * style the classifier resolved, and the re-read's own test
 * (`is_sibling_list_item?`, parser.rb l.2280) compares resolved
 * markers too, so the comparison asks exactly the question the
 * re-read will ask. Spellings would be the WRONG comparison here: a
 * nested `5.` under a `1.` parent is a sibling on re-read however
 * differently the two are spelled.
 * @param node - the item being printed
 * @param parentList - its list, for the marker STYLE (the printed
 *   spelling is the item's own, {@link buildMarker})
 * @param index - which of the item's blocks is being placed
 * @returns the gap to print
 * Exported for its unit test (tests/print/list.test.ts); no src
 * consumer.
 * @internal
 */
export function printedGap(
  node: ListItemNode,
  parentList: ListNode | undefined,
  index: number,
): readonly GapLine[] {
  const { gap, block } = node.blocks[index];
  if (block.type === "list" && block.marker === parentList?.marker) {
    return gap.includes("+") ? gap : [];
  }
  return gap;
}

/**
 * The line breaks one gap prints as: a hardline ends the previous
 * line, then each `""` is one more hardline (a blank line) and each
 * `"+"` is a `+` on a line of its own.
 *
 * A blank RUN collapses to one blank — the same rule joinBlocks holds
 * between blocks, and this was the last place in the printer where
 * blank multiplicity survived. It collapses only UP TO the gap's
 * first `+`, and that boundary is the whole rule: a blank run AFTER a
 * `+` is what ERASES the `+` (`buffer[detached_continuation] =
 * ListContinuationPlaceholder`, parser.rb l.1576), so shortening it
 * can resurrect a dead continuation and attach a block that was not
 * attached. Before any `+`, a run of blanks is a run of blanks —
 * `read_lines_for_list_item` skips them all at l.1515-17 and the
 * count reaches nothing.
 * @param gap - the separator lines the block prints behind
 * @returns the Doc parts to put in front of the block
 *
 * Exported for src/print/description-list.ts: a description item's
 * blocks stand behind the same recorded separator lines, so the
 * spelling is one rule and not two.
 */
export function gapParts(gap: readonly GapLine[]): Doc[] {
  const parts: Doc[] = [hardline];
  let livePlus = false;
  let blankRun = false;
  for (const line of gap) {
    if (line === "+") {
      // No reset of `blankRun` here: `livePlus` never goes back to
      // false, so the collapse below is switched off for the rest of
      // the gap whatever `blankRun` holds.
      livePlus = true;
      parts.push("+", hardline);
      continue;
    }
    if (!livePlus && blankRun) {
      continue;
    }
    blankRun = true;
    parts.push(hardline);
  }
  return parts;
}
