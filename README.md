# prettier-plugin-asciidoc

A [Prettier](https://prettier.io/) plugin for formatting AsciiDoc (`.adoc`)
files.

## What it does

The plugin parses AsciiDoc with its own source-preserving parser and reprints it
in a uniform style: paragraphs reflow to the print width, attribute entries and
attribute lists take one canonical spelling, inline formatting marks use the
constrained form where it is legal, and blank-line and continuation residue is
normalized.

The governing policy (stated in full in
[docs/architecture.md](docs/architecture.md)): **normalize in a way that always
preserves meaning.** Every transformation must leave the rendered document
identical — the plugin verifies its own work against Asciidoctor's rendering
across a 1,614-case conformance corpus, exhaustive shape grids, and a depth-5
product of every nested-list shape. Anything the parser cannot fully model
passes through byte-for-byte rather than being guessed at.

## Status

Early. Paragraphs, headings, lists (including nesting, continuations, and
checklists), delimited blocks, admonitions, inline formatting, links and macros,
attribute entries, and conditionals are parsed and formatted. Description lists
and tables are not yet modeled — they pass through verbatim. Known conformance
gaps are tracked as
[issues](https://github.com/oxidecomputer/prettier-plugin-asciidoc/issues)
labeled `tier-1`/`tier-2`.

## Usage

Not yet published to npm. To use a local build:

```bash
bun install && bun run build
```

Then point a Prettier config at it:

```json
{
  "plugins": ["/path/to/prettier-plugin-asciidoc/dist/index.js"]
}
```

and format:

```bash
prettier --write doc.adoc
```

In VS Code, the Prettier extension needs to be told about the extension:

```json
{
  "prettier.documentSelectors": ["**/*.adoc"]
}
```

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow, and:

- [docs/architecture.md](docs/architecture.md) — how the plugin is built and
  why, from the Prettier API down, including the formatting policy
- [docs/harnesses.md](docs/harnesses.md) — what each verification tool proves,
  and the scorecard the codebase is held to

## License

MPL-2.0
