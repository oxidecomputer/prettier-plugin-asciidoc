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
 * The attacks are the ones a review found against the FIRST design,
 * where the brand was a non-exported `unique symbol`. That brand is
 * structural, so four of these compiled clean with no assertion and no
 * `any`; the `#private` field the module now uses is nominal, and this
 * file is the measurement that says which four changed.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { REPO_ROOT } from "../../scripts/lib/checkout.js";
import { inCheckout } from "../lib/checkout.js";

/** The module under attack, planted whole. */
const EMISSION = path.join(REPO_ROOT, "src/print/emission.ts");

/** How long one `tsc` over a nine-file checkout may take. */
const COMPILE_TIMEOUT = 120_000;

/**
 * A genuine emission for the attacks that copy one rather than write
 * one from scratch. `replay` is the honest constructor every caller
 * has, so holding its result is not itself the forgery.
 */
const GENUINE = `import { replay, type Emission } from "./emission.js";

export const genuine: Emission<string> = replay("aaa");
`;

/** A rule declaration nobody declared, for the attacks that fabricate one. */
const FABRICATED = `{ id: "not a declared rule", matches: "anything", licence: "none", pins: [], decreases: "nothing" }`;

/**
 * One attack: the file it is written in, and whether the compiler is
 * expected to refuse it.
 */
interface Attack {
  /** The file name, which is what a failure report names. */
  readonly file: string;
  /** The attack itself. */
  readonly source: string;
  /** True when `tsc` must reject this file. */
  readonly refused: boolean;
}

const ATTACKS: readonly Attack[] = [
  // Written from scratch. The only attack the ORIGINAL symbol brand
  // also stopped.
  {
    file: "literal.ts",
    refused: true,
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
    source: `import type { Emission } from "./emission.js";
import { genuine } from "./genuine.js";

export const forged: Emission<string> = { ...genuine, bytes: "ZZZ" };
`,
  },
  {
    file: "spread-licence.ts",
    refused: true,
    source: `import type { Emission } from "./emission.js";
import { genuine } from "./genuine.js";

export const forged: Emission<string> = {
  ...genuine,
  bytes: "ZZZ",
  licence: ${FABRICATED},
};
`,
  },
  // The strongest form the review found: it never names the emission
  // module, so the one-module check in declared-rules.test.ts cannot
  // see it either. Only the type stops this one.
  {
    file: "returntype-spread.ts",
    refused: true,
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
    source: `import type { Emission } from "./emission.js";

export const forged = { licence: "replay", bytes: "ZZZ" } as Emission<string>;
`,
  },
  {
    file: "double-assertion.ts",
    refused: false,
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
    source: `import type { Emission } from "./emission.js";
import { genuine } from "./genuine.js";

export const forged: Emission<string> = Object.assign({}, genuine, {
  bytes: "ZZZ",
  licence: ${FABRICATED},
});
`,
  },
  // ACCEPTED, and deliberately so: the type is location-blind, because
  // a rule is legitimate wherever it declares itself honestly. Keeping
  // rules in ONE module is a question about the tree, and
  // tests/print/declared-rules.test.ts is what asks it.
  {
    file: "declare-elsewhere.ts",
    refused: false,
    source: `import { declareRule } from "./emission.js";

export const rule = declareRule<string, string>(${FABRICATED}, () => "ZZZ");
`,
  },
];

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
    return [...named].toSorted((a, b) => a.localeCompare(b));
  });
}

test(
  "the compiler refuses exactly the forgeries the type can refuse",
  () => {
    const expected = ATTACKS.filter((attack) => attack.refused)
      .map((attack) => attack.file)
      .toSorted((a, b) => a.localeCompare(b));
    expect(refusedFiles()).toEqual(expected);
  },
  COMPILE_TIMEOUT,
);
