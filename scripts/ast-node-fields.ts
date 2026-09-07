/**
 * The tree's shape as the PRINTED node kinds see it: for each `type`
 * discriminant `src/ast.ts` declares, every field a node of that kind
 * carries.
 *
 * WHY IT EXISTS. Three harnesses key tables on `<node type>.<field>`
 * strings - the reparse lens (tests/conformance/reparse.ts), the
 * parity gate's blanket families (scripts/parity-ledger.ts) and the
 * fact census's own keys (scripts/fact-inventory.ts). Each of those
 * strings is a hand copy of part of the tree, and a copy that names
 * nothing is worse than no row at all: a lens row nothing matches
 * silently gives its field the widest licence there is, and a blanket
 * family whose key names nothing strips nothing from either side of
 * the comparison it was written to bound. Nothing in the tree said
 * so. Derived from the declarations, a rename is a failed gate.
 *
 * KEYED BY THE DISCRIMINANT AND NOT BY THE INTERFACE, because that is
 * what the harnesses have: they read parsed trees, where a node knows
 * its `type` and not the name of the interface it satisfies. Five
 * interfaces share `type: "delimitedBlock"`, so that key's fields are
 * the UNION of the five - the same widening the runtime has, since a
 * value with that discriminant may be any of them.
 *
 * INHERITED FIELDS COUNT. `Node` and `ItemBody` are not exported and
 * declare no `type` of their own, and their fields (`position`,
 * `trailingContinuation`, `everyTextLineIndented`) end up on real
 * nodes all the same; a table keyed on what a node CARRIES has to
 * follow the `extends` clause to see them.
 *
 * FIELD ORDER IS DECLARATION ORDER: a shape's own properties as
 * written, then each base's, in `extends` order. The key-order pins
 * (tests/parser/reader-helpers.ts, `declaredKeyOrder`) read it, so it
 * is part of what this module promises and not an accident of the
 * walk.
 *
 * THE DISCRIMINANT MUST BE A STRING LITERAL ON THE INTERFACE ITSELF.
 * A kind that inherited its `type` from a base, fixed it to a union
 * (`type: "a" | "b"`), or was declared as an intersection or a
 * type-literal alias would get no key here. `src/ast.ts` writes none
 * of those today. The failure mode if one arrives is a false RED (a
 * lens row or a key-order pin naming a kind this table does not
 * have), never a false green, so the gate that uses this table is the
 * thing that reports it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

/** Where the AST types live; the same one source of truth as the census. */
const AST_FILE = "src/ast.ts";

/** One interface's own property names and the interfaces it extends. */
interface Shape {
  /** The property names declared directly on it. */
  readonly own: readonly string[];
  /** The names of the interfaces it extends, in declaration order. */
  readonly extended: readonly string[];
  /** The string its `type` property is fixed to, when it fixes one. */
  readonly discriminant: string | undefined;
}

/**
 * The literal string a `type: "..."` property signature fixes, or
 * undefined for a property that is not a fixed discriminant.
 * @param member - one member of an interface
 * @returns the discriminant value
 */
function discriminantOf(member: ts.TypeElement): string | undefined {
  if (
    !ts.isPropertySignature(member) ||
    !ts.isIdentifier(member.name) ||
    member.name.text !== "type" ||
    member.type === undefined ||
    !ts.isLiteralTypeNode(member.type) ||
    !ts.isStringLiteral(member.type.literal)
  ) {
    return undefined;
  }
  return member.type.literal.text;
}

/**
 * Read one interface declaration into a {@link Shape}.
 * @param declaration - the interface
 * @returns its own properties, its bases, and its discriminant
 */
function shapeOf(declaration: ts.InterfaceDeclaration): Shape {
  const own: string[] = [];
  let discriminant: string | undefined = undefined;
  for (const member of declaration.members) {
    if (ts.isPropertySignature(member) && ts.isIdentifier(member.name)) {
      own.push(member.name.text);
    }
    discriminant ??= discriminantOf(member);
  }
  const extended = (declaration.heritageClauses ?? []).flatMap((clause) =>
    clause.types
      .map((one) => one.expression)
      .filter((one) => ts.isIdentifier(one))
      .map((one) => one.text),
  );
  return { own, extended, discriminant };
}

/**
 * Every field one shape carries, its bases' included.
 *
 * `seen` stops a cycle in the `extends` graph from recursing forever.
 * TypeScript rejects such a cycle, so this cannot fire on a file that
 * compiles; it is here because a walker over text has no compiler
 * behind it, and a harness that hung on a malformed file would be
 * worse than one that reported a short answer.
 * @param name - the interface to read
 * @param shapes - every interface in the file, by name
 * @param seen - the names already being read on this path
 * @returns the field names, with duplicates possible
 */
function fieldsOf(
  name: string,
  shapes: ReadonlyMap<string, Shape>,
  seen: ReadonlySet<string>,
): string[] {
  const shape = shapes.get(name);
  if (shape === undefined || seen.has(name)) {
    return [];
  }
  const deeper = new Set([...seen, name]);
  return [
    ...shape.own,
    ...shape.extended.flatMap((base) => fieldsOf(base, shapes, deeper)),
  ];
}

/**
 * Every field a node of each `type` carries.
 *
 * Exported for the harnesses that key tables on `<type>.<field>` and
 * for its unit tests (tests/scripts/ast-node-fields.test.ts).
 * @param root - the repository root
 * @returns discriminant to the fields a node with it carries
 */
export function nodeFieldsByType(
  root: string,
): ReadonlyMap<string, ReadonlySet<string>> {
  const file = path.join(root, AST_FILE);
  const text = readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const shapes = new Map<string, Shape>();
  for (const statement of source.statements) {
    if (ts.isInterfaceDeclaration(statement)) {
      shapes.set(statement.name.text, shapeOf(statement));
    }
  }
  const byType = new Map<string, Set<string>>();
  for (const [name, shape] of shapes) {
    if (shape.discriminant === undefined) {
      continue;
    }
    const held = byType.get(shape.discriminant) ?? new Set<string>();
    for (const field of fieldsOf(name, shapes, new Set())) {
      held.add(field);
    }
    byType.set(shape.discriminant, held);
  }
  return byType;
}
