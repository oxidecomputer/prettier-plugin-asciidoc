#!/usr/bin/env bun
/**
 * Build the distributable: bundle `src/index.ts` into `dist/`, then
 * emit the type declarations `package.json`'s `exports` points at.
 *
 * Exit codes (`scripts/lib/cli.ts`): 0 built, 2 it could not build.
 * There is no 1 here — a build is not a gate, so there is no state in
 * which it ran and found the code wanting.
 */
import { rm } from "node:fs/promises";
import { cannotRun, printUsage, wantsHelp } from "./lib/cli.js";

const USAGE = `usage: bun run build

  --help  this text

exit: 0 built, 2 could not build`;

const ARGUMENT_START = 2;
if (wantsHelp(process.argv.slice(ARGUMENT_START))) {
  printUsage(USAGE);
  process.exit();
}

await rm("dist", { recursive: true, force: true });
await Bun.build({
  entrypoints: ["src/index.ts"],
  outdir: "dist",
  format: "esm",
  sourcemap: "external",
  external: ["prettier"],
});

// Type declarations for consumers: the runtime bundle above carries no
// types, and package.json's `exports` points at dist/index.d.ts.
const declarations = Bun.spawnSync([
  "bun",
  "x",
  "tsc",
  "-p",
  "tsconfig.build.json",
]);
if (declarations.exitCode !== 0) {
  process.stderr.write(declarations.stdout.toString());
  process.stderr.write(declarations.stderr.toString());
  cannotRun(`tsc -p tsconfig.build.json exited ${declarations.exitCode}`);
}
