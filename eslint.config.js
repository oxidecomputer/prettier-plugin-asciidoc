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

// `max-lines`'s ordinary ceiling (450) plus the 10 lines src/ast.ts's
// own override below needs; see that override for why.
const AST_MAX_LINES = 460;

// `max-lines`'s ordinary ceiling raised to 500 for
// scripts/metrics/shape-census.ts; see that override for why.
const SHAPE_CENSUS_MAX_LINES = 500;

// -1/0/1/2 as index arithmetic (the last element, an empty check,
// the next slot) is clearer written inline than behind a named
// constant (readability judgment, agreed 2026-08-22). See the
// `@typescript-eslint/no-magic-numbers` override below.
// eslint-disable-next-line @typescript-eslint/no-magic-numbers -- these ARE the ignored numbers
const INDEX_ARITHMETIC = [-1, 0, 1, 2];

// A format row's assertions come as a fixed trailer: the output matches
// the pin, the output renders the same as the input, and formatting the
// output again is a fixed point. tests/helpers.ts spells that trailer
// once (`expectFormatted`, and `expectStableRender` for a row with no
// pinned bytes) so the assertions and their order stay in one place.
// Hand-spelled copies drift, and had: some asserted in a different
// order, and two dropped the render-equality assertion outright, which
// is the one assertion that says formatting did not change meaning.
//
// Two shapes carry it, and no correct site spells either outside
// `tests/helpers.ts`: the idempotence line and the render-equality
// pair. Neither is a `no-restricted-syntax` selector, because the
// idempotence line is only that line when the formatted subject and
// the expectation are the SAME expression and selectors carry no
// back-reference. A local helper that hand-rolls the shared body needs
// no separate treatment: its body IS these statements, so the rule
// reaches it where it stands.
//
// The rule reads through a `const`, because the same assertion writes
// either way and the second spelling is the commoner one:
//
//   expect(await formatAdoc(out)).toBe(out);
//   const twice = await formatAdoc(once); expect(twice).toBe(once);
//
// It resolves a name only to a `const` with one definition and one
// `await NAME(...)` initializer, which is a scope lookup, not data
// flow: a `let` that is written later, or a name bound to anything
// else, resolves to nothing and is not reported.
//
// What the rule reads is the CALLEE NAME. That is why
// tests/format/identity.test.ts is in the ignores below: its
// `formatAdoc` is a different function.
//
// The readers below answer one syntactic question each, so the visitor
// stays a handful of shape questions rather than a wall of
// `node.callee.object.callee` checks.

// The matchers that compare two strings for equality. A row can spell
// the trailer with any of them.
const EQUALITY_MATCHERS = new Set(["toBe", "toEqual", "toStrictEqual"]);

