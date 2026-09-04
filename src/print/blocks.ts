/**
 * Block-level printing functions for the AsciiDoc
 * printer.
 *
 * Each function takes an AST node (and optionally
 * Prettier's path/print callbacks) and produces Doc IR.
 * Delimiter-based blocks compute safe delimiter lengths;
 * parent blocks recurse into children via
 * {@link joinBlocks}.
 */
import { doc, type AstPath, type Doc, type ParserOptions } from "prettier";
import type {
  AdmonitionNode,
  BlockNode,
  DelimitedBlockNode,
  DocumentHeaderNode,
  DocumentNode,
  HeaderLineNode,
  InlineNode,
  LeafDelimiterVariant,
  ListItemNode,
  ParentBlockNode,
  TableCellNode,
  TableRowNode,
} from "../ast.js";
import { canonicalAttrlist } from "../parse/attrlist.js";
import { ASCII_NON_WHITESPACE, rstrip } from "../parse/line-shapes.js";
import { MARKER_OFFSET, MIN_DELIMITER_LENGTH } from "../constants.js";
import { inlineAtoms } from "./inline.js";
import { atomOf, blockBody, type Atom } from "./reflow.js";
import { joinBlocks } from "./join.js";

const {
  builders: { hardline, join },
  printer: { printDocToString },
} = doc;

/**
 * Union of all node types the printer may encounter.
 *
 * Prettier's generic `Printer` type needs this to
 * type-check `path.map()` calls across different node
 * shapes. A table's rows and cells are members for that
 * reason and no other: they are not blocks, and nothing
 * but the table printer's own recursion
 * (src/print/table.ts) ever reaches them. They cannot be
 * dropped from the union even if that recursion goes:
 * `path.map(print, "children")` is typed over every
 * `children` array any member declares, and a table's is
 * one of them.
 */
export type AnyNode =
  | DocumentNode
  | BlockNode
  | InlineNode
  | ListItemNode
  | TableRowNode
  | TableCellNode;

/**
 * Convenience alias for Prettier's AST path, specialized
 * to the AsciiDoc node union.
 *
 * Lets helper functions accept the same path argument as
 * the main print method without repeating verbose generic
 * types.
 */
export type PrintPath = AstPath<AnyNode>;

/**
 * Convenience alias for Prettier's recursive print
 * callback, specialized to the AsciiDoc node union.
 */
export type PrintFunction = (path: PrintPath) => Doc;

/**
 * The options Prettier hands the printer, specialized to the AsciiDoc
 * node union — every width and line-ending setting resolved, which is
 * what makes them the options Prettier's own Doc renderer takes.
 */
export type PrintOptions = ParserOptions<AnyNode>;

/**
 * Prints a comment node to Doc IR.
 *
 * Extracted from the main print method to keep cyclomatic
 * complexity manageable as more node types are added.
 * Line comments produce `// text`; block comments produce
 * `////` delimiters with verbatim content between them.
 * @param node - The comment node.
 * @param node.commentType - Whether this is a line
 *   (`//`) or block (`////`) comment.
 * @param node.value - The text content of the comment.
 * @returns Doc IR for the formatted comment.
 */
export function printComment(node: {
  commentType: "line" | "block";
  value: string;
}): Doc {
  if (node.commentType === "line") {
    if (node.value.length > 0) {
      return ["// ", node.value];
    }
    return "//";
  }
  // Block comment: delimiters on their own lines, content verbatim.
  // Detect whitespace-only content by Ruby's definition of blank
  // (ASCII_NON_WHITESPACE, issue #75), not trim()'s wider one: Prettier
  // strips trailing ASCII whitespace per line, so "     " would become
  // a blank line that re-parses as an empty comment, breaking
  // idempotency - but a line holding only a no-break space is not
  // blank to Asciidoctor, and trim() alone would drop it here.
  if (ASCII_NON_WHITESPACE.test(node.value)) {
    const contentLines = node.value.split("\n");
    return ["////", hardline, join(hardline, contentLines), hardline, "////"];
  }
  return ["////", hardline, "////"];
}

