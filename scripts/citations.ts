/**
 * Reading citations out of this repository's comments, and checking
 * them against the sources they name.
 *
 * The comments in `src`, `tests` and `scripts` cite two authorities:
 * Asciidoctor's Ruby (the design spec, vendored at
 * `vendor/asciidoctor-ruby/`) and the oracle the tests actually measure
 * against (`@asciidoctor/core`'s `build/node/index.cjs` and the
 * `src/*.js` it is bundled from). A citation is a claim about a file
 * and a line, and both halves rot: lines move when the pin is bumped,
 * and names get mistyped or invented. One week of adversarial review
 * caught three citations that named the wrong lines or a method that
 * does not exist in 2.0.26 at all: a class of error nobody can catch
 * by reading, and a mechanical check catches for free.
 *
 * This module is the pure half: the grammar that turns comment prose
 * into citations, and the two checks that can fail one. The command
 * line lives in `scripts/citation-check.ts`.
 *
 * WHAT THE CHECKS PROVE. The range check proves the cited line exists
 * in the cited file; it catches a pin bump that moved the code and a
 * transposed digit. The identifier check proves the cited line is
 * about what the comment says it is about: the comment's names
 * (`read_lines_for_list_item`, `QUOTE_SUBS`, `ExtAtxSectionTitleRx`)
 * have to appear within a few lines of what it points at. Neither
 * proves the comment's READING of the code is right; they prove it is
 * pointing somewhere that mentions what it is talking about.
 *
 * WHAT THEY CANNOT REACH is a bare line reference whose comment never
 * says what file it is about. Those are counted and reported rather
 * than guessed at ({@link FileScan}'s `contextless`), because the one
 * outcome worse than an unchecked citation is a citation checked
 * against the wrong file and passing.
 */
import ts from "typescript";

/** How many lines either side of a cited range an identifier may sit. */
export const IDENTIFIER_WINDOW = 5;

/** Where the Asciidoctor Ruby sources are vendored, from the repo root. */
export const RUBY_DIRECTORY = "vendor/asciidoctor-ruby";

/** Where the oracle package sits once `bun install` has run. */
export const ORACLE_DIRECTORY = "node_modules/@asciidoctor/core";

/**
 * The Ruby files a comment may cite. Exactly the six that are
 * vendored: a citation of any other Ruby file cannot be checked
 * offline, so the grammar does not pretend to know it.
 */
export const RUBY_FILES = [
  "asciidoctor.rb",
  "attribute_list.rb",
  "parser.rb",
  "reader.rb",
  "rx.rb",
  "substitutors.rb",
] as const;

/**
 * The oracle's own files a comment may cite, keyed by the basename the
 * comments spell, valued by their path inside the package.
 *
 * Two layers, and the comments cite both. `index.cjs` is the BUILD -
 * the single bundled file every render assertion actually executes -
 * and `src/*.js` are the sources it is bundled from, which is where a
 * reader goes to see the transpiled logic laid out. Only the files
 * this repository's comments actually name are here; a citation of any
 * other is a name the grammar does not know.
 */
export const ORACLE_FILES: ReadonlyMap<string, string> = new Map([
  ["index.cjs", "build/node/index.cjs"],
  ["attribute_list.js", "src/attribute_list.js"],
  ["helpers.js", "src/helpers.js"],
  ["parser.js", "src/parser.js"],
  ["reader.js", "src/reader.js"],
  ["rx.js", "src/rx.js"],
  ["substitutors.js", "src/substitutors.js"],
]);

/** A resolved, inclusive, 1-based line range in a cited file. */
export interface CitedRange {
  /** First line of the range. */
  start: number;
  /** Last line of the range; equal to `start` for a single line. */
  end: number;
}

/** One citation, resolved out of one comment. */
export interface Citation {
  /** The cited file's basename, as the grammar recognizes it. */
  file: string;
  /** Every line range the citation names, in the order written. */
  ranges: CitedRange[];
  /** The matched text, for a failure message to quote back. */
  spelling: string;
  /** Path of the citing file, relative to the repository root. */
  source: string;
  /** Line in the citing file the citation sits on. */
  line: number;
  /** The whole citing comment, one line, for identifier extraction. */
  comment: string;
}

