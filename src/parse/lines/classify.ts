/**
 * The classifier: ONE pure function that says what a source line IS,
 * given the reader's context.
 *
 * It is the table the BlockReader consults. Every regex it uses lives
 * in src/parse/line-shapes.ts (the registry), and the ORDER of the
 * checks mirrors Asciidoctor: the enclosing `read_lines_until
 * terminator:` scan first, then `PreprocessorReader#process_line` and
 * comment skipping, then the open paragraph's interrupting set
 * (`read_paragraph_lines` / `read_lines_for_list_item`), and finally
 * `parse_block_metadata_line` → `next_section` → `next_block` for a
 * block's first line.
 *
 * Context is READ here, never derived: the reader owns the stack.
 * That is the whole point of this module (see the spec's Success
 * criterion). Nothing in this file scans backwards, re-reads source,
 * or inspects a token history.
 */
import {
  ADMONITION_LABEL,
  ATTRIBUTE_ENTRY,
  BLOCK_ANCHOR,
  BLOCK_ATTRIBUTE_LINE,
  BLOCK_MACRO,
  BLOCK_TITLE,
  CALLOUT_MARKER_LINE,
  CALLOUT_STYLE,
  CONDITIONAL_DIRECTIVE,
  CONTINUATION_LINE,
  DELIMITED_BLOCK_PATTERNS,
  DELIMITER_KINDS,
  INCLUDE_DIRECTIVE,
  LINE_COMMENT,
  LIST_MARKER_LINE,
  LITERAL_LINE,
  PAGE_BREAK,
  SECTION_TITLE,
  THEMATIC_BREAK,
  interruptsParagraph,
  isDescriptionListLine,
  isRawParagraphLine,
  rstrip,
  type DelimiterKind,
  type ParagraphContext,
} from "../line-shapes.js";
import { EMPTY, MARKER_OFFSET, OUTERMOST_DEPTH } from "../../constants.js";

export type { DelimiterKind } from "../line-shapes.js";

/** The three list kinds the AST knows (`ListNode.variant`). */
export type ListVariant = "unordered" | "ordered" | "callout";

/**
 * Why a line is raw — kept verbatim and invisible to block structure.
 * The first three are consumed while READING (`skip_line_comments`,
 * `PreprocessorReader#process_line`); `anchor` is block metadata for a
 * block `fold_first` merges away, so the oracle renders no id at all.
 */
export type RawForm = "comment" | "conditional" | "include" | "anchor";

/** What a line IS, in the reader's context. */
export type LineKind =
  | {
      /** An empty line (after rstrip) — `Reader#skip_blank_lines`. */
      readonly kind: "blank";
    }
  | {
      /** Ordinary paragraph text; also the classifier's total fallback. */
      readonly kind: "text";
      /**
       * Set when the line is text the reader must keep on its OWN
       * output line instead of reflowing it into its neighbours.
       * The one shape that needs it today is a list marker of a list
       * that is not open around a `+`-attached paragraph: it does not
       * end the paragraph, but `read_lines_for_list_item` flips
       * `within_nested_list` on any `NESTABLE_LIST_CONTEXTS` line, and
       * that flag decides whether the NEXT `+` is a real continuation.
       * Moving the marker off column 0 silently changes the `+`'s
       * meaning. Absent (never `false`) on ordinary text.
       */
      readonly verbatim?: true;
    }
  | {
      /** A line kept verbatim; see {@link RawForm}. */
      readonly kind: "raw";
      /** Which raw shape it is. */
      readonly form: RawForm;
    }
  | {
      /** A block attribute list (`[source,ruby]`, `[]`). */
      readonly kind: "attributeLine";
    }
  | {
      /** A block anchor (`[[id]]`) acting as block metadata. */
      readonly kind: "anchor";
    }
  | {
      /** A block title (`.Title`). */
      readonly kind: "blockTitle";
    }
  | {
      /** An attribute entry (`:name: value`). */
      readonly kind: "attributeEntry";
    }
  | {
      /** An ATX section title (`== Section`). */
      readonly kind: "sectionTitle";
      /** Marker count minus one; 0 is the document title. */
      readonly level: number;
    }
  | {
      /** The first line of a list item (`* item`, `. item`, `<1> item`). */
      readonly kind: "listMarker";
      /** Which list kind the marker opens. */
      readonly variant: ListVariant;
      /** The marker style `is_sibling_list_item?` compares. */
      readonly style: string;
      /** Nesting depth the marker asks for (`**` is 2). */
      readonly depth: number;
      /** Width of the leading whitespace Ruby's `[ \t]*` allows. */
      readonly indent: number;
      /** Offset within the line where the item's text starts. */
      readonly markerEnd: number;
    }
  | {
      /** A lone `+` — `LIST_CONTINUATION`. */
      readonly kind: "continuation";
    }
  | {
      /** A description-list item (`term:: definition`). */
      readonly kind: "dlistTerm";
      /**
       * Width of the leading whitespace `DescriptionListRx`'s `\s*`
       * swallows: the term — and the item's text — starts after it.
       */
      readonly indent: number;
    }
  | {
      /** A delimiter that OPENS a block (`----`, `--`, ` ``` `). */
      readonly kind: "delimiterOpen";
      /** Which delimited block it opens. */
      readonly block: DelimiterKind;
    }
  | {
      /** A delimiter matching a terminator the reader has open. */
      readonly kind: "delimiterClose";
    }
  | {
      /** An admonition label (`NOTE: text`). */
      readonly kind: "admonitionLabel";
      /** The style name (`NOTE`, `TIP`, …). */
      readonly label: string;
      /** Offset within the line where the admonition's text starts. */
      readonly labelEnd: number;
    }
  | {
      /** A block macro (`image::a.png[]`). */
      readonly kind: "blockMacro";
    }
  | {
      /** A thematic break (`'''`). */
      readonly kind: "thematicBreak";
    }
  | {
      /** A page break (`<<<`). */
      readonly kind: "pageBreak";
    }
  | {
      /** An indented line — the start or body of a literal paragraph. */
      readonly kind: "indented";
    }
  | {
      /** A line inside a verbatim block: content, whatever its shape. */
      readonly kind: "verbatim";
    };

