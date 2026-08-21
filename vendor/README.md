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
