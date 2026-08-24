/**
 * Heading lines: one leaf `heading` kind for `=` (level 0, the
 * document-title spelling) through `======` (level 5), and the
 * discrete heading that opens no section. Sections are not modeled
 * — a heading is a LEAF and its level is data.
 *
 * Every function here takes the CLASSIFIER's parse (the sectionTitle
 * LineKind carries it — SECTION_TITLE in line-shapes.ts, the ONE
 * derivation): the second marker pattern this module used to hold,
 * and the `unreachable(` agreement guard that held the two together,
 * died with it. The classifier's SECTION_TITLE capture carries the
 * title; nothing here slices or trims.
 */
import type { DiscreteHeadingNode, HeadingNode } from "../../ast.js";
import type { Fragment, LocationIndex } from "../positions.js";

/**
 * Builds a HeadingNode from a heading line the classifier already
 * parsed.
 * @param line - the heading line (e.g. "== My Title")
 * @param level - the classifier's level; 0 is the document title
 * @param title - the classifier's title text
 * @param at - the document's location index
 * @returns the heading leaf
 */
export function buildHeading(
  line: Fragment,
  level: number,
  title: string,
  at: LocationIndex,
): HeadingNode {
  return {
    type: "heading",
    level,
    title,
    position: {
      start: at.start(line),
      end: at.end(line),
    },
  };
}

/**
 * Builds a DiscreteHeadingNode from a heading line the reader
 * classified under a pending `[discrete]`: a standalone heading that
 * opens no section and nests nothing.
 * @param line - the discrete-heading line
 * @param level - the classifier's level
 * @param title - the classifier's title text
 * @param at - the document's location index
 * @returns the discrete heading
 */
export function buildDiscreteHeading(
  line: Fragment,
  level: number,
  title: string,
  at: LocationIndex,
): DiscreteHeadingNode {
  return {
    type: "discreteHeading",
    level,
    title,
    position: {
      start: at.start(line),
      end: at.end(line),
    },
  };
}
