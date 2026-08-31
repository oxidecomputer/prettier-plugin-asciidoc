/**
 * AST types for prettier-plugin-asciidoc.
 *
 * These types are designed for Prettier, not the official AsciiDoc ASG.
 * The ASG intentionally discards comments, attribute entries, and directives,
 * but a formatter must preserve them. Our AST retains everything the source
 * contains so the printer can reproduce it faithfully.
 *
 * Position information uses exclusive end offsets (one past the last character)
 * to match Prettier's conventions.
 */

/**
 * A point in the source text.
 * Line and column are 1-based; offset is 0-based.
 */
export interface Location {
  /** Zero-based character offset from the start of the source. */
  offset: number;
  /** One-based line number in the source. */
  line: number;
  /** One-based column number in the source. */
  column: number;
}

/**
 * Every AST node carries a position with start (inclusive) and end (exclusive).
 * Prettier uses locStart/locEnd for cursor tracking and range formatting;
 * having positions on every node ensures those features work correctly.
 *
 * Not exported: it is the base every node interface below extends, and
 * nothing outside this module names it.
 */
interface Node {
  /** Discriminant tag identifying the concrete node kind. */
  type: string;
  /**
   * Source location with inclusive start and exclusive end,
   * matching Prettier's locStart/locEnd conventions.
   */
  position: {
    /** Inclusive start point (first character of the node). */
    start: Location;
    /** Exclusive end point (one past the last character). */
    end: Location;
  };
}

/**
 * Root node. Prettier requires a single root; children are block-level
 * elements.
 */
export interface DocumentNode extends Node {
  /** Node discriminant. */
  type: "document";
  /** Top-level block elements in document order. */
  children: BlockNode[];
  /**
   * The byte-order mark the reader took off the head of the source,
   * as written, when there was one. Carried so the printer can put it
   * back: taking it off is how the first line is READ, not an edit to
   * the file, and a formatter that dropped it would delete bytes the
   * input had and expose any second mark behind it to the next read.
   * Absent, not empty, on the overwhelming majority of documents, so
   * that an unmarked tree serializes exactly as it did before the
   * field existed.
   */
  byteOrderMark?: string;
}

/** A paragraph contains inline nodes (text, emphasis, links, etc.). */
export interface ParagraphNode extends Node {
  /** Node discriminant. */
  type: "paragraph";
  /** Inline content: text, emphasis, links, etc. */
  children: InlineNode[];
}

/** Raw text content. Lines within a paragraph are joined with \n in `value`. */
export interface TextNode extends Node {
  /** Node discriminant. */
  type: "text";
  /** Raw text content; paragraph lines joined with `\n`. */
  value: string;
}

/** Bold inline span: `*text*` (constrained) or `**text**` (unconstrained). */
export interface BoldNode extends Node {
  /** Node discriminant. */
  type: "bold";
  /**
   * Whether the span uses constrained (`*`) or
   * unconstrained (`**`) delimiters.
   */
  constrained: boolean;
  /** Inline content within the bold span. */
  children: InlineNode[];
}

/** Italic inline span: `_text_` (constrained) or `__text__` (unconstrained). */
export interface ItalicNode extends Node {
  /** Node discriminant. */
  type: "italic";
  /**
   * Whether the span uses constrained (`_`) or
   * unconstrained (`__`) delimiters.
   */
  constrained: boolean;
  /** Inline content within the italic span. */
  children: InlineNode[];
}

/** Monospace inline span: `` `text` `` (constrained) or ` `` text `` ` (unconstrained). */
export interface MonospaceNode extends Node {
  /** Node discriminant. */
  type: "monospace";
  /**
   * Whether the span uses constrained (`` ` ``) or
   * unconstrained (` `` `) delimiters.
   */
  constrained: boolean;
  /** Inline content within the monospace span. */
  children: InlineNode[];
}

/**
 * Highlight (mark) inline span: `#text#` (constrained) or
 * `##text##` (unconstrained). Often used with a role attribute
 * like `[red]#text#` or `[.classname]#text#`.
 */
export interface HighlightNode extends Node {
  /** Node discriminant. */
  type: "highlight";
  /**
   * Whether the span uses constrained (`#`) or
   * unconstrained (`##`) delimiters.
   */
  constrained: boolean;
  /**
   * Role/style attribute from the preceding `[role]` syntax.
   * Undefined when no role is specified.
   */
  role: string | undefined;
  /** Inline content within the highlight span. */
  children: InlineNode[];
}

/**
 * A curved-quote span: `"` + backtick + content + backtick + `"`
 * (rendered `&#8220;...&#8221;`), or the `'` pair (`&#8216;...&#8217;`)
 * - entities measured from the oracle's output, since the converter
 * that writes them is not among the vendored sources.
 * `QUOTE_SUBS` rows 3 and 4, asciidoctor.rb l.449-452.
 *
 * No `constrained` field: the two rows have only one spelling each, so
 * there is no constrained form for the printer to choose and no state
 * to refuse at runtime. No `role` field either: the rows carry the
 * same optional attrlist group every row has, but the tokenizer's
 * `RoleAttribute` rule only fires in front of `#`, so a role before a
 * curved pair reaches the printer as text (a known gap, kept out of
 * scope for issue #74).
 *
 * Serialized key order: `type, quote, children, position`.
 */
export interface CurvedQuoteNode extends Node {
  /** Node discriminant. */
  type: "curvedQuote";
  /** Which pair spells it: `"`...`"` or `'`...`'`. */
  quote: "double" | "single";
  /** Inline content within the curved-quote span. */
  children: InlineNode[];
}

