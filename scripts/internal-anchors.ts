/**
 * The ANCHOR half of the repo-internal citation gate: every fragment
 * link this repository's markdown writes about its own headings is
 * held to a heading that is there.
 *
 * WHY. `docs/harnesses.md` carried a same-file link whose anchor never
 * resolved: the heading spelled a colon, GitHub DROPS a colon when it
 * slugs a heading, and the link hyphenated it. Nothing read markdown
 * at all, so the link was as green as a working one, and a second of
 * the same shape was written before a review caught both. A reader
 * following either lands at the top of the page and reads the wrong
 * section, which is the same rot the symbol half exists for one step
 * out: the claim is still about this repository, and only the spelling
 * of the claim differs.
 *
 * THE RULE IS GITHUB'S, because GitHub is where these files are read.
 * A heading's anchor is its rendered text, lowercased, with everything
 * that is not a letter, a mark, a digit, an underscore, a space or a
 * hyphen dropped, and every remaining space turned into a hyphen; a
 * slug a file has already used takes `-1`, then `-2`, and so on. So a
 * colon vanishes rather than becoming a hyphen (`test:deeply` slugs
 * `testdeeply`), an em-dash vanishes and leaves the two spaces around
 * it as two hyphens, and a run of several spaces becomes a run of
 * several hyphens. The rule was read off GitHub's own markdown
 * rendering of this repository's headings, not off a description of
 * it.
 *
 * WHAT THE RENDERED TEXT IS. Backticks, asterisks and angle brackets
 * need no undoing: they are punctuation the slug drops, so a code span
 * and a bold run slug the same whether they are read as markup or as
 * bytes. A LINK does need undoing, because only its label is rendered
 * and its destination would otherwise be slugged into the anchor, so a
 * link outside a code span is replaced by its label. Not claimed, and
 * they occur in none of these headings: a reference link, an image
 * (whose alt text renders as no text at all), and emphasis written
 * with underscores, which the slug keeps where GitHub's reader drops
 * it. A heading in one of those shapes gets a slug this module
 * computes from its bytes, which makes a live link to it FAIL rather
 * than makes a dead one pass.
 *
 * A FRAGMENT LINK naming a markdown file this gate reads no text for
 * splits in two. A file that IS NOT THERE fails: a misspelled file
 * name is the commonest way a cross-file link rots. A file that is
 * there and outside the scanned set is SKIPPED, for the reason the
 * symbol half gives about a path it has no file for: "does this file
 * have this heading" is unanswerable without the file.
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Ignored } from "./lib/ignored.js";

/** What a markdown file is called. */
const DOCUMENT = ".md";

/** The tree whose markdown this gate reads, for its headings. */
const DOCUMENT_ROOT = "docs";

/**
 * The markdown outside {@link DOCUMENT_ROOT} that this gate reads. The
 * checkout's other root documents are not read, and a link may name
 * one: they are present without being scanned.
 */
const ROOT_DOCUMENTS = ["README.md", "CONTRIBUTING.md"];

/**
 * What GitHub's slug drops: everything that is not a letter, a
 * combining mark, a digit, a connector (which is what `_` is), a
 * space or a hyphen.
 */
const SLUG_DROPPED = /[^\p{L}\p{M}\p{N}\p{Pc} \-]/gv;

/** An ATX heading, and the title it writes. */
const ATX_HEADING = /^ {0,3}#{1,6}(?:[ \t]+(?<title>.*?))?[ \t]*$/v;

/**
 * A closing run of hashes, which is decoration rather than title.
 * Preceded by a blank, so `# a#b` keeps its hash.
 */
const CLOSING_HASHES = /[ \t]#+$/v;

/** A fence, which opens or closes a run of lines that are not prose. */
const FENCE = /^ {0,3}(?<fence>`{3,}|~{3,})(?<rest>.*)$/v;

/**
 * A code span, whose bytes are literal however they are spelled.
 * The backtick run that opens one closes it, so the length is a
 * back-reference rather than a repeat of the class.
 */
const CODE_SPAN = /(?<ticks>`+)(?<run>[^\n]*?)\k<ticks>/gv;

/** An inline link, of which only the label is rendered. */
const INLINE_LINK = /\[(?<label>[^\]\n]*)\]\([^\)\n]*\)/gv;

/**
 * A markdown link whose destination carries a fragment. The
 * destination stops at the first blank because a title after it
 * (`](x "t")`) is not part of the target.
 */
