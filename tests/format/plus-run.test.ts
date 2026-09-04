/**
 * `+` RUNS — adjacent continuation lines and the erased detached `+`
 * behind them (#56's family). `read_lines_for_list_item` erases the
 * first `+` of a run and buffers the second as CONTENT (parser.rb
 * l.1435-46); the post-loop cleanup pops AT MOST ONE tagged line
 * (l.1580-82), so a trailing detached `+` — blanked into the erased
 * shield by l.1576 — absorbs that pop and keeps the frozen `+`
 * paragraph alive on re-read. The printer therefore writes the erased
 * tail back (one blank, one `+`) exactly when the item ends in such a
 * paragraph, and separates a still-armed metadata tail from the next
 * block with the two blanks that keep it detached. The single `+`
 * that attaches or pops cleanly lives in
 * tests/format/list-continuation.test.ts and
 * tests/format/trailing-continuation.test.ts.
 */
import { describe, test } from "vitest";
import { expectFormatted } from "../helpers.js";

// Every row asserts the exact output, that Asciidoctor renders the
// output as it renders the input, and that a second pass is a fixed
// point.
describe("a frozen + paragraph keeps its erased shield", () => {
  test.each([
    ["the issue's flat shape", "* a\n\n+\n+\n\n+\n", "* a\n\n+\n+\n\n+\n"],
    ["the canonical adjacent run", "* a\n+\n+\n\n+\n", "* a\n+\n+\n\n+\n"],
    ["on a second sibling", "* a\n* a\n+\n+\n\n+\n", "* a\n* a\n+\n+\n\n+\n"],
    [
      "before a sibling marker",
      "* a\n+\n+\n\n+\n* a\n",
      "* a\n+\n+\n\n+\n* a\n",
    ],
    [
      "under a comment line",
      "* a\n// c\n+\n+\n\n+\n",
      "* a\n// c\n+\n+\n\n+\n",
    ],
    [
      "under a block anchor",
      "* a\n[[anc]]\n+\n+\n\n+\n",
      "* a\n[[anc]]\n+\n+\n\n+\n",
    ],
    [
      "under a block attribute line",
      "* a\n[role]\n+\n+\n\n+\n",
      "* a\n[role]\n+\n+\n\n+\n",
    ],
    // The principal text reflows; the run and its shield are untouched.
    [
      "an indented literal folded into the text",
      "* a\n  lit\n+\n+\n\n+\n",
      "* a lit\n+\n+\n\n+\n",
    ],
    [
      "a block title folded into the text",
      "* a\n.T\n+\n+\n\n+\n",
      "* a .T\n+\n+\n\n+\n",
    ],
    [
      "a second text line folded in",
      "* a\npara\n+\n+\n\n+\n",
      "* a para\n+\n+\n\n+\n",
    ],
    // Byte-inert variations normalize to the canonical spelling: the
    // shield's blank run collapses to one blank, the third `+` of a
    // run and a junk `+` behind the shield are read and dropped, a
    // trailing document blank goes.
    ["a two-blank shield", "* a\n+\n+\n\n\n+\n", "* a\n+\n+\n\n+\n"],
    [
      "a document blank after the shield",
      "* a\n+\n+\n\n+\n\n",
      "* a\n+\n+\n\n+\n",
    ],
    [
      "a junk + adjacent to the shield",
      "* a\n+\n+\n\n+\n+\n",
      "* a\n+\n+\n\n+\n",
    ],
    ["a run of three", "* a\n+\n+\n+\n\n+\n", "* a\n+\n+\n\n+\n"],
  ])("%s", async (_name, input, expected) => {
    await expectFormatted(input, expected);
  });
});

