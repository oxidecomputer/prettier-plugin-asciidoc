/**
 * The document header's nodes: the header itself and the two
 * attribution lines it can hold.
 *
 * Every function here is `(span, ...) -> node` and nothing else, like
 * the rest of src/parse/build/: WHICH lines belong to the header was
 * decided by lines/header-reader.ts, against the same classifier
 * every other line goes through. These only take the result apart.
 *
 * The header is Asciidoctor's `parse_document_header` ->
 * `parse_header_metadata` (parser.rb, Asciidoctor core 2.0.26 - the
 * revision the oracle runs).
 */
import type {
  AuthorLineNode,
  DocumentHeaderNode,
  HeaderLineNode,
  RevisionLineNode,
} from "../../ast.js";
import type { Fragment, LocationIndex } from "../positions.js";

/**
 * Builds the author line's node - the first header line that is
 * neither an attribute entry nor a comment.
 *
 * The value is the line's whole span, verbatim, for the reason
 * {@link AuthorLineNode} states: `AuthorInfoLineRx` is a LOSSY read
 * of the line (`First_Name Last` reaches the attribute table as
 * `First Name Last`), so the only spelling a formatter can put back
 * is the one the author wrote.
 * @param line - the author line's span
 * @param at - the document's location index
 * @returns the author line node
 */
export function buildAuthorLine(
  line: Fragment,
  at: LocationIndex,
): AuthorLineNode {
  return {
    type: "authorLine",
    value: line.image,
    position: {
      start: at.start(line),
      end: at.end(line),
    },
  };
}

/**
 * Builds the revision line's node - the second attribution line.
 * Verbatim for the same reason the author line is: `RevisionInfoLineRx`
 * splits `v1.0, 2026-08-26: remark` into three attributes and a
 * formatter that re-joined them would invent punctuation.
 * @param line - the revision line's span
 * @param at - the document's location index
 * @returns the revision line node
 */
export function buildRevisionLine(
  line: Fragment,
  at: LocationIndex,
): RevisionLineNode {
  return {
    type: "revisionLine",
    value: line.image,
    position: {
      start: at.start(line),
      end: at.end(line),
    },
  };
}

/**
 * Builds the document header from its title line and the lines the
 * scan collected under it.
 *
 * The END is DERIVED from the last child rather than passed in: the
 * header's extent is exactly its title line plus its children's
 * lines, so a second parameter carrying it would be a second
 * derivation of one fact, free to drift from the children the same
 * call already has. With no children the header IS the title line.
 * @param title - the `= Title` line's span
 * @param text - the classifier's title text, already trimmed
 * @param lines - the header's lines after the title, in source order
 * @param at - the document's location index
 * @returns the header node
 */
export function buildDocumentHeader(
  title: Fragment,
  text: string,
  lines: HeaderLineNode[],
  at: LocationIndex,
): DocumentHeaderNode {
  const last = lines.at(-1);
  return {
    type: "documentHeader",
    title: text,
    lines,
    position: {
      start: at.start(title),
      end: last === undefined ? at.end(title) : last.position.end,
    },
  };
}
