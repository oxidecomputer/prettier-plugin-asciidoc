/**
 * The RECORDED-FACT census: every field `src/ast.ts` declares,
 * classified as either a recorded fact the printer prints bytes FROM
 * (the proof shape the decision-cells record names: "the printer
 * writes bytes from which the reader re-derives this fact", landed
 * twice already — #181's continuation count at
 * `ItemBody.trailingContinuation` (`tests/format/trailing-continuation.test.ts`)
 * and #178's withheld tail at the `.detachedTail`-shaped case in
 * `tests/format/description-list.test.ts`; see the ledger's two
 * `landedLemma: true` rows for the exact citations) or EXEMPT, with a
 * reason. The shape is `scripts/metrics/shape-census.ts`'s: enumerate every
 * property mechanically, classify every one of them by hand in a map
 * (`scripts/fact-inventory-classification.ts`), and fail when the two
 * disagree in EITHER direction — a new field with no row, or a row
 * that names a field `src/ast.ts` no longer declares.
 *
 * ENUMERATION. `astFields` walks `src/ast.ts` with the TypeScript
 * compiler (the same instrument `scripts/citations.ts` and
 * `scripts/metrics/unread-fields.ts` use), reading every
 * `PropertySignature` on every `interface` declaration and on every
 * `type` alias whose right side is an object literal or a union of
 * object literals. A union member with no interface name of its own
 * (`TableClose`, `TableCellOpening`, `TableCellRepeat`) is named
 * `Alias#index` by position — mechanical, not semantic, so two
 * differently-ordered members never collide and a reordering is a
 * visible rename in the classification map, not a silent no-op.
 *
 * NO MERGING ACROSS SIBLING UNION MEMBERS. `DelimitedBlockNode` is
 * five interfaces sharing field names (`annotatedBy` on all five,
 * `variant`/`form` differently typed on each); this census counts
 * each interface's own declaration separately rather than collapsing
 * "the same field name" into one row. That inflates the count past a
 * concept-level tally, but it is the mechanical, driftproof answer: a
 * merge is a THIRD hand-maintained list (the merge table itself) that
 * could disagree with both the classification map and the source,
 * which is exactly the failure mode this file exists to close off.
 *
 * THE FACT CRITERION, applied field by field rather than declared
 * once and trusted: a field is a FACT when some function under
 * `src/print/` reads it via a targeted property access to choose
 * between at least two different output shapes — not the traversal
 * dispatch every node's own `type` gets, and not a leaf string
 * (`value`, `content`, `title`, `name`, `target`, `attrlist`, a role)
 * that the printer copies out unconditionally with no branch on its
 * own identity. Every row in `scripts/fact-inventory-classification.ts`
 * was checked against an actual `grep -rn` of `src/print/*.ts` for
 * that property name before it was written down (not merely inferred
 * from the field's own doc comment), and several first impressions
 * did not survive that check:
 *
 * - `ListNode.marker` looked like a pure parse-time grouping key; it
 *   is read directly in `src/print/list.ts`'s `printedGap` to decide
 *   whether a nested list's trailing `+` folds into the gap above it.
 * - `TableNode.cutting`, `.columns`, `.header`, `.attrlistUnread`,
 *   `TableCellNode.repeat`/`.columnIndex`, and most of
 *   `TableCellOpening`'s and `TableTextRun`'s own fields looked like
 *   read-time bookkeeping a byte-replaying printer would not need;
 *   `src/print/table-layout.ts` reads nearly all of them to decide
 *   whether its own layout normalization may run at all (a real
 *   print-shape choice, not a convenience cache).
 * - `TableNode.footer`, `TableClose`'s `image` arm, and every
 *   `halign`/`valign` field are the opposite surprise: constructed at
 *   parse time and never read under `src/print` at all, so they are
 *   EXEMPT as unread rather than FACT, the same status `LinkNode.form`
 *   already carries by its own doc comment.
 * - `TableNode.header` is EXEMPT despite being read
 *   (`blankAfterFirstRow`): its own doc calls it "a total predicate
 *   over facts the reader already recorded", so its reparse safety is
 *   a property of THOSE facts, not an independent choice of its own.
 * - `TableCellOpening#0.spec` and `.separator` are the read-but-not-a-
 *   FACT case in the other direction, found on adversarial review: both
 *   are read only to be concatenated unconditionally into `cellImage`
 *   (`cell.spec + cell.separator + SEPARATOR_PAD + cell.text`,
 *   `src/print/table-layout.ts`), the same uniform-transform shape as
 *   `AdmonitionNode.variant`'s `.toUpperCase()`, never a branch on
 *   their own identity — CONTENT, not FACT, by this file's own
 *   criterion. The one field that DOES gate a branch (whether the
 *   opening is `"separator"` at all) is `.kind`, classified FACT
 *   correctly from the start.
 *
 * HONEST BOUNDS. This is a snapshot of a manual classification,
 * mechanically checked for completeness (every field is somewhere)
 * and currency (no row names a field that is gone) but not for the
 * classification's own correctness — a FACT wrongly called EXEMPT, or
 * the reverse, passes this gate silently. The `grep` verification
 * narrows that risk; it does not close it. A field read through a
 * computed property, a spread, or `Object.entries` is invisible to
 * the grep the same way `scripts/metrics/unread-fields.ts` says a
 * hand-rolled reference scan is.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { EXEMPT, FACTS } from "./fact-inventory-classification.js";

/** Where the AST types live; the enumeration's one source of truth. */
const AST_FILE = "src/ast.ts";

