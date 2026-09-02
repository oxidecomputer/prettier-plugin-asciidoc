/**
 * The DIRECTIVE PRODUCT: every shape a conditional-directive pair can
 * wrap, enumerated exhaustively rather than sampled.
 *
 * A document here is one `ifdef::x[]` / `endif::[]` pair with a body
 * between it, put under an opening that decides what list context the
 * pair opens in and followed by a tail that decides what the pair
 * closes back into. That is the whole question this product asks: a
 * directive line is transparent to Asciidoctor's reader but is a LINE
 * to ours, so the pair's two lines land in the middle of a list item,
 * between an item and its continuation, or between two blocks - and
 * each of those placements is a different reading.
 *
 * Exhaustive, not sampled, for the reason
 * `tests/format/list-shape-sweep.ts` states about its own product: a
 * seeded draw over an alphabet this small once missed four
 * render-corrupting shapes that were inside the alphabet all along.
 *
 * The product is a HARNESS input, not a committed fixture: it is
 * spelled from this file every run, so there is nothing to regenerate
 * and nothing to fall out of date.
 */

/**
 * The openings. Each one decides what the directive pair opens
 * INSIDE: nothing at all, a list item, a nested item, or an item's
 * continuation.
 */
const HEADS: readonly string[] = ["* a\n", "* a\n** b\n", "", "* a\n+\n"];

/**
 * The body alphabet. Seven symbols, each a line the reader classifies
 * differently inside a directive pair: a continuation, block
 * metadata, prose, a delimited block, a blank, a comment, and a
 * nested marker.
 *
 * The empty string is the BLANK LINE, spelled as an empty element of
 * a newline-joined sequence rather than as `"\n"`, because that is
 * what makes a blank body line and an absent body line the same
 * spelling - see {@link directiveProduct} on the sixteen duplicates.
 */
const BODY_ALPHABET: readonly string[] = [
  "+",
  "[role]",
  "para",
  "----\nx\n----",
  "",
  "// c",
  "** b",
];

/** How many body lines the product spells, at most. */
const BODY_DEPTH = 3;

/**
 * The tails. Each decides what the pair closes back INTO: prose, a
 * sibling item, the end of the document, or a continuation.
 *
 * Every non-empty tail is newline-terminated, so every document in
 * the product ends with a newline and a formatter that only appends
 * a missing final newline moves no bytes here.
 */
const TAILS: readonly string[] = ["para\n", "* b\n", "", "+\npara\n"];

/**
 * How many distinct documents {@link directiveProduct} spells.
 *
 * A pinned number rather than a computed one. Every measurement over
 * this product is a count OUT OF it - "6,300 of these render as their
 * source" - so a comparison against a later run is only meaningful
 * while the denominator is the same set. A generator that quietly
 * spelled a different product would move that denominator and make
 * the two runs look comparable when they are not, so the size is
 * asserted rather than observed: `scripts/migration-diff.ts` refuses
 * to start when the enumeration disagrees with this number, and a
 * test row pins it too.
 */
export const DIRECTIVE_PRODUCT_SIZE = 6384;

/**
 * Every body of length 0 to {@link BODY_DEPTH} over the alphabet, as
 * newline-joined text with no trailing newline - the wrapper below
 * supplies the line end.
 * @returns the body texts, in enumeration order, with duplicates kept
 */
function bodies(): string[] {
  const spelled: string[] = [];
  const grow = (parts: readonly string[], remaining: number): void => {
    spelled.push(parts.join("\n"));
    if (remaining === 0) {
      return;
    }
    for (const symbol of BODY_ALPHABET) {
      grow([...parts, symbol], remaining - 1);
    }
  };
  grow([], BODY_DEPTH);
  return spelled;
}

/**
 * The whole product, deduplicated.
 *
 * The raw enumeration is 4 heads x 400 bodies x 4 tails = 6,400 and
 * dedupes to 6,384. The sixteen duplicates are all one collision: the
 * length-0 body and the length-1 body that is a single blank line
 * both join to the empty string, so they spell the same document
 * under each of the 4 x 4 head/tail pairs. That is a real property of
 * the alphabet, not an accident to paper over - a blank body line and
 * no body line ARE the same document - so the dedup is the spec and
 * the count is pinned against it.
 * @returns the distinct documents, in enumeration order
 */
export function directiveProduct(): string[] {
  const documents: string[] = [];
  // Hoisted: the enumeration does not depend on the head, and calling
  // it inside the loop rebuilt all 400 bodies once per head.
  const spelled = bodies();
  for (const head of HEADS) {
    for (const body of spelled) {
      for (const tail of TAILS) {
        documents.push(`${head}ifdef::x[]\n${body}\nendif::[]\n${tail}`);
      }
    }
  }
  return [...new Set(documents)];
}
