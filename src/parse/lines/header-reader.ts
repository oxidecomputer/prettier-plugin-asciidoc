/**
 * The document header, read EXTENT-FIRST at the title line - Ruby's
 * `parse_header_metadata` (parser.rb:1815, Asciidoctor core 2.0.26),
 * which is a straight-line function and is ported here as one:
 *
 * ```ruby
 * process_attribute_entries reader, document          # skips comments too
 * if reader.has_more_lines? && !reader.next_line_empty?
 *   author_metadata = process_authors reader.read_line, ...
 *   process_attribute_entries reader, document
 *   if reader.has_more_lines? && !reader.next_line_empty?
 *     rev_line = reader.read_line ...
 *     process_attribute_entries reader, document
 * ```
 *
 * Three facts that read as surprises and are each measured against
 * the oracle (see tests/conformance/document-header.test.ts):
 *
 * - The author line gets NO test. `reader.read_line` takes whatever
 *   is there, so `* item`, `== S`, `[foo]` and `----` all become the
 *   author; `AuthorInfoLineRx` only decides how the name is SPLIT,
 *   never whether the line is one. The revision line is the same
 *   story one line down. That is why the scan's last arm is total and
 *   asks the classifier nothing.
 * - A COMMENT does not end the header, and neither does a `////`
 *   block - blank lines inside it included, because
 *   `skip_comment_lines` runs the whole block off before the blank
 *   test is reached. So the scan consumes a comment block whole.
 * - The header ends at the FIRST BLANK LINE, at end of input, or at
 *   the first line past a filled revision slot. Nothing else closes
 *   it.
 *
 * KNOWN GAP, inherited rather than introduced: an attribute entry
 * whose value CONTINUES onto the next line (`:x: a \` then `  b`) is
 * one entry to the oracle and two lines to us (#24, the
 * `gap:attribute-continuation` family, 6 corpus documents). Inside a
 * header that costs an attribution slot - we read `  b` as the author
 * and the real author line as the revision - and the slot invariant
 * reads as satisfied while both slots hold the wrong lines. Every
 * shape probed is byte-preserving and render-equal, because the lines
 * are replayed where they were written; it is the MODEL that is
 * wrong, and it stops being wrong when #24 does.
 */
import { buildBlockComment } from "../build/delimited.js";
import {
  buildAuthorLine,
  buildDocumentHeader,
  buildRevisionLine,
} from "../build/header.js";
import {
  buildAttributeEntry,
  buildReaderConsumedLine,
} from "../build/metadata.js";
import type {
  BlockNode,
  DocumentHeaderNode,
  HeaderLineNode,
} from "../../ast.js";
import type { Fragment, LocationIndex } from "../positions.js";
import type { ReaderContext } from "../line-shapes.js";
import { classifyLine, classifyTrace, type LineKind } from "./classify.js";
import { blockExtentOf, delimitedExtent } from "./delimited-reader.js";
import { fragmentOfLine } from "./frames.js";
import type { SourceLine } from "./split.js";

/**
 * How the classifier sees a header line. Every header line is a BLOCK
 * START to Ruby - `parse_header_metadata` reads line by line with no
 * paragraph open and no list around it - so this is the reader's own
 * block-start context, spelled once here because the scan has no
 * reader to ask.
 */
const HEADER_CONTEXT: ReaderContext = {
  openParagraph: undefined,
  openListStyle: undefined,
  firstLineAfterStart: false,
};

/**
 * Which attribution line the scan is still waiting for. Ruby's two
 * nested `if reader.has_more_lines? && !reader.next_line_empty?`
 * blocks, as a state: `undefined` - both filled - is what the second
 * `if` having no third sibling means, so a THIRD attribution line is
 * not something the scan has to remember not to build.
 */
type OpenSlot = "author" | "revision";

/** The builder each open slot fills. */
const SLOT_BUILDERS: Record<
  OpenSlot,
  (line: Fragment, at: LocationIndex) => HeaderLineNode
> = {
  author: buildAuthorLine,
  revision: buildRevisionLine,
};