const assertionShape = {
  // `expect(...)` or `expect.soft(...)`, through any `.resolves` /
  // `.rejects` modifier a matcher hangs off; nothing for any other
  // receiver.
  expectCall(node) {
    let receiver = node;
    while (
      receiver.type === "MemberExpression" &&
      receiver.property.type === "Identifier" &&
      (receiver.property.name === "resolves" ||
        receiver.property.name === "rejects")
    ) {
      receiver = receiver.object;
    }
    if (receiver.type !== "CallExpression") {
      return;
    }
    return this.isExpectCallee(receiver.callee) ? receiver : undefined;
  },

  // `expect`, plain or as `expect.soft`.
  isExpectCallee(callee) {
    if (callee.type === "Identifier") {
      return callee.name === "expect";
    }
    return (
      callee.type === "MemberExpression" &&
      callee.object.type === "Identifier" &&
      callee.object.name === "expect" &&
      callee.property.type === "Identifier" &&
      callee.property.name === "soft"
    );
  },

  // The `expect(ACTUAL).MATCHER(EXPECTED)` pair, answered as its two
  // argument nodes; nothing for any other call. Either argument can be
  // absent, which is how a partly written assertion parses.
  expectToBe(node) {
    if (
      node.callee.type !== "MemberExpression" ||
      node.callee.property.type !== "Identifier" ||
      !EQUALITY_MATCHERS.has(node.callee.property.name)
    ) {
      return;
    }
    const call = this.expectCall(node.callee.object);
    if (call === undefined) {
      return;
    }
    const [actual] = call.arguments;
    const [expected] = node.arguments;
    return { actual, expected };
  },

  // The variable a name resolves to, from the innermost scope out.
  variableFor(scope, name) {
    let current = scope;
    while (current !== null && current !== undefined) {
      const found = current.variables.find((v) => v.name === name);
      if (found !== undefined) {
        return found;
      }
      current = current.upper;
    }
  },

  // The initializer of a name bound exactly once, by a `const`;
  // nothing for a parameter, a `let`, or a name declared twice (the
  // second binding is what makes a resolution unsound, so the pair is
  // read out and a present second one ends the lookup).
  constInitializer(context, node) {
    const variable = this.variableFor(
      context.sourceCode.getScope(node),
      node.name,
    );
    const [binding, rebinding] = variable === undefined ? [] : variable.defs;
    if (
      binding === undefined ||
      rebinding !== undefined ||
      binding.type !== "Variable" ||
      binding.parent.kind !== "const"
    ) {
      return;
    }
    return binding.node.init ?? undefined;
  },

  // `await NAME(...)`, written there or reached through a `const` that
  // binds it, answered as the call itself so a caller can read its
  // arguments; nothing for anything else.
  awaitedCall(context, node, name) {
    if (node === undefined) {
      return;
    }
    if (node.type === "Identifier") {
      const init = this.constInitializer(context, node);
      return init === undefined
        ? undefined
        : this.awaitedCall(context, init, name);
    }
    const call = node.type === "AwaitExpression" ? node.argument : node;
    if (
      call.type !== "CallExpression" ||
      call.callee.type !== "Identifier" ||
      call.callee.name !== name
    ) {
      return;
    }
    return call;
  },
};

