/**
 * The WHITESPACE RECORD, read off the tree the reader built.
 *
 * The format suites assert what the printer WRITES; these rows assert
 * what the reader RECORDED, which is the half a byte pin cannot
 * separate. Two records that agree describe blocks Asciidoctor reads
 * alike, so a row here names the arm and the rule rather than an
 * output spelling: a run's fact is `free` when no rule reads it,
 * `bound` when a rule reads its spelling, and `verbatim` when a rule
 * reads its bytes.
 *
 * Every input is parsed, never hand-built: the enumeration the record
 * is indexed over is the same walk the printer asks, and a hand-built
 * tree could agree with neither.
 */
import { describe, expect, test } from "vitest";
import { parse } from "../../src/parser.js";
import type {
  BlockWhitespace,
  WhitespaceFact,
} from "../../src/whitespace-record.js";
import {
  blockWhitespace,
  factOfRun,
  PLAIN_WHITESPACE_CONTEXT,
} from "../../src/whitespace-fact.js";
import { cutValue, whitespaceRuns } from "../../src/whitespace-runs.js";
import { joinOfFact } from "../../src/print/text-edges.js";
import { narrow } from "../helpers.js";

/**
 * The record the reader put on the document's first paragraph.
 * @param source - the document.
 * @returns the record.
 */
function recordOf(source: string): BlockWhitespace {
  const block = parse(source).children.find((n) => n.type === "paragraph");
  narrow(block, "paragraph");
  return block.whitespace;
}

/**
 * The facts of the first paragraph's runs, in enumeration order.
 * @param source - the document.
 * @returns the facts.
 */
function runsOf(source: string): readonly WhitespaceFact[] {
  const record = recordOf(source);
  return record.kind === "reflowable" ? record.runs : [];
}

describe("the cut a record is indexed over", () => {
  // Runs at the two EDGES are cut as well as the ones between words:
  // an edge run stands between the node and the sibling beside it,
  // and both are runs of the block.
  test.each([
    [
      "one two",
      { words: ["one", "two"], runs: [" "], leading: "", trailing: "" },
    ],
    [
      " one  two ",
      { words: ["one", "two"], runs: ["  "], leading: " ", trailing: " " },
    ],
    ["  ", { words: [], runs: [], leading: "  ", trailing: "" }],
    ["", { words: [], runs: [], leading: "", trailing: "" }],
  ])("%j cuts into %j", (value, cut) => {
    expect(cutValue(value)).toEqual(cut);
  });
});

describe("one fact per run, in printing order", () => {
  // The block's OWN leading and trailing runs are not runs of it: the
  // first decides whether the block is an indented literal at all,
  // and the reference's reader strips the last before any rule reads
  // a boundary (`prepare_lines`, reader.rb l.582).
  test("the block's own edges are not runs", () => {
    const [block] = parse("a b  \n  c d \n").children;
    narrow(block, "paragraph");
    expect(whitespaceRuns(block.children)).toHaveLength(3);
  });

  // A monospace span's interior is bytes the reader preserves, so no
  // run of it is a run of the block (issue #32): `a` + span + `b`
  // leaves the two runs around the span and none inside it.
  test("a monospace span's interior holds no run of the block", () => {
    expect(runsOf("a `x  y` b\n")).toHaveLength(2);
  });
});

