import { defineConfig } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import love from "eslint-config-love";
import unicorn from "eslint-plugin-unicorn";
import jsdoc from "eslint-plugin-jsdoc";
import prettier from "eslint-config-prettier";
import vitest from "@vitest/eslint-plugin";

// Vitest's expect() takes an optional message as its second argument
// (`expect(value, "why")`). The rule's default of 1 assumes the Jest
// signature.
const EXPECT_MAX_ARGS = 2;

// -1/0/1/2 as index arithmetic (the last element, an empty check,
// the next slot) is clearer written inline than behind a named
// constant (readability judgment, agreed 2026-08-22). See the
// `@typescript-eslint/no-magic-numbers` override below.
// eslint-disable-next-line @typescript-eslint/no-magic-numbers -- these ARE the ignored numbers
const INDEX_ARITHMETIC = [-1, 0, 1, 2];

export default defineConfig(
  // Global ignores. `.stryker-tmp/` is Stryker's sandbox: a full copy
  // of the project, tsconfig included, which otherwise makes
  // typescript-eslint see two candidate tsconfig roots and refuse to
  // parse anything. It survives a crashed mutation run, so ignoring it
  // is not optional. `.superpowers/` is scratch: .gitignore excludes
  // it, nothing there ships, and nothing there is in tsconfig's
  // project - so a lintable file under it can only fail the run with a
  // parse error, never earn a fix.
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "build.ts",
      ".stryker-tmp/**",
      "reports/**",
      ".superpowers/**",
    ],
  },

  // Base JS recommended rules.
  js.configs.recommended,

  // Strict type-checked + stylistic type-checked TypeScript rules.
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  // eslint-config-love: opinionated strict config.
  love,

  // eslint-plugin-unicorn: modern JS/TS conventions.
  unicorn.configs["recommended"],

  // eslint-plugin-jsdoc: JSDoc consistency and correctness.
  jsdoc.configs["flat/recommended-typescript-error"],

  // TypeScript file settings.
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-unnecessary-condition": "error",
      "@typescript-eslint/strict-boolean-expressions": "error",
      "unicorn/no-null": "error",

      // See INDEX_ARITHMETIC above. love's other options are
      // preserved unchanged.
      "@typescript-eslint/no-magic-numbers": [
        "error",
        {
          ignore: INDEX_ARITHMETIC,
          ignoreArrayIndexes: false,
          ignoreDefaultValues: false,
          ignoreClassFieldInitialValues: false,
          enforceConst: false,
          detectObjects: true,
          ignoreEnums: true,
          ignoreNumericLiteralTypes: false,
          ignoreReadonlyClassProperties: true,
          ignoreTypeIndexes: false,
        },
      ],

      // Computed-key destructuring (`const { [i]: x } = xs;`) is
      // strictly less readable than `xs[i]` (readability judgment,
      // agreed 2026-08-22). love's array/object destructuring
      // preference and its other option are preserved unchanged.
      "@typescript-eslint/prefer-destructuring": [
        "error",
        { array: true, object: true },
        {
          enforceForRenamedProperties: false,
          enforceForDeclarationWithTypeAnnotation: false,
        },
      ],

      // Reassigning a parameter's OWN binding stays an error; writing
      // through its properties (`node.value = x`, `arr[i] = x`) is an
      // ordinary way to mutate a caller-owned object in place, not a
      // hazard worth a lint error (readability judgment, agreed
      // 2026-08-22).
      "no-param-reassign": ["error", { props: false }],

      // These rules do pure syntactic matching on method names
      // (any .map() call, any .flatMap() call) with no type
      // awareness. They cannot distinguish AstPath#map from
      // Array#map, producing false positives on every Prettier
      // path.map(print, "children") call.
      "unicorn/no-array-callback-reference": "off",
      "unicorn/no-array-method-this-argument": "off",
      "unicorn/prefer-array-flat-map": "off",
      "no-console": "error",

      // Require JSDoc on exported interfaces/types and their
      // fields, not just functions and classes.
      "jsdoc/require-jsdoc": [
        "error",
        {
          contexts: [
            "TSInterfaceDeclaration[parent.type='ExportNamedDeclaration']",
            "TSTypeAliasDeclaration[parent.type='ExportNamedDeclaration']",
            "TSInterfaceDeclaration[parent.type='ExportNamedDeclaration'] TSPropertySignature",
            "TSTypeAliasDeclaration TSPropertySignature",
          ],
        },
      ],

      // The base no-unused-vars rule doesn't understand TS type
      // imports and produces false positives; the TS-aware version
      // handles them correctly.
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },

  // Test files: Vitest rules + relax magic numbers and null.
  {
    files: ["tests/**/*.ts"],
    ...vitest.configs.recommended,
    rules: {
      ...vitest.configs.recommended.rules,

      // .skip with a test body is a legitimate pattern for
      // tests awaiting a bug fix (body preserves the impl).
      "vitest/no-disabled-tests": "off",

      // Tests delegate to helpers like expectAstInvariants() that
      // contain the actual assertions.
      "vitest/expect-expect": [
        "error",
        {
          assertFunctionNames: [
            "expect",
            "expectAstInvariants",
            "expectAtomic",
            "expectByteFaithful",
            "expectBytes",
            "expectFixed",
            "expectFixedBytes",
            "expectFixedPoint",
            "expectRow",
            "expectRunFaithful",
            "expectTableFormat",
          ],
        },
      ],

      // The data-driven suites use expect()'s message argument to
      // name the row that failed. See EXPECT_MAX_ARGS.
      "vitest/valid-expect": ["error", { maxArgs: EXPECT_MAX_ARGS }],

      // Magic numbers are unavoidable in test assertions (counts,
      // indices, expected values). null appears in fixture data and
      // Vitest matcher expectations.
      "@typescript-eslint/no-magic-numbers": "off",
      "unicorn/no-null": "off",
    },
  },

  // Plain JS config files: disable type-checked rules. JS files
  // aren't part of the tsconfig project service and can't be
  // type-checked.
  {
    files: ["**/*.js"],
    ...tseslint.configs.disableTypeChecked,
  },

  // eslint-config-prettier: disables the rules that conflict with
  // Prettier formatting.
  prettier,

  // Braces on every control-flow body. An omitted brace is the largest
  // single category of "atoms of confusion" in this tree (48 of a
  // census of 50, taken 2026-09-01), and it is the one that costs
  // nothing to remove: the fix is mechanical and changes no behavior.
  //
  // AFTER `prettier`, and that placement is the whole rule. Flat config
  // gives the last matching entry the severity, and eslint-config-
  // prettier turns `curly` OFF - it is one of that config's "special
  // rules", disabled because the `multi-line` and `multi-or-nest`
  // options fight the printer. `all` does not: Prettier keeps braces
  // wherever they are written, so asserting them everywhere agrees
  // with it. Asserted before `prettier`, the rule resolves to off for
  // every file and a green `lint` says nothing about braces at all.
  {
    files: ["**/*.ts"],
    rules: { curly: ["error", "all"] },
  },

  // Files where `curly` is DEFERRED, not waived, for one of two
  // measured reasons. Both deferrals are temporary and neither is a
  // judgment that the braces are unwanted: whichever change next
  // clears the obstacle takes the entry out and runs `eslint --fix`
  // on the file.
  //
  // ONE - no room. Braces cost about two lines per omitted brace, and
  // these files are close enough to the 450-line `max-lines` ceiling
  // that the fix would either breach it or leave nothing to work in.
  // The count beside each path is what the file measures today under
  // `max-lines`'s own accounting (code lines, blanks and comments
  // excluded); the fix would put it where the second number says.
  {
    files: [
      "src/parse/lines/reader.ts", // 447 -> 461
      "src/print/inline.ts", // 445 -> 463
      "scripts/parity.ts", // 447 -> 467
      "scripts/parity-ledger.ts", // 450 -> 477
      "scripts/shape-registry.ts", // 446 -> 448
      "tests/parser/ast-invariants.ts", // 441 -> 491
      "tests/scripts/metrics-design.test.ts", // 447 -> 449
      "tests/scripts/parity.test.ts", // 442 -> 444
    ],
    rules: { curly: "off" },
  },

  // TWO - the braces would move a coverage floor without moving the
  // coverage. Each of these files holds a one-line defensive guard
  // (`if (x) return;`) that the suite never takes. On one line, v8
  // counts the line as covered because the `if` ran; braced, the
  // `return` becomes a line of its own that nothing reaches, and the
  // file drops below the 100% line minimum recorded for it in
  // scripts/metrics/score-minimums.json.
  //
  // Nothing about the suite got worse - branch coverage is 98.55%
  // either way, and these guards were always among the branches it
  // does not take. The rule here is the repo's: a number that moves
  // the wrong way is a question, not a target, so neither the floor
  // was lowered nor a test written to chase the line. The guards and
  // the line each sits on are recorded in the task report for the
  // owners of these files; the entry leaves when the guard is tested
  // or shown unreachable and deleted.
  {
    files: [
      "src/parse/build/list.ts", // :132 `if (children.length === 0) return;`
      "src/parse/inline/rules.ts", // :454 `if (start === -1) return undefined;`
      "src/parse/lines/list-item-node.ts", // :185 `if (last === undefined) return markerLine.line;`
      "src/print/span-edges.ts", // :275, :295 `if (!isSpanNode(neighbour)) return undefined;`
    ],
    rules: { curly: "off" },
  },
);