// Maps each leaf delimiter variant to its single delimiter character.
// Used by the printer to compute the minimum safe delimiter length
// and build the output delimiter string. The other variants
// (example, sidebar, quote, verse) reach a delimited block only by
// masquerading, and then they print from the source delimiter the
// open recorded (case 1 of computeMasqueradeDelimiter) — so this
// table is the whole of what remains past that branch, which is now
// what the node types say (LeafDelimiterVariant, src/ast.ts).
const DELIMITER_CHARS: Record<LeafDelimiterVariant, string> = {
  listing: "-",
  literal: ".",
  pass: "+",
};

// Maps each parent block variant to its delimiter character and
// default length. Open blocks always use exactly 2 dashes.
const PARENT_DELIMITER_CHARS: Record<ParentBlockNode["variant"], string> = {
  example: "=",
  sidebar: "*",
  open: "-",
  quote: "_",
};

// Open block delimiter is always exactly 2 dashes.
const OPEN_BLOCK_DELIMITER_LENGTH = 2;

/**
 * THE delimiter speller: `prefix` followed by the SHORTEST run of
 * `char` that is at least `minLength` long and equals no line of the
 * interior about to be written between the two delimiter lines. Every
 * delimiter this plugin chooses comes from here - a leaf block's, a
 * masqueraded parent's, a wrapper's and a table's.
 *
 * The closing line is the exact rstripped opening line, so the two
 * lines are one decision and this is it: `is_delimited_block?`
 * (`parser.rb:976-1010`) hands back the whole matched LINE as the
 * block's terminator (`parser.rb:536-538`), and `read_lines_until`
 * (`reader.rb:396-438`) closes the block on `line == terminator`, an
 * EQUALITY and not a prefix or length test. So a delimiter is safe
 * exactly when no interior line equals it, and a longer interior line
 * constrains nothing: a `------` inside a `----` block is content,
 * which is what the oracle renders it as.
 *
 * MINIMAL LENGTH is therefore the whole rule, and it is the rule the
 * table delimiter always used. Growing past the longest conflict
 * instead was over-conservative on a leaf block (an interior `------`
 * bought a seven-dash fence nothing needed) and, for a wrapper, was
 * computed from a walk over DESCENDANT NODES rather than from the
 * text - a proxy blind to verbatim content, which is how a `____`
 * line inside a nested listing block used to shorten the quote around
 * it into a delimiter its own interior closes (issue #143).
 *
 * The comparison rstrips because the reader does
 * (`prepare_source_string`), so a trailing-space `----` in the
 * interior is a collision even though its bytes differ. That is the
 * wider of the two trims in play and it subsumes the narrower one:
 * Prettier's hardline strips a trailing run of space and tab from
 * every line it writes (#125), and rstrip strips those plus the
 * vertical tab, form feed and carriage return the reader also calls
 * whitespace - so reading the interior rstripped answers for the
 * bytes pass one emits AND for what the next read makes of them.
 *
 * The unbounded `for` terminates, and not by assumption: the interior
 * is a finite set of lines, so some candidate length is absent from
 * it, and the loop returns at the first one.
 * @param prefix - what stands in front of the run, never changed: a
 *   table's hint character, and the empty string everywhere else
 * @param char - the character the run repeats
 * @param minLength - the shortest run the syntax admits
 * @param interior - the bytes about to be emitted between the two
 *   delimiter lines
 * @returns the delimiter line both ends take
 */
export function shortestSafeDelimiter(
  prefix: string,
  char: string,
  minLength: number,
  interior: string,
): string {
  const lines = new Set(interior.split("\n").map((line) => rstrip(line)));
  for (let length = minLength; ; length += 1) {
    const candidate = prefix + char.repeat(length);
    if (!lines.has(candidate)) {
      return candidate;
    }
  }
}

/**
 * The text a finished Doc will be written as.
 *
 * Prettier's own Doc renderer, on the Doc the printer just built - so
 * these are the printer's bytes, not a model of them. This is what
 * lets a delimiter be chosen from the interior ABOUT TO BE EMITTED
 * rather than from a proxy for it.
 *
 * Rendered at `endOfLine: "lf"` whatever the document is being
 * written with, because every question asked of this text is about
 * line CONTENT and every reader of the finished file agrees about
 * that: `Helpers.prepare_source_string` rewrites `\r\n` and then a
 * bare `\r` to `\n` before it splits anything
 * (src/parse/lines/split.ts), so a `crlf` or `cr` file yields the
 * very lines an `lf` one does. Reading at the document's own
 * terminator instead would fail OPEN - under `cr` there is no `\n` in
 * the output at all, so the whole Doc would arrive as ONE line and no
 * line would equal any delimiter.
 *
 * Rendering a Doc BEFORE its enclosing Doc is placed is safe because
 * the printer builds no `group` and no `fill`: every Doc it makes is
 * a string, an array or a hardline, so there is no break state for
 * the renderer's `propagateBreaks` to settle early and differently,
 * and no width decision left to make.
 * @param item - a finished Doc
 * @param options - the print options in force; only the width is read
 *   as given, the terminator being fixed above
 * @returns the bytes the Doc renders to
 */
