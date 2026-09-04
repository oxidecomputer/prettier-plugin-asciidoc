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
  /**
   * The paragraph's FIRST SOURCE LINE ends after its first word: from
   * where the block starts, that line holds one run of non-whitespace
   * and nothing else (`isSingleWordLine`, src/parse/line-shapes.ts,
   * carries the whitespace dialect and the `$` anchor's warrant).
   *
   * The printer's block-start hazard net
   * (src/print/block-start-hazard.ts) is the one consumer, and this is
   * the whole question it asks of the source. Reflow packs the block's
   * words into lines, and a line it packs is read back by the same
   * classifier that read the source, where `*`, `.`, `NOTE:`, `##` and
   * their kin at column 0 are BLOCK syntax: `**` then `*b* c` packed
   * to `** *b* c` is a nested list item the author never wrote. The
   * net's answer is to keep the SOURCE's break instead of the space,
   * and it may only do that where the author wrote one - which is
   * exactly this fact. Why one word is the condition is the net's own
   * argument, stated once at `keepBlockStartBreak`
   * (src/print/block-start-hazard.ts): a marker alone on a line is no
   * marker. Where the fact is FALSE the trade would invent a line: a
   * paragraph the source spells `## b## c` on one line stays on one
   * line, because the oracle reads a heading there (issue #63) that a
   * break would destroy.
   *
   * The ANSWER travels, not the line, for the reason
   * {@link ListItemNode.everyTextLineIndented} states: the reader
   * holds the source and the printer asks one yes/no of it. A second
   * question about this line gets a second recorded fact from the
   * reader, never a re-derivation from this boolean or from the
   * inline fragments the line was split into.
   */
  firstWordEndsItsLine: boolean;
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
  /**
   * Role/style attribute from the preceding `[role]` syntax.
   * Undefined when no role is specified.
   */
  role: string | undefined;
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
  /**
   * Role/style attribute from the preceding `[role]` syntax.
   * Undefined when no role is specified.
   */
  role: string | undefined;
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
  /**
   * Role/style attribute from the preceding `[role]` syntax.
   * Undefined when no role is specified.
   */
  role: string | undefined;
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
 * `RoleAttribute` rule fires only in front of the four MARK
 * delimiters, so a role before a curved pair reaches the printer as
 * text (a known gap, kept out of scope for issue #74).
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
 * A superscript span, `^text^` - `QUOTE_SUBS` row 11
 * (asciidoctor.rb l.465-466), which renders `<sup>text</sup>`.
 *
 * No `constrained` field: the row is UNCONSTRAINED and has one
 * spelling, so there is nothing for the printer to choose and no state
 * to refuse at runtime. No `role` field either, for the same reason
 * {@link CurvedQuoteNode} has none: the row carries the optional
 * attrlist group every quote row has, but the tokenizer's
 * `RoleAttribute` rule fires only in front of the four MARK
 * delimiters, so `[red]^a^` reaches the printer as text plus a
 * superscript and prints back byte for byte.
 *
 * Its content can never hold whitespace - `(\S+?)` refuses even a
 * newline - which is what makes the span one unbreakable atom under
 * reflow with no rule anywhere saying so.
 *
 * Serialized key order: `type, children, position`.
 */
export interface SuperscriptNode extends Node {
  /** Node discriminant. */
  type: "superscript";
  /** Inline content between the two carets. */
  children: InlineNode[];
}

/**
 * A subscript span, `~text~` - `QUOTE_SUBS` row 12
 * (asciidoctor.rb l.467-468), which renders `<sub>text</sub>`. The
 * superscript row's twin in every respect {@link SuperscriptNode}
 * describes.
 *
 * Serialized key order: `type, children, position`.
 */
export interface SubscriptNode extends Node {
  /** Node discriminant. */
  type: "subscript";
  /** Inline content between the two tildes. */
  children: InlineNode[];
}

/**
 * A character reference: one match of Asciidoctor's `REPLACEMENTS`
 * table (asciidoctor.rb l.489-516) - `(C)`, `(R)`, `(TM)`, either
 * em-dash spelling, the ellipsis, one of the four arrows, or a named
 * or numeric entity such as `&copy;`.
 *
 * The node carries the AUTHOR'S bytes and not the character they
 * render as. Resolving `(C)` to the copyright sign is the oracle's job
 * at conversion time; a formatter that rewrote the bytes would be
 * editing the document, and the two spellings are not interchangeable
 * everywhere - inside a passthrough the same three characters render
 * literally.
 *
 * A reference holds no whitespace, so it is one atom under reflow and
 * the packer can never break it open. Two of the table's thirteen rows
 * are deliberately not read as references - the right single quote and
 * the in-word apostrophe - for the reason
 * `src/parse/inline/replacements.ts` gives.
 *
 * Serialized key order: `type, value, position`.
 */
export interface CharacterReferenceNode extends Node {
  /** Node discriminant. */
  type: "characterReference";
  /** The reference's own source bytes, verbatim. */
  value: string;
}

/**
 * An escaped formatting mark: `\*`, `\_`, `` \` `` or `\#`.
 *
 * The backslash is Asciidoctor's escape for a `QUOTE_SUBS` row that
 * WOULD otherwise resolve a span here, and nothing at all where no row
 * would. Each of the six UNCONSTRAINED rows opens with a bare optional
 * `\\?` - a literal outside every group, capturing nothing
 * (asciidoctor.rb l.446-468); the CONSTRAINED rows have no such
 * literal and take the backslash through their left boundary class
 * instead (`(^|[^#{CC_WORD};:}])`, asciidoctor.rb l.448), which admits
 * it because a backslash is no word character. Where a row does match,
 * `convert_quoted_text` sees a match beginning with the backslash and
 * writes the matched text back with the backslash removed and no span
 * built (substitutors.rb l.1419-1425), so `x \*a* y` renders
 * `x *a* y`. Where NO row matches - `a\*b`, whose marks stand
 * mid-word where no boundary clause admits them - the oracle consumes
 * neither byte and `a\*b` renders as itself, backslash included. This
 * node names the PAIR either way; which of the two readings applies is
 * a fact about the rest of the line, not about the two characters.
 *
 * The four marks and not six: `\^` and `\~` open the last two
 * unconstrained rows (asciidoctor.rb l.466, l.468) and get no node,
 * because the tokenizer has no rule for them - they melt into a text
 * run, which prints the same bytes and renders correctly
 * (measured: `x \^a^ y` and `x \~a~ y` round-trip render-equal).
 * They are the gap this vocabulary leaves, named here so the next
 * reader does not have to rediscover it.
 *
 * A LEAF holding its own two bytes, for the reason every verbatim
 * leaf here holds its own: those bytes decide what the marks around
 * them mean. Left inside a text run they were indistinguishable from
 * a mark the author simply wrote, so the printer could not tell the
 * escape from what it escapes, and any rule that reasons about
 * pairing near one had nothing in the tree to read. The node holds no
 * whitespace, so it is one atom under reflow and can never be broken
 * open between its backslash and its mark.
 *
 * WHAT THIS NODE DOES NOT MODEL. An escaped UNCONSTRAINED match is
 * re-read by the CONSTRAINED row that runs next, over the text the
 * escape's own removal produced: `\**a**` renders
 * `<strong>*a</strong>*`, a real strong span whose content is `*a`,
 * not the literal run the spelling suggests. Resolving that means
 * reading a row's own output, which is outside this parser's
 * one-coordinate-space model (`src/parse/inline/doubled-marks.ts`
 * says why), so the marks behind the escape stay the literal text
 * they are here. The bytes are the author's either way, and the pins
 * in tests/format/escaped-mark.test.ts hold the whole family
 * render-equal; what is missing is a span node, not a rendering.
 *
 * Serialized key order: `type, value, position`.
 */
export interface EscapedMarkNode extends Node {
  /** Node discriminant. */
  type: "escapedMark";
  /** The backslash and the mark it escapes, verbatim. */
  value: string;
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
   * The attribute list's interior (e.g. the `text` in
   * `https://example.com[text]`). Three states, and the printer
   * writes a different spelling for each: undefined when the author
   * wrote no bracket group at all, which an address always is (it has
   * no bracket syntax to carry one); the empty string for
   * `https://example.com[]`, whose brackets carry no display text but
   * are what END the target; and the interior itself otherwise.
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
 * An inline passthrough: `+text+`, `++text++`, `+++text+++` or
 * `$$text$$`, with the optional `[attrlist]` in front when the author
 * wrote one.
 *
 * A LEAF holding its own bytes, deliberately: Asciidoctor extracts
 * passthroughs before it substitutes anything else
 * (`extract_passthroughs`, substitutors.rb l.1018), so the marks,
 * macros and attribute references between the delimiters are text to
 * the oracle. Modelling the interior as children would hand the
 * printer marks it would try to pair, respell and reflow around —
 * which is how `+*not bold*+` came out as `+*not bold*{plus}`, with
 * both the emphasis and the closing delimiter changed. The `$$`
 * spelling was the same hazard one delimiter later: read as prose, a
 * run of interior spaces collapsed and a wrap could land a line break
 * between two words the oracle never separates.
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
  | SuperscriptNode
  | SubscriptNode
  | CharacterReferenceNode
  | EscapedMarkNode
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
  /**
   * Value text, or undefined for no-value entries like `:toc:`. A
   * value the author CONTINUED onto the lines below carries those
   * lines here too, separated by newlines and spelled as they were
   * written (src/parse/lines/attribute-entry.ts).
   */
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
 * The three facts an attribute entry carries besides its position -
 * ONE spelling, because three layers hold the same value and a
 * second declaration is where they would drift: the classifier
 * parses them out of the line (`parseAttributeEntry`,
 * src/parse/lines/classify.ts), the entry's extent read may replace
 * the value with the source spelling of every line it runs onto
 * (src/parse/lines/attribute-entry.ts), and the builder takes them
 * as they stand (`buildAttributeEntry`, src/parse/build/metadata.ts).
 */
export type AttributeEntryFields = Readonly<
  Pick<AttributeEntryNode, "name" | "value" | "unset">
>;

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
 * The block kinds a verbatim delimited block carries: the three that
 * own a leaf delimiter, plus the parent-block variants a style can
 * re-model into verbatim content. A table is not among them: its
 * delimiter lines are CONTENT, which {@link TableNode} models below
 * rather than a value this set could hold, and the style tables in
 * lines/open-style.ts that name a target variant therefore cannot
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
 * builder writes it LAST in the node literal, so it trails every
 * other key on the wire - where the reader's old post-construction
 * stamp used to leave it. Absent, never present and undefined, when
 * nothing annotated the block.
 */
export type DelimitedBlockNode =
  | LeafDelimitedBlockNode
  | FencedCodeBlockNode
  | MasqueradedBlockNode
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
 * The YAML FRONT MATTER a static site generator writes above the
 * document: a `---` line at the very top, everything down to the next
 * `---` line, and that closing line.
 *
 * Kept VERBATIM, fences included, and the reason is that Asciidoctor
 * reads it two ways. With `skip-front-matter` set, its reader lifts
 * the whole block off the stream before parsing begins
 * (`skip_front_matter!`, reader.rb l.1304-22) and the document starts
 * under it. WITHOUT the attribute - the default - nothing is lifted:
 * `---` renders as a thematic break and the metadata under it is a
 * paragraph that swallows the closing fence. Only the author's own
 * bytes satisfy both readings at once, so this node carries the lines
 * and the printer writes them back. It is also what the block IS to
 * the generator that reads it: YAML, where a re-wrapped line is a
 * different document.
 *
 * The block exists only at offset 0 and only when a closing fence is
 * found (`skip_front_matter!` puts the lines back when it reaches the
 * end of input first), so nothing decides it from a line's shape
 * alone - see src/parse/lines/front-matter.ts.
 */
export interface FrontMatterNode extends Node {
  /** Node discriminant. */
  type: "frontMatter";
  /** The block's source lines, fences included, joined with newlines. */
  content: string;
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
   * the post-loop's tail walk reports one pop or the other, never both
   * (see ItemExtent.erasedTailContinuation,
   * src/parse/lines/item-tail.ts).
   */
  detachedTail: boolean;
  /**
   * The item PRINTS a tail whose continuation is still ARMED: a `+`
   * whose activation ran through block metadata only (a title, an
   * attribute line, an anchor, an attribute entry keep `:active`,
   * parser.rb l.1499-1501) and never met the block it was waiting for
   * — and whose byte still reaches the output, replayed in a trailing
   * metadata block's gap. The item scan folds both halves as it reads
   * (the armed-tail state, src/parse/lines/item-tail.ts). One blank
   * line under such a tail
   * ATTACHES the next block to the item on re-read (the `:active`
   * arm, l.1483); only a second blank detaches it (the after-blank
   * break, l.1549). joinBlocks reads this to separate the list from
   * the block after it with two blank lines instead of one.
   */
  activeTail: boolean;
  /**
   * Every source line the item's text wrote UNDER the marker line
   * stands at an indent - the all-or-nothing condition
   * `adjust_indentation!` tests before it strips a block. The walk
   * takes the least indented line (parser.rb l.2723-31), and one line
   * at indent 0 sets `block_indent = nil` and cancels the strip for
   * the whole block (l.2727-29), which leaves the space that makes a
   * ` +` line under such text a hard break rather than a literal plus.
   *
   * Two line kinds do not count against it, neither of them in the
   * block the walk sees: a blank line, which the walk itself skips
   * (`next if line.empty?`, l.2726), and a `//` line, which
   * `read_paragraph_lines` drops before the strip runs
   * (`skip_line_comments: text_only`, l.754). The marker line is
   * outside the question too: `fold_first` prepends the item's text
   * to the block AFTER the strip has run (l.755 and l.1384).
   *
   * The ANSWER travels, not the lines. The scan that reads the item
   * holds its buffer with every line's raw spelling intact
   * (src/parse/lines/list-reader.ts), and the one consumer - the
   * printer's reflow guard (src/print/list-hazard.ts) - asks exactly
   * this yes/no of those lines, so the yes/no is what is recorded.
   * Carrying the lines themselves would copy a slice of the source
   * onto every item and leave the next question about them to be
   * answered by re-deriving. A second question about these lines
   * gets a second recorded fact from the scan, never a re-derivation
   * from this boolean or from the inline fragments.
   */
  everyTextLineIndented: boolean;
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

/**
 * Table structure (issue #10). These four types are the modeled
 * table: `table`, `tableRow`, `tableCell`, and the auxiliary shapes
 * a cell's opening and spec carry. {@link TableNode} is a
 * {@link BlockNode} member and NOT a `DelimitedBlockNode` one: a
 * `|===` block resolves to it, and no delimited-block variant may
 * spell a table, because a table's delimiter lines are its own
 * fields rather than a slice of content. Rows and cells are interior
 * nodes: nothing outside a table holds one.
 *
 * Shapes here mirror the table SCAN's own types
 * (`src/parse/lines/table-reader.ts`, `src/parse/lines/table-cell-spec.ts`)
 * field for field, including which fields carry `readonly`: those two
 * modules are the parse-side source of truth this file cannot import
 * (the AST layer is a leaf; every parser module imports FROM it), so
 * the shapes are transcribed rather than re-exported.
 */

/**
 * A table. Unlike every other delimited construct this is a node of
 * its own rather than a `DelimitedBlockNode` member: a table's
 * interior is neither one verbatim slice nor a sequence of blocks,
 * and its delimiter lines frame recorded structure rather than
 * bracketing content.
 *
 * The node's records PARTITION its extent. Concatenating, in
 * document order, `open`, `leadingRuns`, every span held by every
 * cell of every row, and the closing line reproduces the source
 * between `position.start` and `position.end` exactly (a dropped `//`
 * or blank line is a run like any other, never actually dropped).
 * That is what makes a byte-replaying printer possible and what a
 * later normalization gives up one span class at a time.
 */
export interface TableNode extends Node {
  /** Node discriminant. */
  type: "table";
  /**
   * The opening delimiter line as written (`|===`, `,====`, `!===`),
   * newline excluded. Trailing whitespace is kept: like every other
   * delimited block's opening Fragment, this is the raw span, and the
   * partition rule needs the literal bytes to replay.
   */
  open: string;
  /** How the extent ended. */
  close: TableClose;
  /**
   * How cells are cut, resolved once at the opening line from the
   * delimiter's hint character and the held attribute line
   * (parser.rb:874-877, table.rb:459-486).
   */
  cutting: TableCutting;
  /**
   * The `cols=` parse, in declaration order after `N*` repeats are
   * expanded (parser.rb:2436-2482); absent when the block carried no
   * readable `cols` value. Column WIDTHS in percent are not modeled:
   * they change no source byte (table.rb:121-152).
   */
  columns?: readonly TableColumnSpec[];
  /**
   * Whether the first row is a header. Asciidoctor decides this with
   * a mutable assumption it cancels from three places
   * (parser.rb:2303-2310, :2328-2335, :2338-2348, :2395); this is a
   * total predicate over facts the reader already recorded (see
   * `readHeaderDecision`, src/parse/lines/table-reader.ts). Recorded
   * on the node because it is what makes the blank line after the
   * first row structure-bearing for any later normalizer.
   */
  header: "explicit" | "implicit" | "none";
  /** Whether `options=footer` made the last row a footer. */
  footer: boolean;
  /**
   * Runs before the first cell begins: the blank lines and comment
   * lines a reader consumes ahead of the first separator
   * (`skip_blank_lines`, reader.rb:279-291, reached from
   * parser.rb:2303). Empty for a table that opens with content.
   */
  leadingRuns: readonly TableTextRun[];
  /** The table's rows, in document order. */
  children: TableRowNode[];
  /** The attribute line's interior, as the reader recorded it. */
  annotatedBy?: string;
}

/**
 * How a table's extent ended: at its terminator, or at the end of the
 * stream the reader could see (parser.rb:872, reader.rb:433-437).
 * A union rather than an optional string so that "closed with no
 * closing line" is unrepresentable.
 */
export type TableClose =
  | {
      /** Close discriminant: the terminator line was met. */
      readonly kind: "delimiter";
      /**
       * The closing line as written, newline excluded, trailing
       * whitespace kept (see {@link TableNode.open}).
       */
      readonly image: string;
    }
  | {
      /** Close discriminant: the extent ran to the end of its stream. */
      readonly kind: "endOfStream";
    };

/**
 * Where a table's cells are cut. `tsv` is absent by construction: the
 * `FORMATS` table Asciidoctor checks the value against normalizes it
 * to csv with a tab separator at open (table.rb:461-463), so the pair
 * here is always the pair that actually cuts. The author's
 * `format=tsv` spelling survives on the sibling block attribute list
 * node.
 */
export interface TableCutting {
  /** Which cell rules apply: cell specs and `\|` escaping (psv), quotes (csv), `\:` escaping (dsv). */
  readonly format: "psv" | "csv" | "dsv";
  /**
   * The string that cuts a cell. `|` for a top-level psv table
   * whatever its hint character, because `!sv` is selected by a nested
   * document and never by the delimiter; the `xsv` key that choice
   * sets is what indexes `DELIMITERS` into `@delimiter` and
   * `delimiter_rx` (table.rb:466-474).
   */
  readonly separator: string;
}

/** One `cols=` record, after `N*` expansion (parser.rb:2452-2481). */
export interface TableColumnSpec {
  /** `<`, `^`, `>` as `left`, `center`, `right`; absent when the record set none. */
  readonly halign?: TableHorizontalAlignment;
  /** `.<`, `.^`, `.>` as `top`, `middle`, `bottom`; absent when the record set none. */
  readonly valign?: TableVerticalAlignment;
  /** The one style letter's meaning, absent when the record named none or named an unmapped letter. */
  readonly style?: TableCellStyle;
}

/**
 * `TableCellHorzAlignments` (parser.rb:53-59). Read structurally
 * through `TableColumnSpec`/`TableCellSpec`, never named by import.
 * Exported for tests/parser/table-structure.test.ts; a future
 * consumer that reads an alignment BY NAME (a printer, a normalizer)
 * is the real `src` consumer once it lands.
 * @internal
 */
export type TableHorizontalAlignment = "left" | "center" | "right";

/**
 * `TableCellVertAlignments` (parser.rb:61-67). Read structurally
 * through `TableColumnSpec`/`TableCellSpec`, never named by import.
 * Exported for tests/parser/table-structure.test.ts; a future
 * consumer that reads an alignment BY NAME (a printer, a normalizer)
 * is the real `src` consumer once it lands.
 * @internal
 */
export type TableVerticalAlignment = "top" | "middle" | "bottom";

/**
 * `TableCellStyles` (parser.rb:69-77). Read structurally through
 * `TableColumnSpec`/`TableCellSpec`, never named by import. Exported
 * for tests/parser/table-structure.test.ts; a future consumer that
 * reads a style BY NAME (a printer, a normalizer) is the real `src`
 * consumer once it lands.
 * @internal
 */
export type TableCellStyle =
  | "none"
  | "strong"
  | "emphasis"
  | "monospaced"
  | "header"
  | "literal"
  | "asciidoc";

/**
 * One row: the cells Asciidoctor's column arithmetic groups together
 * (table.rb:668-676 through :731). The grouping is a RECORDED
 * derivation, made where the scan decides it, and a byte-replaying
 * printer does not need to read it: a row prints as its cells' spans,
 * so a grouping error can mislabel structure and cannot move a byte.
 *
 * A row's span runs from its first cell's start to its last cell's
 * end, so rows are contiguous, non-overlapping and in document order.
 */
export interface TableRowNode extends Node {
  /** Node discriminant. */
  type: "tableRow";
  /** The row's cells, in document order. */
  children: TableCellNode[];
}

/**
 * One cell. Its CONTENT is bytes: the runs below are
 * replayed, never re-read. What is parsed is where the cell begins
 * (its spec and separator) and where its text stops (the next cell's
 * opening, the closing delimiter, or the end of the stream).
 */
export interface TableCellNode extends Node {
  /** Node discriminant. */
  type: "tableCell";
  /** How this cell was opened. */
  opening: TableCellOpening;
  /**
   * The cell's raw text, as a partition of the source between the
   * opening and the next cell: `content` runs are the cell's text,
   * `droppedComment` runs are the `//` lines a reader deletes before
   * the table is parsed (reader.rb:424), and `skippedBlank` runs are
   * blank lines no cell was open to take (reader.rb:279-291).
   * Concatenating every run's `image` reproduces the region;
   * concatenating the `content` runs alone reproduces Asciidoctor's
   * cell buffer BEFORE its own per-line rstrip and escape chop
   * (table.rb:525-528); those two transforms are applied when a
   * cell's text is read, never stored beside the bytes.
   */
  runs: readonly TableTextRun[];
  /**
   * The repeat Asciidoctor's cell-spec QUEUE hands this cell, which is
   * what row grouping counted. Usually the repeat of the cell's own
   * opening spec (`opening.parsed.repeat` for a `separator` opening);
   * in a table whose first line is missing its leading separator the
   * queue runs one behind for the whole table (`take_cellspec` shifts,
   * table.rb:554-556, what `push_cellspec` put there one separator
   * later, table.rb:562-565), so each cell takes the NEXT opening's
   * repeat and the last cell takes none. A sibling of `opening` rather
   * than a field inside it, because it is a fact about the QUEUE, not
   * about how this cell's own text was spelled.
   */
  repeat: TableCellRepeat;
  /**
   * The column this cell inherits its style from, as a zero-based
   * index into {@link TableNode.columns}: the cell's PHYSICAL
   * position in its row after duplicate expansion, which is Ruby's
   * own `@table.columns[@current_row.size]` (table.rb:662). A
   * DUPLICATE spec (`3*|x`) is one node here standing for several of
   * Ruby's cells, so it advances the index by its count; a COLSPAN is
   * one `Table::Cell` however many columns it visits (table.rb:665),
   * so it advances the index by one while advancing `@column_visits`
   * by its colspan (:670).
   *
   * Recorded and not derived. A cell's effective style is its own
   * spec's style, or the style of the column at this index, so a
   * consumer that re-derived the index would be a second source of
   * truth beside the grouping that already counted the same cells.
   *
   * One gap a reader of the index inherits: a HEADER row's cells take
   * no column style at all. `Table::Cell#initialize` reaches
   * `cell_style = column.style` only on the arm a non-header row
   * takes, and an implicit header row that had one nulls it again
   * (table.rb:241-247), so no header-row cell is literal even under
   * `[cols="1l"]`. The index itself says nothing about that: it is
   * the plain physical position on a header row as everywhere else,
   * and {@link TableNode.header} is what names the row. A consumer
   * that only ever DECLINES to move whitespace may read a header-row
   * cell as literal and be conservative; one that read it as
   * non-literal would not be.
   */
  columnIndex: number;
}

/**
 * How a cell began. A psv cell opens at a separator, optionally
 * behind a spec; `recovered` is Asciidoctor's "table missing leading
 * separator" repair, where the text before the first separator of the
 * first line becomes a cell (table.rb:621-627); a csv or dsv cell that
 * starts a line opens at `lineStart`, since those formats close every
 * cell at end of line (parser.rb:2401-2406).
 */
export type TableCellOpening =
  | {
      /** Opening discriminant: a separator, with the spec in front of it. */
      readonly kind: "separator";
      /**
       * The spec text as written, INCLUDING the leading or trailing
       * whitespace `CellSpecStartRx` and `CellSpecEndRx` take with it
       * (rx.rb:399-400). `""` for a bare `|`; the empty string is the
       * ordinary case, not an absence.
       */
      readonly spec: string;
      /** The spec's parse; every field absent for `spec === ""`. */
      readonly parsed: TableCellSpec;
      /**
       * The separator as CONSUMED, which is `cutting.separator`
       * everywhere but at a line start, where Asciidoctor cuts one
       * character off a line it matched the whole separator against
       * (parser.rb:2319-2320, table.rb:502-504).
       */
      readonly separator: string;
      /** Zero-based offset of the spec's first character. */
      readonly offset: number;
    }
  | {
      /** Opening discriminant: an opening that writes no bytes of its own. */
      readonly kind: "lineStart" | "recovered";
      /** Zero-based offset of the cell's first character. */
      readonly offset: number;
    };

/**
 * One run of a cell's raw region. One flat record rather than a
 * discriminated union: all three kinds carry the same two fields, so a
 * union would separate nothing a reader has to tell apart.
 */
export interface TableTextRun {
  /** Why these bytes are here. */
  readonly kind: TableRunKind;
  /** The bytes, verbatim, newlines included. */
  readonly image: string;
  /** Zero-based offset of the run's first character. */
  readonly offset: number;
}

/**
 * Why a run's bytes are in a cell's region (or in `TableNode.leadingRuns`):
 * `content` is the cell's own text, and the other two are lines a
 * reader consumes before the table could see them, kept so a
 * byte-replaying printer can write them back. `droppedComment` is a
 * `//` line, but not a `///` one (`skip_comments`, reader.rb:420-425);
 * `skippedBlank` is a blank line no cell was open to take
 * (`skip_blank_lines`, reader.rb:279-291). Read
 * structurally through `TableTextRun.kind`, never named by import.
 * Exported for tests/parser/table-structure.test.ts; a future
 * consumer that branches on a run's kind BY NAME (a printer) is the
 * real `src` consumer once it lands.
 * @internal
 */
export type TableRunKind = "content" | "droppedComment" | "skippedBlank";

/**
 * A cell spec's parse (`parse_cellspec`, parser.rb:2495-2545). `repeat`
 * is a union because Asciidoctor's `+` and `*` forms are exclusive:
 * `+` sets colspan and rowspan, `*` sets a duplication count and
 * IGNORES the row half of the same digits (parser.rb:2515-2520). Two
 * nullable number fields would let `{ colspan: 2, duplicate: 3 }`
 * typecheck. Read structurally through the `separator` opening's
 * `parsed` field, never named by import. Exported for
 * tests/parser/table-structure.test.ts; a future consumer that reads
 * a spec BY NAME is the real `src` consumer once it lands.
 * @internal
 */
export interface TableCellSpec {
  /** The `N+`, `N.M+` or `N*` prefix, or its absence. */
  readonly repeat: TableCellRepeat;
  /** The horizontal alignment the spec named, if any. */
  readonly halign?: TableHorizontalAlignment;
  /** The vertical alignment the spec named, if any. */
  readonly valign?: TableVerticalAlignment;
  /** The style the spec's letter named, absent for an unmapped letter. */
  readonly style?: TableCellStyle;
}

/** The three exclusive forms of a cell spec's leading digits. */
export type TableCellRepeat =
  | {
      /** Repeat discriminant: no digits in front of the spec. */
      readonly kind: "none";
    }
  | {
      /** Repeat discriminant: `N+`, `.M+` or `N.M+`. */
      readonly kind: "span";
      /** Columns spanned; 1 when the spec wrote only a row half. */
      readonly colspan: number;
      /** Rows spanned; 1 when the spec wrote only a column half. */
      readonly rowspan: number;
    }
  | {
      /** Repeat discriminant: `N*`, which repeats the cell N times. */
      readonly kind: "duplicate";
      /** How many cells the one spelling produces. */
      readonly count: number;
    };

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
  | TableNode
  | ParentBlockNode
  | AdmonitionNode
  | ThematicBreakNode
  | PageBreakNode
  | BlockMacroNode
  | PreprocessorDirectiveNode
  | FrontMatterNode
  | BlockAttributeListNode
  | BlockTitleNode
  | BlockAnchorNode;
