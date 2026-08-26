# Vendored Dependencies

Managed by `bun run vendor` (runs `scripts/vendor.ts`).

## asciidoctor-corpus

Conformance-test inputs extracted from the Asciidoctor project (issue #7):
heredoc inputs from `test/*_test.rb` (single-quoted `<<~'EOS'` heredocs
only, as JSONL with stable case IDs), the AsciiDoc documents under
`test/fixtures/` (`fixtures.jsonl`), and the `.adoc` documentation pages
under `docs/` (`docs.jsonl`).

- Source: https://github.com/asciidoctor/asciidoctor
- Pinned commit: `ae5891df10f12dda069abea8a318c9b94d545bee`
  (also pinned in `scripts/vendor.ts`; bump deliberately — case IDs feed
  the quarantine manifest in `tests/conformance/quarantine.json`)
- License: MIT (see `asciidoctor-corpus/LICENSE`)

## asciidoctor-ruby

The six Asciidoctor Ruby sources this repository's comments cite, verbatim:
`asciidoctor.rb`, `attribute_list.rb`, `parser.rb`, `reader.rb`, `rx.rb`,
`substitutors.rb`.

They are here because they are the design spec the parser mirrors, and our
comments name their line numbers. A citation is the one part of a comment a
reader cannot check by reading, so `bun run citation-check` checks every
citation that names its file, and it can only do that offline if the sources are
in the tree. (A bare `l.1439` in a comment that names no file, or names two, is
reported unchecked rather than guessed at; the run prints how many.) The Ruby is
the SPEC; the behavioral authority is the oracle (`@asciidoctor/core`, in
`node_modules`), which is a transpile of this same release and occasionally
diverges from it. See "The two authorities" in `docs/coding-standards.md`.

- Source: https://github.com/asciidoctor/asciidoctor
- Pinned tag: `v2.0.26` (also pinned in `scripts/vendor.ts`): the release
  `@asciidoctor/core` 4.0.11 is transpiled from. Bumping it moves line numbers;
  `bun run citation-check` is what says which comments have to move with them.
- License: MIT (see `asciidoctor-ruby/LICENSE`), which permits redistribution
  with the copyright notice, which is the file beside them.
