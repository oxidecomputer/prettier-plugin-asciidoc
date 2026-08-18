# Coding Standards

## Lint Rules

ESLint is strict. Rules that affect how you write code:

- No `any` — use proper types
- No `null` — use `undefined` (relaxed in test files)
- `strict-boolean-expressions` — no truthy/falsy checks, be explicit
- No magic numbers (relaxed in test files)
- No `console.log`
- Unused vars must be prefixed with `_`
- Unicorn recommended rules (modern JS conventions)
- JSDoc required on all exported functions, with `@param` and `@returns`
  (eslint-plugin-jsdoc)
- `max-lines: 450` (from eslint-config-love) — blank lines and comments are
  excluded from the count. **Never condense or remove comments to fit the
  limit.** Instead, split the file into smaller modules. Comments are critical
  for understanding the code.

## Code Comments

All non-trivial code should have comments that explain _why_ it exists, not just
what it does. Restate the code's purpose only when the intent isn't obvious from
reading it. AsciiDoc is a deceptively complex format — even "obvious" helper
functions often exist to handle subtle edge cases. Comments should distinguish
inherent, necessary complexity from accidental complexity so future readers (and
AI agents) can tell the difference.

**Style convention:**

- `/** */` JSDoc — all exported functions, classes, interfaces, and types. VS
  Code shows these on hover.
- `//` — internal implementation notes (helper functions, grammar rules, token
  definitions, "why" explanations).

**JSDoc discipline (enforced by eslint-plugin-jsdoc):**

- Every exported function must have a JSDoc comment (`require-jsdoc`). Even if
  _what_ the function does is obvious, explain _why_ it exists — what problem or
  edge case motivated it, and the context in which it's used.
- Every `@param` must be documented (`require-param`). Don't just restate the
  type; describe what the parameter means in context. For example,
  `@param sourceText` should explain whether it's the full document source or a
  substring, and why the function needs it.
- Every non-void return must be documented (`require-returns`). Describe what
  the caller should expect and any invariants the return value guarantees.
- No JSDoc type annotations (`no-types`) — TypeScript handles types. JSDoc
  describes meaning, not types.

**Line width:** Keep comments within 80 columns. Prettier doesn't reflow
comments, so wrap them manually.

## Writing Style

- Never use the phrase "key insight"
- "upfront" is two words ("up front"), not one