/** What filling a slot leaves open; nothing, past the revision. */
const NEXT_SLOT: Record<OpenSlot, OpenSlot | undefined> = {
  author: "revision",
  revision: undefined,
};

/**
 * The stream the scan runs over and the facts fixed across it - the
 * same shape ParagraphScan has (lines/paragraph-reader.ts), for the
 * same reason: a scan is a pure function over lines, so what it needs
 * about the document travels as data rather than as a reader it holds.
 */
export interface HeaderScan {
  /** The whole document - what a comment block's content is sliced from. */
  readonly source: string;
  /** The document's lines. */
  readonly lines: readonly SourceLine[];
  /** The document's offset->Location index. */
  readonly at: LocationIndex;
}

/**
 * The header the scan read, and where the document resumes.
 *
 * NOT exported, for the reason `DelimitedExtent` is not
 * (lines/delimited-reader.ts): the reader destructures the result and
 * never spells the type, and the scorecard gates a `src` export with
 * no `src` consumer.
 */
interface DocumentHeaderRead {
  /** The header node. */
  readonly node: DocumentHeaderNode;
  /** Index of the first line past the header. */
  readonly end: number;
}

/** One metadata line (or block) the scan consumed. */
interface HeaderMetadata {
  /** The node it became. */
  readonly node: HeaderLineNode;
  /** Index of the first line past it. */
  readonly resume: number;
}

// The block kinds a document header can still open AFTER. The header
// is read ONCE, over the lines `parse_block_metadata_lines` eats
// before anything looks for the title, so a header is reachable only
// while nothing but these has been emitted (measured: `[[id]]` before
// `= T` still yields a header, while `.Cap` before it demotes the
// title to a section - see tests/conformance/document-header.test.ts).
// Blank lines are absent because they emit no block at all.
//
// The BARRIER FOR A STYLE IS THE PINNED ORACLE'S, NOT RUBY'S. Ruby
// 2.0.26's parse_document_header bails on `block_attrs['title']` alone
// (parser.rb:132), so `[foo]` above the title still builds a header
// there; the oracle we are pinned to adds `|| blockAttrs.style`
// (@asciidoctor/core 4.0.11, src/parser.js:180). The oracle wins, and
// this comment exists so the next reader does not "fix" the code back
// to the Ruby.
//
// `blockAttributeList` is IN this set on purpose. The style question
// is asked ONCE, at hold time (headerSurvivesHold): a `[foo]` has
// already cleared the bit there, and a `[#id]` has already been
// judged transparent. Re-asking it here - where only the node kind is
// visible and the style is not - retired the bit a second time for
// the same source line, which is how `[#id]` / `:x: y` / `= T` lost
// its header and re-rendered the author line as body text.
const BEFORE_HEADER: ReadonlySet<BlockNode["type"]> = new Set([
  "comment",
  "attributeEntry",
  "preprocessorDirective",
  "blockAnchor",
  "blockAttributeList",
]);

// The same fact one layer earlier, for the metadata run: an anchor
// and a riding comment/directive line are held back rather than
// pushed, so their transparency has to be read off the LINE KIND
// before the flush ever happens. `blockTitle` is deliberately absent,
// because a `.Cap` above the title demotes it to a section.
// `attributeLine` is absent too, but only CONDITIONALLY: see
// headerSurvivesHold.
const BEFORE_HEADER_HELD: ReadonlySet<LineKind["kind"]> = new Set([
  "anchor",
  "raw",
]);

/**
 * Whether a document header is still reachable after this block has
 * been emitted.
 *
 * The reader keeps the answer as one forward-only bit, so this is a
 * question about the block ALONE - no history, nothing derived from
 * the sequence.
 * @param type - the block's discriminant
 * @returns whether the header survives it
 */
export function headerSurvivesBlock(type: BlockNode["type"]): boolean {
  return BEFORE_HEADER.has(type);
}

