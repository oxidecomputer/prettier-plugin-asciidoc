/**
 * `print/declared-rules.ts` — the licensed-emission seam: the two arms
 * a span's delimiters can come out of, and what the one declared rule
 * says about itself.
 *
 * The bytes this rule writes are pinned elsewhere, by the gates its
 * declaration names (the confluence rows, the inline sweep, the
 * boundary refusals). What is pinned HERE is the property those gates
 * cannot see: that a respelling arrives carrying the rule that
 * licensed it, that everything else arrives as a replay, and that the
 * capability to change bytes is not handed out anywhere else in the
 * tree.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { parse } from "../../src/parser.js";
import { narrow } from "../helpers.js";
import { spanDelimiters } from "../../src/print/declared-rules.js";
import { isSpanNode } from "../../src/print/span-edges.js";
import type { Emission } from "../../src/print/emission.js";
import type { Cursor } from "../../src/print/atom-join.js";
import type { InlineNode } from "../../src/ast.js";

/** Where the declared rules live, and the one file that may declare one. */
const RULES_FILE = "src/print/declared-rules.ts";

/** Where the capability itself is defined, and so may be named. */
const EMISSION_FILE = "src/print/emission.ts";

/** The tree whose files are scanned for the capability. */
const SOURCE_ROOT = "src";

/** Every module file kind, so a future `.mts` cannot slip the scan. */
const MODULE_FILE = /\.[cm]?ts$/v;

/**
 * The quoted specifier of the emission module, as a source file may
 * spell it.
 *
 * The extension is optional because the resolver treats it as
 * optional: under `moduleResolution: "bundler"` a bare
 * `"./emission"` reaches the module exactly as `"./emission.js"` does,
 * and nothing in the tree makes the suffix mandatory. Requiring it
 * here would leave the shorter spelling past both scans. The letters
 * before it are unconstrained but the ones after are not, so a module
 * whose name merely begins the same way (`"./emissions.js"`) is not
 * this one.
 */
const EMISSION_SPECIFIER = String.raw`"[^"]*emission(?:\.[cm]?js)?"`;

/**
 * An import, export or `require` whose specifier is the emission
 * module - the one door both constructors are behind, which is why one
 * pattern covers the licensed arm and the replay arm together.
 * `require` is a keyword here because the tree being ESM is a fact
 * about the tree today rather than a property this check may lean on.
 */
const EMISSION_STATEMENT = new RegExp(
  String.raw`(?:import|export|require)[^;]*?${EMISSION_SPECIFIER}`,
  "gv",
);

/**
 * The `type` keyword on the whole clause: `import type { Emission }`
 * and `export type { Emission } from` both construct nothing.
 */
const TYPE_CLAUSE = /^(?:import|export)\s+type\b/v;

/**
 * The specifier list of a named import or export, where that list is
 * the statement's whole clause. A default binding or a namespace
 * binding in front of it moves a value whatever the list says, so the
 * anchor is what keeps those out.
 */
const NAMED_CLAUSE = /^(?:import|export)\s*\{[^\}]*\}/v;

/** One specifier carrying the inline `type` keyword. */
const TYPE_SPECIFIER = /^type\s/v;

/**
 * The forms that hand a constructor on under the rules module's own
 * name. Three arms because they see different things: a specifier
 * list, a redeclaration, and the star form, which has no specifier
 * list at all and republishes both constructors in one line.
 */
const RE_EXPORT_PATTERNS: readonly RegExp[] = [
  /export\s*\{[^\}]*\b(?:replay|declareRule)\b/v,
  /export\s+(?:const|function)\s+(?:replay|declareRule)\b/v,
  // Built rather than written out so the specifier it accepts is the
  // same one the import scan accepts, extension and all.
  new RegExp(String.raw`export\s*\*[^;]*?${EMISSION_SPECIFIER}`, "v"),
];

