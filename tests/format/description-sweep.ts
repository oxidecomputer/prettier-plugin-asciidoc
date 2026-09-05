/**
 * The description-list printing sweep: two grids over the shapes the
 * reflow verdict is decided on, and the verdict every row is held to.
 *
 * WHAT THE GRIDS ARE FOR. The verdict is decided per WORD and per word
 * PAIR over a run's recorded lines, and it is spent by a packer that
 * chooses line breaks by WIDTH. Those are two different questions, and
 * a per-word rule can only be trusted where a width was actually tried:
 * a token that is inert in the middle of a line is a construct at the
 * start or the end of one, and which line ends where is the width's
 * answer, not the rule's. So the first grid crosses a hazard alphabet
 * with the positions a run can hold it in and the widths that break
 * the run at every one of those positions.
 *
 * The second grid asks the question the first cannot: the same
 * payloads inside every container a description list can stand in. A
 * container decides what the re-reader does with the lines the packer
 * wrote - a list item runs its own confined reader over them, a
 * delimited block runs none - so a payload that is safe at document
 * level is not thereby safe inside one.
 *
 * The third grid asks the question NEITHER of the first two can: what
 * stands UNDER the description. A wrap does not only respell the run,
 * it writes a text line into the region the item's first block opens
 * in, and a shape that means something only on the first line under
 * the term stops meaning it there. Both grids above were blind to
 * that: one puts its hazards inside the run and the other wraps the
 * item in a container, and neither ever put a block after it.
 *
 * WHAT THE GRIDS CAN AND CANNOT SEE, measured by disabling one
 * condition at a time and re-running them. They catch an
 * UNDER-refusal: removing the content condition, the separator
 * condition, either wrap-safety condition, the pair clauses or the
 * follower condition turns one of them red. They cannot catch an
 * OVER-refusal, because replaying is always render-equal and always a
 * fixed point - so widening the follower condition to a blanket
 * refusal on any zero-gap block leaves all three green. The byte rows
 * in description-list.test.ts are the net for that direction, and this
 * file's follower grid carries both halves of its class for the same
 * reason: the shapes that must keep joining are what a blanket rule
 * would silently cost.
 *
 * Deterministic and committed, so a row id in a failure message names
 * the same source every run: no input is generated at run time, and
 * the alphabets below ARE the inputs.
 */
import { formatAdoc, renderedHtml } from "../helpers.js";

/** One generated row: a stable id, its document and its width. */
export interface DescriptionRow {
  /** `token/<token>/<position>@<width>` or `container/<name>/<payload>@<width>`. */
  readonly id: string;
  /** The whole document, newline terminated. */
  readonly source: string;
  /** The column budget the row is formatted at. */
  readonly printWidth: number;
}

/**
 * The hazard alphabet: one token per shape a description's word can
 * turn into once a line break lands beside it, plus the spellings that
 * must stay ordinary text so a widening of the rule shows up as a lost
 * join rather than as nothing at all.
 *
 * Every entry is a word of the description, never of the term: the
 * term and its delimiter are the item's own opening and no condition
 * reads them.
 */
const TOKENS: readonly string[] = [
  // A comment to `Reader#skip_line_comments`, ordinary text to
  // `CommentLineRx`. The two disagree on exactly this spelling.
  "///",
  // A comment to both.
  "//c",
  // An attribute entry, drained by the metadata loop.
  ":a:",
  // A block title, drained by the same loop.
  ".x",
  // Ordinary text alone, an ordered list item with a successor.
  ".",
  // The two term separators a joined line can be re-read on.
  "x::",
  "x;;",
  // A separator INSIDE a word, which matches no term pattern and must
  // keep joining.
  "x::y",
  // The closed bracket that turns a wrapped term line into
  // `name:: target[attrlist]`.
  "x[]",
  // The four spellings beside it that stay ordinary text.
  "x[",
  "x]",
  "x{}",
  "x()",
  // A bracket opened in one word and closed in a later one: the pair
  // no per-word probe can see.
  "[a",
  "b]",
  // A block macro head, the other opener of the same pair.
  "image::y",
  // A hard line break, or a list continuation.
  "+",
  // A callout marker.
  "<1>",
  // A block delimiter.
  "----",
  // A list marker head, and a section title head.
  "*",
  "==",
  // The two markdown thematic-break spellings this registry's own
  // marker and delimiter patterns do NOT reach: three hyphens is
  // neither a `-` marker nor a `----` delimiter, and the underscore
  // form is neither of anything.
  "---",
  "___",
];

