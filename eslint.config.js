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
  // is not optional.
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "build.ts",
      ".stryker-tmp/**",
      "reports/**",
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
            "expectByteFaithful",
            "expectBytes",
            "expectFixed",
            "expectFixedBytes",
            "expectRow",
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

  // eslint-config-prettier: disable rules that conflict with
  // Prettier formatting. Must be last to override earlier configs.
  prettier,
);
