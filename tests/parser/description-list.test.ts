import { describe, test, expect } from "vitest";
import type { DescriptionPrinting } from "../../src/ast.js";
import {
  BLOCK_START_CONTEXT,
  interruptsByLineShape,
} from "../../src/parse/line-shapes.js";
import { classifyLine } from "../../src/parse/lines/classify.js";
import {
  descriptionPrinting,
  descriptionSibling,
} from "../../src/parse/lines/description-list.js";
import {
  descriptionList,
  listShape,
} from "../../src/parse/lines/list-reader.js";
import { splitLines } from "../../src/parse/lines/split.js";

/**
 * Scan a source string as a description list opening on its first
 * line, and report what each item's extent held.
 * @param source - the whole document, newline separated
 * @returns one entry per item: the term line's text and the buffer's
 *   line texts, plus the index the list ends at
 */
function scanDlist(source: string): {
  items: Array<{ term: string; buffer: string[] }>;
  end: number;
} {
  const lines = splitLines(source);
  const opening = classifyLine(lines[0].text, BLOCK_START_CONTEXT);
  if (opening.kind !== "dlistTerm") {
    throw new Error(`not a term line: ${JSON.stringify(lines[0].text)}`);
  }
  const shape = listShape(lines, 0, descriptionList(opening), {
    tailSafe: true,
    directiveDepth: 0,
  });
  return {
    items: shape.items.map((item) => ({
      term: item.markerLine.text,
      buffer: item.buffer.map((line) => line.text),
    })),
    end: shape.end,
  };
}

describe("descriptionSibling", () => {
  // rx.rb l.341-343: for `::`, `:::` and `::::` the term group is
  // `([^ \t].*?[^:]|[^ \t:])`, so the character before the delimiter
  // may not be a colon. ORACLE: `a:: x` / `a::: y` / `b:: z` renders
  // three items in two lists.
  test("a longer delimiter is not a sibling of a shorter one", () => {
    expect(descriptionSibling("a::: y", "::")).toBeUndefined();
  });

  test("the same delimiter is a sibling", () => {
    expect(descriptionSibling("b:: z", "::")?.delimiter).toBe("::");
  });

  // rx.rb l.344: `;;`'s term group is DescriptionListRx's, with no
  // colon exclusion.
  test(";; has no colon exclusion", () => {
    expect(descriptionSibling("a:;; z", ";;")?.term).toBe("a:");
  });

  test("a term with no inline description is a sibling", () => {
    const kind = descriptionSibling("b::", "::");
    expect(kind?.descriptionStart).toBeUndefined();
  });

  test("a term may hold blanks", () => {
    expect(descriptionSibling("a multi word term:: d", "::")?.term).toBe(
      "a multi word term",
    );
  });

  // rx.rb l.336's `(?!//[^/])` lookahead, carried by every sibling
  // pattern: a `//` line is never a term, and `///` is.
  test("a comment line is not a sibling", () => {
    expect(descriptionSibling("// t:: d", "::")).toBeUndefined();
    expect(descriptionSibling("///t:: d", "::")?.term).toBe("///t");
  });

  test("the indent is reported and the term starts after it", () => {
    expect(descriptionSibling("  b:: z", "::")?.indent).toBe(2);
  });

  test("a marker line is not a sibling", () => {
    expect(descriptionSibling("* item", "::")).toBeUndefined();
  });

  // One row per delimiter the family is keyed on, and each one's
  // boundary: every colon spelling excludes a colon in front of its
  // own delimiter (rx.rb l.341-343), so a line is a sibling of AT
  // MOST one of them and a longer or shorter run opens a nested list
  // instead. Without these rows the `:::` and `::::` patterns are two
  // hand-copied literals nothing measures.
  test.each([
    ["a:: x", "::", "a", 4],
    ["a::: y", ":::", "a", 5],
    ["a:::: y", "::::", "a", 6],
    ["a;; z", ";;", "a", 4],
  ] as const)(
    "%s is a sibling of %s with term %s",
    (line, delimiter, term, descriptionStart) => {
      const kind = descriptionSibling(line, delimiter);
      expect(kind?.term).toBe(term);
      expect(kind?.descriptionStart).toBe(descriptionStart);
    },
  );

  test.each([
    ["a::: y", "::"],
    ["a:::: y", "::"],
    ["a:: x", ":::"],
    ["a:::: y", ":::"],
    ["a:: x", "::::"],
    ["a::: y", "::::"],
  ] as const)("%s does not continue a %s list", (line, delimiter) => {
    expect(descriptionSibling(line, delimiter)).toBeUndefined();
  });
});

