/**
 * The DESCRIPTION-LIST PRODUCT: a description-list term under every
 * wrapper that changes what it means, followed by every three-line
 * body the alphabet spells.
 *
 * The question this product asks is what a `t:: d` line OWNS. A term
 * line attaches the lines under it, and which lines those are depends
 * on what the term itself sits inside - a bare document, an unordered
 * item, an item's continuation, or an item whose literal block is
 * already open. Issue #9 (description lists) is unimplemented, so
 * today every one of these reads as something else; the product is
 * here to hold that reading STILL across the migration, not to assert
 * it is right.
 *
 * Bodies are exactly three lines, not zero to three. Three is the
 * shortest length that can spell an interruption and a resumption
 * around a middle line, which is where a term's extent is decided.
 *
 * The product is a HARNESS input, not a committed fixture: it is
 * spelled from this file every run.
 */

/**
 * The wrappers. Each decides what the term line sits inside: nothing,
 * an item, an item's continuation, or an item with an open literal
 * block.
 */
const WRAPPERS: readonly string[] = [
  "",
  "* a\n",
  "* a\n+\n",
  "* a\n[role]\n\n  lit\n",
];

/**
 * The term lines: a term with a description, a term whose description
 * is on the next line, the two-colon-to-semicolon spelling that
 * changes the term's LEVEL, and a second term name so a body can name
 * the same term or a different one.
 */
const TERMS: readonly string[] = ["t:: d", "t::", "t;; d", "u:: d"];

/**
 * The body alphabet: fifteen line shapes that can follow a term, one
 * per way the term's extent can end or continue - nested and sibling
 * markers, an ordered item, a callout, a second term, a bare term, a
 * literal line, prose, a comment, an anchor, block metadata, a block
 * title, a continuation, a blank, and a delimiter.
 *
 * The empty string is the blank line, for
 * `scripts/lib/directive-product.ts`'s reason. No symbol here spells
 * a newline of its own, which is what makes the three-line join
 * injective and the product's size exact.
 */
const BODY_ALPHABET: readonly string[] = [
  "** b",
  "* c",
  ". o",
  "<1> n",
  "t:: d",
  "u::",
  "  lit",
  "para",
  "// c",
  "[[anc]]",
  "[role]",
  ".T",
  "+",
  "",
  "----",
];

/** How many body lines every document in the product spells. */
const BODY_LINES = 3;

/**
 * How many distinct documents {@link dlistProduct} spells.
 *
 * A pinned number, for the reason `scripts/lib/directive-product.ts`
 * pins its own: every measurement over this product is a count out of
 * it, so the denominator has to be asserted rather than observed.
 */
export const DLIST_PRODUCT_SIZE = 54_000;

/**
 * Every body of exactly {@link BODY_LINES} lines over the alphabet.
 * @returns the body texts, newline-joined, no trailing newline
 */
function bodies(): string[] {
  let spelled: string[] = [""];
  for (let line = 0; line < BODY_LINES; line += 1) {
    const grown: string[] = [];
    for (const prefix of spelled) {
      for (const symbol of BODY_ALPHABET) {
        grown.push(line === 0 ? symbol : `${prefix}\n${symbol}`);
      }
    }
    spelled = grown;
  }
  return spelled;
}

/**
 * The whole product.
 *
 * 4 wrappers x 4 terms x 15^3 bodies = 54,000, and every one is
 * distinct: no alphabet symbol contains a newline, so a three-line
 * body carries exactly two separators and splits back uniquely, and
 * no wrapper's second line can be mistaken for a term. The dedup
 * below is therefore a CHECK rather than a reduction - if it ever
 * removes anything, the size pin catches it.
 * @returns the distinct documents, in enumeration order
 */
export function dlistProduct(): string[] {
  const documents: string[] = [];
  for (const wrapper of WRAPPERS) {
    for (const term of TERMS) {
      for (const body of bodies()) {
        documents.push(`${wrapper}${term}\n${body}\n`);
      }
    }
  }
  return [...new Set(documents)];
}
