/**
 * hazard(item) - a pure predicate over the finished node, answering
 * with the BREAK the item's text must keep so the item's first rest
 * line reads as the author's own did: `"hard"` (a held break at the
 * item's continuation indent), `"literal"` (the same break at column
 * 0, where a ` +` in the text would otherwise lose the space that
 * makes it one) and `"none"` (replay the gap verbatim). The printer
 * never invents a continuation line. The rows below mirror
 * tests/format/list-item-blocks.test.ts and list-continuation.test.ts,
 * which pin the same facts as bytes. The argument for the answers is
 * stated once, in src/print/list-hazard.ts's module comment; it is not
 * re-derived here or in those suites.
 */
import { describe, expect, test } from "vitest";
import type { ListItemNode } from "../../src/ast.js";
import { hazard } from "../../src/print/list-hazard.js";
import { parse } from "../../src/parser.js";
import { formatAdoc, renderedHtml } from "../helpers.js";

/**
 * The first list item of a parsed document.
 * @param source - a document whose first block is a list
 * @returns its first item
 * @throws {Error} when the first block is not a list — a broken row
 *   input, which must say so rather than assert on the wrong node
 */
function firstItem(source: string): ListItemNode {
  const { children } = parse(source);
  const [list] = children;
  if (list.type !== "list") {
    throw new Error("expected a list");
  }
  const { children: items } = list;
  const [item] = items;
  return item;
}