// A line reference the checker could not turn into a citation: either
// its spec did not parse, or no file name in its comment says what file
// it is about. Not exported: it is reachable through {@link FileScan},
// and nothing outside needs to name the type to read the three fields.
interface UnparsedCitation {
  /** Path of the citing file, relative to the repository root. */
  source: string;
  /** Line in the citing file it sits on. */
  line: number;
  /** What was written there, truncated. */
  spelling: string;
}

/** Everything one file's comments said about the cited sources. */
export interface FileScan {
  /** Citations the grammar read. */
  citations: Citation[];
  /** Line specs it could not read. These FAIL the gate. */
  unparsed: UnparsedCitation[];
  /**
   * Bare line references whose comment names no file. Reported and
   * counted, never failed: the reference is real and unverifiable, and
   * dropping it silently is what this field exists to prevent.
   */
  contextless: UnparsedCitation[];
}

// The grammar, built from the spellings that are actually in the tree.
// A citation is a lead - `:`, `l.` or `line ` - followed by a line
// spec, and the file it is about comes either from the name written
// immediately in front of the lead or from the last such name earlier
// in the SAME comment. The house style names the file once and then
// writes bare `l.1483` / `:1549` for every further reference, which is
// the inference a human reader makes without noticing; the grammar has
// to make it too, or two out of five references go unchecked.
const FILE_ALTERNATION = [...RUBY_FILES, ...ORACLE_FILES.keys()]
  // Longest first: `attribute_list.js` must not be read as the shorter
  // `attribute_list` of `attribute_list.rb` failing and then matching
  // nothing at all.
  .toSorted((left, right) => right.length - left.length)
  .map((name) => name.replaceAll(".", String.raw`\.`))
  .join("|");
// What may sit between a file name and its lead: a closing backtick, up
// to two spaces, an opening parenthesis. Two spaces because a JSDoc
// continuation line indented past its ` * ` arrives with the extra
// indent and the flattening join adds one more.
const GAP = String.raw`\x60?[ ]{0,2}\(?`;
// `line ` and `lines ` are spelled out in prose often enough to be
// worth reading rather than dropping: `parser.rb line 1404` claims
// exactly what `parser.rb l.1404` claims.
const LEAD = String.raw`(?::|l\.|lines?[ ])`;
// A BARE lead carries no file name, so the character in front of it
// must not be one that would make it part of a word, a decimal, a path
// or another file's `name.ts:120` reference.
const NOT_A_NAME = String.raw`(?<![A-Za-z\d._\/\-])`;
// One part of a line spec: a line, or a range whose end may be
// abbreviated to its differing digits (`l.2770-71` is 2770-2771). The
// range separator is matched LOOSELY - an en dash, an em dash, a space
// either side - and then rejected by {@link parseLineSpec}, because
// the alternative is worse: a spec matched strictly stops at the first
// character it does not like and silently reads `l.1404–1592` as line
// 1404 alone. A citation the grammar half-reads is the failure this
// whole check exists to prevent. The bare comma continuation
// (`parser.rb:1404, 1592`) is loose-matched for the same reason.
const PART = String.raw`\d+(?:[ ]?[\-–—][ ]?\d+)?`;
// Parts are joined by `/`, by `/l.`, by ` and l.`, or by a bare comma -
// all four are in the tree, and all four mean "and also". The comma
// wants THREE digits after it, which is what separates
// `l.1412-14, 1439` from `parser.rb:874, 26 lines below`: every line a
// comment continues onto is deep in a file, and no prose number that
// large follows a citation.
const COMMA_JOINER = String.raw`,[ ]?(?=\d{3})`;
const SPEC = String.raw`${PART}(?:(?:/l?\.?|[ ]and[ ]l\.|${COMMA_JOINER})${PART})*`;
// A file-led lead first, so that a scan finds `parser.rb l.1404` whole
// rather than finding the bare `l.1404` inside it.
const CITATION_LEAD = new RegExp(
  String.raw`(?<file>${FILE_ALTERNATION})${GAP}${LEAD}|${NOT_A_NAME}${LEAD}(?=\d\d)`,
  "gv",
);
const CITATION_SPEC = new RegExp(String.raw`^${SPEC}`, "v");
// What a part must look like once it has been matched: ASCII digits,
// one ASCII hyphen, no spaces.
const STRICT_PART = /^(?<start>\d+)(?:-(?<end>\d+))?$/v;
// Where one part ends and the next begins.
const SPEC_JOINER = /\/l?\.?|[ ]and[ ]l\.|,[ ]?/v;
// Every recognized file name, wherever it appears, so that a bare lead
// can be resolved against the last one written before it.
const FILE_MENTION = new RegExp(String.raw`(?:${FILE_ALTERNATION})`, "gv");