describe("the rows, one witness each", () => {
  test.each([
    ["a run no rule reads is free", "a b\n", [{ kind: "free" }]],
    // A6, wider than its authority by policy: no rule's boundary
    // class holds a tab, and none has a neighbour test that could
    // tell a tab it reads from one it does not.
    [
      "a run holding a tab is verbatim",
      "a\tb\n",
      [{ kind: "verbatim", bytes: "\t", by: "tabInRun" }],
    ],
    // A6 stops at a LINE BREAK: the reference rstrips every line
    // before the parser reads one, so a tab in front of the break is
    // already gone and a tab behind it is an indent the printer
    // rewrites.
    ["a tab in front of a break is not read", "a\t\nb\n", [{ kind: "free" }]],
    // A8: `HardLineBreakRx` keeps the extra space in the text, so the
    // run's own bytes are in the render. A one-space run has no width
    // left for a row to read, so the strongest arm it can take is the
    // spelling - which for one space IS its bytes.
    [
      "the run before a hard break is bound to its spelling",
      "a  +\nb\n",
      [{ kind: "bound", to: "space", by: "hardBreakRun" }],
    ],
    // The same row where the run HAS a width: the extra space the
    // token did not take is bytes the row reads.
    [
      "a wider run before a hard break is verbatim",
      "a   +\nb\n",
      [{ kind: "verbatim", bytes: "  ", by: "hardBreakRun" }],
    ],
    // A9: a newline there would put ` +` at a line end.
    [
      "the run after a lone plus is bound to its spelling",
      "a\t+ b\n",
      [
        { kind: "verbatim", bytes: "\t", by: "tabInRun" },
        { kind: "bound", to: "space", by: "lonePlusAhead" },
      ],
    ],
    // A7 clause (a): one side, and it is dashes the row can still
    // read. The one character the packer writes is the one the row
    // wants, so the run is a fixed point either way.
    // Two runs, because the row FIRED: `a -- b` is the text `a`, the
    // character reference the row wrote, and the text ` b`, so each
    // side of the reference is its own run.
    [
      "a lone dash pair on one side frees a space",
      "a -- b\n",
      [{ kind: "free" }, { kind: "free" }],
    ],
    // A7's verbatim outcome: `do_replacement`'s `:none` restore eats
    // exactly one flanking character, so a longer run leaves a
    // residue.
    [
      "a longer run beside the dashes is verbatim",
      "a --  b\n",
      [
        { kind: "free" },
        { kind: "verbatim", bytes: "  ", by: "dashOrReferenceEdge" },
      ],
    ],
    // A7 clause (c): the value is not resolved, so a reference on one
    // side binds the run to the spelling the source gave it.
    [
      "a run beside a reference is bound",
      "a {d} b\n",
      [
        { kind: "bound", to: "space", by: "dashOrReferenceEdge" },
        { kind: "bound", to: "space", by: "dashOrReferenceEdge" },
      ],
    ],
    // A10: the converter URL-encodes the target's run into `src`.
    [
      "a run inside an image target is verbatim",
      "x image:a  b.png[] y\n",
      [
        { kind: "free" },
        { kind: "verbatim", bytes: "  ", by: "macroTarget" },
        { kind: "free" },
      ],
    ],
    // A11: the target class admits no newline.
    [
      "a run inside a menu target is bound",
      "x menu:File  Edit[New] y\n",
      [
        { kind: "free" },
        { kind: "bound", to: "space", by: "macroTarget" },
        { kind: "free" },
      ],
    ],
  ])("%s", (_name, source, facts) => {
    expect(runsOf(source)).toEqual(facts);
  });

  // A run at a SPAN's own edge has no node facing it there, which is
  // not the same as a node that cannot spell the dashes: the block's
  // own edges are outside the record, so this is the only shape that
  // reaches the edge arm with a dash-bearing side opposite.
  test("a run against a span's opening mark reads no side there", () => {
    expect(runsOf(":d: --\n\n__ {d}__\n")).toEqual([
      { kind: "bound", to: "space", by: "dashOrReferenceEdge" },
    ]);
  });

  // A run carrying a LINE BREAK can take no arm stronger than
  // `bound`: an atom is newline-free by construction, so the bytes
  // have nowhere to ride and the break is all of the run the printer
  // can write back. That is also what makes the record a fixed point
  // - the run the next read sees is the one newline this wrote.
  test("a run carrying a break is bound, never verbatim", () => {
    expect(runsOf(":d: --\n\n{d}\t\n{d}\n")).toEqual([
      { kind: "bound", to: "newline", by: "dashOrReferenceEdge" },
    ]);
  });
});

describe("the whole-block rows", () => {
  // A5: `sub_post_replacements` reads every newline of the block as a
  // break, so every run keeps the spelling the source gave it. Length
  // and tabs still fold, which is why this is not the verbatim arm.
  test("a hardbreaks block binds every run to its spelling", () => {
    expect(runsOf("[%hardbreaks]\nLine one\nLine two\n")).toEqual([
      { kind: "bound", to: "space", by: "hardbreaksOption" },
      { kind: "bound", to: "newline", by: "hardbreaksOption" },
      { kind: "bound", to: "space", by: "hardbreaksOption" },
    ]);
  });

  // A3: `sub_attributes`' `set` arm drops the whole LINE the unset
  // directive stood on, so which line a byte is on is a fact the
  // render reads and no run of the block may move.
  test("a block holding the unset set directive is replayed", () => {
    expect(recordOf("a {set:x!} b\n")).toEqual({
      kind: "replayed",
      why: "setOrCounterReference",
    });
  });

  // A4: resolvability is not decidable here, so ANY reference
  // suffices while the document drops the line one stands on.
  test("a reference under attribute-missing drop-line replays", () => {
    expect(recordOf(":attribute-missing: drop-line\n\na {d} b\n")).toEqual({
      kind: "replayed",
      why: "dropLineWithReference",
    });
  });

  // The reference the block row looks for may stand at any depth: a
  // span's content is the block's content.
  test("a reference nested inside a span replays the block too", () => {
    expect(recordOf(":attribute-missing: drop-line\n\na *{d}* b\n")).toEqual({
      kind: "replayed",
      why: "dropLineWithReference",
    });
  });

  // A2: which substitutions a declared set performs is a question the
  // lens cannot see through, so the block is replayed by policy.
  test("a declared subs set replays the block", () => {
    expect(recordOf("[subs=none]\na  b\n")).toEqual({
      kind: "replayed",
      why: "nonDefaultSubs",
    });
  });

  // A1 has no arm at all: a verbatim style over a paragraph builds a
  // delimited block whose content is a source slice, so no such block
  // is a prose block and none reaches the record.
  test("a verbatim style is answered by construction", () => {
    const [, block] = parse("[literal]\na  b\n").children;
    expect(block.type).toBe("delimitedBlock");
  });
});

