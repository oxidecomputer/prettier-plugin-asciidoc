/**
 * The classifier: ONE pure function that says what a source line IS,
 * given the reader's context.
 *
 * It is the table the BlockReader consults. Every regex it uses lives
 * in src/parse/line-shapes.ts (the registry).
 *
 * The enclosing `read_lines_until terminator:` scan happens BEFORE
 * classification ever runs: `delimitedExtent`
 * (lines/delimited-reader.ts) collects a delimited block's whole
 * extent up front — Ruby's `build_block` — so no terminator
 * vocabulary reaches this table, and a verbatim interior line is
 * never classified by anyone. The ORDER of the remaining checks
 * mirrors Asciidoctor: `PreprocessorReader#process_line` and comment
 * skipping first, then the open paragraph's interrupting set
 * (`read_paragraph_lines` / `read_lines_for_list_item`), and finally
 * `parse_block_metadata_line` → `next_section` → `next_block` for a
 * block's first line.
 *
 * Context is READ here, never derived: the reader owns the context.
 * That is the whole point of this module. Nothing in this file scans
 * backwards, re-reads source,
 * or inspects a token history.
 */
import {
  ADMONITION_LABEL,
  ATTRIBUTE_CONTINUATION,
  ATTRIBUTE_ENTRY,
  BLOCK_ANCHOR,
  BLOCK_ATTRIBUTE_LINE,
  BLOCK_MACRO,
  BLOCK_TITLE,
  CALLOUT_MARKER_LINE,
  CALLOUT_STYLE,
  CONTINUATION_LINE,
  DELIMITED_BLOCK_PATTERNS,
  DELIMITER_KINDS,
  DLIST_SEPARATOR_WORD,
  INDENTED_PLUS,
  LINE_COMMENT,
  LIST_MARKER_LINE,
  LITERAL_LINE,
  PAGE_BREAK,
  SECTION_TITLE,
  SETEXT_LEVEL_MARKS,
  SETEXT_TITLE_LINE,
  SETEXT_UNDERLINE,
  THEMATIC_BREAK,
  continuationMetadataKind,
  isRawParagraphLine,
  optionalGroup,
  orderedMarkerStyle,
  rawLineForm,
  rstrip,
  type DelimiterKind,
  type ParagraphContext,
  type RawForm,
  type ReaderContext,
} from "../line-shapes.js";
import { interruptsParagraph } from "../line-shapes-interruption.js";
import { parseDescriptionListLine } from "../line-shapes-description.js";
import type {
  AttributeEntryFields,
  DescriptionDelimiter,
  ListNode,
} from "../../ast.js";
import {
  AUTO_CALLOUT_NUMBER,
  MARKER_OFFSET,
  SETEXT_LENGTH_SLACK,
} from "../../constants.js";

export type { DelimiterKind } from "../line-shapes.js";

/**
 * The list kinds, read off the AST rather than respelled. This used to
 * be a hand-synced copy of `ListNode.variant`'s three literals, which
 * is one closed set with two spellings — the AST owns it, so the alias
 * points there and can no longer drift. Local: every reference is in
 * this file (ParsedMarker's two arms), and knip's types bucket gates
 * dead exported types at 0.
 */
type ListVariant = ListNode["variant"];

/**
 * What makes a later line a SIBLING item of an open list. Ruby's test
 * compares RESOLVED marker traits, never raw lines
 * (`is_sibling_list_item?`, parser.rb:2280-2284, whose last arm asks
 * `sibling_trait == (resolve_list_marker list_type, $1)`); dlists
 * compare per-delimiter patterns (`DescriptionListSiblingRx`,
 * rx.rb:340-345; the marker arm is pinned by
 * tests/parser/item-extent.test.ts). Both arms have a producer in
 * list-reader.ts's `siblingTrait`, and both are answered through the
 * one `siblingMarker` - never a parallel matching mechanism.
 */
export type SiblingTrait =
  | {
      /** A list opened by a marker (`*`, `.`, `<1>`). */
      readonly kind: "marker";
      /** The style `resolve_list_marker` resolves the marker to. */
      readonly style: string;
    }
  | {
      /** A description list, opened by a term line. */
      readonly kind: "dlist";
      /**
       * The term delimiter a sibling term must repeat - the key the
       * sibling pattern family is looked up by, so it is the AST's
       * four-member type and not a string a caller could mis-spell.
       */
      readonly delimiter: DescriptionDelimiter;
    };

/**
 * What a list-marker line reports, split by variant: a callout marker
 * carries a NUMBER and the other two carry none, so the number sits on
 * the arm it is valid on instead of beside a variant test somewhere
 * downstream. That split is what lets the builder read the number the
 * classifier's own match already captured, rather than re-matching
 * `<1>` and needing a fallback for the impossible miss.
 */