/**
 * Where the token stands in the run. FIVE positions, because a wrap
 * can put a word at a line start, at a line end, or leave it in the
 * middle, and because the term line's own inline half and the rest
 * lines under it are read by different conditions.
 * @param token - the hazard token
 * @returns one source document per position, keyed by position name
 */
function positions(token: string): ReadonlyArray<readonly [string, string]> {
  return [
    ["inline-head", `t:: ${token} aaa bbb ccc ddd\n`],
    ["inline-tail", `t:: aaa bbb ccc ddd ${token}\n`],
    ["inline-middle", `t:: aaa bbb ${token} ccc ddd\n`],
    ["rest-head", `t:: aaa bbb\n${token} ccc ddd\n`],
    ["rest-alone", `t:: aaa bbb ccc\n${token}\n`],
  ];
}

/**
 * The widths the grid is swept at.
 *
 * Chosen so that every position above lands at a line start and at a
 * line end somewhere in the sweep: the payloads are five to six words
 * of three to four columns each, so a break falls between two of them
 * at each of these budgets, and 80 is the row where nothing wraps at
 * all and the join is the whole of what is tested.
 */
const WIDTHS: readonly number[] = [8, 12, 16, 24, 80];

/**
 * The runs whose hazard is a PAIR of words rather than one word: a
 * shape one word opens and a later word closes. No per-word probe can
 * see one, because neither of the two spellings a probe asks carries
 * the other half.
 *
 * Each is swept across a CONTIGUOUS width range rather than at the
 * grid's five widths, because a pair rule cannot tell whether a width
 * exists that actually places the closer at a line end: the sweep is
 * what tries every one that could.
 */
const PAIR_RUNS: ReadonlyArray<readonly [string, string]> = [
  // `[a b]` on the wrapped term line is `name:: target[attrlist]` with
  // the target `" "`, so the item stops existing.
  ["bracket", "t:: [a b] ccc ddd eee\n"],
  // `:a a:` on a line of its own is an attribute entry, which the
  // metadata loop drains: the words leave the render and a document
  // attribute is set.
  ["attribute-entry", "t:: alpha :a a: bravo charlie\n"],
  // The same closer behind a macro name. The term head spelling of the
  // per-word probe reaches this only where the TERM is itself a legal
  // macro name, and `a b` is not.
  ["block-macro", "a b:: alpha image::y x[] bravo\n"],
  // The realistic spelling of the first, which the clause refuses at
  // every width even though no width loses a render or a fixed point.
  ["xref-label", "t:: see xref:x.adoc#p[P stylesheet section] end\n"],
];

/** The contiguous width range the pair runs are swept across. */
const PAIR_WIDTHS: readonly number[] = Array.from(
  { length: 25 },
  (_unused, index) => index + 8,
);

/**
 * The token grid: every token, in every position, at every width, plus
 * every pair run at every width of the contiguous range.
 */
export const TOKEN_ROWS: readonly DescriptionRow[] = [
  ...TOKENS.flatMap((token) =>
    positions(token).flatMap(([position, source]) =>
      WIDTHS.map((printWidth) => ({
        id: `token/${token}/${position}@${String(printWidth)}`,
        source,
        printWidth,
      })),
    ),
  ),
  ...PAIR_RUNS.flatMap(([name, source]) =>
    PAIR_WIDTHS.map((printWidth) => ({
      id: `pair/${name}@${String(printWidth)}`,
      source,
      printWidth,
    })),
  ),
];

/**
 * One payload the container grid places: the item's own lines, spelled
 * with whatever delimiter its container leaves free.
 */
interface Payload {
  /** The payload's name, for the row id. */
  readonly name: string;
  /**
   * The item's lines.
   * @param delimiter - the delimiter the container leaves free
   * @returns the lines, without a trailing newline
   */
  readonly lines: (delimiter: string) => string;
}

/**
 * The payloads, one per answer the verdict can give and one per
 * mechanism behind it. Together they cover both arms in every
 * container, which is what makes a container row a comparison rather
 * than a single observation.
 */