/** One property `src/ast.ts` declares, wherever it declares it. */
export interface AstField {
  /** The declaring interface, or `Alias#index` for an anonymous union member. */
  readonly owner: string;
  /** The property's own name. */
  readonly property: string;
  /** One-based source line, for a human to open. */
  readonly line: number;
}

/**
 * The property signatures declared directly on one shape.
 * @param owner - the name to record against each property
 * @param members - the shape's own member list
 * @param source - the parsed file, for line numbers
 * @param out - the running field list, appended to in place
 */
function collectMembers(
  owner: string,
  members: ts.NodeArray<ts.TypeElement>,
  source: ts.SourceFile,
  out: AstField[],
): void {
  for (const member of members) {
    if (ts.isPropertySignature(member) && ts.isIdentifier(member.name)) {
      const { line } = source.getLineAndCharacterOfPosition(
        member.name.getStart(),
      );
      out.push({ owner, property: member.name.text, line: line + 1 });
    }
  }
}

/**
 * Every property `src/ast.ts` declares, one row per `PropertySignature`
 * — interfaces (exported or not: `Node` and `ItemBody` are not
 * exported, and their fields end up on real nodes all the same) and
 * type aliases whose right side is an object literal or a union of
 * them.
 * @param root - the repository root
 * @returns the fields, in source order
 */
export function astFields(root: string): AstField[] {
  const file = path.join(root, AST_FILE);
  const text = readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const fields: AstField[] = [];
  for (const statement of source.statements) {
    if (ts.isInterfaceDeclaration(statement)) {
      collectMembers(statement.name.text, statement.members, source, fields);
    }
    if (ts.isTypeAliasDeclaration(statement)) {
      if (ts.isTypeLiteralNode(statement.type)) {
        collectMembers(
          statement.name.text,
          statement.type.members,
          source,
          fields,
        );
      }
      if (ts.isUnionTypeNode(statement.type)) {
        let index = 0;
        for (const member of statement.type.types) {
          if (ts.isTypeLiteralNode(member)) {
            collectMembers(
              `${statement.name.text}#${String(index)}`,
              member.members,
              source,
              fields,
            );
          }
          index += 1;
        }
      }
    }
  }
  return fields;
}

/**
 * One field's classification key, `Owner.property` — what the FACTS
 * and EXEMPT maps are keyed by, and what the ledger
 * (`scripts/fact-inventory-ledger.json`) names each fact by too.
 * @param field - the field
 * @returns its key
 */
export function factKey(field: AstField): string {
  return `${field.owner}.${field.property}`;
}

/**
 * Every disagreement between `src/ast.ts` and the classification map:
 * a field neither map names (new and unclassified — the gate a
 * growing `ast.ts` cannot silently pass), a field both maps name, or
 * a map row naming a field the file no longer declares (stale).
 * @param root - the repository root
 * @returns one message per disagreement; empty means the census is green
 */
export function factInventoryFailures(root: string): string[] {
  const fields = astFields(root);
  const present = new Set(fields.map(factKey));
  const failures: string[] = [];
  for (const field of fields) {
    const key = factKey(field);
    const inFacts = FACTS.has(key);
    const inExempt = EXEMPT.has(key);
    if (!inFacts && !inExempt) {
      failures.push(
        `fact inventory: ${key} (${AST_FILE}:${String(field.line)}) is classified as neither a recorded fact nor exempt — add a row to scripts/fact-inventory-classification.ts and, if it is a fact, a row to scripts/fact-inventory-ledger.json`,
      );
    }
    if (inFacts && inExempt) {
      failures.push(
        `fact inventory: ${key} is listed in both FACTS and EXEMPT in scripts/fact-inventory-classification.ts`,
      );
    }
  }
  for (const key of FACTS.keys()) {
    if (!present.has(key)) {
      failures.push(
        `fact inventory: FACTS names ${key}, which ${AST_FILE} no longer declares (stale row in scripts/fact-inventory-classification.ts)`,
      );
    }
  }
  for (const key of EXEMPT.keys()) {
    if (!present.has(key)) {
      failures.push(
        `fact inventory: EXEMPT names ${key}, which ${AST_FILE} no longer declares (stale row in scripts/fact-inventory-classification.ts)`,
      );
    }
  }
  return failures;
}

/**
 * The recorded facts themselves — the census's headline count.
 * @param root - the repository root
 * @returns the fact keys that are both classified as facts AND
 *   currently declared in `src/ast.ts`, sorted
 */
export function recordedFacts(root: string): string[] {
  const present = new Set(astFields(root).map(factKey));
  return [...FACTS.keys()].filter((key) => present.has(key)).toSorted();
}