type ParsedMarker =
  | {
      /** Which list kind the marker opens. */
      readonly variant: Exclude<ListVariant, "callout">;
      /** The marker style `is_sibling_list_item?` compares. */
      readonly style: string;
      /**
       * The marker exactly as the author wrote it. Equal to `style`
       * for every unordered and implicit-ordered marker and DIFFERENT
       * for an explicit ordered one (`5.` resolves to the style `1.`),
       * which is why the two are separate fields: the style decides
       * what is a sibling, the spelling is what the printer replays.
       */
      readonly spelling: string;
      /** Width of the leading whitespace Ruby's `[ \t]*` allows. */
      readonly indent: number;
      /** Offset within the line where the item's text starts. */
      readonly markerEnd: number;
      /**
       * The whitespace between the marker and the item's text,
       * verbatim - the `[ \t]+` of `UnorderedListRx` (rx.rb l.284) and
       * `OrderedListRx` (rx.rb l.300). The BYTES, because what the
       * marks around them spell can be read: see
       * {@link ListItemNode.markerGap}.
       */
      readonly gap: string;
    }
  | {
      /** Which list kind the marker opens. */
      readonly variant: Extract<ListVariant, "callout">;
      /** The style every callout marker resolves to (`<>`). */
      readonly style: string;
      /** The marker exactly as the author wrote it (`<3>`, `<.>`). */
      readonly spelling: string;
      /** Zero: `CalloutListRx` allows no leading whitespace at all. */
      readonly indent: number;
      /** Offset within the line where the item's text starts. */
      readonly markerEnd: number;
      /**
       * The whitespace between the marker and the item's text,
       * verbatim - the `[ \t]+` of `CalloutListRx` (rx.rb l.358). The
       * BYTES, for `ListItemNode.markerGap`'s reason (src/ast.ts).
       */
      readonly gap: string;
      /**
       * The number the marker spells (`<3>` → 3), or
       * `AUTO_CALLOUT_NUMBER` for the auto-numbering `<.>`.
       */
      readonly calloutNumber: number;
    };

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
  | ({
      /** An attribute entry (`:name: value`). */
      readonly kind: "attributeEntry";
    } & AttributeEntryFields)
  | {
      /** A section title, in the ATX or the underlined spelling. */
      readonly kind: "sectionTitle";
      /** Marker count minus one; 0 is the document title. */
      readonly level: number;
      /** The title text: after the markers, or the whole title line. */
      readonly title: string;
      /**
       * How many SOURCE LINES the title occupies: 2 for the
       * underlined spelling, 1 for the ATX one. The reader resumes
       * past exactly this many and spans the node over them, so the
       * count is carried rather than re-derived from the spelling.
       */
      readonly extent: 1 | 2;
    }
  | ({
      /** The first line of a list item (`* item`, `. item`, `<1> item`). */
      readonly kind: "listMarker";
    } & ParsedMarker)
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
      /**
       * The term delimiter. A four-member type because the pattern
       * that captured it can spell no other, and because the open
       * list's sibling pattern is KEYED on it.
       */
      readonly delimiter: DescriptionDelimiter;
      /** The term text, exactly as the registry's group captured it. */
      readonly term: string;
      /**
       * Offset (into the rstripped line) where the inline description
       * starts, or undefined when the term line carries none.
       */
      readonly descriptionStart: number | undefined;
    }
  | {
      /** A delimiter that OPENS a block (`----`, `--`, ` ``` `). */
      readonly kind: "delimiterOpen";
      /** Which delimited block it opens. */
      readonly block: DelimiterKind;
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
      /** Macro name (e.g. `"image"`). */
      readonly name: string;
      /** Target between `::` and `[` (empty for `toc::[]`). */
      readonly target: string;
      /** Raw attribute list content inside `[…]`. */
      readonly attrlist: string;
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
    };

/**
 * A list-marker line, as {@link LineKind} spells it — the classifier's
 * own parse, narrowed to the one arm. Declared here because it IS a
 * `LineKind` arm; both the list scan and the reader name it.
 */
export type MarkerKind = Extract<LineKind, Record<"kind", "listMarker">>;

/**
 * A description-list term line, as {@link LineKind} spells it. Beside
 * {@link MarkerKind} and for the same reason: it IS a `LineKind` arm,
 * and it is the value both a list's OPENING term and every sibling
 * term below it carry, so the two are one type and no caller has to
 * tell them apart.
 */
export type DlistTermKind = Extract<LineKind, Record<"kind", "dlistTerm">>;

/**
 * A section-title line, as {@link LineKind} spells it. Beside the two
 * above and for the same reason: the reader's title arm takes the
 * whole parse - level, text and how many source lines it spelled -
 * and a hand-written parameter type would be a second spelling of an
 * arm that already exists.
 */
export type SectionTitleKind = Extract<
  LineKind,
  Record<"kind", "sectionTitle">
>;

/**
 * Parse a list marker line (`UnorderedListRx` / `OrderedListRx` /
 * `CalloutListRx`). Callouts are tried first because they are the one
 * shape that may not be indented, and `next_block` gates them on
 * `!indented` for exactly that reason.
 *
 * The callout arm reports the marker's NUMBER, which the other two
 * have none of — the split is the reason no builder re-matches `<1>`
 * to read it back out.
 *
 * The VARIANT comes off the branch of {@link LIST_MARKER_LINE} that
 * participated, not off the marker's first character: an explicit
 * ordered marker (`1.`, `a.`, `i)`) starts with neither a dot nor a
 * star, so a spelling test could not tell it from an unordered one.
 * @param line - one rstripped source line
 * @returns the marker's style, spelling and extent, plus the number on
 *   a callout; undefined when the line does not begin a list item
 */