export function printedText(item: Doc, options: PrintOptions): string {
  // A typed binding rather than an inline literal: the renderer's own
  // options type does not DECLARE `endOfLine` (it reads it all the
  // same), and a fresh literal would be rejected for the extra
  // property. `PrintOptions` declares it, so the widening is the
  // plugin's own option type rather than an assertion.
  const probeOptions: PrintOptions = { ...options, endOfLine: "lf" };
  return printDocToString(item, probeOptions).formatted;
}

/**
 * Resolves the correct delimiter string for a delimited
 * block, accounting for masquerading.
 *
 * Two cases, and only two:
 * 1. `sourceDelimiter` is set — the block was masqueraded
 *    from a parent block, so it prints from the parent
 *    delimiter chars the open RECORDED.
 * 2. Otherwise the variant is a leaf's
 *    (listing/literal/pass) — {@link DELIMITER_CHARS}.
 *
 * There is no third case, and no assertion saying so: the
 * parameter takes the three delimited-form members, and past
 * the `sourceDelimiter` branch the two that remain (a fence
 * and a leaf block) have leaf variants by declaration, so
 * the delimiter-character lookup is total.
 * @param node - The delimited block node whose delimiter
 *   to compute.
 * @returns The correctly-sized delimiter string.
 */
function computeMasqueradeDelimiter(
  // The delimited-form members that print a FRAME of their own: a
  // leaf block, a fence, a masqueraded parent block. A table is not
  // among them and cannot be: its delimiter lines are CONTENT, so it
  // is a node of its own (src/print/table.ts) rather than a member of
  // this union.
  node: Extract<DelimitedBlockNode, { form: "delimited" }>,
): string {
  if (node.sourceDelimiter !== undefined) {
    const parentChar = PARENT_DELIMITER_CHARS[node.sourceDelimiter];
    return node.sourceDelimiter === "open"
      ? parentChar.repeat(OPEN_BLOCK_DELIMITER_LENGTH)
      : shortestSafeDelimiter(
          "",
          parentChar,
          MIN_DELIMITER_LENGTH,
          node.content,
        );
  }
  const leafChar = DELIMITER_CHARS[node.variant];
  return shortestSafeDelimiter(
    "",
    leafChar,
    MIN_DELIMITER_LENGTH,
    node.content,
  );
}

/**
 * Whether the reader recorded a `[source]`/`[source,lang]` annotation
 * that already covers this block's implicit source style — a FIELD
 * READ of the reader's own record, replacing a
 * getParentNode() cast and sibling scan that structurally could not
 * see inside list items (the measured duplicated prefix, ledger
 * family fence-annotation). A fence with no language hint still
 * implies `source`, so a bare `[source]` annotation counts.
 *
 * A fence is the ONLY member carrying a language hint, which the node
 * types now say (src/ast.ts): the "or it has a language" half of this
 * test used to be spelled beside the fence test and is gone with the
 * combination it covered, not with any behavior.
 *
 * The fence test itself is LOAD-BEARING and not a restatement of it.
 * A DELIMITED `[source]` / `----` block is not fenced and carries
 * exactly the annotation `source`, so without this line it would
 * report covered and the printer would drop the author's `[source]`
 * line (8 corpus documents measured).
 * @param node - The delimited block to check.
 * @returns True when the annotation already covers the source
 *   attribute this block would otherwise emit.
 */
export function hasPrecedingLanguageAttribute(
  node: DelimitedBlockNode,
): boolean {
  if (node.fenced !== true) {
    return false;
  }
  const expectedValue =
    node.language === undefined ? "source" : `source,${node.language}`;
  return node.annotatedBy === expectedValue;
}