const PAYLOADS: readonly Payload[] = [
  { name: "join", lines: (d) => `t${d} alpha bravo\ncharlie delta` },
  { name: "wrap", lines: (d) => `t${d} alpha bravo charlie delta echo` },
  { name: "separator", lines: (d) => `t${d} alpha\nbravo x:: charlie` },
  { name: "indented-rest", lines: (d) => `t${d} alpha\n  bravo` },
  { name: "comment-rest", lines: (d) => `t${d} alpha\n// bravo` },
  { name: "bracket-pair", lines: (d) => `t${d} [a b] ccc ddd eee` },
  { name: "hard-break", lines: (d) => `t${d} alpha bravo +\ncharlie` },
  { name: "textless", lines: (d) => `t${d}\nalpha bravo charlie` },
  // The two block heads a per-word probe cannot reach, because each
  // needs several words to be itself: a markdown thematic break
  // written with spaces, and a markdown blockquote.
  { name: "markdown-rule", lines: (d) => `t${d} alpha bravo\n_ _ _` },
  { name: "markdown-quote", lines: (d) => `t${d} alpha bravo\n> quote` },
];

/**
 * One container the payload is placed in, with the delimiter it leaves
 * free for the payload's own term line.
 */
interface Container {
  /** The container's name, for the row id. */
  readonly name: string;
  /**
   * The delimiter the payload may use. `:::` where the container is
   * itself a `::` description item, because a `::` term there would be
   * that list's next SIBLING rather than a list inside it
   * (`DescriptionListSiblingRx`, rx.rb:340-345).
   */
  readonly delimiter: string;
  /**
   * The whole document.
   * @param lines - the payload's lines
   * @returns the document, newline terminated
   */
  readonly document: (lines: string) => string;
}

/**
 * The containers a description list can stand in, one row per kind of
 * re-reader that runs over the packer's output.
 */
const CONTAINERS: readonly Container[] = [
  { name: "document", delimiter: "::", document: (l) => `${l}\n` },
  {
    name: "after-paragraph",
    delimiter: "::",
    document: (l) => `para\n\n${l}\n`,
  },
  { name: "section", delimiter: "::", document: (l) => `== S\n\n${l}\n` },
  // A list item runs its own confined reader over the item's lines,
  // which is where `skip_line_comments` and the metadata drain live.
  { name: "ulist-item", delimiter: "::", document: (l) => `* o\n${l}\n` },
  { name: "olist-item", delimiter: "::", document: (l) => `. o\n${l}\n` },
  {
    name: "ulist-continuation",
    delimiter: "::",
    document: (l) => `* o\n+\n${l}\n`,
  },
  // A description inside a description: the nested list needs the
  // longer delimiter, or its term line is the outer list's sibling.
  {
    name: "dlist-description",
    delimiter: ":::",
    document: (l) => `outer:: d\n${l}\n`,
  },
  {
    name: "dlist-continuation",
    delimiter: ":::",
    document: (l) => `outer:: d\n+\n${l}\n`,
  },
  // A delimited parent runs no confined item reader, so its interior
  // is the control the item containers are read against.
  { name: "example", delimiter: "::", document: (l) => `====\n${l}\n====\n` },
  { name: "sidebar", delimiter: "::", document: (l) => `****\n${l}\n****\n` },
  { name: "quote", delimiter: "::", document: (l) => `____\n${l}\n____\n` },
  { name: "open", delimiter: "::", document: (l) => `--\n${l}\n--\n` },
];

/**
 * The widths the container grid is swept at: one that wraps every
 * payload and one that wraps none, so each container is asked about
 * the join and about the wrap separately.
 */
const CONTAINER_WIDTHS: readonly number[] = [16, 80];

/** The container grid: every payload, in every container, at both widths. */
export const CONTAINER_ROWS: readonly DescriptionRow[] = CONTAINERS.flatMap(
  (container) =>
    PAYLOADS.flatMap((payload) =>
      CONTAINER_WIDTHS.map((printWidth) => ({
        id: `container/${container.name}/${payload.name}@${String(printWidth)}`,
        source: container.document(payload.lines(container.delimiter)),
        printWidth,
      })),
    ),
);

