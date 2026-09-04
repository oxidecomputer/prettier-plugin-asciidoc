/**
 * The two AST invariants a description list adds, split out of
 * ast-invariants.ts for the reason ast-walk.ts was: that file stands
 * at the 450-line ceiling, and these are one subject.
 *
 * Both are about the region a marker item does not have - the source
 * between two term lines Ruby folds onto ONE pair
 * (`parse_description_list`, parser.rb:1230-1235). Ruby simply drops
 * those lines; a formatter may not, so they are recorded on the term
 * that precedes them, and the two rows below are what says the
 * recording is complete and correctly placed.
 *
 * Structural, like the file they came from: nothing here narrows a
 * node to an AST interface, so a shape that changes fails these rows
 * rather than the type-checker.
 */
import { expect } from "vitest";
import { LINE_COMMENT_HEAD, rstrip } from "../../src/parse/line-shapes.js";
import { isArray, isNode, isRecord, type AnyNode } from "./ast-walk.js";

/**
 * The image one recorded gap line goes back to the source as, or
 * undefined for a value the gap alphabet does not admit.
 *
 * That alphabet is the whole of (vii)'s extension: a term's gap holds
 * a blank, a `+` the post-loop pop discarded, and a `//` line the
 * head drain took - and nothing else, because nothing else is a line
 * the item's own read turned into neither text nor a block. Anything
 * else here is a gap range drawn wrong, which is why this answers
 * `undefined` rather than spelling the line back. The two Ruby arms
 * are `buffer.pop if ListContinuationMarker === buffer[-1]`
 * (parser.rb:1580-1582) and `comment_lines =
 * list_item_reader.skip_line_comments` (parser.rb:1363-1371).
 * @param line - one element of a term's `gap`
 * @returns the source line it stands for, or undefined
 */
function gapImage(line: unknown): string | undefined {
  if (line === "" || line === "+") {
    return line;
  }
  if (!isRecord(line)) {
    return undefined;
  }
  const { comment } = line;
  return typeof comment === "string" && comment.startsWith(LINE_COMMENT_HEAD)
    ? comment
    : undefined;
}

/**
 * The strings of one array, with a complaint for any element that is
 * not one - the shape guard the rows below need over a walk that
 * types every field `unknown`.
 * @param value - the field being read
 * @param what - what the field is, for the failure message
 * @returns its elements, as strings
 */
function stringsOf(value: unknown, what: string): string[] {
  expect(isArray(value), `${what} is an array`).toBe(true);
  const elements = isArray(value) ? value : [];
  for (const element of elements) {
    expect(typeof element, `${what} holds strings`).toBe("string");
  }
  return elements.map((element) =>
    typeof element === "string" ? element : "",
  );
}

/**
 * One term entry's own two images: its source line, then its gap.
 * @param entry - one element of an item's `terms`
 * @returns the lines it writes back
 */
function termImages(entry: unknown): string[] {
  expect(isRecord(entry) && isNode(entry.term), "a term entry").toBe(true);
  if (!isRecord(entry) || !isNode(entry.term)) {
    return [];
  }
  const line = stringsOf([entry.term.line], "a term's own source line");
  const gap = isArray(entry.gap) ? entry.gap : [];
  const images = gap.map((gapLine) => gapImage(gapLine));
  for (const image of images) {
    expect(
      image,
      "a term gap holds only blanks, a + and comment lines",
    ).not.toBeUndefined();
  }
  return [...line, ...images.map((image) => image ?? "")];
}

/**
 * The lines one description item writes back for itself, in order:
 * each term's own source line and then that term's gap, then the
 * source lines its text was read from.
 *
 * The item's BLOCKS are deliberately not here. They follow the text
 * image behind gaps of their own, and (iv) and (vii) already cover
 * them on the marker item's terms.
 * @param node - a `descriptionListItem` node
 * @returns the images, in order
 */
function writtenLines(node: AnyNode): string[] {
  const { terms, textLines } = node;
  expect(isArray(terms), "an item's terms is an array").toBe(true);
  const entries = isArray(terms) ? terms : [];
  return [
    ...entries.flatMap((entry) => termImages(entry)),
    ...stringsOf(textLines, "an item's textLines"),
  ];
}

/**
 * (xv) An item with neither text nor blocks is the LAST item of its
 * list.
 *
 * Ruby's pair fold restated (parser.rb:1230-1235 with :1387): while
 * the open pair's description half is nil the next term joins THAT
 * pair, so an empty body can only be reached by the item nothing
 * follows.
 *
 * RUBY'S SIDE IS NOT THE RISK; ours is. A reader that records an
 * interleaved `//` line as the item's BLOCK instead of as a term gap
 * gives the item a body, ends the fold early, and produces a non-last
 * item with an empty body - so this row is also the alarm for the
 * term gap being wired wrong, and it is why it runs over the whole
 * corpus rather than over a fixture.
 * @param nodes - every node, in document order
 */
export function expectFoldedItemsClosed(nodes: AnyNode[]): void {
  for (const node of nodes) {
    if (node.type !== "descriptionList" || !isArray(node.children)) {
      continue;
    }
    const { children } = node;
    for (const [index, child] of children.entries()) {
      if (!isNode(child)) {
        continue;
      }
      const { text, blocks } = child;
      const empty =
        isArray(text) &&
        text.length === 0 &&
        isArray(blocks) &&
        blocks.length === 0;
      if (!empty) {
        continue;
      }
      expect(
        index,
        "a description item with an empty body is not the list's last",
      ).toBe(children.length - 1);
    }
  }
}

/**
 * (iv) and (vii), extended over the inter-term region: every source
 * line of a description item belongs to exactly one of a term line, a
 * term gap and the text image, and the three write that region back
 * exactly as the source has it.
 *
 * Stated as an EQUALITY over the region rather than as a coverage
 * set, because the failure this exists to catch is a line that is
 * covered and wrong: dropping an inter-term comment leaves every
 * node's span untouched, passes the render bar (the oracle deletes
 * the line too) and passes (iv), and only a byte comparison sees it.
 *
 * Compared against RSTRIPPED source lines, which is the spelling the
 * classifier reads and the spelling a gap records; a line's trailing
 * whitespace is the printer's question, not this one's.
 * @param source - the whole document
 * @param nodes - every node, in document order
 */
export function expectDescriptionPartition(
  source: string,
  nodes: AnyNode[],
): void {
  const lines = source.split("\n").map((line) => rstrip(line));
  for (const node of nodes) {
    if (node.type !== "descriptionListItem") {
      continue;
    }
    const written = writtenLines(node);
    const from = node.position.start.line - 1;
    expect(written, "a description item writes its own lines back").toEqual(
      lines.slice(from, from + written.length),
    );
  }
}