export function parseListMarker(line: string): ParsedMarker | undefined {
  const callout = CALLOUT_MARKER_LINE.exec(line)?.groups;
  if (callout !== undefined) {
    return {
      variant: "callout",
      // Every callout marker shares one style: `is_sibling_list_item?`
      // compares `resolve_list_marker`'s result, so `<2>` continues a
      // `<1>` list.
      style: CALLOUT_STYLE,
      spelling: callout.marker,
      indent: 0,
      markerEnd: callout.marker.length + callout.gap.length,
      gap: callout.gap,
      calloutNumber:
        callout.callout === "."
          ? AUTO_CALLOUT_NUMBER
          : Number.parseInt(callout.callout, 10),
    };
  }
  const groups = LIST_MARKER_LINE.exec(line)?.groups;
  if (groups === undefined) {
    return undefined;
  }
  const { indent, gap } = groups;
  const extent = (
    marker: string,
  ): { indent: number; markerEnd: number; gap: string } => ({
    indent: indent.length,
    markerEnd: indent.length + marker.length + gap.length,
    gap,
  });
  // The ordered branch is the OPTIONAL one read through the widening;
  // when it did not participate the unordered one did, so the fall
  // through needs no second test.
  const ordered = optionalGroup(groups.ordered);
  if (ordered !== undefined) {
    return {
      variant: "ordered",
      style: orderedMarkerStyle(ordered),
      spelling: ordered,
      ...extent(ordered),
    };
  }
  const { unordered } = groups;
  return {
    variant: "unordered",
    style: unordered,
    spelling: unordered,
    ...extent(unordered),
  };
}

/**
 * Parse an ATX section title.
 * @param line - one rstripped source line
 * @returns the section level (0 for the document title) and its title
 *   text, or undefined
 * Exported for its unit test (tests/parser/lines.test.ts); no src
 * consumer.
 * @internal
 */
export function parseSectionTitle(
  line: string,
): { level: number; title: string } | undefined {
  const groups = SECTION_TITLE.exec(line)?.groups;
  return groups === undefined
    ? undefined
    : { level: groups.markers.length - MARKER_OFFSET, title: groups.title };
}

/**
 * Parse a two-line (setext) section title: `setext_section_title?`
 * (parser.rb l.1722-25), which the pinned oracle spells the same way
 * (`@asciidoctor/core/build/node/index.cjs` l.12650-58). Four tests,
 * in Ruby's order: the underline opens with a level mark, it is
 * uniform (both {@link SETEXT_UNDERLINE}), the line above is a title
 * line ({@link SETEXT_TITLE_LINE}), and the two lengths differ by
 * less than two.
 *
 * The LENGTH RULE is `< 2`, so an underline may be one character
 * shorter or longer than its title and no more. The issue that asked
 * for this construct said "within +/-2"; the Ruby and the oracle both
 * say `.abs < 2` and the oracle is the arbiter.
 *
 * The title text is the whole rstripped title line, because Ruby's
 * `SetextSectionTitleRx` group spans it.
 * @param line - the candidate title, one rstripped source line
 * @param nextLine - the line below it, or undefined where a two-line
 *   construct may not be read (see {@link ReaderContext.nextLine})
 * @returns the section level and title, or undefined
 */
function parseSetextTitle(
  line: string,
  nextLine: string | undefined,
): { level: number; title: string } | undefined {
  if (nextLine === undefined) {
    return undefined;
  }
  const underline = rstrip(nextLine);
  const mark = SETEXT_UNDERLINE.exec(underline)?.groups?.mark;
  if (
    mark === undefined ||
    !SETEXT_TITLE_LINE.test(line) ||
    Math.abs(line.length - underline.length) >= SETEXT_LENGTH_SLACK
  ) {
    return undefined;
  }
  // The title is the LINE, its leading whitespace included, which is
  // what Ruby's group captures (`SetextSectionTitleRx` spans the
  // whole line, so the oracle's title for `  lit` over `----` is
  // `  lit`). Which spellings can carry that indent is the READER's
  // question, not this one: an ATX-printed heading cannot, and drops
  // it at the build site, while the document header replays the two
  // source lines and must keep it (lines/reader.ts states both).
  return { level: SETEXT_LEVEL_MARKS.indexOf(mark), title: line };
}

/**
 * Whether an attribute entry UNSETS the attribute. AsciiDoc writes the
 * negation two ways, `:!name:` and `:name!:`, and they are one fact:
 * `store_attribute` (parser.rb l.2131, the chop at l.2133-40) chops the `!` off whichever
 * end carries it and unsets the same attribute either way. Which end
 * the author used is therefore not recorded.
 * @param prefix - The character before the attribute name
 *   (empty string or "!").
 * @param suffix - The character after the attribute name
 *   (empty string or "!").
 * @returns whether the entry unsets the attribute
 */
function parseUnsetBang(prefix: string, suffix: string): boolean {
  return prefix === "!" || suffix === "!";
}

/**
 * Parse an attribute entry line (`:name: value`, `:!name:`,
 * `:name!:`) into the fields its node carries — the ONE parse; the
 * builder reads these fields and re-derives nothing.
 * @param line - one rstripped source line
 * @returns the entry's fields, or undefined when the line is none
 * Exported for its unit test (tests/parser/lines.test.ts); no src
 * consumer.
 * @internal
 */
