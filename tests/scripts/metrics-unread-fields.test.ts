/**
 * The unread-published-field check, against PLANTED trees.
 *
 * It is a gate now — `bun run metrics` exits 1 on any candidate — and
 * a gate whose only evidence is "it says none on our tree" is a gate
 * that could equally be broken. These rows plant the four shapes the
 * check's judgement rests on: a field nobody reads, the same field
 * read three ways the language service must resolve (property access,
 * destructuring, indexed access), a field only ever CONSTRUCTED, and
 * the serialized-type exemption.
 *
 * A planted root rather than a `--root` run of the CLI: the CLI skips
 * this check under a foreign root on purpose (neither the registry nor
 * the exemption describes somebody else's tree), so the unit is where
 * the behaviour is checkable at all.
 */
import { describe, expect, test } from "vitest";
import { unreadPublishedFields } from "../../scripts/metrics/unread-fields.js";
import { inCheckout } from "../lib/checkout.js";

/** One row of the planted crossings registry. */
interface PlantedRow {
  /** The declaring file, root-relative. */
  readonly file: string;
  /** The type the registry publishes. */
  readonly symbol: string;
}

/**
 * Plant a checkout the scan can open, and measure it.
 * @param rows - the crossings registry to write
 * @param files - `src`-relative file name to contents
 * @returns the candidates, as `Type.property`
 */
function scan(
  rows: readonly PlantedRow[],
  files: Record<string, string>,
): string[] {
  return inCheckout(plantedTree(rows, files), (root) =>
    unreadPublishedFields(root).map(
      (field) => `${field.type}.${field.property}`,
    ),
  );
}

/**
 * The files one planted checkout holds: the registry, a project the
 * scan can open, and the sources under `src`.
 * @param rows - the crossings registry to write
 * @param files - `src`-relative file name to contents
 * @returns the checkout's files, keyed by root-relative path
 */
function plantedTree(
  rows: readonly PlantedRow[],
  files: Record<string, string>,
): Record<string, string> {
  return {
    "scripts/metrics/crossings-registry.json": JSON.stringify(
      rows.map((row) => ({
        ...row,
        importer: "src/other.ts",
        kind: "vocabulary",
        reason: "planted",
      })),
    ),
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        module: "ES2022",
        moduleResolution: "bundler",
        strict: true,
        noEmit: true,
      },
      include: ["src/**/*.ts"],
    }),
    ...Object.fromEntries(
      Object.entries(files).map(([name, contents]) => [
        `src/${name}`,
        contents,
      ]),
    ),
  };
}

/**
 * Run the scan over a planted checkout, for the calls that are
 * expected to refuse. Its answer is not what those rows are about.
 * @param files - the checkout's files, keyed by root-relative path
 */
function scanning(files: Record<string, string>): void {
  inCheckout(files, (root) => unreadPublishedFields(root));
}

const DECLARATION =
  "export interface Held {\n  readonly kept: string;\n  readonly dropped: string;\n}\n";

const CONSTRUCTION =
  'import type { Held } from "./held.js";\nexport const make = (): Held => ({ kept: "a", dropped: "b" });\n';

describe("the unread published field check", () => {
  test("reports a field nothing reads, and not the one something does", () => {
    expect(
      scan([{ file: "src/held.ts", symbol: "Held" }], {
        "held.ts": DECLARATION,
        "make.ts": CONSTRUCTION,
        "read.ts":
          'import type { Held } from "./held.js";\nexport const of_ = (h: Held): string => h.kept;\n',
      }),
    ).toEqual(["Held.dropped"]);
  });

  test.each([
    [
      "destructuring",
      'import type { Held } from "./held.js";\nexport const of_ = (h: Held): string => {\n  const { dropped } = h;\n  return dropped;\n};\n',
    ],
    [
      "an indexed access with a literal key",
      'import type { Held } from "./held.js";\nexport const of_ = (h: Held): string => h["dropped"];\n',
    ],
  ])("counts %s as a read", (_name, reader) => {
    expect(
      scan([{ file: "src/held.ts", symbol: "Held" }], {
        "held.ts": DECLARATION,
        "make.ts": CONSTRUCTION,
        "read.ts": reader,
        "kept.ts":
          'import type { Held } from "./held.js";\nexport const of_ = (h: Held): string => h.kept;\n',
      }),
    ).toEqual([]);
  });

  // The whole point of the check: `ListHost.source` was constructed in
  // one file and read in none, and a scan that called the construction
  // a reference would have called it fine.
  test("does NOT count an object literal's key as a read", () => {
    expect(
      scan([{ file: "src/held.ts", symbol: "Held" }], {
        "held.ts": DECLARATION,
        "make.ts": CONSTRUCTION,
      }),
    ).toEqual(["Held.kept", "Held.dropped"]);
  });

  // The one exempt CLASS: every field of the AST is read by
  // `JSON.stringify`, by Prettier's traversal and by the cursor
  // machinery, and no such read is a property access this scan sees.
  test("exempts a serialized type wholesale", () => {
    expect(
      scan([{ file: "src/ast.ts", symbol: "Held" }], {
        "ast.ts": DECLARATION,
        "make.ts":
          'import type { Held } from "./ast.js";\nexport const make = (): Held => ({ kept: "a", dropped: "b" });\n',
      }),
    ).toEqual([]);
  });

  // The measured-nothing floor, and it is the whole reason the check
  // is allowed to be silent when it passes: a registered type whose
  // declaring file the project does not hold used to be a printed
  // diagnostic beside a clean report, which reads as a pass. It
  // THROWS, and the CLI turns that into exit 2.
  test("refuses a registered type its project does not hold", () => {
    const files = plantedTree([{ file: "scripts/held.ts", symbol: "Held" }], {
      "other.ts": "export const x = 1;\n",
    });
    expect(() => {
      scanning(files);
    }).toThrow(/scripts\/held\.ts: not in tsconfig\.json's project/v);
  });

  // The same floor on the project itself: no `tsconfig.json` means no
  // field was examined, which is not the same claim as no field being
  // unread.
  test("refuses a tree whose project does not parse", () => {
    expect(() => {
      scanning({ "src/held.ts": DECLARATION });
    }).toThrow(/tsconfig\.json: the project did not parse/v);
  });
});
