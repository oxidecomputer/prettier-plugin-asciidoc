/**
 * The throwaway-checkout pattern every planted-tree test wants: make a
 * fresh directory, write the given files into it, run something
 * against it, remove it. Was hand-rolled per file under `tests/scripts/`
 * and `tests/conformance/`; `inCheckout` here is the general form one
 * of those copies (`metrics-minimums.test.ts`) already had.
 *
 * The directory is `realpathSync`-resolved before anything is
 * written. On macOS `/tmp` (via `tmpdir()`) resolves through `/var`,
 * which is itself a symlink to `/private/var`, so a reader that
 * compares this root against a path a child process or another tool
 * reports back (which sees the resolved form) disagrees with the
 * unresolved one. Skipping this is a Linux-only-green mistake: CI
 * runners have no such symlink, so a kernel that dropped it would
 * pass there and fail only on macOS.
 */
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Make a fresh, `realpathSync`-resolved directory and write `files`
 * into it, each key a path relative to the root (subdirectories
 * created as needed). Does not clean up; callers that do not want an
 * immediate scoped cleanup ({@link inCheckout}, {@link inCheckoutAsync})
 * are responsible for removing the root themselves.
 * @param files - path relative to the root, to contents
 * @returns the checkout root
 */
export function plantCheckout(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "checkout-")));
  for (const [name, contents] of Object.entries(files)) {
    const full = path.join(root, name);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

/**
 * Run `read` against a throwaway checkout holding `files`, and remove
 * the checkout afterward whether `read` returned or threw.
 * @param files - path relative to the checkout root, to contents; a
 *   path that is omitted is a file that is not there at that revision
 * @param read - what to ask of that checkout
 * @returns whatever `read` returned
 */
export function inCheckout<T>(
  files: Record<string, string>,
  read: (root: string) => T,
): T {
  const root = plantCheckout(files);
  try {
    return read(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * {@link inCheckout} for a `read` that returns a promise: the checkout
 * is removed only after that promise settles, not after it is merely
 * created. A synchronous cleanup right after handing back a pending
 * promise would delete the tree out from under work the promise still
 * has to do.
 * @param files - path relative to the checkout root, to contents
 * @param read - what to ask of that checkout
 * @returns whatever `read` resolved to
 */
export async function inCheckoutAsync<T>(
  files: Record<string, string>,
  read: (root: string) => Promise<T>,
): Promise<T> {
  const root = plantCheckout(files);
  try {
    return await read(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