describe("what the printer makes of one fact", () => {
  // TOTAL over the record's own type, which is wider than the rows
  // produce: nothing in `WhitespaceFact` says a `verbatim` run holds
  // no newline, so the printer answers for one rather than assuming
  // the rows. The answers are the two the atom model has - bytes that
  // ride inside a word, or a join the packer may not rewrite - and
  // the newline arm is why a row that WOULD claim such a run reduces
  // to the break instead.
  test.each([
    [
      "a free run",
      { kind: "free" } as const,
      "  ",
      { rides: false, held: "none" },
    ],
    [
      "a run bound to a space",
      { kind: "bound", to: "space", by: "macroTarget" } as const,
      "  ",
      { rides: false, held: "space" },
    ],
    [
      "a run bound to a newline",
      { kind: "bound", to: "newline", by: "hardbreaksOption" } as const,
      "\n",
      { rides: false, held: "newline" },
    ],
    [
      "verbatim bytes that can ride",
      { kind: "verbatim", bytes: "\t", by: "tabInRun" } as const,
      "\t",
      { rides: true, held: "none" },
    ],
    // One space IS what the packer writes, so nothing rides; what is
    // left to say is that no break may land there.
    [
      "verbatim bytes that are one space",
      { kind: "verbatim", bytes: " ", by: "macroTarget" } as const,
      " ",
      { rides: false, held: "space" },
    ],
    // An atom is newline-free by construction, so the bytes have
    // nowhere to ride and the break is all the printer can write.
    [
      "verbatim bytes carrying a break",
      { kind: "verbatim", bytes: "\n ", by: "tabInRun" } as const,
      "\n ",
      { rides: false, held: "newline" },
    ],
  ])("%s", (_name, fact, run, join) => {
    expect(joinOfFact(fact, run)).toEqual(join);
  });

  // A run the record holds nothing for - one inside byte-preserved
  // content, or at the block's own edge - reads as free.
  test("a run with no fact is free", () => {
    expect(joinOfFact(undefined, "  ")).toEqual({ rides: false, held: "none" });
  });
});

describe("the row precedence", () => {
  // The order is by ARM before by row number: replaying a run's bytes
  // preserves whether it held a tab, so the verbatim rows satisfy the
  // bound rows' obligations and may outrank them.
  test("the tab row outranks the hardbreaks row", () => {
    expect(recordOf("[%hardbreaks]\na\tb\n")).toEqual({
      kind: "reflowable",
      runs: [{ kind: "verbatim", bytes: "\t", by: "tabInRun" }],
    });
  });

  // The verdict is a function of the SITE and the context alone, so
  // one run can be asked directly.
  test("the verdict is a total function of one run", () => {
    const [block] = parse("a\tb\n").children;
    narrow(block, "paragraph");
    const [site] = whitespaceRuns(block.children);
    expect(factOfRun(site, PLAIN_WHITESPACE_CONTEXT)).toEqual({
      kind: "verbatim",
      bytes: "\t",
      by: "tabInRun",
    });
    expect(
      factOfRun(site, { ...PLAIN_WHITESPACE_CONTEXT, hardbreaks: true }),
    ).toEqual({ kind: "verbatim", bytes: "\t", by: "tabInRun" });
  });

  // A block with no inline content at all still has a record: the
  // reflowable arm with no runs, which is what "nothing to decide"
  // looks like.
  test("a block with no run records an empty reflowable arm", () => {
    expect(blockWhitespace([], PLAIN_WHITESPACE_CONTEXT)).toEqual({
      kind: "reflowable",
      runs: [],
    });
  });
});
