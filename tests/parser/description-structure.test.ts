/**
 * The description-list node kinds, against the oracle's own model.
 *
 * Every row reads what `parse` built: a term line opens a description
 * list in the reader, so the scan, the confined read and the builder
 * all run behind one call and this suite compares their result rather
 * than re-driving their parts.
 *
 * The inter-term partition rule is NOT here. It is asserted over the
 * whole item, and over the whole corpus rather than the lists these
 * rows reach, by
 * `expectDescriptionPartition` (tests/parser/ast-invariants-
 * description.ts), which is the stronger statement of the same
 * contract: every source line of an item belongs to exactly one of a
 * term line, a term gap and the text image.
 *
 * The oracle side is `load` rather than `convert`: a dlist item is the
 * `[[terms], description-or-nil]` pair `parse_list_item` returns
 * (parser.rb:1387), and the rendered `<dt>`/`<dd>` pair cannot say
 * which terms belong to one item.
 *
 * What the corpus rows below ask, and what they do not: delimiter,
 * item count, terms per item, each term's own bytes, and whether the
 * body is empty. NOT what an item's body is made OF - a nested list
 * at the index the oracle reports it, and the split of a body into
 * text and blocks - because those are the confined read's answers and
 * belong with the reader's own rows.
 *
 * THE POPULATION, so a later run can tell a corpus change from a
 * regression: the term-line prefilter admits 174 corpus cases, 170 of
 * them carry a description list, and those hold 217 lists, of which
 * 16 are excluded by the four named families and 201 compared. Every
 * one of those numbers is pinned below except the 174 and the 170,
 * which move with the corpus and are recorded here rather than
 * asserted.
 */
import { describe, expect, test } from "vitest";
import type {
  BlockNode,
  DescriptionListItemNode,
  DescriptionListNode,
  ItemBlock,
  ListItemNode,
} from "../../src/ast.js";
import type { ItemBodyInput } from "../../src/parse/build/list.js";
import { buildDescriptionListItem } from "../../src/parse/build/description-list.js";
import { tokenizeWholeText } from "../../src/parse/inline/tokenize.js";
import { isDescriptionListLine } from "../../src/parse/line-shapes.js";
import { makeLocationIndex } from "../../src/parse/positions.js";
import { parse } from "../../src/parser.js";
import { expectAstInvariants } from "./ast-invariants.js";
import { preorder } from "./ast-walk.js";
import { loadCorpus, type CorpusCase } from "../conformance/loader.js";
import {
  narrow,
  oracleDescriptionList,
  type OracleDescriptionList,
} from "../helpers.js";

/**
 * Every description list the document holds, in document order, the
 * ones inside another item's blocks included.
 *
 * TOTAL over the block kinds that can hold a block: an item's
 * `blocks` (both item kinds share the field), a parent block's and an
 * admonition's `children`, and the document's own. Written as a
 * typed walk rather than over the structural one so the rows below
 * read real nodes; the row that compares its count against
 * {@link preorder}'s is what stops a later block kind from carrying a
 * list this walk cannot see.
 * @param blocks - the blocks to search, in source order
 * @returns the lists, each before the ones nested inside it
 */
function listsIn(blocks: readonly BlockNode[]): DescriptionListNode[] {
  return blocks.flatMap((block) => {
    switch (block.type) {
      case "descriptionList": {
        return [block, ...block.children.flatMap((item) => listsInItem(item))];
      }
      case "list": {
        return block.children.flatMap((item) => listsInItem(item));
      }
      case "parentBlock":
      case "admonition": {
        return listsIn(block.children);
      }
      default: {
        return [];
      }
    }
  });
}

/**
 * The same, for one item's blocks.
 * @param item - a marker item or a description item
 * @returns the lists its blocks hold
 */
function listsInItem(
  item: ListItemNode | DescriptionListItemNode,
): DescriptionListNode[] {
  return listsIn(item.blocks.map((entry: ItemBlock) => entry.block));
}

