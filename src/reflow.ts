/**
 * Paragraph reflow utilities — ensures fill() wraps text
 * correctly when inline formatting is present.
 *
 * Two concerns are handled:
 *
 * 1. **Block-syntax safety** (`wordsToFillParts`): prevents
 *    fill() from placing words at column 0 where AsciiDoc
 *    would re-parse them as block syntax (titles, delimiters,
 *    list markers, etc.). Patterns mirror the line-start
 *    tokens in src/parse/tokens.ts.
 *
 * 2. **Fill alignment** (`flattenForFill`): when inline
 *    formatting nodes (italic, bold, xref, ...) are embedded
 *    in a paragraph, a naive `.flat()` can break the
 *    content/separator alternation that fill() expects.
 *    flattenForFill detects adjacent content elements and
 *    fuses them, maintaining the fill() protocol.
 */
import { doc, type Doc } from "prettier";
import { EMPTY, LAST_ELEMENT, MIN_DELIMITER_LENGTH } from "./constants.js";

const {
  builders: { line, literalline },
} = doc;

// ── Pattern constants ──────────────────────────────────────

// Characters that form block delimiters when repeated. A word
// consisting entirely of one of these (e.g. `====`, `****`,
// `----`, `++++`, `////`, `____`, `'''`, `<<<`, `--`)
// would be re-parsed as block syntax at column 0.
const DELIMITER_CHARS = new Set(".=*-+/'<_");

// Subset of delimiter chars whose lexer patterns do NOT
// require end-of-line, so `====text` is consumed as a block
// open token + the remaining line text. The threshold for each char
// in this set is MIN_DELIMITER_LENGTH. (Fenced code backticks
// use a shorter prefix and are handled separately.)
const PREFIX_DELIMITER_CHARS = new Set(".-+=*/");

// Specific block constructs not covered by delimiter logic.
const BLOCK_TITLE = /^\.[^ .]/v;
const FENCED_CODE_PREFIX = "```";
const SPECIFIC_PATTERNS = [
  /^<(?:\d+|\.)>$/v, // callout list marker: <1>, <.>
  /^:[!]?[A-Za-z_][\w\-]*[!]?:$/v, // attribute entry: :name:
  /^(?:NOTE|TIP|IMPORTANT|CAUTION|WARNING):$/v, // admonition
  /^\[[^\]]*\]$/v, // block attribute list: [source]
];

// ── Detection ──────────────────────────────────────────────

/**
 * Detect words that would become AsciiDoc block syntax
 * if fill() placed them at column 0. Such words must be
 * glued to their predecessor in wordsToFillParts.
 * @param word - A single non-empty whitespace-delimited token
 *   from the paragraph text, as produced by String.split on
 *   whitespace. Callers guarantee it contains no whitespace.
 * @returns True when the word matches block syntax
 */
function isBlockSyntaxAtLineStart(word: string): boolean {
  // Block title: .Title, .gitignore
  if (BLOCK_TITLE.test(word)) {
    return true;
  }

  // Fenced code block: ```lang
  if (word.startsWith(FENCED_CODE_PREFIX)) {
    return true;
  }

  // Callers guarantee `word` is non-empty, so `first` is
  // always a string (never undefined).
  const [first] = word;
  // Pure delimiter-char word: every character is the same
  // delimiter char. Covers section markers (==), list markers
  // (* - .), block delimiters (---- ****), thematic/page
  // breaks (''' <<<), open block (--), quote block (____).
  // Exception: single `+` is a list continuation only when
  // alone on a line; `+ text` at line start is safe.
  // Multi-char `++++` (passthrough delimiter) IS dangerous.
  if (
    DELIMITER_CHARS.has(first) &&
    isRepeatedChar(word, first) &&
    word !== "+"
  ) {
    return true;
  }

  // Delimiter prefix + text: the lexer greedily matches
  // leading delimiter chars and enters a verbatim mode.
  if (
    PREFIX_DELIMITER_CHARS.has(first) &&
    // Strict `>`: a word of exactly MIN_DELIMITER_LENGTH
    // identical chars (e.g. "----") is already caught by the
    // isRepeatedChar branch above.
    word.length > MIN_DELIMITER_LENGTH &&
    word.startsWith(first.repeat(MIN_DELIMITER_LENGTH))
  ) {
    return true;
  }

  // Remaining specific patterns (callout, attribute entry,
  // admonition, block attribute list).
  return SPECIFIC_PATTERNS.some((pattern) => pattern.test(word));
}

