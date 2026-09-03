# Coding Standards

## Lint Rules

ESLint is strict. Rules that affect how you write code:

- No `any` — use proper types
- No `null` — use `undefined` (relaxed in test files)
- `strict-boolean-expressions` — no truthy/falsy checks, be explicit
- No magic numbers (relaxed in test files)
- `require-unicode-regexp` — **every** regex in `src` carries the `v` flag, with
  no exception
- No `console.log`
- Unused vars must be prefixed with `_`
- Unicorn recommended rules (modern JS conventions)
- JSDoc required on all exported functions, with `@param` and `@returns`
  (eslint-plugin-jsdoc)
- `max-lines: 450` (from eslint-config-love) — blank lines and comments are
  excluded from the count. **Never condense or remove comments to fit the
  limit.** Instead, split the file into smaller modules. Comments are critical
  for understanding the code. There is no file-scoped exception.

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
- `//` — internal implementation notes (helper functions, line-shape and inline
  rule table rows, "why" explanations).

**JSDoc discipline (enforced by eslint-plugin-jsdoc):**

- Every exported function must have a JSDoc comment (`require-jsdoc`). Even if
  _what_ the function does is obvious, explain _why_ it exists — what problem or
  edge case motivated it, and the context in which it's used.
- An export that exists only so unit tests can reach it carries a bare
  `@internal` tag, with the reason on the adjacent prose line; the
  internal-surface gate counts tagged and untagged exports separately.
- Every `@param` must be documented (`require-param`). Don't just restate the
  type; describe what the parameter means in context.
- Every non-void return must be documented (`require-returns`). Describe what
  the caller should expect and any invariants the return value guarantees.
- No JSDoc type annotations (`no-types`) — TypeScript handles types. JSDoc
  describes meaning, not types.

**Line width:** Keep comments within 80 columns. Prettier doesn't reflow
comments, so wrap them manually.

## Type Discipline

Make invalid states unrepresentable, and make every function total.

- Model states as discriminated unions whose payloads carry exactly what each
  arm needs. A field that is "only set when" some other field has some value is
  a smell: split the union so the state that cannot occur does not typecheck.
- Switches over a union are exhaustive and compiler-checked. No `default` arm
  that "cannot happen", no defensive throw for a state the types already
  exclude. If a branch is unreachable, delete the branch or fix the type that
  made it look reachable.
- Invariants hold by construction of the operations, not by runtime assertion.
  If every mutation of a structure preserves a property, the property needs no
  check; if a check feels necessary, the operations are wrong.
- When existing code smears one logical state across several fields (flags plus
  a string plus a nullable), a change that touches it should replace the smear
  with a type whose variants are the legal states, not add another field.
- Never re-derive a fact the caller already knows. A function that recomputes
  what its caller established (re-testing a line's shape, re-checking a
  condition the type already proves) creates a second source of truth that can
  disagree with the first - and that disagreement is where invalid states come
  from. Pass the fact down, carried in a type that makes it unforgeable.

## Line-Shaped Constructs

A new construct that can appear as a whole line (a delimiter, a marker, a
block-attribute-looking line, …) is added in three steps, in this order:

1. **A registry row in `src/parse/line-shapes.ts`**, citing the authority you
   measured (see "The two authorities" below). The regex lives here and nowhere
   else.
2. **A table entry in `src/parse/lines/classify.ts`**, so the BlockReader learns
   the new `LineKind`. The classifier is a pure function over the registry; it
   is the only thing that turns a line into a kind.
3. **An oracle row in `tests/conformance/interruption.test.ts`**, pinning the
   shape against `@asciidoctor/core` in every `ParagraphContext`. The oracle
   wins if it disagrees with your reading of the Ruby.

Steps 2 and 3 are about a line that ENDS or OPENS a block. A shape that does
neither - one only a reader consults about a line it has already claimed, the
way the paragraph scan asks about an indented `+` (`INDENTED_PLUS`) - gets step
1 and a named predicate in `classify.ts` instead: no `LineKind` arm, because the
classifier's verdict does not change, and no interruption row, because a shape
that interrupts nothing would pin a row of identical answers. Say which you are
adding, and why, where the predicate is declared.