/**
 * Every description list `parse` builds for a document.
 * @param source - the whole document
 * @returns the lists, in document order
 */
function ourDescriptionLists(source: string): DescriptionListNode[] {
  return listsIn(parse(source).children);
}

/**
 * The list that opens on a given source line, or nothing where none
 * does.
 * @param source - the whole document
 * @param line - the 1-based line the list is expected to open on
 * @returns the list, or undefined
 */
function ourDescriptionListAt(
  source: string,
  line: number,
): DescriptionListNode | undefined {
  return ourDescriptionLists(source).find(
    (list) => list.position.start.line === line,
  );
}

/**
 * The first description list of a document that opens with one.
 * @param source - the document
 * @returns its first list
 */
function ourDescriptionList(source: string): DescriptionListNode {
  const [list] = ourDescriptionLists(source);
  // An explicit throw rather than a cast, the same way tests/helpers.ts
  // narrows a document's first child: a fixture that stops holding a
  // list is a setup error, and it should say so here.
  narrow(list, "descriptionList");
  return list;
}

/** A body with nothing in it, for the builder rows below. */
const EMPTY_BODY: ItemBodyInput = {
  text: [],
  blocks: [],
  trailingContinuation: false,
  detachedTail: false,
  activeTail: false,
  everyTextLineIndented: false,
};

describe("one description item, built directly", () => {
  // An item's span runs from its FIRST term to whatever its body ends
  // on, so a body-less item ends on its LAST term rather than on the
  // one that opened it.
  test("a term-only item spans its first term to its last", () => {
    const source = "a::\nb::\n";
    const at = makeLocationIndex(source);
    const [read] = ourDescriptionList(source).children;
    const item = buildDescriptionListItem(
      {
        terms: read.terms,
        body: EMPTY_BODY,
        textLines: [],
        printing: "replay",
      },
      at,
    );
    expect(item.terms).toHaveLength(2);
    expect(item.position.start.offset).toBe(0);
    expect(item.position.end.offset).toBe(
      read.terms[1].term.position.end.offset,
    );
    expect(item.text).toEqual([]);
    expect(item.printing).toBe("replay");
  });

  // With text the span ends on the text instead, which is what makes
  // the term-only case above a fallback rather than the rule.
  test("an item with text ends on its text", () => {
    const source = "a:: x\n";
    const at = makeLocationIndex(source);
    const [read] = ourDescriptionList(source).children;
    const item = buildDescriptionListItem(
      {
        terms: read.terms,
        body: {
          ...EMPTY_BODY,
          text: tokenizeWholeText("x", source.indexOf("x")),
        },
        textLines: read.textLines,
        printing: "reflow",
      },
      at,
    );
    expect(item.position.end.offset).toBe(source.indexOf("x") + 1);
    expect(item.printing).toBe("reflow");
  });
});

/**
 * The gap alphabet, crossed with the containers a folded term run can
 * stand in, held to the PARTITION invariant.
 *
 * The invariant is `expectDescriptionPartition`'s (see this file's
 * header): every source line of an item belongs to exactly one of a
 * term line, a term gap and the text image, and the three write the
 * region back exactly as the SOURCE has it. That is the one check
 * that can see a gap line whose bytes an enclosing read rewrote, and
 * the reason it is driven from here is that nothing else drives it
 * over this coordinate: the corpus has no member of it and the shape
 * sweeps spell no term line.
 *
 * WHAT IT CAUGHT, and what a later change would hit again: a marker
 * item's read ERASES a `+` it activated (parser.rb:1439, :1576) and
 * leaves the line blank in the copy the description scan reads, so a
 * gap spelled from that copy recorded a blank where the author wrote
 * a `+`. The byte went, the render did not move, and the document
 * stopped being a fixed point. The gap is spelled from the line's RAW
 * bytes for that reason (src/parse/lines/description-list-node.ts),
 * and these rows are what keeps the two readings in agreement.
 */