/**
 * An attribute reference: `{name}`. Preserved verbatim in the
 * AST — the formatter does not resolve attribute values. Also
 * covers counter attributes like `{counter:name}`.
 */
export interface AttributeReferenceNode extends Node {
  /** Node discriminant. */
  type: "attributeReference";
  /** Attribute name between the braces (e.g. `toc`). */
  name: string;
}

/**
 * Inline link written without a `name:` prefix: a bare URL
 * (`https://example.com`, `https://example.com[text]`) or a bare
 * email address (`user@example.com`). Kept separate from
 * InlineMacroNode because it has different syntax: there is no name to
 * split off and no attrlist to canonicalize. Round-trip fidelity comes
 * from {@link LinkNode#target}, which the printer writes back
 * verbatim.
 */
export interface LinkNode extends Node {
  /** Node discriminant. */
  type: "link";
  /**
   * Which prefix-less spelling the author used: `"url"` for a bare
   * URL, `"email"` for a bare address. Macro-form links (`link:`,
   * `mailto:`) use InlineMacroNode instead.
   *
   * A RECORD of the spelling, not yet an input to one: nothing in
   * `src/` reads it, because both spellings print as their target and
   * the printer needs no case split to do it.
   */
  form: "url" | "email";
  /**
   * The link destination as the author wrote it: the URL, or the
   * address without the `mailto:` scheme Ruby prepends when it
   * renders one.
   */
  target: string;
  /**
   * Display text from the attribute list (e.g. the
   * `text` in `https://example.com[text]`). Undefined
   * when no display text was provided, which an address always is:
   * it has no bracket syntax to carry one.
   */
  text: string | undefined;
}

/**
 * Cross-reference via shorthand syntax: `<<target>>` or
 * `<<target,text>>`. Kept separate from InlineMacroNode
 * because the `<<>>` syntax is not `name:target[attrlist]`.
 * The macro form (`xref:target[text]`) uses InlineMacroNode.
 */
export interface XrefNode extends Node {
  /** Node discriminant. */
  type: "xref";
  /** Always `"shorthand"` — macro-form xrefs use InlineMacroNode. */
  form: "shorthand";
  /** Cross-reference target ID or `doc.adoc#anchor`. */
  target: string;
  /**
   * Display text (e.g. `<<id,text>>`). Undefined when
   * no explicit display text was provided.
   */
  text: string | undefined;
}

/**
 * Inline anchor: `[[id]]`/`[[id, reftext]]` (`form: "inline"`) or the
 * bibliography spelling `[[[id]]]`/`[[[id, reftext]]]`
 * (`form: "bibliography"`, InlineBiblioAnchorRx, rx.rb l.457). Sets an
 * anchor point within paragraph text. The two-argument form
 * provides default cross-reference display text. The two forms share
 * one node type because they share id/reftext grammar and every
 * downstream consumer but the printer's own bracket count; `form` is
 * what tells the printer which delimiter width to write back.
 */
export interface InlineAnchorNode extends Node {
  /** Node discriminant. */
  type: "inlineAnchor";
  /**
   * Which bracket syntax the author wrote: `"inline"` for `[[id]]`,
   * `"bibliography"` for `[[[id]]]`. The bibliography spelling is
   * recognised only at the START of the fragment `tokenizeInline`
   * received (src/parse/inline/tokenize.ts) - a paragraph's or list
   * item's own text, never mid-run - which reproduces the "start of
   * the list item" half of Ruby's guard
   * (`@context == :list_item && \@parent.style == 'bibliography'`,
   * substitutors.rb l.714) without the inline layer reading block
   * style, at the cost of also recognising the shape at the start of
   * an ordinary paragraph, where Ruby's guard would refuse it
   * (measured: there Ruby's own InlineAnchorRx falls back to the
   * two-bracket misparse `form: "inline"` still produces here).
   */
  form: "inline" | "bibliography";
  /** Anchor identifier (the first argument). */
  id: string;
  /**
   * The author's post-comma bytes from the two-argument form
   * `[[id, reftext]]`/`[[[id, reftext]]]`, VERBATIM - leading
   * whitespace included - so a grammar-rejected id can print
   * byte-faithfully. Undefined when the anchor has no comma, or when
   * the post-comma spelling is empty or all whitespace (the
   * `[[id,]]`-class narrowing). Ruby's trimmed view is derived where
   * needed; this value never feeds the oracle.
   */
  reftext: string | undefined;
}

/**
 * Unified inline macro: `name:target[attrlist]`. Covers all
 * inline macros that follow the standard AsciiDoc syntax:
 * link, mailto, xref, image, kbd, btn, menu, footnote,
 * footnoteref, and pass. Each is distinguished by `name`.
 *
 * Tokens with different syntax (bare URLs, `<<>>` xrefs,
 * `[[]]` anchors, ` +\n` hard breaks) keep their own types.
 */
export interface InlineMacroNode extends Node {
  /** Node discriminant. */
  type: "inlineMacro";
  /** Macro name (e.g. `"link"`, `"image"`, `"kbd"`). */
  name: string;
  /**
   * Content between `:` and `[` (may be empty for macros
   * like `kbd`, `btn`, `footnote` that have no target).
   */
  target: string;
  /** Raw content between `[` and `]`. */
  attrlist: string;
}

/**
 * Hard line break: ` +` at end of a line forces a break in
 * the output. Represented as a standalone node rather than
 * embedded in text so the printer can produce the correct
 * Doc IR.
 */
export interface HardLineBreakNode extends Node {
  /** Node discriminant. */
  type: "hardLineBreak";
}

