/**
 * `print/emission.ts`'s unforgeability claim, compiled rather than
 * asserted.
 *
 * The capability type's whole job is that bytes cannot be licensed
 * except through the module's two constructors. That is a claim about
 * what the COMPILER refuses, so no runtime assertion can check it: a
 * forgery that type-checks runs perfectly well. This plants the real
 * `emission.ts` in a throwaway checkout beside one file per attack and
 * runs `tsc` over the lot once, then asserts the set of files that
 * failed to compile is EXACTLY the set expected to.
 *
 * Equality in both directions is the point. A forgery moving from
 * REFUSED to ACCEPTED is the property breaking. A forgery moving from
 * ACCEPTED to REFUSED is the claim getting stronger, and it should be
 * recorded rather than quietly enjoyed, because the accepted ones are
 * the domain of the claim: they are what the module comment and
 * `tests/print/declared-rules.test.ts`'s one-module check exist to
 * cover.
 *
 * A second column says how far that cover reaches, because "the
 * location check catches the rest" is only true of a forgery that
 * NAMES the module. It is read off the sources rather than asserted,
 * and it is what says which accepted row is outside every check the
 * design has.
 *
 * Most of the attacks are the ones a review found against the FIRST
 * design, where the brand was a non-exported `unique symbol`. That
 * brand is structural, so four of those compiled clean with no
 * assertion and no `any`; the `#private` field the module now uses is
 * nominal, and this file is the measurement that says which four
 * changed. The table takes a row for every further form a review
 * finds, accepted ones included.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { REPO_ROOT } from "../../scripts/lib/checkout.js";
import { inCheckout } from "../lib/checkout.js";

/** The module under attack, planted whole. */
const EMISSION = path.join(REPO_ROOT, "src/print/emission.ts");

/** What a file naming the emission module has to spell to reach it. */
const MODULE_SPECIFIER = "emission.js";

/** How long one `tsc` over the attack checkout may take. */
const COMPILE_TIMEOUT = 120_000;

/**
 * A genuine emission for the attacks that copy one rather than write
 * one from scratch. `replay` is the honest constructor every caller
 * has, so holding its result is not itself the forgery.
 */
const GENUINE = `import { replay, type Emission } from "./emission.js";

export const genuine: Emission<string> = replay("aaa");

export function held(): Emission<string> {
  return genuine;
}
`;

/** A rule declaration nobody declared, for the attacks that fabricate one. */
const FABRICATED = `{ id: "not a declared rule", matches: "anything", licence: "none", pins: [], decreases: "nothing" }`;

/**
 * One attack: the file it is written in, whether the compiler is
 * expected to refuse it, and whether a grep for the module would find
 * it.
 */
interface Attack {
  /** The file name, which is what a failure report names. */
  readonly file: string;
  /** The attack itself. */
  readonly source: string;
  /** True when `tsc` must reject this file. */
  readonly refused: boolean;
  /**
   * True when the file NAMES the emission module, and so is reachable
   * by a grep for its specifier.
   *
   * This is the second column because it is what the module comment's
   * mitigation for the accepted forgeries actually claims: an
   * assertion has to name the type it asserts. A forgery that is both
   * accepted and unnamed is outside every check this design has, and
   * the point of writing the column down is that such a row cannot
   * arrive unremarked.
   */
  readonly namesModule: boolean;
}

