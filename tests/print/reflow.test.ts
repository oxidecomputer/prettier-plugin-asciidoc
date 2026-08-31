/**
 * `print/reflow.ts` — the atom engine: the atoms a word list becomes,
 * the runs those atoms fuse into, and the lines the greedy packer
 * makes of them.
 *
 * Table-driven because the module is `(atoms, width, indent) → lines`
 * with no context: the rows ARE the packing rules. They pin the
 * neutral atom, the three safety mechanisms of atom construction
 * (fuse backwards at line start, fuse forwards at line end, the dlist
 * first-line guard), the fused run measured WHOLE before the break
 * decision, the column budget's arithmetic (indent included on the
 * first line, columns not characters), the two spellings of a
 * mandatory break, and the walk that keeps a break the reader will
 * still see.
 */
import { describe, expect, test } from "vitest";
import {
  atomOf,
  blockBody,
  isFused,
  keepLastBreak,
  splitWords,
  wordsToAtoms,
  wrap,
  type Atom,
} from "../../src/print/reflow.js";

/**
 * One atom carrying the join facts a row cares about, the rest
 * neutral — so a row spells only the fact it is about.
 * @param text - the atom's text
 * @param joins - the join facts the row sets
 * @returns the atom
 */
function atom(text: string, joins: Partial<Omit<Atom, "text">> = {}): Atom {
  return { ...atomOf(text), ...joins };
}

/**
 * An atom list as one readable string per atom: the text, the three
 * glue facts, and the break in front of it.
 * @param atoms - the atoms to spell
 * @returns one line per atom
 */
function spell(atoms: readonly Atom[]): string[] {
  return atoms.map(
    (one) =>
      `${one.text} glueLeft=${String(one.glueLeft)} noBreakBefore=${String(one.noBreakBefore)} noBreakAfter=${String(one.noBreakAfter)} break=${one.breakBefore}`,
  );
}

/**
 * The texts of an atom list, for rows about rewriting alone.
 * @param atoms - the atoms
 * @returns their texts in order
 */
function texts(atoms: readonly Atom[]): string[] {
  return atoms.map((one) => one.text);
}

/**
 * Each atom's break, for rows about where a mandatory break landed.
 * @param atoms - the atoms
 * @returns the breaks in order
 */
function breaks(atoms: readonly Atom[]): string[] {
  return atoms.map((one) => one.breakBefore);
}

describe("the neutral atom", () => {
  test("atomOf carries the text and no joins at all", () => {
    expect(atomOf("word")).toEqual({
      text: "word",
      glueLeft: false,
      noBreakBefore: false,
      noBreakAfter: false,
      breakBefore: "none",
    });
  });
});

describe("what a word is", () => {
  test.each([
    ["one two", ["one", "two"]],
    // Runs of whitespace, and whitespace at either end, contribute no
    // word: every caller must agree on the COUNT, because the dlist
    // guard is placed by counting the first source line's words.
    ["  one \t two \n three  ", ["one", "two", "three"]],
    ["", []],
    ["   ", []],
    // Issue #75: a no-break space (U+00A0) is not whitespace to Ruby's
    // `\s`, so it does not split a word - it rides inside one, unlike
    // JavaScript's `\s`, which would read it as a separator here.
    ["a\u00A0b", ["a\u00A0b"]],
    ["one\u00A0two three", ["one\u00A0two", "three"]],
    // Every other Unicode space JS's `\s` matches and Ruby's does not
    // (the same divergence class, issue #67): narrow no-break space
    // (U+202F), figure space (U+2007), ideographic space (U+3000),
    // zero-width no-break space / BOM (U+FEFF).
    ["a\u202Fb", ["a\u202Fb"]],
    ["a\u2007b", ["a\u2007b"]],
    ["a\u3000b", ["a\u3000b"]],
    ["a\uFEFFb", ["a\uFEFFb"]],
    // A node that is ENTIRELY a no-break space is one word, not zero:
    // it is content Asciidoctor renders, not whitespace it collapses.
    ["\u00A0", ["\u00A0"]],
  ])("splitWords(%j) is %j", (value, words) => {
    expect(splitWords(value)).toEqual(words);
  });
});

describe("an atom's fusion to its predecessor", () => {
  const rows: Array<{
    rule: string;
    atoms: Atom[];
    index: number;
    fused: boolean;
  }> = [
    {
      rule: "the first atom has no predecessor to fuse to",
      atoms: [atom("a")],
      index: 0,
      fused: false,
    },
    {
      rule: "glueLeft fuses",
      atoms: [atom("a"), atom("b", { glueLeft: true })],
      index: 1,
      fused: true,
    },
    {
      rule: "noBreakBefore fuses",
      atoms: [atom("a"), atom("b", { noBreakBefore: true })],
      index: 1,
      fused: true,
    },
    {
      rule: "the predecessor's noBreakAfter fuses",
      atoms: [atom("a", { noBreakAfter: true }), atom("b")],
      index: 1,
      fused: true,
    },
    {
      rule: "with none of the three facts the atom is free to start a line",
      atoms: [atom("a"), atom("b")],
      index: 1,
      fused: false,
    },
  ];

  test.each(rows)("$rule", ({ atoms, index, fused }) => {
    expect(isFused(atoms, index)).toBe(fused);
  });
});