/**
 * A comment or preprocessor line that sits INSIDE a paragraph.
 * Asciidoctor drops/consumes it while reading, so it is not text —
 * but the formatter must keep it verbatim, on its own line, in
 * place. Reflowing it into the surrounding text would make a
 * comment visible or a directive inert.
 */
export interface RawLineNode extends Node {
  /** Node discriminant. */
  type: "rawLine";
  /** The whole source line, verbatim. */
  value: string;
}

/**
 * An inline passthrough: `+text+`, `++text++` or `+++text+++`, with
 * the optional `[attrlist]` in front when the author wrote one.
 *
 * A LEAF holding its own bytes, deliberately: Asciidoctor extracts
 * passthroughs before it substitutes anything else
 * (`extract_passthroughs`, substitutors.rb l.1018), so the marks,
 * macros and attribute references between the delimiters are text to
 * the oracle. Modelling the interior as children would hand the
 * printer marks it would try to pair, respell and reflow around —
 * which is how `+*not bold*+` came out as `+*not bold*{plus}`, with
 * both the emphasis and the closing delimiter changed.
 */
export interface PassthroughNode extends Node {
  /** Node discriminant. */
  type: "passthrough";
  /** The whole construct, delimiters and attrlist included, verbatim. */
  value: string;
}

/** Content that appears within a paragraph (text, emphasis, links, etc.). */
export type InlineNode =
  | TextNode
  | BoldNode
  | ItalicNode
  | MonospaceNode
  | HighlightNode
  | CurvedQuoteNode
  | AttributeReferenceNode
  | InlineMacroNode
  | LinkNode
  | XrefNode
  | InlineAnchorNode
  | PassthroughNode
  | RawLineNode
  | HardLineBreakNode;

/**
 * A heading line: `=` (level 0, the document title spelling) through
 * `======` (level 5). A LEAF — sections are not modeled: nothing the
 * printer emits consumes containment, and the level
 * is data, not a type distinction. Serialized key order:
 * `type, level, title, position` (pinned by the serializedKeys row in
 * tests/parser/heading.test.ts).
 */
export interface HeadingNode extends Node {
  /** Node discriminant. */
  type: "heading";
  /** Marker count minus one: `=` is 0, `==` is 1. */
  level: number;
  /** The title text, trimmed. */
  title: string;
}

/**
 * The AUTHOR LINE beneath the document title: the first line of the
 * header that is neither an attribute entry nor a comment
 * (`parse_header_metadata`, parser.rb:1815, reads it with
 * `reader.read_line` and no test at all - `* item`, `== S` and `[foo]`
 * all become the author, measured).
 *
 * The line is carried VERBATIM, as its own span. A formatter may not
 * re-spell it: `AuthorInfoLineRx` (rx.rb:22) splits a name into first /
 * middle / last / email and re-joining those parts would rewrite what
 * the author typed (`First_Name Last` renders as `First Name Last`,
 * so the substitution is not even reversible). It carries no inline
 * children for the same reason the value is verbatim - the header is
 * LINE syntax, and reflowing it into two lines would hand the second
 * line to the revision slot.
 */
export interface AuthorLineNode extends Node {
  /** Node discriminant. */
  type: "authorLine";
  /**
   * The whole source line, verbatim - the exact bytes of the span
   * this node claims, which invariant (iii) checks. Trailing
   * whitespace is part of it and Prettier's Doc printer trims it on
   * the way out, so the OUTPUT is the rstripped line; that is the
   * spelling Asciidoctor read in the first place
   * (`prepare_source_string`), and it is what makes the print
   * idempotent.
   */
  value: string;
}

/**
 * The REVISION LINE: the second attribution line of the header
 * (`v1.0, 2026-08-26: remark` and every looser spelling
 * `RevisionInfoLineRx` (rx.rb:42) admits, which is nearly any line -
 * measured: `----`, `== S` and `not a rev` all land in `revdate`).
 *
 * A separate kind from {@link AuthorLineNode} rather than one kind
 * with a slot field: they are two constructs in the language, with two
 * patterns in rx.rb and two sets of attributes, and naming them apart
 * is what lets the header's shape invariant say "at most one of each,
 * author first" without a second vocabulary. Carried verbatim for the
 * same reason.
 */
export interface RevisionLineNode extends Node {
  /** Node discriminant. */
  type: "revisionLine";
  /** The whole source line, verbatim - see {@link AuthorLineNode}. */
  value: string;
}

/**
 * One line of the document header, after the title line.
 *
 * The union is CLOSED and deliberately narrow: these five kinds are
 * everything `parse_header_metadata` reads. A paragraph, a list or a
 * heading inside a header is unrepresentable, and so - the point of
 * the node existing at all - is an author line anywhere but inside
 * one.
 */
export type HeaderLineNode =
  | AttributeEntryNode
  | CommentNode
  | PreprocessorDirectiveNode
  | AuthorLineNode
  | RevisionLineNode;