// A `+` whose activation ran through metadata only is still ARMED
// where the item ends: one blank line under it attaches the next
// block on re-read (parser.rb l.1483), so the printer keeps the two
// blanks that detach it (l.1549).
describe("a live metadata tail keeps its two-blank detachment", () => {
  test.each([
    ["under a block title", "* a\n+\n.T\n\n\npara\n", "* a\n+\n.T\n\n\npara\n"],
    [
      "under a block anchor",
      "* a\n+\n[[anc]]\n\n\npara\n",
      "* a\n+\n[[anc]]\n\n\npara\n",
    ],
    [
      "under a block attribute line",
      "* a\n+\n[role]\n\n\npara\n",
      "* a\n+\n[role]\n\n\npara\n",
    ],
    [
      "a run of three blanks collapses to the two that detach",
      "* a\n+\n[role]\n\n\n\npara\n",
      "* a\n+\n[role]\n\n\npara\n",
    ],
    // The double blank fires uniformly — a comment after the tail is
    // render-inert, but the two blanks are what keep it OUT of the
    // item on re-read.
    [
      "before a comment line",
      "* a\n+\n[role]\n\n\n// c\n",
      "* a\n+\n[role]\n\n\n// c\n",
    ],
  ])("%s", async (_name, input, expected) => {
    await expectFormatted(input, expected);
  });
});

// Where the SCAN's half of `detachedTail` comes from: the pop, over
// the buffer's tail, and not the item's separator roles read flat.
//
// In both rows the record holds a blank and a `detached` `+`, so a
// rule reading the last `+` of that record answers TRUE - but the run
// is CLOSED, by a line the item read after it, and flattening the
// runs is exactly what loses that. The pop walks the BUFFER instead,
// breaks on the content cell the block became, and reports nothing
// (`ItemExtent.erasedTailContinuation` is false here). The `+` stands
// between the item's text and that block, where the gap already
// replays it; a flat rule would have the item write the erased tail
// back as well and print a second `+` the source never had - measured
// at 4 characters of difference on the first row.
//
// What these rows do NOT pin is the block-shape conjunct
// (`endsInPlusParagraph`, src/parse/lines/list-item-node.ts): with
// the scan's half already false, the conjunct changes nothing here.
// The row that holds it is "behind an attached paragraph" below.
describe("a detached + a block closed is not a detached TAIL", () => {
  test.each([
    ["a comment closes the run", "* a\n\n+\n// c\n", "* a\n\n+\n// c\n"],
    [
      "and a paragraph closes it the same way",
      "* a\n\n+\npara\n",
      "* a\n\n+\npara\n",
    ],
  ])("%s", async (_name, input, expected) => {
    await expectFormatted(input, expected);
  });
});

// The same live tail, inside an item that ALSO holds a nested list.
// the post-loop's `buffer[detached_continuation]` erase (parser.rb l.1576)
// runs with no `within_nested_list` guard,
// so the detached `+` still reaches the output through the gap record
// and a re-read still activates through the metadata below it — the
// two blanks are what keep the paragraph OUT of the item, and
// collapsing them would attach it with the metadata applied.
describe("a live metadata tail behind a nested list detaches too", () => {
  test.each([
    [
      "under a block attribute line",
      "* a\n** b\n\n+\n[role]\n\n\npara\n",
      "* a\n** b\n\n+\n[role]\n\n\npara\n",
    ],
    [
      "under a block title",
      "* a\n** b\n\n+\n.T\n\n\npara\n",
      "* a\n** b\n\n+\n.T\n\n\npara\n",
    ],
    [
      "under a block anchor",
      "* a\n** b\n\n+\n[[anc]]\n\n\npara\n",
      "* a\n** b\n\n+\n[[anc]]\n\n\npara\n",
    ],
  ])("%s", async (_name, input, expected) => {
    await expectFormatted(input, expected);
  });
});

// The live tail one level DOWN: the `+` and its metadata belong to the
// NESTED item, so the outer item's own tail says nothing. What the
// printed lines actually end on is the innermost item's tail, which is
// the recursion listTailContinuationActive walks - the outer item's
// last block is the nested list, and the answer has to come from
// inside it. Collapsing the two blanks here attaches `para` to the
// nested item on re-read.
describe("a live metadata tail on a NESTED item detaches too", () => {
  test.each([
    [
      "under a block attribute line",
      "* a\n** b\n+\n[role]\n\n\npara\n",
      "* a\n** b\n+\n[role]\n\n\npara\n",
    ],
    [
      "under a block title",
      "* a\n** b\n+\n.T\n\n\npara\n",
      "* a\n** b\n+\n.T\n\n\npara\n",
    ],
    [
      "under a block anchor",
      "* a\n** b\n+\n[[anc]]\n\n\npara\n",
      "* a\n** b\n+\n[[anc]]\n\n\npara\n",
    ],
    [
      "two levels down",
      "* a\n** b\n*** c\n+\n[role]\n\n\npara\n",
      "* a\n** b\n*** c\n+\n[role]\n\n\npara\n",
    ],
  ])("%s", async (_name, input, expected) => {
    await expectFormatted(input, expected);
  });
});