/**
 * The shapes a block can open on, directly under a description. The
 * grid below is the third question the other two cannot ask: a WRAP
 * writes a text line into the region the item's first block opens in,
 * and a shape that only means something on the FIRST line under the
 * term stops meaning it there.
 *
 * Both halves are here on purpose. The first four are the shapes the
 * registry files as ending a description on its first line only
 * (line-shapes.ts, `DLIST_FIRST_LINE_INTERRUPTERS`); the rest end it
 * from any position, or open no block at all, and must keep their
 * joins. A grid holding only the first half would go green under a
 * blanket refusal that costs every one of them.
 */
const FOLLOWERS: ReadonlyArray<readonly [string, string]> = [
  ["admonition", "NOTE: watch out."],
  ["block-macro", "image::y[]"],
  ["thematic-break", "'''"],
  ["page-break", "<<<"],
  ["callout", "<1> a"],
  ["ulist", "* one"],
  ["olist", ". one"],
  ["sibling-term", "u:: other"],
  ["nested-term", "u::: other"],
  ["continuation", "+\npara here"],
  ["attribute-line", "[role]\npara here"],
  ["anchor", "[[anc]]\npara here"],
  ["block-title", ".T\npara here"],
  ["attribute-entry", ":a: v\npara here"],
  ["comment", "// c\npara here"],
  ["listing", "----\nx\n----"],
  ["literal", "  lit line"],
  ["section", "== S"],
];

/**
 * The descriptions the follower grid places above each shape: one
 * that wraps at every width below and one that wraps at none, so each
 * follower is asked about the wrap and about the join separately.
 */
const FOLLOWER_DESCRIPTIONS: ReadonlyArray<readonly [string, string]> = [
  [
    "long",
    "the quick brown fox jumps over the lazy dog and keeps running until tired",
  ],
  ["short", "alpha bravo"],
];

/** The gaps between the description and the block: none, and one blank. */
const FOLLOWER_GAPS: readonly number[] = [0, 1];

/** The widths the follower grid is swept at. */
const FOLLOWER_WIDTHS: readonly number[] = [12, 20, 40, 80];

/**
 * One container's rows for one follower shape: the shape under both
 * descriptions, at both gaps, at every width.
 * @param container - the container the item stands in
 * @param entry - the follower's name and its lines
 * @returns the rows, in a stable order
 */
function followerRows(
  container: Container,
  entry: readonly [string, string],
): DescriptionRow[] {
  const [shape, follower] = entry;
  const rows: DescriptionRow[] = [];
  for (const [length, description] of FOLLOWER_DESCRIPTIONS) {
    for (const gap of FOLLOWER_GAPS) {
      for (const printWidth of FOLLOWER_WIDTHS) {
        rows.push({
          id: `follower/${container.name}/${shape}/${length}/gap${String(gap)}@${String(printWidth)}`,
          source: container.document(
            `t${container.delimiter} ${description}\n${"\n".repeat(gap)}${follower}`,
          ),
          printWidth,
        });
      }
    }
  }
  return rows;
}

/**
 * The follower grid: every follower shape under every description, at
 * both gaps, in every container, at every width.
 */
export const FOLLOWER_ROWS: readonly DescriptionRow[] = CONTAINERS.flatMap(
  (container) => FOLLOWERS.flatMap((shape) => followerRows(container, shape)),
);

/**
 * One family's rows: its rest lines under both descriptions, in the
 * first four containers, at three widths.
 * @param family - the ledger family the shape came from
 * @param restLines - the shape, as the item's rest lines
 * @returns the rows, in a stable order
 */
function gapFamilyRows(
  family: string,
  restLines: readonly string[],
): DescriptionRow[] {
  const rows: DescriptionRow[] = [];
  for (const container of CONTAINERS.slice(0, 4)) {
    for (const [length, description] of FOLLOWER_DESCRIPTIONS) {
      for (const printWidth of [12, 20, 80]) {
        rows.push({
          id: `gap/${family}/${length}@${String(printWidth)}/${container.name}`,
          source: container.document(
            `t${container.delimiter} ${description}\n${restLines.join("\n")}`,
          ),
          printWidth,
        });
      }
    }
  }
  return rows;
}