/**
 * The DOCUMENT HEADER: the `= Title` line and the lines Asciidoctor
 * reads with it, up to the first blank line
 * (`parse_document_header`, parser.rb:126 -> `parse_header_metadata`,
 * parser.rb:1815).
 *
 * Read EXTENT-FIRST at the title line, like every other composite,
 * because the header's extent is decided there and nowhere else: the
 * title opens it, an attribute entry or a comment continues it, the
 * first other line is the author, the next is the revision, and the
 * first blank line ends it. Modeling it as one node is what makes the
 * bug it was opened for (#18) unrepresentable - the printer joins the
 * header's lines with a plain newline and has no separator decision
 * to get wrong, where a blank line inserted after the title demotes
 * the author line to the first body paragraph and shifts every
 * section boundary below it.
 *
 * A header exists only where Asciidoctor builds one, and that is not
 * the same as "at index 0": it is the first block that is not one of
 * the lines the reader eats before the title - blank lines, comments,
 * attribute entries, preprocessor directives, block anchors and
 * block-attribute lines that name no style. Those keep their own
 * nodes and stand AHEAD of the header in `children` (22 corpus
 * documents parse a header at index > 0). A `= Title` anywhere else
 * is an ordinary level-0 {@link HeadingNode}.
 *
 * The block-attribute line is the one entry in that list that needs a
 * test rather than a kind: `[foo]` above the title demotes it,
 * `[#id]` does not (see `Attrlist.styleAttribute` - the rule is the
 * pinned oracle's, not Ruby's). The test runs ONCE, where the line is
 * held.
 *
 * Those are SEQUENCE facts, checked by invariant (xiv) in
 * tests/parser/ast-invariants.ts - the same way the admonition body
 * split (ix) and the masquerade's recorded delimiter (xiii) are
 * checked - along with "at most one author line, at most one revision
 * line, and never a revision without an author".
 */
export interface DocumentHeaderNode extends Node {
  /** Node discriminant. */
  type: "documentHeader";
  /** The title text after the `=` marker, trimmed. */
  title: string;
  /**
   * The header's lines after the title, in source order. Named
   * `lines` rather than `children` on purpose: they are LINES, not
   * blocks - nothing recurses into them and the printer walks them
   * without Prettier's path - and the printer's `path.map(print,
   * "children")` calls would otherwise have to admit an author line
   * as a printable node of its own.
   */
  lines: HeaderLineNode[];
}

/**
 * A discrete heading — a heading preceded by `[discrete]` that does
 * not create a section. Unlike an ordinary `heading`, it is STYLE,
 * not structure: the oracle renders it as a heading element but it
 * opens no section, so `[discrete]` is outside the heading flatten
 * entirely.
 */
export interface DiscreteHeadingNode extends Node {
  /** Node discriminant. */
  type: "discreteHeading";
  /**
   * Heading depth (0-5), same scale as `HeadingNode.level`: unlike a
   * section title, a discrete heading is valid at level 0 (`= T`),
   * because it is style rather than structure.
   */
  level: number;
  /** Heading text without the leading `=` markers. */
  title: string;
}

/**
 * A comment node. AsciiDoc has two comment forms:
 * - Line comment: `// text` (two slashes then space or EOL)
 * - Block comment: delimited by `////` (4+ slashes) on own line
 *
 * Comments are discarded by the ASG, but our AST preserves them so the
 * formatter can reproduce them faithfully.
 */
export interface CommentNode extends Node {
  /** Node discriminant. */
  type: "comment";
  /**
   * `"line"` for `// text`; `"block"` for the
   * `////`-delimited form.
   */
  commentType: "line" | "block";
  /** Comment text without the delimiter syntax. */
  value: string;
}

/**
 * An attribute entry: `:name: value` metadata declaration.
 *
 * AsciiDoc attribute entries set document-level metadata (author, revdate)
 * or configure toolchain behavior (source-highlighter, toc). The ASG
 * discards them, but a formatter must preserve them to avoid losing
 * configuration and metadata.
 *
 * Syntax variants:
 * - `:name: value` — set with value
 * - `:name:` — set with no value (boolean/flag)
 * - `:!name:` or `:name!:` — unset (negation), one fact under two
 *   spellings; the printer writes `:!name:`
 *
 * The NAME is carried as the author wrote it and printed lowercase:
 * `sanitize_attribute_name` (parser.rb l.2770-71) downcases it on the
 * way in, so case reaches neither the attribute table nor a
 * reference.
 */
export interface AttributeEntryNode extends Node {
  /** Node discriminant. */
  type: "attributeEntry";
  /** Clean attribute name without `!` prefix/suffix. */
  name: string;
  /** Value text, or undefined for no-value entries like `:toc:`. */
  value: string | undefined;
  /**
   * Whether this entry UNSETS the attribute. One fact, not two
   * spellings of one: `store_attribute` (parser.rb l.2131, the chop at l.2133-40) chops a
   * `!` off either end of the name and reaches the same state either
   * way, so `:!name:` and `:name!:` are the same entry and the
   * printer writes the form Asciidoctor's own documentation leads
   * with, `:!name:`.
   */
  unset: boolean;
}

/**
 * An unordered, ordered, or callout list.
 *
 * AsciiDoc lists use repeated markers for nesting: `*` / `**` / `***`
 * for unordered, `.` / `..` / `...` for ordered. Callout lists use
 * `<N>` or `<.>` markers and are always flat (no nesting). The
 * `variant` field distinguishes the three forms. Nesting is
 * represented by ListItemNode children that themselves contain a
 * nested ListNode.
 */
export interface ListNode extends Node {
  /** Node discriminant. */
  type: "list";
  /**
   * `"unordered"` for `*` markers, `"ordered"` for `.`
   * markers, `"callout"` for `<N>` / `<.>` markers.
   */
  variant: "unordered" | "ordered" | "callout";
  /**
   * The marker STYLE shared by this list's items, exactly as the
   * classifier resolved it (`parseListMarker`'s `style`): Ruby's
   * `resolve_list_marker` result (parser.rb:2192,
   * parser.rb:2280-2284), which
   * is the string sibling matching compares: `-`, `*` through
   * `*****`, `.` through `.....`, one of the five explicit ordered
   * representatives (`1.`, `a.`, `A.`, `i)`, `I)`), or the callout
   * sentinel `<>` (CALLOUT_STYLE).
   *
   * NOT the bytes the printer writes. An explicit ordered list spells
   * its items differently from its style and from each other (`5.`
   * and `6.` are both style `1.`), so the marker bytes come from each
   * item's own {@link ListItemNode.markerSpelling}. This field
   * decides STRUCTURE: whether a marker line below continues this
   * list or opens a nested one.
   */
  marker: string;
  /** Items in this list, in document order. */
  children: ListItemNode[];
}

