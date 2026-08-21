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
import { doc, type AstPath, type Doc } from "prettier";
import type {
  AdmonitionNode,
  BlockNode,
  DelimitedBlockNode,
  DocumentNode,
  InlineNode,
  ListItemNode,
  ListNode,
  ParentBlockNode,
} from "./ast.js";
import {
  EMPTY,
  FIRST,
  MARKER_OFFSET,
  MIN_DELIMITER_LENGTH,
  NEXT,
  NOT_FOUND,
  SAFE_DELIMITER_PAD,
} from "./constants.js";
import { isContinuationPassThrough } from "./block-metadata.js";
import { CHECKBOX_PREFIX_LEN } from "./parse/block-helpers.js";
import {
  flattenForFill,
  splitWords,
  stripLeadingHazardBreak,
  wordsToFillParts,
} from "./reflow.js";
import { joinBlocks } from "./print-join.js";
import { isRawParagraphLine } from "./parse/line-shapes.js";

const {
  builders: { align, fill, hardline, join, literalline },
} = doc;

/**
 * Union of all node types the printer may encounter.
 *
 * Prettier's generic `Printer` type needs this to
 * type-check `path.map()` calls across different node
 * shapes.
 */
export type AnyNode = DocumentNode | BlockNode | InlineNode | ListItemNode;

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
    if (node.value.length > EMPTY) {
      return ["// ", node.value];
    }
    return "//";
  }
  // Block comment: delimiters on their own lines, content verbatim.
  // Use trim() to detect whitespace-only content: Prettier strips
  // trailing whitespace per line, so "     " would become a blank
  // line that re-parses as an empty comment, breaking idempotency.
  if (node.value.trim().length > EMPTY) {
    const contentLines = node.value.split("\n");
    return ["////", hardline, join(hardline, contentLines), hardline, "////"];
  }
  return ["////", hardline, "////"];
}

// Leaf-block variants that use their own delimiter characters
// (----, ...., ++++). Other variants (example, sidebar, quote,
// verse) either use parent-block delimiters when masqueraded
// (case 1 of computeMasqueradeDelimiter) or fall through to
// MASQUERADE_DELIMITER_CHARS (case 3).
type LeafBlockVariant = "listing" | "literal" | "pass";

// Maps each leaf-block variant to its single delimiter character.
// Used by the printer to compute the minimum safe delimiter length
// and build the output delimiter string.
const DELIMITER_CHARS: Record<LeafBlockVariant, string> = {
  listing: "-",
  literal: ".",
  pass: "+",
};