const FRAGMENT_LINK =
  /\[[^\]\n]*\]\((?<target>[^\)\s#]*)#(?<fragment>[^\)\s]*)\)/gv;

/** The scheme of a destination that is somebody else's to resolve. */
const ABSOLUTE = /^[A-Za-z][\w+.\-]*:|^\/\//v;

/** The markdown a checkout has, split by whether this gate reads it. */
export interface Documents {
  /** The files whose headings and links are read, in path order. */
  readonly scanned: readonly string[];
  /** Every markdown file the checkout has, read or not. */
  readonly present: ReadonlySet<string>;
}

/**
 * The markdown a checkout has.
 *
 * Only what the checkout TRACKS: a path its ignore file names is an
 * operator's own file, not a claim this repository makes about itself
 * (`ignoredIn`, scripts/lib/ignored.ts).
 *
 * Two trees and no more: {@link DOCUMENT_ROOT}, and the checkout's own
 * root. That is where this repository writes documentation, and a
 * fragment link is resolved against a file it names, so the set has to
 * answer "is this file there" for every destination a document plausibly
 * writes. A destination outside those two is reported as no document of
 * this repository, which is what it is.
 *
 * Exported for the gate (scripts/internal-citations.ts) and its unit
 * tests (tests/scripts/internal-anchors.test.ts); no other consumer.
 * @internal
 * @param root - the repository root
 * @param ignored - whether a path is one the checkout ignores
 * @returns the files to read, and every one that exists
 */
export function documentsOf(root: string, ignored: Ignored): Documents {
  const under = path.join(root, DOCUMENT_ROOT);
  const scanned = existsSync(under)
    ? readdirSync(under, { recursive: true, encoding: "utf8" })
        .filter((name) => name.endsWith(DOCUMENT))
        .map((name) => path.posix.join(DOCUMENT_ROOT, name))
        .filter((relative) => !ignored(relative))
        .toSorted()
    : [];
  const rooted = readdirSync(root, { encoding: "utf8" }).filter(
    (name) => name.endsWith(DOCUMENT) && !ignored(name),
  );
  return {
    scanned: [...scanned, ...ROOT_DOCUMENTS],
    present: new Set([...scanned, ...rooted]),
  };
}

/** One fragment link, and what it claims. */
export interface FragmentCitation {
  /** Where it is written, as `path:line`. */
  readonly at: string;
  /** The markdown file whose headings must carry it, repo-relative. */
  readonly file: string;
  /** The anchor it names, the `#` stripped. */
  readonly fragment: string;
}

/** The anchors each scanned markdown file defines, by repo path. */
type AnchorIndex = ReadonlyMap<string, ReadonlySet<string>>;

/** One line of a markdown file, outside any fenced code block. */
interface ProseLine {
  /** The line as written. */
  readonly line: string;
  /** Which line it is, counting from 1. */
  readonly number: number;
}

/** The fence run one line writes, whichever end of a block it is. */
interface Fence {
  /** The character the run repeats. */
  readonly char: string;
  /** How long the run is. */
  readonly length: number;
  /** Whether the run is alone on its line, which a closing one is. */
  readonly bare: boolean;
}

/**
 * The lines of a markdown file that are PROSE: everything outside a
 * fenced code block.
 *
 * Fences are tracked because this repository's documentation shows
 * markdown, shell and JSON in fenced blocks, and a `#` opening a shell
 * comment is not a heading while a link inside a fenced example is not
 * a claim. A fence closes on a run of its OWN character, at least as
 * long as the one that opened it and alone on its line, which is what
 * lets a fenced block hold a shorter fence of the other character. The
 * other way of writing code, an indented block, needs no tracking: a
 * heading indented four spaces is not one to this scan either.
 *
 * Exported for its unit tests (tests/scripts/internal-anchors.test.ts);
 * the two scans below are the only other consumers.
 * @internal
 * @param text - the file's contents
 * @returns its prose lines, in order, each with its line number
 */
export function proseLines(text: string): ProseLine[] {
  const prose: ProseLine[] = [];
  let open: Fence | undefined = undefined;
  for (const [offset, line] of text.split("\n").entries()) {
    const fence = fenceOf(line);
    if (fence !== undefined) {
      open = open === undefined ? fence : stillOpen(open, fence);
    } else if (open === undefined) {
      prose.push({ line, number: offset + 1 });
    }
  }
  return prose;
}

/**
 * The fence run one line writes, if it writes one.
 * @param line - the line
 * @returns its fence run, or undefined for an ordinary line
 */
function fenceOf(line: string): Fence | undefined {
  const match = FENCE.exec(line);
  const groups: Record<string, string | undefined> = match?.groups ?? {};
  const run = groups.fence;
  if (run === undefined) {
    return undefined;
  }
  return {
    char: run.slice(0, 1),
    length: run.length,
    bare: (groups.rest ?? "").trim() === "",
  };
}

/**
 * The block still open after a fence line written inside one.
 * @param open - the fence that opened the block
 * @param fence - the fence this line writes
 * @returns the open block, or undefined where this line closed it
 */
function stillOpen(open: Fence, fence: Fence): Fence | undefined {
  const closes =
    fence.char === open.char && fence.length >= open.length && fence.bare;
  return closes ? undefined : open;
}

/**
 * The text GitHub renders for one heading's title.
 *
 * Code spans are copied out whole so that a link written inside one
 * stays bytes; everything else has its links replaced by their labels.
 * @param title - the heading's title, as written
 * @returns the text the anchor is slugged from
 */
function renderedText(title: string): string {
  let text = "";
  let read = 0;
  for (const span of title.matchAll(CODE_SPAN)) {
    text += title.slice(read, span.index).replaceAll(INLINE_LINK, "$<label>");
    text += span.groups?.run ?? "";
    read = span.index + span[0].length;
  }
  return text + title.slice(read).replaceAll(INLINE_LINK, "$<label>");
}

/**
 * GitHub's slug of one heading's rendered text, before duplicates are
 * suffixed.
 *
 * Exported for its unit tests (tests/scripts/internal-anchors.test.ts);
 * {@link anchorsIn} is the only other consumer.
 * @internal
 * @param title - the heading's title, as written
 * @returns the anchor it would take were it the file's first
 */
export function slug(title: string): string {
  return renderedText(title)
    .toLowerCase()
    .replaceAll(SLUG_DROPPED, "")
    .replaceAll(" ", "-");
}

/**
 * Every anchor one markdown file defines, in the order its headings
 * are written.
 *
 * The duplicate rule is GitHub's, and it counts per BASE slug rather
 * than per heading: the second `## Tests` is `tests-1`, and a third
 * heading whose own slug is already `tests-1` becomes `tests-1-1`
 * rather than colliding with it.
 *
 * Exported for its unit tests (tests/scripts/internal-anchors.test.ts)
 * and for the gate; no other consumer.
 * @internal
 * @param text - the file's contents
 * @returns the anchors it defines
 */
export function anchorsIn(text: string): Set<string> {
  const anchors = new Set<string>();
  const used = new Map<string, number>();
  for (const { line } of proseLines(text)) {
    const heading = ATX_HEADING.exec(line);
    if (heading === null) {
      continue;
    }
    const title = (heading.groups?.title ?? "").replace(CLOSING_HASHES, "");
    const base = slug(title);
    let anchor = base;
    while (used.has(anchor)) {
      const seen = (used.get(base) ?? 0) + 1;
      used.set(base, seen);
      anchor = `${base}-${String(seen)}`;
    }
    used.set(anchor, 0);
    anchors.add(anchor);
  }
  return anchors;
}

/**
 * Every fragment link one markdown file writes about this repository.
 *
 * A destination with a scheme belongs to whoever serves it and is not
 * claimed; a bare `#anchor` names the citing file's own headings; and
 * a relative path names another file's, resolved from the citing
 * file's directory the way a reader's browser resolves it.
 *
 * Exported for its unit tests (tests/scripts/internal-anchors.test.ts)
 * and for the gate; no other consumer.
 * @internal
 * @param file - the repo-relative path the links are written in
 * @param text - that file's contents
 * @returns the citations, in the order they are written
 */
export function fragmentCitations(
  file: string,
  text: string,
): FragmentCitation[] {
  const citations: FragmentCitation[] = [];
  for (const { line, number } of proseLines(text)) {
    for (const match of line.matchAll(FRAGMENT_LINK)) {
      const groups: Record<string, string | undefined> = match.groups ?? {};
      const target = groups.target ?? "";
      if (ABSOLUTE.test(target)) {
        continue;
      }
      citations.push({
        at: `${file}:${String(number)}`,
        file: target === "" ? file : resolve(file, target),
        fragment: groups.fragment ?? "",
      });
    }
  }
  return citations;
}

/**
 * One relative destination, as a repo-relative path.
 *
 * Spelled here rather than with `node:path` because a markdown link is
 * resolved by a browser over URL segments, which are `/`-separated
 * whatever the host writes, and because a `..` that climbs out of the
 * repository must stay visibly wrong rather than become an absolute
 * path that happens to exist.
 * @param file - the repo-relative file the link is written in
 * @param target - the link's destination
 * @returns the repo-relative file it names
 */
function resolve(file: string, target: string): string {
  const segments = file.split("/").slice(0, -1);
  for (const segment of target.split("/")) {
    if (segment === "..") {
      segments.pop();
    } else if (segment !== "." && segment !== "") {
      segments.push(segment);
    }
  }
  return segments.join("/");
}

/**
 * The parts of a run's report this scan writes into.
 *
 * Structural, and not the gate's `Report` itself, because the gate
 * imports this module and a type imported back the other way would be
 * a cycle. `Report` (scripts/internal-citations.ts) satisfies it.
 *
 * Exported with {@link checkFragments}; no other consumer.
 * @internal
 */
export interface FragmentTally {
  /** Links held to a heading of a file the gate read. */
  anchors: number;
  /** One line per citation read, for `--list`. */
  listing: string[];
  /** One line per failure, ready to print. */
  failures: string[];
}

/**
 * Hold every fragment link one checkout's markdown writes to a heading
 * of the file it names, and record what happened.
 *
 * The anchors of every scanned file are slugged FIRST, so a cross-file
 * link is answered by the same index as a same-file one and each file
 * is read once.
 *
 * A destination this gate read no text for splits in two. A markdown
 * file that IS NOT THERE is a failure whatever its fragment says: a
 * misspelled file name is the commonest way a cross-file link rots,
 * and a gate that skipped it would pass the loudest breakage it can
 * see. A markdown file that is there and outside the scanned set
 * (`AGENTS.md`) is the no-text skip: "does this file have this
 * heading" is unanswerable without reading it.
 *
 * Exported for the gate and its unit tests
 * (tests/scripts/internal-anchors.test.ts); no other consumer.
 * @internal
 * @param markdown - every scanned markdown file, by repo-relative path
 * @param present - every file the checkout has, for the existence half
 * @param tally - the run's report, added to in place
 */
export function checkFragments(
  markdown: ReadonlyMap<string, string>,
  present: ReadonlySet<string>,
  tally: FragmentTally,
): void {
  const index: AnchorIndex = new Map(
    [...markdown].map(([file, text]) => [file, anchorsIn(text)]),
  );
  for (const [file, text] of markdown) {
    for (const citation of fragmentCitations(file, text)) {
      const anchors = index.get(citation.file);
      if (anchors === undefined) {
        tally.failures.push(...checkTarget(citation, present));
        continue;
      }
      tally.anchors += 1;
      tally.listing.push(
        `${citation.at}\t#${citation.fragment}\t${citation.file}`,
      );
      tally.failures.push(...checkFragment(citation, anchors));
    }
  }
}

/**
 * Hold the file a fragment link names to a file the checkout has.
 *
 * Asked only of a destination the gate read no text for, so a file it
 * read is never looked up here.
 * @param citation - the citation
 * @param present - every file the checkout has
 * @returns one message per failure, empty when the file is there
 */
function checkTarget(
  citation: FragmentCitation,
  present: ReadonlySet<string>,
): string[] {
  if (present.has(citation.file)) {
    return [];
  }
  return [
    `${citation.at}: names ${citation.file}, which is no document of this repository`,
  ];
}

/**
 * Hold one fragment link to the headings of the file it names.
 *
 * The anchors and not the index, so the gate does the no-text skip
 * before it counts and this function has no arm for a file nobody
 * read.
 *
 * Exported for its unit tests (tests/scripts/internal-anchors.test.ts);
 * the gate is the only other consumer.
 * @internal
 * @param citation - the citation
 * @param anchors - the anchors the file it names defines
 * @returns one message per failure, empty when the link held
 */
export function checkFragment(
  citation: FragmentCitation,
  anchors: ReadonlySet<string>,
): string[] {
  if (anchors.has(citation.fragment)) {
    return [];
  }
  return [
    `${citation.at}: \`#${citation.fragment}\` names no heading in ${citation.file}`,
  ];
}
