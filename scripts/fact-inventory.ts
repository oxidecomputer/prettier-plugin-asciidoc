/**
 * The RECORDED-FACT census: every field `src/ast.ts` declares,
 * classified as either a recorded fact the printer prints bytes FROM
 * (the proof shape the decision-cells record names: "the printer
 * writes bytes from which the reader re-derives this fact", landed
 * three times already: #181's continuation count at
 * `ItemBody.trailingContinuation` (`tests/format/trailing-continuation.test.ts`),
 * #178's withheld tail at the `.detachedTail`-shaped case in
 * `tests/format/description-list.test.ts`, and #175's ignore pragma at
 * `BlockNodeBase.ignoredByPragma` (`tests/format/ignore-pragma.test.ts`,
 * where the pragma COMMENT is the surviving line a second read
 * re-derives the mark from); see the ledger's three
 * `landedLemma: true` rows for the exact citations) or EXEMPT, with a
 * reason. The shape is `scripts/metrics/shape-census.ts`'s: enumerate every
 * property mechanically, classify every one of them by hand, and fail
 * when the two disagree in EITHER direction: a new field with no
 * row, or a row that names a field `src/ast.ts` no longer declares.
 *
 * WHERE THE TWO HALVES ARE WRITTEN. A FACT is one row in
 * `scripts/fact-inventory-ledger.json`, whose key set IS the fact set
 * and whose `reason` is the classification; an EXEMPT field is one
 * row in `scripts/fact-inventory-classification.ts`. A fact used to
 * be written in both files, with nothing comparing the two key sets,
 * so a landing fact could be classified in one and forgotten in the
 * other; the ledger is now the only place a fact is named.
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
 * visible rename in the classification, not a silent no-op.
 *
 * NO MERGING ACROSS SIBLING UNION MEMBERS. `DelimitedBlockNode` is
 * five interfaces sharing field names (`annotatedBy` on all five,
 * `variant`/`form` differently typed on each); this census counts
 * each interface's own declaration separately rather than collapsing
 * "the same field name" into one row. That inflates the count past a
 * concept-level tally, but it is the mechanical, driftproof answer: a
 * merge is a THIRD hand-maintained list (the merge table itself) that
 * could disagree with both the classification and the source,
 * which is exactly the failure mode this file exists to close off.
 *
 * THE FACT CRITERION, applied field by field rather than declared
 * once and trusted: a field is a FACT when some function under
 * `src/print/` reads it via a targeted property access to choose
 * between at least two different output shapes — not the traversal
 * dispatch every node's own `type` gets, and not a leaf string
 * (`value`, `content`, `title`, `name`, `target`, `attrlist`, a role)
 * that the printer copies out unconditionally with no branch on its
 * own identity. Every row of both halves was checked against an
 * actual `grep -rn` of `src/print/*.ts` for that property name
 * before it was written down (not merely inferred
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
 *   carries (by its own doc comment first, and by the shared reason
 *   `scripts/printer-reads.ts` holds since).
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
 * - `Node.position`, `Location.line` and `Location.column` were the
 *   surprise that broke the hand method (issue #204). All three were
 *   EXEMPT under a reason that said the printer did not read them,
 *   and all three are read in eight printer files: adjacency
 *   (`startsOnTheNextLine`, `src/print/join.ts`), the dlist reflow
 *   guard (`firstSourceLineWordCount`, `src/print/text-edges.ts`),
 *   the cut that makes a description's opening image
 *   (`openingImage`, `src/print/description-list.ts`) and the
 *   column-1 test that keeps a lone `+` from folding
 *   (`opensWithContinuationLine`, `src/print/inline.ts`).
 *
 *   WHAT SURVIVES INTO THE OUTPUT, since a decision made from bytes
 *   that do not survive is the one shape this project outlaws: what
 *   these three feed is never the coordinate but a PREDICATE over
 *   two of them - were these blocks adjacent, does this text begin
 *   at column 1, where on the term's line does the description
 *   start. The byte that carries the predicate is the blank line's
 *   presence, or the indentation, and the printer re-emits it, so
 *   pass 2 re-derives the same predicate from different absolute
 *   coordinates. That is also exactly why the reparse lens must go
 *   on dropping `*.position` while the fields stay FACTS: an
 *   absolute coordinate is not comparable across a reformat, and the
 *   predicate over it is.
 *
 * HONEST BOUNDS. This is a snapshot of a manual classification,
 * mechanically checked for completeness (every field is somewhere)
 * and currency (no row names a field that is gone) but not, in
 * general, for the classification's own correctness: a FACT wrongly
 * called EXEMPT, or the reverse, passes this gate silently. The one
 * part that IS checked is the part that is a claim rather than a
 * judgement: an EXEMPT reason asserting that nothing under
 * `src/print/` reads the field is held to the compiler by
 * `scripts/fact-inventory-reads.ts`, which is what #204 cost. A field
 * read through a computed property, a spread, or `Object.entries` is
 * invisible to that scan the same way
 * `scripts/metrics/unread-fields.ts` says a hand-rolled reference
 * scan is.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { EXEMPT } from "./fact-inventory-classification.js";
import { isArray, isObject, parseJson } from "./metrics/json.js";

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
  /**
   * Character offset of the property NAME in `src/ast.ts`.
   *
   * The one coordinate a resolved symbol hands back, so it is what
   * `scripts/fact-inventory-reads.ts` matches a printer's read
   * against. Recorded here rather than re-walked there: a second walk
   * could accept a shape this one does not and key a read to a row
   * the census never made.
   */
  readonly offset: number;
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
      const offset = member.name.getStart();
      const { line } = source.getLineAndCharacterOfPosition(offset);
      out.push({ owner, property: member.name.text, line: line + 1, offset });
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
 * One field's classification key, `Owner.property`: what the EXEMPT
 * map is keyed by, and what the ledger
 * (`scripts/fact-inventory-ledger.json`) names each fact by.
 * @param field - the field
 * @returns its key
 */