export function parseAttributeEntry(
  line: string,
): AttributeEntryFields | undefined {
  const groups = ATTRIBUTE_ENTRY.exec(line)?.groups;
  if (groups === undefined) {
    return undefined;
  }
  // The value group is the one optional branch, so it is the one read
  // through {@link optionalGroup} — the WIDENING that costs no
  // assertion.
  const trimmed = optionalGroup(groups.value)?.trim();
  return {
    name: groups.name,
    value: trimmed === undefined || trimmed.length === 0 ? undefined : trimmed,
    unset: parseUnsetBang(groups.prefixBang, groups.suffixBang),
  };
}

/**
 * Whether an attribute entry's value runs onto the line below, and
 * with which suffix.
 *
 * The PAIR is the answer because both halves are needed at once: the
 * value proves there is something to continue (an entry with no value
 * continues nothing, and the type would otherwise let a caller ask
 * for a continued value that does not exist), and the suffix is what
 * every following line is measured against - `process_attribute_entry`
 * fixes `con` from the first line and reads on only while a line ends
 * with THAT spelling, so ` \` never chains into ` +` (parser.rb
 * l.2107-13).
 *
 * The registry's own predicate, declared here because a READER is the
 * only caller (see {@link ATTRIBUTE_CONTINUATION} for why the shape
 * takes that route through the three-step recipe).
 * @param value - the entry's value as the classifier parsed it, or
 *   undefined for `:name:` and the unset forms
 * @returns the value and the two-character suffix it ends with, or
 *   undefined when the entry is finished on its own line
 */
export function attributeContinuation(
  value: string | undefined,
): { readonly value: string; readonly suffix: string } | undefined {
  if (value === undefined) {
    return undefined;
  }
  const groups = ATTRIBUTE_CONTINUATION.exec(value)?.groups;
  return groups === undefined ? undefined : { value, suffix: groups.suffix };
}

/**
 * Parse a block macro line (`name::target[attrlist]`) into its three
 * fields — the ONE parse; the builder re-derives nothing.
 * @param line - one rstripped source line
 * @returns the macro's fields, or undefined when the line is none
 * Exported for its unit test (tests/parser/lines.test.ts); no src
 * consumer.
 * @internal
 */
export function parseBlockMacro(
  line: string,
): { name: string; target: string; attrlist: string } | undefined {
  const groups = BLOCK_MACRO.exec(line)?.groups;
  if (groups === undefined) {
    return undefined;
  }
  // Which of BLOCK_MACRO's two branches matched is read from the LINE
  // itself rather than from a captured group's definedness - the
  // regex's own two literal alternatives are `toc::` and one of
  // `image`/`video`/`audio` followed by `::`, so a line the whole
  // pattern accepted matched the `toc` branch exactly when it starts
  // with that literal, and matched the media branch otherwise. That
  // sidesteps a real cross-engine gap: `groups.mediaName` and
  // `groups.mediaTarget` (the media branch's own group names,
  // line-shapes.ts) are typed `string` unconditionally - a named
  // group's TypeScript type does not vary by which alternative
  // supplied it - so reading them as plain strings is what the type
  // already claims, and is true here because the discriminant below
  // has already ruled out the one branch that leaves them unset.
  if (line.startsWith("toc::")) {
    return { name: "toc", target: "", attrlist: groups.attrlist };
  }
  return {
    name: groups.mediaName,
    target: groups.mediaTarget,
    attrlist: groups.attrlist,
  };
}

/**
 * Parse an admonition label.
 * @param line - one rstripped source line
 * @returns the style name and where the admonition's text starts, or
 *   undefined when the line carries no label
 * Exported for its unit test (tests/parser/lines.test.ts); no src
 * consumer.
 * @internal
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
 * Whether a line is a comment the PARAGRAPH reader drops wherever it
 * stands - the rule `read_paragraph_lines` runs `skip_line_comments`
 * with at every position (parser.rb:754 and :764). Spelled live at
 * reader.rb:424 (`(line.start_with? '//') && !(line.start_with?
 * '///')`); `CommentLineRx` (`%r(^//(?=[^/]|$))`) is the same
 * semantics and is commented out in the vendored source at
 * rx.rb:227, so the reader line is the one to check against.
 *
 * NARROWER than the two characters `Reader#skip_line_comments` tests
 * for ({@link LINE_COMMENT_HEAD}), and the difference is the whole
 * reason this is a question: a `///` line is taken by the head drain
 * and kept by the paragraph reader, so where it stands decides whether
 * it renders at all. Everything the two agree on renders the same at
 * either position.
 * @param line - one rstripped source line
 * @returns true when the paragraph reader drops the line
 */
export function isDroppedCommentLine(line: string): boolean {
  return LINE_COMMENT.test(line);
}

/**
 * Whether a line is INDENTED content - `next_block`'s own
 * `indented = this_line.start_with? ' ', TAB` (parser.rb:572), and
 * the same shape `LiteralParagraphRx` spells for the item scan's two
 * slurps (parser.rb:1488 and parser.rb:1539). A line of nothing but
 * whitespace is not one: it rstrips to empty first, which makes it
 * blank.
 *
 * The list scan, the paragraph scan and the description-list reflow
 * conditions all ask this, which is why it is a question here rather
 * than a pattern each of them tests: the shape has one home
 * (line-shapes.ts) and one reader (this file).
 * @param line - one rstripped source line
 * @returns true when the line starts with a space or a tab
 */
export function isLiteralLine(line: string): boolean {
  return LITERAL_LINE.test(line);
}