describe("a folded term run writes its own gap back", () => {
  // A run of two or more blanks between two folded term lines. Inside
  // a marker item's interior the enclosing read keeps ONE blank and
  // lets `skip_blank_lines` eat the rest (parser.rb l.1515-17), so
  // these lines reach the description scan only through the
  // document-wide separator record; before that record was read here
  // the gap said one line where the source wrote three, and the
  // sibling spanned five source lines while writing three.
  const SURPLUS_BLANKS: readonly string[] = ["", "", ""];

  const GAPS: ReadonlyArray<readonly string[]> = [
    [],
    [""],
    ["+"],
    ["", "+"],
    ["+", ""],
    ["", "+", ""],
    ["+", "+"],
    ["//c"],
    ["///c"],
    ["", "//c"],
    ["//c", "+"],
    SURPLUS_BLANKS,
  ];

  // One container per kind of read that can stand above the list. The
  // four marker kinds are separate rows because each has its own
  // continuation arm, and the erasure that motivated these rows is
  // the marker read's.
  const CONTAINERS: ReadonlyArray<readonly [string, (body: string) => string]> =
    [
      ["at document level", (body) => `${body}\n`],
      ["behind a * item's +", (body) => `* item\n+\n${body}\n`],
      ["behind a . item's +", (body) => `. item\n+\n${body}\n`],
      ["behind a - item's +", (body) => `- item\n+\n${body}\n`],
      ["behind a <1> item's +", (body) => `<1> item\n+\n${body}\n`],
      ["adjacent inside a * item", (body) => `* item\n${body}\n`],
      ["behind a description's own +", (body) => `outer:: d\n+\n${body}\n`],
      ["nested under a description", (body) => `outer:: d\n${body}\n`],
      ["inside an open block", (body) => `--\n${body}\n--\n`],
      ["inside an example block", (body) => `====\n${body}\n====\n`],
    ];

  for (const [name, wrap] of CONTAINERS) {
    test(`${name}, over the whole gap alphabet`, () => {
      for (const gap of GAPS) {
        const inner = name.startsWith("nested") ? ":::" : "::";
        expectAstInvariants(
          wrap([`a${inner}`, ...gap, `b${inner} y`].join("\n")),
        );
      }
    });
  }

  // The same spelling read off the recorded gap rather than off the
  // partition, so the row says WHAT is recorded and not only that the
  // region writes back. Both containers keep every blank: at document
  // level the scan is handed all of them, and inside a marker item's
  // interior the ones it consumed come back off the separator record.
  test.each([
    ["at document level, every blank is kept", "", ["", "", ""]],
    ["inside a * item's +, every blank is kept", "* item\n+\n", ["", "", ""]],
  ])("%s", (_name, prefix, kept) => {
    const source = `${prefix}${["a::", ...SURPLUS_BLANKS, "b:: y"].join("\n")}\n`;
    const [item] = ourDescriptionList(source).children;
    expect(item.terms[0].gap).toEqual(kept);
  });
});