// An ORDINARY `+`-attached paragraph is not a fold: it BREAKS at a
// tagged `+` instead of running it through, and the break is what
// leaves the indented line behind it a literal block of its own. Fold
// the `+` in and the `  lit` becomes prose in the same paragraph and
// reflows off its column.
describe("only a fold runs a tagged + through", () => {
  test.each([
    [
      "a + head attaches the paragraph, so the next + breaks it",
      "* a\n+\npara\n** b\n+\n  lit\n",
      "* a\n+\npara\n** b\n+\n  lit\n",
    ],
    [
      "the same break behind a nested list",
      "* a\n** b\n\n+\npara\n+\n  lit\n",
      "* a\n** b\n\n+\npara\n+\n  lit\n",
    ],
  ])("%s", async (_name, input, expected) => {
    await expectFormatted(input, expected);
  });
});

// An INDENTED line folded in behind a `+` head keeps its column. The
// fold is a paragraph to us, but a re-read hands those same lines to a
// literal block's verbatim slurp (`read_lines_until
// break_on_blank_lines, break_on_list_continuation`), which copies
// them into `<pre>` byte for byte — reflowing one off its indent
// rewrites verbatim content, or drops the `indented && !style` branch
// that made the block literal at all.
describe("an indented line folded behind a + keeps its indent", () => {
  test.each([
    [
      "inside the nested item's literal",
      "* a\n** b\n+\n  lit\n+\n+\n  lit\n",
      "* a\n** b\n+\n  lit\n+\n+\n  lit\n",
    ],
    [
      "the same literal opened by a blank instead of a +",
      "* a\n** b\n\n  lit\n+\n+\n  lit\n",
      "* a\n** b\n\n  lit\n+\n+\n  lit\n",
    ],
    [
      "the indent is what makes the inner block literal",
      "* a\n[role]\n+\n+\n** b\n+\n  lit\n",
      "* a\n[role]\n+\n+\n** b\n+\n  lit\n",
    ],
    // The depth-5 edge of the same mechanism, render-equal either way
    // — the bytes now hold there too.
    [
      "a fold that ends at a marker line",
      "* a\n+\n+\n  lit\n+\n** b\n",
      "* a\n+\n+\n  lit\n+\n** b\n",
    ],
  ])("%s", async (_name, input, expected) => {
    await expectFormatted(input, expected);
  });
});

// A scan that hard-stops ON an erased line ends at a SAFE boundary:
// that line is the enclosing item's own blanked `+`, whose spelling
// the enclosing gap replays around this item's tail, so a `+` printed
// there comes back shielded by exactly the run the source wrote and
// re-reads as the frozen `+` it was. Dropping the byte instead moves
// the literal from the outer item to the inner one.
describe("a tail stopping at an erased line keeps its +", () => {
  test.each([
    [
      "an adjacent run above the shield the outer item replays",
      "* a\n** b\n+\n+\n\n+\n  lit\n",
      "* a\n** b\n+\n+\n\n+\n  lit\n",
    ],
  ])("%s", async (_name, input, expected) => {
    await expectFormatted(input, expected);
  });
});

// The tails the two-blank arm must NOT touch.
describe("tails that are not live keep their one blank", () => {
  test.each([
    [
      "one blank attaches, and stays attached",
      "* a\n+\n[role]\n\npara\n",
      "* a\n+\n[role]\n\npara\n",
    ],
    [
      "an active tail at EOF needs no separator",
      "* a\n+\n[role]\n",
      "* a\n+\n[role]\n",
    ],
    [
      "a nested item's popped + is not a live tail",
      "* a\n** b\n+\n\n\npara\n",
      "* a\n** b\n\npara\n",
    ],
  ])("%s", async (_name, input, expected) => {
    await expectFormatted(input, expected);
  });
});