/**
 * The block kinds a verbatim delimited block carries, `table` aside:
 * the three that own a leaf delimiter, plus the parent-block variants
 * a style can re-model into verbatim content. A table is not among
 * them — its delimiter lines are CONTENT, which is a node of its own
 * below rather than a value this set could hold, and the style tables
 * in lines/open-style.ts that name a target variant therefore cannot
 * name one.
 */
export type VerbatimVariant =
  | "listing"
  | "literal"
  | "pass"
  | "example"
  | "sidebar"
  | "quote"
  | "verse";

/**
 * The three block kinds that own a delimiter character of their own —
 * `----`, `....`, `++++`. The printer can spell a delimiter for these
 * knowing nothing else about the block; every other variant reaches a
 * verbatim block by masquerading and prints from the delimiter the
 * open RECORDED.
 */
export type LeafDelimiterVariant = "listing" | "literal" | "pass";

/**
 * A block whose content is preserved verbatim (no inline parsing),
 * in one of the six spellings AsciiDoc gives it.
 *
 * This is a UNION, not one node with conditional fields, and the
 * split is the point: `language` belongs to a Markdown fence,
 * `sourceDelimiter` to a masqueraded parent block, and neither
 * belongs anywhere else. Each member declares all four of the
 * once-conditional fields — `annotatedBy`, `fenced`, `language`,
 * `sourceDelimiter` — either with the type it carries there or as
 * `?: undefined`, so the type states every cell of the matrix that
 * used to be prose above the interface: what a member may hold, and
 * what it never holds. A consumer holding the union can still READ
 * any of the four; only WRITING one where it is invalid is now a
 * compile error.
 *
 * All six share the `"delimitedBlock"` discriminant, so nothing on
 * the wire moves: the serialized key order and every `type` value are
 * exactly what they were before the split (pinned by the key-order
 * rows in tests/parser/block-masquerade.test.ts and by
 * `bun scripts/parity.ts`).
 *
 * Parent-block variants (`example | sidebar | quote`) are
 * `ParentBlockNode` when delimited, not this — unless a style
 * re-modeled them to verbatim, which is {@link MasqueradedBlockNode}.
 *
 * `annotatedBy`, which every member carries, is the bracket interior
 * of the block-attribute line released DIRECTLY above the block —
 * recorded at open iff the attribute line is the LAST node of the
 * pending run (a title, comment or directive held after it leaves the
 * field undefined), and undefined when nothing annotated the block.
 * The sibling BlockAttributeListNode still carries the spelling for
 * printing; this field is the reader's own record, so no consumer
 * re-pairs siblings to learn it (pinned by invariant (xi)). The
 * reader stamps it after construction, so it trails `position` on the
 * wire.
 */
export type DelimitedBlockNode =
  | LeafDelimitedBlockNode
  | FencedCodeBlockNode
  | MasqueradedBlockNode
  | TableBlockNode
  | IndentedLiteralBlockNode
  | ParagraphFormBlockNode;

/**
 * A block opened by its own leaf delimiter: `----`, `....` or `++++`.
 * Nothing re-modeled it and no fence produced it, so it carries none
 * of the three spelling records.
 */
interface LeafDelimitedBlockNode extends Node {
  /** Node discriminant. */
  type: "delimitedBlock";
  /** Which leaf delimiter opened it. */
  variant: LeafDelimiterVariant;
  /** Delimiters, as opposed to indentation or paragraph form. */
  form: "delimited";
  /** Verbatim block content, delimiter lines excluded. */
  content: string;
  /** Never: this block prints from its own variant's delimiter. */
  sourceDelimiter?: undefined;
  /** Never: a Markdown fence is {@link FencedCodeBlockNode}. */
  fenced?: undefined;
  /** Never: only a fence's opening line carries a language hint. */
  language?: undefined;
  /** The attribute line's interior, as the reader recorded it. */
  annotatedBy?: string;
}

/**
 * A block from a Markdown-style ``` fence. The fence implies the
 * `source` style even with no language hint — Asciidoctor renders it
 * as `<pre class="highlight">`, not a plain listing — so the printer
 * emits `[source]` (or `[source,lang]`) when normalizing to `----`.
 * This is the one spelling that carries a language hint, which is why
 * `language` lives here and nowhere else.
 */
interface FencedCodeBlockNode extends Node {
  /** Node discriminant. */
  type: "delimitedBlock";
  /** A fence always builds a listing. */
  variant: "listing";
  /** Delimiters, as opposed to indentation or paragraph form. */
  form: "delimited";
  /** Verbatim block content, fence lines excluded. */
  content: string;
  /** Never: a fence is not a masqueraded parent block. */
  sourceDelimiter?: undefined;
  /** Always set — it is what makes this member a fence. */
  fenced: true;
  /**
   * Source language hint from the opening line (e.g. "rust" from
   * `` ```rust ``), absent for a bare ` ``` `. The printer emits it
   * as `[source,lang]` during normalization.
   */
  language?: string;
  /** The attribute line's interior, as the reader recorded it. */
  annotatedBy?: string;
}

