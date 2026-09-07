/**
 * The printer-read scan (`scripts/fact-inventory-reads.ts`) against
 * PLANTED trees.
 *
 * The real checkout can only say "no claim is false today", and
 * `tests/scripts/fact-inventory.test.ts` says exactly that. A check
 * whose only evidence is its own tree reading clean is a check that
 * could equally be broken, which is the reason
 * `tests/scripts/metrics-unread-fields.test.ts` gives for planting a
 * tree, so the controls here are both directions: a planted read is
 * FOUND, and a planted construction that is not a read is not. The
 * real checkout appears once all the same, to PIN the counts the #222
 * narrowing argues from, because a number measured by hand and
 * written into prose is the failure issue #204 records.
 *
 * The planted trees are the smallest thing the scan accepts - one AST
 * file and one printer file that imports it - because what is being
 * proved is that the compiler resolves a read to the row it belongs
 * to, not anything about AsciiDoc.
 */
import { describe, expect, test } from "vitest";
import {
  EXEMPT,
  UNREAD_CLAIMS,
} from "../../scripts/fact-inventory-classification.js";
import {
  printerReads,
  unreadClaimFailures,
} from "../../scripts/fact-inventory-reads.js";
import { REPO_ROOT } from "../../scripts/metrics/model.js";
import { inCheckout } from "../lib/checkout.js";

/**
 * One reason that ASSERTS the printer does not read the field. Which
 * of the two the planted row carries does not matter: the scan holds
 * the set, and a member of it is what a real row would carry.
 */
const [UNREAD_CLAIM] = [...UNREAD_CLAIMS];

/**
 * A minimal `src/ast.ts`: two shapes whose property names COLLIDE, so
 * a scan that matched names rather than declarations would attribute
 * a read of one to the other. That is the confusion that made a text
 * search unusable here (`Location.line` against
 * `DescriptionTermNode.line`), so the control carries it.
 * @returns the file's text
 */
function plantedAst(): string {
  return [
    "export interface PlantedInner {",
    "  line: number;",
    "}",
    "",
    "export interface PlantedNode {",
    '  type: "planted";',
    "  inner: PlantedInner;",
    "  line: string;",
    "}",
    "",
  ].join("\n");
}

/**
 * A minimal `src/print/planted.ts` around one body.
 * @param body - the statements the printer function runs
 * @returns the file's text
 */
function plantedPrinter(body: string): string {
  return [
    'import type { PlantedNode } from "../ast.js";',
    "",
    "export function print(node: PlantedNode): string {",
    body,
    "}",
    "",
  ].join("\n");
}

/**
 * The census keys the scan resolved, without their read sites.
 * @param files - the planted tree
 * @returns every key read, deduplicated and sorted
 */
function keysRead(files: Record<string, string>): string[] {
  return inCheckout(files, (root) => [
    ...new Set(printerReads(root).map((read) => read.key)),
  ]).toSorted();
}

/**
 * The exempt rows the printer reads, as of this commit: the premise
 * any narrowing of a read gate over this census has to argue from,
 * PINNED rather than quoted.
 *
 * The narrowing is argued in prose, and a prose number measured once
 * by hand is exactly what issue #204 is about: the first version of
 * these figures was measured against a resolver that stopped at the
 * first matching declaration, and the shipped one refutes it.
 * Pinning them beside the scan means no prose that quotes them can
 * go stale without a test saying so.
 *
 * READS is the count of rows, not of read sites: a property shared
 * across a union's arms resolves to one symbol with several
 * declarations and is recorded against every arm, which is most of
 * the distance between this number and the 35 rows that are read at
 * a source line resolving to exactly one row.
 */
const EXEMPT_ROWS_READ = 126;

/**
 * How many of those are read at a line that resolved to one row.
 *
 * 35 -> 37 when the whitespace record landed, and neither arrival is
 * a new READ: `ParagraphNode.children` and `AdmonitionNode.text` were
 * already read at the `inlineAtoms` call sites, on a line that also
 * carried `node.position.start.line` and so resolved to two rows. The
 * record adds an argument, the call breaks across lines, and the
 * carrier field now sits on a line of its own. `EXEMPT_ROWS_READ` is
 * unmoved at 126, which is what says no row started being read.
 */
const EXEMPT_ROWS_READ_UNAMBIGUOUSLY = 37;

describe("the real checkout", () => {
  test("realizes the pinned exempt-rows-read counts", () => {
    const reads = printerReads(REPO_ROOT);
    const read = new Set(reads.map((entry) => entry.key));
    const exemptRead = [...EXEMPT.keys()].filter((key) => read.has(key));
    expect(
      exemptRead,
      `exempt rows read under src/print, of ${String(EXEMPT.size)}; correct the prose that quotes this number as well as the pin`,
    ).toHaveLength(EXEMPT_ROWS_READ);

    // The fan-out half, so a reader who re-derives the number from a
    // resolver that stops at the first declaration can see which one
    // of the two they measured.
    const keysPerLine = new Map<string, Set<string>>();
    for (const entry of reads) {
      keysPerLine.set(
        entry.where,
        (keysPerLine.get(entry.where) ?? new Set()).add(entry.key),
      );
    }
    const alone = new Set<string>();
    for (const [, keys] of keysPerLine) {
      if (keys.size === 1) {
        alone.add([...keys][0]);
      }
    }
    expect(exemptRead.filter((key) => alone.has(key))).toHaveLength(
      EXEMPT_ROWS_READ_UNAMBIGUOUSLY,
    );
  });
});