describe("the term fold, against the oracle's pairs", () => {
  // parser.rb:1230-1235: parse_description_list keeps the pair open
  // while its description half is nil and appends the next term to the
  // SAME pair, so a run of term-only items folds onto the next item
  // that has a body.
  test("a run of textless terms folds onto the next item's pair", async () => {
    const source = "a::\nb::\nc:: shared\n";
    const [list] = await oracleDescriptionList(source);
    expect(list.items).toHaveLength(1);
    expect(list.items[0].terms).toEqual(["a", "b", "c"]);
    expect(ourDescriptionList(source).children[0].terms).toHaveLength(3);
  });

  // parser.rb:1387: the pair carries nil where the item has neither
  // text nor blocks, which is the empty body here. Reachable only on
  // the LAST item, because any earlier one would have absorbed the
  // next term.
  test("a trailing textless term is one item with an empty body", async () => {
    const source = "d:: x\ne::\n";
    const [list] = await oracleDescriptionList(source);
    expect(list.items[1].text).toBeNull();
    const [, last] = ourDescriptionList(source).children;
    expect(last.text).toEqual([]);
    expect(last.blocks).toEqual([]);
  });

  // The lines between two folded term lines belong to the item and to
  // no term's text, so they ride on the FIRST term's gap.
  test("a line between two folded terms lands in the first term's gap", async () => {
    const source = "t::\n///c\nu:: x\n";
    const [list] = await oracleDescriptionList(source);
    expect(list.items[0].terms).toEqual(["t", "u"]);
    const [item] = ourDescriptionList(source).children;
    expect(item.terms[0].gap).toEqual([{ comment: "///c" }]);
    expect(item.terms[1].gap).toEqual([]);
  });

  // A `+` between two term lines gives the sibling no body: the read
  // loop buffers that line (parser.rb:1557-1559) and the post-loop pop
  // drops the same line (parser.rb:1580-1582), so the fold rolls
  // straight over the sibling and REPLACES its body with the next
  // one's. The byte's only home is therefore the gap.
  //
  // Red before the routing this row pins: the scan reports the popped
  // `+` as the sibling's `trailingContinuation`, the sibling's body
  // carried it, and `withTerm` threw that body away - so `gap` came
  // back `[]`, the partition lost a line, and a byte the oracle keeps
  // rendering disappeared with no render bar able to see it.
  test.each([
    ["a bare +", "a::\n+\nb:: y\n", ["+"]],
    ["a blank then a +", "a::\n\n+\nb:: y\n", ["", "+"]],
  ])(
    "%s between two folded terms rides the first term's gap",
    async (_name, source, gap) => {
      const [list] = await oracleDescriptionList(source);
      expect(list.items).toHaveLength(1);
      expect(list.items[0].terms).toEqual(["a", "b"]);
      const [item] = ourDescriptionList(source).children;
      expect(item.terms[0].gap).toEqual(gap);
      // The byte is in the gap and NOT on the body, which is what lets
      // the fold replace an absorbed sibling's body wholesale.
      expect(item.trailingContinuation).toBe(false);
      expect(item.detachedTail).toBe(false);
      expect(item.activeTail).toBe(false);
    },
  );

  // The four delimiters rx.rb:336 spells, each opening a list of its
  // own at document level with two items under it. The corpus reaches
  // all four now that a nested list is compared like any other - the
  // 201 comparable lists split `:: 177`, `::: 16`, `:::: 2`, `;; 6` -
  // so these rows are the four-way statement of the sibling pattern
  // rather than the only reach the two rare spellings get.
  test.each([["::"], [":::"], ["::::"], [";;"]])(
    "a list opened on %s reports that delimiter and its two items",
    async (delimiter) => {
      const source = `a${delimiter} x\nb${delimiter} y\n`;
      const [list] = await oracleDescriptionList(source);
      expect(list.delimiter).toBe(delimiter);
      const ours = ourDescriptionList(source);
      expect(ours.delimiter).toBe(delimiter);
      expect(ours.children).toHaveLength(list.items.length);
    },
  );
});

// ---------------------------------------------------------------------------
// The corpus, against the oracle's own model
// ---------------------------------------------------------------------------

/**
 * A preprocessor line anywhere in a document. The oracle's `sourcemap`
 * line numbers count the PREPROCESSED stream, so once a directive has
 * added or removed a line the list's reported line is not the
 * document's own and the scan would be started somewhere else
 * entirely.
 */
const PREPROCESSOR_LINE = /^(?:ifdef|ifndef|ifeval|endif|include)::/mv;

/** One corpus case, with the group it came from. */
interface DescriptionCase extends CorpusCase {
  /** Which corpus file this case came from. */
  readonly group: string;
}

/**
 * Whether a case can hold a description list at all: some line of it
 * is one the registry reads as a term line. A SUPERSET of the
 * dlist-bearing cases, because the oracle opens a description list
 * only where such a line stands, so the filter can drop a case
 * without dropping a comparison - and dropping the rest keeps this
 * suite from loading 1,600 documents to find 170.
 * @param input - the case's source
 * @returns true when some line could open a description list
 */