const ATTACKS: readonly Attack[] = [
  // Written from scratch. The only attack the ORIGINAL symbol brand
  // also stopped.
  {
    file: "literal.ts",
    refused: true,
    namesModule: true,
    source: `import type { Emission } from "./emission.js";

export const forged: Emission<string> = { licence: "replay", bytes: "ZZZ" };
`,
  },
  // Copied off a genuine emission. These three are the review's
  // finding: under a structural brand they compiled with no assertion
  // and no \`any\`, because a spread copies a branded key like any
  // other property. A private field is not copied, and cannot be
  // written by the spread's own literal.
  {
    file: "spread-bytes.ts",
    refused: true,
    namesModule: true,
    source: `import type { Emission } from "./emission.js";
import { genuine } from "./genuine.js";

export const forged: Emission<string> = { ...genuine, bytes: "ZZZ" };
`,
  },
  {
    file: "spread-licence.ts",
    refused: true,
    namesModule: true,
    source: `import type { Emission } from "./emission.js";
import { genuine } from "./genuine.js";

export const forged: Emission<string> = {
  ...genuine,
  bytes: "ZZZ",
  licence: ${FABRICATED},
};
`,
  },
  // The same spread, reaching the type through a value instead of
  // through the exported type name. It still names the module, because
  // `ReturnType<typeof replay<string>>` has to import `replay` to have
  // a `typeof` to take, and that import is a VALUE import, so the
  // one-module scan in declared-rules.test.ts sees this file too. The
  // type refuses it either way; the form that gets past both checks is
  // object-assign-returntype.ts below.
  {
    file: "returntype-spread.ts",
    refused: true,
    namesModule: true,
    source: `import { replay } from "./emission.js";

type Held = ReturnType<typeof replay<string>>;

export function forge(): Held {
  return { ...replay("aaa"), bytes: "ZZZ" };
}
`,
  },
  // ACCEPTED, and this is the domain of the claim rather than a defect
  // to fix: a written-out assertion overrides any type, nominal or
  // structural. What the design gets is that an assertion is a token a
  // reader can grep for, in the one module the location check allows to
  // hold the capability.
  {
    file: "assertion.ts",
    refused: false,
    namesModule: true,
    source: `import type { Emission } from "./emission.js";

export const forged = { licence: "replay", bytes: "ZZZ" } as Emission<string>;
`,
  },
  {
    file: "double-assertion.ts",
    refused: false,
    namesModule: true,
    source: `import type { Emission } from "./emission.js";

const raw = { licence: "replay", bytes: "ZZZ" };

export const forged = raw as unknown as Emission<string>;
`,
  },
  // ACCEPTED for the same reason, less obviously: \`Object.assign\`'s
  // signature returns an INTERSECTION of its arguments' types, so the
  // genuine emission's type - private field and all - is asserted onto
  // a plain object the call actually builds. It is an assertion in all
  // but spelling, and no brand can refuse it.
  {
    file: "object-assign.ts",
    refused: false,
    namesModule: true,
    source: `import type { Emission } from "./emission.js";
import { genuine } from "./genuine.js";

export const forged: Emission<string> = Object.assign({}, genuine, {
  bytes: "ZZZ",
  licence: ${FABRICATED},
});
`,
  },
  // The same intersection, taking its type off a value that already
  // holds an emission instead of off the exported type name. Nothing
  // in it spells the module, so a grep for the module does not reach
  // it and the one-module scan has no specifier to match: this is the
  // one row the compiler accepts and no check in the tree can find.
  // What is left against it is reading the diff, which is why the
  // module comment states the mitigation this narrowly.
  {
    file: "object-assign-returntype.ts",
    refused: false,
    namesModule: false,
    source: `import { held } from "./genuine.js";

type Held = ReturnType<typeof held>;

export const forged: Held = Object.assign({}, held(), { bytes: "ZZZ" });
`,
  },
  // ACCEPTED, and deliberately so: the type is location-blind, because
  // a rule is legitimate wherever it declares itself honestly. Keeping
  // rules in ONE module is a question about the tree, and
  // tests/print/declared-rules.test.ts is what asks it.
  {
    file: "declare-elsewhere.ts",
    refused: false,
    namesModule: true,
    source: `import { declareRule } from "./emission.js";

export const rule = declareRule<string, string>(${FABRICATED}, () => "ZZZ");
`,
  },
];

/**
 * File names in a stable order, so an equality reads as a set.
 * @param files - the names
 * @returns the same names, sorted
 */
function sorted(files: readonly string[]): string[] {
  return files.toSorted((a, b) => a.localeCompare(b));
}

/**
 * Compile every attack together and report which files `tsc` refused.
 * @returns the refused file names, sorted
 */
function refusedFiles(): string[] {
  const files: Record<string, string> = {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        module: "ES2022",
        moduleResolution: "bundler",
        target: "ES2024",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
      },
      include: ["src/**/*.ts"],
    }),
    "src/emission.ts": readFileSync(EMISSION, "utf8"),
    "src/genuine.ts": GENUINE,
  };
  for (const attack of ATTACKS) {
    files[`src/${attack.file}`] = attack.source;
  }
  return inCheckout(files, (root) => {
    const result = spawnSync(
      path.join(REPO_ROOT, "node_modules/.bin/tsc"),
      ["-p", "tsconfig.json"],
      { cwd: root, encoding: "utf8" },
    );
    const named = new Set<string>();
    for (const attack of ATTACKS) {
      if (result.stdout.includes(`src/${attack.file}`)) {
        named.add(attack.file);
      }
    }
    return sorted([...named]);
  });
}

/**
 * The attack files a column selects, in the order a comparison wants.
 * @param column - what the row has to say about itself
 * @returns the file names, sorted
 */
function filesWhere(column: (attack: Attack) => boolean): string[] {
  return sorted(
    ATTACKS.filter((attack) => column(attack)).map((attack) => attack.file),
  );
}

test(
  "the compiler refuses exactly the forgeries the type can refuse",
  () => {
    expect(refusedFiles()).toEqual(filesWhere((attack) => attack.refused));
  },
  COMPILE_TIMEOUT,
);

// The naming column, read off the sources rather than trusted. A
// hand-written claim about what a file names is exactly the kind that
// drifts from the file beside it, and the claim is load-bearing: it is
// the whole of the mitigation the module comment offers for the
// forgeries the compiler accepts.
test("the forgeries a grep for the module finds are the ones recorded", () => {
  expect(
    filesWhere((attack) => attack.source.includes(MODULE_SPECIFIER)),
  ).toEqual(filesWhere((attack) => attack.namesModule));
});

// The cell no check in this design covers: accepted by the compiler
// AND naming nothing to grep for, so neither this file nor the
// one-module scan in declared-rules.test.ts can see it and review of
// the diff is what is left. One row sits there. A second arriving is a
// finding rather than a footnote, which is why the list is written out
// instead of derived.
test("and one accepted forgery names nothing either check looks for", () => {
  expect(
    filesWhere((attack) => !attack.refused && !attack.namesModule),
  ).toEqual(["object-assign-returntype.ts"]);
});