// A detached RUN between nested items splits the list where the JS
// oracle does: the inner scan hard-stops at the erased Placeholder,
// the sibling probe eats it, and the frozen `+` opens a
// content-adjacent paragraph that breaks at the next marker.
describe("an erased + run between nested items", () => {
  test.each([
    [
      "the run splits the nested list and survives verbatim",
      "* a\n** b\n\n+\n+\n** b\n",
      "* a\n** b\n\n+\n+\n** b\n",
    ],
    [
      "the frozen + folds nothing when a paragraph follows it",
      "* a\n** b\n\n+\n+\npara\n",
      "* a\n** b\n\n+\n+\npara\n",
    ],
    [
      "a SINGLE detached + between siblings is still eaten",
      "* a\n** b\n\n+\n** b\n",
      "* a\n** b\n** b\n",
    ],
  ])("%s", async (_name, input, expected) => {
    await expectFormatted(input, expected);
  });
});

// A frozen `+` opened after a skipped blank does not break at marker
// lines: the paragraph is non-content-adjacent to the oracle
// (parser.js l.1065) and folds them as raw lines, stopping only at a
// blank, a plain `+`, a block-attribute line, or a delimiter.
describe("a +-headed paragraph folds marker lines", () => {
  test.each([
    [
      "the inter-item blank survives behind the fold",
      "* a\n+\n+\n** b\n\n** b\n",
      "* a\n+\n+\n** b\n\n** b\n",
    ],
    [
      "an adjacent run and its markers hold their bytes",
      "* a\n+\n+\n** b\n** b\n",
      "* a\n+\n+\n** b\n** b\n",
    ],
    [
      "a tagged + mid-fold is run through, not a break",
      "* a\n+\n+\n** b\n+\n** b\n",
      "* a\n+\n+\n** b\n+\n** b\n",
    ],
    // PROSE before the mid-fold `+`. The fold's pieces are a run and
    // the raw lines around it, and the run has to be closed where the
    // `+` arrives: leave it open and the whole paragraph prints its
    // raw lines first and its prose after, which is a different
    // document.
    [
      "prose before a mid-fold + keeps its place in the run",
      "* a\n+\n+\npara\n+\n** b\n",
      "* a\n+\n+\npara\n+\n** b\n",
    ],
  ])("%s", async (_name, input, expected) => {
    await expectFormatted(input, expected);
  });
});

// The erased tail is dropped everywhere it shields nothing: behind an
// ordinary attached block the re-read pops nothing that renders, so
// the bytes stay gone.
//
// This row is where `endsInPlusParagraph` earns its keep, and it is
// the one the conjunct decides: the pop DID take the erased shield
// here (`ItemExtent.erasedTailContinuation` is true), and dropping
// the conjunct alone makes the item print the tail back -
// `"* a\n+\npara\n\n+\n"` instead of `"* a\n+\npara\n"`, measured.
// Render-equal either way, which is why the guarantee it carries is
// byte fidelity: the item does not write back a shield with nothing
// to shield.
describe("an erased tail behind an ordinary block stays dropped", () => {
  test.each([
    ["behind an attached paragraph", "* a\n+\npara\n\n+\n", "* a\n+\npara\n"],
  ])("%s", async (_name, input, expected) => {
    await expectFormatted(input, expected);
  });
});

// The stopper an inner item ends on is an ENCLOSING scan's blanked
// `+`: the outer item's detached `+` became Ruby's Placeholder after
// its own loop (parser.rb l.1576) and the inner scan's after-blank arm
// hard-stops on it. The enclosing gap replays that run around this
// item's tail, so a `+` printed here comes back shielded by exactly
// the bytes the source put there. The second row is where the answer
// is byte-observable: with the stopper read as an ordinary line the
// item drops the `+` the source wrote.
describe("an item that ends on an enclosing scan's erased +", () => {
  test.each([
    ["the run alone", "* a\n** b\n+\n+\n\n+\n", "* a\n** b\n+\n"],
    [
      "with a block under the shield",
      "* a\n** b\n+\n+\n\n+\npara\n",
      "* a\n** b\n+\n+\n\n+\npara\n",
    ],
  ])("%s", async (_name, input, expected) => {
    await expectFormatted(input, expected);
  });
});

