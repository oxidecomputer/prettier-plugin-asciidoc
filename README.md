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
across a 1,614-case conformance corpus, exhaustive shape grids, and an
exhaustive product of every nested-list shape. Anything the parser cannot fully
model passes through byte-for-byte rather than being guessed at.

## Status

Early. Paragraphs, headings, lists (including nesting, continuations, and
checklists), delimited blocks, admonitions, inline formatting, links and macros,
attribute entries, and conditionals are parsed and formatted. Tables are
modeled, and a table whose facts the plugin fully records is reprinted in a
uniform shape; one holding anything it cannot record keeps its interior byte for
byte. Description lists are not yet modeled and pass through verbatim. Known
conformance gaps are tracked as
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

## Turning the formatter off for one block

A `// prettier-ignore` comment line tells the plugin to leave the block below it
exactly as written, children included:

```asciidoc
// prettier-ignore
| Key   | Meaning
| ----- | -------
| a     | the first
```

The pragma is an ordinary AsciiDoc line comment, so it renders as nothing. It
covers one block: the next one under it, plus anything nested inside that block.
Block metadata lines may stand between the two, and they are written back
unchanged as well:

```asciidoc
// prettier-ignore
[cols="1, 2"]
.A   deliberately   spaced   title
|===
| a |   b
|===
```

Four limits worth knowing.

- Headings are blocks in their own right, not section containers, so a pragma
  above `== Title` covers the heading line and not the section under it.
- A list ITEM cannot be ignored. A pragma written between two items is read into
  the item above it, as part of that item's own text, so it names no block and
  the item below still reflows. A pragma INSIDE an item, under a `+`
  continuation, does cover the block it attaches.
- The run from the pragma to the block it names crosses block metadata, other
  comment lines, preprocessor directives, and blank lines. It ends at anything
  else, an attribute entry (`:name: value`) and a `////` comment block included,
  and that line is then the block the pragma covers.
- Prettier strips trailing whitespace from every line it writes, an ignored
  block's lines included.

## Options

Two options, resolved by Prettier like any other: set them in a Prettier config,
or pass `--asciidoc-table-layout` and `--asciidoc-table-align-columns` on the
command line.

| Option                      | Values            | Default |
| --------------------------- | ----------------- | ------- |
| `asciidocTableLayout`       | `"row"`, `"cell"` | `"row"` |
| `asciidocTableAlignColumns` | `true`, `false`   | `false` |

Both apply only to a table the plugin fully models. A table holding any of ten
facts the layout cannot answer for (a cell whose text spans source lines, a
literal cell, a non-`psv` format, an attribute line above it whose values could
not be read, and six more) keeps its interior exactly as written, and neither
option changes that.

`asciidocTableLayout` chooses how an accepted table is written. `"row"` puts one
recorded row on one source line, unless some row does not fit in `printWidth`,
in which case the whole table prints in the cell shape instead. `"cell"` puts
one cell per line after the first row, whatever the width. The first row is
never split under either value: until a row has closed there is no column count
to split against.

`asciidocTableAlignColumns` pads cell text on the right so that the separators
of a table's rows stand in the same columns. It applies only where rows are on
one line, so it does nothing under `"cell"` or where the width chose the cell
shape, and it does nothing for a table holding a colspan or a rowspan, whose
cells do not sit in a fixed grid. The layout is chosen from the unpadded rows
and the padding is added afterwards, so an aligned table may exceed the print
width its unaligned spelling fitted inside.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow, and:

- [docs/architecture.md](docs/architecture.md) — how the plugin is built and
  why, from the Prettier API down, including the formatting policy
- [docs/harnesses.md](docs/harnesses.md) — what each verification tool proves,
  and the scorecard the codebase is held to

## License

MPL-2.0