/**
 * Prints a delimited leaf block to Doc IR.
 *
 * Produces delimiter, content lines (verbatim), delimiter.
 * Content is not reflowed: it is preserved exactly, which is what
 * makes `node.content` the interior {@link shortestSafeDelimiter}
 * reads: the bytes below go out as they stand. Indented literal
 * paragraphs (form: "indented") and paragraph-form blocks are printed
 * verbatim without delimiters.
 * @param node - The delimited block AST node.
 * @param skipSourcePrefix - When true, suppress the
 *   `[source]`/`[source,lang]` prefix normally emitted for
 *   fenced code blocks. Set when the preceding sibling
 *   already has a matching attribute list — which for a bare
 *   fence is the bare `[source]` the printer would otherwise
 *   add a second time.
 * @returns Doc IR for the formatted block.
 */
export function printDelimitedBlock(
  node: DelimitedBlockNode,
  skipSourcePrefix: boolean,
): Doc {
  // Indented literal paragraphs and paragraph-form blocks: print
  // content verbatim without delimiters. The preceding attribute
  // list (for paragraph form) is a separate node handled by the
  // printer's stacking behavior.
  if (node.form === "indented" || node.form === "paragraph") {
    const contentLines = node.content.split("\n");
    return join(hardline, contentLines);
  }

  // Determine the delimiter character and compute its length.
  // When a block was masqueraded (e.g. [source] on open block
  // `--`), the sourceDelimiter tells us which parent block
  // delimiter to use instead of the variant's default.
  const delimiter = computeMasqueradeDelimiter(node);

  // A fenced code block implies the `source` style even without a
  // language hint — Asciidoctor renders it as `<pre class="highlight">`,
  // not a plain listing. Emit [source] (or [source,lang] when a
  // language hint is present) before the delimiter to preserve that
  // semantics when normalizing to AsciiDoc-native `----` syntax. Skip
  // when the preceding sibling already has a matching attribute list
  // to avoid emitting it twice.
  // Only a fence carries a language hint, so "wants a source prefix"
  // and "is a fence" are one test (src/ast.ts's node types).
  let prefix: Doc[] = [];
  if (node.fenced === true && !skipSourcePrefix) {
    // The synthesized list goes through the SAME spacing rule an
    // authored one does: a fence's info string is the author's
    // (` javascript, numbered`), and leaving it alone here printed a
    // `[source,javascript, numbered]` that the next pass — reading it
    // as a real attribute list — spelled differently.
    prefix =
      node.language === undefined
        ? ["[source]", hardline]
        : ["[", canonicalAttrlist(`source,${node.language}`), "]", hardline];
  }

  // Detect whitespace-only content by Ruby's definition of blank
  // (ASCII_NON_WHITESPACE, issue #75), not trim()'s wider one: Prettier
  // strips trailing ASCII whitespace per line, so all-whitespace
  // content would become blank lines that re-parse as an empty block,
  // breaking idempotency - but a no-break space is not blank to
  // Asciidoctor, and trim() alone would drop that content here.
  if (ASCII_NON_WHITESPACE.test(node.content)) {
    const contentLines = node.content.split("\n");
    return [
      ...prefix,
      delimiter,
      hardline,
      join(hardline, contentLines),
      hardline,
      delimiter,
    ];
  }
  return [...prefix, delimiter, hardline, delimiter];
}

/**
 * What a delimited parent's frame is decided by, and the whole of it:
 * the delimiter variant it wraps itself in, and the blocks it wraps.
 *
 * A parentBlock's variant is its own field; a delimited-form
 * admonition's is its `form`. Naming the two FIELDS rather than the
 * node is what keeps `"paragraph"` - the admonition form that wraps
 * nothing and has no delimiter - out of the argument by construction,
 * with no assertion and no unreachable arm saying so.
 */
interface WrappedBlocks {
  /** The delimiter variant the frame is spelled in. */
  readonly variant: ParentBlockNode["variant"];
  /** The blocks between the two delimiter lines, in document order. */
  readonly children: BlockNode[];
}

