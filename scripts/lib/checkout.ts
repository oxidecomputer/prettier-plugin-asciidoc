/**
 * One way to put another revision on disk, shared by every
 * differential harness.
 *
 * There were three copies of this before W8 — in `scripts/metrics.ts`,
 * `scripts/parity.ts` and `scripts/shape-diff.ts` — with three
 * spellings of the buffer constant and only ONE of them calling
 * `realpath`. The missing `realpath` is not cosmetic on macOS: the
 * temp directory is handed out as `/var/…` while child processes
 * report `/private/var/…`, so a path that goes out one way and comes
 * back the other does not compare equal, which is how a measured
 * file stops resolving back to its layer.
 *
 * Deliberately `git archive` and not `git worktree`: this repository
 * is jj-managed with a colocated `.git`, a worktree MUTATES that
 * `.git`, and a concurrent session is normal here. An archive is
 * read-only on the repository by construction.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The repository root. Every absolute path a script hands to a child
 * process is built from this, so a base revision materialized into a
 * temp directory is still archived out of, and measured with, THIS
 * checkout's git and tools.
 */
export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

/**
 * Buffer for child-process output. An eslint JSON report for `src` at
 * threshold 0 runs to a few hundred kilobytes, uncomfortably close to
 * the default 1 MB pipe buffer, and a `git archive` of this repository
 * is two orders of magnitude larger than that.
 */
export const CHILD_MAX_BUFFER = 268_435_456;

/** What a caller wants the materialized checkout to be. */
export interface Materialization {
  /** Anything `git archive` accepts. */
  readonly revision: string;
  /**
   * Directory-name prefix, so a stray checkout in `$TMPDIR` names the
   * harness that leaked it.
   */
  readonly prefix: string;
  /**
   * Whether to run `bun install --frozen-lockfile` inside it. The
   * scorecard does not need it — it measures TEXT and runs this
   * checkout's tools against that tree — but any harness that EXECUTES
   * the base revision does: a baseline may have runtime dependencies
   * this revision no longer has (every baseline before c331bfbd, which
   * dropped Chevrotain, imports chevrotain).
   */
  readonly install: boolean;
}

/**
 * Materialize a revision into a fresh temp directory.
 * @param what - the revision, the directory prefix, and whether to install
 * @returns the temp directory holding the checkout, resolved through
 *   symlinks so it compares equal to what a child process reports
 * @throws {Error} when the revision is unknown, or the install fails;
 *   the half-populated directory is removed first, since the caller
 *   never learns its path and so cannot clean it up itself
 */
export function materialize(what: Materialization): string {
  const { revision, prefix, install } = what;
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));
  const archive = path.join(directory, "revision.tar");
  try {
    execFileSync(
      "git",
      ["archive", "--format=tar", "--output", archive, revision],
      { cwd: REPO_ROOT, maxBuffer: CHILD_MAX_BUFFER },
    );
    execFileSync("tar", ["-xf", archive, "-C", directory]);
    rmSync(archive, { force: true });
    if (install) {
      execFileSync("bun", ["install", "--frozen-lockfile"], {
        cwd: directory,
        maxBuffer: CHILD_MAX_BUFFER,
        stdio: ["ignore", "ignore", "inherit"],
      });
    }
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  return directory;
}