describe("the atoms a word list becomes", () => {
  test("plain words carry no joins and no break", () => {
    expect(spell(wordsToAtoms(["alpha", "beta"]))).toEqual([
      "alpha glueLeft=false noBreakBefore=false noBreakAfter=false break=none",
      "beta glueLeft=false noBreakBefore=false noBreakAfter=false break=none",
    ]);
  });

  test("a word AsciiDoc would re-read as block syntax shares its predecessor's line", () => {
    expect(spell(wordsToAtoms(["text", "----"]))).toEqual([
      "text glueLeft=false noBreakBefore=false noBreakAfter=false break=none",
      "---- glueLeft=false noBreakBefore=true noBreakAfter=false break=none",
    ]);
  });

  test("the same word FIRST has no predecessor, so it is not fused", () => {
    expect(spell(wordsToAtoms(["----", "text"]))).toEqual([
      "---- glueLeft=false noBreakBefore=false noBreakAfter=false break=none",
      "text glueLeft=false noBreakBefore=false noBreakAfter=false break=none",
    ]);
  });

  test("a bare `+` may not end a line, so its successor shares it", () => {
    expect(spell(wordsToAtoms(["a", "+", "b"]))).toEqual([
      "a glueLeft=false noBreakBefore=false noBreakAfter=false break=none",
      "+ glueLeft=false noBreakBefore=false noBreakAfter=true break=none",
      "b glueLeft=false noBreakBefore=true noBreakAfter=false break=none",
    ]);
  });

  test("the node's last word is released: whether a sibling joins it is the boundary's call", () => {
    const atoms = wordsToAtoms(["a", "+"], { escapeTrailingPlus: false });
    expect(spell(atoms)).toEqual([
      "a glueLeft=false noBreakBefore=false noBreakAfter=false break=none",
      "+ glueLeft=false noBreakBefore=false noBreakAfter=false break=none",
    ]);
  });

  const plusRows: Array<{
    rule: string;
    words: string[];
    rewritten: string[];
  }> = [
    // A `+` with no successor to fuse to would end an output line,
    // where ` +` is a hard line break; `{plus}` renders as `+`.
    {
      rule: "a trailing `+` with nothing to fuse to is rewritten",
      words: ["a", "+"],
      rewritten: ["a", "{plus}"],
    },
    { rule: "a `+` alone is rewritten", words: ["+"], rewritten: ["{plus}"] },
    // Fused into its predecessor's run, the `+` cannot reach the end
    // of a line, so it is left exactly as written.
    {
      rule: "a trailing `+` inside a run is left alone",
      words: ["+", "+"],
      rewritten: ["+", "+"],
    },
  ];

  test.each(plusRows)("$rule", ({ words, rewritten }) => {
    expect(texts(wordsToAtoms(words))).toEqual(rewritten);
  });

  test("an empty word list produces no atoms, and nothing before the first one", () => {
    const atoms = wordsToAtoms([]);
    expect(atoms).toEqual([]);
    expect(Object.keys(atoms)).toEqual([]);
  });

  test("a dlist separator word off a LATER source line demands a break in front of it", () => {
    expect(
      breaks(
        wordsToAtoms(["alpha", "term::", "beta"], { firstLineWordCount: 1 }),
      ),
    ).toEqual(["none", "hard", "none"]);
  });

  test("the same word ON the first source line is already a dlist term there, so no guard", () => {
    expect(
      breaks(
        wordsToAtoms(["alpha", "term::", "beta"], { firstLineWordCount: 3 }),
      ),
    ).toEqual(["none", "none", "none"]);
  });

  test("with no options the dlist guard is off — every word may start a line", () => {
    expect(spell(wordsToAtoms(["alpha", "term::"]))).toEqual([
      "alpha glueLeft=false noBreakBefore=false noBreakAfter=false break=none",
      "term:: glueLeft=false noBreakBefore=false noBreakAfter=false break=none",
    ]);
  });
});

