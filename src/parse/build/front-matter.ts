/**
 * YAML front matter: the `---`-fenced block at the very top of a
 * document.
 *
 * Asciidoctor's preprocessor lifts this out before the parser reads a
 * single block (`parser.rb`, `skip_front_matter!`), and its guard is
 * exactly "line 1 is `---`". Nothing about it is AsciiDoc, so the only
 * correct transformation is none: content is SLICED out of the source
 * the way delimited.ts slices verbatim blocks, because rebuilding it
 * line by line loses interior blank lines.
 *
 * Like every other builder here this is `(extent, index) → node` and
 * nothing else. Where the block started and ended was decided by the
 * reader; this only takes it apart.
 */
import type { FrontMatterNode } from "../../ast.js";
import { EMPTY, NEWLINE_LENGTH } from "../../constants.js";
import type { Fragment, LocationIndex } from "../positions.js";

/** The source extent a front-matter block read. */
export interface FrontMatterExtent {
  /** The opening `---`. */
  readonly open: Fragment;
  /**
   * The closing `---`. Never absent: the reader finds the terminator
   * before it consumes anything, because a document without one is not
   * front matter at all.
   */
  readonly close: Fragment;
  /** The whole document; content is sliced out of it. */
  readonly source: string;
}

/**
 * Builds a FrontMatterNode from the extent the reader read.
 * @param extent - where the block opened, closed, and its document
 * @param at - the document's location index
 * @returns the front-matter node, content verbatim
 */
export function buildFrontMatter(
  extent: FrontMatterExtent,
  at: LocationIndex,
): FrontMatterNode {
  const { open, close, source } = extent;
  const contentStart = open.offset + open.image.length + NEWLINE_LENGTH;
  const { offset: contentEnd } = close;
  const raw =
    contentStart >= contentEnd ? "" : source.slice(contentStart, contentEnd);
  // The slice ends one past the last content newline, so drop it: the
  // printer re-adds a newline before the closing fence, and keeping it
  // here would make `---\na\n---` and `---\na\n\n---` indistinguishable
  // from their own output.
  const content = raw.endsWith("\n") ? raw.slice(EMPTY, -NEWLINE_LENGTH) : raw;
  return {
    type: "frontMatter",
    content,
    position: { start: at.start(open), end: at.end(close) },
  };
}
