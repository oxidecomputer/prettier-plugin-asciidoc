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
  ParentBlockNode,
} from "./ast.js";
import { MIN_DELIMITER_LENGTH, SAFE_DELIMITER_PAD } from "./constants.js";
import { paragraphBody } from "./reflow.js";
import { joinBlocks } from "./print-join.js";

const {
  builders: { hardline, join },
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
    if (node.value.length > 0) {
      return ["// ", node.value];
    }
    return "//";
  }
  // Block comment: delimiters on their own lines, content verbatim.
  // Use trim() to detect whitespace-only content: Prettier strips
  // trailing whitespace per line, so "     " would become a blank
  // line that re-parses as an empty comment, breaking idempotency.
  if (node.value.trim().length > 0) {
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
// Total fallback: in practice all masquerade variants
// carry a sourceDelimiter (case 1) or use paragraph form
// (caught before that function is called), so this table
// is never read. It invents a plausible delimiter rather
// than throwing.
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
  let maxConflict = 0;
  if (content.length > 0) {
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
    const parentChar = PARENT_DELIMITER_CHARS[node.sourceDelimiter];
    return node.sourceDelimiter === "open"
      ? parentChar.repeat(OPEN_BLOCK_DELIMITER_LENGTH)
      : computeDelimiter(node.content, parentChar);
  }
  if (node.variant in DELIMITER_CHARS) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- checked by `in` guard
    const leafChar = DELIMITER_CHARS[node.variant as LeafBlockVariant];
    return computeDelimiter(node.content, leafChar);
  }
  const masqChar =
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- remaining variants are masqueraded
    MASQUERADE_DELIMITER_CHARS[node.variant as MasqueradedVariant];
  return computeDelimiter(node.content, masqChar);
}

/**
 * Whether the reader recorded a `[source]`/`[source,lang]` annotation
 * that already covers this block's implicit source style — a FIELD
 * READ of the reader's own record (spec D5a), replacing a
 * getParentNode() cast and sibling scan that structurally could not
 * see inside list items (the measured duplicated prefix, ledger
 * family d5-fence-annotation). A fence with no language hint still
 * implies `source`, so a bare `[source]` annotation counts.
 * @param node - The delimited block to check.
 * @returns True when the annotation already covers the source
 *   attribute this block would otherwise emit.
 */
export function hasPrecedingLanguageAttribute(
  node: DelimitedBlockNode,
): boolean {
  if (node.fenced !== true && node.language === undefined) return false;
  const expectedValue =
    node.language === undefined ? "source" : `source,${node.language}`;
  return node.annotatedBy === expectedValue;
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
  // A table replays its own source lines — the delimiters are part of
  // `content` (spec D1) and no framing is added. Prettier strips
  // trailing whitespace per line, which is render-neutral: the
  // oracle's reader rstrips every line before parsing
  // (prepare_source_string); the trailing-whitespace rows in
  // tests/format/table.test.ts pin the output bytes.
  if (node.variant === "table") {
    return join(hardline, node.content.split("\n"));
  }

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
  if (node.content.trim().length > 0) {
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
  let max = 0;
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
      child.form !== "paragraph"
    ) {
      const childInner = maxDescendantDelimiter(variant, child.children);
      if (child.form === variant) {
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
  const delimChar = PARENT_DELIMITER_CHARS[node.variant];

  // Open blocks are always exactly 2 dashes — no nesting
  // concerns because there's only one possible length.
  if (node.variant === "open") {
    const delimiter = delimChar.repeat(OPEN_BLOCK_DELIMITER_LENGTH);
    if (node.children.length > 0) {
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

  if (node.children.length > 0) {
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
 * Prints an admonition node to Doc IR: the paragraph form is the
 * label plus THE paragraph body engine over its inline children (one
 * engine by construction — spec D7); a delimited form prints its
 * wrapper delimiters around the children, the delimiter variant read
 * off `form` (the old `delimiter ?? "example"` fallback left WITH the
 * field it defended).
 * @param node - The admonition AST node.
 * @param path - Prettier's AST path, for recursing into the body.
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
    if (node.text.length === 0) {
      return label.trimEnd();
    }
    return [label, paragraphBody(path.map(print, "text"))];
  }
  const delimChar = PARENT_DELIMITER_CHARS[node.form];
  const delimLength =
    node.form === "open"
      ? OPEN_BLOCK_DELIMITER_LENGTH
      : Math.max(
          MIN_DELIMITER_LENGTH,
          maxDescendantDelimiter(node.form, node.children) + SAFE_DELIMITER_PAD,
        );
  const delimiter = delimChar.repeat(delimLength);
  if (node.children.length > 0) {
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
