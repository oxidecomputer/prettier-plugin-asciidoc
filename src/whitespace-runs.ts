/**
 * WHERE A BLOCK'S WHITESPACE RUNS ARE: the cut that finds them, the
 * walk that puts them in one order, and the index that hands each one
 * back to the printer.
 *
 * The verdict on a run is next door ({@link factOfRun},
 * src/whitespace-fact.ts); this module is the half both sides have to
 * agree on BEFORE any row is read. The reader records one fact per
 * site in the order {@link whitespaceRuns} produces, and the printer
 * reads the facts back by asking the same walk which sites each of
 * its text nodes owns. A second copy of the walk in the printer would
 * be a place the two could drift, which is why it lives outside both
 * `src/parse` and `src/print` - the same shared home
 * src/block-metadata.ts already is for the metadata vocabulary.
 *
 * WHAT A RUN IS. A maximal run of ASCII whitespace in the block's
 * kept text. Three kinds of run are NOT runs of the block:
 *
 * - the interior of a node whose content the reader byte-preserves (a
 *   monospace span, issue #32; a passthrough, whose bytes are exempt
 *   from the substitution pass that reads a boundary at all). The
 *   exclusion is decided over the PAIRED tree, because pairing is
 *   what makes a span;
 * - the block's own leading run, which decides whether the block is
 *   an indented literal at all - a whole-line question, not a run's;
 * - and its trailing run, which the reference's reader strips
 *   (`prepare_lines`, reader.rb l.582) before any rule reads a
 *   boundary.
 */
import type { InlineNode, TextNode } from "./ast.js";
import type { BlockWhitespace, WhitespaceFact } from "./whitespace-record.js";
import { ASCII_WHITESPACE } from "./parse/line-shapes.js";

/**
 * The `+` quantified form of {@link ASCII_WHITESPACE}, CAPTURED, so a
 * split on it keeps every run beside the words it separated: whether
 * a run may fold is a question about its own bytes.
 */
const ASCII_WHITESPACE_RUN_KEPT = new RegExp(
  `(${ASCII_WHITESPACE.source}+)`,
  "v",
);

/**
 * One value cut into its words and every run around them.
 *
 * Exported because it names {@link cutValue}'s result, and asserted
 * whole by tests/print/whitespace-fact.test.ts; src callers
 * destructure it.
 * @internal
 */
export interface CutValue {
  /** The non-empty words, in order; empty for an all-whitespace value. */
  readonly words: readonly string[];
  /** `runs[index]` stands between `words[index]` and its successor. */
  readonly runs: readonly string[];
  /** The run in front of the first word; `""` where there is none. */
  readonly leading: string;
  /** The run behind the last word; `""` where there is none. */
  readonly trailing: string;
}

/**
 * Cut a value into its words and the runs around them.
 *
 * THE WHOLE CUT, edge runs included, because the record is indexed
 * over the runs of a BLOCK and not of a value: a run at a value's
 * edge is not between two of its words, but it IS between this node
 * and the one beside it, so it is a run of the block and needs its
 * own fact. One cut answers all three positions, which is what keeps
 * the reader's runs and the printer's words the same partition of
 * the same bytes.
 *
 * Splits on {@link ASCII_WHITESPACE} - Ruby's `\s`, `[ \t\r\n\f\v]` -
 * not JavaScript's wider `\s`, which also takes a no-break space,
 * every Unicode space separator, the line and paragraph separators
 * and a byte-order mark. Asciidoctor never treats any of those as a
 * word separator (`Reader#rstrip`'s own strip set is the same six
 * characters), so a word holding one is ONE word here (issue #75).
 * @param value - raw source text, or a prefix of it.
 * @returns the words and every run around them.
 */
