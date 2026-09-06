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
 * An import or export statement whose specifier is the emission
 * module - the one door both constructors are behind, which is why one
 * pattern covers the licensed arm and the replay arm together.
 */
const EMISSION_STATEMENT = /(?:import|export)[^;]*?"[^"]*emission\.js"/gv;

/**
 * A statement that moves no value. `import type { Emission }`
 * constructs nothing, and a converted site that wants to hold an
 * emission in a typed local has to write one, so flagging it would make
 * this check fail the migration it exists to protect.
 */
const TYPE_ONLY = /^import\s+type\b/v;

/** Handing a constructor on under the rules module's own name. */
const RE_EXPORTED =
  /export\s*\{[^\}]*\b(?:replay|declareRule)\b|export\s+(?:const|function)\s+(?:replay|declareRule)\b/v;

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
    const statements = readFileSync(full, "utf8").match(EMISSION_STATEMENT);
    const holds = (statements ?? []).some(
      (statement) => !TYPE_ONLY.test(statement),
    );
    return holds ? [full] : [];
  });
}

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

  // Holding it and handing it on are different things: one
  // `export { replay } from "./emission.js"` in the rules module would
  // leave the check above green while every consumer in the tree got a
  // constructor under a name the scan does not look for.
  test("and does not hand either constructor on", () => {
    expect(readFileSync(RULES_FILE, "utf8")).not.toMatch(RE_EXPORTED);
  });
});
