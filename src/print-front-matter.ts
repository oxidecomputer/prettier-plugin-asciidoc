/**
 * Printing for YAML front matter.
 *
 * Its own module rather than a case in print-blocks.ts because it
 * shares nothing with the blocks there: every other verbatim block
 * negotiates a delimiter length against its content and its nesting,
 * and front matter has exactly one legal fence. What is left is a
 * fence, the bytes, and the fence — and the whole point is that
 * nothing happens to the bytes.
 */
import { doc, type Doc } from "prettier";
import type { FrontMatterNode } from "./ast.js";
import { EMPTY } from "./constants.js";

const {
  builders: { join, literalline },
} = doc;

/** The only fence Asciidoctor's `skip_front_matter!` recognizes. */
const FENCE = "---";

/**
 * Re-emits a front-matter block byte for byte.
 *
 * `literalline` rather than `hardline` throughout, and that is the
 * whole reason this function is not two lines of `join`. Prettier
 * trims trailing whitespace on a line ending in a `hardline`; front
 * matter is not AsciiDoc, we do not know that its trailing bytes are
 * insignificant, and a formatter that silently edits YAML is a worse
 * failure than one that leaves it alone. `literalline` also resets
 * indentation, which costs nothing here — front matter can only ever
 * sit at column 0 — and keeps the guarantee true if it is ever
 * printed from somewhere indented.
 * @param node - the front-matter block, content already sliced
 *   verbatim out of the source by the reader
 * @returns Doc IR that round-trips the original bytes between a pair
 *   of `---` fences
 */
export function printFrontMatter(node: FrontMatterNode): Doc {
  // `"".split("\n")` is `[""]`, which would print a blank line
  // between the fences. `---\n---` has no line between them.
  if (node.content.length === EMPTY) {
    return [FENCE, literalline, FENCE];
  }
  const body = join(literalline, node.content.split("\n"));
  return [FENCE, literalline, body, literalline, FENCE];
}