describe("the three arms a description list reads its items with", () => {
  // The greedy no-text arm (parser.rb l.1551-1556, "only dlist in
  // need of item text, so slurp it up!"): a term with no inline
  // description keeps reading PAST a blank line until it has text,
  // and the blank is popped so it cannot read as a continuation.
  // ORACLE: `term1::` / blank / `'''` / `continued` is ONE item whose
  // description is `''' continued`, so the thematic break is the
  // item's text and not a block of the document.
  test("a textless term reads past a blank line for its text", () => {
    const scan = scanDlist("term1::\n\n'''\ncontinued\n");
    expect(scan.items).toHaveLength(1);
    expect(scan.items[0].buffer).toEqual(["'''", "continued"]);
  });

  // has_text starts true only when the term line carried inline text
  // (parser.rb l.1304), so the same shape with an inline description
  // ends the item at the blank line: ORACLE renders the `'''` as a
  // thematic break of the document and `continued` as its own
  // paragraph. The item ends AT the `'''`, index 2: every stopping
  // arm unreads its line, and the blank the item consumed is popped
  // from the buffer without moving where the read resumes.
  test("a term with inline text does not read past the blank", () => {
    const scan = scanDlist("term1:: d\n\n'''\ncontinued\n");
    expect(scan.items[0].buffer).toEqual([]);
    expect(scan.end).toBe(2);
  });

  // has_text goes back to FALSE when a nested dlist term with no
  // inline description is met, from all three arms (parser.rb
  // l.1505-1508, l.1533-1536, l.1564-1567), so the greedy read runs
  // again for the nested term and the item keeps reading past the
  // second blank. The blank SURVIVES in the buffer here because
  // l.1553's pop is skipped inside a nested list, which the term
  // line just opened. ORACLE: one item whose description carries a
  // nested list `nested` / `text`.
  test("a nested textless term lowers has_text again", () => {
    const scan = scanDlist("term1:: d\nnested:::\n\ntext\n");
    expect(scan.items).toHaveLength(1);
    expect(scan.items[0].buffer).toEqual(["nested:::", "", "text"]);
  });

  // The block-attribute look-ahead (parser.rb l.1462-1482): a `[...]`
  // line breaks a dlist item only when what follows is neither a list
  // item nor another attribute line nor a blank. Buffer the run, peek
  // past it, and either concat it (a list follows) or unshift it and
  // break. ORACLE: the `[square]` styles a nested ulist INSIDE the
  // item's description.
  test("an attribute run followed by a list item stays in the item", () => {
    const scan = scanDlist("term1:: d\n[square]\n* nested\n");
    expect(scan.items[0].buffer).toEqual(["[square]", "* nested"]);
  });
  // ORACLE: the paragraph is outside the list, and the `[square]` is
  // its own attribute line, so the item ends in front of the run.
  test("an attribute run followed by a paragraph breaks the item", () => {
    const scan = scanDlist("term1:: d\n[square]\nparagraph\n");
    expect(scan.items[0].buffer).toEqual([]);
    expect(scan.end).toBe(1);
  });

  // The sibling-guarded literal slurp (parser.rb l.1490-1493,
  // l.1541-1544): inside a dlist the slurp stops at a sibling term,
  // because "we may be in an indented list disguised as a literal
  // paragraph". Before this the port called the unguarded read at
  // both sites, so the slurp swallowed the sibling line and the list
  // had one item. The `+` reads back as "" because the arm that
  // activated it blanked it in place (parser.rb l.1439).
  test("the literal slurp stops at a sibling term", () => {
    const scan = scanDlist("term1::\n+\n  literal\nterm2:: d\n");
    expect(scan.items).toHaveLength(2);
    expect(scan.items[0].buffer).toEqual(["", "  literal"]);
  });
  test("the literal slurp does not stop at a non-sibling term", () => {
    // `notnestedterm:::` is not a sibling of a `::` list (rx.rb
    // l.341-343's colon exclusion), so the slurp takes it. ORACLE
    // renders it inside the item's literal block.
    const scan = scanDlist("term1::\n+\n  literal\nnotnestedterm:::\n");
    expect(scan.items).toHaveLength(1);
    expect(scan.items[0].buffer).toEqual(["", "  literal", "notnestedterm:::"]);
  });

  // parse_description_list has no skip_blank_lines (l.1228 against
  // l.1119-1128) and does not need one, because the item's own read
  // consumed the blanks and its buffer popped them (l.1584). ORACLE:
  // `a:: x` / blank / blank / `b:: y` is ONE list of two items, and
  // `a:: x` / blank / blank / `plain` is the list plus a separate
  // paragraph. If a later shape disagrees, the skip becomes an arm of
  // the opening union rather than a second loop.
  test("blank lines between items do not end the list", () => {
    const scan = scanDlist("a:: x\n\n\nb:: y\n");
    expect(scan.items).toHaveLength(2);
  });
  test("blank lines then a plain line end the list", () => {
    const scan = scanDlist("a:: x\n\n\nplain\n");
    expect(scan.items).toHaveLength(1);
    expect(scan.end).toBe(3);
  });
});