const testAssertions = {
  rules: {
    "no-hand-spelled-format-trailer": {
      meta: {
        type: "problem",
        docs: {
          description:
            "use tests/helpers.ts's expectFormatted/expectStableRender " +
            "instead of spelling a format row's assertion trailer by hand",
        },
        schema: [],
        messages: {
          idempotence:
            "Hand-spelled idempotence assertion. Call expectFormatted " +
            "(or expectStableRender, when no bytes are pinned) from " +
            "tests/helpers.ts instead.",
          renderEquality:
            "Hand-spelled render-equality assertion. Call expectFormatted " +
            "(or expectStableRender, when no bytes are pinned) from " +
            "tests/helpers.ts instead.",
        },
      },
      create(context) {
        return {
          // The whole trailer hangs off `expect(...).toBe(...)`, so one
          // visitor over that call shape reaches both spellings.
          CallExpression(node) {
            const pair = assertionShape.expectToBe(node);
            if (pair === undefined) {
              return;
            }
            // `expect(await formatAdoc(X)).toBe(X)` is the idempotence
            // line only when both X's are the same expression; the same
            // shape with two different arguments is an ordinary pin.
            const [subject] =
              assertionShape.awaitedCall(context, pair.actual, "formatAdoc")
                ?.arguments ?? [];
            if (
              subject !== undefined &&
              pair.expected !== undefined &&
              context.sourceCode.getText(subject) ===
                context.sourceCode.getText(pair.expected)
            ) {
              context.report({ node, messageId: "idempotence" });
              return;
            }
            if (
              assertionShape.awaitedCall(
                context,
                pair.actual,
                "renderedHtml",
              ) !== undefined &&
              assertionShape.awaitedCall(
                context,
                pair.expected,
                "renderedHtml",
              ) !== undefined
            ) {
              context.report({ node, messageId: "renderEquality" });
            }
          },
        };
      },
    },
  },
};

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
      // contain the actual assertions. The list is CLOSED: a shared
      // assertion belongs in tests/helpers.ts, where one copy of it
      // can be read, and a name added here is one more place a format
      // row's assertions can drift apart.
      "vitest/expect-expect": [
        "error",
        {
          assertFunctionNames: [
            "expect",
            "expectAstInvariants",
            "expectAtomic",
            "expectByteFaithful",
            "expectFixed",
            "expectFixedBytes",
            "expectFixedPoint",
            "expectFormatted",
            "expectMalformedLineThrows",
            "expectQuarantineRejected",
            "expectRow",
            "expectRunFaithful",
            "expectStable",
            "expectStableRender",
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

  // The hand-spelled assertion trailer is an error under tests/.
  // `tests/helpers.ts` is where the trailer is written, so it is the one
  // file that must spell it. `tests/format/identity.test.ts` is the
  // other file the rule must not speak about: its `formatAdoc` runs the
  // BUILT artifact under dist/, which is that file's whole subject, so
  // the shared helper cannot stand in for a row there and the rule,
  // which reads the callee name, would tell it to use one anyway.
  //
  // The rest are DEFERRED, not waived: each still spells the trailer by
  // hand, and each entry leaves when its file's copies are converted.
  // The two whitespace files are frozen with the printer files they
  // test, and hand-roll the helper's body under a local name
  // (`expectByteFaithful`). What the rule holds meanwhile is the trailer
  // written as either spelling, direct or through a `const`: outside
  // this list, a format row that reaches for `formatAdoc` or
  // `renderedHtml` by name cannot spell it again.
  {
    files: ["tests/**/*.ts"],
    ignores: [
      "tests/helpers.ts",
      "tests/format/identity.test.ts",
      "tests/format/whitespace-runs.test.ts",
      "tests/format/whitespace-fold.test.ts",
      "tests/format/anchor-line-separation.test.ts",
      "tests/format/anchor-spelling.test.ts",
      "tests/format/attribute-entry.test.ts",
      "tests/format/block-attributes.test.ts",
      "tests/format/description-list.test.ts",
      "tests/conformance/interruption.test.ts",
    ],
    plugins: { "test-assertions": testAssertions },
    rules: { "test-assertions/no-hand-spelled-format-trailer": "error" },
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
      "src/parse/lines/reader.ts", // 450 -> 462
      "scripts/parity.ts", // 449 -> 469
      "tests/parser/ast-invariants.ts", // 436 -> 459
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
      "src/parse/inline/rules.ts", // :470 `if (start === -1) return undefined;`
      "src/print/span-edges.ts", // :396, :416 `if (!isSpanNode(neighbour)) return undefined;`
    ],
    rules: { curly: "off" },
  },

  // `max-lines` raised for src/ast.ts alone (450 -> 460): the AST is
  // one module by the cycle gate's own design (ParentBlockNode needs
  // BlockNode and BlockNode's union names ParentBlockNode back, so
  // splitting the file would create the cross-file cycle
  // scripts/metrics/graph.ts's tsPreCompilationDeps deliberately
  // catches even for type-only imports), and the discriminated-union
  // split that keeps `openDelimiter` unrepresentable outside the open
  // variant (issue #64) costs the 2 lines past the ordinary ceiling.
  {
    files: ["src/ast.ts"],
    rules: {
      "max-lines": [
        "error",
        { max: AST_MAX_LINES, skipBlankLines: true, skipComments: true },
      ],
    },
  },

  // `max-lines` raised for scripts/metrics/shape-census.ts alone (450 ->
  // 500): the file's length is roster-driven, not logic-driven - it is an
  // exemption/classification registry (EXEMPT, GRID_EXEMPT, the container
  // and perturbation rosters) that grows a few lines per recorded entry
  // while the functions that check the rosters stay small and fixed. The
  // ordinary ceiling exists to force LOGIC files to split at a seam before
  // they grow unreadable; that pressure does not serve a file whose growth
  // is one more entry in a list, so 500 gives the roster headroom without
  // licensing logic growth past the ordinary ceiling.
  {
    files: ["scripts/metrics/shape-census.ts"],
    rules: {
      "max-lines": [
        "error",
        {
          max: SHAPE_CENSUS_MAX_LINES,
          skipBlankLines: true,
          skipComments: true,
        },
      ],
    },
  },
);