/**
 * The 32 punctuation characters the uniform-run grid repeats, and the
 * lengths it repeats them to.
 *
 * EVERY delimiter Asciidoctor opens a block on is a run of one of
 * these (asciidoctor.rb's `DELIMITED_BLOCKS`, `LAYOUT_BREAK_CHARS`
 * and `MARKDOWN_THEMATIC_BREAK_CHARS`), so the grid is the shape
 * class rather than a list of the spellings that happen to be live:
 * three of its 160 rows are render losses today (`~{4,}`, which opens
 * an OPEN block) and the rest are inert, and a later Asciidoctor that
 * gives one of the inert ones a meaning finds this row already
 * written.
 */
const RUN_CHARACTERS: readonly string[] =
  "~-_=*+.,;:!?/\\|<>'\"`^#@$%&()[]{}".match(/./gv) ?? [];

/** The run lengths the grid spells, two through six. */
const RUN_LENGTHS: readonly number[] = [2, 3, 4, 5, 6];

/**
 * The uniform-run grid: every character at every length, as the
 * description's one rest line, at a width the description wraps at.
 */
export const UNIFORM_ROWS: readonly DescriptionRow[] = RUN_CHARACTERS.flatMap(
  (character) =>
    RUN_LENGTHS.map((length) => ({
      id: `uniform/${character}/${String(length)}`,
      source: `t:: alpha bravo charlie delta\n${character.repeat(length)}\n`,
      printWidth: 20,
    })),
);

/**
 * What a description's join does about ONE family of the
 * block-structure ledger: either the family's shape written as a rest
 * line, which the grid then crosses with every container and width,
 * or the reason no rest line the reader produces can spell it.
 *
 * A union rather than an optional field, so a family cannot carry
 * both and cannot carry neither.
 */
export type GapFamilyCase =
  | {
      /** The family's shape, spelled as the item's rest lines. */
      readonly restLines: readonly string[];
    }
  | {
      /** Why no rest line the reader produces can spell it. */
      readonly unreachable: string;
    };

/**
 * One row per `gap:*` family of the block-structure ledgers - the
 * standing set of line shapes Asciidoctor opens a block on and this
 * parser reads as something else.
 *
 * WHAT THE ROWS CLAIM, exactly, because it is narrower than the table
 * looks. A row says "this family's shape does not join TODAY", and
 * nothing about WHICH clause refuses it or whether the family is
 * safe. Measured: for six of the twelve families the shape is never a
 * rest line at all - the reader records it as a BLOCK, so the run
 * predicate never sees it - and ten of the twelve are answered by a
 * clause with nothing to do with their family (`inner:: description`
 * by the separator condition, `+` and `** nested` by the word test,
 * `  literal line` by the indent). The rows are not an attribution.
 *
 * WHAT THEY ARE is a regression net keyed on a MOVING list. The gate
 * beside them (description-sweep.test.ts) asserts these keys are
 * exactly the ledgers' families, so a family added by a later
 * `bun run block-structure --write` arrives with nothing answering
 * for it and turns the gate red until somebody writes its row. That
 * catches a family the ledger has MET; a shape no ledger has met yet
 * it cannot see, which is how a `\u{2022}` bullet reached the join
 * with every grid green.
 */
export const GAP_FAMILY_CASES: Readonly<Record<string, GapFamilyCase>> = {
  // A markdown blockquote, lazy continuation included.
  "gap:md-quote": { restLines: ["> quoted", "> more"] },
  // A markdown ATX heading, with and without the closing marker.
  "gap:md-atx-heading": { restLines: ["# H", "## H ##"] },
  // A fence with more than three delimiters, which is the shape that
  // opens an OPEN block rather than a fenced one.
  "gap:md-fence-edge": { restLines: ["~~~~", "````"] },
  // A setext title: the underline is what makes the line above it a
  // heading, so the pair goes in together.
  "gap:setext-title": { restLines: ["Title", "====="] },
  // A block macro whose name no extension registered.
  "gap:block-macro-name": { restLines: ["custom::target[]"] },
  // A quoted paragraph: the attribution line is the shape that
  // remodels the paragraph above it.
  "gap:quoted-paragraph": { restLines: ['"quoted"', "-- attribution"] },
  // A styled block: the attribute line is what remodels it.
  "gap:styled-block-remodel": { restLines: ["[quote]", "[NOTE]"] },
  // A term line standing in the description of another item.
  "gap:dlist": { restLines: ["inner:: description"] },
  // An indented line, which is a literal paragraph to the oracle and
  // whose indent this parser reads as a style question.
  "gap:indent-literal-style": { restLines: ["  literal line"] },
  // A `+` under an item, which the oracle reads as a continuation.
  "gap:lazy-continuation": { restLines: ["+"] },
  // A nested list marker under prose.
  "gap:nested-list-lost": { restLines: ["** nested"] },
};