/**
 * A parent block a style re-modeled to verbatim content: `[source]`
 * on an open block (`--`), `[verse]` on a quote block (`____`), and
 * the rest of `VERBATIM_MASQUERADES` (lines/open-style.ts). The open
 * RECORDS the delimiter it re-modeled so the printer emits that
 * spelling back rather than the variant's own — which is why
 * `sourceDelimiter` is required here and absent everywhere else.
 * Invariant (xiii) in tests/parser/ast-invariants.ts is the runtime
 * witness that the parser never builds one of these without it.
 */
interface MasqueradedBlockNode extends Node {
  /** Node discriminant. */
  type: "delimitedBlock";
  /** The variant the style re-modeled the block to. */
  variant: VerbatimVariant;
  /** Delimiters, as opposed to indentation or paragraph form. */
  form: "delimited";
  /** Verbatim block content, delimiter lines excluded. */
  content: string;
  /** The parent delimiter the style re-modeled; the printer emits it. */
  sourceDelimiter: ParentBlockNode["variant"];
  /** Never: a Markdown fence is {@link FencedCodeBlockNode}. */
  fenced?: undefined;
  /** Never: only a fence's opening line carries a language hint. */
  language?: undefined;
  /** The attribute line's interior, as the reader recorded it. */
  annotatedBy?: string;
}

/**
 * The opaque passthrough of a `|===` `,===` `:===` `!===` block (the
 * issue #10 interim shape — full table MODELING is out of scope).
 * Unlike every other member THE DELIMITER LINES ARE CONTENT: the
 * reader slices from the opening line's start, and the printer
 * replays those lines adding no framing of its own.
 */
interface TableBlockNode extends Node {
  /** Node discriminant. */
  type: "delimitedBlock";
  /** The one variant whose delimiters live inside `content`. */
  variant: "table";
  /** Delimiters, as opposed to indentation or paragraph form. */
  form: "delimited";
  /** The block's source lines, DELIMITERS INCLUDED. */
  content: string;
  /** Never: a table is not a masqueraded parent block. */
  sourceDelimiter?: undefined;
  /** Never: a Markdown fence is {@link FencedCodeBlockNode}. */
  fenced?: undefined;
  /** Never: only a fence's opening line carries a language hint. */
  language?: undefined;
  /** The attribute line's interior, as the reader recorded it. */
  annotatedBy?: string;
}

/**
 * An indented literal paragraph: a run of indented lines, each
 * keeping its leading spaces. Indentation is the only spelling that
 * produces one, and it always produces a literal, so both facts are
 * the type's rather than a combination it happens to allow.
 */
interface IndentedLiteralBlockNode extends Node {
  /** Node discriminant. */
  type: "delimitedBlock";
  /** Indentation spells a literal and nothing else. */
  variant: "literal";
  /** Indentation, as opposed to delimiters or paragraph form. */
  form: "indented";
  /** The run's lines, joined with newlines, indentation kept. */
  content: string;
  /** Never: nothing re-modeled an indented run. */
  sourceDelimiter?: undefined;
  /** Never: a Markdown fence is {@link FencedCodeBlockNode}. */
  fenced?: undefined;
  /** Never: only a fence's opening line carries a language hint. */
  language?: undefined;
  /** The attribute line's interior, as the reader recorded it. */
  annotatedBy?: string;
}

/**
 * A paragraph a held style turned into a verbatim block: an attribute
 * list and the paragraph's own text, printed back verbatim with no
 * delimiters of its own. The sibling BlockAttributeListNode carries
 * the `[...]` spelling.
 */
interface ParagraphFormBlockNode extends Node {
  /** Node discriminant. */
  type: "delimitedBlock";
  /** The variant the held style named. */
  variant: VerbatimVariant;
  /** Paragraph form, as opposed to delimiters or indentation. */
  form: "paragraph";
  /** The paragraph's source text, sliced verbatim. */
  content: string;
  /** Never: a paragraph-form block has no delimiter to record. */
  sourceDelimiter?: undefined;
  /** Never: a Markdown fence is {@link FencedCodeBlockNode}. */
  fenced?: undefined;
  /** Never: only a fence's opening line carries a language hint. */
  language?: undefined;
  /** The attribute line's interior, as the reader recorded it. */
  annotatedBy?: string;
}

/** A parent block contains structured child blocks (parsed recursively). */
export interface ParentBlockNode extends Node {
  /** Node discriminant. */
  type: "parentBlock";
  /**
   * `"example"` (`====`), `"sidebar"` (`****`),
   * `"open"` (`--`), or `"quote"` (`____`).
   */
  variant: "example" | "sidebar" | "open" | "quote";
  /** Nested block elements parsed recursively. */
  children: BlockNode[];
}

/**
 * An admonition block (NOTE, TIP, IMPORTANT, CAUTION, WARNING —
 * custom variants allowed). One prose representation: the
 * paragraph form (`NOTE: text`) carries the SAME inline children a
 * paragraph does in `text`; the delimited form (`[NOTE]` on a parent
 * block) carries blocks in `children` and its wrapper delimiter in
 * `form`. Exactly one of the two bodies is non-empty — checked
 * structurally by invariant (ix) in tests/parser/ast-invariants.ts.
 * Behavior is Ruby's: an admonition paragraph's body IS a paragraph
 * (parser.rb:772-776, content_model :simple), pinned by the
 * admonition render-equality suites.
 */