const DECIMAL = 10;

/**
 * Resolve one line spec into ranges.
 *
 * Exported for the grammar's table tests: the spec is where every
 * spelling in the tree converges, and its abbreviated-end rule
 * (`l.1443-48` means 1443-1448) is the part most likely to be read
 * wrong by a future reader.
 * @param spec - the text after the lead, e.g. `1443-48` or `754/764`
 * @returns the ranges, or `undefined` if any part is not a real range
 */
export function parseLineSpec(spec: string): CitedRange[] | undefined {
  const ranges: CitedRange[] = [];
  for (const text of spec.split(SPEC_JOINER)) {
    const range = parsePart(text);
    if (range === undefined) return undefined;
    ranges.push(range);
  }
  return ranges.length === 0 ? undefined : ranges;
}

/**
 * Resolve one part of a line spec: a line, or a range.
 * @param text - the part, exactly as written
 * @returns the range, or `undefined` if the part is not one
 */
function parsePart(text: string): CitedRange | undefined {
  const groups = STRICT_PART.exec(text)?.groups;
  const startText = groups?.start;
  if (startText === undefined) return undefined;
  const start = Number.parseInt(startText, DECIMAL);
  if (start === 0) return undefined;
  const endText = groups?.end;
  if (endText === undefined) return { start, end: start };
  const end = expandRangeEnd(startText, endText);
  return end === undefined ? undefined : { start, end };
}

/**
 * Expand an abbreviated range end against its start.
 *
 * `l.2770-71` and `l.1443-48` are both in the tree: the end drops the
 * digits it shares with the start. Written out in full the end is
 * simply itself, so the rule is "if it is smaller than the start,
 * graft it onto the start's leading digits".
 *
 * A ONE-DIGIT abbreviation is refused. Every abbreviation in the tree
 * drops down to two digits, and `l.10-9` is far likelier to be a
 * reversed range somebody mistyped than a request for lines 10 to 19 -
 * grafting it would silently widen the identifier window ninefold.
 * @param startText - the start, exactly as written
 * @param endText - the end, exactly as written
 * @returns the resolved end line, or `undefined` if it cannot be one
 */
function expandRangeEnd(
  startText: string,
  endText: string,
): number | undefined {
  const start = Number.parseInt(startText, DECIMAL);
  const written = Number.parseInt(endText, DECIMAL);
  if (written >= start) return written;
  if (endText.length < SHORTEST_ABBREVIATION) return undefined;
  if (endText.length >= startText.length) return undefined;
  const prefix = startText.slice(0, startText.length - endText.length);
  const grafted = Number.parseInt(`${prefix}${endText}`, DECIMAL);
  return grafted > start ? grafted : undefined;
}

/** How few digits an abbreviated range end may drop to. */
const SHORTEST_ABBREVIATION = 2;

// A comment line's own furniture, stripped before the prose is read so
// that a citation wrapped across two lines reads as one string.
const COMMENT_FURNITURE = /^[ \t]*(?:\/\*\*?|\*\/|\*|\/\/)[ \t]?/v;
const COMMENT_TAIL = /[ \t]*\*\/[ \t]*$/v;

/** One comment, flattened to a single line with its provenance kept. */
interface FlatComment {
  /** The comment's text, line breaks replaced by single spaces. */
  text: string;
  /** For each character of `text`, the source line it came from. */
  lineAt: number[];
}

/**
 * Flatten one comment range into a single line, remembering which
 * source line each character came from.
 *
 * Citations wrap: `parser.rb` at the end of one comment line and
 * `:1499` at the start of the next is one citation, and a scanner that
 * reads comment lines separately sees neither. Flattening first means
 * the grammar never has to know about line breaks, and the kept
 * provenance still lets a failure name the line a human has to open.
 *
 * A continuation line's own indentation goes with the furniture. The
 * marker strip takes exactly one space after ` * `, so a line indented
 * further - a JSDoc list item, a wrapped `@param` - would otherwise
 * arrive with the extra spaces intact and put an arbitrary gap in the
 * middle of a citation the line break split.
 * @param body - the comment's source text, markers included
 * @param startLine - the 1-based line the comment starts on
 * @returns the flattened text and its per-character line numbers
 */