function couldHoldTerms(input: string): boolean {
  return input.split("\n").some((line) => isDescriptionListLine(line));
}

const ALL_CASES: DescriptionCase[] = loadCorpus().flatMap((group) =>
  group.cases
    .filter((entry) => couldHoldTerms(entry.input))
    .map((entry) => ({ ...entry, group: group.name })),
);

/**
 * The named reason categories this suite declines to compare a list
 * for. Every count below is a count of LISTS, the same unit
 * {@link COMPARABLE} is measured in, so the two add up to one
 * population.
 *
 * `oracle-threw` is pinned EMPTY rather than merely small: the one
 * corpus case whose load fails outright carries no term line and so
 * never reaches this classification at all. It is also the one family
 * whose row would count a CASE rather than a list, there being no
 * model to count lists in, and the empty pin is what keeps the unit
 * unambiguous rather than merely unlikely.
 *
 * The other two families are each pinned at their measured size, and
 * small enough that the pin names its members:
 *
 * - `no-list-read` is EMPTY. Its one member was
 *   `sections_test.rb#should not match a heading in a description
 *   list`, whose `-------` is a setext section title: the reader used
 *   to take it for a listing delimiter, which put every term line
 *   below it inside a verbatim block and left no list to compare.
 *   The reader reads the setext title now (issue #16) and the case is
 *   compared like any other. The family is KEPT with an empty pin
 *   rather than deleted: a list this suite cannot read at all is the
 *   regression the pin watches for, and 0 is the number that fails on
 *   the first one.
 * - `oracle-line-not-a-term-line` is TWO, both lists inside another
 *   item. `sourcemap` reports such a list at the line its ENCLOSING
 *   item's buffer opens on, which is the blank or block-attribute
 *   line above the first term rather than the term line itself, so
 *   there is no line to pair the two reads on. The reader builds the
 *   list; this suite cannot name it.
 *
 * There is no `nested` family. A list inside another list's item is
 * bounded by that item's buffer, which the confined read supplies and
 * the reader performs: 26 corpus lists once excluded on it are now
 * compared like any other, and the two above are held out for the
 * sourcemap reason instead.
 */
type ExclusionFamily =
  | "preprocessor"
  | "oracle-threw"
  | "oracle-logged"
  | "no-list-read"
  | "oracle-line-not-a-term-line";

/** One list this suite declined to compare, and why. */
interface ExcludedList {
  /** Node discriminant. */
  readonly kind: "excluded";
  /** The corpus case id, `#N` suffixed for a multi-list case. */
  readonly id: string;
  /** Which corpus file this case came from. */
  readonly group: string;
  /** The named category this exclusion belongs to. */
  readonly family: ExclusionFamily;
  /** Why it was excluded, naming the issue it belongs to. */
  readonly reason: string;
}

/** One list, scanned, built and ready for straight-line assertions. */
interface ComparableList {
  /** Node discriminant. */
  readonly kind: "comparable";
  /** The corpus case id, `#N` suffixed for a multi-list case. */
  readonly id: string;
  /** Which corpus file this case came from. */
  readonly group: string;
  /** The document, for reading a term's own bytes back. */
  readonly source: string;
  /** What the scan and the builder made of it. */
  readonly ours: DescriptionListNode;
  /** The oracle's own structural read of the same list. */
  readonly oracle: OracleDescriptionList;
}

/**
 * Label one of a case's lists: the case's own id when it holds a
 * single list, `#N` appended in document order when it holds more.
 * @param entry - the corpus case
 * @param index - the list's index in document order
 * @param total - how many lists the case holds
 * @returns the label
 */
function labelOf(entry: DescriptionCase, index: number, total: number): string {
  return total > 1 ? `${entry.id}#${String(index)}` : entry.id;
}

/**
 * The oracle's own read, or undefined where it could not load the
 * document at all - a backend its build carries no converter for is
 * the one shape in the corpus that does that, and it is a fact about
 * the oracle rather than about the document's description lists.
 * @param input - the case's source
 * @returns every description list it found, or undefined on a throw
 */
