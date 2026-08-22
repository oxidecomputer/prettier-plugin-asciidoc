/**
 * Heading lines: the document title, a section title, and the
 * discrete heading that opens no section.
 *
 * Every function here is `(span, index) → node` and nothing else: no
 * traversal, no context. What a line MEANS was decided by
 * lines/classify.ts against the registry in line-shapes.ts, and which
 * block it belongs to by the reader's frame stack. These only take it
 * apart.
 */
import type {
  DiscreteHeadingNode,
  DocumentTitleNode,
  SectionNode,
} from "../../ast.js";
import { MARKER_OFFSET } from "../../constants.js";
import { unreachable } from "../../unreachable.js";
import type { Fragment, LocationIndex } from "../positions.js";

const SECTION_MARKER_RE = /^(?<markers>={2,6})\s+(?<title>.*)/v;

/**
 * Splits a heading line into its level and title text.
 * @param title - A section-title or discrete-heading line containing
 *   the full heading line (e.g. "== My Title").
 * @returns The level (1 for `==`) and the trimmed title.
 */
function parseHeading(title: Fragment): { level: number; heading: string } {
  // The classifier's SECTION_TITLE and this file's
  // SECTION_MARKER_RE are two patterns for one shape, in two
  // modules. The guard is what says they must agree: if it fires,
  // one of them was edited without the other.
  const match = SECTION_MARKER_RE.exec(title.image);
  const groups =
    match?.groups ?? unreachable(`Invalid section marker: ${title.image}`);
  return {
    level: groups.markers.length - MARKER_OFFSET,
    heading: groups.title.trim(),
  };
}

/**
 * Builds a SectionNode from a heading line.
 *
 * The reader reads the entire heading line as one span
 * (e.g. "== My Title"). We split it here because the AST
 * stores level and title separately -- the printer needs them
 * independently to reconstruct the heading with normalized
 * whitespace.
 * @param title - The section-title line.
 * @param at - The document's location index.
 * @returns A section node with level, heading text, and an
 *   empty children array for the caller to populate.
 */
export function buildSection(title: Fragment, at: LocationIndex): SectionNode {
  return {
    type: "section",
    ...parseHeading(title),
    children: [],
    position: {
      start: at.start(title),
      end: at.end(title),
    },
  };
}

/**
 * Builds a DiscreteHeadingNode from a heading line the reader
 * classified under a pending `[discrete]`: a standalone heading that
 * opens no section and nests nothing.
 * @param title - The discrete-heading line.
 * @param at - The document's location index.
 * @returns A discrete heading with the same level and text a section
 *   would have had.
 */
export function buildDiscreteHeading(
  title: Fragment,
  at: LocationIndex,
): DiscreteHeadingNode {
  return {
    type: "discreteHeading",
    ...parseHeading(title),
    position: {
      start: at.start(title),
      end: at.end(title),
    },
  };
}

// The document title line is `= Title Text`. The prefix `= `
// is always exactly 2 characters (the `=` sign and a space).
const DOCUMENT_TITLE_PREFIX_LEN = 2;

/**
 * Builds a DocumentTitleNode from a document-title line.
 *
 * Like buildSection, the reader reads the full line as one span. We
 * extract the title text here so the printer can normalize whitespace
 * independently of the `= ` prefix.
 * @param title - A document-title line whose image starts with `= `.
 * @param at - The document's location index.
 * @returns A document title node with the extracted title text.
 */
export function buildDocumentTitle(
  title: Fragment,
  at: LocationIndex,
): DocumentTitleNode {
  return {
    type: "documentTitle",
    title: title.image.slice(DOCUMENT_TITLE_PREFIX_LEN).trim(),
    position: {
      start: at.start(title),
      end: at.end(title),
    },
  };
}