function flatten(body: string, startLine: number): FlatComment {
  const pieces: string[] = [];
  const lineAt: number[] = [];
  for (const [index, raw] of body.split("\n").entries()) {
    const stripped = raw
      .replace(COMMENT_FURNITURE, "")
      .replace(COMMENT_TAIL, "");
    const piece = index === 0 ? stripped : ` ${stripped.trimStart()}`;
    pieces.push(piece);
    lineAt.push(
      ...Array.from({ length: piece.length }, () => startLine + index),
    );
  }
  return { text: pieces.join(""), lineAt };
}

/**
 * Every comment in a TypeScript file, flattened, with adjacent `//`
 * lines merged into one.
 *
 * Comments are read as the PARSER's trivia rather than by regex: a
 * standalone scanner cannot tell `/` as division from `/` opening a
 * regular expression, and one wrong guess swallows the rest of the
 * file. Adjacent single-line comments merge because a citation and the
 * name that anchors it routinely sit on neighbouring `//` lines.
 * @param path - the file's path, for the parser's diagnostics
 * @param text - the file's contents
 * @returns one flattened entry per logical comment, in source order
 */
function comments(path: string, text: string): FlatComment[] {
  const parsed = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const found: FlatComment[] = [];
  const seen = new Set<number>();
  let previousEnd = -1;
  let previousWasLine = false;
  const take = (ranges: ts.CommentRange[] | undefined): void => {
    for (const range of ranges ?? []) {
      if (seen.has(range.pos)) continue;
      seen.add(range.pos);
      const startLine =
        parsed.getLineAndCharacterOfPosition(range.pos).line + 1;
      const flat = flatten(text.slice(range.pos, range.end), startLine);
      const isLine = range.kind === ts.SyntaxKind.SingleLineCommentTrivia;
      const previous = found.at(-1);
      const adjacent =
        previousEnd >= 0 &&
        /^\s*\n\s*$/v.test(text.slice(previousEnd, range.pos));
      if (isLine && previousWasLine && previous !== undefined && adjacent) {
        previous.text += ` ${flat.text}`;
        previous.lineAt.push(startLine, ...flat.lineAt);
      } else {
        found.push(flat);
      }
      previousEnd = range.end;
      previousWasLine = isLine;
    }
  };
  eachToken(parsed, (token) => {
    take(ts.getLeadingCommentRanges(text, token.getFullStart()));
    take(ts.getTrailingCommentRanges(text, token.getEnd()));
  });
  return found;
}

/**
 * Visit every leaf token of a parsed file, the end-of-file token
 * included; its leading trivia is where a file's last comment lives.
 * @param node - the node to walk
 * @param visit - called once per leaf token
 */
function eachToken(node: ts.Node, visit: (token: ts.Node) => void): void {
  // A JSDoc node is one of its owner's children, and its text is
  // already reported as the owner's leading trivia. Walking in would
  // read it twice.
  if (
    node.kind >= ts.SyntaxKind.FirstJSDocNode &&
    node.kind <= ts.SyntaxKind.LastJSDocNode
  ) {
    return;
  }
  const children = node.getChildren();
  if (children.length === 0) visit(node);
  else for (const child of children) eachToken(child, visit);
}

/**
 * Read every citation out of one file's comments.
 *
 * Exported for the grammar's table tests, which feed it the spellings
 * the tree actually uses rather than invented ones.
 * @param path - the file's path relative to the repository root
 * @param text - the file's contents
 * @returns the citations it read and the ones it could not
 */