describe("packing atoms into lines", () => {
  test("no atoms make no lines — not one empty line", () => {
    expect(wrap([], 80, 0)).toEqual([]);
  });

  const budgets: Array<{
    rule: string;
    width: number;
    indent: number;
    lines: string[];
  }> = [
    // `aaa bbb` is 7 columns: the join costs the space it prints.
    {
      rule: "the joined text fits the budget exactly",
      width: 7,
      indent: 0,
      lines: ["aaa bbb"],
    },
    {
      rule: "one column short, the second word opens a line",
      width: 6,
      indent: 0,
      lines: ["aaa", "bbb"],
    },
    // The first line is returned WITHOUT the indent, but its budget
    // still counts it: the caller writes a marker in those columns.
    {
      rule: "the first line's budget counts the indent the caller writes",
      width: 7,
      indent: 2,
      lines: ["aaa", "  bbb"],
    },
  ];

  test.each(budgets)("$rule", ({ width, indent, lines }) => {
    expect(wrap([atom("aaa"), atom("bbb")], width, indent)).toEqual(lines);
  });

  test("width is COLUMNS: a full-width character costs two", () => {
    const atoms = [atom("漢字漢字"), atom("x")];
    expect(wrap(atoms, 9, 0)).toEqual(["漢字漢字", "x"]);
    expect(wrap(atoms, 10, 0)).toEqual(["漢字漢字 x"]);
  });

  test("a fused run is measured whole before the break decision", () => {
    const atoms = [
      atom("aaa"),
      atom("bbb"),
      atom("ccc", { noBreakBefore: true }),
    ];
    expect(wrap(atoms, 8, 0)).toEqual(["aaa", "bbb ccc"]);
  });

  test("a run longer than the budget overruns on a line of its own", () => {
    const atoms = [atom("aaa"), atom("bbbbbbbbbb"), atom("c")];
    expect(wrap(atoms, 5, 2)).toEqual(["aaa", "  bbbbbbbbbb", "  c"]);
  });

  test("a break demanded inside a fused run lands in front of the WHOLE run", () => {
    const atoms = [
      atom("aa"),
      atom("bb"),
      atom("cc", { noBreakBefore: true, breakBefore: "hard" }),
    ];
    expect(wrap(atoms, 80, 0)).toEqual(["aa", "bb cc"]);
  });

  test("a break demanded by the very first run opens no empty line", () => {
    expect(
      wrap([atom("a", { breakBefore: "hard" }), atom("b")], 80, 0),
    ).toEqual(["a b"]);
  });

  test("a hard break opens a line at the continuation indent", () => {
    const atoms = [atom("a"), atom("b", { breakBefore: "hard" }), atom("c")];
    expect(wrap(atoms, 5, 3)).toEqual(["a", "   b", "   c"]);
  });

  test("a literal break opens a line at column 0, with the whole budget", () => {
    const atoms = [atom("a"), atom("b", { breakBefore: "literal" }), atom("c")];
    expect(wrap(atoms, 5, 3)).toEqual(["a", "b c"]);
  });

  // wordsToAtoms fuses a block-syntax word backwards, but only within
  // one text node. A run the PACKER fuses out of several nodes -
  // `[`, an atomic construct, `]` - reaches this loop unprotected, so
  // the width break in front of it is refused here instead and the run
  // overruns the line it is already on.
  test("a width break is refused where the run would be block syntax", () => {
    const atoms = [atom("aaa"), atom("[b@c.com]")];
    expect(wrap(atoms, 5, 0)).toEqual(["aaa [b@c.com]"]);
  });

  test("an ordinary run of the same width still takes the break", () => {
    expect(wrap([atom("aaa"), atom("bb@c.com")], 5, 0)).toEqual([
      "aaa",
      "bb@c.com",
    ]);
  });

  // A DEMANDED break is the author's own line, or a net that already
  // weighed this hazard: the refusal is for WIDTH breaks alone.
  test("a demanded break still stands in front of block syntax", () => {
    const atoms = [atom("aaa"), atom("[b@c.com]", { breakBefore: "literal" })];
    expect(wrap(atoms, 80, 0)).toEqual(["aaa", "[b@c.com]"]);
  });
});

describe("the block body", () => {
  test("one part per output line, a hardline between", () => {
    const parts = blockBody([atom("aaa"), atom("bbb")], 6, 0);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe("aaa");
    expect(parts[2]).toBe("bbb");
  });
});

describe("the kept break", () => {
  test("the last breakable join is made mandatory", () => {
    expect(breaks(keepLastBreak([atom("a"), atom("b")]))).toEqual([
      "none",
      "hard",
    ]);
  });

  test("atoms that form ONE run are left alone — there is no join to harden", () => {
    const atoms = [atom("a"), atom("b", { noBreakBefore: true })];
    expect(breaks(keepLastBreak(atoms))).toEqual(["none", "none"]);
  });

  test("a run that already demands a break ends the search", () => {
    const atoms = [
      atom("a"),
      atom("b"),
      atom("[role]", { breakBefore: "literal" }),
    ];
    expect(breaks(keepLastBreak(atoms))).toEqual(["none", "none", "literal"]);
  });

  test("a break that opens a line the reader DELETES buys nothing: the search walks past it", () => {
    const atoms = [
      atom("a"),
      atom("b"),
      atom("//c", { breakBefore: "literal" }),
    ];
    expect(breaks(keepLastBreak(atoms))).toEqual(["none", "hard", "literal"]);
  });

  test("a run that merely BEGINS with `//` is not a whole deleted line", () => {
    const atoms = [
      atom("a"),
      atom("b"),
      atom("//c", { breakBefore: "literal" }),
      atom("tail", { noBreakBefore: true }),
    ];
    expect(breaks(keepLastBreak(atoms))).toEqual([
      "none",
      "none",
      "literal",
      "none",
    ]);
  });

  test("the walk stops before the first run: the break in front of the block is not this block's to make", () => {
    const atoms = [atom("a"), atom("//c", { breakBefore: "literal" })];
    expect(spell(keepLastBreak(atoms))).toEqual(spell(atoms));
  });
});
