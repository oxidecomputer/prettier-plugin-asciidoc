#!/usr/bin/env bun
/* eslint-disable no-console -- runner script */

/**
 * Fetches the vendored Asciidoctor conformance corpus (heredoc test
 * inputs, documentation pages, and test fixtures).
 *
 * Exit codes (`scripts/lib/cli.ts`): 0 fetched, 2 it could not fetch
 * (no network, a moved pin). There is no 1: nothing here is a gate.
 */

import { $ } from "bun";
import { printUsage, wantsHelp } from "./lib/cli.js";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  extractCorpusCases,
  serializeCorpus,
  type CorpusCase,
} from "./heredoc-extractor.js";

// Named to satisfy @typescript-eslint/no-magic-numbers below.
const ZERO = 0;

const USAGE = `usage: bun run vendor

  --help  this text

exit: 0 fetched, 2 could not fetch`;

const ARGUMENT_START = 2;
if (wantsHelp(process.argv.slice(ARGUMENT_START))) {
  printUsage(USAGE);
  process.exit();
}

const tempdir = await mkdtemp(path.join(tmpdir(), "asciidoc-vendor-"));

try {
  // --- Asciidoctor conformance corpus (issue #7) ---
  // Pinned to an exact commit so extracted case IDs stay stable:
  // the quarantine manifest keys on them. Bump deliberately, then
  // re-run the triage script to reconcile the manifest.
  const asciidoctorCommit = "ae5891df10f12dda069abea8a318c9b94d545bee";
  console.log(`Fetching asciidoctor @ ${asciidoctorCommit}...`);
  await $`git init -q ${tempdir}/asciidoctor`;
  await $`git -C ${tempdir}/asciidoctor fetch -q --depth 1 https://github.com/asciidoctor/asciidoctor.git ${asciidoctorCommit}`;
  await $`git -C ${tempdir}/asciidoctor checkout -q FETCH_HEAD`;

  console.log("Extracting test corpus...");
  await rm("vendor/asciidoctor-corpus", { recursive: true, force: true });
  await $`mkdir -p vendor/asciidoctor-corpus`;
  await $`cp ${tempdir}/asciidoctor/LICENSE vendor/asciidoctor-corpus/`;
  const testDirectory = path.join(tempdir, "asciidoctor", "test");
  const testDirectoryEntries = await readdir(testDirectory);
  const rubyFiles = testDirectoryEntries
    .filter((name) => name.endsWith("_test.rb"))
    .toSorted();
  // One file per Ruby test file, read and written independently, so
  // this parallelizes over Promise.all rather than an await-in-loop.
  const perFileCaseCounts = await Promise.all(
    rubyFiles.map(async (name) => {
      const source = await readFile(path.join(testDirectory, name), "utf8");
      const cases = extractCorpusCases(source, name);
      if (cases.length === ZERO) return ZERO;
      const outName = `${path.basename(name, ".rb")}.jsonl`;
      await writeFile(
        path.join("vendor/asciidoctor-corpus", outName),
        serializeCorpus(cases),
      );
      return cases.length;
    }),
  );
  const total = perFileCaseCounts.reduce((sum, count) => sum + count, ZERO);
  console.log(`Extracted ${total} heredoc cases.`);

  console.log("Extracting docs corpus...");
  const documentsDirectory = path.join(tempdir, "asciidoctor", "docs");
  const documentsDirectoryEntries = await readdir(documentsDirectory, {
    recursive: true,
  });
  const documentPaths = documentsDirectoryEntries
    .filter((name) => name.endsWith(".adoc"))
    .toSorted();
  const documentCases: CorpusCase[] = await Promise.all(
    documentPaths.map(async (documentPath) => ({
      // IDs are the upstream repo-relative path with forward slashes,
      // so a manifest entry reads as a recognizable document name.
      id: path.posix.join("docs", documentPath.split(path.sep).join("/")),
      input: await readFile(
        path.join(documentsDirectory, documentPath),
        "utf8",
      ),
    })),
  );
  await writeFile(
    path.join("vendor/asciidoctor-corpus", "docs.jsonl"),
    serializeCorpus(documentCases),
  );
  console.log(`Extracted ${documentCases.length} documentation pages.`);

  console.log("Extracting test fixtures...");
  // The fixtures are hand-written edge cases (UTF-8 BOM, encoding,
  // include chains, unclosed tags) — ready-made adversarial inputs.
  // `.asciidoc` alternate extensions are included deliberately; the
  // alternate extension is itself one of the edge cases.
  const fixturesDirectory = path.join(
    tempdir,
    "asciidoctor",
    "test",
    "fixtures",
  );
  const fixturesDirectoryEntries = await readdir(fixturesDirectory, {
    recursive: true,
  });
  const fixturePaths = fixturesDirectoryEntries
    .filter((name) => name.endsWith(".adoc") || name.endsWith(".asciidoc"))
    .toSorted();
  const fixtureCases: CorpusCase[] = await Promise.all(
    fixturePaths.map(async (fixturePath) => ({
      id: path.posix.join(
        "test/fixtures",
        fixturePath.split(path.sep).join("/"),
      ),
      input: await readFile(path.join(fixturesDirectory, fixturePath), "utf8"),
    })),
  );
  await writeFile(
    path.join("vendor/asciidoctor-corpus", "fixtures.jsonl"),
    serializeCorpus(fixtureCases),
  );
  console.log(`Extracted ${fixtureCases.length} fixture documents.`);

  console.log("Done. Vendored files updated.");
} finally {
  await rm(tempdir, { recursive: true, force: true });
}