export function findCitations(path: string, text: string): FileScan {
  const scan: FileScan = { citations: [], unparsed: [], contextless: [] };
  for (const comment of comments(path, text)) {
    const mentions = [...comment.text.matchAll(FILE_MENTION)];
    // A spec can contain further leads - `l.1430 and l.1519` has one
    // inside it - and the match iterator resumes at the end of the
    // LEAD, not of the spec. Without this the inner lead is read a
    // second time as a citation of its own.
    let consumed = 0;
    for (const lead of comment.text.matchAll(CITATION_LEAD)) {
      if (lead.index < consumed) continue;
      const read = resolve(path, comment, mentions, lead);
      consumed = read.until;
      switch (read.read) {
        case "citation": {
          scan.citations.push(read.citation);
          break;
        }
        case "unparsed": {
          scan.unparsed.push(read.attempt);
          break;
        }
        case "contextless": {
          scan.contextless.push(read.attempt);
          break;
        }
        case "mention": {
          break;
        }
      }
    }
  }
  return scan;
}

/** Where in the comment a reading ended, so the scan can resume past it. */
interface Consumed {
  /** Offset just after the lead and spec this reading took. */
  until: number;
}

/** One citation lead, resolved or refused, with the reason. */
type LeadReading = Consumed &
  (
    | {
        /** The lead's line spec was read and its file is known. */
        read: "citation";
        /** What it cites. */
        citation: Citation;
      }
    | {
        /** A line spec the grammar could not read. */
        read: "unparsed";
        /** What was written there. */
        attempt: UnparsedCitation;
      }
    | {
        /** A bare line reference no file name in the comment explains. */
        read: "contextless";
        /** What was written there. */
        attempt: UnparsedCitation;
      }
    | {
        /** A file name with no line after it: a mention, claiming nothing. */
        read: "mention";
      }
  );

/**
 * Resolve one citation lead into a citation, or say why not.
 *
 * The four outcomes are the whole policy in one place. A MENTION is
 * silent: `see parser.rb: it walks the buffer` names no line and claims
 * nothing checkable, and turning ordinary prose punctuation into a gate
 * failure would be a trap in exactly the place the docs promise safety.
 * An UNPARSED reading is loud, because a line spec somebody wrote and
 * the grammar half-read is the error this check exists to catch. A
 * CONTEXTLESS reading is counted and reported but not failed: the
 * reference is real and unverifiable, and hiding it would be worse than
 * either.
 * @param path - the citing file's path
 * @param comment - the flattened comment the lead was found in
 * @param mentions - every file name in that comment, in order
 * @param lead - the match: an optional file name and the lead after it
 * @returns what the lead turned out to be
 */
function resolve(
  path: string,
  comment: FlatComment,
  mentions: readonly RegExpExecArray[],
  lead: RegExpExecArray,
): LeadReading {
  const at = lead.index;
  const after = at + lead[0].length;
  const line = comment.lineAt[at] ?? 0;
  const spec = CITATION_SPEC.exec(comment.text.slice(after))?.[0];
  if (spec === undefined) return { read: "mention", until: after };
  const until = after + spec.length;
  const spelling = `${lead[0]}${spec}`;
  const attempt = { source: path, line, spelling };
  const ranges = parseLineSpec(spec);
  if (ranges === undefined) return { read: "unparsed", attempt, until };
  const file = lead.groups?.file ?? contextFile(mentions);
  if (file === undefined) return { read: "contextless", attempt, until };
  return {
    read: "citation",
    until,
    citation: {
      file,
      ranges,
      spelling,
      source: path,
      line,
      comment: comment.text,
    },
  };
}

/**
 * The file a bare line reference is about: the ONE recognized file its
 * comment names.
 *
 * One, not the nearest one. A comment that names two of them has not
 * said which a bare `l.1125` belongs to, and picking the nearer is
 * exactly how a citation ends up checked against the wrong file and
 * passing - `reader-lists.test.ts` cites `parser.js l.2168` and then
 * `parse_list`'s `l.1125`, which is Ruby, and parser.js has a line 1125
 * too. A wrong file that goes green is the failure this whole check
 * exists to prevent, so ambiguity is reported instead of resolved, and
 * the fix is one word in the comment.
 * @param mentions - every file name in the comment, in order
 * @returns the file's basename, or undefined if the comment names none
 * or more than one
 */
function contextFile(mentions: readonly RegExpExecArray[]): string | undefined {
  const named = new Set(mentions.map((mention) => mention[0]));
  return named.size === 1 ? [...named][0] : undefined;
}

