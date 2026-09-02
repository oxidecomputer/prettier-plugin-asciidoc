/**
 * Four generated document domains, each spelling a shape class the
 * list-shape sweep's own product cannot.
 *
 * The sweep's alphabet has no hard-break line and no symbol that spans
 * two source lines. So its product contains no document in which a
 * ` +` decides whether a line break survives, and none in which an
 * inline construct opens on one source line and closes on the next.
 * Those are exactly the lines the printer's reflow hold rules are
 * decided by: a change to them can move thousands of documents while
 * the sweep, the reading ledger and the whole population report zero
 * movement. Each domain below is one of those blind spots, spelled
 * exhaustively rather than sampled.
 *
 * Each is the depth-1-to-3 product over its own alphabet under two
 * prefixes: a one-line item, and the same item with a second text
 * line, which is the shorter of the two shapes reflow can move. The
 * second prefix is the first plus the alphabet's FIRST symbol, so the
 * two products overlap by construction - a document reachable both
 * ways is one document, and the deduplication is a property of the
 * definition rather than an accident of the strings.
 *
 * Three of the domains also carry named witnesses: documents whose
 * exact spelling matters and whose lines are not all alphabet symbols.
 * A witness the product already spells is not counted twice, which is
 * why the pinned sizes are not the product size plus the witness
 * count.
 */
import { ALPHABET } from "../../tests/format/list-shape-sweep.js";

/** How many symbols the longest body of a domain's product spells. */
const DEPTH = 3;

/** The marker line every generated document opens with. */
const ITEM = "* a";

/**
 * The sweep alphabet's plain-text line.
 *
 * It leads every alphabet here, which makes it the line the second
 * prefix adds: an item whose text is two lines, the smallest shape
 * whose reflow can join or refuse to join anything at all.
 */
const ITEM_TEXT = "para";

/** A hard-break line: the one the sweep's alphabet does not carry. */
const HARD_BREAK = " +";

/** A line comment, which Ruby drops from an item's text block. */
const COMMENT = "// c";

/** An indented line, which alone can make a whole block literal. */
const LITERAL = "  lit";

/** A blank line, which ends an item's principal text. */
const BLANK = "";

/**
 * Lines that OPEN with an inline construct and carry text after it.
 *
 * A line a construct opens is the case where the text that follows
 * the construct begins with the separator space, so anything reading
 * the line's leading bytes off a fragment rather than off the line
 * sees an indent that the source does not have.
 */
const OPENING_LINES = [
  "*b* tail",
  "https://e.com[x] tail",
  "`c` tail",
  "mailto:a@b.c[a] tail",
] as const;

/**
 * Constructs broken across TWO source lines, opening at column 0 or
 * indented, closing at column 0 or indented - but never both indented,
 * which is {@link INDENTED_TWO_LINE_CONSTRUCTS}'s combination.
 *
 * Each is one symbol that occupies two lines, so a body of three
 * symbols can be six lines long. The four constructs are the ones
 * whose interior may hold a newline: a formatting span, a monospace
 * span, a link macro and a passthrough.
 */
const TWO_LINE_CONSTRUCTS = [
  "*b\nc* d",
  "*b\n  c* d",
  "`b\nc` d",
  "`b\n  c` d",
  "  https://e.com[b\nc] d",
  "https://e.com[b\n  c] d",
  "  +++b\nc+++ d",
  "+++b\n  c+++ d",
] as const;

/**
 * Constructs across two source lines with BOTH lines indented.
 *
 * The combination none of the other three domains spells, and the one
 * where the two directions of error meet: a reader that takes the
 * continuation for a column-0 line cancels a block's indent strip,
 * and one that takes an unindented continuation for an indented line
 * applies a strip the source did not ask for.
 */
const INDENTED_TWO_LINE_CONSTRUCTS = [
  "  *b\n  c* d",
  "  `b\n  c` d",
  "  https://e.com[b\n  c] d",
  "  mailto:a@b.c[b\n  c] d",
  "  +++b\n  c+++ d",
  "  #b\n  c# d",
] as const;

/**
 * Documents whose exact spelling is the point, carried alongside the
 * products that cannot spell them.
 *
 * Each is a shape where a reading depends on a line the product's
 * alphabet does not contain - an escaped mark, an attribute or
 * character reference, a construct nested inside another across a
 * line, an item whose marker line already carries text. They ride
 * with three of the four domains rather than one, because the classes
 * they belong to are decided by the same rules the domains sweep.
 */
