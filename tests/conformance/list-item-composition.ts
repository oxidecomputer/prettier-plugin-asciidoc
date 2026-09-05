/**
 * The list-item composition family: documents whose SOURCE puts an
 * attribute line, a verbatim run, a nested construct and a following
 * marker inside one list item, at the depth where the item's extent
 * scan and the line classifier have to agree about where the item
 * stops.
 *
 * Source, not render, and the distinction is the point rather than a
 * caveat: 184 of the 700 rows render some of that content at DOCUMENT
 * level, because the construct or the follower legitimately escapes
 * the item. Where it escapes is itself a reading, so those rows carry
 * the claim like any other.
 *
 * WHAT IT CLAIMS. Over the product below, formatting a document once
 * must not change what Asciidoctor renders. Nothing else: the family
 * is not a spelling pin, so a row that reformats to different bytes
 * passes as long as both spellings render alike.
 *
 * WHAT IT DOES NOT REACH, stated because the claim is only as wide as
 * the product, and MEASURED rather than assumed.
 *
 * - One opener per document, so no row nests one list inside another
 *   before the run opens.
 * - The run is ATTACHED by the opener's `+` and by nothing else, so a
 *   run reached by indentation alone or by a title line is outside
 *   the product. A second `+` INSIDE the run is not outside it: the
 *   `continuation` mid-run member puts one in 100 of the rows, and
 *   those 100 carry every failure the manifest holds.
 * - Interiors are four lines (`a`, the construct, the follower, `b`),
 *   six where the construct is a delimited block. A longer interior
 *   is outside the product.
 * - One style attribute line stands ABOVE the run. A second verbatim
 *   block INSIDE it is again a cell rather than an exclusion (140 of
 *   the rows render two or more `<pre>` regions, from the `style` and
 *   `delimited` constructs); what is outside is a document with two
 *   separately ATTACHED runs.
 * - No byte operators: the family fixes its own spelling, and the
 *   perturbation dimension belongs to the registry sweeps that own it
 *   (tests/conformance/registry-sweep.ts).
 *
 * A LIBRARY module: the rows live here and the gate that runs them
 * lives in list-item-composition.test.ts, on the same terms as the
 * registry and inline sweeps.
 */
import type { SweepRow } from "./registry-sweep.js";

/** One axis member: the id an id path spells it with, and its bytes. */
interface AxisMember {
  /** The segment this member contributes to a row id. */
  readonly id: string;
  /** The line, or lines, it puts in the document. */
  readonly text: string;
}

/**
 * The line the item opens with. Both marker kinds and all three
 * description delimiters, because the description reader and the
 * marker reader take different paths to the same run and the incident
 * this family exists for was on the description path only: without
 * the marker openers the family could not say the two paths differ.
 */
const OPENERS: readonly AxisMember[] = [
  { id: "marker", text: "* item" },
  { id: "ordered", text: ". item" },
  { id: "term2", text: "term1:: desc" },
  { id: "term-semi", text: "term1;; desc" },
  { id: "term3", text: "term1::: desc" },
];

/**
 * The style attribute over the attached run. All four verbatim
 * styles: their interiors are content, so a lost or added newline
 * inside one is a render change rather than a respelling, which is
 * what makes them the family's whole point.
 */
const STYLES: readonly AxisMember[] = [
  { id: "source", text: "[source]" },
  { id: "listing", text: "[listing]" },
  { id: "literal", text: "[literal]" },
  { id: "verse", text: "[verse]" },
];

/**
 * The line standing INSIDE the verbatim run, between two ordinary
 * content lines. Each one is a line shape that ends a paragraph in
 * some other context, so each one asks the reader whether the run it
 * stands in is one of those contexts.
 */
const MID_RUN: readonly AxisMember[] = [
  { id: "attribute", text: "[note]" },
  { id: "anchor", text: "[[x]]" },
  { id: "style", text: "[source]" },
  { id: "delimited", text: "----\nz\n----" },
  { id: "marker", text: "* n" },
  { id: "term", text: "term:: t" },
  { id: "continuation", text: "+" },
];

/**
 * The line after the mid-run construct. A reader that cut the run at
 * the construct reads this line as the start of something new, and
 * the four non-text followers are the shapes whose "something new"
 * carries the interior text away with it; `text` is the control that
 * carries nothing.
 */
const FOLLOWERS: readonly AxisMember[] = [
  { id: "marker", text: "* n2" },
  { id: "text", text: "plain text" },
  { id: "term3", text: "term::: t" },
  { id: "ordered", text: ". o2" },
  { id: "indented", text: "  indented" },
];

/**
 * The whole product, 700 documents, in a stable order.
 *
 * Every row is `<opener>` / `+` / `<style>` / a / `<mid>` /
 * `<follower>` / b: the interior lines `a` and `b` are what a reader
 * that cut the run has left to reflow, so they are the bytes a
 * divergence shows up in.
 * @returns the rows, keyed by their four-segment composition id
 */
export function listItemCompositionRows(): SweepRow[] {
  const rows: SweepRow[] = [];
  for (const opener of OPENERS) {
    for (const style of STYLES) {
      for (const mid of MID_RUN) {
        for (const follower of FOLLOWERS) {
          rows.push({
            id: `${opener.id}/${style.id}/${mid.id}/${follower.id}`,
            input: `${opener.text}\n+\n${style.text}\na\n${mid.text}\n${follower.text}\nb\n`,
            renderBlind: false,
          });
        }
      }
    }
  }
  return rows;
}