// Fallback delimiter chars for variants that are naturally
// associated with parent-block delimiters (verse/quote → `_`,
// example → `=`, sidebar → `*`). Used by
// computeMasqueradeDelimiter when no explicit sourceDelimiter
// is present on the node.
// These entries exist for defensive completeness; in
// practice all masquerade variants currently carry a
// sourceDelimiter (case 1) or use paragraph form
// (caught before this function is called).
type MasqueradedVariant = "verse" | "example" | "sidebar" | "quote";
const MASQUERADE_DELIMITER_CHARS: Record<MasqueradedVariant, string> = {
  verse: "_",
  quote: "_",
  example: "=",
  sidebar: "*",
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
 * Computes the shortest safe delimiter for a delimited
 * block.
 *
 * Scans the block content for lines that consist entirely
 * of the delimiter character (4+ chars) — these would be
 * misinterpreted as delimiters on re-parse. Returns a
 * delimiter one character longer than the longest
 * conflict. When no conflicts exist, returns the minimum
 * 4-character delimiter.
 * @param content - The verbatim text content of the
 *   block.
 * @param delimChar - The single character used for the
 *   delimiter (e.g. `-` for listing blocks).
 * @returns The delimiter string, repeated to a safe
 *   length.
 */
function computeDelimiter(content: string, delimChar: string): string {
  let maxConflict = EMPTY;
  if (content.length > EMPTY) {
    // Escape the delimiter char for use in a regex.
    // `.` and `+` are regex metacharacters; `-` is safe
    // outside character classes and must NOT be escaped
    // (the `v` flag rejects unnecessary escapes).
    const escaped = delimChar.replace(/[.+]/v, String.raw`\$&`);
    const pattern = new RegExp(`^${escaped}{${MIN_DELIMITER_LENGTH},}$`, "v");
    for (const line of content.split("\n")) {
      if (pattern.test(line)) {
        maxConflict = Math.max(maxConflict, line.length);
      }
    }
  }
  const length = Math.max(
    MIN_DELIMITER_LENGTH,
    maxConflict + SAFE_DELIMITER_PAD,
  );
  return delimChar.repeat(length);
}

/**
 * Resolves the correct delimiter string for a delimited
 * block, accounting for masquerading.
 *
 * Three cases:
 * 1. `sourceDelimiter` is set — use parent block
 *    delimiter chars (the block was masqueraded from a
 *    parent block).
 * 2. Leaf variant (listing/literal/pass) — standard
 *    {@link DELIMITER_CHARS}.
 * 3. Masquerade variant (verse/quote/example/sidebar)
 *    without `sourceDelimiter` — use
 *    {@link MASQUERADE_DELIMITER_CHARS}.
 * @param node - The delimited block node whose delimiter
 *   to compute.
 * @returns The correctly-sized delimiter string.
 */
function computeMasqueradeDelimiter(node: DelimitedBlockNode): string {
  if (node.sourceDelimiter !== undefined) {
    const { [node.sourceDelimiter]: parentChar } = PARENT_DELIMITER_CHARS;
    return node.sourceDelimiter === "open"
      ? parentChar.repeat(OPEN_BLOCK_DELIMITER_LENGTH)
      : computeDelimiter(node.content, parentChar);
  }
  if (node.variant in DELIMITER_CHARS) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- checked by `in` guard
    const { [node.variant as LeafBlockVariant]: leafChar } = DELIMITER_CHARS;
    return computeDelimiter(node.content, leafChar);
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- remaining variants are masqueraded
  const { [node.variant as MasqueradedVariant]: masqChar } =
    MASQUERADE_DELIMITER_CHARS;
  return computeDelimiter(node.content, masqChar);
}

/**
 * Check whether the preceding sibling is a `[source]` or
 * `[source,lang]` attribute list that already covers this
 * block's implicit source style. When true, the printer
 * should skip emitting its own `[source]`/`[source,lang]`
 * prefix to avoid duplication. A fence with no language
 * hint still implies `source`, so a bare preceding
 * `[source]` counts as already-present too.
 * @param node - The delimited block to check.
 * @param path - Prettier's AST path for sibling access.
 * @returns True when the preceding sibling already covers
 *   the source attribute.
 */
export function hasPrecedingLanguageAttribute(
  node: DelimitedBlockNode,
  path: PrintPath,
): boolean {
  if (node.fenced !== true && node.language === undefined) return false;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Prettier path traversal returns generic node
  const parent = path.getParentNode() as { children: BlockNode[] } | undefined;
  const siblings = parent?.children;
  if (siblings === undefined) return false;
  const index = siblings.indexOf(node);
  if (index < NEXT) return false;
  const { [index - NEXT]: previous } = siblings;
  if (previous.type !== "blockAttributeList") return false;
  const expectedValue =
    node.language === undefined ? "source" : `source,${node.language}`;
  return previous.value === expectedValue;
}

/**
 * Prints a delimited leaf block to Doc IR.
 *
 * Produces delimiter, content lines (verbatim), delimiter.
 * Content is not reflowed — it is preserved exactly. The
 * delimiter length is computed by
 * {@link computeDelimiter} to avoid conflicts with
 * content. Indented literal paragraphs (form: "indented")
 * and paragraph-form blocks are printed verbatim without
 * delimiters.
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
  const wantsSource = node.fenced === true || node.language !== undefined;
  let prefix: Doc[] = [];
  if (wantsSource && !skipSourcePrefix) {
    prefix =
      node.language === undefined
        ? ["[source]", hardline]
        : ["[source,", node.language, "]", hardline];
  }

  // Use trim() to detect whitespace-only content: Prettier strips
  // trailing whitespace per line, so all-whitespace content would
  // become blank lines that re-parse as an empty block, breaking
  // idempotency.
  if (node.content.trim().length > EMPTY) {
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
 * Recursively finds the maximum delimiter length used by
 * any descendant parent block with the given variant.
 *
 * Searches through ALL children — not just same-variant
 * — because a quote block inside a sidebar inside a quote
 * still produces `____` delimiters within the outer
 * quote's formatted output. Without this, nested
 * same-type blocks would normalize to identical delimiter
 * lengths and collapse on re-parse.
 * @param variant - The parent-block variant whose
 *   delimiter length to track.
 * @param children - The child block nodes to recurse
 *   into.
 * @returns The longest same-variant delimiter found
 *   among descendants, or 0 if none exist.
 */
function maxDescendantDelimiter(
  variant: ParentBlockNode["variant"],
  children: readonly BlockNode[],
): number {
  let max = EMPTY;
  for (const child of children) {
    if (child.type === "parentBlock") {
      // Recurse into all parent block children regardless of
      // variant — same-variant blocks might be nested deeper.
      const childInner = maxDescendantDelimiter(variant, child.children);
      if (child.variant === variant) {
        // This child uses the same delimiter character. Its own
        // length is at least MIN_DELIMITER_LENGTH plus whatever
        // its own nesting requires.
        const childLength = Math.max(
          MIN_DELIMITER_LENGTH,
          childInner + SAFE_DELIMITER_PAD,
        );
        max = Math.max(max, childLength);
      } else {
        // Different variant — propagate inner max unchanged.
        max = Math.max(max, childInner);
      }
    } else if (
      // Delimited-form admonitions produce parent block delimiters
      // and must be included in the nesting computation.
      child.type === "admonition" &&
      child.form === "delimited" &&
      child.delimiter !== undefined
    ) {
      const childInner = maxDescendantDelimiter(variant, child.children);
      if (child.delimiter === variant) {
        const childLength = Math.max(
          MIN_DELIMITER_LENGTH,
          childInner + SAFE_DELIMITER_PAD,
        );
        max = Math.max(max, childLength);
      } else {
        max = Math.max(max, childInner);
      }
    }
  }
  return max;
}

/**
 * Prints a parent (structural) block to Doc IR.
 *
 * Parent blocks contain other blocks as children and are
 * fenced by delimiter lines (e.g. `====` for example
 * blocks, `--` for open blocks). The delimiter length
 * is computed to be longer than any same-variant nested
 * descendant, preserving the nesting structure on
 * re-parse.
 * @param node - The parent block AST node.
 * @param path - Prettier's AST path, used to recurse
 *   into children via `path.map(print, "children")`.
 * @param print - Prettier's recursive print callback.
 * @returns Doc IR for the formatted parent block.
 */
export function printParentBlock(
  node: ParentBlockNode,
  path: PrintPath,
  print: PrintFunction,
): Doc {
  const { [node.variant]: delimChar } = PARENT_DELIMITER_CHARS;

  // Open blocks are always exactly 2 dashes — no nesting
  // concerns because there's only one possible length.
  if (node.variant === "open") {
    const delimiter = delimChar.repeat(OPEN_BLOCK_DELIMITER_LENGTH);
    if (node.children.length > EMPTY) {
      const children = path.map(print, "children");
      return [
        delimiter,
        hardline,
        joinBlocks(node.children, children),
        hardline,
        delimiter,
      ];
    }
    return [delimiter, hardline, delimiter];
  }

  // For parent blocks that support variable-length delimiters,
  // ensure the outer delimiter is longer than any same-type
  // nested child. Without this, nested same-type blocks would
  // all normalize to MIN_DELIMITER_LENGTH and lose their
  // nesting structure on re-parse.
  const innerMax = maxDescendantDelimiter(node.variant, node.children);
  const delimLength = Math.max(
    MIN_DELIMITER_LENGTH,
    innerMax + SAFE_DELIMITER_PAD,
  );
  const delimiter = delimChar.repeat(delimLength);

  if (node.children.length > EMPTY) {
    const children = path.map(print, "children");
    return [
      delimiter,
      hardline,
      joinBlocks(node.children, children),
      hardline,
      delimiter,
    ];
  }
  return [delimiter, hardline, delimiter];
}

/**
 * Reflow one run of admonition body lines into a fill().
 *
 * wordsToFillParts handles block-syntax-at-line-start prevention
 * (see its doc comment). No align() here: leading spaces in AsciiDoc
 * denote an indented literal block, so continuation lines must start
 * at column 0 to preserve document semantics. flattenForFill
 * resolves any hazard marker the guard emitted (there are no inline
 * siblings here, so every marker sits in a real separator slot);
 * stripLeadingHazardBreak covers the block-level case for the same
 * reason as the paragraph printer.
 * @param text - The run's source lines joined with `\n`.
 * @param isFirstRun - Whether this run opens the admonition. Only
 *   then can a word sit on the BLOCK's first source line, which is
 *   what the dlist guard asks about; a later run always starts on a
 *   line of its own, so none of its words qualify.
 * @returns A fill() for the run, or undefined when it has no words.
 */
function admonitionRun(text: string, isFirstRun: boolean): Doc | undefined {
  const words = splitWords(text);
  if (words.length === EMPTY) {
    return undefined;
  }
  // An admonition keeps its content raw, newlines and all, so the
  // dlist guard's "which words were on the block's first source
  // line" is just the word count before the first newline. Without
  // it, `NOTE: a line\nterm:: x` reflows to one line and re-parses
  // as a description list instead of an admonition.
  const firstNewline = text.indexOf("\n");
  const firstLineWordCount =
    firstNewline === NOT_FOUND
      ? words.length
      : splitWords(text.slice(FIRST, firstNewline)).length;
  const parts = wordsToFillParts(words, {
    firstLineWordCount: isFirstRun ? firstLineWordCount : EMPTY,
  });
  return fill(stripLeadingHazardBreak(flattenForFill([parts])));
}

/**
 * Split an admonition body into the pieces that get their own output
 * line: reflowable runs of text, and the verbatim comment or
 * preprocessor lines between them.
 *
 * The split uses the same registry predicate the lexer classified
 * those lines with, so parse and print cannot disagree about which
 * line is which. Reflowing across one would make a comment visible
 * or render `ifdef`-guarded text unconditionally.
 * @param content - The admonition's body, source lines joined by
 *   `\n`.
 * @returns Segments in source order, to be joined with a forced
 *   break.
 */
function admonitionBodySegments(content: string): Doc[] {
  const segments: Doc[] = [];
  let run: string[] = [];
  let isFirstRun = true;
  const flushRun = (): void => {
    // isFirstRun clears even when the run is empty: whatever follows
    // is no longer the block's first source line, which is the only
    // thing the flag is asked about.
    const rendered =
      run.length === EMPTY
        ? undefined
        : admonitionRun(run.join("\n"), isFirstRun);
    if (rendered !== undefined) {
      segments.push(rendered);
    }
    run = [];
    isFirstRun = false;
  };
  for (const line of content.split("\n")) {
    if (isRawParagraphLine(line)) {
      flushRun();
      segments.push(line);
    } else {
      run.push(line);
    }
  }
  flushRun();
  return segments;
}

/**
 * Prints an admonition node to Doc IR.
 *
 * Paragraph-form admonitions (`NOTE: text`) produce a
 * label prefix followed by reflowed text using fill()
 * (same as paragraphs).
 *
 * Delimited-form admonitions are printed as parent block
 * delimiters wrapping the children. The `[NOTE]`
 * attribute list that precedes the block is a separate
 * metadata node handled by the stacking behavior in
 * {@link joinBlocks}.
 * @param node - The admonition AST node.
 * @param path - Prettier's AST path, used to recurse
 *   into children for delimited-form admonitions.
 * @param print - Prettier's recursive print callback.
 * @returns Doc IR for the formatted admonition.
 */
export function printAdmonition(
  node: AdmonitionNode,
  path: PrintPath,
  print: PrintFunction,
): Doc {
  if (node.form === "paragraph") {
    const label = `${node.variant.toUpperCase()}: `;
    if (node.content === undefined) {
      return label.trimEnd();
    }
    return [label, join(literalline, admonitionBodySegments(node.content))];
  }

  // Delimited form: use the stored delimiter variant to
  // reconstruct the correct delimiters (example `====` or
  // open `--`).
  const delimVariant = node.delimiter ?? "example";
  const { [delimVariant]: delimChar } = PARENT_DELIMITER_CHARS;
  // For non-open delimiters, ensure the admonition's delimiter is
  // longer than any same-variant nested block — same logic as
  // printParentBlock. Without this, a delimited admonition
  // wrapping a same-variant parent block would produce matching
  // delimiter lengths, collapsing the nesting on re-parse.
  const delimLength =
    delimVariant === "open"
      ? OPEN_BLOCK_DELIMITER_LENGTH
      : Math.max(
          MIN_DELIMITER_LENGTH,
          maxDescendantDelimiter(delimVariant, node.children) +
            SAFE_DELIMITER_PAD,
        );
  const delimiter = delimChar.repeat(delimLength);

  if (node.children.length > EMPTY) {
    const children = path.map(print, "children");
    return [
      delimiter,
      hardline,
      joinBlocks(node.children, children),
      hardline,
      delimiter,
    ];
  }
  return [delimiter, hardline, delimiter];
}

/**
 * Prints an attribute entry node to Doc IR.
 *
 * Produces the canonical `:name: value` form, handling
 * the three attribute-unset syntaxes: prefix bang
 * (`:!name:`), suffix bang (`:name!:`), and no bang
 * (attribute set, with or without a value).
 * @param node - The attribute entry node.
 * @param node.name - The attribute name (without
 *   surrounding colons).
 * @param node.value - The attribute value, or undefined
 *   for no-value entries (`:name:`) and unset entries.
 * @param node.unset - How the attribute is unset:
 *   "prefix" for `:!name:`, "suffix" for `:name!:`,
 *   or false when the attribute is being set (with or
 *   without a value).
 * @returns Doc IR for the formatted attribute entry.
 */
export function printAttributeEntry(node: {
  name: string;
  value: string | undefined;
  unset: false | "prefix" | "suffix";
}): Doc {
  const bangPrefix = node.unset === "prefix" ? "!" : "";
  const bangSuffix = node.unset === "suffix" ? "!" : "";
  if (node.value !== undefined) {
    return [":", bangPrefix, node.name, bangSuffix, ": ", node.value];
  }
  return [":", bangPrefix, node.name, bangSuffix, ":"];
}

/**
 * Prints a list node: items separated by hard line
 * breaks.
 *
 * Items at different depths are handled by the nested
 * ListNode structure — each ListItemNode prints its own
 * nested children recursively.
 * @param path - Prettier's AST path, used to recurse
 *   into list items via `path.map(print, "children")`.
 * @param print - Prettier's recursive print callback.
 * @returns Doc IR for the formatted list.
 */
export function printList(path: PrintPath, print: PrintFunction): Doc {
  const items = path.map(print, "children");
  return join(hardline, items);
}

/**
 * Builds the marker string for a list item based on the
 * parent list's variant.
 *
 * Callout lists use `<N>` or `<.>` markers; ordered
 * lists use dots; unordered lists use asterisks. The
 * marker depth (number of repeated characters) encodes
 * the nesting level.
 * @param node - The list item whose marker to build.
 * @param parentList - The parent list node, used to
 *   determine the variant (ordered, unordered, callout).
 * @returns The marker string (e.g. `**`, `...`, `<1>`).
 */
function buildMarker(
  node: ListItemNode,
  parentList: ListNode | undefined,
): string {
  if (parentList?.variant === "callout") {
    // Auto-numbered callouts store 0 as calloutNumber.
    const calloutLabel =
      node.calloutNumber === EMPTY ? "." : String(node.calloutNumber);
    return `<${calloutLabel}>`;
  }
  const markerChar = parentList?.variant === "ordered" ? "." : "*";
  return markerChar.repeat(node.depth);
}

/**
 * Formats a checklist checkbox into its canonical string
 * representation.
 *
 * Normalizes `[*]` to `[x]` (the canonical checked
 * form). Returns an empty string for non-checklist items
 * so the caller can unconditionally prepend the result.
 * @param checkbox - The checkbox state: "checked",
 *   "unchecked", or undefined for non-checklist items.
 * @returns The checkbox prefix string, or empty string
 *   if the item has no checkbox.
 */
function formatCheckbox(checkbox: ListItemNode["checkbox"]): string {
  if (checkbox === "checked") {
    return "[x] ";
  }
  if (checkbox === "unchecked") {
    return "[ ] ";
  }
  return "";
}

/**
 * Prints a single list item to Doc IR.
 *
 * Produces marker + space + text content, with text
 * reflowed via fill(). Continuation lines are aligned
 * to the text start (past the marker). Nested lists
 * appear on the next line after the item text, outside
 * the fill.
 * @param node - The list item AST node.
 * @param path - Prettier's AST path, used to recurse
 *   into children and access the parent list node.
 * @param print - Prettier's recursive print callback.
 * @returns Doc IR for the formatted list item.
 */
export function printListItem(
  node: ListItemNode,
  path: PrintPath,
  print: PrintFunction,
): Doc {
  // Determine the marker character from the parent list's variant.
  // The parent is always a ListNode (items live inside lists).
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Prettier path traversal returns generic node
  const parentList = path.getParentNode() as ListNode | undefined;
  // Build the list marker string. Callout lists use `<N>` or
  // `<.>` markers; ordered use dots; unordered use asterisks.
  const marker = buildMarker(node, parentList);

  // For checklist items, insert the checkbox marker between the
  // list marker and the text. Normalize [*] to [x] (canonical).
  const checkboxPrefix = formatCheckbox(node.checkbox);

  // Continuation lines should align with the text start, which
  // is marker width + 1 space after the marker character(s),
  // plus the checkbox prefix width for checklist items.
  const markerWidth = marker.length + MARKER_OFFSET;
  const checkboxWidth =
    node.checkbox === undefined ? EMPTY : CHECKBOX_PREFIX_LEN;

  const printed = path.map(print, "children");

  // Separate inline children (text, bold, hardLineBreak, etc.)
  // from nested lists. Inline children are reflowed inside a
  // fill(); nested lists follow on their own lines.
  const inlineChildren: Doc[] = [];
  const nestedListParts: Doc[] = [];

  for (const [index, child] of node.children.entries()) {
    const { [index]: printedChild } = printed;
    if (child.type === "list") {
      // Nested list: appears on the next line after a
      // hardline break, outside the fill.
      nestedListParts.push(hardline, printedChild);
    } else {
      // Inline node: collect for fill(). flattenForFill
      // handles alignment when formatting mixes with text.
      inlineChildren.push(printedChild);
    }
  }

  const inlineParts = stripLeadingHazardBreak(flattenForFill(inlineChildren));

  // Build the output: marker + space + checkbox + aligned
  // fill of inline content, followed by any nested lists.
  const item = fill([
    marker,
    " ",
    checkboxPrefix,
    align(markerWidth + checkboxWidth, fill(inlineParts)),
  ]);

  // Blocks attached with `+` list continuations: each prints
  // as a `+` alone on its line followed by the block flush
  // left. These hardlines are outside the align() above, so
  // both the `+` and the block start at column 0 — the
  // continuation syntax requires the `+` unindented, and the
  // attached block is its own block, not part of the item's
  // reflowed principal text.
  const continuationParts: Doc[] = [];
  for (const [index, printedBlock] of path
    .map(print, "attachedBlocks")
    .entries()) {
    const previousAttached =
      index > FIRST ? node.attachedBlocks[index - NEXT] : undefined;
    if (
      previousAttached !== undefined &&
      isContinuationPassThrough(previousAttached)
    ) {
      // Block metadata (and the comment lines the reader eats)
      // stack directly above the block they precede — the whole
      // group hangs off the single `+` emitted before its first
      // piece.
      continuationParts.push(hardline, printedBlock);
    } else {
      continuationParts.push(hardline, "+", hardline, printedBlock);
    }
  }
  // A dangling `+` line (nothing after it inside the item to
  // attach) is re-emitted verbatim: Asciidoctor attaches the
  // next block to the item even across a blank line, so
  // preserving the bare `+` preserves the rendered output.
  if (node.danglingContinuation) {
    continuationParts.push(hardline, "+");
  }

  return [item, ...continuationParts, ...nestedListParts];
}