const WITNESSES = [
  // A line an inline construct opens, above a hard break, with an
  // indented line under it: the indent question asked of a line whose
  // leading bytes belong to a construct rather than to text.
  "* a\n*b* tail\n +\n  lit\n",
  // The same question with nothing but an indented line to ask it of.
  "* a\n  lit\n +\n",
  // A marker line that already carries text, so the item's first
  // source line is not the marker's own share alone.
  "* a see\nmailto:a@b.c[a] [x]\n +\n",
  // An ESCAPED mark: two lines that look like a span and are not.
  "* a\n  \\*b*\nc d\n +\n",
  // An attribute reference, which the reader resolves and the source
  // spells in bytes of its own.
  "* a\n  {attr} b\nc d\n +\n",
  // A character reference, likewise.
  "* a\n  &amp; b\nc d\n +\n",
  // A hard break INSIDE a span that closes on the next line.
  "* a\n  *b +\nc* d\n +\n",
  // A span nested inside a span, the pair broken across two lines.
  "* a\n  *b `q\nr` s* d\n +\n",
  // A two-line passthrough, both lines indented, above a comment and
  // a hard break: the comment is not in the text block at all, so the
  // indent question must skip it.
  "* a\n  +++b\n  c+++ d\n// c\n +\n",
  // The same shape with a link macro, whose interior holds the break.
  "* a\n  https://e.com[b\n  c] d\n// c\n +\n",
  // And both of those without the comment line, where the hard break
  // stands directly under the construct's closing line.
  "* a\n  https://e.com[b\n  c] d\n +\n",
  "* a\n  mailto:a@b.c[b\n  c] d\n +\n",
  // A line an inline construct opens, directly above a run of block
  // metadata. No alphabet here can spell the pair: the metadata lines
  // and the construct-opening lines are in different alphabets, and
  // the hazard rule that decides whether a metadata run needs a break
  // is asked of exactly this neighbourhood.
  "* a\n*b* tail\n[role]\npara\n** b\n",
  "* a\nhttps://e.com[x] tail\n[[anc]]\npara\n +\n",
  // Two-line constructs whose lines are NOT both indented, for the
  // two kinds the both-indented alphabet is the only one to carry: a
  // mail macro broken at column 0, and a highlight span whose
  // continuation alone is indented.
  "* a\nmailto:a@b.c[b\nc] d\n +\n",
  "* a\n#b\n  c# d\n +\n",
] as const;

/**
 * The name of one domain, as the command line spells it. Not
 * exported: a caller selects a domain through {@link probeDomain},
 * which is what keeps an unknown name a reported condition rather
 * than a compile-time one nobody types.
 */
type ProbeDomainName =
  | "hard-break"
  | "inline-opening"
  | "two-line-construct"
  | "indented-two-line";

/** One domain: an alphabet, its witnesses, and the size it spells. */
export interface ProbeDomain {
  /** How the command line names it. */
  readonly name: ProbeDomainName;
  /** The shape class it spells, for the report. */
  readonly what: string;
  /**
   * The alphabet. The FIRST symbol is the line the second prefix
   * adds, which is what makes the two prefixes' products overlap.
   */
  readonly symbols: readonly [string, ...string[]];
  /** Documents carried beside the product, deduplicated into it. */
  readonly witnesses: readonly string[];
  /**
   * How many distinct documents it spells.
   *
   * Pinned rather than measured: every count this domain produces is
   * a count OUT of it, and two runs are comparable only while the
   * denominator is the same. A generator that quietly spelled one
   * document fewer would move the bar instead of failing.
   */
  readonly size: number;
}

/** How many distinct documents each domain spells. */
const HARD_BREAK_SIZE = 2794;
const INLINE_OPENING_SIZE = 3626;
const TWO_LINE_SIZE = 3628;
const INDENTED_TWO_LINE_SIZE = 2122;

/** The four domains, in the order the report prints them. */
export const PROBE_DOMAINS: readonly ProbeDomain[] = [
  {
    name: "hard-break",
    what: "the sweep's own alphabet with a hard-break line in it",
    symbols: [
      ITEM_TEXT,
      ...ALPHABET.filter((symbol) => symbol !== ITEM_TEXT),
      HARD_BREAK,
    ],
    witnesses: [],
    size: HARD_BREAK_SIZE,
  },
  {
    name: "inline-opening",
    what: "lines an inline construct opens, beside a hard-break line",
    symbols: [
      ITEM_TEXT,
      ITEM,
      "** b",
      "+",
      BLANK,
      LITERAL,
      COMMENT,
      HARD_BREAK,
      ...OPENING_LINES,
    ],
    witnesses: WITNESSES,
    size: INLINE_OPENING_SIZE,
  },
  {
    name: "two-line-construct",
    what: "constructs broken across two source lines",
    symbols: [ITEM_TEXT, BLANK, COMMENT, HARD_BREAK, ...TWO_LINE_CONSTRUCTS],
    witnesses: WITNESSES,
    size: TWO_LINE_SIZE,
  },
  {
    name: "indented-two-line",
    what: "constructs across two source lines with both lines indented",
    symbols: [
      ITEM_TEXT,
      BLANK,
      COMMENT,
      HARD_BREAK,
      ...INDENTED_TWO_LINE_CONSTRUCTS,
    ],
    witnesses: WITNESSES,
    size: INDENTED_TWO_LINE_SIZE,
  },
];

/**
 * The domain one name selects.
 * @param name - the word after `--domain`
 * @returns the domain, or undefined when no domain has that name
 */
export function probeDomain(name: string): ProbeDomain | undefined {
  return PROBE_DOMAINS.find((domain) => domain.name === name);
}

/**
 * Every document one domain spells: the exhaustive product under both
 * prefixes, then its witnesses, deduplicated.
 * @param domain - the domain to spell
 * @returns the distinct documents, product first, in generation order
 */
export function probeDocuments(domain: ProbeDomain): string[] {
  const documents: string[] = [];
  const [continuation] = domain.symbols;
  for (const prefix of [`${ITEM}\n`, `${ITEM}\n${continuation}\n`]) {
    const grow = (lines: readonly string[], remaining: number): void => {
      for (const symbol of domain.symbols) {
        const next = [...lines, symbol];
        documents.push(`${prefix}${next.join("\n")}\n`);
        if (remaining > 1) {
          grow(next, remaining - 1);
        }
      }
    };
    grow([], DEPTH);
  }
  return [...new Set([...documents, ...domain.witnesses])];
}