/**
 * A rule's declaration, named off the exported emission type rather
 * than off a second export made for this file: the rules module
 * publishes no route to a rule except the emission it answers with, and
 * this test reads it the way the printer does.
 */
type Declaration = Exclude<Emission<unknown>["licence"], string>;

/**
 * The inline children of a document's first paragraph.
 * @param source - the document
 * @returns its inline nodes, in order
 */
function inlineNodesOf(source: string): readonly InlineNode[] {
  const [block] = parse(source).children;
  narrow(block, "paragraph");
  return block.children;
}

/**
 * The delimiters the printer would write for the one span in a
 * document, asked exactly as `appendSpan` (src/print/inline.ts) asks.
 * @param source - a document holding one span among plain text
 * @param texts - the atom texts the span's content produces
 * @returns the emission the chokepoint answers with
 */
function spanEmissionOf(
  source: string,
  texts: readonly string[],
): Emission<{ readonly open: string; readonly close: string }> {
  const siblings = inlineNodesOf(source);
  const index = siblings.findIndex((node) => isSpanNode(node));
  const node = siblings[index];
  if (!isSpanNode(node)) {
    throw new Error(`no span in ${source}`);
  }
  const cursor: Cursor = {
    siblings,
    index,
    blockStartLine: 1,
    enclosing: undefined,
    blockNodes: siblings,
    blockStart: { atColumnZero: false, markInFront: undefined },
    literalInterior: false,
  };
  return spanDelimiters({ node, cursor, flush: true, texts });
}

/**
 * The declaration a respelled span arrives under.
 * @param source - a document whose one span the rule shortens
 * @param texts - the atom texts the span's content produces
 * @returns the rule's declaration, as the chokepoint hands it over
 */
function declarationOf(source: string, texts: readonly string[]): Declaration {
  const { licence } = spanEmissionOf(source, texts);
  if (licence === "replay") {
    throw new Error(`no declared rule licensed the span in ${source}`);
  }
  return licence;
}

describe("the doubled-mark respell declares itself", () => {
  test("with all five fields filled in", () => {
    const declaration = declarationOf("a **b** c\n", ["b"]);
    expect(declaration.id).toBe("doubled-mark respell");
    expect(declaration.matches.length).toBeGreaterThan(0);
    expect(declaration.licence).toContain("asciidoctor.rb");
    expect(declaration.pins.length).toBeGreaterThan(0);
  });

  // The orientation obligation from docs/architecture.md ("The
  // spelling reduction order"): a rule states the component it
  // strictly decreases, and the component has to be one the order
  // actually has.
  test("and the reduction-order component it decreases", () => {
    expect(declarationOf("a **b** c\n", ["b"]).decreases).toContain(
      "redundantSyntax",
    );
  });

  // A pin that names a file nobody kept is a pin that stopped
  // pinning, which is the way this field rots.
  test("naming gates that exist", () => {
    for (const pin of declarationOf("a **b** c\n", ["b"]).pins) {
      const [file] = pin.split(" ");
      expect(readdirSync(path.dirname(file))).toContain(path.basename(file));
    }
  });
});

describe("the emission a span's delimiters arrive in", () => {
  test("carries the rule where the respell fired", () => {
    const emission = spanEmissionOf("a **b** c\n", ["b"]);
    expect(emission.bytes).toEqual({ open: "*", close: "*" });
    expect(emission.licence).not.toBe("replay");
  });

  test("is a replay where the author already wrote the short form", () => {
    const emission = spanEmissionOf("a *b* c\n", ["b"]);
    expect(emission.bytes).toEqual({ open: "*", close: "*" });
    expect(emission.licence).toBe("replay");
  });

  // A span kind with only ONE spelling has no rule to match it, so it
  // takes the replay arm rather than a rule that answers "no change".
  test("and a replay for a span with nothing to choose", () => {
    const emission = spanEmissionOf('a "`b`" c\n', ["b"]);
    expect(emission.bytes).toEqual({ open: '"`', close: '`"' });
    expect(emission.licence).toBe("replay");
  });
});

