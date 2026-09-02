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
import { ASCII_WHITESPACE } from "../parse/line-shapes.js";
import {
  leadsWithLineBreak,
  splitPreservingSpaces,
  trailsWithLineBreak,
  wordsToAtoms,
  type Atom,
} from "./reflow.js";
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
 * path's own `trailingPlusPolicy` (inline.ts) already disables the
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

/**
 * Whether an edge of `text` is whitespace - the byte-level flush test
 * {@link spanIsFlush} needs inside literal territory, where (unlike
 * the ordinary path's word atoms) the character genuinely stands in
 * the atom's own text rather than only in a join.
 * @param text - the edge atom's text (`""` when there is none).
 * @param end - which edge to read.
 * @returns true when that edge is whitespace.
 */
function edgeIsWhitespace(text: string, end: "start" | "end"): boolean {
  const char = end === "start" ? text.at(0) : text.at(-1);
  return char !== undefined && ASCII_WHITESPACE.test(char);
}

/**
 * Whether a span's content is FLUSH against both marks - the question
 * `constrainedIsLegal` (inline.ts) asks before it will shorten an
 * unconstrained span, since the constrained pattern refuses whitespace
 * at either boundary. Split from `appendSpan` (inline.ts) for that
 * file's complexity ceiling.
 *
 * BOTH reads are needed in literal territory, not the byte alone.
 * `openSpace`/`closeSpace` answer the ordinary question - is there a
 * JOIN the printer will render as a space beside the mark - and that
 * question survives literal mode unchanged: {@link appendLiteralText}
 * still returns a `"break"` join at an edge whose whitespace run held
 * a LINE BREAK (folded the same way ordinary prose folds one), and
 * `appendSpan` still turns that join into a literal `" "` beside the
 * mark. The byte test alone missed exactly that case: a line-break
 * edge run is CUT AWAY by `splitPreservingSpaces` (it is the split
 * boundary), never baked into an atom, so `inner[0]`'s first
 * character can be non-whitespace while the join in front of it is
 * still a space Ruby's `(\S|\S.*?\S)` refuses beside a constrained
 * mark - measured, before this AND was added: `` a ``\nxy`` b `` was
 * wrongly shortened to `` a ` xy` b ``, which Asciidoctor reads as
 * literal text, not a code span. The
 * byte test still pulls its own weight for the case the join CANNOT
 * see: a pure space/tab edge run has no line break to fold, so
 * {@link appendLiteralText} bakes it into the atom's own text and
 * leaves the join `"glue"` - flush by the join alone would wrongly
 * refuse `` ``  a  b  `` ``'s real, byte-visible padding.
 * @param literalInterior - whether the span's content is in literal
 *   (byte-preserving) territory.
 * @param inner - the span's content atoms.
 * @param openSpace - the ordinary path's leading-edge join, already
 *   computed by the caller.
 * @param closeSpace - the ordinary path's trailing-edge join.
 * @returns true when neither edge carries whitespace, by join or byte.
 */
export function spanIsFlush(
  literalInterior: boolean,
  inner: readonly Atom[],
  openSpace: string,
  closeSpace: string,
): boolean {
  if (!literalInterior) {
    return openSpace === "" && closeSpace === "";
  }
  // The `last === undefined` disjunct is the type-total spelling of
  // a fact the edge tests already decide: an empty literal interior
  // only arrives here with a folded edge run, so one of the two
  // space tests has answered false before `last` is consulted. It is
  // spelled as a guard (rather than `inner.at(-1)?.text ?? ""`) so
  // `last.text` below is a plain read with no fallback arm.
  const last = inner.at(-1);
  if (openSpace !== "" || closeSpace !== "" || last === undefined) {
    return false;
  }
  return (
    !edgeIsWhitespace(inner[0].text, "start") &&
    !edgeIsWhitespace(last.text, "end")
  );
}