/**
 * Check whether every character in a word is the same
 * character. Used to detect pure delimiter words like
 * `====` or `----`.
 * @param word - The word to test; must be non-empty.
 * @param char - The single character expected at every
 *   position. Callers always pass `word[0]`, so the function
 *   checks uniformity rather than independently choosing the
 *   expected character.
 * @returns True when all characters match `char`
 */
function isRepeatedChar(word: string, char: string): boolean {
  for (const ch of word) {
    if (ch !== char) {
      return false;
    }
  }
  return true;
}

/**
 * Detect words that would become AsciiDoc syntax when
 * placed at end of a line (before a fill() break). Such
 * words are glued to their successor so fill() breaks
 * before the word rather than after it.
 * @param word - A single non-empty whitespace-delimited token
 *   from the paragraph text.
 * @returns True when placing this word at line end would
 *   produce AsciiDoc syntax in the reflowed output
 */
function isDangerousAtLineEnd(word: string): boolean {
  // A bare `+` preceded by a space (from fill() joining)
  // would become ` +\n` — a hard line break.
  return word === "+";
}

// ── Public API ─────────────────────────────────────────────

/**
 * Append a content group to a fill parts array, preceded by a
 * `line` separator unless it is the first group. Maintains the
 * content/separator alternation that fill() requires.
 * @param parts - The fill parts array being built (mutated).
 * @param content - The content group to append.
 */
function pushGroup(parts: Doc[], content: Doc): void {
  if (parts.length > EMPTY) {
    parts.push(line);
  }
  parts.push(content);
}

/**
 * Escape a dangling `+` pending group. A `+` that ends the
 * word list has no successor to glue to, so it will always
 * appear at end of an output line, where AsciiDoc would
 * re-parse ` +\n` as a hard line break (or a lone `+` line as
 * a list continuation). The replacement is the `{plus}`
 * built-in attribute reference, which renders as `+` —
 * backslash is NOT a recognized escape for `+` in Asciidoctor
 * (` \+` renders a literal backslash), so the previously used
 * `\+` changed the rendered text.
 * @param pending - The final pending content group (may be
 *   undefined when the word list was empty).
 * @param escape - Whether escaping is enabled for this text
 *   (disabled when a sibling follows in the same fill, or
 *   inside a formatting span whose closing mark follows the
 *   word in the output).
 * @returns The pending group, with a bare trailing `+`
 *   rewritten to `{plus}` when escaping applies.
 */
function escapeDanglingPlus(
  pending: Doc | undefined,
  escape: boolean,
): Doc | undefined {
  return escape && pending === "+" ? "{plus}" : pending;
}

/**
 * Convert a word list into a Doc array for fill().
 * Words are interleaved with `line` so fill() can break
 * between them. Two safety mechanisms prevent reflow
 * from creating syntax:
 * 1. Words dangerous at line START are glued to their
 *    predecessor so fill() breaks before the pair.
 * 2. Words dangerous at line END (`+`) are glued to
 *    their successor so fill() breaks before them.
 * @param words - Array of whitespace-delimited tokens already
 *   split from the paragraph text. Each element is non-empty
 *   and contains no whitespace. The array itself may be empty,
 *   in which case an empty Doc array is returned.
 * @param options - Reflow safety switches.
 * @param options.escapeTrailingPlus - Whether a `+` with no
 *   successor word should be rewritten to `{plus}`. True for
 *   text that truly ends its enclosing fill(), where the word
 *   could land at the end of an output line and be re-parsed
 *   as a hard line break or list continuation. False when an
 *   inline sibling follows (the printer glues the `+` forward
 *   instead) or inside a formatting span (`` `+` ``): the
 *   closing mark follows the word in the output, so it can
 *   never end a line bare — and rewriting it would corrupt
 *   the span's content.
 * @returns Doc array suitable for Prettier's fill()
 */