// Names that look like the cited source's own. Ruby methods and locals
// are snake_case, its constants are SCREAMING_SNAKE, and its regexps
// are CamelCase (`ExtAtxSectionTitleRx`); the oracle's own tables carry
// a leading underscore (`_normalQuoteSubs`).
const SNAKE = /\b[a-z][a-z\d]*(?:_[a-z\d]+)+\b/gv;
const SCREAMING = /\b[A-Z][A-Z\d]*(?:_[A-Z\d]+)+\b/gv;
const CAMEL = /\b[A-Z][a-z\d]+(?:[A-Z][A-Za-z\d]*)+\b/gv;
const UNDERSCORED = /\b_[a-z][A-Za-z\d]*\b/gv;
// Bare lowerCamelCase is the JAVASCRIPT convention, so it is a
// candidate for a citation of the oracle (`readParagraphLines`,
// `thisLine`, `hasText`) and NOT for a citation of the Ruby. It is also
// what OUR identifiers look like, and nearly every comment here names
// one: taken against a Ruby citation it would turn every comment that
// mentions a local function into a failure, which is measured - it
// turned eight citations red the day it was tried. A single capitalized
// word is out against everything, for the same reason: English
// sentences start with one.
const LOWER_CAMEL = /\b[a-z][a-z\d]*(?:[A-Z][A-Za-z\d]*)+\b/gv;
// Paths and file names are struck out first: `attribute_list.rb` and
// `src/parse/inline/quote-boundaries.ts` are snake_case and
// kebab-case-shaped, and neither is a name in the cited file.
const PATHS = /[\w.\/\-]*\.(?:rb|ts|cjs|js|json|adoc|md)\b/gv;

/** File extensions whose sources name things in lowerCamelCase. */
const JAVASCRIPT = /\.(?:c|m)?js$/v;

/**
 * The names in a comment that could anchor its citation.
 *
 * Exported for the identifier-window tests, and worth reading before
 * writing a comment: a citation whose comment names nothing the cited
 * file contains is unanchored, and the checker can only prove its line
 * exists, never that it is the right line.
 * @param comment - the citing comment, flattened
 * @param cited - the cited file's basename, whose language decides
 * whether lowerCamelCase counts as a name
 * @returns the candidate names, deduplicated, in first-seen order
 */
export function identifierCandidates(comment: string, cited: string): string[] {
  const prose = comment.replaceAll(PATHS, " ");
  const patterns = [SNAKE, SCREAMING, CAMEL, UNDERSCORED];
  if (JAVASCRIPT.test(cited)) patterns.push(LOWER_CAMEL);
  const found = new Set<string>();
  for (const pattern of patterns) {
    for (const match of prose.matchAll(pattern)) found.add(match[0]);
  }
  return [...found];
}

/** What one citation's checks concluded. */
export interface CitationVerdict {
  /** One line per failure; empty means the citation held. */
  failures: string[];
  /** Whether the comment named anything the check could look for. */
  anchored: boolean;
}

/**
 * Check one citation against the file it names.
 *
 * Exported for the range and identifier-window tests, which drive it
 * with a small committed Ruby fixture rather than the real sources.
 * @param citation - the citation to check
 * @param lines - the cited file's lines, in order
 * @param window - how many lines either side of a range still anchor
 * @returns the failures, and whether the identifier check could run
 */
export function checkCitation(
  citation: Citation,
  lines: readonly string[],
  window: number,
): CitationVerdict {
  const failures: string[] = [];
  for (const range of citation.ranges) {
    if (range.end > lines.length) {
      failures.push(
        `cites line ${String(range.end)} of ${citation.file}, which has ${String(lines.length)} lines`,
      );
    }
  }
  const candidates = identifierCandidates(citation.comment, citation.file);
  if (failures.length > 0 || candidates.length === 0) {
    return { failures, anchored: candidates.length > 0 };
  }
  const near = windowText(citation.ranges, lines, window);
  // The name goes into a pattern unescaped, which is safe by
  // construction: every candidate comes out of {@link
  // identifierCandidates}, whose three patterns match word characters
  // and nothing else.
  const anchor = candidates.find((name) =>
    new RegExp(String.raw`\b${name}\b`, "v").test(near),
  );
  if (anchor === undefined) {
    failures.push(
      `names ${describe(candidates)}: none appears within ${String(window)} lines of ${citation.spelling}`,
    );
  }
  return { failures, anchored: true };
}