describe("what the look-ahead and the nestable set decide", () => {
  // l.1466-67: a delimited block past the run interrupts, so the item
  // ends in front of the whole run. ORACLE: the listing block and the
  // `[square]` in front of it are outside the list.
  test("a delimited block past the run breaks the item", () => {
    const scan = scanDlist("term1:: d\n[square]\n----\nx\n----\n");
    expect(scan.items[0].buffer).toEqual([]);
    expect(scan.end).toBe(1);
  });

  // l.1471's `!is_sibling_list_item?`: a SIBLING past the run is not
  // a nested list, so the run is unshifted and the item breaks.
  // ORACLE: `[square]` styles a SECOND dlist, so it left the item.
  test("a sibling past the run breaks the item", () => {
    const scan = scanDlist("term1:: d\n[square]\nterm2:: x\n");
    expect(scan.items).toHaveLength(1);
    expect(scan.items[0].buffer).toEqual([]);
    expect(scan.end).toBe(1);
  });

  // l.1468: a blank line JOINS the run rather than ending it. ORACLE:
  // the nested ulist is styled square and sits inside the item, so
  // the blank did not break the run.
  test("a blank line inside the run keeps the run open", () => {
    const scan = scanDlist("term1:: d\n[square]\n\n* nested\n");
    expect(scan.items[0].buffer).toEqual(["[square]", "", "* nested"]);
  });

  // Ruby's `find` narrows to `[:dlist]` once `within_nested_list`
  // stands (l.1562), which is the only way `* a:::` reads as a term
  // rather than as an unordered item. ORACLE: `x` renders INSIDE the
  // item, which only the greedy read the narrowed set triggers can
  // reach. Without the narrowing the item ends at the blank and `x`
  // is a paragraph of the document.
  test("a nested list narrows the set that lowers has_text", () => {
    const scan = scanDlist("t:: d\n* one\n* a:::\n\nx\n");
    expect(scan.items).toHaveLength(1);
    expect(scan.items[0].buffer).toEqual(["* one", "* a:::", "", "x"]);
  });
});

describe("what the description path records that Ruby drops", () => {
  // parser.rb l.1465-1482: `interrupt` is assigned only inside the
  // `while`, so an EOF peek leaves it nil and BOTH the
  // `buffer.concat` and the `unshift_lines` are skipped - the run's
  // lines are gone from the document. ORACLE: `t:: d` / `[square]`
  // renders the list and nothing else. A formatter may not drop
  // bytes, so these rows assert that the run is KEPT, inside the
  // item, at the position Ruby's reader position leaves it. The
  // render is the same either way (an attribute line at the end of an
  // item opens no block), which is why the divergence is an extent
  // and not a result.
  test("an attribute run at the stream's end stays in the item", () => {
    const scan = scanDlist("t:: d\n[square]\n");
    expect(scan.items[0].buffer).toEqual(["[square]"]);
    expect(scan.end).toBe(2);
  });
  test("a whole run at the stream's end stays, anchors included", () => {
    // `[[anchor]]` is BlockAttributeLineRx's other alternative
    // (rx.rb l.184), so it continues the run rather than ending it.
    const scan = scanDlist("t:: d\n[square]\n[[anchor]]\n");
    expect(scan.items[0].buffer).toEqual(["[square]", "[[anchor]]"]);
    expect(scan.end).toBe(3);
  });

  // The rule a description list matches by is built where the arm is
  // known (`descriptionList`), so every item of a term-opened list
  // carries a term opening. The compiler holds this - a `sibling`
  // returning the wrong arm is a type error at the constructor - and
  // this row is the runtime tripwire beside it. The marker mirror is
  // the `item.marker` row in tests/parser/list-reader.test.ts.
  test("every item of a term-opened list carries a term opening", () => {
    const lines = splitLines("a:: x\nb:: y\nc::\n");
    const opening = classifyLine(lines[0].text, BLOCK_START_CONTEXT);
    if (opening.kind !== "dlistTerm") {
      throw new Error("`a:: x` is a term line");
    }
    const shape = listShape(lines, 0, descriptionList(opening), {
      tailSafe: true,
      directiveDepth: 0,
    });
    expect(shape.items.map((item) => item.marker.kind)).toEqual([
      "dlistTerm",
      "dlistTerm",
      "dlistTerm",
    ]);
  });
});