/**
 * The families whose shape is a rest line, crossed with the four
 * containers, both descriptions and three widths.
 */
export const GAP_FAMILY_ROWS: readonly DescriptionRow[] = Object.entries(
  GAP_FAMILY_CASES,
).flatMap(([family, entry]) =>
  "unreachable" in entry ? [] : gapFamilyRows(family, entry.restLines),
);

/**
 * Every marker spelling a rest line can open with, the ones this
 * registry models and the ones it does not.
 *
 * The grid exists because a MARKER is the second half of the class
 * `UNMODELLED_BLOCK_HEADS` names, and the half no shape rule reaches:
 * a marker line is letter-bearing, so the uniform-run pattern cannot
 * see it, and the gap-family gate cannot either until a ledger has
 * met one. `UnorderedListRx` (rx.rb l.284) carries a `\u{2022}` bullet
 * beside `-` and `*`, and the LOOKALIKES beside it - `\u{2043}`,
 * `\u{2219}`, `\u{00B7}` - are not in that alternation and are
 * ordinary text on both sides. Both halves are here, so a later
 * widening that swept the lookalikes in would cost a join and say so.
 */
const MARKER_LINES: readonly string[] = [
  // Modelled: the two ASCII unordered markers and their runs.
  "- item",
  "* item",
  "** item",
  "*** item",
  // Modelled: ordered, in each of the five families.
  ". item",
  ".. item",
  "1. item",
  "9. item",
  "42. item",
  "a. item",
  "z. item",
  "A. item",
  "i) item",
  "iv) item",
  "I) item",
  "X) item",
  "v) item",
  "x) item",
  // Modelled: callouts.
  "<1> item",
  "<9> item",
  "<.> item",
  // NOT modelled by the marker patterns, and live: the bullet.
  "\u{2022} item",
  "\u{2022} one\n\u{2022} two",
  // Not markers at all, and inert on both sides: the lookalikes, a
  // bullet with no space behind it, and a bullet inside a word.
  "\u{2043} item",
  "\u{2219} item",
  "\u{00B7} item",
  "\u{2022}item",
  "item \u{2022} more",
  "-item",
  "*item",
];

/** The containers and widths the marker grid crosses. */
const MARKER_WIDTHS: readonly number[] = [20, 80];

/**
 * The marker grid: every spelling as the description's rest lines, in
 * the first three containers, at both widths.
 */
export const MARKER_ROWS: readonly DescriptionRow[] = CONTAINERS.slice(
  0,
  3,
).flatMap((container) =>
  MARKER_LINES.flatMap((line, index) =>
    MARKER_WIDTHS.map((printWidth) => ({
      id: `marker/${container.name}/${String(index)}@${String(printWidth)}`,
      source: container.document(
        `t${container.delimiter} alpha bravo charlie delta\n${line}`,
      ),
      printWidth,
    })),
  ),
);

/**
 * Rows that no product spells, each one a shape a review or a probe
 * turned up. They are here rather than in the grids because each needs
 * a spelling the grids' own alphabets cannot produce.
 */