export function cutValue(value: string): CutValue {
  // The capturing form keeps every separator in the result, so the
  // pieces alternate word, run, word, run - starting and ending with
  // a word, which is empty exactly where the value opens or closes
  // with whitespace.
  const pieces = value.split(ASCII_WHITESPACE_RUN_KEPT);
  const words: string[] = [];
  const runs: string[] = [];
  let leading = "";
  // Where the LAST word stands among the pieces: the separator one
  // past it is the value's trailing run, and there is none where the
  // value ends on a word.
  let lastWord = pieces.length;
  for (let index = 0; index < pieces.length; index += 2) {
    if (pieces[index].length === 0) {
      continue;
    }
    if (words.length === 0) {
      // An all-whitespace value never reaches here, so its one run is
      // the leading run of a value with no word - which is what the
      // caller reads it as.
      leading = index > 0 ? pieces[index - 1] : "";
    } else {
      runs.push(pieces[index - 1]);
    }
    lastWord = index;
    words.push(pieces[index]);
  }
  const after = lastWord + 1;
  return {
    words,
    runs,
    leading: words.length > 0 ? leading : (pieces[1] ?? ""),
    trailing: after < pieces.length ? pieces[after] : "",
  };
}

// A run of whitespace containing at least one LINE BREAK - the
// boundary {@link splitPreservingSpaces} cuts on, as opposed to
// {@link cutValue}, which cuts on ANY whitespace run. `\n` is itself
// inside ASCII_WHITESPACE, so the trailing quantifier already absorbs
// a run of several newlines and the spaces between them; only the
// leading quantifier is needed to reach back over indentation BEFORE
// the break.
const LINE_BREAK_RUN = new RegExp(
  String.raw`${ASCII_WHITESPACE.source}*\n${ASCII_WHITESPACE.source}*`,
  "v",
);

// The front and back halves of LINE_BREAK_RUN, anchored: whether a
// value's OWN edge run contains the break rather than plain
// horizontal whitespace.
const LEADING_LINE_BREAK = new RegExp(
  String.raw`^${ASCII_WHITESPACE.source}*\n`,
  "v",
);
const TRAILING_LINE_BREAK = new RegExp(
  String.raw`\n${ASCII_WHITESPACE.source}*$`,
  "v",
);

/**
 * Split byte-preserved text into chunks: cut only where a LINE BREAK
 * stood, never on an interior run of plain spaces or tabs.
 *
 * The cut for the content this module's walk EXCLUDES - a monospace
 * span's interior, whose spacing Asciidoctor renders as written
 * (issue #32, measured: `` `a  b` `` renders `<code>a  b</code>`,
 * both spaces kept). Such a run has no fact because no row may
 * respell it; a line break inside one still folds to one breakable
 * join, because Asciidoctor copies it into the rendered element just
 * as it does outside one.
 * @param value - raw source text, or a prefix of it.
 * @returns the chunks, in order; empty only where `value` held
 *   nothing but a line-break run.
 */
export function splitPreservingSpaces(value: string): string[] {
  return value.split(LINE_BREAK_RUN).filter((chunk) => chunk.length > 0);
}

/**
 * Whether `value`'s LEADING whitespace run - if any - contains a line
 * break. Pure leading spaces or tabs answer false:
 * {@link splitPreservingSpaces} bakes them into its first chunk
 * instead of treating them as a join, so the caller must not also ask
 * the packer to insert one there.
 * @param value - raw source text.
 * @returns whether the run cut at the front of `value` holds a break.
 */
export function leadsWithLineBreak(value: string): boolean {
  return LEADING_LINE_BREAK.test(value);
}

/**
 * Whether `value`'s TRAILING whitespace run - if any - contains a line
 * break. Mirrors {@link leadsWithLineBreak} at the trailing edge.
 * @param value - raw source text.
 * @returns whether the run cut at the end of `value` holds a break.
 */
export function trailsWithLineBreak(value: string): boolean {
  return TRAILING_LINE_BREAK.test(value);
}

/**
 * Where a run sits inside the text node that holds it. The printer
 * asks three different questions of the three slots - an interior run
 * separates two words it can fuse, an edge run has to ride inside the
 * atom beside it, and a node that IS a run has no atom of its own -
 * so the slot travels with the fact rather than being recovered from
 * an index.
 */
type RunSlot = "leading" | "interior" | "trailing" | "whole";