/**
 * THE delimited-parent printer (three near-identical bodies became
 * this one): computes the wrapper delimiter for a
 * compound block — a parentBlock or a delimited-form admonition — and
 * prints delimiter/children/delimiter.
 *
 * The children are printed FIRST and rendered to text, because the
 * delimiter is chosen from the interior about to be written
 * ({@link shortestSafeDelimiter}) and a wrapper's interior is a Doc
 * rather than a recorded string. Nesting needs no separate rule: an
 * inner quote's own `____` stands in the outer quote's printed
 * interior, so the outer clears it the same way it clears a `____`
 * that is a listing block's verbatim content (issue #143). It is one
 * question about text, where the walk over descendant NODES this
 * replaces could only answer for the blocks it recognised.
 *
 * Open blocks are the exception and take the fixed two-dash spelling:
 * the registry admits `--` and nothing longer
 * (src/parse/line-shapes.ts), so a conflict in an open block's
 * interior cannot be spelled out of and is not this function's to
 * repair.
 * @param wrapper - the delimiter variant and the blocks it wraps
 * @param path - Prettier's AST path
 * @param print - Prettier's recursive print callback
 * @param options - the print options in force, for rendering the
 *   interior back to the lines it will be written as
 * @returns Doc IR for the wrapped block
 */
function printDelimitedParent(
  wrapper: WrappedBlocks,
  path: PrintPath,
  print: PrintFunction,
  options: PrintOptions,
): Doc {
  const { variant, children } = wrapper;
  const delimChar = PARENT_DELIMITER_CHARS[variant];
  // A childless wrapper has NO interior, which is a different thing
  // from an empty one: it writes a single line break between its two
  // delimiters, and {@link joinBlocks} has no first block to join
  // from. Carrying that as `undefined` is what lets the delimiter
  // below be one expression rather than one per arm.
  const interior: Doc | undefined =
    children.length === 0
      ? undefined
      : joinBlocks(children, path.map(print, "children"));
  const delimiter =
    variant === "open"
      ? delimChar.repeat(OPEN_BLOCK_DELIMITER_LENGTH)
      : shortestSafeDelimiter(
          "",
          delimChar,
          MIN_DELIMITER_LENGTH,
          interior === undefined ? "" : printedText(interior, options),
        );
  return interior === undefined
    ? [delimiter, hardline, delimiter]
    : [delimiter, hardline, interior, hardline, delimiter];
}

/**
 * Prints a parent (structural) block to Doc IR.
 *
 * Parent blocks contain other blocks as children and are
 * fenced by delimiter lines (e.g. `====` for example
 * blocks, `--` for open blocks) — one call into
 * {@link printDelimitedParent}, which is where the
 * delimiter length and the wrapping live.
 * @param node - The parent block AST node.
 * @param path - Prettier's AST path, used to recurse
 *   into children via `path.map(print, "children")`.
 * @param print - Prettier's recursive print callback.
 * @param options - the print options in force.
 * @returns Doc IR for the formatted parent block.
 */
export function printParentBlock(
  node: ParentBlockNode,
  path: PrintPath,
  print: PrintFunction,
  options: PrintOptions,
): Doc {
  return printDelimitedParent(
    { variant: node.variant, children: node.children },
    path,
    print,
    options,
  );
}

/**
 * Prints an admonition node to Doc IR: the paragraph form is the
 * label plus THE paragraph body engine over its inline children (one
 * engine by construction); a delimited form goes through
 * {@link printDelimitedParent}, THE wrapper printer, with the
 * delimiter variant read off `form` (the old `delimiter ?? "example"`
 * fallback left WITH the field it defended).
 * @param node - The admonition AST node.
 * @param path - Prettier's AST path, for recursing into the body.
 * @param print - Prettier's recursive print callback.
 * @param options - the print options in force: the column budget for
 *   a whole output line in the paragraph arm, and the renderer's own
 *   settings in the delimited one.
 * @returns Doc IR for the formatted admonition.
 */
export function printAdmonition(
  node: AdmonitionNode,
  path: PrintPath,
  print: PrintFunction,
  options: PrintOptions,
): Doc {
  if (node.form === "paragraph") {
    const label = `${node.variant.toUpperCase()}:`;
    // The label is an atom of the body, not a prefix in front of it:
    // it occupies its columns of the first output line, and the packer
    // must measure them. The join after it is the syntax's own space,
    // which may never become a break.
    // The label below holds column 0 of the first line.
    const body = inlineAtoms(node.text, node.position.start.line, {
      atColumnZero: false,
    });
    // Text nodes that are all whitespace produce no atoms, so a text
    // array with children can still yield none — and then the label is
    // the whole line. ONE test for both: an empty text array yields no
    // atoms either, so the emptiness the caller could have asked about
    // upstream is the same emptiness answered here.
    if (body.length === 0) {
      return label;
    }
    const atoms: Atom[] = [
      atomOf(label),
      { ...body[0], glueLeft: false, noBreakBefore: true },
      ...body.slice(1),
    ];
    return blockBody(atoms, options.printWidth, 0);
  }
  return printDelimitedParent(
    { variant: node.form, children: node.children },
    path,
    print,
    options,
  );
}