export interface AdmonitionNode extends Node {
  /** Node discriminant. */
  type: "admonition";
  /** Admonition label, lowercase (`"note"`, `"tip"`, …; custom allowed). */
  variant: string;
  /**
   * How the admonition is spelled: `"paragraph"` for the `NOTE: text`
   * label form, or the parent-block delimiter variant that wraps a
   * delimited-form body (`"example"` for `[NOTE]` + `====`, `"open"`
   * for `[NOTE]` + `--`). One field: the spelling and the wrapper are
   * one fact.
   */
  form: "paragraph" | ParentBlockNode["variant"];
  /**
   * Paragraph-form body: the same inline children a paragraph has.
   * Empty when the body is delimited (see `children`) or absent
   * (`NOTE:` with no text).
   */
  text: InlineNode[];
  /** Delimited-form body blocks. Empty for the paragraph form. */
  children: BlockNode[];
}

/** A thematic break: `'''` (three or more single quotes). */
export interface ThematicBreakNode extends Node {
  /** Node discriminant. */
  type: "thematicBreak";
}

/**
 * A block macro like `image::target[attrlist]`. Block macros
 * appear on their own line and are preserved verbatim — the
 * formatter does not interpret their attributes or resolve
 * targets.
 */
export interface BlockMacroNode extends Node {
  /** Node discriminant. */
  type: "blockMacro";
  /** Macro name (e.g. `"image"`, `"video"`, `"toc"`). */
  name: string;
  /** Target between `::` and `[` (empty for `toc::[]`). */
  target: string;
  /** Raw attribute list content inside `[…]`. */
  attrlist: string;
}

/**
 * A preprocessor directive line (`include::`, `ifdef::`, `ifndef::`,
 * `ifeval::`, `endif::`) that sits BETWEEN blocks.
 *
 * Asciidoctor's `PreprocessorReader#process_line` (reader.rb:824)
 * matches the line and `shift`s it off the stream before
 * `Parser.next_block` is ever called, so a directive is not a block of
 * its own: it is a line the reader eats. The formatter cannot resolve
 * it (it has no attribute values and does not read included files), so
 * it keeps the line verbatim, in place, and treats it as transparent
 * for attachment — block metadata, a list continuation `+` and a
 * section's metadata all reach across it. Inside a paragraph the same
 * line is a {@link RawLineNode}.
 */
export interface PreprocessorDirectiveNode extends Node {
  /** Node discriminant. */
  type: "preprocessorDirective";
  /** The whole source line, verbatim. */
  value: string;
}

/** A page break: `<<<` (three or more less-than signs). */
export interface PageBreakNode extends Node {
  /** Node discriminant. */
  type: "pageBreak";
}

/**
 * The body every list-like item shares: principal inline text, then
 * blocks behind their recorded gaps. The document-order key contract
 * (`text` serialized before `blocks`) is owned by the BUILDER
 * literals — see buildListItem's "field order in the literal is
 * load-bearing" note (src/parse/build/list.ts); an interface's
 * declaration order determines nothing. A description-list item (#9)
 * will extend this shape too, which is why it is one home rather
 * than a set of members copied between two node kinds.
 *
 * Not exported: the shape is shared by EXTENSION, and every consumer
 * names the node it got — the printer's tail walk asks its questions
 * of a `ListItemNode`, because the gaps it reads are the ones an
 * item's own list decides.
 */
interface ItemBody {
  /** The principal text — inline nodes only. */
  text: InlineNode[];
  /**
   * Everything the item holds after its text, in source order: nested
   * lists and blocks alike, each behind the separator lines the
   * source wrote before it.
   */
  blocks: ItemBlock[];
  /**
   * The item's source ended on a `+` that attached nothing AND that
   * `+` must be PRINTED BACK.
   *
   * Ruby pops such a line (`buffer.pop if ListContinuationMarker ===
   * buffer[-1]`) and it renders nothing — WHEN Ruby's own read ended
   * where ours did. Where it did not, the line is content of the
   * block above it: an indented literal's slurp carries the `+` into
   * the `<pre>`, and a paragraph that swallowed a marker line carries
   * it into the prose. Dropping it there deletes a rendered
   * character, so the reader records the byte for exactly those tails
   * ({@link ListItemNode}'s builder decides which) and the printer
   * writes it back. `false` is the proven-inert case and the common
   * one: the byte does not come back.
   */
  trailingContinuation: boolean;
  /**
   * The item's source ended with a blank run and a DETACHED `+` — the
   * erased shield (`buffer[detached_continuation] =
   * ListContinuationPlaceholder`, parser.rb l.1576) — behind a
   * paragraph that is a frozen `+` kept as prose. The shield renders
   * nothing in place, but it is what absorbs the single tagged pop of
   * the re-read's cleanup (l.1580-82): without it the pop takes the
   * `+` paragraph instead and a rendered character disappears. So the
   * printer writes the tail back as one blank line and a `+`
   * (printListItem's detachedTail arm). Set only when the last block
   * IS such a `+` paragraph — behind any other block the erased tail
   * changes no re-read and is dropped as always.
   *
   * Mutually exclusive with `trailingContinuation` by construction:
   * the extent scan's strip loop reports one pop or the other, never
   * both (see ItemExtent.erasedTailContinuation,
   * src/parse/lines/list-reader.ts).
   */
  detachedTail: boolean;
  /**
   * The item PRINTS a tail whose continuation is still ARMED: a `+`
   * whose activation ran through block metadata only (a title, an
   * attribute line, an anchor, an attribute entry keep `:active`,
   * parser.rb l.1499-1501) and never met the block it was waiting for
   * — and whose byte still reaches the output, replayed in a trailing
   * metadata block's gap (armedTailPrints,
   * src/parse/lines/list-reader.ts). One blank line under such a tail
   * ATTACHES the next block to the item on re-read (the `:active`
   * arm, l.1483); only a second blank detaches it (the after-blank
   * break, l.1549). joinBlocks reads this to separate the list from
   * the block after it with two blank lines instead of one.
   */
  activeTail: boolean;
}