/**
 * The predicate's answer for a run written the way an author writes
 * it: the term head, the term line's inline description, and the rest
 * lines under it.
 * @param termHead - the item's own term and delimiter (`t::`)
 * @param inline - the term line's inline description, `""` when the
 *   term line carries none
 * @param restLines - the item's recorded rest lines, verbatim
 * @returns "replay" or "reflow"
 */
function printingOf(
  termHead: string,
  inline: string,
  ...restLines: string[]
): DescriptionPrinting {
  return descriptionPrinting({
    termHead,
    inline,
    restLines,
    follower: undefined,
  });
}

/**
 * The same answer for a run whose item carries a first block at a
 * zero-line gap: the follower condition's own domain, which no other
 * field of the run reaches.
 * @param follower - the line that block opens on
 * @param inline - the term line's inline description
 * @returns "replay" or "reflow"
 */
function printingUnder(
  follower: string,
  inline = "alpha bravo",
): DescriptionPrinting {
  return descriptionPrinting({
    termHead: "t::",
    inline,
    restLines: [],
    follower,
  });
}

describe("descriptionPrinting, F: the line the first block opens on", () => {
  // WHY THE CLASS IS THESE FOUR AND NOTHING ELSE. `parse_list_item`
  // hands the item's lines to `next_block`, which reads the block's
  // own first line to pick a block context; once that context is
  // "normal paragraph" the remaining lines go through
  // `read_paragraph_lines`, whose break condition (`StartOfBlockProc`,
  // `StartOfListProc`) knows none of these four. The registry files
  // them together for that reason (line-shapes.ts,
  // `DLIST_FIRST_LINE_INTERRUPTERS`), and the condition asks the
  // contextual predicate rather than that array, so the two can never
  // come to disagree.
  test.each([
    ["an admonition label", "NOTE: x"],
    ["a block macro", "image::y[]"],
    ["a thematic break", "'''"],
    ["a page break", "<<<"],
  ])("F refuses %s directly under the description", (_name, follower) => {
    expect(printingUnder(follower)).toBe("replay");
  });

  // The other half, and the reason the condition is not a blanket
  // refusal on a zero-line gap: each of these ends the description
  // from ANY position, so a text line above it costs it nothing and
  // the run still joins. A blanket rule would replay all six.
  test.each([
    ["a callout marker", "<1> a"],
    ["an unordered marker", "* one"],
    ["an ordered marker", ". one"],
    ["a sibling term", "u:: other"],
    ["a block attribute line", "[role]"],
    ["a lone +", "+"],
  ])("F admits %s directly under the description", (_name, follower) => {
    expect(printingUnder(follower)).toBe("reflow");
  });

  // The condition reads the follower and the run's own bytes SEPARATELY:
  // a safe follower does not rescue a run another condition refuses,
  // and a hazardous one is not excused by a clean run.
  test("a safe follower does not rescue a separator-carrying run", () => {
    expect(printingUnder("* one", "alpha x:: bravo")).toBe("replay");
  });
});

