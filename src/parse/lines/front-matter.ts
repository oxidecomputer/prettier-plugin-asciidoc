/**
 * YAML front matter: the `---` block a static site generator writes
 * above the document.
 *
 * Ruby's is `skip_front_matter!` (reader.rb l.1304-22), and it is a
 * question about the STREAM, not about any line's shape: the first
 * line must be exactly `---`, the block runs to the next line that is
 * exactly `---`, and if the stream ends before one is found the lines
 * are all put back and there was no front matter. Nothing about the
 * three characters says any of that, which is why the fence takes no
 * `LineKind` arm - a `---` anywhere else is the ordinary text it
 * always was - and why this read runs from `readDocument`, the one
 * caller that knows a line is the document's first.
 *
 * WHAT THE FORMATTER DOES: it writes the block back byte for byte.
 * The oracle reads these lines two ways (see {@link FrontMatterNode}),
 * the block is YAML rather than AsciiDoc, and only the author's own
 * bytes are right under both readings and to the generator that
 * consumes them.
 *
 * The partner fence may stand ARBITRARILY far down, so everything
 * between the two is frozen verbatim however much of the document it
 * is - which is render-safe because it is exactly the span
 * `skip_front_matter!` reads, and is the seam a future Markdown
 * thematic break (#23) meets: a `---` inside the block is part of
 * the YAML here and a break to a reader that starts lower down.
 *
 * KNOWN AND NOT CLOSED HERE: reflow may still MANUFACTURE an opening
 * fence, by breaking a document's first paragraph line right after a
 * leading `---` when the word behind it does not fit. The
 * block-start hazard net (src/print/block-start-hazard.ts) is the
 * mechanism for that class, and it cannot carry this one: it asks
 * whether a line START reads as block syntax, position-blind, so
 * teaching it this shape would refuse `---` at the head of EVERY
 * reflowed line rather than at the one place a fence can exist. A
 * document whose first line already IS `---` with a partner below is
 * read here before any paragraph exists, so the hazard needs a first
 * line that begins `--- ` and a lone `---` somewhere under it.
 */
import type { FrontMatterNode } from "../../ast.js";
import { FRONT_MATTER_FENCE } from "../line-shapes.js";
import type { LocationIndex } from "../positions.js";
import type { SourceLine } from "./split.js";

/** A document's front matter, and where the document resumes. */
interface FrontMatterRead {
  /** The block, fences included. */
  readonly node: FrontMatterNode;
  /** Index of the first line past the closing fence. */
  readonly resume: number;
}

/**
 * How many lines the document's front matter occupies, when it has
 * any: the opening fence, the metadata, and the closing fence.
 *
 * Ruby's `until (eof = data.empty?) || data[0] == delim` shifts lines
 * into the block until it meets the closing fence or runs out; the
 * `eof` arm then unshifts everything, which is the same answer as
 * finding nothing. Blank lines do NOT stop it - a YAML document may
 * hold one - so the search is over every remaining line.
 *
 * Exported for the reading model (tests/lib/reading.ts), which tells
 * the lines a reader consumed without classifying from the lines
 * nothing accounted for and needs this extent to do it. One
 * authority, so the model cannot answer differently from the reader.
 * @param lines - the document's lines
 * @returns the line count, or undefined when the document opens with
 *   no front matter
 * @internal
 */
export function frontMatterExtent(
  lines: readonly SourceLine[],
): number | undefined {
  if (lines.at(0)?.text !== FRONT_MATTER_FENCE) {
    return undefined;
  }
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].text === FRONT_MATTER_FENCE) {
      return index + 1;
    }
  }
  return undefined;
}

/**
 * Read the front matter a document opens with, if it opens with any.
 *
 * Called once, on the document's own lines, before any block is read
 * (src/parse/lines/reader.ts, `readDocument`) - the front matter is
 * the stream's first lines or it does not exist, so there is nothing
 * for a confined reader to ask.
 * @param source - the whole document, for the block's image
 * @param lines - the document's lines
 * @param at - the document's location index
 * @returns the block and the resume index, or undefined when the
 *   document opens with no front matter
 */
export function readFrontMatter(
  source: string,
  lines: readonly SourceLine[],
  at: LocationIndex,
): FrontMatterRead | undefined {
  const extent = frontMatterExtent(lines);
  if (extent === undefined) {
    return undefined;
  }
  const block = lines.slice(0, extent);
  const [open] = block;
  const last = block[extent - 1];
  const span = {
    image: source.slice(open.offset, last.offset + last.raw.length),
    offset: open.offset,
  };
  return {
    node: {
      type: "frontMatter",
      content: block.map((line) => line.text).join("\n"),
      position: { start: at.start(span), end: at.end(span) },
    },
    resume: extent,
  };
}