/**
 * Read-only view of the reader's stack — exactly the facts the old
 * token patterns reconstructed by scanning backwards.
 */
export interface ReaderContext {
  /** The paragraph-shaped block being read, or undefined at a block start. */
  readonly openParagraph: ParagraphContext | undefined;
  /** Marker styles of every open list, innermost first (`is_sibling_list_item?`). */
  readonly openListStyles: readonly string[];
  /** Terminators of open compound blocks, outermost first (`read_lines_until terminator:`). */
  readonly openTerminators: readonly string[];
  /** Set while inside a verbatim/comment block; undefined otherwise. */
  readonly inVerbatim:
    | {
        /** The delimiter line that closes the verbatim block. */
        readonly close: string;
      }
    | undefined;
  /** Whether this line is the FIRST one after the open block started. */
  readonly firstLineAfterStart: boolean;
}

/** The context at a plain block start (document level, nothing open). */
export const BLOCK_START_CONTEXT: ReaderContext = {
  openParagraph: undefined,
  openListStyles: [],
  openTerminators: [],
  inVerbatim: undefined,
  firstLineAfterStart: false,
};

/**
 * Parse a list marker line (`UnorderedListRx` / `OrderedListRx` /
 * `CalloutListRx`). Callouts are tried first because they are the one
 * shape that may not be indented, and `next_block` gates them on
 * `!indented` for exactly that reason.
 * @param line - one rstripped source line
 * @returns the marker's style, depth and extent, or undefined when the
 *   line does not begin a list item
 */
export function parseListMarker(line: string):
  | {
      variant: ListVariant;
      style: string;
      depth: number;
      indent: number;
      markerEnd: number;
    }
  | undefined {
  const callout = CALLOUT_MARKER_LINE.exec(line)?.groups;
  if (callout !== undefined) {
    return {
      variant: "callout",
      // Every callout marker shares one style: `is_sibling_list_item?`
      // compares `resolve_list_marker`'s result, so `<2>` continues a
      // `<1>` list.
      style: CALLOUT_STYLE,
      depth: OUTERMOST_DEPTH,
      indent: EMPTY,
      markerEnd: callout.marker.length + callout.gap.length,
    };
  }
  const groups = LIST_MARKER_LINE.exec(line)?.groups;
  if (groups === undefined) {
    return undefined;
  }
  const { indent, marker, gap } = groups;
  return {
    variant: marker.startsWith(".") ? "ordered" : "unordered",
    style: marker,
    // A `-` list is always one level deep; the repeating markers spell
    // their depth in their length (`**` is level 2).
    depth: marker === "-" ? OUTERMOST_DEPTH : marker.length,
    indent: indent.length,
    markerEnd: indent.length + marker.length + gap.length,
  };
}

/**
 * Parse an ATX section title.
 * @param line - one rstripped source line
 * @returns the section level (0 for the document title), or undefined
 */
export function parseSectionTitle(line: string): { level: number } | undefined {
  const markers = SECTION_TITLE.exec(line)?.groups?.markers;
  return markers === undefined
    ? undefined
    : { level: markers.length - MARKER_OFFSET };
}

