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

**Naming a symbol in prose.** Write `{@link cutMatch}`, not `` `cutMatch` ``: a
name in backticks is indistinguishable from a quoted value or a Ruby method, and
the tag is the marker that says which it is. The tag carries no path, so it is
for a name a reader can find: one the citing file itself declares, or one that
exactly one file in the tree declares. Where several files declare the name,
write the name with its path beside it instead -
``(`printedText`, src/print/blocks.ts)``, adjacent, with no word between the
two - because that reader has to be told which file.
`bun run internal-citations` holds both spellings, and fails a tag that names
nothing or names two places; the grammar each is read by is in
[harnesses.md](harnesses.md).

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

## Tests

A test asserts a property of ONE implementation's output. A test whose assertion
is that two of our own components agree is not accepted: the second component is
the problem, and a test holding the two in agreement makes the duplication read
as covered rather than as debt, so the fix is to delete one component and check
the survivor against pinned bytes or the oracle. The oracle suite and
`bun run parity` are not that shape - they compare against an external authority
and against a prior checkout of this code, neither of which is a second
component of ours.

## Line-Shaped Constructs

A new construct that can appear as a whole line (a delimiter, a marker, a
block-attribute-looking line, …) is added in three steps, in this order:

1. **A registry row in the line-shape registry**, citing the authority you
   measured (see "The two authorities" below). The registry is
   `src/parse/line-shapes.ts` plus its named `line-shapes-*.ts` siblings, which
   exist because a row family moves out whole when that file nears its
   `max-lines` ceiling. The regex lives in one of those modules and nowhere
   else: the completeness census (`bun run metrics`) and the pattern-import rule
   in `tests/parser/architecture.test.ts` both enforce over every registry
   module, from one shared derivation of which files those are
   (`scripts/metrics/registry-modules.ts`).
2. **A table entry in `src/parse/lines/classify.ts`**, so the BlockReader learns
   the new `LineKind`. The classifier is a pure function over the registry; it
   is the only thing that turns a line into a kind.
3. **An oracle row in `tests/conformance/interruption.test.ts`**, pinning the
   shape against `@asciidoctor/core` in every `ParagraphContext`. If the row
   disagrees with your reading of the Ruby, say so in the row and say which of
   the two readings the registry follows.

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
preference. `isRawParagraphLine` is that case ("must this line stay verbatim
inside a paragraph", read by reflow from `src/print` as well as by the reader).
Either way the registry still owns the pattern and the predicate still says at
its declaration which route it took and why.

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

**The two authorities.** They are two different programs, not one program and
its source. `@asciidoctor/core` 4.0.11 is, its own README says, "a native
JavaScript implementation of Asciidoctor" whose "code was generated from the
Ruby source using Claude Code (claude-sonnet-4-6) and reviewed by a human". It
is what the harness renders through, so it is the program the render assertions
measure: cite `build/node/index.cjs`, or the `src/*.js` it is bundled from, for
anything you verified by running it. Asciidoctor Ruby 2.0.26 is the reference
its behaviour tracks; cite `parser.rb`, `rx.rb`, `reader.rb`, `substitutors.rb`,
`attribute_list.rb` or `asciidoctor.rb` by line only when you opened the source
and it agrees, and it lives in the tree at `vendor/asciidoctor-ruby/` (tag
`v2.0.26`) so that opening it is a `Read`, not a download. Cite the one you
MEASURED.

Where the two AGREE, that result binds: formatted output has to render the same
as the input did. Where they DISAGREE, neither binds, and the simplest behaviour
is ours to choose - it need not match either program. A harness renders the
corpus through both and pins the disagreements it finds in a ledger, so a
disagreement is a recorded fact rather than a surprise.

The two do diverge: the rewrite spells Ruby's `\p{Word}`
(`asciidoctor.rb l.436`) as `\p{Alphabetic}\p{N}\p{Pc}` (`index.cjs l.54`), and
it resolves an ordered list's `start` attribute
(`Parser.resolveOrderedListStart`, `index.cjs l.12154`) where 2.0.26 has no such
call at all, and its attrlist group in front of a quoted span
(`QuoteAttributeListRxt`, `index.cjs l.59`) crosses neither bracket where
2.0.26's inline spelling (`asciidoctor.rb l.446-468`) crosses an open one, so
`[a[b]**c**` carries class `b` to the oracle and `a[b` to a reader of the
vendored rows, and a blank line inside an OPEN table cell reaches an arm of its
own whose only call is `keepCellOpen` (`parser.js l.3376-3383`) where 2.0.26
blanks the line and lets it fall through to the arm a line with no separator
takes (`parser.rb l.2315-2316`), which would end a dsv cell there, so a dsv cell
held open by an escaped separator swallows the blank line after it to the oracle
and closes at it to a reader of the vendored rows. Where they diverge, the
comment names BOTH readings, states the divergence, and says which reading the
code follows, or that it follows neither, and why. There is no rule that one
program always wins. `bun run citation-check` holds every citation that names
its file to that file, that line and the names the comment puts beside it, and
reports the bare references that name none; a comment that cites nothing
checkable is fine, a comment that cites the wrong line is a failed gate.

The divergences this formatter carries KNOWINGLY, each recorded at its code site
as well as here, so a reader meets the list before meeting the shape:

- **A resolving `include::` inside a description or marker item (#107).** The
  oracle preprocesses `include::` before it parses, so when a target resolves
  the parser reads real content from another file, and no reader here can replay
  that without opening a file this formatter has no business reading. Nothing
  inside a paragraph or description reader can be right about that in isolation.
  Both programs resolve the target and this formatter cannot, so it replays the
  line where the author wrote it instead: the replayed bytes render exactly what
  the author's did wherever the target does not actually resolve. An UNRESOLVED
  include is narrower than that and is no longer a divergence: the oracle's
  preprocessor does not drop such a line, `replace_next_line` hands the parser a
  flush-left message line in its place (reader.rb l.258-262), and
  `adjust_indentation!` takes one such line anywhere in its scan as reason to
  leave the whole buffer's `block_indent` at `nil` (parser.rb l.2723-2732) -
  nothing in the block gets dedented. That is what keeps the space, and so the
  break, on a marker item's ` +` line above an unresolved include, and
  `Paragraph.adjustsIndentation` now takes the same route: an unresolved raw
  include line counts toward the common-indent scan exactly like the oracle's
  flush-left message would. What still differs is a MODEL no render can show for
  a RESOLVING include, and modelling the preprocessor lines is what would close
  that remainder.
- **A comment carrying a term separator (#119).** A `//` line whose text holds a
  word ending in `::`, `:::`, `::::` or `;;` keeps the output line the author
  gave it, and the description it stands in is never joined onto its term line.
  Joining it would hand the ENCLOSING list's sibling pattern a line to match
  (`is_sibling_list_item?`, parser.rb l.1430 and l.2281), which destroys a
  nested list and mangles its term. Both programs are answered on RESULTS - the
  replayed bytes render exactly what the author's did - and what is given up is
  the joined spelling, not a byte.

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