describe("descriptionPrinting, C: every rest line is ordinary text", () => {
  // WHICH CLAUSE each row exercises. C asks the whole LINE what B asks
  // of each word, so a rest line of ONE word is refused twice and only
  // the rows below whose hazard spans words, or is the indent, are C's
  // alone. That redundancy is not a reason to drop the line test: the
  // two multi-word rows are render losses when the line is joined, and
  // no word probe can see either.

  test("C refuses a rest line whose only hazard is a line terminator", () => {
    // RED BEFORE the registry predicate rstripped: the three shapes
    // it adds tested the raw string, so `:a:` with a CR was ordinary
    // text to C and the run reflowed. The oracle rstrips every line
    // in `prepare_source_string`, so the reader does not agree.
    expect(printingOf("term::", "", ":a:\r")).toBe("replay");
  });

  // The comment half of C asks Reader#skip_line_comments's spelling, a
  // bare `//` PREFIX, and NOT the classifier's verdict. The two
  // disagree on exactly the lines that matter: the classifier mirrors
  // CommentLineRx and exempts `///`, so `///c` is ordinary text to it
  // and a deleted line to the reader. Asking the classifier would let
  // the run reflow into `term:: ///c`, which is issue #123.
  test("C refuses a /// rest line, which the classifier calls text", () => {
    expect(printingOf("term::", "", "///c")).toBe("replay");
  });

  test("C refuses an indented rest line", () => {
    // C's alone, and the only row here that reddens when the indent
    // test is deleted. The corpus runs this refuses are AsciiDoc's
    // canonical spelling and the honest cost of a per-line rule; the
    // whole-run join is what takes them back.
    expect(printingOf("term::", "", "  description")).toBe("replay");
  });

  // The rows the LINE test is for, and the reason a per-word rule
  // cannot replace it: a hazard that spans WORDS is invisible to a
  // word probe. TWO of these are rest lines the reader actually
  // produces - `_ _ _`, a markdown rule written as three words, and
  // `> quote`, whose head test is `'> '` (parser.rb:777). The other
  // two are here as the predicate's own boundary and NOT as reachable
  // runs: the reader records `- - -` and `* * *` as BLOCKS of the
  // item, so no rest line ever spells them, and the rows say what the
  // predicate answers if one ever did.
  test.each(["_ _ _", "> quote"])(
    "C refuses the multi-word block head %s, which a rest line spells",
    (line) => {
      expect(printingOf("term::", "", line)).toBe("replay");
    },
  );

  test.each(["- - -", "* * *"])(
    "C answers for %s too, though the reader records it as a block",
    (line) => {
      expect(printingOf("term::", "", line)).toBe("replay");
    },
  );

  // The uniform-run shape rule, which closes the delimiter class by
  // SHAPE rather than by membership: every delimiter Asciidoctor opens
  // a block on is a run of one non-alphanumeric character. Red before
  // it: `---` and `___` were neither a marker nor a delimiter to this
  // classifier and joined away an `<hr>`, and `~~~~` joined away an
  // OPEN block.
  test.each(["---", "___", "***", "--- ", "  ___", "~~~~", "~~~~~~", "...."])(
    "the uniform run %s is refused",
    (line) => {
      expect(printingOf("term::", "", line)).toBe("replay");
    },
  );

  // The MARKER half of the same class, which no shape rule reaches
  // because the line carries letters: `UnorderedListRx` (rx.rb:284)
  // holds a `\u{2022}` bullet beside `-` and `*` and this parser's
  // marker patterns hold neither. The bare word is refused too, since
  // a wrap that puts it at a line start supplies the space Ruby's
  // `[ \t]+` wants.
  test.each(["\u{2022} item", "\u{2022}", "\u{2022}item"])(
    "the bullet spelling %s is refused",
    (line) => {
      expect(printingOf("term::", "", line)).toBe("replay");
    },
  );

  // The boundary from the other side: this Asciidoctor's alternation
  // holds ONE bullet and not a class, so the lookalikes are text on
  // both sides and must keep joining.
  test.each(["\u{2043} item", "\u{2219} item", "\u{00B7} item"])(
    "the lookalike %s is not a marker and joins",
    (line) => {
      expect(printingOf("term::", "", line)).toBe("reflow");
    },
  );

  test.each([
    "+",
    "// c",
    "[square]",
    ".Title",
    ":a: v",
    "----",
    "* n",
    "<1> a",
  ])("the rest line %s is refused", (line) => {
    expect(printingOf("term::", "", line)).toBe("replay");
  });

  test("a run of ordinary text lines is accepted", () => {
    expect(printingOf("term::", "", "one", "two")).toBe("reflow");
  });

  test("C is vacuous for a description on its term line alone", () => {
    expect(printingOf("t::", "alpha bravo")).toBe("reflow");
  });
});