/** How many candidate names a failure message lists before eliding. */
const NAMES_SHOWN = 4;

/**
 * Render a candidate list for a failure message.
 * @param candidates - the names the comment offered
 * @returns a short comma-separated list, elided if long
 */
function describe(candidates: readonly string[]): string {
  const shown = candidates.slice(0, NAMES_SHOWN).join(", ");
  return candidates.length > NAMES_SHOWN ? `${shown}, ...` : shown;
}

// The line that OPENS the thing a cited line is inside: a Ruby method,
// class or module, a Ruby constant assignment, or the transpile's
// equivalents (`const X =`, `$def(self, '$name'`). Most citations point
// at a line in the middle of a method, and the name that anchors them
// is the method's own, so the window has to reach the header, not just
// a few lines up.
const DEFINITION_HEADER =
  /^\s*(?:(?:def|class|module)\s|(?:const|let|var|function)\s|[A-Z][A-Za-z\d_]*\s*=|\$def\()/v;

/**
 * How far up a cited range may look for the definition that encloses
 * it. Asciidoctor's longest methods run a few hundred lines
 * (`next_block` is over 400), and a citation into one of them still
 * means "inside this method". The cap is what stops a cited line in a
 * header comment from dragging in the whole file above it.
 */
const ENCLOSING_LOOKBACK = 450;

/**
 * The cited file's text a citation's names may appear in: the lines
 * either side of every cited range, plus everything back to the
 * definition that encloses it.
 * @param ranges - the cited ranges
 * @param lines - the cited file's lines
 * @param window - how many lines either side to include
 * @returns the windows, joined
 */
function windowText(
  ranges: readonly CitedRange[],
  lines: readonly string[],
  window: number,
): string {
  return ranges
    .map((range) => {
      const above = Math.max(0, range.start - 1 - window);
      const body = lines
        .slice(nearestHeader(lines, above), range.end + window)
        .join("\n");
      return [...enclosingNames(lines, above), body].join("\n");
    })
    .join("\n");
}

/**
 * Walk up from a line to the nearest header above it, whatever kind.
 *
 * Finding nothing returns `from`, not the lookback floor: a walk that
 * hit the cap has learnt nothing about what encloses the line, and
 * widening the window by four hundred lines on the strength of that
 * would make the check weakest exactly where it understood least.
 * @param lines - the cited file's lines
 * @param from - 0-based index to start looking at, inclusive
 * @returns the 0-based index of the header, or `from` if there is none
 */
function nearestHeader(lines: readonly string[], from: number): number {
  const floor = Math.max(0, from - ENCLOSING_LOOKBACK);
  for (let at = from; at >= floor; at -= 1) {
    if (DEFINITION_HEADER.test(lines[at] ?? "")) return at;
  }
  return from;
}

/**
 * The header lines that ENCLOSE a cited line, innermost first.
 *
 * The nearest header above a cited line is often a SIBLING - the
 * constant before this one in a table, the method before this one in a
 * class - and the name a comment reasonably uses is the enclosing one.
 * `attribute_list.rb l.199-201` is `skip_blank` inside
 * `class AttributeList`, and a comment about attrlist spacing names the
 * class; `l.30-34` is `BoundaryRx` in the same class, and the sibling
 * above it is `QUOT`.
 *
 * Enclosure is read from INDENTATION: walking up, a header counts only
 * if it is indented less than every header already taken, which is the
 * chain `def` inside `class` inside `module` and nothing else. That is
 * a handful of lines, so it costs the window almost no width.
 * @param lines - the cited file's lines
 * @param from - 0-based index to start looking at, inclusive
 * @returns the enclosing header lines' text, innermost first
 */
function enclosingNames(lines: readonly string[], from: number): string[] {
  const found: string[] = [];
  let indent = Number.POSITIVE_INFINITY;
  for (let at = from; at >= 0; at -= 1) {
    const line = lines[at] ?? "";
    if (!DEFINITION_HEADER.test(line)) continue;
    const width = line.length - line.trimStart().length;
    if (width >= indent) continue;
    found.push(line);
    indent = width;
    if (indent === 0) break;
  }
  return found;
}
