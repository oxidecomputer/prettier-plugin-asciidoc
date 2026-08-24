/**
 * How the blocks inside a list item are SPELLED back: a detached `+`
 * that an outer item took, and blocks the item keeps with no `+` at
 * all (Ruling 24 — the printer keeps the source's spelling and never
 * invents a `+`). Split from list-continuation.test.ts for size.
 */
import { describe, test, expect } from "vitest";
import { formatAdoc, renderedHtml } from "../helpers.js";

// A detached `+` inside a nested list belongs to the OUTERMOST item, but
// once the inner item keeps the line after it (a sibling or nested
// marker, a dlist term, a literal paragraph) Asciidoctor's outer loop
// sets `continuation = :inactive`, so a later blank-separated block is
// OUTSIDE the list. Pinned because the reader once left the outer
// continuation armed and pulled that block into the outer item.
describe("a detached + taken by an outer item is released by the inner item", () => {
  const cases: Array<[string, string]> = [
    ["sibling marker, then a paragraph", "* a\n** b\n\n+\n** c\n\npara\n"],
    ["literal paragraph, then a paragraph", "* a\n** b\n\n+\n  lit\n\npara\n"],
    [
      "sibling marker, then a listing",
      "* a\n** b\n\n+\n** c\n\n----\nx\n----\n",
    ],
    [
      "literal paragraph, then a listing",
      "* a\n** b\n\n+\n  lit\n\n----\nx\n----\n",
    ],
    ["dlist term, then a paragraph", "* a\n** b\n\n+\nterm:: d\n\npara\n"],
    [
      "two sibling markers, then a paragraph",
      "* a\n** b\n\n+\n** c\n** d\n\npara\n",
    ],
  ];
  for (const [name, input] of cases) {
    test(`${name} keeps the block outside the list`, async () => {
      const out = await formatAdoc(input);
      expect(renderedHtml(out)).toBe(renderedHtml(input));
      expect(await formatAdoc(out)).toBe(out);
    });
  }
});

// Ruling 24: a block the item keeps WITHOUT a `+` — a dlist term, a
// literal paragraph after a blank line, metadata and its block, a
// paragraph adjacent to an attached block — is printed in the source's
// own spelling. No `+` the author never wrote is invented.
describe("blocks an item keeps without a + keep the source spelling", () => {
  const cases: Array<[string, string]> = [
    ["an adjacent dlist term", "* a\nterm:: def\n* b\n"],
    ["a literal paragraph after a blank line", "* a\n\n  lit\n* b\n"],
    ["a dlist term after a blank line", "* a\n\nterm:: def\n"],
    ["metadata and its block", "* a\n[source]\ncode\n* b\n"],
    [
      "a paragraph adjacent to an attached block",
      "* a\n+\n----\nx\n----\nplain\n",
    ],
    [
      "an attribute entry after + and its paragraph",
      "* a\n+\n:x: y\npara\n* b\n",
    ],
    // A `//`-headed term must keep its own line: reflowed onto one
    // line it would be the item's last line, which Asciidoctor's
    // `skip_line_comments` drops (see the reader suite).
    ["a //-headed dlist term and its description", "* a\n///b::\nc\n"],
  ];
  for (const [name, input] of cases) {
    test(`${name} round-trips byte for byte`, async () => {
      const out = await formatAdoc(input);
      expect(out).toBe(input);
      expect(renderedHtml(out)).toBe(renderedHtml(input));
    });
  }
});