/**
 * A single item within a list.
 *
 * An item is its marker, its principal text, and then everything it
 * holds — nested lists and blocks alike — in source order, each behind
 * the verbatim separator lines the author wrote before it. Field order
 * in the SERIALIZED node is owned by the builder literal — see
 * buildListItem's "field order in the literal is load-bearing" note
 * (src/parse/build/list.ts); an interface's declaration order
 * determines nothing.
 */
export interface ListItemNode extends Node, ItemBody {
  /** Node discriminant. */
  type: "listItem";
  /**
   * This item's marker, exactly as the author wrote it. Recorded for
   * every item; replayed as the printed bytes for every variant but
   * one (see below).
   *
   * Per ITEM, not per list, because one ordered list's items may each
   * spell their marker differently: `5.`, `6.` and `2020.` all resolve
   * to the style `1.` and so belong to one list, but the oracle reads
   * the list's `start` off the FIRST item's spelling
   * (`resolveOrderedListStart`, `@asciidoctor/core` 4.0.11
   * `build/node/index.cjs` l.13396, called at l.12154) and warns on
   * the rest, so none of them is recoverable from the list's style.
   *
   * Where it sits relative to {@link ListNode.marker}, by variant:
   *
   * - unordered and IMPLICIT ordered (`*`, `-`, `.`, `..`): equal to
   *   the list's style, and replayed.
   * - EXPLICIT ordered (`5.`, `a.`, `i)`): differs from the style,
   *   and replayed - this field is the only record of the bytes.
   * - CALLOUT (`<1>`, `<.>`): equal to NEITHER. The list's style is
   *   the `<>` sentinel every callout shares, and `buildMarker`
   *   prints from {@link calloutNumber} instead, which is why `<01>`
   *   comes back as `<1>`. That normalization is render-neutral (a
   *   colist numbers its items by position, and the conum inside the
   *   verbatim block is untouched) and predates this field; the field
   *   is recorded uniformly so the classifier's parse has one shape,
   *   not because the callout path reads it.
   */
  markerSpelling: string;
  /**
   * Checkbox state for checklist items. `undefined` for normal items,
   * `"checked"` for `[x]` or `[*]`, `"unchecked"` for `[ ]`. Only
   * meaningful on unordered list items.
   */
  checkbox: "checked" | "unchecked" | undefined;
  /**
   * The callout number for callout list items (e.g. 1 for `<1>`).
   * `undefined` for non-callout items; 0 for auto-numbered (`<.>`).
   */
  calloutNumber: number | undefined;
}

/** One thing an item holds after its text, with how the source led into it. */
export interface ItemBlock {
  /**
   * The lines strictly between the previous piece of the item and this
   * block, verbatim: `""` for a blank line, `"+"` for a continuation
   * line. Shapes that occur: `[]` (directly under), `["+"]`,
   * `["", "+"]` (detached), `["", "+", "", "+"]` (stacked detached),
   * `[""]`, `["", ""]` (blanks before a nested marker or literal
   * paragraph), `["+", ""]`, `["+", "", "+"]`, `["+", "", ""]` (a `+`
   * that attached nothing, then a block the item keeps for another
   * reason). Invariant (checked by tests/parser/ast-invariants.ts):
   * nothing else is ever in a gap.
   */
  gap: readonly GapLine[];
  /** The block behind the gap — a nested list is a block like any other. */
  block: BlockNode;
}

/** One separator line inside a list item's gap. */
export type GapLine = "" | "+";

/**
 * A block attribute list: `[source,ruby]`, `[#myid]`, `[.role]`, etc.
 *
 * Block attribute lists appear on their own line immediately before a
 * block and set positional or named attributes on it. The ASG attaches
 * these to the block as metadata, but our AST keeps them as standalone
 * nodes and lets the printer handle stacking.
 *
 * The `value` field contains the raw content between the brackets
 * (e.g. `"source,ruby"` for `[source,ruby]`). We preserve the raw
 * text so the printer can reproduce the original syntax faithfully.
 */
export interface BlockAttributeListNode extends Node {
  /** Node discriminant. */
  type: "blockAttributeList";
  /**
   * Raw text between the brackets, e.g. `"source,ruby"`
   * for `[source,ruby]`. Preserved verbatim for the
   * printer to reproduce faithfully.
   */
  value: string;
}

/**
 * A block title: `.Title text`.
 *
 * Block titles appear on their own line immediately before a block
 * and set the block's title. The leading dot is syntactic (not stored
 * in `title`). The `title` field contains the text after the dot.
 */
export interface BlockTitleNode extends Node {
  /** Node discriminant. */
  type: "blockTitle";
  /** Title text after the leading `.` (dot not stored). */
  title: string;
}

/**
 * A block anchor: `[[id]]` or `[[id,reftext]]` alone on a line,
 * metadata for the block that follows.
 */
export interface BlockAnchorNode extends Node {
  /** Node discriminant. */
  type: "blockAnchor";
  /** The anchor id. */
  id: string;
  /** The optional reference text after the comma. */
  reftext: string | undefined;
}

/** A top-level structural element of a document. */
export type BlockNode =
  | ParagraphNode
  | DocumentHeaderNode
  | HeadingNode
  | DiscreteHeadingNode
  | CommentNode
  | AttributeEntryNode
  | ListNode
  | DelimitedBlockNode
  | ParentBlockNode
  | AdmonitionNode
  | ThematicBreakNode
  | PageBreakNode
  | BlockMacroNode
  | PreprocessorDirectiveNode
  | BlockAttributeListNode
  | BlockTitleNode
  | BlockAnchorNode;