describe("descriptionPrinting, S: no word ends in a term separator", () => {
  test("S refuses a description word ending in a separator", () => {
    expect(printingOf("t::", "aaa bbb x:: y")).toBe("replay");
    expect(printingOf("t::", "aaa bbb", "sss x::")).toBe("replay");
  });

  test("S does not refuse a separator INSIDE a word", () => {
    // `x::y` matches neither DescriptionListRx's term group nor any
    // DescriptionListSiblingRx variant: both end at a delimiter
    // preceded by a non-blank run or by nothing. This boundary is
    // what #119's body pins.
    expect(printingOf("t::", "aaa x::y bbb")).toBe("reflow");
  });

  test("S refuses the bare word ::", () => {
    // The word pattern is `^\S*(?:::|:::|::::|;;)$`, so the bare `::`
    // matches: DescriptionListSiblingRx reaches it and
    // DescriptionListRx also reaches it once something precedes it.
    expect(printingOf("t::", "aaa :: bbb")).toBe("replay");
  });

  test("S never reads the item's own term", () => {
    // `t::` is itself a separator word, so a domain that included the
    // term would refuse every item alive.
    expect(printingOf("t::", "aaa bbb")).toBe("reflow");
  });
});

describe("descriptionPrinting, B: every word is safe at a line start", () => {
  // Probed at width 36, all four of these lose everything after the
  // wrap point and none is caught by the paragraph packer's own
  // line-start guard: a `///` word, an `:a:` word, an `:a: v` pair and
  // a `.x` word.
  test.each(["///", ":a:", ".x"])(
    "B refuses the single-line description word %s",
    (word) => {
      expect(printingOf("t::", `alpha bravo charlie ${word} delta`)).toBe(
        "replay",
      );
    },
  );

  test("B refuses the :a: v pair, which is one attribute entry", () => {
    expect(printingOf("t::", "alpha bravo charlie :a: v delta")).toBe("replay");
  });

  test("B keeps the two-spelling probe", () => {
    // The registry probes a word alone AND with a successor, so `.` is
    // ordinary text to the classifier while `. [+1]` is an ordered
    // list item. That is #124's description coordinate.
    expect(printingOf("term::", "", ".", "[+1]")).toBe("replay");
  });
});