describe("printerReads on a planted tree", () => {
  test("resolves a nested read to the shape that declares it", () => {
    expect(
      keysRead({
        "src/ast.ts": plantedAst(),
        "src/print/planted.ts": plantedPrinter(
          "  return String(node.inner.line);",
        ),
      }),
    ).toEqual(["PlantedInner.line", "PlantedNode.inner"]);
  });

  test("resolves a destructuring binding", () => {
    // The symbol at a binding name is the LOCAL, not the property, so
    // a scan that only asked `getSymbolAtLocation` would report this
    // tree as reading nothing at all.
    expect(
      keysRead({
        "src/ast.ts": plantedAst(),
        "src/print/planted.ts": plantedPrinter(
          "  const { line } = node;\n  return line;",
        ),
      }),
    ).toEqual(["PlantedNode.line"]);
  });

  test("reaches a printer file in a subdirectory", () => {
    // src/print/ is flat today, so this is the control for the day it
    // is not: a flat listing would report this tree as reading
    // nothing and the gate above it would print "every claim held".
    expect(
      keysRead({
        "src/ast.ts": plantedAst(),
        "src/print/nested/planted.ts": [
          'import type { PlantedNode } from "../../ast.js";',
          "",
          "export function print(node: PlantedNode): string {",
          "  return node.line;",
          "}",
          "",
        ].join("\n"),
      }),
    ).toEqual(["PlantedNode.line"]);
  });

  test("does not count a construction or an assignment", () => {
    // An object literal names the field and reads nothing; the left
    // side of an assignment writes it. Counting either would make
    // every field on every node look read, and the gate above it
    // would then never fire.
    expect(
      keysRead({
        "src/ast.ts": plantedAst(),
        "src/print/planted.ts": plantedPrinter(
          [
            "  const made: PlantedNode = {",
            '    type: "planted",',
            "    inner: { line: 1 },",
            '    line: "",',
            "  };",
            '  made.line = "x";',
            '  return "";',
          ].join("\n"),
        ),
      }),
    ).toEqual([]);
  });
});

describe("the scan stops rather than going half blind", () => {
  // Both throws exist so a partial scan can never be reported as a
  // clean one, and neither is reachable on this repository, so a
  // refactor back to a skip would leave every other test green. These
  // are the controls that would go red instead.

  test("throws when src/ast.ts is not in the program", () => {
    // Without it, every property access resolves to nothing and the
    // scan returns a confident empty answer.
    expect(() =>
      inCheckout(
        { "src/print/planted.ts": "export const printed = 1;\n" },
        printerReads,
      ),
    ).toThrow("src/ast.ts: not in the program, so no read resolves");
  });

  test("throws on a printer file it opened but cannot read", () => {
    // A DIRECTORY named like a printer file: the listing offers it,
    // the program is opened with it, and the compiler has no source
    // for it. Skipping that file is the silent blindness the throw
    // refuses, and no read floor is tight enough to notice it.
    expect(() =>
      inCheckout(
        {
          "src/ast.ts": plantedAst(),
          "src/print/decoy.ts/inner.txt": "not a printer\n",
        },
        printerReads,
      ),
    ).toThrow(
      "src/print/decoy.ts: not in the program, so its reads are invisible",
    );
  });
});

describe("unreadClaimFailures on a planted tree", () => {
  /** The planted tree whose printer reads `PlantedNode.line`. */
  const READING = {
    "src/ast.ts": plantedAst(),
    "src/print/planted.ts": plantedPrinter("  return node.line;"),
  };

  test("reports a row that claims the printer does not read it", () => {
    const failures = inCheckout(READING, (root) =>
      unreadClaimFailures(root, new Map([["PlantedNode.line", UNREAD_CLAIM]])),
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("PlantedNode.line");
    expect(failures[0]).toContain("src/print/planted.ts:4");
  });

  test("leaves a row alone whose reason claims nothing about reads", () => {
    // The five other EXEMPT reasons are judgements about what a read
    // MEANS, and a scan cannot settle those - a discriminant and a
    // leaf string are read by every printer there is. Reporting them
    // would make the check fire on 126 of the tree's own 155 exempt
    // rows (pinned by "the exempt rows this printer reads" below) and
    // teach reviewers to ignore it.
    const failures = inCheckout(READING, (root) =>
      unreadClaimFailures(
        root,
        new Map([["PlantedNode.line", "verbatim leaf content"]]),
      ),
    );
    expect(failures).toEqual([]);
  });

  test("holds a true claim to be true", () => {
    const failures = inCheckout(
      {
        "src/ast.ts": plantedAst(),
        "src/print/planted.ts": plantedPrinter("  return node.type;"),
      },
      (root) =>
        unreadClaimFailures(
          root,
          new Map([["PlantedNode.line", UNREAD_CLAIM]]),
        ),
    );
    expect(failures).toEqual([]);
  });
});