/** What faces a run on one side. */
export type RunSide =
  | {
      /** A word of the run's own text node stands here. */
      readonly at: "word";
      /** That word, as the source wrote it. */
      readonly word: string;
      /**
       * The word runs FLUSH into an attribute reference on its far
       * side, so what the replacement pass reads there is the word's
       * bytes and the reference's value together (`-{h}` with `:h: -`
       * spells the em dash's two hyphens between them, issue #154).
       */
      readonly fusedToReference: boolean;
    }
  | {
      /** An inline sibling stands here. */
      readonly at: "node";
      /** That sibling. */
      readonly node: InlineNode;
    }
  | {
      /**
       * Nothing of the block's own content stands here: the run
       * reaches the edge of its parent's child list. At block level
       * that edge is excluded from the record entirely; inside a span
       * it is the span's own mark, whose bytes no row of the table
       * reads.
       */
      readonly at: "edge";
    };

/** One whitespace run of a block, with everything the rows read. */
export interface RunSite {
  /** The text node whose value holds the run. */
  readonly node: TextNode;
  /** Where in that node's value it stands. */
  readonly slot: RunSlot;
  /** The run, as the source wrote it. Non-empty. */
  readonly bytes: string;
  /** What faces it in front. */
  readonly before: RunSide;
  /** What faces it behind. */
  readonly after: RunSide;
  /**
   * The run lies inside the reach of a macro whose target or reftext
   * the converter reads as one string (rows A10 to A12), and which of
   * the three that is.
   */
  readonly reach: MacroReach;
}

/**
 * A macro whose bracketed reach the converter reads as ONE string, so
 * a run inside it is not prose. `"none"` for a run outside every
 * reach.
 */
type MacroReach = "none" | "urlTarget" | "plainTarget" | "reftext";

// The reach of a macro target: the rows whose run lies inside a
// bracketed target or reftext.

