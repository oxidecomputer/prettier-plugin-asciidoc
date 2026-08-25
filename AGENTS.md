# AGENTS.md

A Prettier plugin for formatting AsciiDoc (.adoc) files.

## Project knowledge

**IMPORTANT: Read [docs/index.md](docs/index.md) first** — it is the index of
all project documentation (architecture, coding standards, contributing
workflow, harnesses, metrics) with one line on when to read each.

Version control is jj, not git: `jj st`, `jj diff --git`,
`jj describe -m "message"`, `jj new`, `jj log`. Never run anything that opens an
interactive editor — in particular never `jj squash -m`; squash with
`jj squash --use-destination-message` and re-describe. Never bare `bun test`
(Bun's own runner fails on vitest-only constructs); always `bun run test`.

## Roadmap

Planned work and known conformance gaps live in
[GitHub issues](https://github.com/oxidecomputer/prettier-plugin-asciidoc/issues)
and the [project board](https://github.com/orgs/oxidecomputer/projects/228) —
there is no in-repo plan document. Gap issues are labeled by severity: `tier-1`
(formatting corrupts or mangles output) and `tier-2` (structure lost but text
preserved). Spec refs `p.NNN` in issues are printed page numbers in the
[AsciiDoc pre-spec PDF export](https://docs.asciidoctor.org/asciidoc/latest/_exports/asciidoc-pre-spec.pdf)
(PDF page = printed page + 17; a local copy lives at
`docs/asciidoc-pre-spec.pdf`, gitignored).