export function wordsToFillParts(
  words: string[],
  options?: { escapeTrailingPlus: boolean },
): Doc[] {
  const escapeTrailingPlus = options?.escapeTrailingPlus ?? true;
  const parts: Doc[] = [];
  // Pending content group: accumulates words that must stay
  // on the same line. Flushed when the next word is safe.
  let pending: Doc | undefined = undefined;
  // When true, the next word must be glued to pending
  // (because pending ends with a line-end-dangerous word).
  let glueNext = false;
  for (const word of words) {
    if (pending === undefined) {
      // First word — nothing to merge with yet.
      pending = word;
    } else if (glueNext || isBlockSyntaxAtLineStart(word)) {
      // Merge with pending: either the previous word is
      // dangerous at line end, or this word is dangerous
      // at line start.
      pending = [pending, " ", word];
      glueNext = false;
    } else {
      // Safe word: flush the pending group and start new.
      pushGroup(parts, pending);
      pending = word;
    }
    // If this word is dangerous at line end, the *next*
    // word must be glued to it.
    if (isDangerousAtLineEnd(word)) {
      glueNext = true;
    }
  }
  // If the last word was dangerous at line end and had no
  // successor to glue to, escape it (see escapeDanglingPlus).
  pending = escapeDanglingPlus(pending, escapeTrailingPlus);
  // Flush the last pending group.
  if (pending !== undefined) {
    pushGroup(parts, pending);
  }

  return parts;
}

// ── Fill alignment ─────────────────────────────────────────

// Prettier's `line` and `literalline` are the only
// separator-type Docs used in fill() arrays by this
// plugin. Checking reference identity (===) is safe
// because these are module-level singletons exported from
// Prettier's doc.builders.

/**
 * Check whether a Doc element is a line-type separator
 * (Prettier's `line` or `literalline`). Used by
 * flattenForFill to distinguish fill-content elements from
 * fill-separator elements.
 * @param element - A Doc element from the fill parts array.
 * @returns True when the element is a line separator
 */
function isLineSeparator(element: Doc): boolean {
  return element === line || element === literalline;
}

/**
 * Flatten an array of child Doc outputs into a single
 * fill()-compatible array, preserving the content/separator
 * alternation that fill() requires.
 *
 * Prettier's fill() expects `[content, sep, content, ...]`
 * where even-indexed elements are content and odd-indexed
 * are separators (`line`). A naive `.flat()` breaks this
 * invariant when inline formatting nodes (italic, bold,
 * xref, etc.) contribute elements to the array without
 * a `line` separator at the junction with adjacent text.
 *
 * For example, `_Nexus_,` produces three children whose
 * flattened parts look like:
 *   `[..., "and", line, "_Nexus_", ",", line, "the", ...]`
 * The comma at index 3 is in a separator position but is
 * really content. This function detects adjacent content
 * elements (neither is a `line` separator) and fuses them
 * into a single content unit, fixing the alignment.
 * @param children - Array of Doc values returned by
 *   `path.map(print, "children")`, one per child node.
 *   Each may be an array of fill parts (text, formatting)
 *   or a single atomic Doc (xref string, etc.).
 * @returns Flat Doc array suitable for fill(), with
 *   content and separator elements properly alternating
 */
export function flattenForFill(children: Doc[]): Doc[] {
  const result: Doc[] = [];

  for (const child of children) {
    // Spread one level (equivalent to .flat()): array
    // children contribute their individual elements;
    // non-array Docs (strings, Doc commands) contribute
    // a single element.
    const elements: Doc[] = Array.isArray(child) ? (child as Doc[]) : [child];

    for (const element of elements) {
      if (
        result.length > EMPTY &&
        !isLineSeparator(result[result.length + LAST_ELEMENT]) &&
        !isLineSeparator(element)
      ) {
        // Two adjacent content elements with no separator
        // between them: fuse into one content unit so
        // fill() keeps them together and measures their
        // combined width correctly.
        const lastIndex = result.length + LAST_ELEMENT;
        result[lastIndex] = [result[lastIndex], element];
      } else {
        result.push(element);
      }
    }
  }

  return result;
}