async function oracleOrNothing(
  input: string,
): Promise<OracleDescriptionList[] | undefined> {
  try {
    return await oracleDescriptionList(input);
  } catch {
    return undefined;
  }
}

/**
 * Classify every description list one corpus case holds: excluded
 * with a reason, or scanned, built and paired with the oracle's own
 * read. Every branch RETURNS rather than falling through, so no later
 * step runs after an earlier one has decided a list's fate.
 * @param entry - the corpus case
 * @returns one classification per list the oracle found, and nothing
 *   at all for a case that carries none
 */
async function classify(
  entry: DescriptionCase,
): Promise<Array<ExcludedList | ComparableList>> {
  const { id, group, input } = entry;
  const oracle = await oracleOrNothing(input);
  if (oracle === undefined) {
    return [
      {
        kind: "excluded",
        id,
        group,
        family: "oracle-threw",
        reason:
          "the oracle could not load the document at all, so there is no model to compare against (issue #7)",
      },
    ];
  }
  if (oracle.length === 0) {
    return [];
  }
  if (PREPROCESSOR_LINE.test(input)) {
    // One row per LIST, not per case: the oracle's read is already in
    // hand here, and a count that mixed cases with lists would be a
    // number in two units.
    return oracle.map((list, index) => ({
      kind: "excluded" as const,
      id: labelOf(entry, index, oracle.length),
      group,
      family: "preprocessor" as const,
      reason:
        "a preprocessor line stands in the document, so the oracle's sourcemap counts a stream this document's own lines are not (issue #107)",
    }));
  }
  return oracle.map((list, index) => {
    const label = labelOf(entry, index, oracle.length);
    if (list.severities.length > 0) {
      return {
        kind: "excluded",
        id: label,
        group,
        family: "oracle-logged",
        reason: `the oracle's own read logged a message (${list.severities.join(", ")}), so the model it built is not the document's (issue #7)`,
      };
    }
    const ours = ourDescriptionListAt(input, list.line);
    if (ours === undefined) {
      const reported = input.split("\n")[list.line - 1] ?? "";
      return isDescriptionListLine(reported)
        ? {
            kind: "excluded",
            id: label,
            group,
            family: "no-list-read",
            reason:
              "the reader builds no description list on the term line the oracle opened one on (issue #16)",
          }
        : {
            kind: "excluded",
            id: label,
            group,
            family: "oracle-line-not-a-term-line",
            reason:
              "the line the oracle's sourcemap reports is not a term line: a list inside another item is reported at the line that item's buffer opens on, so there is no line to pair the two reads on (issue #107)",
          };
    }
    return {
      kind: "comparable",
      id: label,
      group,
      source: input,
      ours,
      oracle: list,
    };
  });
}

const CLASSIFIED_BY_CASE = await Promise.all(ALL_CASES.map(classify));
const CLASSIFIED = CLASSIFIED_BY_CASE.flat();
const EXCLUDED = CLASSIFIED.filter(
  (one): one is ExcludedList => one.kind === "excluded",
);
const COMPARABLE = CLASSIFIED.filter(
  (one): one is ComparableList => one.kind === "comparable",
);

/**
 * How many lists {@link EXCLUDED} carries per family.
 * @returns the per-family counts
 */
function excludedCountsByFamily(): Record<ExclusionFamily, number> {
  const counts: Record<ExclusionFamily, number> = {
    preprocessor: 0,
    "oracle-threw": 0,
    "oracle-logged": 0,
    "no-list-read": 0,
    "oracle-line-not-a-term-line": 0,
  };
  for (const one of EXCLUDED) {
    counts[one.family] += 1;
  }
  return counts;
}

/**
 * Which lists one family holds, by the label {@link labelOf} computes.
 * @param family - the family to list
 * @returns its members' ids, sorted
 */
function membersOf(family: ExclusionFamily): string[] {
  return EXCLUDED.filter((one) => one.family === family)
    .map((one) => one.id)
    .toSorted();
}