/**
 * Parse an admonition label.
 * @param line - one rstripped source line
 * @returns the style name and where the admonition's text starts, or
 *   undefined when the line carries no label
 */
export function parseAdmonitionLabel(
  line: string,
): { label: string; labelEnd: number } | undefined {
  const groups = ADMONITION_LABEL.exec(line)?.groups;
  return groups === undefined
    ? undefined
    : { label: groups.label, labelEnd: groups.prefix.length };
}

/**
 * Which delimited block a line opens (`is_delimited_block?`).
 * @param line - one rstripped source line
 * @returns the block kind, or undefined when the line is no delimiter
 */
export function delimiterKind(line: string): DelimiterKind | undefined {
  return DELIMITER_KINDS.find((kind) =>
    DELIMITED_BLOCK_PATTERNS[kind].test(line),
  );
}

/**
 * Which raw shape a line has, of the ones the reader consumes wherever
 * they occur. The block anchor is NOT here: it is raw only in the
 * contexts {@link isRawParagraphLine} names.
 * @param line - one rstripped source line
 * @returns the raw form, or undefined for an ordinary line
 */
export function rawLineForm(
  line: string,
): Exclude<RawForm, "anchor"> | undefined {
  if (LINE_COMMENT.test(line)) {
    return "comment";
  }
  if (CONDITIONAL_DIRECTIVE.test(line)) {
    return "conditional";
  }
  return INCLUDE_DIRECTIVE.test(line) ? "include" : undefined;
}

/**
 * Whether a line is a `+` list continuation (`LIST_CONTINUATION`).
 *
 * Rstrips first: Asciidoctor compares `line == '+'` against a line
 * the reader already rstripped,
 * so `+␠` with an invisible trailing space is still a marker. Callers
 * inside this module pass an already-rstripped line and pay nothing;
 * callers outside it get the same answer either way.
 * @param line - one source line, rstripped here if it is not already
 * @returns true for a lone `+`
 */
export function isContinuationLine(line: string): boolean {
  return CONTINUATION_LINE.test(rstrip(line));
}

/**
 * Classify a line that is starting a block — `parse_block_metadata_line`
 * first (it runs before `next_block` even reads the line), then
 * `next_section`'s title test, then `next_block`'s own ladder.
 * @param line - one rstripped source line
 * @returns the line's kind; `text` when nothing else claims it
 */
function classifyBlockStart(line: string): LineKind {
  // parse_block_metadata_line tests `[[` before the attribute list.
  if (BLOCK_ANCHOR.test(line)) {
    return { kind: "anchor" };
  }
  if (BLOCK_ATTRIBUTE_LINE.test(line)) {
    return { kind: "attributeLine" };
  }
  if (BLOCK_TITLE.test(line)) {
    return { kind: "blockTitle" };
  }
  if (ATTRIBUTE_ENTRY.test(line)) {
    return { kind: "attributeEntry" };
  }
  const section = parseSectionTitle(line);
  if (section !== undefined) {
    return { kind: "sectionTitle", level: section.level };
  }
  // next_block asks `is_delimited_block?` before anything else, which
  // is why `****` is a sidebar and `* x` a list.
  const block = delimiterKind(line);
  if (block !== undefined) {
    return { kind: "delimiterOpen", block };
  }
  if (isContinuationLine(line)) {
    return { kind: "continuation" };
  }
  return classifyBlockBody(line);
}

/**
 * The rest of `next_block`'s ladder: breaks, macros, list markers,
 * description-list terms, the admonition label, and the indented
 * literal-paragraph fallback.
 *
 * `indented` comes LAST because indentation is `next_block`'s fallback
 * for a line nothing else claimed, while `UnorderedListRx`,
 * `OrderedListRx` and `DescriptionListRx` all accept Ruby's leading
 * `[ \t]*` — so `␠␠* x` is a list. `CalloutListRx` does not, and
 * `next_block` gates it on `!indented`, which is why `␠␠<1> x` falls
 * through to the literal paragraph instead.
 * @param line - one rstripped source line
 * @returns the line's kind; `text` when nothing claims it
 */
function classifyBlockBody(line: string): LineKind {
  if (THEMATIC_BREAK.test(line)) {
    return { kind: "thematicBreak" };
  }
  if (PAGE_BREAK.test(line)) {
    return { kind: "pageBreak" };
  }
  if (BLOCK_MACRO.test(line)) {
    return { kind: "blockMacro" };
  }
  const marker = parseListMarker(line);
  if (marker !== undefined) {
    return { kind: "listMarker", ...marker };
  }
  if (isDescriptionListLine(line)) {
    return { kind: "dlistTerm", indent: line.length - line.trimStart().length };
  }
  const label = parseAdmonitionLabel(line);
  if (label !== undefined) {
    return { kind: "admonitionLabel", ...label };
  }
  return LITERAL_LINE.test(line) ? { kind: "indented" } : { kind: "text" };
}

