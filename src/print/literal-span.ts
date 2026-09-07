/**
 * The byte-preserving path for a monospace span's content (issue
 * #32): interior whitespace is CONTENT the oracle renders exactly as
 * written - measured, `` `a  b` `` renders `<code>a  b</code>`, both
 * spaces kept - not prose for the packer to fold to a single space.
 * Split out of src/print/inline.ts to keep that file within the
 * max-lines lint limit; the two share the {@link Boundary}/
 * {@link Cursor} plumbing from src/print/atom-join.ts rather
 * than one importing the other, so dependency-cruiser's cycle check
 * (tests/scripts/metrics-cli.test.ts) stays clean.
 */
import type { TextNode } from "../ast.js";
import { wordsToAtoms, type Atom } from "./reflow.js";
import {
  leadsWithLineBreak,
  splitPreservingSpaces,
  trailsWithLineBreak,
} from "../whitespace-runs.js";
import {
  strongerBoundary,
  withBoundary,
  type Boundary,
  type Cursor,
} from "./atom-join.js";

/**
 * Append a text node's atoms inside a monospace span's content
 * (`cursor.literalInterior`): the node is cut only where a LINE BREAK
 * stood ({@link splitPreservingSpaces}) and each chunk carries its own
 * spacing verbatim, glued to its neighbours with no synthesized join -
 * the packer must never re-insert a space `wrap` (reflow.ts)'s
 * ordinary word join already owns. A line break still folds to one
 * breakable join, matching the ordinary text path's own fold for
 * prose (Asciidoctor copies a line break inside an inline code span
 * into the rendered element the same as anywhere else - only an
 * interior SPACE RUN is held to the stricter bar).
 *
 * `+`-escaping never applies here: `literalInterior` is only true
 * inside a span (`cursor.enclosing` is always set), and the ordinary
 * path's own `trailingPlusPolicy` (text-edges.ts) already disables the
 * escape there - the closing mark follows the word in the output, so
 * a trailing `+` can never end a line bare.
 * @param out - the block's atoms so far (mutated).
 * @param boundary - the join standing in front of this node.
 * @param cursor - where the node sits.
 * @param node - the text node.
 * @returns the join this node leaves behind.
 */
export function appendLiteralText(
  out: Atom[],
  boundary: Boundary,
  cursor: Cursor,
  node: TextNode,
): Boundary {
  const chunks = splitPreservingSpaces(node.value);
  // A node holding nothing but a line-break run (no atom of its own,
  // the same shelter the ordinary path gives an all-whitespace node):
  // the break it stands for still folds to one breakable join.
  if (chunks.length === 0) {
    return strongerBoundary(boundary, "break");
  }
  const lead = leadsWithLineBreak(node.value)
    ? strongerBoundary(boundary, "break")
    : boundary;
  const atoms = wordsToAtoms(chunks, { escapeTrailingPlus: false });
  out.push(withBoundary(atoms[0], lead), ...atoms.slice(1));
  return trailsWithLineBreak(node.value) ? "break" : "glue";
}
