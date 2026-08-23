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
 * Inline link via bare URL: `https://example.com` or
 * `https://example.com[text]`. Kept separate from
 * InlineMacroNode because it has different syntax
 * (no `name:` prefix) and needs form tracking for
 * round-trip fidelity.
 */
export interface LinkNode extends Node {
  /** Node discriminant. */
  type: "link";
  /** Always `"url"` — macro-form links use InlineMacroNode. */
  form: "url";
  /** The link destination URL. */
  target: string;
  /**
   * Display text from the attribute list (e.g. the
   * `text` in `https://example.com[text]`). Undefined
   * when no display text was provided.
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
 * Inline anchor: `[[id]]` or `[[id, reftext]]`. Sets an
 * anchor point within paragraph text. The two-argument form
 * provides default cross-reference display text.
 */
export interface InlineAnchorNode extends Node {
  /** Node discriminant. */
  type: "inlineAnchor";
  /** Anchor identifier (the first argument). */
  id: string;
  /**
   * Default cross-reference text from the two-argument
   * form `[[id, reftext]]`. Undefined for single-argument
   * anchors.
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

/** Content that appears within a paragraph (text, emphasis, links, etc.). */
export type InlineNode =
  | TextNode
  | BoldNode
  | ItalicNode
  | MonospaceNode
  | HighlightNode
  | AttributeReferenceNode
  | InlineMacroNode
  | LinkNode
  | XrefNode
  | InlineAnchorNode
  | RawLineNode
  | HardLineBreakNode;

/**
 * A heading line: `=` (level 0, the document title spelling) through
 * `======` (level 5). A LEAF — sections are not modeled: nothing the
 * printer emits consumes containment (the D10 audit), and the level
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
 * A discrete heading — a heading preceded by `[discrete]` that does
 * not create a section. Unlike an ordinary `heading`, it is STYLE,
 * not structure: the oracle renders it as a heading element but it
 * opens no section, so `[discrete]` is outside the D10 flatten
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
 * - `:!name:` or `:name!:` — unset (negation)
 */
export interface AttributeEntryNode extends Node {
  /** Node discriminant. */
  type: "attributeEntry";
  /** Clean attribute name without `!` prefix/suffix. */
  name: string;
  /** Value text, or undefined for no-value entries like `:toc:`. */
  value: string | undefined;
  /**
   * Whether this entry unsets the attribute and which syntax form
   * was used. `false` means the attribute is set (not negated).
   * `"prefix"` means `:!name:` form; `"suffix"` means `:name!:`.
   * Tracking the form lets the printer reproduce the original syntax.
   */
  unset: false | "prefix" | "suffix";
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
  /** Items in this list, in document order. */
  children: ListItemNode[];
}

/**
 * A delimited leaf block whose content is preserved verbatim
 * (no inline parsing). Covers listing (`----`), literal (`....`),
 * passthrough (`++++`), and verse blocks.
 *
 * **Valid variant+form combinations:**
 * - `listing | literal | pass` with `form: "delimited"` — fenced
 * - `literal` with `form: "indented"` — literal paragraph
 * - `verse` with `form: "delimited"` — masqueraded from quote
 * - any variant with `form: "paragraph"` — attribute + paragraph
 *
 * Parent-block variants (`example | sidebar | quote`) use
 * `ParentBlockNode` when delimited, not this type — unless
 * masqueraded to verbatim via a style attribute.
 */
export interface DelimitedBlockNode extends Node {
  /** Node discriminant. */
  type: "delimitedBlock";
  /**
   * Block kind: `"listing"` (`----`), `"literal"` (`....`),
   * `"pass"` (`++++`), `"verse"`, or a masqueraded parent
   * block variant (`"example"`, `"sidebar"`, `"quote"`).
   *
   * `"table"` is the opaque passthrough of `|===` `,===` `:===`
   * `!===` blocks (spec D1): unlike every other variant the delimiter
   * lines are part of `content`, and the printer replays the lines
   * adding no framing of its own.
   */
  variant:
    | "listing"
    | "literal"
    | "pass"
    | "example"
    | "sidebar"
    | "quote"
    | "verse"
    | "table";
  /**
   * How the block was expressed in source: delimiters,
   * indentation, or paragraph form (attribute list + text).
   */
  form: "delimited" | "indented" | "paragraph";
  /** Verbatim block content (no inline parsing). */
  content: string;
  /**
   * The bracket interior of the block-attribute line released
   * DIRECTLY above this block — recorded at open iff the attribute
   * line is the LAST node of the pending run: a title, comment or
   * directive held after the attribute line leaves it undefined.
   * Undefined when nothing annotated the block. The sibling
   * BlockAttributeListNode still carries the spelling for printing;
   * this field is the reader's own record, so no consumer re-pairs
   * siblings to learn it (spec D5a; pinned by invariant (xi)).
   */
  annotatedBy?: string;
  /**
   * Source language hint from a Markdown-style fenced code
   * block (e.g. "rust" from `` ```rust ``). Valid only when
   * `fenced` is true: the fence is the only syntax carrying a
   * language hint, so the parser sets the two together. The
   * printer uses this to emit a `[source,lang]` attribute list
   * during normalization.
   */
  language?: string;
  /**
   * Original parent block delimiter variant when this block
   * was created by masquerading. For example, `[source]` on
   * an open block (`--`) produces a listing variant with
   * `sourceDelimiter: "open"` so the printer emits `--`
   * delimiters instead of `----`. Undefined for blocks that
   * were not masqueraded.
   */
  sourceDelimiter?: ParentBlockNode["variant"];
  /**
   * True when the block came from a Markdown-style ``` fence. Fences
   * imply the `source` style even without a language, so the printer
   * must emit `[source]` (or `[source,lang]`) when normalizing to
   * `----` — otherwise Asciidoctor renders it as a plain listing.
   */
  fenced?: true;
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
 * custom variants allowed). One prose representation (spec D7): the
 * paragraph form (`NOTE: text`) carries the SAME inline children a
 * paragraph does in `text`; the delimited form (`[NOTE]` on a parent
 * block) carries blocks in `children` and its wrapper delimiter in
 * `form`. Exactly one of the two bodies is non-empty — checked
 * structurally by invariant (ix) in tests/parser/ast-invariants.ts.
 * Behavior is Ruby's: an admonition paragraph's body IS a paragraph
 * (parser.rb:765-769, content_model :simple), pinned by the
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
 * Asciidoctor's `PreprocessorReader#process_line` (reader.rb:819)
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
 * A single item within a list.
 *
 * An item is its marker, its principal text, and then everything it
 * holds — nested lists and blocks alike — in source order, each behind
 * the verbatim separator lines the author wrote before it. The
 * printer replays those separators byte for byte, which is what makes
 * list formatting idempotent by construction.
 */
export interface ListItemNode extends Node {
  /** Node discriminant. */
  type: "listItem";
  /**
   * Marker nesting depth: number of `*` or `.` characters in the
   * original marker. The printer uses this to reproduce the level.
   */
  depth: number;
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
  /**
   * The principal text — inline nodes only. (Was `children`, which
   * also interleaved nested lists; the better name is worth the
   * mechanical churn — owner, spec D1.)
   */
  text: InlineNode[];
  /**
   * Everything the item holds after its text, in source order: nested
   * lists and blocks alike, each behind the separator lines the
   * source wrote before it.
   */
  blocks: ItemBlock[];
  /**
   * The item's last non-blank line is a `+` that attached nothing —
   * the line Ruby pops (`buffer.pop if last_line ==
   * LIST_CONTINUATION`, parser.rb l.1571). `true` only when that `+`
   * is a FIXED POINT of reprint (Ruling 68): printing it back must
   * re-read as the same trailing, unerased `+`. An unerased `+` run
   * whose spelling has no fixed point (e.g. the author's doubled `+`,
   * which would reprint as one and then re-read as zero) is reported
   * `false` and the extra byte(s) collapse; an ERASED `+` (one a blank
   * run killed) or a `+` left detached at EOF is also `false` and
   * drops. All three cases are render-equal to the source and
   * idempotent under reprint, which is the property this field
   * guarantees rather than verbatim preservation of every `+` byte the
   * author typed.
   */
  trailingContinuation: boolean;
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