// Ruling 26: the source spelling is kept only where Asciidoctor's reading
// is independent of how many lines the item text occupies. Block
// metadata directly after reflowable item text, with no `+`, is NOT:
// `* a` / `[role]` / `para` folds `para` into the text, while `* a` /
// `para` / `[role]` / `para` ends the text and attaches a block — and
// reflow turns the second shape into the first. So the printer holds
// the text's last source break: a TEXT line stays on the item's first
// rest line, the re-reader's metadata drain meets `[role]` where the
// author put it, and no byte is invented. Counterfactual: these two
// used to print `* a para\n+\n[role]\npara\n` and
// `* a para\n+\n[[anc]]\npara\n` — a `+` line no author wrote.
describe("metadata directly after reflowable item text keeps the break", () => {
  test.each([
    [
      "an attribute line",
      "* a\npara\n[role]\npara\n",
      "* a\n  para\n[role]\npara\n",
    ],
    ["an anchor", "* a\npara\n[[anc]]\npara\n", "* a\n  para\n[[anc]]\npara\n"],
  ])("%s", async (_name, input, expected) => {
    const out = await formatAdoc(input);
    expect(out).toBe(expected);
    expect(renderedHtml(out)).toBe(renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
  // A block title on a later line of the item text is text to
  // Asciidoctor (`.T` does not interrupt an item's text), so it reflows.
  test("a block title on a later text line is text and reflows", async () => {
    const input = "* a\npara\n.T\npara\n";
    const out = await formatAdoc(input);
    expect(renderedHtml(out)).toBe(renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
  // On the FIRST line after the marker line the metadata folds the
  // paragraph into the item text (parse_block_metadata_lines runs
  // before the text is read), so no `+` may be invented there.
  test("metadata on the first line after the marker keeps its spelling", async () => {
    const input = "* a\n[role]\npara\n";
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    expect(renderedHtml(out)).toBe(renderedHtml(input));
  });
});

// A `+` the author wrote between metadata and its block is ALWAYS
// preserved, in source order; so is plan-1's `+` before the metadata.
describe("a + between metadata and its block is kept where it was", () => {
  test.each([
    ["metadata, +, block", "* a\n[role]\n+\n----\nx\n----\n"],
    ["metadata, +, metadata, block", "* a\n[role]\n+\n[role]\n----\nx\n----\n"],
    ["metadata, title, +, title", "* a\n[role]\n.T\n+\n.T\n"],
    ["in a later item", "* a\n* b\n[role]\n+\n----\nx\n----\n"],
    ["+, metadata, block (plan-1's form)", "* a\n+\n[role]\n----\nx\n----\n"],
  ])("%s round-trips byte for byte", async (_name, input) => {
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    expect(renderedHtml(out)).toBe(renderedHtml(input));
  });
});

// Two detached `+` in a row inside a nested list: the outer item erases
// only the LAST (`read_lines_for_list_item`'s scalar
// `detached_continuation`), so the inner item re-reads the first as its
// own detached `+` and takes the block. Both `+` lines are written back.
describe("stacked detached continuations in a nested list", () => {
  test("both + lines survive and the block stays in the inner item", async () => {
    const input = "* a\n** b\n\n+\n\n+\npara\n";
    expect(renderedHtml(input)).toMatch(
      /<li>.*<p>b<\/p>.*<p>para<\/p>.*<\/li>/v,
    );
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    expect(renderedHtml(out)).toBe(renderedHtml(input));
  });
});

// Comment transparency: `Reader#skip_line_comments`
// removes `//` lines before `parse_block_metadata_lines` counts, so comment
// lines are transparent to "the first line after the marker line": metadata
// under them still folds the block after it into the item text, and keeps
// its spelling.
describe("comment lines are transparent to the first-rest-line count", () => {
  test.each([
    "* a\n// c\n[role]\npara\n",
    "* a\n// c\n[[anc]]\npara\n",
    "* a\n// c\n// d\n[role]\n  lit\n",
    "* a\n// c\n// d\n[[anc]]\n  lit\n",
    "* a\n// c\n[role]\nNOTE: x\n",
    "* a\n// c\n// d\n[[anc]]\nNOTE: x\n",
  ])("%j round-trips byte for byte", async (input) => {
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    expect(renderedHtml(out)).toBe(renderedHtml(input));
  });
});

// A metadata group that ended multi-line item text keeps the text's
// last break whatever introduces the block after it — a `+` of its own
// included — and when it is TRAILING and longer than one line
// (reflowed onto the first rest line, its first line would fold and
// the rest become text).
describe("a metadata group that ended multi-line text keeps off the first rest line", () => {
  test("a block with its own + after the group", async () => {
    const input = "* a\npara\n[role]\n+\npara\n";
    const out = await formatAdoc(input);
    // The author's `+` replays verbatim from the gap; the printer adds
    // nothing above the run. Counterfactual: the old bytes were
    // "* a para\n+\n[role]\n+\npara\n", with an invented first `+`.
    expect(out).toBe("* a\n  para\n[role]\n+\npara\n");
    expect(renderedHtml(out)).toBe(renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
  test.each([
    "* a\npara\n[role]\n.T\n",
    "* a\npara\n[[anc]]\n.T\n",
    "* a\npara\n[role]\n[[anc]]\n",
    "* a\npara\n[[anc]]\n[role]\n",
    "* a\npara\n[role]\n[role]\n",
    "* a\npara\n[[anc]]\n[[anc]]\n",
    "* a\n.T\n[role]\n.T\n",
    "* a\n  lit\n[role]\n.T\n",
  ])("trailing group %j renders the same and is idempotent", async (input) => {
    const out = await formatAdoc(input);
    expect(renderedHtml(out)).toBe(renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
  // A single trailing metadata line folds harmlessly (it annotates
  // nothing either way), and a `+` before it would pull a block after the
  // list back in — so it keeps its spelling.
  test.each([
    "* a\npara\n[role]\n\n----\nx\n----\n",
    "* a\npara\n[role]\n\npara\n",
  ])("a single trailing metadata line %j keeps its spelling", async (input) => {
    const out = await formatAdoc(input);
    expect(renderedHtml(out)).toBe(renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});

// Ruling 28: a TRAILING run (no block follows within the item) that
// ended multi-line item text and carries a block title gets NO `+` — a
// `+` there re-parents whatever block follows the list within the
// continuation budget (`* a` / `para` / `[role]` / `.T` / blank / `== T`
// lost the section). Instead the item's text keeps its last source-line
// break, so the run never lands on the first rest line: render-equal and
// idempotent, with the kept line indented the way every item
// continuation line is.
describe("a trailing titled run keeps the text's last line break", () => {
  test("the kept break is the source's own", async () => {
    const input = "* a\npara\n[role]\n.T\n";
    const out = await formatAdoc(input);
    expect(out).toBe("* a\n  para\n[role]\n.T\n");
    expect(renderedHtml(out)).toBe(renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
  test.each([
    "* a\npara\n[role]\n.T\n\n== T\n\npara\n",
    "* a\npara\n[role]\n.T\n\n----\nx\n----\n",
    "* a\npara\n[role]\n.T\n\npara\n",
    "* a\npara\n[[anc]]\n.T\n\npara\n",
    "* a\npara\n[role]\n.T\n\n** n\n",
    "* a\npara\n[[anc]]\n.T\n\n----\nx\n----\n",
    "* a\n.T\n[role]\n.T\n\npara\n",
    "* a\n  lit\n[role]\n.T\n\n== T\n\npara\n",
  ])("%j renders the same and is idempotent", async (input) => {
    const out = await formatAdoc(input);
    expect(renderedHtml(out)).toBe(renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
  test("a following section survives", async () => {
    const input = "* a\npara\n[role]\n.T\n\n== T\n\npara\n";
    const out = await formatAdoc(input);
    expect(renderedHtml(out)).toContain("<h2");
    expect(out).toBe("* a\n  para\n[role]\n.T\n\n== T\n\npara\n");
  });
  test("single-line item text is untouched", async () => {
    const input = "* a\n[role]\n.T\n";
    expect(await formatAdoc(input)).toBe(input);
  });
});

// A comment that consumed the `+` still leaves the paragraph after it
// in the "after a `+`" reading (Ruby's erased `+` is a blank line, so
// `skipped > 0` and no list marker breaks the paragraph): `** n` is text.
describe("a paragraph after a comment-consumed + is read as a continuation", () => {
  test("a foreign marker in it stays text", async () => {
    const input = "* a\n+\n// c\npara\n** n\n";
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    expect(renderedHtml(out)).toBe(renderedHtml(input));
  });
});

// Ruling 29: the kept break is decided at paragraph level — the last
// soft separator of the flattened item text is hardened — so it holds
// whatever begins the last source line: a formatting span, an inline
// macro or URL, block syntax such as an admonition label.
describe("the kept break holds whatever begins the text's last line", () => {
  test.each([
    "* Install the tool and then\n`cargo build` finishes the job\n[source]\n.Build steps\n",
    "* See the guide\nhttps://example.com/docs[the docs] cover it\n[role]\n.More\n",
    "* a\nNOTE: x\n[role]\n.T\n",
    "* a\n*b* c\n[role]\n.T\n",
    "* a\n_i_ t\n[[anc]]\n.T\n",
  ])("%j renders the same and is idempotent", async (input) => {
    const out = await formatAdoc(input);
    expect(renderedHtml(out)).toBe(renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});

// A hard line break that ends the item text prints no trailing break of
// its own: the next block's lead supplies it, and a second one opened the
// following lines with a blank that grew on every pass.
describe("a hard line break ending the item text", () => {
  test.each(["* a\npara +\n[role]\n.T\n", "* a\npara +\n", "text +\n\nnext\n"])(
    "%j renders the same and is idempotent",
    async (input) => {
      const out = await formatAdoc(input);
      expect(renderedHtml(out)).toBe(renderedHtml(input));
      expect(await formatAdoc(out)).toBe(out);
    },
  );
});

// Ruling 30: the kept break must be a separator that has CONTENT after
// it. When the item's last text line ends in whitespace, the inline
// printer appends a trailing `line` separator (pushTrailingBoundary), so
// hardening the LAST separator hardened that trailing one — printing a
// blank line after the item text, which detaches the metadata run that
// the break exists to keep attached.
describe("a text line ending in whitespace still keeps a break with content after it", () => {
  const followers: Array<[string, string]> = [
    ["a paragraph the run titles", "para\n"],
    ["a listing the run titles", "----\nx\n----\n"],
    ["a literal block the run titles", "....\nlit\n....\n"],
    ["a sibling item", "* s\n"],
    ["a section", "== T\n\npara\n"],
    ["a blank line then a paragraph", "\npara\n"],
  ];
  const metadata = ["[role]\n.T", "[source]\n.T", "[[anc]]\n.T"];
  const spaces: Array<[string, string]> = [
    ["space", " "],
    ["tab", "\t"],
  ];
  const cases: Array<[string, string, string, string]> = [];
  for (const [what, follower] of followers) {
    for (const meta of metadata) {
      for (const [wsName, ws] of spaces) {
        cases.push([wsName, meta, what, `* a\nb c${ws}\n${meta}\n${follower}`]);
      }
    }
  }
  test.each(cases)(
    "trailing %s before %j, then %s, renders the same and is idempotent",
    async (_ws, _meta, _what, input) => {
      const out = await formatAdoc(input);
      expect(renderedHtml(out)).toBe(renderedHtml(input));
      expect(await formatAdoc(out)).toBe(out);
    },
  );
});

// The reader eats a directive or a comment line, so the block the
// source put on the very next line belongs to the same run — even when
// the eaten line is the last thing INSIDE a list item and the block
// that follows it is a top-level sibling. A blank line inserted there
// is not cosmetic: it is a line the parser would still be reading.
describe("a reader-eaten line ending a list item", () => {
  test.each([
    "* a\n+\nifdef::backend[]\n----\nx\n----\n",
    "* a\n+\n// c\n----\nx\n----\n",
    "* a\n+\nifdef::backend[]\n== T\n\ntext\n",
    "* a\nifdef::backend[]\n....\nlit\n....\n",
    "* a\n// c\n....\nlit\n....\n",
    ". a\n+\n// c\n....\nlit\n....\n",
  ])("%j round-trips byte for byte", async (input) => {
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    expect(renderedHtml(out)).toBe(renderedHtml(input));
  });
});

// Spec review F1 (tier-1 at the baseline): `within_nested_list`
// blocks BOTH erasures, so both `+` lines reach the nested item and
// Ruby/the oracle put `para` in b. The baseline reader put it in a and
// printed `* a\n** b\n\n+\npara\n`, which renders differently.
// Extent-first fixes it by construction; the round-trip is byte-exact
// because the printer replays the gap.
describe("F1: suspended continuations reach the nested item", () => {
  test("* a / ** b / + / blank / + / para round-trips and renders like the source", async () => {
    const input = "* a\n** b\n+\n\n+\npara\n";
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    expect(renderedHtml(out)).toBe(renderedHtml(input));
  });
});
// Review round 1, blockers B1 and B2: the spelling the printer emits
// for a trailing `+` run must be a FIXED POINT of format∘parse. The
// finish rule (list-reader.ts) reports a popped `+` only where the
// reprint pops identically — at a safe boundary (EOF, a sibling, an
// enclosing terminator) or directly under this item's own frozen `+`
// raw line — because everywhere else a reprinted `+` ends up above a
// blank line, ERASES on re-read, and either arms (attaching the block
// after the list) or shrinks the run one `+` per pass. Each row pins
// the whole contract: render-equality against the input, and
// byte-stability of the first output.
describe("trailing +-run spellings are fixed points (review B1/B2)", () => {
  test.each([
    // B1: the popped `+` of a NESTED item (its stream end is the outer
    // buffer, not the document) must not re-arm — `para` stays outside.
    ["B1: nested pop before blank+para", "* a\n** b\n+\n+\n\npara\n"],
    ["B1: two levels down", "* a\n** b\n*** c\n+\n+\n\npara\n"],
    ["B1: ordered flavor", ". a\n.. b\n+\n+\n\npara\n"],
    ["B1: a listing follows", "* a\n** b\n+\n+\n\n----\nx\n----\n"],
    ["B1: a section follows", "* a\n** b\n+\n+\n\n== Sec\n"],
    ["B1: multi-line item text", "* a\n** b\n  lit\n+\n+\n\npara\n"],
    ["B1: metadata follows", "* a\n** b\n+\n+\n\n[role]\npara\n"],
    // B1's flat cousin: a pop directly before a delimiter reprints
    // above the joiner's blank line and would attach the listing.
    ["B1: pop directly before a delimiter", "* a\n+\n+\n----\nx\n----\n"],
    // B2: a frozen run of three `+` is byte-stable (the popped third
    // prints under the kept second, which re-freezes it), while the
    // run of two collapses to zero in ONE pass (its erased first `+`
    // is invisible — it sits in no gap — so the pair cannot reprint).
    ["B2: triple + before blank+para", "* a\n+\n+\n+\n\npara\n"],
    ["B2: triple + before a sibling", "* a\n+\n+\n+\n\n* a\n"],
    ["B2: detached triple + before a sibling", "* a\n\n+\n+\n+\n\n* a\n"],
    ["B2: triple + after a comment line", "* a\n// c\n+\n+\n+\n\npara\n"],
    ["B2's one-pass collapse", "* a\n+\n+\n\npara\n"],
  ])("%s", async (_name, input) => {
    const once = await formatAdoc(input);
    const twice = await formatAdoc(once);
    expect(twice).toBe(once);
    expect(renderedHtml(once)).toBe(renderedHtml(input));
  });
});

// Review round 1, blocker B3: the blank the baseline invented before an
// in-item nested list is load-bearing where a literal paragraph's
// re-read slurp (`read_lines_until break_on_blank_lines`) would run
// through adjacent metadata into the marker — and past the item's end
// into the NEXT item's marker. printedGap re-invents exactly that
// blank (`slurpReaches`), and the re-parsed gap [""] then replays
// verbatim: idempotent by construction.
describe("a literal's slurp cannot swallow a following nested marker (review B3)", () => {
  test("lit, [role], nested marker, then a sibling", async () => {
    const input = "* a\n\n  lit\n[role]\n** b\n\n* a\n";
    const once = await formatAdoc(input);
    expect(once).toBe("* a\n\n  lit\n[role]\n\n** b\n* a\n");
    expect(renderedHtml(once)).toBe(renderedHtml(input));
    expect(await formatAdoc(once)).toBe(once);
  });
});

// The plan's one full mutation pass found four rules whose one-line
// mutation changed real bytes while every test still passed: the corpus
// carried three of them and the sweep saw the fourth, but the sweep
// asserts RENDER-equality, and each of these mutants happens to stay
// render-equal. So the byte is the assertion. The comment on each row
// is the mutant's own output, measured by applying the mutation and
// re-formatting.
describe("byte pins for rules only the corpus and the sweep reached", () => {
  test.each([
    // `within_nested_list` set by the AFTER-BLANK nestable arm
    // (parser.rb l.1519-21), not only by the final else: without it
    // the outer scan erases the `+` that belongs to the inner list and
    // the author's line vanishes — mutant: "* a\n\n** b\n** b\n".
    [
      "the after-blank nestable arm sets within_nested_list",
      "* a\n\n** b\n+\n** b\n",
      "* a\n\n** b\n+\n** b\n",
    ],
    // endsWithLiteralParagraph looks THROUGH a trailing nested list —
    // the previous item's last printed thing is the literal inside
    // `** b`, so the sibling still needs the blank line that stops the
    // literal's re-read slurp (B3, one level down). Mutant without the
    // nested-list arm: "* a\n\n** b\n[role]\n  lit\n* a\n", whose
    // second pass moves the marker into the literal.
    [
      "a literal ending a nested list still separates the siblings",
      "* a\n\n** b\n[role]\n  lit\n* a\n",
      "* a\n\n** b\n[role]\n  lit\n\n* a\n",
    ],
    // printedGap invents its blank only for an EMPTY gap: here the gap
    // is ["+"] and that `+` is the author's, so it must be replayed.
    // Mutants that drop the gap-emptiness test print the blank
    // instead: "* a\n  .T\n[role]\n\n** b\n", which re-reads the
    // nested list as a detached block of no item. Counterfactual: the
    // old bytes were "* a .T\n+\n[role]\n+\n** b\n", whose first
    // `+` the printer invented.
    [
      "a +-gapped nested list keeps its +, and the text keeps its break",
      "* a\n.T\n[role]\n+\n** b\n",
      "* a\n  .T\n[role]\n+\n** b\n",
    ],
    // …and only where a literal's slurp really reaches: a metadata run
    // directly above an ADJACENT nested list gets no blank at all.
    // Mutants that default slurpReaches to true invent one:
    // "* a\n[role]\n\n** b\n".
    [
      "an adjacent nested list under metadata gets no blank",
      "* a\n[role]\n** b\n",
      "* a\n[role]\n** b\n",
    ],
    // Ruling 64 is about `//` LINES (Reader#skip_line_comments), never
    // a `////` comment BLOCK: the block is a block of the item, so it
    // follows the leading metadata run and the hazard keeps the
    // item's own break.
    // Mutants that make isLineComment admit comment blocks read
    // through it and drop the kept break:
    // "* a para\n[role]\n+\n////\nc\n////\n", where `[role]` on the
    // first rest line folds the comment into the item text.
    // Counterfactual: the old bytes were
    // "* a para\n+\n[role]\n+\n////\nc\n////\n".
    [
      "a comment BLOCK behind the run is a block that follows it",
      "* a\npara\n[role]\n+\n////\nc\n////\n",
      "* a\n  para\n[role]\n+\n////\nc\n////\n",
    ],
    // slurpReaches stops at the first NON-EMPTY gap: the literal is
    // three blocks back but a `+` stands between it and the nested
    // list, so the literal's re-read slurp cannot reach the marker and
    // no blank is invented. Mutant without the stop:
    // "* a\n\n  lit\n+\npara\n[role]\n\n** b\n".
    [
      "a + between the literal and the marker ends the slurp's reach",
      "* a\n\n  lit\n+\npara\n[role]\n** b\n",
      "* a\n\n  lit\n+\npara\n[role]\n** b\n",
    ],
    // isRunMetadata takes a paragraph for an ANCHOR only when the
    // anchor is its ONE child (anchorLineShape, block-metadata.ts):
    // `[[anc]] x` is an anchor child plus a text child, so it is
    // content, the run ends at `[role]`, and the block that follows
    // makes the run keep the text's break. Mutant without the
    // child-count guard reads the paragraph as run metadata:
    // "* a b\n[role]\n[[anc]] x para\n". Counterfactual: the old
    // bytes were "* a b\n+\n[role]\n[[anc]] x para\n".
    [
      "an anchor followed by text is content, not run metadata",
      "* a\nb\n[role]\n[[anc]] x\npara\n",
      "* a\n  b\n[role]\n[[anc]] x para\n",
    ],
    // A non-empty gap ends the run wherever it stands: the title's gap
    // is ["+", ""], so the run is just `[role]`, the title is a block
    // that follows, and the text keeps its break. Every line of the
    // gap replays verbatim — the `+` and the blank both.
    // Counterfactual: the old bytes were
    // "* a b\n+\n[role]\n+\n\n.T\n".
    [
      "a + and a blank is not the run's own +",
      "* a\nb\n[role]\n+\n\n.T\n",
      "* a\n  b\n[role]\n+\n\n.T\n",
    ],
  ])("%s", async (_name, input, expected) => {
    const once = await formatAdoc(input);
    expect(once).toBe(expected);
    expect(renderedHtml(once)).toBe(renderedHtml(input));
    expect(await formatAdoc(once)).toBe(once);
  });

  // The same family, one row apart: slurpReaches walks the blocks
  // BEFORE the nested list, never the ones after it. Here the item's
  // last block (`para`, behind a `+`) would stop a backwards walk that
  // started at the end, so a mutant walking all the blocks answers
  // false and drops the blank the literal needs.
  //
  // No render-equality assertion, and here is the anchor for that: this
  // shape belongs to the LITERAL-INDENT family that list-shape-sweep's
  // FAILING_TODAY names ("`  lit` runs the reader re-shapes",
  // pre-existing, tracked by the conformance issues) — its shorter
  // cousin "* a\npara\n[role]\n  lit\n** b\n.T\n" is one of that
  // allowlist's 14. This document itself is NOT in the sweep's document
  // set: the alphabet's exhaustive part stops at suffix length 3 and its
  // seeded part draws 4-5, and this is a 6-symbol suffix, which is why
  // the row lives here rather than in the allowlist.
  //
  // Pre-existing, verified rather than assumed: the same input at
  // baseline c331bfbd (materialized with `git archive`) formats to the
  // BYTE-IDENTICAL "* a\n\n  lit\n[role]\n\n** b\n+\npara\n", is
  // idempotent there, and already fails render-equality there. So head
  // changes nothing about this shape; the byte and the fixed point are
  // what this row pins, and the rendering gap is the family's, not
  // this plan's.
  test("the slurp walk starts at the nested list, not at the item's end", async () => {
    const input = "* a\n\n  lit\n[role]\n** b\n+\npara\n";
    const once = await formatAdoc(input);
    expect(once).toBe("* a\n\n  lit\n[role]\n\n** b\n+\npara\n");
    expect(await formatAdoc(once)).toBe(once);
  });
});

// A `[[…]]` line whose id fails the block-anchor grammar
// (BLOCK_ANCHOR_SOURCE, parse/line-shapes.ts; behavior is Ruby's
// `BlockAnchorRx`) is an ordinary PARAGRAPH, and the printer emits its
// bytes back faithfully — so the RE-READER sees a text line there too.
// The item's held-back metadata run therefore ENDS before it
// (isRunMetadata → anchorLineShape, block-metadata.ts): the lookalike
// is a block that follows the run, the hazard answers `keepBreak`, and
// the item's text holds its last source break. What decides
// membership is what the PRINTED line re-reads as, which is why
// `[[id,]]` — printed `[[id]]`, an anchor on re-read — stays in the
// run while `[[3-bad]]` does not.
//
// REPRESENTATIVE rows, not the whole class: a 180-row differential (30
// item shape families × 6 anchor spellings) against the pre-record
// bytes moved on 15 rows over 3 families here, and the reviewer's own
// matrix on 55 rows over 11 — one mechanism, four spellings of it
// pinned. The valid-id control (`[[anc]]`) never moved: it is a
// blockAnchor node and was covered all along.
describe("a pseudo-anchor line ends an item's metadata run", () => {
  const cases: Array<[string, string, string]> = [
    // The repro family. Counterfactual: the old bytes folded the
    // metadata onto the first rest line — "* a para\n[role]\n[[3-bad]]\n"
    // — and the drain then read the pseudo paragraph into the item
    // text, which renders unlike the input.
    [
      "digit-leading id after [role] holds the text's break",
      "* a\npara\n[role]\n[[3-bad]]\n",
      "* a\n  para\n[role]\n[[3-bad]]\n",
    ],
    // A title in the run and a hazard that keeps the item's own break:
    // the arm also decides the item TEXT's shaping. Without it:
    // "* a b\n+\n[role]\n.T\n[[3-bad]]\n".
    [
      "[role] + .T + a pseudo-anchor keeps the run and the item's break",
      "* a\nb\n[role]\n.T\n[[3-bad]]\n",
      "* a\n  b\n[role]\n.T\n[[3-bad]]\n",
    ],
    // Illegal character rather than a leading digit, in an ORDERED
    // item: the grammar's other rejection, the other list variant.
    // Counterfactual: the old bytes were
    // ". o para\n[role]\n[[illegal$id]]\n".
    [
      "illegal-character id in an ordered item, the same way",
      ". o\npara\n[role]\n[[illegal$id]]\n",
      ". o\n  para\n[role]\n[[illegal$id]]\n",
    ],
    // `[[id,]]` is not an anchor line either (the reftext alternative
    // needs a character after the comma) and it PRINTS as `[[id]]`,
    // which IS one on re-parse — so the run must keep it or the second
    // pass would answer the hazard differently.
    [
      "an empty-reftext anchor prints as [[id]] and stays in the run",
      "* a\npara\n[role]\n[[id,]]\n",
      "* a para\n[role]\n[[id]]\n",
    ],
  ];
  test.each(cases)("%s", async (_name, input, expected) => {
    const once = await formatAdoc(input);
    expect(once).toBe(expected);
    expect(await formatAdoc(once)).toBe(once);
  });

  // The lookalike rows are a CORRUPTION fix, so their proof direction
  // is head against the ORIGINAL INPUT — the old bytes read
  // differently, and comparing against them would prove nothing. The
  // `[[id,]]` row is excluded: its printed `[[id]]` is a live anchor
  // where the author's `[[id,]]` was literal text, a pre-existing
  // narrowing this suite freezes rather than fixes.
  test.each(cases.filter(([name]) => !name.includes("empty-reftext")))(
    "%s renders like its input",
    async (_name, input) => {
      expect(renderedHtml(await formatAdoc(input))).toBe(renderedHtml(input));
    },
  );
});