describe("descriptionPrinting, E: every word is safe at a line end", () => {
  // `t:: alpha bravo charlie x[] y` at width 28 is C-clean, S-clean
  // and B-clean and is render-equal on pass 1; on pass 2 the
  // description loses `y`, because the wrapped TERM line
  // `t:: alpha bravo charlie x[]` is `name:: target[attrlist]` and
  // classifies as a block macro.
  test("E refuses a word closing a line that becomes a block macro", () => {
    expect(printingOf("t::", "alpha bravo charlie x[] y")).toBe("replay");
  });

  test.each(["x[", "x]", "x{}", "x()"])(
    "E does not refuse %s, which wraps and stays stable",
    (word) => {
      expect(printingOf("t::", `alpha bravo charlie ${word} y`)).toBe("reflow");
    },
  );

  test("E's second spelling carries the term head", () => {
    // interruptsByLineShape("t:: p x[]") is true and
    // interruptsByLineShape("p x[]") is false, so the danger is
    // visible only when the probe carries the item's own term head.
    // Symmetrically interruptsByLineShape("t:: p x{}") is false, which
    // is what keeps E from refusing the stable spellings. This row
    // pins both readings of the registry, so a later change that drops
    // the second spelling fails here and not in a width sweep.
    expect(interruptsByLineShape("t:: p x[]")).toBe(true);
    expect(interruptsByLineShape("p x[]")).toBe(false);
    expect(interruptsByLineShape("t:: p x{}")).toBe(false);
  });

  test("E's refusals come from the TERM line, not from a continuation", () => {
    // The same word in the same run under two term heads. `t::` makes
    // the wrapped term line `name:: target[attrlist]` and E refuses;
    // `a b::` cannot be a block macro (the name may hold no space),
    // so nothing refuses and the run reflows. That locates the whole
    // of E's measured surface in the term-line spelling: the
    // continuation spelling refuses no word today, because every
    // shape the registry tests is anchored at `^` and a line opening
    // with the probe prefix matches none of them. The row is here so
    // the inert half is a recorded fact rather than a guard a reader
    // believes is live.
    expect(printingOf("t::", "alpha bravo charlie x[] y")).toBe("replay");
    expect(printingOf("a b::", "alpha bravo charlie x[] y")).toBe("reflow");
  });

  // A per-word probe cannot see a bracket that OPENS in one word and
  // CLOSES in a later one, because neither spelling carries the
  // opener. `t:: [a b] ccc` at width 12 is clean under every per-word
  // test, wraps to `t:: [a b]` / `ccc`, is render-equal on pass 1, and
  // on pass 2 the description's tail leaves the dd: BLOCK_MACRO is
  // `name::target[attrlist]` with the target barred only from `[`, so
  // `t:: [a b]` parses as a block macro.
  test("E's pair clause refuses an opener closed by a later word", () => {
    expect(printingOf("t::", "[a b] ccc")).toBe("replay");
  });

  test("E's pair clause knowingly over-refuses a realistic xref", () => {
    // `t:: xref:x.adoc#p[P stylesheet section]` reads the same way,
    // and the clause cannot tell that no width actually reaches the
    // shape. One corpus row pays for this: the `pygments-css::` item
    // of the syntax-highlighting page, whose width sweep from 8 to 300
    // columns finds no width that loses a render or a fixed point. The
    // row is here so the cost is visible rather than discovered later.
    expect(printingOf("t::", "xref:x.adoc#p[P stylesheet section]")).toBe(
      "replay",
    );
  });

  // RED BEFORE THIS CLAUSE EXISTED: the run answered "reflow", and a
  // pack at width 9 (also 10 and 11) puts `:a a:` alone on line 2,
  // where the metadata loop drains it. ORACLE:
  // `t:: alpha :a a: bravo` renders `<p>alpha :a a: bravo</p>`, while
  // `t:: alpha` / `:a a:` / `bravo` renders `<p>alpha bravo</p>` and
  // sets a document attribute named `a a`. The words are DELETED, so
  // this is the same class as the bracket pair one notch over: an
  // attribute entry constrains a line at both ends, and no probe that
  // appends a fixed suffix or prepends a fixed prefix can see the two
  // halves in two words.
  test("the pair clause refuses an attribute entry written in two words", () => {
    expect(printingOf("t::", "alpha :a a: bravo")).toBe("replay");
    expect(printingOf("a b::", "alpha :a a: bravo")).toBe("replay");
  });

  test("an entry's halves alone do not refuse", () => {
    // A head with no later closer and a closer with no earlier head
    // are both ordinary text at every width, so the clause stays a
    // PAIR test rather than a ban on a colon.
    expect(printingOf("t::", "alpha :a bravo")).toBe("reflow");
    expect(printingOf("t::", "alpha a: bravo")).toBe("reflow");
  });

  // RED BEFORE THIS CLAUSE EXISTED. The term-head spelling of
  // endsDescriptionLine catches a word ending in `]` only when the
  // TERM is a legal macro name; `a b` is not, so `a b:: alpha
  // image::y x[]` answered "reflow". ORACLE: joined it renders
  // `<p>alpha image::y x[]</p>`; split after `alpha` it renders
  // `<p>alpha</p>` and an image block. The `name::` came from a word
  // of the description, which is exactly what a fixed probe prefix
  // erases.
  test("the pair clause refuses a block macro opened by a description word", () => {
    expect(printingOf("a b::", "alpha image::y x[]")).toBe("replay");
  });

  test("a macro head with no bracketed closer does not refuse", () => {
    expect(printingOf("a b::", "alpha image::y bravo")).toBe("reflow");
    expect(printingOf("a b::", "alpha bravo x[] y")).toBe("reflow");
  });

  test("the pair clause is what catches the CROSS-word case", () => {
    // A single word carrying both brackets is already refused by E's
    // per-word spelling, because `t:: p [ab]` is
    // `name:: target[attrlist]` under BLOCK_MACRO, whose target is
    // barred only from `[`. The pair clause exists for the opener and
    // the closer sitting in DIFFERENT words, which no per-word
    // spelling carries. Both replay; the row records WHICH clause
    // refuses each, so a later narrowing cannot delete one and believe
    // the other still covers it.
    expect(printingOf("t::", "alpha [ab] ccc")).toBe("replay");
    expect(printingOf("t::", "alpha [a b] ccc")).toBe("replay");
  });
});
