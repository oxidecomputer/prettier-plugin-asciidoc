/**
 * The one writer every `--write` path under `scripts/` goes through:
 * the ledgers, the triage manifests and the witness fixture.
 *
 * ONE COPY, because the normal form is a property of the TREE and not
 * of any one harness. Every file written here is checked in, and
 * `bun run fmt:check` runs over the whole tree, so a writer that
 * emits anything but Prettier's spelling of its own output leaves the
 * tree failing that gate until somebody runs `bun run fmt` by hand.
 * That is not a hypothetical: `JSON.stringify(value, undefined, 2)`
 * breaks every array over as many lines as it has elements and
 * Prettier keeps a short one on a single line, so a hand-rolled
 * writer's output is Prettier-normal exactly while none of its arrays
 * happens to be short enough to fit. Every hand-rolled writer this
 * replaced passed the gate for that reason alone until one of them
 * (`scripts/whitespace-battery-ledger.json`, issue #271) grew a
 * two-element `examples` array and stopped.
 *
 * A LIBRARY module, not a command. It decides nothing about what a
 * ledger CONTAINS; each harness owns its own rows and hands the
 * finished object here.
 */
import { writeFileSync } from "node:fs";
import { format } from "prettier";

/** The indentation Prettier is handed the value already wearing. */
const INDENT = 2;

/**
 * Serializes a generated JSON file in Prettier-normal form, so
 * `fmt:check` passes immediately after a `--write` instead of failing
 * until someone runs `bun run fmt`.
 *
 * Prettier is handed the INDENTED serialization rather than the
 * compact one, and the difference is visible in the output: Prettier's
 * JSON printer preserves the break a source object already has after
 * its `{`, so an already-indented value keeps one key per line while a
 * compact one collapses onto a single line wherever the width allows.
 * Both are Prettier-normal; one key per line is the shape every
 * generated file in this tree already carries, so this is the spelling
 * that leaves an unchanged ledger byte-identical after a rewrite.
 * Arrays get no such treatment either way, which is what fixes the
 * ledger this writer exists for.
 *
 * Prettier appends the trailing newline itself, which is why nothing
 * here adds one.
 * @param file - repo-relative path of the file to write
 * @param content - the object to serialize; a record or an array,
 *   since the harnesses write both
 * @returns nothing, once the file is on disk
 */
export async function writeLedgerFile(
  file: string,
  content: object,
): Promise<void> {
  writeFileSync(
    file,
    await format(JSON.stringify(content, undefined, INDENT), {
      parser: "json",
    }),
  );
}