export const EDGE_ROWS: readonly DescriptionRow[] = [
  // The realistic spelling of the bracket pair, and the width sweep
  // that measured it: an `xref` whose label carries spaces.
  ...[8, 20, 40, 80, 300].map((printWidth) => ({
    id: `edge/xref-label@${String(printWidth)}`,
    source: "t:: see xref:x.adoc#p[P stylesheet section] and more\n",
    printWidth,
  })),
  // A `::` list nested in a `;;` list, and the reverse. Neither
  // delimiter is the other's sibling, so each inner term line opens a
  // list inside the outer item rather than continuing it.
  {
    id: "edge/colon-in-semicolon",
    source: "outer;; d\nt:: alpha bravo\ncharlie\n",
    printWidth: 16,
  },
  {
    id: "edge/semicolon-in-colon",
    source: "outer:: d\nt;; alpha bravo\ncharlie\n",
    printWidth: 16,
  },
  // Widths at which the TERM LINE ITSELF exceeds the budget. The
  // packer may not break between the opening and the description's
  // first word: `t::` alone on a line is a term with no inline text,
  // whose item reads greedily past a blank and swallows the block
  // under it (parser.rb:1551-1556).
  ...[4, 6, 8].map((printWidth) => ({
    id: `edge/term-over-width@${String(printWidth)}`,
    source: "loooooooooongterm:: alpha bravo\n\npara\n",
    printWidth,
  })),
  // A `//`-headed term line: the reader deletes it and restores it
  // only when a line follows, so a join is what would delete it for
  // good, and the shape must replay in every container.
  {
    id: "edge/comment-headed-term",
    source: "* a\n///b::\nc\n",
    printWidth: 80,
  },
];

/**
 * What one row did under the two questions the sweep asks.
 *
 * A row the formatter threw on carries no other answer: there is no
 * output to format again and none to render.
 */
type RowVerdict =
  | {
      /** The formatter threw on one of the two passes. */
      readonly kind: "threw";
    }
  | {
      /** Both passes ran. */
      readonly kind: "formatted";
      /** Whether the second pass changed the first pass's output. */
      readonly unstable: boolean;
      /** Whether the oracle renders the output unlike the source. */
      readonly renderUnequal: boolean;
    };

/**
 * Format a row, then format the result - or nothing at all when either
 * call threw. A helper rather than two mutable bindings in the caller:
 * it keeps the `try` around exactly the two formatter calls, so a
 * throw from the ORACLE below is not swallowed as a formatter failure.
 * @param row - the row to format
 * @param options - the Prettier options both passes run under
 * @param options.printWidth - the row's own column budget
 * @returns the once- and twice-formatted texts, or undefined on a throw
 */
async function formatTwice(
  row: DescriptionRow,
  options: { printWidth: number },
): Promise<{ once: string; twice: string } | undefined> {
  try {
    const once = await formatAdoc(row.source, options);
    return { once, twice: await formatAdoc(once, options) };
  } catch {
    return undefined;
  }
}

/**
 * Format one row twice and judge it.
 *
 * The oracle is consulted only where the formatter changed BYTES:
 * byte-identical output is render-equal by definition, and that is
 * what keeps the grids' wall time proportional to the rows that
 * actually move.
 * @param row - the row to judge
 * @returns its verdict
 */
async function rowVerdict(row: DescriptionRow): Promise<RowVerdict> {
  const options = { printWidth: row.printWidth };
  const passes = await formatTwice(row, options);
  if (passes === undefined) {
    return { kind: "threw" };
  }
  const { once, twice } = passes;
  if (once === row.source) {
    return {
      kind: "formatted",
      unstable: twice !== once,
      renderUnequal: false,
    };
  }
  const [formatted, original] = await Promise.all([
    renderedHtml(once),
    renderedHtml(row.source),
  ]);
  return {
    kind: "formatted",
    unstable: twice !== once,
    renderUnequal: formatted !== original,
  };
}

/**
 * Sweep a grid and report what failed, one line per failing row so a
 * failure names the row AND what it failed.
 * @param rows - the grid to sweep
 * @returns the failures, in the grid's own order
 */
export async function sweepFailures(
  rows: readonly DescriptionRow[],
): Promise<string[]> {
  const failures: string[] = [];
  for (const row of rows) {
    // Sequential on purpose: hundreds of concurrent Prettier and
    // Asciidoctor runs would exhaust memory, and the oracle is the
    // wall time here.
    // eslint-disable-next-line no-await-in-loop -- sequential on purpose
    const verdict = await rowVerdict(row);
    if (verdict.kind === "threw") {
      failures.push(`${row.id}: threw`);
      continue;
    }
    if (verdict.unstable) {
      failures.push(`${row.id}: not a fixed point`);
    }
    if (verdict.renderUnequal) {
      failures.push(`${row.id}: renders differently`);
    }
  }
  return failures;
}
