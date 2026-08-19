/**
 * Pure extraction logic for deriving a conformance corpus from
 * Asciidoctor's Ruby test files (issue #7). Only single-quoted
 * squiggly heredocs (`<<~'EOS'`) are extracted: Ruby gives those
 * literal bodies with no escape processing or interpolation, so a
 * line scanner recovers the exact bytes the Ruby test used. This
 * covers 1,485 of the 1,641 heredocs at the pinned commit.
 *
 * Kept free of I/O so it is unit-testable; scripts/vendor.ts wires
 * it to the filesystem.
 */

/** One corpus input plus the stable ID the quarantine manifest keys on. */
export interface CorpusCase {
  /**
   * Stable identifier: `<file>#<test name>#<n>` where `n` is the
   * heredoc's 0-based index within its test. Duplicate test names in
   * a file get `~2`, `~3`, ... appended so IDs stay unique.
   */
  id: string;
  /** Exact heredoc body after dedent, always newline-terminated. */
  input: string;
}

// Matches minitest's `test 'name' do` lines. Greedy `.*` plus the
// trailing `' do` anchor tolerates apostrophes inside the name.
const TEST_LINE = /^\s*test '(?<name>.*)' do\b/v;

// Matches the opening of a single-quoted squiggly heredoc anywhere in
// a line, e.g. `input = <<~'EOS'`. Double-quoted heredocs (escape
// sequences, interpolation) intentionally do not match.
const HEREDOC_OPEN = /<<~'(?<delim>[A-Z][A-Z0-9_]*)'/v;

const ZERO = 0;
const ONE = 1;
const HEX_RADIX = 16;

/**
 * Strips the common indentation margin the way Ruby's `<<~` does,
 * approximated as the minimum number of leading spaces across
 * non-empty lines. Lines that are empty (or whitespace-only) don't
 * count toward the margin and dedent to empty, matching Ruby.
 * @param lines - raw body lines as they appear in the Ruby source
 * @returns the dedented lines
 */
function dedent(lines: string[]): string[] {
  const margins = lines
    .filter((line) => line.trim() !== "")
    .map((line) => /^(?<indent> *)/v.exec(line)?.groups?.indent.length ?? ZERO);
  const margin = margins.length > ZERO ? Math.min(...margins) : ZERO;
  return lines.map((line) => (line.trim() === "" ? "" : line.slice(margin)));
}

/**
 * Collects a heredoc body starting from startIndex until the delimiter
 * is found. Returns the body lines and the index after the delimiter.
 * @param lines - all source lines
 * @param startIndex - index of first body line
 * @param delim - heredoc terminator
 * @returns tuple of [body lines, index after delimiter]
 */
function collectHeredocBody(
  lines: string[],
  startIndex: number,
  delim: string,
): [string[], number] {
  const body: string[] = [];
  let index = startIndex;
  while (index < lines.length && (lines[index] ?? "").trim() !== delim) {
    body.push(lines[index] ?? "");
    index += ONE;
  }
  return [body, index];
}

/**
 * Extracts every single-quoted squiggly heredoc from one Ruby test
 * file, attributing each to its enclosing `test '...' do` block so
 * the resulting IDs survive upstream line-number churn.
 * @param rubySource - full text of the Ruby test file
 * @param fileName - basename used as the ID prefix, e.g.
 *   `lists_test.rb`
 * @returns cases in source order; empty if the file has no matching
 *   heredocs
 */
// eslint-disable-next-line complexity -- parsing algorithm requires multiple branches
export function extractCorpusCases(
  rubySource: string,
  fileName: string,
): CorpusCase[] {
  const lines = rubySource.split("\n");
  const cases: CorpusCase[] = [];
  let testName = "(outside test)";
  let heredocIndex = ZERO;
  const nameCounts = new Map<string, number>();

  for (let lineIndex = ZERO; lineIndex < lines.length; lineIndex += ONE) {
    const line = lines[lineIndex] ?? "";
    const testMatch = TEST_LINE.exec(line);
    const testNameFromMatch = testMatch?.groups?.name;
    if (testNameFromMatch === undefined) {
      const openMatch = HEREDOC_OPEN.exec(line);
      const delimFromMatch = openMatch?.groups?.delim;
      if (delimFromMatch === undefined) continue;
      const [body, nextIndex] = collectHeredocBody(
        lines,
        lineIndex + ONE,
        delimFromMatch,
      );
      if (nextIndex < lines.length) {
        cases.push({
          id: `${fileName}#${testName}#${String(heredocIndex)}`,
          input: `${dedent(body).join("\n")}\n`,
        });
        // Index only heredocs that produced a case: an unterminated
        // heredoc emits nothing, so it must not consume an ID slot.
        heredocIndex += ONE;
      }
      lineIndex = nextIndex;
      continue;
    }
    const count = (nameCounts.get(testNameFromMatch) ?? ZERO) + ONE;
    nameCounts.set(testNameFromMatch, count);
    testName =
      count > ONE ? `${testNameFromMatch}~${String(count)}` : testNameFromMatch;
    heredocIndex = ZERO;
  }
  return cases;
}

/**
 * Serializes corpus cases as JSONL (one JSON object per line). JSON
 * string escaping is what makes the corpus safe to check in: trailing
 * spaces, missing final newlines, and control characters survive
 * editors and git untouched — properties a formatter corpus must
 * preserve byte-exactly. Non-ASCII characters are additionally
 * \u-escaped so the emitted files are pure ASCII: a UTF-8 BOM in a
 * fixture shows up as a reviewable backslash-u-feff escape instead of
 * an invisible byte, and no tool in the chain can misdecode the
 * corpus.
 * @param cases - cases to serialize, already in stable order
 * @returns JSONL text with a trailing newline, or an empty string for
 *   an empty corpus
 */
export function serializeCorpus(cases: CorpusCase[]): string {
  if (cases.length === ZERO) return "";
  return `${cases.map((c) => asciiOnly(JSON.stringify(c))).join("\n")}\n`;
}

// First code point outside printable ASCII's UTF-16 range.
const NON_ASCII_START = 0x80;
const ESCAPE_WIDTH = 4;

/**
 * Escapes every non-ASCII UTF-16 code unit as `\uXXXX`. Iterating
 * code units (not code points) escapes astral characters as their
 * surrogate pair halves — exactly the form JSON.parse reassembles —
 * so round-tripping stays exact for emoji and the like while the
 * emitted file stays pure ASCII.
 * @param json - a JSON-encoded line (already string-escaped by
 *   JSON.stringify, so every remaining non-ASCII char is literal)
 * @returns the same JSON with all non-ASCII code units \u-escaped
 */
function asciiOnly(json: string): string {
  let out = "";
  for (let charIndex = ZERO; charIndex < json.length; charIndex += ONE) {
    // We intentionally use charCodeAt (code units) not codePointAt (code
    // points) to escape astral characters as surrogate pairs, the exact
    // form JSON.parse reassembles.
    // eslint-disable-next-line unicorn/prefer-code-point -- see comment
    const unit = json.charCodeAt(charIndex);
    out +=
      unit < NON_ASCII_START
        ? (json[charIndex] ?? "")
        : String.raw`\u${unit.toString(HEX_RADIX).padStart(ESCAPE_WIDTH, "0")}`;
  }
  return out;
}
