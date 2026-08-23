/**
 * Heading lines: one leaf `heading` kind for `=` (level 0, the
 * document-title spelling) through `======` (level 5), and the
 * discrete heading that opens no section. Sections are not modeled
 * (spec D10) — a heading is a LEAF and its level is data.
 *
 * Every function here takes the CLASSIFIER's level (the sectionTitle
 * LineKind carries it — SECTION_TITLE in line-shapes.ts, the ONE
 * derivation): the second marker pattern this module used to hold,
 * and the `unreachable(` agreement guard that held the two together,
 * died with it.
 */
import type { DiscreteHeadingNode, HeadingNode } from "../../ast.js";
import { MARKER_OFFSET } from "../../constants.js";
import type { Fragment, LocationIndex } from "../positions.js";

/**
 * The title text after the `level + 1` markers, trimmed — the same
 * trim both deleted builders applied.
 * @param title - the whole heading line
 * @param level - the classifier's level (marker count minus one)
 * @returns the trimmed title text
 */
function headingText(title: Fragment, level: number): string {
  return title.image.slice(level + MARKER_OFFSET).trim();
}

/**
 * Builds a HeadingNode from a heading line the classifier already
 * leveled.
 * @param title - the heading line (e.g. "== My Title")
 * @param level - the classifier's level; 0 is the document title
 * @param at - the document's location index
 * @returns the heading leaf
 */
export function buildHeading(
  title: Fragment,
  level: number,
  at: LocationIndex,
): HeadingNode {
  return {
    type: "heading",
    level,
    title: headingText(title, level),
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
 * @param title - the discrete-heading line
 * @param level - the classifier's level
 * @param at - the document's location index
 * @returns the discrete heading
 */
export function buildDiscreteHeading(
  title: Fragment,
  level: number,
  at: LocationIndex,
): DiscreteHeadingNode {
  return {
    type: "discreteHeading",
    level,
    title: headingText(title, level),
    position: {
      start: at.start(title),
      end: at.end(title),
    },
  };
}