describe("description-list structure vs the oracle", () => {
  test.each(COMPARABLE)("$group: $id", (comparable) => {
    const { id, source, ours, oracle } = comparable;

    // Item count and delimiter: how many pairs the fold made, and the
    // spelling the sibling pattern is keyed on.
    expect(ours.children.length, `${id}: item count`).toBe(oracle.items.length);
    expect(ours.delimiter, `${id}: delimiter`).toBe(oracle.delimiter);

    // Term grouping, then each term's own bytes: the direct pin of the
    // fold at parser.rb:1230-1235.
    expect(
      ours.children.map((item) => item.terms.length),
      `${id}: terms per item`,
    ).toEqual(oracle.items.map((item) => item.terms.length));
    for (const [index, item] of ours.children.entries()) {
      const label = `${id}: item ${String(index)}`;
      expect(
        item.terms.map((entry) =>
          source.slice(
            entry.term.position.start.offset,
            entry.term.position.end.offset,
          ),
        ),
        `${label} term text`,
      ).toEqual(oracle.items[index].terms);

      // Body presence: our empty body against the oracle's nil half,
      // which is `text? || blocks?` read the other way (parser.rb:1387)
      // and so is a null text AND no blocks, not a null text alone.
      const oracleItem = oracle.items[index];
      expect(
        item.text.length === 0 && item.blocks.length === 0,
        `${label} body presence`,
      ).toBe(oracleItem.text === null && oracleItem.blockCount === 0);
    }
  });

  test("exclusion counts are pinned per family", () => {
    const counts = excludedCountsByFamily();
    expect(counts, JSON.stringify(counts, undefined, 2)).toEqual({
      preprocessor: 11,
      "oracle-threw": 0,
      "oracle-logged": 2,
      "no-list-read": 0,
      "oracle-line-not-a-term-line": 2,
    });
  });

  // The two families that carry a per-member NARRATIVE are pinned by
  // member, not by count: a count cannot see a one-out-one-in swap,
  // and each new member needs a human to write its story rather than
  // a predicate to guess it. `preprocessor` and `oracle-logged` are
  // mechanical classes with no story and stay on counts above.
  test("the narrative families are pinned by member", () => {
    expect(membersOf("no-list-read")).toEqual([]);
    expect(membersOf("oracle-line-not-a-term-line")).toEqual([
      "lists_test.rb#multiple block attribute lines separated by empty line above nested list does not break list#0#1",
      "lists_test.rb#nested dlist with attached block offset by empty line#0#1",
    ]);
  });

  test("the exclusion list is non-vacuous and small", () => {
    const universe = EXCLUDED.length + COMPARABLE.length;
    expect(
      EXCLUDED.length,
      JSON.stringify(EXCLUDED, undefined, 2),
    ).toBeGreaterThan(0);
    expect(EXCLUDED.length).toBeLessThan(universe / 4);
  });

  test("every exclusion names the issue its class belongs to", () => {
    for (const one of EXCLUDED) {
      expect(one.reason, `${one.id}: ${one.family}`).toMatch(/issue #\d+/v);
    }
  });

  // The typed walk is TOTAL only if it recurses into every block kind
  // that can hold a list. This holds it to the STRUCTURAL walk, which
  // knows no node kinds at all: a block kind that comes to carry a
  // description list without joining `listsIn`'s switch shows up here
  // as a list the typed walk cannot see, rather than as a list this
  // suite silently stops comparing.
  test("the typed walk finds every list the structural walk does", () => {
    for (const entry of ALL_CASES) {
      const structural = preorder(parse(entry.input)).filter(
        (node) => node.type === "descriptionList",
      );
      expect(
        ourDescriptionLists(entry.input).length,
        `${entry.group}: ${entry.id}`,
      ).toBe(structural.length);
    }
  });

  test("the corpus actually fed this suite something", () => {
    expect(ALL_CASES.length).toBeGreaterThan(0);
    expect(COMPARABLE.length).toBeGreaterThan(100);
  });
});
