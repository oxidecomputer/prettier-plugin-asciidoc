/**
 * What a checkout IGNORES, read from its own `.gitignore`.
 *
 * A gate that walks a tree walks whatever is on disk, and what is on
 * disk is not what the repository HAS. An operator's working notes, a
 * private corpus, a machine-local config file: none of them is a claim
 * this repository makes about itself, and a checker that read one
 * would report a failure nobody but that operator could fix and that
 * no landing could clear. The citation gate walked `docs` recursively
 * and read a directory of untracked planning documents that named
 * functions deleted long ago; the gate was right about the names and
 * wrong about whose names they were.
 *
 * WHAT IS READ: the patterns of `.gitignore`, as plain paths. A
 * trailing `/` marks a directory and is dropped; a `#` line and a
 * blank line are not patterns; a pattern carrying a `/` anywhere else
 * is anchored to the checkout root, and one that does not matches a
 * path SEGMENT at any depth. A LEADING `/` anchors and is then dropped
 * too, because it is the one separator no repo-relative path writes:
 * `/foo.txt` names the root's own `foo.txt` and not `a/foo.txt`.
 * Every pattern this repository writes is one of those shapes.
 *
 * NOT CLAIMED: a glob (`*`, `?`, a character class), a negation, and
 * `**`. A pattern using one is read as no rule at all, which makes the
 * walk see MORE than git would rather than less. That is the safe
 * direction of the two: an unreadable pattern can make a gate report a
 * file it should have skipped, which is loud and gets fixed, and can
 * never make it skip a file it should have read, which would be a
 * check that silently stopped happening.
 *
 * The reading splits into {@link ignoreRules}, which is the whole
 * decision, and {@link ignoredIn}, which is the one line of IO, so the
 * rules can be driven over ignore text written in a test.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** The file a checkout writes its ignore patterns in. */
const IGNORE_FILE = ".gitignore";

/** What separates the segments of a pattern and of a path. */
const SEPARATOR = "/";

/** A pattern this reader cannot read, and does not guess at. */
const UNREADABLE = /[*?!\[\]]/v;

/** A trailing separator, which marks a directory and says nothing more. */
const TRAILING = /\/$/v;

/**
 * A leading separator, which anchors a pattern and is no part of the
 * path it names: no repo-relative path opens with one.
 */
const LEADING = /^\//v;

/** What opens a comment line. */
const COMMENT = "#";

/**
 * Whether one repo-relative path is one the checkout ignores.
 *
 * Exported for the two walks that ask it (scripts/internal-citations.ts
 * and scripts/internal-anchors.ts); no other consumer.
 * @internal
 */
export type Ignored = (relative: string) => boolean;

/**
 * Read ignore text into the question a walk asks of each path.
 *
 * All of the decision and none of the IO.
 *
 * Exported for its unit tests (tests/scripts/ignored.test.ts);
 * {@link ignoredIn} is the only other consumer.
 * @internal
 * @param written - the contents of an ignore file
 * @returns whether a repo-relative path is ignored
 */
export function ignoreRules(written: string): Ignored {
  const anchored: string[] = [];
  const anywhere = new Set<string>();
  for (const line of written.split("\n")) {
    const pattern = line.trim().replace(TRAILING, "");
    if (
      pattern === "" ||
      pattern.startsWith(COMMENT) ||
      UNREADABLE.test(pattern)
    ) {
      continue;
    }
    // Asked BEFORE the leading separator goes: a pattern is anchored
    // by carrying one anywhere, and `/foo.txt` carries only that one.
    if (pattern.includes(SEPARATOR)) {
      anchored.push(pattern.replace(LEADING, ""));
    } else {
      anywhere.add(pattern);
    }
  }
  return (relative) =>
    relative.split(SEPARATOR).some((segment) => anywhere.has(segment)) ||
    anchored.some(
      (one) => relative === one || relative.startsWith(`${one}${SEPARATOR}`),
    );
}

/**
 * Read one checkout's ignore rules.
 *
 * A checkout with no ignore file ignores nothing, which is what a
 * fixture tree written by a test is.
 *
 * Exported for the two walks that ask it and for its unit tests
 * (tests/scripts/ignored.test.ts); no other consumer.
 * @internal
 * @param root - the repository root
 * @returns whether a repo-relative path is ignored
 */
export function ignoredIn(root: string): Ignored {
  const file = path.join(root, IGNORE_FILE);
  return ignoreRules(existsSync(file) ? readFileSync(file, "utf8") : "");
}