describe("hazard", () => {
  test.each([
    // Single-line text: metadata on the first rest line reads as
    // metadata after reflow too — keep the spelling (the "more than
    // one line" clause; pinned: "metadata and its block").
    ["* a\n[role]\npara\n", "none"],
    // Multi-line text, metadata run, block follows: hold the text's
    // last break, so a TEXT line lands on the first rest line and the
    // re-reader's drain meets the run where the author wrote it
    // (pinned by the list-continuation suite).
    ["* a\nb\n[role]\npara\n", "hard"],
    ["* a\nb\n[[anc]]\npara\n", "hard"],
    ["* a\nb\n[role]\n.T\npara\n", "hard"],
    // Trailing run with no title: a reflowed [role] on the first rest
    // line is still read as metadata — nothing to compensate for.
    ["* a\nb\n[role]\n", "none"],
    // A bare `.T` under item text is not metadata at all: BLOCK_TITLE
    // is in no interrupting set (Ruby's StartOfBlockProc), so it folds
    // into the item TEXT — zero blocks, no run, no hazard. Measured:
    // astShape = item(t / t / t), formatAdoc → "* a b .T\n".
    ["* a\nb\n.T\n", "none"],
    // Trailing run carrying a block title: keep the text's last break
    // (pinned at list-item-blocks "single-line item
    // text is untouched" / the `.T` re-parse rows).
    ["* a\nb\n[role]\n.T\n", "hard"],
    ["* a\n  para\n[role]\n.T\n", "hard"],
    // The listing does NOT enter the item (continuation is :inactive
    // at the `----` line, so l.1455-56 breaks the extent): the run is
    // TRAILING and carries a title -> "hard".
    ["* a\nb\n[role]\n.T\n----\nx\n----\n", "hard"],
    // An AUTHOR-written `+` ends the run: the run's members must each
    // be strictly adjacent, and a `+` in the gap means the gap already
    // speaks. The `+`-separated metadata line is therefore a FOLLOWER
    // — a block of the item after the run — and the run is held back
    // with a kept break. The `+` itself replays verbatim from the gap;
    // the printer adds nothing.
    ["* a\npara\n[role]\n+\n[role]\n", "hard"],
    // Same answer as before this rule, new reason: the `.T` behind the
    // `+` FOLLOWS the run rather than joining it and carrying a title
    // into it.
    ["* a\npara\n[role]\n+\n.T\n", "hard"],
    ["* a\n.T\n[[anc]]\n+\n.T\n", "hard"],
    // A `+`-separated block that is not metadata follows the run the
    // same way — one rule, no special case.
    ["* a\npara\n[role]\n+\npara\n", "hard"],
    // A `+`-separated line COMMENT is transparent to the follows
    // count, so nothing follows the run and the run
    // carries no title: no compensation.
    ["* a\npara\n[role]\n+\n// c\n", "none"],
    // …but a `////` comment BLOCK is not transparent:
    // `skip_line_comments` skips `//` LINES only, so the block is a
    // block of the item that follows the run (found by a mutation
    // pass — the mutants that let a comment block through
    // here changed real bytes and were killed by no test; also pinned
    // as bytes at list-item-blocks "a comment BLOCK behind the run").
    ["* a\npara\n[role]\n+\n////\nc\n////\n", "hard"],
    ["* a\npara\n[role]\n// c\n+\n.T\n", "hard"],
    // Line comments are transparent to the BLOCK side of the decision
    // too, not only to the first-rest-line count: the run reads
    // straight through a `// c` when it decides whether the run is
    // trailing, so these four rows pin both answers across one.
    ["* a\nb\n[role]\n// c\n", "none"],
    ["* a\nb\n[role]\n.T\n// c\n", "hard"],
    ["* a\nb\n[role]\n// c\n.T\n", "hard"],
    ["* a\nb\n[role]\n// c\npara\n", "hard"],
    // Comment lines are transparent to the first-rest-line count
    // (Reader#skip_line_comments; pinned at list-item-blocks:152-160).
    ["* a\n// c\n[role]\npara\n", "none"],
    ["* a\n// c\n// d\n[[anc]]\n  lit\n", "none"],
    // A directive inside the text keeps its own line, so reflow can
    // never push the metadata onto the first rest line.
    ["* a\nifdef::x[]\nb\n[role]\npara\n", "none"],
    // A `+` above the run: the gap speaks, no hazard (the run is not
    // directly under the text).
    ["* a\n+\n[role]\n----\nx\n----\n", "none"],
    // A blank above the run: same.
    ["* a\n\n[role]\n  lit\n", "none"],
    // No metadata at all.
    ["* a\nb\npara\n", "none"],
    ["* a\n", "none"],
    // Decision 2: a `// c` reaching the first rest line leaves
    // `next_block`'s blank count at zero although a `+` follows it, so
    // the attached paragraph breaks at a nested marker it used to
    // swallow. Hold a text line in front of it.
    ["* a\nb\n// c\n+\npara\n", "hard"],
    ["* a\nb\n// c\n\n  lit\n", "hard"],
    // ...and only where a separator line follows: with the block
    // ADJACENT to the comment the count is zero either way.
    ["* a\nb\n// c\npara\n", "none"],
    // The comment must be one reflow can MOVE there: with the item's
    // text all on the marker line it already stands there.
    ["* a\n// c\n+\npara\n", "none"],
    // Decision 3: a ` +` the source gave a line of its own is
    // INDENTED, and an indented first rest line sends the whole block
    // down the arm that strips its indentation - taking the space that
    // makes the ` +` a line break. The held break stands at column 0
    // for the same reason: the strip takes the block's least indent.
    ["* a\nb\n +\n", "literal"],
    // The drain reads THROUGH a `//` line, so the ` +` behind one is
    // still what the indent test meets.
    ["* a\nb\n// c\n +\n", "literal"],
    // ...but only where the strip would actually take the ` +`'s space.
    // An unindented line anywhere in the text nils the block indent
    // (parser.rb l.2727-2729), so the break survives on both sides and
    // the join must still be refused...
    ["* a\n  lit\npara\n +\n", "literal"],
    // ...while a text whose every line is indented has ALREADY been
    // stripped, on the source as on the output: nothing to hold, and a
    // column-0 hold would flip the reading the other way.
    ["* a\n  lit\n// c\n +\n", "none"],
    ["* a\n  lit\n +\n", "none"],
    // An item whose text is one marker line has the ` +` in the
    // deciding position already; reflow can move nothing off it.
    ["* a lit\n// c\n +\n", "none"],
    // A ` +` that closes a line of TEXT prints at that line's end, not
    // on one of its own, so nothing moves onto the first rest line.
    ["* a\nb +\nc\n", "none"],
    // A ` +` on the item's own marker line is where the source put it.
    ["* a +\nb\n", "none"],
    // The lines the strip measures are the SOURCE's, and a construct
    // broken across two of them is one node holding both: the answer
    // comes off the item's recorded lines, so the continuation line's
    // own column decides it, indented...
    ["* a\n  +++b\n  c+++ d\n +\n", "none"],
    // ...or at column 0.
    ["* a\n  +++b\nc+++ d\n +\n", "literal"],
  ])("%j → %s", (source, expected) => {
    expect(hazard(firstItem(source))).toBe(expected);
  });
});

