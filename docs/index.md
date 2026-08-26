# Documentation index

Start here. One line on what each document is for, so you read the right one.

- [../CONTRIBUTING.md](../CONTRIBUTING.md) — how to work on the repo: setup,
  everyday commands, the before-you-push checklist, and when the heavy checks
  (mutation, differential harnesses) run.
- [architecture.md](architecture.md) — how the plugin is built and why, top-down
  from the Prettier plugin API: the pipeline stage by stage, the formatting
  policy, error handling, and the design decisions (hand-written parser, no
  runtime dependencies).
- [coding-standards.md](coding-standards.md) — lint rules, comment and JSDoc
  conventions, and the three-step recipe for adding a line-shaped or inline
  construct.
- [harnesses.md](harnesses.md) — what each tool under `scripts/` proves, the
  exit-code contract, the CI jobs, and the measurement discipline: the metrics
  scorecard, the design-quality budgets, mutation testing, and the recorded
  minimums.

Roadmap and known gaps are not in-repo: see the
[GitHub issues](https://github.com/oxidecomputer/prettier-plugin-asciidoc/issues)
(severity labels `tier-1`/`tier-2`) and the
[project board](https://github.com/orgs/oxidecomputer/projects/228). For
AsciiDoc syntax itself, the references are the
[official syntax docs](https://docs.asciidoctor.org/asciidoc/latest/syntax-quick-reference/)
and Asciidoctor's Ruby source — the in-repo registries
(`src/parse/line-shapes.ts`, `src/parse/inline/rules.ts`) cite the exact Ruby
they mirror, and that Ruby is vendored at `vendor/asciidoctor-ruby/` so the
citations can be opened and checked (`bun run citation-check`, which holds every
citation that names its file to that file and reports the bare references that
name none).