The predicate's home is `classify.ts` **while a reader is the only asker**.
Where a BUILDER asks it too, it goes in `line-shapes.ts` beside its pattern
instead, because `build/` may not import `lines/` - the `build-imports-lines`
layer rule in `scripts/metrics/graph.ts`, which is an error-severity gate, not a
preference. `isSingleWordLine` is that case ("does this line hold one word",
read by the paragraph builders so `ParagraphNode.firstWordEndsItsLine` can be
recorded at parse time), and `isRawParagraphLine` is the older one (reflow asks
it from `src/print`). Either way the registry still owns the pattern and the
predicate still says at its declaration which route it took and why.

A new INLINE construct is added the same way: a rule in
`src/parse/inline/rules.ts` citing the Asciidoctor source that decides it
(`substitutors.rb`, `rx.rb`), in the right place in the ORDER (first match
wins), and a row in `tests/parser/inline-tokens.test.ts`. The rule table is the
single source of truth for inline shapes, as `line-shapes.ts` is for line
shapes.

That fits a construct whose delimiter question a rule can answer from its own
neighbourhood - one character, checked where it stands. The curved-quote pair
(`"`...`"`, `'`...`'`) cannot: `x "``a`` y` and `x "``a``" y` start with the
same four characters and only diverge on what stands later in the line, so a
rule row would have to consume a quote plus a backtick before it can tell
whether the span is a monospace pair or a curved one. That construct is a
separate SCAN instead (`src/parse/inline/curved-quotes.ts`, whose own header
explains the "why a scan" reasoning). The doubled marks are the other one:
`**a**` pairs and `**a*` does not, so whether two adjacent marks are one
delimiter is a fact about the whole fragment, and
`src/parse/inline/doubled-marks.ts` replays the unconstrained rows' own gsub to
answer it. Reach for a scan only when a rule genuinely cannot decide locally,
the way these two could not.

**The two authorities.** Cite the one you MEASURED. `@asciidoctor/core` is the
behavioral authority: cite `build/node/index.cjs`, or the `src/*.js` it is
bundled from, for anything you verified by running the oracle. The Ruby is the
design spec it was transpiled from; cite `parser.rb`, `rx.rb`, `reader.rb`,
`substitutors.rb`, `attribute_list.rb` or `asciidoctor.rb` by line only when you
opened the source and it agrees, and it lives in the tree at
`vendor/asciidoctor-ruby/` (tag `v2.0.26`) so that opening it is a `Read`, not a
download. The two do diverge: the transpile spells Ruby's `\p{Word}`
(`asciidoctor.rb l.436`) as `\p{Alphabetic}\p{N}\p{Pc}` (`index.cjs l.54`), and
it resolves an ordered list's `start` attribute
(`Parser.resolveOrderedListStart`, `index.cjs l.12154`) where 2.0.26 has no such
call at all, and its attrlist group in front of a quoted span
(`QuoteAttributeListRxt`, `index.cjs l.59`) crosses neither bracket where
2.0.26's inline spelling (`asciidoctor.rb l.446-468`) crosses an open one, so
`[a[b]**c**` carries class `b` to the oracle and `a[b` to a reader of the
vendored rows. Where they diverge, the comment names BOTH, states the
divergence, and says the oracle wins. `bun run citation-check` holds every
citation that names its file to that file, that line and the names the comment
puts beside it, and reports the bare references that name none; a comment that
cites nothing checkable is fine, a comment that cites the wrong line is a failed
gate.

**Never a token pattern.** Block-level context comes from the BlockReader and
from nowhere else, and `tests/parser/architecture.test.ts` is the mechanical
guard: it reads the source of every file under `src/parse` and fails on the
patterns that would smuggle context in another way (see the test itself for the
current list). The rules are textual and blunt and they read comments too: if
one fires on a comment, reword the comment — do not weaken the rule or exempt a
file.

Reflow safety (`src/print/reflow.ts`) consumes the same registry, so the parser
and the formatter's word-wrapping can never disagree about what would re-parse
as block syntax. See "Line classification" in `docs/architecture.md`.