/**
 * The item's FIRST REST LINE - the line directly under the marker
 * line - is where the re-reader makes three of its decisions, and
 * reflow packs the item's principal text onto the marker line, so
 * whatever the source wrote under that text moves up into the
 * deciding position. `hazard` (src/print/list-hazard.ts) names the
 * three; these rows are the bytes for the two the printer used to get
 * wrong, each formatted twice and rendered on both sides so the row
 * asserts the reading and not just a spelling.
 */
describe("a reflowed list item keeps a text line on its first rest line", () => {
  // Issue #57. Joined, the `// c` lands on the item's first buffer
  // line, where the metadata loop eats it and leaves `next_block`'s
  // blank count at zero (parser.rb l.505, read at l.764) - so the
  // `+`-attached paragraph breaks at `** b` instead of swallowing it,
  // and the oracle renders a nested list the source never had.
  test("a comment reaching the first rest line is refused", async () => {
    const input = "* a\nX\n// c\n+\npara\n** b\n";
    const out = await formatAdoc(input);
    expect(out).toBe("* a\n  X\n// c\n+\npara\n** b\n");
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  // Issue #33. Joined, the ` +` lands there instead, and an indented
  // first line sends the block down the arm that strips its
  // indentation (parser.rb l.572, l.753-755) - the space that makes
  // the ` +` a line break goes with it, and the second pass then
  // rewrites the bare `+` to `{plus}`. The held break stands at
  // COLUMN 0, because the strip takes the whole block's least indent.
  test("a hard-break line reaching the first rest line is refused", async () => {
    const input = "* a\na\n +\n";
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  // The other direction, and the one that keeps the rule honest: a
  // trailing anchor and the indented line under it are a LATER
  // block's metadata, not the item's first rest line, so the join
  // stands and the paragraph reflows.
  test("a trailing anchor and indented line keep their reading, and the join stands", async () => {
    const input = "* a\n[role]\npara\npara\n[[anc]]\n  lit\n";
    const out = await formatAdoc(input);
    expect(out).toBe("* a\n[role]\npara para\n[[anc]]\n  lit\n");
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  // The reader DRAINS a `//` line before any of the three decisions is
  // taken, so the walk has to read through one exactly as the drain
  // does: the ` +` behind the comment is still what the indent test
  // meets.
  test("a comment does not hide the hard-break line behind it", async () => {
    const input = "* a\nb\n// c\n +\n";
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  // The strip decision 3 fires is all-or-nothing over the block: an
  // unindented line anywhere nils the block indent, so the ` +` keeps
  // its space on both sides and the join is still refused; a text
  // whose every line is indented was stripped already, and holding a
  // line at column 0 would flip the reading the other way.
  test.each([
    [
      "an unindented line nils the strip",
      "* a\n  lit\npara\n +\n",
      "* a lit\npara\n +\n",
    ],
    [
      "every line indented, stripped already",
      "* a\n  lit\n// c\n +\n",
      "* a lit\n// c\n +\n",
    ],
  ])("the strip is all-or-nothing: %s", async (_name, input, expected) => {
    const out = await formatAdoc(input);
    expect(out).toBe(expected);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  // The lines the strip measures are SOURCE LINES, and the item's text
  // children are fragments of them: a line a formatting span or a
  // macro OPENS leaves the fragment behind it beginning with the
  // separator space. Read per child that space is an indent, the strip
  // looks as though it already fired, and the refusal is withheld -
  // these lines start at column 0 and the ` +` is a break.
  test.each([
    ["a formatting span", "* a\n*b* tail\n +\n"],
    ["a link macro", "* a\nhttps://e.com[x] tail\n +\n"],
    ["a monospace span", "* a\n`c` tail\n +\n"],
    ["a mail macro", "* a\nmailto:a@b.c[a] tail\n +\n"],
    ["a span above an indented tail", "* a\n*b* tail\n +\n  lit\n"],
    [
      "a link above an indented tail",
      "* a\nhttps://e.com[x] tail\n +\n  lit\n",
    ],
    ["a monospace span above an indented tail", "* a\n`c` tail\n +\n  lit\n"],
  ])("a line OPENED by %s starts at column 0", async (_name, input) => {
    const out = await formatAdoc(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  // A construct that SPANS two source lines closes one and opens
  // another. Reconstructed without those newlines the two merge, the
  // continuation line at column 0 disappears into the indented line
  // above it, and the strip looks as though it fired - so the refusal
  // is withheld and the ` +` stops being a break.
  test.each([
    ["a formatting span", "* a\n  *b\nc* d\n +\n"],
    ["a monospace span", "* a\n  `b\nc` d\n +\n"],
    ["a link macro", "* a\n  https://e.com[b\nc] d\n +\n"],
    ["a span under an indented line", "* a\n  x\n  *b\nc* d\n +\n"],
  ])("a continuation line of %s starts at column 0", async (_name, input) => {
    const out = await formatAdoc(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  // ...and the same construct with the continuation line the AUTHOR
  // indented is the other side of it: every line of that text IS
  // indented, the strip already fired on the source, and refusing the
  // join writes a line at column 0 that CANCELS the strip the source
  // had (parser.rb l.2727-2729) - so over-refusing loses the reading
  // just as surely as under-refusing does. The bytes are pinned here
  // because this shape is a fixed point as well.
  test("a passthrough across two indented lines keeps its reading", async () => {
    const input = "* a\n  +++b\n  c+++ d\n// c\n +\n";
    const out = await formatAdoc(input);
    expect(out).toBe("* a +++b\n  c+++ d\n// c\n +\n");
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  // The rest of that class, by construct and by what surrounds it.
  // The READING is what these rows assert: three of them are not
  // fixed points at the task base either, because a ` +` alone under
  // joined text is retyped on the way back in (issue #33 shapes 1 and
  // 3, parse-side and outside this rule).
  test.each([
    ["a passthrough", "* a\n  +++b\n  c+++ d\n +\n"],
    ["a link macro", "* a\n  https://e.com[b\n  c] d\n +\n"],
    ["a mail macro", "* a\n  mailto:a@b.c[b\n  c] d\n +\n"],
    [
      "a link above an indented line",
      "* a\n  https://e.com[b\n  c] d\n  x\n +\n",
    ],
    [
      "a mail macro above a comment",
      "* a\n  mailto:a@b.c[b\n  c] d\n// c\n +\n",
    ],
    [
      "a passthrough under an indented line",
      "* a\n  x\n  +++b\n  c+++ d\n +\n",
    ],
    [
      "a passthrough above an indented line",
      "* a\n  +++b\n  c+++ d\n  x\n +\n",
    ],
    ["a formatting span", "* a\n  *b\n  c* d\n +\n"],
    ["a monospace span", "* a\n  `b\n  c` d\n +\n"],
  ])(
    "an indented continuation line of %s keeps its reading",
    async (_name, input) => {
      const out = await formatAdoc(input);
      expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    },
  );

  // The held break at COLUMN 0 is a line start like any other, so the
  // run it opens may not be block syntax there. `[https://example.com]`
  // is a run the packer FUSES out of several nodes, which no single
  // word carries and `wordsToAtoms` therefore cannot fuse backwards;
  // held at column 0 it would write a block attribute line. The break
  // moves to the run in front of it instead.
  test.each([
    ["a link in brackets", "* a\nx [https://example.com]\n +\n"],
    ["an address in brackets", "* a\nx [b@c.de]\n +\n"],
  ])("the column-0 hold refuses a fused run: %s", async (_name, input) => {
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  // A comment under a text line the gap does NOT separate from its
  // block is no hazard: the blank count is zero either way, so the
  // join stands.
  test("a comment above an ADJACENT block leaves the join alone", async () => {
    const input = "* a\nX\n// c\npara\n** b\n";
    const out = await formatAdoc(input);
    expect(out).toBe("* a X\n// c\npara\n** b\n");
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});