/**
 * Prints an attribute entry node to Doc IR: `:name: value`, `:name:`,
 * or `:!name:`.
 *
 * Two spellings the author had are DERIVED away here, both because
 * Asciidoctor cannot see them. The `!` goes in FRONT: `store_attribute`
 * (parser.rb l.2131, the chop at l.2133-40) chops it off whichever end carries it and
 * reaches the same unset either way, and `:!name:` is the form the
 * AsciiDoc documentation leads with. And the NAME goes down:
 * `sanitize_attribute_name` (parser.rb l.2770-71) is
 * `name.gsub(InvalidAttributeNameCharsRx, '').downcase`, so the case
 * an author typed reaches neither the attribute table nor any
 * reference to it. The character-stripping half of that sanitize is
 * NOT copied — `:Foo Bar:` prints `:foo bar:`, which Asciidoctor
 * sanitizes to the same `foobar` the original did.
 *
 * A value the author CONTINUED onto the lines below carries those
 * lines in its own text, separated by newlines, and they are written
 * back where they stood (see src/parse/lines/attribute-entry.ts for
 * why the split points are the author's to keep). Splitting on the
 * newline is what a block comment's body already does two functions
 * up: a Doc string may hold no line break of its own.
 * @param node - The attribute entry node.
 * @param node.name - The attribute name (without
 *   surrounding colons), as the author spelled it.
 * @param node.value - The attribute value, or undefined
 *   for no-value entries (`:toc:`) and unset entries.
 * @param node.unset - Whether the entry unsets the attribute.
 * @returns Doc IR for the formatted attribute entry.
 */
export function printAttributeEntry(node: {
  name: string;
  value: string | undefined;
  unset: boolean;
}): Doc {
  const bang = node.unset ? "!" : "";
  const name = node.name.toLowerCase();
  if (node.value !== undefined) {
    return [":", bang, name, ": ", join(hardline, node.value.split("\n"))];
  }
  return [":", bang, name, ":"];
}

/**
 * Prints one line of a document header.
 *
 * The two attribution lines and the preprocessor directive print
 * their span back VERBATIM: they are line-oriented header syntax, not
 * prose, and there is no derivation that could put them back - see
 * {@link AuthorLineNode}. The other two go through the printers every
 * other attribute entry and comment go through, so a header attribute
 * entry is normalized exactly like a body one (`:name!:` still prints
 * `:!name:`).
 * @param node - one header line
 * @returns Doc IR for the line, without its newline
 */
function printHeaderLine(node: HeaderLineNode): Doc {
  switch (node.type) {
    case "attributeEntry": {
      return printAttributeEntry(node);
    }
    case "comment": {
      return printComment(node);
    }
    case "preprocessorDirective":
    case "authorLine":
    case "revisionLine": {
      return node.value;
    }
  }
}

/**
 * Prints the document header: the title line, then its lines, each on
 * the line below the last.
 *
 * The separator is a plain `hardline` and there is no decision above
 * it - that is the fix for issue #18. Asciidoctor's header ENDS at
 * the first blank line, so a blank line anywhere inside it demotes
 * everything below to body content: the author line becomes the first
 * paragraph and every section boundary under it shifts. Owning the
 * lines is what leaves {@link joinBlocks} nothing to get wrong here.
 * @param node - the header node
 * @returns Doc IR for the whole header
 */
export function printDocumentHeader(node: DocumentHeaderNode): Doc {
  return [
    // The title is level 0 by construction - a header opens at no
    // other level - so the marker is the same arithmetic the heading
    // arm does, with the level folded out.
    "=".repeat(MARKER_OFFSET),
    " ",
    node.title,
    ...node.lines.map((child): Doc => [hardline, printHeaderLine(child)]),
  ];
}