/**
 * Whether a line is nothing but indentation and a `+` - the shape
 * whose meaning `adjust_indentation!` can change (parser.rb:755; see
 * INDENTED_PLUS in line-shapes.ts for the whole argument). Asked here
 * because the paragraph scan that needs it consumes classifier
 * verdicts, never patterns.
 *
 * A PREDICATE and not a {@link LineKind} arm, which is the second
 * route docs/coding-standards.md's line-shape recipe describes: this
 * shape neither opens nor ends a block, so the classifier's verdict
 * for such a line is unchanged (it is `text`), and an interruption row
 * for it would pin a grid of identical answers. What reads it is one
 * scan asking about a line it has already claimed.
 * @param line - one rstripped source line
 * @returns true for an indented lone `+`
 */
export function isIndentedContinuationLine(line: string): boolean {
  return INDENTED_PLUS.test(line);
}

/**
 * Whether a line carries a word that would open a description-list
 * term wherever it stood - `DLIST_SEPARATOR_WORD` asked of every word
 * (see line-shapes.ts for why the WORD is the unit and the line is
 * not). Asked here for the same reason the two predicates above are:
 * the paragraph scan that needs it consumes classifier verdicts,
 * never patterns.
 *
 * A PREDICATE and not a {@link LineKind} arm, the second route
 * docs/coding-standards.md's line-shape recipe describes. The
 * classifier's verdict for such a line is unchanged either way,
 * because neither caller asks what the line IS.
 *
 * TWO callers, asking two different questions of the same test. The
 * paragraph scan asks it about a line already classified as a
 * COMMENT, and its question is what the line's words would become if
 * the `//` that heads them stopped heading them (paragraph-reader.ts,
 * `reflows`). The description-list reflow conditions ask it about
 * ordinary description text, and their question is what a word of
 * that text would become if a wrap put it at the head of a line
 * (description-list.ts, condition S). The answer serves both because
 * the word is the unit in each.
 * @param line - one rstripped source line
 * @returns true when a word of it ends in a dlist term separator
 */
export function holdsDescriptionListSeparator(line: string): boolean {
  return line.split(/[ \t]+/v).some((word) => DLIST_SEPARATOR_WORD.test(word));
}

/**
 * The four shapes the item scan lets "block metadata play out" across
 * (`BlockTitleRx`, `BlockAttributeLineRx`, `AttributeEntryRx` and the
 * anchor form the second of those carries, parser.rb:1499-1501),
 * spelled with {@link LineKind}'s own names so the two vocabularies
 * cannot drift apart.
 */
type MetadataLineKind = Extract<
  LineKind,
  Record<"kind", "blockTitle" | "attributeLine" | "anchor" | "attributeEntry">
>["kind"];

/**
 * The registry's own answer set, read off the function rather than
 * respelled here - a second spelling would be the drift the
 * declaration below exists to catch.
 */
type RegistryMetadataKind = NonNullable<
  ReturnType<typeof continuationMetadataKind>
>;

/**
 * `A` when the two unions name the SAME set, and `never` when either
 * carries a name the other does not.
 *
 * Both directions, because one direction is not a guard: a plain
 * annotation accepts a registry answer set that has SHRUNK, so a name
 * quietly dropped there would leave {@link LineKind} claiming a kind
 * nothing can produce. The tuple wrappers stop the conditionals
 * distributing over the union, which is what makes them compare the
 * sets rather than their members one at a time.
 */
type SameNames<A, B> = [A] extends [B] ? ([B] extends [A] ? A : never) : never;

/**
 * "Let block metadata play out until we find the block", answered by
 * the line-shape registry.
 *
 * The DECLARATION is what earns its place here: the registry names
 * the four shapes on its own terms, and this annotation fails to
 * compile if those names and {@link LineKind}'s drift apart in
 * EITHER direction - a name added to or dropped from either side
 * collapses the return type to `undefined`, which the registry's
 * function does not satisfy. The rule itself, its Ruby, and why a
 * comment is not one of the four are stated at
 * {@link continuationMetadataKind}.
 */
export const metadataLineKind: (
  line: string,
) => SameNames<MetadataLineKind, RegistryMetadataKind> | undefined =
  continuationMetadataKind;

/**
 * Classify a line that is starting a block — `parse_block_metadata_line`
 * first (it runs before `next_block` even reads the line), then
 * `next_section`'s title test, then `next_block`'s own ladder.
 *
 * NINE of the arms below are held off where the block start may not
 * be one to Asciidoctor: the four in {@link blockMetadataOrTitleKind}
 * and the five in {@link blockBoundaryOnlyKind}, one group per
 * function. Each is read at a block boundary alone, and each turns
 * into bytes that MOVE when it fires below content the preprocessor
 * substituted - the spelling itself for a break or a setext title,
 * the blank line the printer puts between blocks for the title, the
 * attribute entry and the ATX title, BOTH for the macro, and the
 * blank line between two list items for the two list arms
 * ({@link ReaderContext.substitutedContentAbove}, which names the
 * issue each row carries). Held off, they leave the line to the
 * ladder's text fallback, which is the reading Asciidoctor gives it.
 *
 * The arms that stay are the ones that would stand at a boundary
 * anyway: an anchor and an attribute list END the oracle's paragraph
 * (`StartOfBlockProc`), and so do a delimiter and a `+`.
 *
 * The LAYOUT BREAK has a second reason to be held off, which none of
 * the arms above share because no `=====` run and no `[` line is also
 * a list-marker line: inside an open list a spaced `- - -` is an item
 * line, not a break (#182). The second group's arms therefore do not
 * share one precondition, and what it is asked is which of them may
 * claim the line ({@link blockBoundaryReach}).
 * @param line - one rstripped source line
 * @param reader - the reader's context view; the line below it (where
 *   a two-line construct may be read at all), whether substituted
 *   content stands directly above, and whether a marker line outranks
 *   the break rows are all read off it
 * @returns the line's kind; `text` when nothing else claims it
 */