/**
 * Classify a line while a paragraph-shaped block is open. Only the
 * context's interrupting set matters here (`read_paragraph_lines`,
 * `read_lines_for_list_item`); the registry is that table.
 * @param line - one rstripped source line
 * @param context - which kind of paragraph is open
 * @param reader - the reader's stack view
 * @returns the line's kind, or undefined when the line ENDS the
 *   paragraph and the caller must classify it as a block start instead
 */
function classifyInParagraph(
  line: string,
  context: ParagraphContext,
  reader: ReaderContext,
): LineKind | undefined {
  const options = {
    enclosingListStyles: reader.openListStyles,
    firstLineAfterBlockStart: reader.firstLineAfterStart,
  };
  if (interruptsParagraph(line, context, options)) {
    return undefined;
  }
  // The interrupter check runs FIRST so that a context where the
  // anchor DOES interrupt (dlistItem) never reaches this rule — the
  // registry's RAW_BLOCK_ANCHOR_CONTEXTS comment names the same
  // ordering.
  if (!isRawParagraphLine(line, context, options)) {
    return { kind: "text" };
  }
  // Of the registry's two contextual raw shapes only the anchor is a
  // raw LINE — a line the reader drops from the block's content. The
  // other (a foreign list marker inside a `+`-attached paragraph) is
  // ordinary TEXT whose COLUMN is load-bearing, so it stays text and
  // carries the flag that keeps it on its own output line.
  return BLOCK_ANCHOR.test(line)
    ? { kind: "raw", form: "anchor" }
    : { kind: "text", verbatim: true };
}

/**
 * Classify one line. See the module comment for the order and its Ruby.
 * @param rawLine - the source line without its newline; rstripped here,
 *   the way `Helpers.prepare_source_string` rstrips every line before
 *   the parser sees it
 * @param reader - the reader's stack view; never derived, always read
 * @returns the line's kind; `text` is the total fallback, which is what
 *   makes the block level unable to fail
 */
export function classifyLine(rawLine: string, reader: ReaderContext): LineKind {
  const line = rstrip(rawLine);
  // 1. An open block's terminator wins over everything else, and the
  //    OUTERMOST one wins over an inner block's.
  //
  //    The mechanism is NOT that `read_lines_until` scans for several
  //    terminators — it breaks only on the ONE it was given. It is
  //    that `build_block` reads a delimited block's whole extent up
  //    front (`Reader.new reader.read_lines_until(terminator: …)`)
  //    and parses its children out of that new Reader. The parent's
  //    delimiter line was already consumed by the parent's read, so a
  //    child that never closes simply runs out of lines at it. Read
  //    line by line, as here, that is indistinguishable from the
  //    outermost terminator claiming the line — which is why the
  //    reader may keep one flat stack instead of re-reading extents.
  if (
    reader.openTerminators.includes(line) ||
    reader.inVerbatim?.close === line
  ) {
    return { kind: "delimiterClose" };
  }
  if (reader.inVerbatim !== undefined) {
    return { kind: "verbatim" };
  }
  if (line.length === EMPTY) {
    return { kind: "blank" };
  }
  // 2. Preprocessor lines and comments are consumed while READING
  //    (`PreprocessorReader#process_line`, `Reader#skip_line_comments`),
  //    before block structure exists, so they are raw everywhere.
  //
  //    ORACLE SURPRISE the reader will have to handle (it does not
  //    change this verdict): `read_paragraph_lines` is called with
  //    `skip_line_comments: text_only`, so a `//` line inside a
  //    document-level LITERAL paragraph is NOT dropped — it stays as
  //    verbatim content and Asciidoctor renders it. Classification is
  //    the same either way (the line never interrupts); what differs
  //    is whether the reader may reorder or drop it.
  const rawForm = rawLineForm(line);
  if (rawForm !== undefined) {
    return { kind: "raw", form: rawForm };
  }
  // 3. Inside an open paragraph only the context's interrupting set
  //    matters; a line that interrupts falls through to 4 so the
  //    reader learns WHAT ended the paragraph.
  if (reader.openParagraph !== undefined) {
    const inParagraph = classifyInParagraph(line, reader.openParagraph, reader);
    if (inParagraph !== undefined) {
      return inParagraph;
    }
  }
  // 4. A block's first line.
  return classifyBlockStart(line);
}