// The `+` the pop takes off an item's buffer is that ITEM's byte, and
// only that item's. A nested item is where the two spellings can meet
// on ONE physical line: the enclosing scan leaves a `+` standing
// inside a nested list rather than blanking it ("they will be
// processed when grabbing the lines for those nested lists",
// parser.rb l.1412-14, l.1439), so the enclosing gap still spans the
// line; the nested scan's own activation then erases it (l.1439) and
// the pop takes it off the tail (l.1580-82), which is the nested
// item's `+` to print back.
//
// Spelling it in both places writes two adjacent `+` lines, and the
// second one is not a spare byte: on re-read it is the second of an
// adjacent pair, which freezes the continuation (l.1443-46) and ends
// the nested item on the frozen mark, so the block below the shield
// is read into the OUTER item instead.
//
// The FAMILY is one shape — an outer item, a nested item, a `+`, a
// blank RUN, the detached `+` the run erases, and one block under it
// — with the block and the marker vocabulary free. The first four
// rows are its members. Three of them were RENDER-corrupting: a
// paragraph and an indented literal under the shield, and the ordered
// spelling of the paragraph one, which shows the family is not about
// `*`. The fourth is a block-attribute line, standing for the members
// whose block renders nothing on its own, where only the byte moved
// (a comment, an anchor and a block title spell the same bytes).
//
// The last two rows are the edges, and each fails for its own reason.
// One blank instead of a RUN reaches no pop at all — the nested item
// keeps the block, so the outer item has a single block and no gap to
// spell twice — so it brackets the blank-run dimension and nothing
// else. A THIRD level does reach the pop, but the byte it takes is
// still `pending` there (a `+` an enclosing scan left standing for a
// nested list to answer for, which spells nothing in any gap), so its
// gap was already short of that line before this rule existed.
//
// Every row renders as its source and is a fixed point.
describe("a popped + is spelled once, by the item that popped it", () => {
  test.each([
    [
      "a blank run and a detached + behind a nested item",
      "* a\n** b\n+\n\n\n+\npara\n",
      "* a\n** b\n+\n\n+\npara\n",
    ],
    [
      "a literal under the shield rather than a paragraph",
      "* a\n** b\n+\n\n\n+\n  lit\n",
      "* a\n** b\n+\n\n+\n  lit\n",
    ],
    [
      "an ordered list spells it the same way",
      ". a\n.. b\n+\n\n\n+\npara\n",
      ". a\n.. b\n+\n\n+\npara\n",
    ],
    [
      "block metadata under the shield, where the byte alone moved",
      "* a\n** b\n+\n\n\n+\n[role]\n",
      "* a\n** b\n+\n\n+\n[role]\n",
    ],
    [
      "one blank instead of a run reaches no pop",
      "* a\n** b\n+\n\n+\npara\n",
      "* a\n** b\n+\n\n+\npara\n",
    ],
    [
      "a third level pops a + that spells nothing anyway",
      "* a\n** b\n*** c\n+\n\n\n+\npara\n",
      "* a\n** b\n*** c\n+\n\n+\npara\n",
    ],
  ])("%s", async (_name, input, expected) => {
    await expectFormatted(input, expected);
  });
});

