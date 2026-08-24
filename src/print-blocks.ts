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
import { inlineAtoms } from "./print-inline.js";
import { atomOf, blockBody, type Atom } from "./reflow.js";
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
// (----, ...., ++++). The other variants (example, sidebar, quote,
// verse) reach a delimited block only by masquerading, and then they
// print from the source delimiter the open recorded (case 1 of
// computeMasqueradeDelimiter) — so the leaf table is the whole of
// what remains past that branch.
type LeafBlockVariant = "listing" | "literal" | "pass";

// Maps each leaf-block variant to its single delimiter character.
// Used by the printer to compute the minimum safe delimiter length
// and build the output delimiter string.
const DELIMITER_CHARS: Record<LeafBlockVariant, string> = {
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
 * Two cases, and only two:
 * 1. `sourceDelimiter` is set — the block was masqueraded
 *    from a parent block, so it prints from the parent
 *    delimiter chars the open RECORDED.
 * 2. Otherwise the variant is a leaf's
 *    (listing/literal/pass) — {@link DELIMITER_CHARS}.
 *
 * There is no third case: a masquerade variant always
 * carries its `sourceDelimiter` (ast-invariants row
 * (xiii)), so the fallback table that used to invent one
 * had no reachable caller. (`table` never reaches this
 * function; `printDelimitedBlock` replays its lines first.)
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
  // Past the sourceDelimiter branch the variant is a leaf's:
  // a masquerade variant always carries sourceDelimiter — pinned on
  // every parse by ast-invariants row (xiii) — so nothing else
  // reaches here.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- masquerade variants carry sourceDelimiter (invariant xiii); only leaf variants remain
  const leafChar = DELIMITER_CHARS[node.variant as LeafBlockVariant];
  return computeDelimiter(node.content, leafChar);
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
    if (child.type !== "parentBlock" && child.type !== "admonition") continue;
    const childVariant = delimiterVariantOf(child);
    if (childVariant === undefined) continue; // paragraph-form admonition
    // Recurse regardless of variant — same-variant blocks might be
    // nested deeper; a same-variant child then needs at least the
    // minimum plus whatever its own nesting requires.
    const childInner = maxDescendantDelimiter(variant, child.children);
    max = Math.max(
      max,
      childVariant === variant
        ? Math.max(MIN_DELIMITER_LENGTH, childInner + SAFE_DELIMITER_PAD)
        : childInner,
    );
  }
  return max;
}

/**
 * The wrapper-delimiter variant one child prints with, when it prints
 * parent-style delimiters at all: a parentBlock's `variant`, a
 * delimited-form admonition's `form`. Undefined for everything else —
 * the one answer maxDescendantDelimiter's two arms used to spell
 * twice.
 * @param child - a child block
 * @returns the delimiter variant it wraps itself in, if any
 */
function delimiterVariantOf(
  child: BlockNode,
): ParentBlockNode["variant"] | undefined {
  if (child.type === "parentBlock") return child.variant;
  if (child.type === "admonition" && child.form !== "paragraph") {
    return child.form;
  }
  return undefined;
}

/**
 * THE delimited-parent printer (three near-identical bodies became
 * this one): computes the wrapper delimiter for a
 * compound block — a parentBlock or a delimited-form admonition — and
 * prints delimiter/children/delimiter. Open blocks take the fixed
 * two-dash spelling; every other variant out-lengths its deepest
 * same-variant descendant so the nesting re-parses.
 * @param variant - the wrapper's delimiter variant
 * @param node - the block being printed
 * @param path - Prettier's AST path
 * @param print - Prettier's recursive print callback
 * @returns Doc IR for the wrapped block
 */
function printDelimitedParent(
  variant: ParentBlockNode["variant"],
  node: ParentBlockNode | AdmonitionNode,
  path: PrintPath,
  print: PrintFunction,
): Doc {
  const delimChar = PARENT_DELIMITER_CHARS[variant];
  const delimLength =
    variant === "open"
      ? OPEN_BLOCK_DELIMITER_LENGTH
      : Math.max(
          MIN_DELIMITER_LENGTH,
          maxDescendantDelimiter(variant, node.children) + SAFE_DELIMITER_PAD,
        );
  const delimiter = delimChar.repeat(delimLength);
  if (node.children.length === 0) {
    return [delimiter, hardline, delimiter];
  }
  const children = path.map(print, "children");
  return [
    delimiter,
    hardline,
    joinBlocks(node.children, children),
    hardline,
    delimiter,
  ];
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
 * @returns Doc IR for the formatted parent block.
 */
export function printParentBlock(
  node: ParentBlockNode,
  path: PrintPath,
  print: PrintFunction,
): Doc {
  return printDelimitedParent(node.variant, node, path, print);
}

/**
 * Prints an admonition node to Doc IR: the paragraph form is the
 * label plus THE paragraph body engine over its inline children (one
 * engine by construction — spec D7); a delimited form goes through
 * {@link printDelimitedParent}, THE wrapper printer, with the
 * delimiter variant read off `form` (the old `delimiter ?? "example"`
 * fallback left WITH the field it defended).
 * @param node - The admonition AST node.
 * @param path - Prettier's AST path, for recursing into the body.
 * @param print - Prettier's recursive print callback.
 * @param printWidth - the column budget for a whole output line.
 * @returns Doc IR for the formatted admonition.
 */
export function printAdmonition(
  node: AdmonitionNode,
  path: PrintPath,
  print: PrintFunction,
  printWidth: number,
): Doc {
  if (node.form === "paragraph") {
    const label = `${node.variant.toUpperCase()}:`;
    if (node.text.length === 0) {
      return label;
    }
    // The label is an atom of the body, not a prefix in front of it:
    // it occupies its columns of the first output line, and the packer
    // must measure them. The join after it is the syntax's own space,
    // which may never become a break.
    const body = inlineAtoms(node.text, node.position.start.line);
    // Text nodes that are all whitespace produce no atoms, so a text
    // array with children can still yield none — and then the label is
    // the whole line, exactly as it is for an admonition with no text.
    if (body.length === 0) {
      return label;
    }
    const atoms: Atom[] = [
      atomOf(label),
      { ...body[0], glueLeft: false, noBreakBefore: true },
      ...body.slice(1),
    ];
    return blockBody(atoms, printWidth, 0);
  }
  return printDelimitedParent(node.form, node, path, print);
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
