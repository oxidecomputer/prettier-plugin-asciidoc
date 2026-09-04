/**
 * Which files make up the line-shape registry.
 *
 * ONE answer, because two machines ask it and a disagreement between
 * them is a hole rather than a discrepancy: the pattern-import rule
 * in tests/parser/architecture.test.ts (only the classification pass
 * may import a pattern) and rule (ii) of the completeness census in
 * scripts/metrics/shape-census.ts (every registry export is covered
 * by a dimension or exempted). Both used to walk src/parse for
 * themselves, and they walked it differently - one recursively with a
 * prefix test, one over the top directory with a narrower pattern -
 * so a module the first guarded was invisible to the second.
 *
 * DERIVED from the directory, never listed. The registry grows by
 * splitting a row family into a new sibling when line-shapes.ts nears
 * its `max-lines` ceiling, and a split that had to be remembered in
 * two hand-written lists is a split that will one day not be.
 */
import { readdirSync } from "node:fs";
import path from "node:path";

/** Where the registry's modules live, relative to the repository root. */
export const REGISTRY_DIRECTORY = "src/parse";

// line-shapes.ts and every `line-shapes-<family>.ts` split out of it.
// Deliberately wider than the names in the tree today: the guard's
// job is to catch a module nobody told it about, so anything that
// spells itself a line-shapes module IS one.
const REGISTRY_MODULE_NAME = /^line-shapes(?:-.+)?$/v;

/**
 * Whether a file's basename names a registry module. Not exported:
 * the shared answer is the WALK below, so neither caller can pair
 * this test with a walk of its own and reach a different set.
 * @param baseName - a filename without its extension
 * @returns true when a file of that name belongs to the registry
 */
function isRegistryModuleName(baseName: string): boolean {
  return REGISTRY_MODULE_NAME.test(baseName);
}

/**
 * Every registry module under a directory, by basename.
 *
 * RECURSIVE, though the registry is flat today: a file planted in a
 * subdirectory is exactly the case a non-recursive walk misses, and
 * the walk costs nothing.
 * @param directory - where to look, relative to the repository root;
 *   defaults to {@link REGISTRY_DIRECTORY}
 * @returns the basenames found, in directory order
 */
export function registryModuleNames(
  directory: string = REGISTRY_DIRECTORY,
): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) {
      return registryModuleNames(full);
    }
    const baseName = path.basename(entry.name, ".ts");
    return entry.name.endsWith(".ts") && isRegistryModuleName(baseName)
      ? [baseName]
      : [];
  });
}