function classifyBlockStart(line: string, reader: ReaderContext): LineKind {
  // parse_block_metadata_line tests `[[` before the attribute list.
  if (BLOCK_ANCHOR.test(line)) {
    return { kind: "anchor" };
  }
  if (BLOCK_ATTRIBUTE_LINE.test(line)) {
    return { kind: "attributeLine" };
  }
  // Bound ONCE, here rather than at the top of the function: the two
  // arms above are the ones that keep their reading either way, and
  // the answer costs a backwards walk (blockStartContextIn supplies
  // it as a getter for exactly that reason).
  const { substitutedContentAbove } = reader;
  const metadata = substitutedContentAbove
    ? undefined
    : blockMetadataOrTitleKind(line, reader.nextLine);
  if (metadata !== undefined) {
    return metadata;
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
  return classifyBlockBody(
    line,
    blockBoundaryReach(line, substitutedContentAbove, reader),
  );
}

/**
 * Which of {@link blockBoundaryOnlyKind}'s arms may claim a line.
 *
 * The two reasons an arm is held off there do not cover the same
 * arms, but they NEST, and these three states are the whole of what
 * that leaves. Substituted content above holds off the entire group;
 * a marker line holds off the two layout breaks and nothing else. So
 * a line reaches no arm, or every arm but the two breaks, or all of
 * them, and "reaches a break but not the macro" is not a state that
 * can be spelled.
 *
 * The two breaks move as a PAIR because Ruby decides both with one
 * test (`layout_break_chars.key? ch0`, parser.rb l.585-590), which is
 * why the middle state names them together rather than one row at a
 * time.
 */
type BlockBoundaryReach = "none" | "exceptLayoutBreaks" | "all";

/**
 * How far down that group a line reaches, asked at the one site that
 * has both of the reasons an arm is held off.
 *
 * CONTENT THE PREPROCESSOR SUBSTITUTED directly above makes a block
 * start here not one to Asciidoctor at all, so no arm whose reading
 * costs the author's bytes may fire
 * ({@link ReaderContext.substitutedContentAbove}, issues #210, #213
 * and #232). A MARKER LINE inside a list item keeps the reading the
 * item's own scan gave it, except at the two positions a break can be
 * spelled at; that is Asciidoctor's own reading where `text_only`
 * covers it and this reader's knowing divergence at the rest
 * ({@link ReaderContext.markerLineWins}, #182 and #242). The second
 * reason is the only one that reads the line, because it is the only
 * one about a collision between two rows, and it is why the answer is
 * three-valued rather than a yes or a no.
 *
 * ORDER IS COST. `substitutedContentAbove` is PASSED rather than read
 * off the context because it is a getter over a backwards walk and
 * the caller has already bound it once for the arms above.
 * `markerLineWins` is read off the context and read LAST, because its
 * answer only ever matters for a line that is a marker line - which
 * the middle test settles for every other line in the document
 * without asking.
 * @param line - one rstripped source line
 * @param substitutedContentAbove - see
 *   {@link ReaderContext.substitutedContentAbove}
 * @param reader - the reader's context view, for `markerLineWins`
 * @returns which of the group's arms may claim the line
 */
function blockBoundaryReach(
  line: string,
  substitutedContentAbove: boolean,
  reader: ReaderContext,
): BlockBoundaryReach {
  if (substitutedContentAbove) {
    return "none";
  }
  if (parseListMarker(line) === undefined) {
    return "all";
  }
  return reader.markerLineWins ? "exceptLayoutBreaks" : "all";
}

/**
 * The rest of `parse_block_metadata_line` and both spellings of a
 * section title - the four arms {@link classifyBlockStart} asks only
 * where the block start is one Asciidoctor also sees.
 * `is_next_line_section?` (parser.rb l.1666) peeks two lines and
 * hands them to `is_section_title?`, whose body is
 * `atx_section_title?(line1) || (line2.nil_or_empty? ? nil :
 * setext_section_title?(line1, line2))` (l.1699): the underline arm
 * is asked only where there IS a line below, which is the same
 * absence {@link ReaderContext.nextLine} spells as undefined.
 *
 * Together here because they are held off together and for one
 * reason, not because Ruby groups them: below substituted content
 * every one of these lines is paragraph text to the oracle, and each
 * of the four costs the author's bytes when it fires there anyway.
 * The two title arms sit ahead of the delimiter test their caller
 * makes next, because `next_section` asks them before it ever calls
 * `next_block`: that ordering is why `Title` over `-----` is a
 * heading and not a paragraph over a listing block, and why `x` over
 * `--` is a heading and not an open block.
 * @param line - one rstripped source line
 * @param nextLine - the line below it, or undefined where a two-line
 *   construct may not be read (see {@link ReaderContext.nextLine})
 * @returns the line's kind, or undefined when no arm claims it
 */
function blockMetadataOrTitleKind(
  line: string,
  nextLine: string | undefined,
): LineKind | undefined {
  if (BLOCK_TITLE.test(line)) {
    return { kind: "blockTitle" };
  }
  const entry = parseAttributeEntry(line);
  if (entry !== undefined) {
    return { kind: "attributeEntry", ...entry };
  }
  const section = parseSectionTitle(line);
  if (section !== undefined) {
    return { kind: "sectionTitle", extent: 1, ...section };
  }
  const underlined = parseSetextTitle(line, nextLine);
  return underlined === undefined
    ? undefined
    : { kind: "sectionTitle", extent: 2, ...underlined };
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
 * through to the literal paragraph instead. The list arms sit inside
 * {@link blockBoundaryOnlyKind} rather than here, and that ordering
 * is unchanged by it: the five arms that group there are the first
 * five of this ladder, in the order Ruby asks them -
 * `ExtLayoutBreakRx` at parser.rb l.591-592, `BlockMediaMacroRx` at
 * l.597-599, `CalloutListRx` at l.686, `UnorderedListRx` at l.692,
 * `OrderedListRx` at l.698 and `DescriptionListRx` at l.704.
 *
 * The arms this ladder holds off below substituted content are
 * grouped into {@link blockBoundaryOnlyKind}, the way
 * {@link classifyBlockStart}'s four are grouped into
 * {@link blockMetadataOrTitleKind}. The group is asked ONCE, but not
 * with one flag: the two LAYOUT BREAK arms carry a second reason to
 * be held off that the rest of the group does not, so what the group
 * takes is which of its arms may claim the line
 * ({@link BlockBoundaryReach}).
 *
 * What is LEFT here is what a paragraph below a substitution reaches
 * anyway. The admonition label is one of them because its bytes do
 * not move: `NOTE: a` prints back as itself whether it is read as a
 * paragraph's style or as the paragraph's first words, measured in
 * both programs. The indented fallback is the other.
 * @param line - one rstripped source line
 * @param reach - which of {@link blockBoundaryOnlyKind}'s arms may
 *   claim this line ({@link classifyBlockStart} states the two
 *   reasons an arm may not)
 * @returns the line's kind; `text` when nothing claims it
 */
function classifyBlockBody(line: string, reach: BlockBoundaryReach): LineKind {
  const atBoundary = blockBoundaryOnlyKind(line, reach);
  if (atBoundary !== undefined) {
    return atBoundary;
  }
  const label = parseAdmonitionLabel(line);
  if (label !== undefined) {
    return { kind: "admonitionLabel", ...label };
  }
  return isLiteralLine(line) ? { kind: "indented" } : { kind: "text" };
}

/**
 * The FIVE arms of `next_block`'s ladder that are read at a block
 * boundary and nowhere else, and so are the ones
 * {@link classifyBlockStart}'s preconditions hold off.
 *
 * The two LAYOUT BREAKS are the two alternatives of one Ruby rule,
 * `ExtLayoutBreakRx`, and each prints back a canonical spelling
 * (`'''`, `<<<`) that is not the one it read. The BLOCK MACRO carries
 * that cost and the blank line at once: its brackets are always an
 * attribute list and the printer respells them (`canonicalAttrlist`,
 * print/printer.ts), and it is a block of its own, so the printer
 * puts a blank line under it. Below substituted content both moved
 * the render, and neither needs the other to: `image::a.png[ alt ]`
 * lost its padding, and `image::a.png[]` over `more` was split into
 * two blocks where the oracle reads one paragraph (issue #232).
 *
 * The two breaks are held off by a SECOND reason the other three are
 * not, which is why `reach` says WHICH arms may claim the line rather
 * than whether any may. That reason and the LIST arms below are one
 * question asked twice, and {@link blockBoundaryReach} asks
 * `parseListMarker` once for both: a marker line under substituted
 * content is prose, because no arm here is reached at all; a marker
 * line anywhere else is a marker; and the layout break is left to
 * decide the lines that are NOT marker lines, plus the marker lines
 * the reader does not let win
 * ({@link ReaderContext.markerLineWins}). A spaced `- - -` inside an
 * open list is that item's own marker line, and `image::a.png[]`,
 * which matches no marker pattern, is a macro wherever it stands.
 *
 * The LIST MARKER (`UnorderedListRx`, `OrderedListRx` and
 * `CalloutListRx`, one parse in {@link parseListMarker}) and the
 * DESCRIPTION-LIST TERM (`DescriptionListRx`) spend the author's
 * bytes a third way: not on the line's own spelling but on the blank
 * line BETWEEN two items. At document level `read_paragraph_lines`
 * takes `StartOfBlockProc` (parser.rb l.36), which holds no marker,
 * so below a substitution the oracle reads `* a` as the paragraph's
 * own text and only a later `* b` as a list of one. Read as one list
 * over both here, the printer's list normalization then dropped the
 * blank line the author wrote between them and a whole `<ul>` left
 * the render under Asciidoctor 2.0.26 and `@asciidoctor/core` 4.0.11
 * alike (issue #261). Held off, both lines are paragraph text, the
 * blank is a paragraph boundary and the author's bytes stand.
 * Measured the same way in both programs for `. a`, `<1> a`,
 * `* [ ] a` and `t:: d`, under a body-bearing conditional as well as
 * an include, which is why the two arms move together with the other
 * three rather than one shape at a time.
 *
 * SURVIVING BYTES: the fact all five consume is
 * `substitutedContentAbove`, and its carrier is the directive line
 * itself, which every one of these readings re-emits verbatim - a
 * held-off line joins the paragraph the directive opened, so the
 * directive stays a line of its own above it and pass 2 reads the
 * same answer off the same bytes.
 * @param line - one rstripped source line
 * @param reach - which of these arms may claim the line
 * @returns the line's kind, or undefined when no arm claims it
 */
function blockBoundaryOnlyKind(
  line: string,
  reach: BlockBoundaryReach,
): LineKind | undefined {
  if (reach === "none") {
    return undefined;
  }
  if (reach === "all") {
    if (THEMATIC_BREAK.test(line)) {
      return { kind: "thematicBreak" };
    }
    if (PAGE_BREAK.test(line)) {
      return { kind: "pageBreak" };
    }
  }
  const macro = parseBlockMacro(line);
  if (macro !== undefined) {
    return { kind: "blockMacro", ...macro };
  }
  const marker = parseListMarker(line);
  if (marker !== undefined) {
    return { kind: "listMarker", ...marker };
  }
  const term = parseDescriptionListLine(line);
  return term === undefined
    ? undefined
    : {
        kind: "dlistTerm",
        indent: line.length - line.trimStart().length,
        ...term,
      };
}

/**
 * Classify a line while a paragraph-shaped block is open. Only the
 * context's interrupting set matters here (`read_paragraph_lines`,
 * `read_lines_for_list_item`); the registry is that table.
 * @param line - one rstripped source line
 * @param context - which kind of paragraph is open
 * @param reader - the reader's context view
 * @returns the line's kind, or undefined when the line ENDS the
 *   paragraph and the caller must classify it as a block start instead
 */
function classifyInParagraph(
  line: string,
  context: ParagraphContext,
  reader: ReaderContext,
): LineKind | undefined {
  if (interruptsParagraph(line, context, reader)) {
    return undefined;
  }
  // The interrupter check runs FIRST so that a context where the
  // anchor DOES interrupt (dlistItem) never reaches this rule — the
  // registry's RAW_BLOCK_ANCHOR_CONTEXTS comment names the same
  // ordering.
  if (!isRawParagraphLine(line, context, reader)) {
    return { kind: "text" };
  }
  // Of the registry's three contextual raw shapes only the anchor is
  // a raw LINE, a line the reader drops from the block's content.
  // The other two are ordinary TEXT that must not be REFLOWED, which
  // is what the verbatim flag says, and they need it for two
  // different reasons. A foreign list marker inside a `+`-attached
  // paragraph needs its COLUMN: moved off column 0 it stops flipping
  // `within_nested_list` and a later `+` changes meaning. Block
  // metadata on a description's first line needs its LINE: joined
  // onto the term it becomes the term's last words and the block it
  // titled loses what it said. Neither is dropped, so neither is
  // raw.
  return BLOCK_ANCHOR.test(line)
    ? { kind: "raw", form: "anchor" }
    : { kind: "text", verbatim: true };
}

/**
 * What a trace hook is handed: the source offset of the line the
 * reader just classified, and the verdict it acted on. Not exported:
 * the one spelling a caller needs is {@link classifyTrace}'s own
 * field type, named here.
 */
type ClassifyObserver = (offset: number, kind: LineKind) => void;

/**
 * The one slot a trace hook goes in. `observer` is undefined
 * everywhere except inside a verification harness that installed one.
 *
 * The reader reports every verdict it acts on through this slot, from
 * its four classification sites: `BlockReader#run` (lines/reader.ts),
 * `documentHeaderExtent` (lines/header-reader.ts), and the paragraph
 * scan and `verbatimRunExtent` (lines/paragraph-reader.ts). With no
 * hook installed each site is one undefined check, so the
 * classifier's behaviour and cost are unchanged.
 *
 * A one-field object rather than an exported `let`: the lint rules
 * want every binding initialized on declaration AND refuse an
 * `= undefined` initializer at module scope, and a slot is what this
 * is anyway.
 */
export const classifyTrace: { observer: ClassifyObserver | undefined } = {
  observer: undefined,
};

/**
 * Classify one line. See the module comment for the order and its Ruby.
 * @param rawLine - the source line without its newline; rstripped here,
 *   the way `Helpers.prepare_source_string` rstrips every line before
 *   the parser sees it
 * @param reader - the reader's context view; never derived, always read
 * @returns the line's kind; `text` is the total fallback, which is what
 *   makes the block level unable to fail
 */
export function classifyLine(rawLine: string, reader: ReaderContext): LineKind {
  const line = rstrip(rawLine);
  if (line.length === 0) {
    return { kind: "blank" };
  }
  // 1. Preprocessor lines and comments are consumed while READING
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
  // 2. Inside an open paragraph only the context's interrupting set
  //    matters; a line that interrupts falls through to 3 so the
  //    reader learns WHAT ended the paragraph.
  if (reader.openParagraph !== undefined) {
    const inParagraph = classifyInParagraph(line, reader.openParagraph, reader);
    if (inParagraph !== undefined) {
      return inParagraph;
    }
  }
  // 3. A block's first line.
  return classifyBlockStart(line, reader);
}