// `image:`/`icon:` and `menu:` reach from the macro name to the `[`
// that opens its attribute list. The target class here is WIDER than
// the reference's (`\S+` there, rx.rb l.554), and deliberately: this
// row exists exactly for the targets that hold whitespace, which our
// reader leaves as text because no macro forms over them. The name
// may not be preceded by a word character, which is what keeps
// `notanimage:x[]` out.
const URL_TARGET_MACRO =
  /(?<![\p{L}\p{N}_:])(?:image|icon):(?<reach>[^\[\n]*)\[/dgv;
const PLAIN_TARGET_MACRO = /(?<![\p{L}\p{N}_:])menu:(?<reach>[^\[\n]*)\[/dgv;

// An anchor's REFTEXT: the bracketed half of `anchor:id[reftext]` and
// the comma half of `[[id,reftext]]`. `InlineAnchorRx` spells the
// reftext with `.` and no `/m` (rx.rb l.443), so a newline there ends
// the match and the anchor is not an anchor.
const ANCHOR_REFTEXT =
  /(?<![\p{L}\p{N}_:])anchor:[^\[\n]*\[(?<reach>[^\]\n]*)\]/dgv;
const INLINE_ANCHOR_REFTEXT = /\[\[[^\],\n]*,(?<reach>[^\]\n]*)\]\]/dgv;

/** One half-open span of a value, and what reads it. */
interface Reach {
  /** First offset inside the reach. */
  readonly start: number;
  /** One past the last offset inside it. */
  readonly end: number;
  /** Which row reads it. */
  readonly kind: MacroReach;
}

/**
 * Every macro reach in one text node's value.
 *
 * WITHIN ONE NODE, because a construct whose bytes the reader split
 * across two nodes is a construct the reader did not form, and the
 * rows are about the target the CONVERTER reads: a target that
 * reaches over an inline span's marks is not a target in either
 * program.
 * @param value - the node's raw source text.
 * @returns the reaches, in no particular order; empty for a value
 *   holding no macro.
 */
function reachesOf(value: string): readonly Reach[] {
  const found: Reach[] = [];
  const patterns: ReadonlyArray<readonly [RegExp, MacroReach]> = [
    [URL_TARGET_MACRO, "urlTarget"],
    [PLAIN_TARGET_MACRO, "plainTarget"],
    [ANCHOR_REFTEXT, "reftext"],
    [INLINE_ANCHOR_REFTEXT, "reftext"],
  ];
  for (const [pattern, kind] of patterns) {
    pattern.lastIndex = 0;
    for (const match of value.matchAll(pattern)) {
      const span = match.indices?.groups?.reach;
      if (span !== undefined) {
        found.push({ start: span[0], end: span[1], kind });
      }
    }
  }
  return found;
}

/**
 * Which reach a run at `[start, end)` lies inside.
 * @param reaches - the value's reaches.
 * @param start - the run's first offset.
 * @param end - one past the run's last offset.
 * @returns the reach's kind, or `"none"` where the run is outside
 *   every one of them.
 */
function reachAt(
  reaches: readonly Reach[],
  start: number,
  end: number,
): MacroReach {
  const holding = reaches.find(
    (reach) => reach.start <= start && end <= reach.end,
  );
  return holding === undefined ? "none" : holding.kind;
}

// The enumeration: the one walk both halves ask for a block's runs.

/**
 * Whether this node's content is bytes the reader preserves, so the
 * runs inside it are not runs of the block: a monospace span renders
 * its interior spacing as written (issue #32), and a passthrough is
 * exempt from the substitution pass that reads a boundary at all.
 * @param node - the node.
 * @returns true when the walk must not descend into it.
 */
function bytePreserved(node: InlineNode): boolean {
  return node.type === "monospace" || node.type === "passthrough";
}

/**
 * The children a run walk descends into.
 * @param node - the node.
 * @returns its inline children, or undefined for a leaf.
 */
export function childrenOf(
  node: InlineNode,
): readonly InlineNode[] | undefined {
  return "children" in node ? node.children : undefined;
}

/** One run, with how much of the block's content stands in front of it. */
interface StampedSite {
  /** The run. */
  readonly site: RunSite;
  /** How many words and non-text nodes the walk had passed. */
  readonly contentInFront: number;
}

/** The state one walk carries across its whole recursion. */
interface Walk {
  /** The runs found so far, in order. */
  readonly sites: StampedSite[];
  /** How many words and non-text nodes the walk has passed. */
  content: number;
}

/**
 * What faces a run reaching the edge of its node: the sibling there,
 * or the edge itself.
 * @param sibling - the inline sibling, where there is one.
 * @returns the side.
 */
function sideOfSibling(sibling: InlineNode | undefined): RunSide {
  return sibling === undefined ? { at: "edge" } : { at: "node", node: sibling };
}

/**
 * What faces a run across one of its own node's words.
 * @param word - the word.
 * @param fused - whether the word runs flush into a reference on its
 *   far side.
 * @returns the side.
 */
function sideOfWord(word: string, fused: boolean): RunSide {
  return { at: "word", word, fusedToReference: fused };
}

/**
 * Whether a node is an attribute reference, whose value is not in the
 * tree at all.
 * @param node - the node, or undefined where there is none.
 * @returns true for an attribute reference.
 */
export function hidesItsBytes(node: InlineNode | undefined): boolean {
  return node?.type === "attributeReference";
}

/** One text node's runs, with everything both edges need. */
interface TextCursor {
  /** The node. */
  readonly node: TextNode;
  /** Its value, cut into words and runs. */
  readonly cut: CutValue;
  /** The macro reaches inside its value. */
  readonly reaches: readonly Reach[];
  /** The sibling in front of it, where there is one. */
  readonly inFront: InlineNode | undefined;
  /** The sibling behind it, where there is one. */
  readonly behind: InlineNode | undefined;
  /**
   * Its FIRST word stands flush against an attribute reference in
   * front, and its LAST word flush against one behind: half of what
   * makes a lone dash spell the em-dash row's pattern (issue #154).
   */
  readonly fusesInFront: boolean;
  /** The mirror of `fusesInFront`, behind the node. */
  readonly fusesBehind: boolean;
}

/**
 * Add one run to the walk, stamped with the content in front of it.
 * @param walk - the walk's state (mutated).
 * @param site - the run.
 */
function record(walk: Walk, site: RunSite): void {
  walk.sites.push({ site, contentInFront: walk.content });
}

/**
 * Add the runs BETWEEN one text node's words, counting its words into
 * the walk's content as it goes.
 * @param walk - the walk's state (mutated).
 * @param cursor - the node's runs and edges.
 * @param from - the offset the node's first word starts at.
 */
function interiorRuns(walk: Walk, cursor: TextCursor, from: number): void {
  const { words, runs } = cursor.cut;
  let at = from;
  for (const [index, word] of words.entries()) {
    walk.content += 1;
    at += word.length;
    if (index >= runs.length) {
      continue;
    }
    record(walk, {
      node: cursor.node,
      slot: "interior",
      bytes: runs[index],
      before: sideOfWord(word, index === 0 && cursor.fusesInFront),
      after: sideOfWord(
        words[index + 1],
        index === runs.length - 1 && cursor.fusesBehind,
      ),
      reach: reachAt(cursor.reaches, at, at + runs[index].length),
    });
    at += runs[index].length;
  }
}

/**
 * Add the runs at one text node's two EDGES, each of which stands
 * between the node and the sibling beside it.
 * @param walk - the walk's state (mutated); the leading edge is
 *   recorded before the interior and the trailing edge after it, so
 *   the caller runs this twice.
 * @param cursor - the node's runs and edges.
 * @param edge - which end to record.
 */
function edgeRun(walk: Walk, cursor: TextCursor, edge: "front" | "back"): void {
  const { words, leading, trailing } = cursor.cut;
  const { value } = cursor.node;
  const bytes = edge === "front" ? leading : trailing;
  if (bytes === "") {
    return;
  }
  const alone = words.length === 1;
  record(walk, {
    node: cursor.node,
    slot: edge === "front" ? "leading" : "trailing",
    bytes,
    before:
      edge === "front"
        ? sideOfSibling(cursor.inFront)
        : sideOfWord(words.at(-1) ?? "", alone && cursor.fusesInFront),
    after:
      edge === "front"
        ? sideOfWord(words[0], alone && cursor.fusesBehind)
        : sideOfSibling(cursor.behind),
    reach:
      edge === "front"
        ? reachAt(cursor.reaches, 0, bytes.length)
        : reachAt(cursor.reaches, value.length - bytes.length, value.length),
  });
}

/**
 * Add one text node's runs to the walk.
 * @param walk - the walk's state (mutated).
 * @param node - the text node.
 * @param inFront - its preceding inline sibling, where there is one.
 * @param behind - its following inline sibling, where there is one.
 */
function textRuns(
  walk: Walk,
  node: TextNode,
  inFront: InlineNode | undefined,
  behind: InlineNode | undefined,
): void {
  const { value } = node;
  const reaches = reachesOf(value);
  const cut = cutValue(value);
  // A value that is nothing but whitespace is ONE run standing
  // between two siblings; it has no word for either side to read.
  if (cut.words.length === 0) {
    if (value.length > 0) {
      record(walk, {
        node,
        slot: "whole",
        bytes: value,
        before: sideOfSibling(inFront),
        after: sideOfSibling(behind),
        reach: reachAt(reaches, 0, value.length),
      });
    }
    return;
  }
  const cursor: TextCursor = {
    node,
    cut,
    reaches,
    inFront,
    behind,
    fusesInFront: cut.leading === "" && hidesItsBytes(inFront),
    fusesBehind: cut.trailing === "" && hidesItsBytes(behind),
  };
  edgeRun(walk, cursor, "front");
  interiorRuns(walk, cursor, cut.leading.length);
  edgeRun(walk, cursor, "back");
}

/**
 * Walk one list of inline siblings, adding every run they hold.
 * @param walk - the walk's state (mutated).
 * @param nodes - the siblings, in order.
 */
function walkNodes(walk: Walk, nodes: readonly InlineNode[]): void {
  for (const [index, node] of nodes.entries()) {
    if (node.type === "text") {
      textRuns(walk, node, nodes[index - 1], nodes[index + 1]);
      continue;
    }
    // Every other node WRITES something - a mark, a macro, a break -
    // so the block has content on this side of any run after it, and
    // the walk descends only where the content is prose.
    walk.content += 1;
    const children = childrenOf(node);
    if (children !== undefined && !bytePreserved(node)) {
      walkNodes(walk, children);
    }
  }
}

/**
 * Every whitespace run of one prose block, in printing order.
 *
 * The order is the ONE thing the reader and the printer have to
 * agree on: the reader records a fact per site in this order, and the
 * printer reads the facts back by asking this same walk which sites
 * each of its text nodes owns.
 * @param children - the block's inline children, in order.
 * @returns the runs, in order.
 */
export function whitespaceRuns(
  children: readonly InlineNode[],
): readonly RunSite[] {
  const walk: Walk = { sites: [], content: 0 };
  walkNodes(walk, children);
  // The block's own leading and trailing runs are not runs of the
  // block: the first is the indent that decides whether the block is
  // an indented literal at all, and the last is taken by the
  // reference's own rstrip (`prepare_lines`, reader.rb l.582) before
  // any rule reads a boundary. Both are exactly the runs with no
  // content of the block on one side of them.
  return walk.sites
    .filter(
      (stamped) =>
        stamped.contentInFront > 0 && stamped.contentInFront < walk.content,
    )
    .map((stamped) => stamped.site);
}

// Reading the record back, by the text node each fact belongs to.

/** The facts of one text node's runs, by the slot each stands in. */
export interface NodeFacts {
  /** The node's leading edge run, where it has one. */
  readonly leading: WhitespaceFact | undefined;
  /** `interior[index]` separates the node's words `index` and `index + 1`. */
  readonly interior: ReadonlyArray<WhitespaceFact | undefined>;
  /** The node's trailing edge run, where it has one. */
  readonly trailing: WhitespaceFact | undefined;
  /** The whole value, where the node is nothing but one run. */
  readonly whole: WhitespaceFact | undefined;
}

/** A text node the record has nothing to say about. */
const NO_FACTS: NodeFacts = {
  leading: undefined,
  interior: [],
  trailing: undefined,
  whole: undefined,
};

/**
 * The fact of the run at `index`.
 *
 * A REPLAYED block has no per-run facts, and needs none: its rows read
 * which LINE a byte of the block is on, and every run keeps the
 * spelling the source gave it. That is the whole of what the printer
 * can write back - a byte-exact replay would need the block's source
 * slice, which the tree does not hold for a prose block - and it is
 * exactly the reading those rows are about.
 * @param whitespace - the block's record.
 * @param index - the run's position in the enumeration.
 * @param bytes - the run, as the source wrote it.
 * @returns the fact.
 */
function factAt(
  whitespace: BlockWhitespace,
  index: number,
  bytes: string,
): WhitespaceFact {
  return whitespace.kind === "reflowable"
    ? whitespace.runs[index]
    : {
        kind: "bound",
        to: bytes.includes("\n") ? "newline" : "space",
        by: "blockReplay",
      };
}

/**
 * The record, indexed by the text node each fact belongs to.
 *
 * The printer walks the same nodes the reader recorded over, so the
 * index is rebuilt by re-running the ENUMERATION - never the rows.
 * What the printer may not re-derive is the verdict; which runs a
 * block has is the shape of the record itself, and one walk is what
 * keeps the two halves from disagreeing about it.
 * @param children - the block's inline children, in order.
 * @param whitespace - the record the reader put on the block.
 * @returns the facts of every text node that owns one.
 */
export function factsByNode(
  children: readonly InlineNode[],
  whitespace: BlockWhitespace,
): ReadonlyMap<TextNode, NodeFacts> {
  const byNode = new Map<TextNode, NodeFacts>();
  const sites = whitespaceRuns(children);
  for (const [index, site] of sites.entries()) {
    const fact = factAt(whitespace, index, site.bytes);
    const held = byNode.get(site.node) ?? NO_FACTS;
    byNode.set(site.node, {
      ...held,
      ...(site.slot === "interior"
        ? { interior: [...held.interior, fact] }
        : { [site.slot]: fact }),
    });
  }
  return byNode;
}

/**
 * The facts of one text node, or the empty record where the block
 * holds none for it.
 * @param facts - the block's index.
 * @param node - the text node.
 * @returns its facts.
 */
export function factsOf(
  facts: ReadonlyMap<TextNode, NodeFacts>,
  node: TextNode,
): NodeFacts {
  return facts.get(node) ?? NO_FACTS;
}