/**
 * Whether one statement naming the emission module moves a value out
 * of it.
 *
 * A converted site that holds an emission in a typed local has to name
 * the type, so the type-only forms have to come back clean or this
 * check fails the migration it exists to protect. They are the `type`
 * keyword on the clause and the same keyword on every specifier; a
 * clause that mixes the two still moves the specifier that lacks it.
 * Anything else, `require` included, counts as a hold: where the scan
 * cannot read a clause it answers "holds" rather than guess.
 * @param statement - one import, export or require statement
 * @returns true where the statement hands over a constructor
 */
function movesValue(statement: string): boolean {
  if (TYPE_CLAUSE.test(statement)) {
    return false;
  }
  const clause = NAMED_CLAUSE.exec(statement);
  if (clause === null) {
    return true;
  }
  // The match runs from the keyword to the closing brace, so the
  // specifier list is exactly what stands between the two braces.
  const [matched] = clause;
  return matched
    .slice(matched.indexOf("{") + 1, -1)
    .split(",")
    .map((specifier) => specifier.trim())
    .some(
      (specifier) => specifier.length > 0 && !TYPE_SPECIFIER.test(specifier),
    );
}

/**
 * Whether a file's text holds the capability: it names the emission
 * module somewhere that moves a value out of it.
 * @param text - the file's source
 * @returns true where the file has a constructor in hand
 */
function holdsCapability(text: string): boolean {
  const statements = text.match(EMISSION_STATEMENT);
  return (statements ?? []).some((statement) => movesValue(statement));
}

/**
 * Whether a source text hands a constructor on under a name of its
 * own, by any of the forms that would republish one.
 * @param text - the file's source
 * @returns true where a consumer could reach a constructor through it
 */
function handsOn(text: string): boolean {
  return RE_EXPORT_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Every `src` file that imports a VALUE from the emission module -
 * every holder of the capability, as far as a specifier can see it.
 * @param directory - where to look
 * @returns the file paths, in walk order
 */
function capabilityHolders(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) {
      return capabilityHolders(full);
    }
    if (!MODULE_FILE.test(entry.name) || full === EMISSION_FILE) {
      return [];
    }
    return holdsCapability(readFileSync(full, "utf8")) ? [full] : [];
  });
}

/**
 * One statement form and what the scan must make of it.
 *
 * Both columns are load-bearing, in opposite directions. A form
 * wrongly cleared is a constructor loose in the tree; a form wrongly
 * flagged fails the migration this check exists to protect, because a
 * converted site that holds an emission in a typed local has to name
 * the type.
 */
interface ScannedStatement {
  /** The statement, spelled the way a source file would spell it. */
  readonly source: string;
  /** True where the form hands the file a constructor. */
  readonly holds: boolean;
}

const SCANNED_STATEMENTS: readonly ScannedStatement[] = [
  { source: `import { replay } from "./emission.js";`, holds: true },
  {
    source: `import { declareRule } from "../print/emission.js";`,
    holds: true,
  },
  { source: `export { replay } from "./emission.js";`, holds: true },
  { source: `import * as emission from "./emission.js";`, holds: true },
  // The extension is optional to the resolver, so it cannot be
  // required by the scan: `moduleResolution: "bundler"` reaches the
  // module by the shorter spelling just as well.
  { source: `import { replay } from "./emission";`, holds: true },
  // The near miss the optional extension opens up. A module whose name
  // merely starts with the same eight letters is a different module.
  { source: `import { emit } from "./emissions.js";`, holds: false },
  // The tree being ESM is a fact about the tree today, not a property
  // this check may lean on: a `.cts` file reaching the constructors
  // through `require` would hold the capability exactly as much.
  { source: `const { replay } = require("./emission.js");`, holds: true },
  // The three forms that move no binding at all. The `type` keyword
  // sits either on the clause or on every specifier; both spellings
  // construct nothing, and both are what a converted site writes.
  { source: `import type { Emission } from "./emission.js";`, holds: false },
  { source: `import { type Emission } from "./emission.js";`, holds: false },
  { source: `export type { Emission } from "./emission.js";`, holds: false },
  // A clause that MIXES the two still moves the specifier without the
  // keyword, so the mixed form is a hold.
  {
    source: `import { type Emission, replay } from "./emission.js";`,
    holds: true,
  },
  { source: `import { parse } from "./parser.js";`, holds: false },
  // Flagged on purpose. A side-effect import of a module whose whole
  // surface is two constructors has no honest reading, and where the
  // scan cannot read a clause it answers "holds" rather than guess.
  { source: `import "./emission.js";`, holds: true },
];

