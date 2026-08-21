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
// reflow turns the second shape into the first. So the printer writes an
// explicit `+` there (plan-1's behaviour).
describe("metadata directly after reflowable item text gets an explicit +", () => {
  test.each([
    [
      "an attribute line",
      "* a\npara\n[role]\npara\n",
      "* a para\n+\n[role]\npara\n",
    ],
    ["an anchor", "* a\npara\n[[anc]]\npara\n", "* a para\n+\n[[anc]]\npara\n"],
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

// Ruling 27: the reader decides the explicit `+`. `Reader#skip_line_comments`
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

// A metadata group that ended multi-line item text gets the explicit `+`
// whatever introduces the block after it — a `+` of its own included —
// and when it is TRAILING and longer than one line (reflowed onto the
// first rest line, its first line would fold and the rest become text).
describe("a metadata group that ended multi-line text keeps off the first rest line", () => {
  test("a block with its own + after the group", async () => {
    const input = "* a\npara\n[role]\n+\npara\n";
    const out = await formatAdoc(input);
    expect(out).toBe("* a para\n+\n[role]\n+\npara\n");
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