export function factKey(field: AstField): string {
  return `${field.owner}.${field.property}`;
}

/**
 * The FACTS half of the classification, read from the ledger's own
 * key set: fact key to the reason it is a fact.
 *
 * ONE FILE PER FACT is the whole point. The reasons used to live in a
 * map beside `EXEMPT` (scripts/fact-inventory-classification.ts) whose
 * 74 keys were the ledger's 74 keys,
 * so a landing fact was written in two files and the two could
 * disagree - one of them silently, because nothing compared them.
 * Reading the ledger makes the key set the same set by construction.
 *
 * A row that does not read as an object still contributes its key,
 * so an unreadable row is a classified field with a complaint rather
 * than an unclassified one with two.
 * @param root - the repository root
 * @returns fact key to reason, over whatever the ledger holds
 */
export function factReasons(root: string): ReadonlyMap<string, string> {
  const facts = readJsonObject(root, LEDGER_FILE)?.facts;
  const rows = isObject(facts) ? facts : {};
  return new Map(
    Object.entries(rows).map(([key, row]) => [
      key,
      stringAt(row, "reason") ?? "",
    ]),
  );
}

/**
 * How one declared field is classified, or is not.
 *
 * Split out of {@link factInventoryFailures} to stay under the
 * complexity ceiling; the three arms are independent, so a field can
 * earn more than one and the caller keeps them all.
 * @param field - the declared field
 * @param facts - the ledger's fact key to reason map
 * @returns one message per way this field's classification is wrong
 */
function classificationFailures(
  field: AstField,
  facts: ReadonlyMap<string, string>,
): string[] {
  const key = factKey(field);
  const inFacts = facts.has(key);
  const inExempt = EXEMPT.has(key);
  const failures: string[] = [];
  if (!inFacts && !inExempt) {
    failures.push(
      `fact inventory: ${key} (${AST_FILE}:${String(field.line)}) is classified as neither a recorded fact nor exempt - add a row to ${LEDGER_FILE} if it is a fact, or to EXEMPT in scripts/fact-inventory-classification.ts if it is not`,
    );
  }
  if (inFacts && inExempt) {
    failures.push(
      `fact inventory: ${key} has a row in ${LEDGER_FILE} and one in EXEMPT in scripts/fact-inventory-classification.ts`,
    );
  }
  if (inFacts && facts.get(key) === "") {
    failures.push(
      `fact inventory: ${key}'s row in ${LEDGER_FILE} states no \`reason\`, which is the classification itself`,
    );
  }
  return failures;
}