/** One re-export form and whether it republishes a constructor. */
interface ReExportForm {
  /** The statement, spelled the way the rules module would spell it. */
  readonly source: string;
  /** True where a consumer could reach a constructor through it. */
  readonly handedOn: boolean;
}

const RE_EXPORT_FORMS: readonly ReExportForm[] = [
  { source: `export { replay } from "./emission.js";`, handedOn: true },
  { source: `export { spanDelimiters, declareRule };`, handedOn: true },
  { source: `export const replay = (bytes: string) => bytes;`, handedOn: true },
  { source: `export function declareRule(): void {}`, handedOn: true },
  // No specifier list to read, and one line republishes both
  // constructors, so the named arms above cannot be what stops it.
  { source: `export * from "./emission.js";`, handedOn: true },
  { source: `export * as emission from "./emission.js";`, handedOn: true },
  { source: `export * from "./emission";`, handedOn: true },
  // What hands nothing on: another module's star, another module's
  // names, and this module's TYPE, which constructs nothing wherever
  // it is republished.
  { source: `export * from "./span-edges.js";`, handedOn: false },
  {
    source: `export { spanDelimiters } from "./span-edges.js";`,
    handedOn: false,
  },
  { source: `export type { Emission } from "./emission.js";`, handedOn: false },
];

// What this proves, and what it does not, because the difference
// decides which findings it can be credited with. It proves the
// emission MODULE has one value importer, so both of the design's trust
// points - the replay arm, which believes the bytes it is handed, and
// the rule bodies - stand next to each other in one file where a
// reader can compare them, and the rules stay enumerable
// (docs/architecture.md, obligation 4). It does NOT prove the
// capability has one holder: a value can be forged from a genuine
// emission's type without naming this module at all
// (`ReturnType<typeof ...>`), and only the compiler stops that, which
// is what tests/print/emission-forgery.test.ts measures.
describe("the capability stays in the rules module", () => {
  test("which is the only src file that imports a value from it", () => {
    expect(capabilityHolders(SOURCE_ROOT)).toEqual([RULES_FILE]);
  });

  // The scan reads statements, so what it makes of each statement
  // form is the whole of what it proves. Read as a table rather than
  // as a walk of today's tree, because the tree has one holder and so
  // exercises one row of this.
  test("reading every form a file could name it by", () => {
    const read = SCANNED_STATEMENTS.map(({ source }) => ({
      source,
      holds: holdsCapability(`${source}\n`),
    }));
    expect(read).toEqual([...SCANNED_STATEMENTS]);
  });

  // Holding it and handing it on are different things: one
  // `export { replay } from "./emission.js"` in the rules module would
  // leave the check above green while every consumer in the tree got a
  // constructor under a name the scan does not look for.
  test("and does not hand either constructor on", () => {
    expect(handsOn(readFileSync(RULES_FILE, "utf8"))).toBe(false);
  });

  test("by any of the forms that would republish one", () => {
    const read = RE_EXPORT_FORMS.map(({ source }) => ({
      source,
      handedOn: handsOn(source),
    }));
    expect(read).toEqual([...RE_EXPORT_FORMS]);
  });
});