// The `within_nested_list` fold (parser.rb l.1412-14, l.1439) and the
// callout marker that opens a NEW list under a popped `+`: two
// neighbourhoods whose bytes are decided by the separator ROLE the
// reading arm records and by what `tailPrintsInert` says about the
// line the item stopped on. Neither is decided by directive
// transparency, and every row here already held before that work; they
// are committed as the guard that it moved none of them.
//
// The first five are documents an earlier reading core wrote back and
// a line-by-line walk did not; the last three are the callout shapes,
// where the answer turns on a marker that opens a NEW list being
// written under a blank line - so a `+` above it would arm and attach
// what follows, and `* a` / `+` / `+` / blank / `<1> n` renders its
// colist OUTSIDE the item.
describe("the fold facts and the new-list marker keep their answers", () => {
  test.each([
    [
      "a dlist term under an attached +",
      "* a\n+\nterm:: def\n+\n+\n",
      "* a\n+\nterm:: def\n+\n+\n",
    ],
    [
      "a dlist term after a blank",
      "* a\n\nterm:: def\n+\n+\n",
      "* a\n\nterm:: def\n+\n+\n",
    ],
    [
      "a dlist term under block metadata",
      "* a\n[role]\nterm:: def\n+\n+\n",
      "* a\n[role]\nterm:: def\n+\n+\n",
    ],
    [
      "a detached run between two nested lists",
      "* a\n** b\n\n+\n+\n** b\n",
      "* a\n** b\n\n+\n+\n** b\n",
    ],
    [
      "a nested marker the item's own paragraph swallowed",
      "* a\n+\npara\n** b\n+\n+\n",
      "* a\n+\npara\n** b\n+\n+\n",
    ],
    [
      "an anchor ends the pair's block above a callout",
      "* a\n+\n+\n[[anc]]\npara\n<1> n\n",
      "* a\n+\n+\n[[anc]]\npara\n<1> n\n",
    ],
    [
      "a block attribute line does the same",
      "* a\n+\n+\n[role]\npara\n<1> n\n",
      "* a\n+\n+\n[role]\npara\n<1> n\n",
    ],
    [
      "a callout under the frozen pair takes both bytes",
      "* a\n+\n+\n\n<1> n\n",
      "* a\n\n<1> n\n",
    ],
  ])("%s", async (_name, input, expected) => {
    await expectFormatted(input, expected);
  });
});

// An ERASED `+` standing as the previous buffered line of a live
// scan is the one value Ruby's `ListContinuationMarker === prev_line`
// (parser.rb l.1435) and 2.0.20's `prev_line == LIST_CONTINUATION`
// disagree about: the erased cell is the empty
// `ListContinuationPlaceholder`, a marker to the first test and a
// blank to the second.
//
// The CONDITION these rows sample: a nested marker written INDENTED
// under an active `+` is slurped as a literal paragraph (parser.rb
// l.1495) and so never sets `within_nested_list`, which leaves a
// later `+` in the same item free to be erased in place (l.1439);
// the nested scan then meets that erasure as an ordinary line and
// buffers it through its final else. Only the FIRST marker's
// indentation is load-bearing, which is why the flush-left rows
// below flip too - what follows the erased `+` needs no indent. The
// condition also holds for ordered markers, at other indent widths
// and marker depths, and down a chain of such items; the rows here
// are a sample of it, not its extent.
//
// Under the text test every row printed its two nested markers with
// nothing between them - the `+` the author wrote there was dropped.
// Under Ruby's own test the frozen marker survives. Both spellings render
// what the source renders and both are fixed points, so the ORACLE
// does not choose between them; what the identity test buys is one
// answer to "is this cell a continuation marker" instead of two
// inside a single scan.
describe("an erased + is still a marker when the next line reads it", () => {
  const nested = "* a\n+\n** z\n+\n** z\n";
  test.each([
    ["adjacent markers", "* a\n+\n  ** z\n+\n+\n  ** z\n", nested],
    ["a blank between them", "* a\n+\n  ** z\n+\n\n  ** z\n", nested],
    ["a flush-left second marker", "* a\n+\n  ** z\n+\n+\n** z\n", nested],
    ["flush left, a blank between", "* a\n+\n  ** z\n+\n\n** z\n", nested],
    [
      "an ordered pair",
      ". a\n+\n  .. z\n+\n+\n.. z\n",
      ". a\n+\n.. z\n+\n.. z\n",
    ],
  ])("%s", async (_name, input, expected) => {
    await expectFormatted(input, expected);
  });
});