/**
 * Every disagreement between `src/ast.ts` and the classification: a
 * field neither half names (new and unclassified, which is the gate a
 * growing `ast.ts` cannot silently pass), a field both halves name, a row
 * naming a field the file no longer declares (stale), and a ledger
 * row that states no reason.
 * @param root - the repository root
 * @returns one message per disagreement; empty means the census is green
 */
export function factInventoryFailures(root: string): string[] {
  const fields = astFields(root);
  const facts = factReasons(root);
  const present = new Set(fields.map(factKey));
  const failures: string[] = fields.flatMap((field) =>
    classificationFailures(field, facts),
  );
  for (const key of facts.keys()) {
    if (!present.has(key)) {
      failures.push(
        `fact inventory: ${LEDGER_FILE} names ${key}, which ${AST_FILE} no longer declares (stale row)`,
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
 * @returns the fact keys that the ledger names AND `src/ast.ts`
 *   currently declares, sorted
 */
export function recordedFacts(root: string): string[] {
  const present = new Set(astFields(root).map(factKey));
  return [...factReasons(root).keys()]
    .filter((key) => present.has(key))
    .toSorted();
}

/** Where the per-fact ledger lives; the checks below read it. */
export const LEDGER_FILE = "scripts/fact-inventory-ledger.json";

/** Where the reparse measurement writes the rows the ledger counts. */
export const REPARSE_LEDGER_FILE = "tests/conformance/reparse-ledger.json";

/**
 * The legal values of a ledger row's `basis`: how strongly a fact is
 * tied to the reparse family it names.
 *
 * "measured": the fact's own lemma is red-detectable, and re-running
 * the reparse measurement over the whole population moves that
 * family's rows and no others. "argued": the family's written
 * mechanism and the fact's written purpose name the same thing, with
 * nobody having traced a row. "argued-not-counted": a connection
 * considered and rejected as too thematic, recorded rather than
 * dropped silently, and worth nothing to the scoreboard.
 *
 * A CLOSED list because the scoreboard sums by it: a misspelt basis
 * would be neither counted nor complained about, which is the one way
 * that file can be wrong with nothing saying so. Module-private: the
 * gate {@link ledgerFailures} is the whole of what a caller needs, and
 * a second reader of the list would be a second place it could drift.
 */
const FACT_BASES = ["measured", "argued", "argued-not-counted"] as const;

/**
 * The string a JSON object holds at `key`, or undefined for anything
 * else. The one narrowing the ledger checks need, spelled as a
 * predicate rather than an `as` assertion (scripts/metrics/json.ts
 * states why the measuring tools may not cheat on the thing they
 * measure).
 * @param value - anything, typically straight out of `JSON.parse`
 * @param key - the property to read
 * @returns the string value, or undefined
 */
function stringAt(value: unknown, key: string): string | undefined {
  if (!isObject(value)) {
    return undefined;
  }
  const held = value[key];
  return typeof held === "string" ? held : undefined;
}

/**
 * The parsed JSON object at a repo-relative path, or undefined when
 * the file does not hold one.
 * @param root - the repository root
 * @param file - the repo-relative file to read
 * @returns the object, or undefined
 */
function readJsonObject(
  root: string,
  file: string,
): Record<string, unknown> | undefined {
  const absolute = path.join(root, file);
  // A checkout without the file is a checkout the caller reports on,
  // not a throw: {@link factReasons} runs against planted trees that
  // hold only the files their row is about.
  if (!existsSync(absolute)) {
    return undefined;
  }
  const parsed = parseJson(readFileSync(absolute, "utf8"));
  return isObject(parsed) && !isArray(parsed) ? parsed : undefined;
}

/**
 * How many rows the reparse measurement currently holds per family.
 * @param root - the repository root
 * @returns family name to row count, over the rows actually in the file
 */
function measuredFamilySizes(root: string): Map<string, number> {
  const sizes = new Map<string, number>();
  const rows = readJsonObject(root, REPARSE_LEDGER_FILE)?.rows;
  for (const row of isArray(rows) ? rows : []) {
    const family = stringAt(row, "family");
    if (family !== undefined) {
      sizes.set(family, (sizes.get(family) ?? 0) + 1);
    }
  }
  return sizes;
}

/**
 * Every claim in the ledger naming a `basis` outside
 * {@link FACT_BASES} or a `family` the reparse ledger does not
 * declare.
 *
 * Both halves fail the same way and so are checked together: a
 * misspelt basis is summed by nothing and complained about by
 * nothing, and a misspelt family names a mechanism that does not
 * exist, so the claim reads as attribution while explaining a family
 * no row can ever be tagged with. `reparseFamilySizes` was already
 * held to the declared names; the per-fact claims that spend those
 * names were not.
 * @param facts - the ledger's `facts` map, unnarrowed
 * @param declared - every family name the reparse ledger declares
 * @returns one message per illegal basis or undeclared family
 */
function claimFailures(facts: unknown, declared: readonly string[]): string[] {
  const legal: readonly string[] = FACT_BASES;
  const failures: string[] = [];
  for (const [key, row] of Object.entries(isObject(facts) ? facts : {})) {
    const claims = isObject(row) ? row.reparseFamilies : undefined;
    for (const claim of isArray(claims) ? claims : []) {
      const basis = stringAt(claim, "basis");
      if (basis !== undefined && !legal.includes(basis)) {
        failures.push(
          `fact inventory: ${key} claims a reparse family on basis "${basis}", which is not one of ${legal.join(", ")} (${LEDGER_FILE})`,
        );
      }
      const family = stringAt(claim, "family");
      if (family !== undefined && !declared.includes(family)) {
        failures.push(
          `fact inventory: ${key} claims the family "${family}", which ${REPARSE_LEDGER_FILE}'s own enumeration does not declare (${LEDGER_FILE})`,
        );
      }
    }
  }
  return failures;
}

/**
 * Every disagreement between `reparseFamilySizes` and the rows it
 * mirrors, in both directions.
 *
 * A family a fix has EMPTIED still has a name and still owes a zero:
 * dropping its key would make the map silently smaller rather than
 * visibly done, and a key naming no declared family is a typo nothing
 * else in the tree would catch. Nothing validated this map before, and
 * the number it held went stale the moment a fix emptied a family.
 * @param recorded - the ledger's `reparseFamilySizes`, unnarrowed
 * @param measured - the live per-family row counts
 * @param declared - every family name the reparse ledger declares
 * @returns one message per disagreement
 */
function familySizeFailures(
  recorded: unknown,
  measured: Map<string, number>,
  declared: readonly string[],
): string[] {
  const sizes = isObject(recorded) ? recorded : {};
  const failures = declared
    .filter((family) => sizes[family] !== (measured.get(family) ?? 0))
    .map(
      (family) =>
        `fact inventory: reparseFamilySizes.${family} records ${JSON.stringify(sizes[family])}, and ${REPARSE_LEDGER_FILE} holds ${String(measured.get(family) ?? 0)} row(s) in that family (${LEDGER_FILE})`,
    );
  return [
    ...failures,
    ...Object.keys(sizes)
      .filter((family) => !declared.includes(family))
      .map(
        (family) =>
          `fact inventory: reparseFamilySizes names ${family}, which ${REPARSE_LEDGER_FILE}'s own enumeration does not declare (${LEDGER_FILE})`,
      ),
  ];
}

/**
 * Every way the ledger disagrees with what it counts: a `basis`
 * outside the closed list, a claimed `family` the reparse ledger does
 * not declare, and a `reparseFamilySizes` entry that does not match
 * the reparse ledger it mirrors.
 *
 * Separate from {@link factInventoryFailures}, which is about
 * `src/ast.ts` and the classification map: this one is about the
 * ledger file's own interior, and neither check can be answered from
 * the AST at all.
 * @param root - the repository root
 * @param declared - every family name the reparse ledger declares
 * @returns one message per disagreement; empty means the ledger agrees
 *   with what it counts
 */
export function ledgerFailures(
  root: string,
  declared: readonly string[],
): string[] {
  const ledger = readJsonObject(root, LEDGER_FILE);
  if (ledger === undefined) {
    return [`fact inventory: ${LEDGER_FILE} does not hold a JSON object`];
  }
  return [
    ...claimFailures(ledger.facts, declared),
    ...familySizeFailures(
      ledger.reparseFamilySizes,
      measuredFamilySizes(root),
      declared,
    ),
  ];
}
