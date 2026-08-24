# AGENTS.md

A Prettier plugin for formatting AsciiDoc (.adoc) files.

## Project knowledge

**IMPORTANT: Read the relevant memories before starting work.**

- [Architecture](.serena/memories/architecture.md) — pipeline, components, tech
  stack, key references
- [Coding standards](.serena/memories/coding-standards.md) — lint rules, comment
  conventions, JSDoc discipline
- [Commands](.serena/memories/commands.md) — dev commands, jj commands, version
  control pitfalls
- [Task completion checklist](.serena/memories/task_completion_checklist.md) —
  verification steps before considering work done
- [Harnesses](docs/harnesses.md) — what each tool under `scripts/` proves, the
  exit-code contract, and the CI jobs

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