/**
 * Whether a document header is still reachable after a metadata line
 * has been HELD.
 *
 * Read off the KIND, not the node: a held line is not pushed until
 * the block it annotates opens, and for a `= Title` that is after the
 * header question has been asked.
 *
 * An attribute line is a barrier only when it names a STYLE, and this
 * is the ONE place that question is asked - see the note on
 * {@link BEFORE_HEADER} about asking it twice. Measured against the
 * oracle across the whole shape: `[foo]`, `[foo,bar]`, `[NOTE]`,
 * `[foo#id]` and `[foo bar]` demote the title to a section, while
 * `[]`, `[#id]`, `[.role]`, `[%opt]`, `[,bar]`, `[a=b,c]`,
 * `[foo = bar]` and `[separator=::]` all leave the header standing.
 * The barrier is the ORACLE's behaviour; Ruby 2.0.26 builds a header
 * for every one of them (parser.js:180 against parser.rb:132).
 * @param kind - what the classifier made of the held line
 * @param namesStyle - whether the held `[...]` line names a style
 *   ({@link Attrlist.styleAttribute}); read by the attribute-line arm
 *   alone
 * @returns whether the header survives it
 */
export function headerSurvivesHold(
  kind: LineKind,
  namesStyle: boolean,
): boolean {
  if (kind.kind === "attributeLine") return !namesStyle;
  return BEFORE_HEADER_HELD.has(kind.kind);
}

/**
 * The metadata a header line carries, when it carries any:
 * an attribute entry, a comment or preprocessor line the reader eats
 * where it stands, or a whole `////` comment block.
 *
 * `undefined` is the answer for EVERY other line, including the ones
 * that look like block syntax - that is the point, and it is what
 * makes the caller's attribution arm total.
 * @param scan - the stream and the facts fixed over it
 * @param index - index of the line being examined
 * @param kind - what the classifier made of it
 * @returns the node and the resume index, or undefined when the line
 *   is not header metadata
 */
function headerMetadata(
  scan: HeaderScan,
  index: number,
  kind: LineKind,
): HeaderMetadata | undefined {
  const { source, lines, at } = scan;
  const line = lines[index];
  if (kind.kind === "attributeEntry") {
    return {
      node: buildAttributeEntry(kind, fragmentOfLine(line), at),
      resume: index + 1,
    };
  }
  if (kind.kind === "delimiterOpen" && kind.block === "commentBlock") {
    const extent = delimitedExtent(lines, index, kind.block);
    // A header lives in the document reader alone, so the boundary a
    // block comment that never closes is stamped with is the
    // document's end - the same forced-close offset the reader uses
    // at EOF.
    return {
      node: buildBlockComment(blockExtentOf(extent, source, source.length), at),
      resume: extent.resume,
    };
  }
  const consumed = buildReaderConsumedLine(fragmentOfLine(line), at);
  return consumed === undefined
    ? undefined
    : { node: consumed, resume: index + 1 };
}

/**
 * Collect the document header opening at `titleIndex`.
 *
 * Called only where Asciidoctor builds a header - at the document
 * reader's first block, on a level-0 title (lines/reader.ts owns that
 * decision, because reachability is reader state).
 * @param scan - the stream and the facts fixed over it
 * @param titleIndex - index of the `= Title` line
 * @param title - the classifier's title text, already trimmed
 * @returns the header node and the index past it
 */
export function documentHeader(
  scan: HeaderScan,
  titleIndex: number,
  title: string,
): DocumentHeaderRead {
  const { lines, at } = scan;
  const collected: HeaderLineNode[] = [];
  let slot: OpenSlot | undefined = "author";
  let index = titleIndex + 1;
  while (index < lines.length) {
    const kind = classifyLine(lines[index].text, HEADER_CONTEXT);
    classifyTrace.observer?.(lines[index].offset, kind);
    if (kind.kind === "blank") break;
    const metadata = headerMetadata(scan, index, kind);
    if (metadata !== undefined) {
      collected.push(metadata.node);
      index = metadata.resume;
      continue;
    }
    if (slot === undefined) break;
    collected.push(SLOT_BUILDERS[slot](fragmentOfLine(lines[index]), at));
    slot = NEXT_SLOT[slot];
    index += 1;
  }
  return {
    node: buildDocumentHeader(
      fragmentOfLine(lines[titleIndex]),
      title,
      collected,
      at,
    ),
    end: index,
  };
}
