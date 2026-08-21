# AsciiDoc Format Reference

Reference for implementing the parser. Derived from the
[AsciiDoc language project](https://gitlab.eclipse.org/eclipse/asciidoc-lang/asciidoc-lang),
the
[syntax quick reference](https://docs.asciidoctor.org/asciidoc/latest/syntax-quick-reference/),
and the
[ASG schema](https://gitlab.eclipse.org/eclipse/asciidoc-lang/asciidoc-lang/-/tree/main/asg).

## Encoding

AsciiDoc files are UTF-8. A UTF-8 BOM (byte order mark) at the start of the file
should be handled gracefully — parsed correctly and stripped in output.

## Document structure

An AsciiDoc document has an optional **header** followed by a **body**.

```
= Document Title        ← level-0 heading (document title)
Author Name <email>     ← optional author line (immediately after title, no blank line)
v1.0, 2024-01-15        ← optional revision line
:toc:                   ← attribute entries (no blank line between them)
:source-highlighter: rouge

Body starts here after the first blank line.
```

The header is everything from the document title through the last attribute
entry before the first blank line. All header lines must be contiguous — no
blank lines allowed within the header.

The author line can be an attribute reference instead of a literal name:

```
:authors: Rain Paharia <rain@oxide.computer>

= RFD 400 Title
{authors}
```

This is standard attribute substitution — `{authors}` is an inline attribute
reference that happens to be the only content on the line. The header parser
must handle this without error.

## Sections

Sections use `=` markers. The number of `=` signs determines the level.

```
= Document Title (level 0 — only one per document in article doctype)
== Level 1
=== Level 2
==== Level 3
===== Level 4
====== Level 5
```

There must be a space between the `=` markers and the title text. Sections are
hierarchical — a level-2 section is a child of the preceding level-1 section.

### Underline-style (two-line) headings

Legacy syntax where the title is on one line and underlined on the next:

```
Level 0 Title
=============

Level 1 Title
-------------

Level 2 Title
~~~~~~~~~~~~~

Level 3 Title
^^^^^^^^^^^^^

Level 4 Title
+++++++++++++
```

Underline characters: `=` (level 0), `-` (level 1), `~` (level 2), `^` (level
3), `+` (level 4). The underline must be within ±2 characters of the title
length. Our formatter normalizes these to ATX-style.

A **discrete heading** is a heading that doesn't create a section (no nesting):

```
[discrete]
=== Not a Section
```

## Paragraphs

One or more consecutive non-blank lines. Paragraphs are separated by blank
lines.

```
First paragraph.
Still the first paragraph.

Second paragraph.
```

A line indented by one or more spaces is a **literal paragraph** (monospace,
preserved formatting) — unless it's inside a list item:

```
This is a normal paragraph.

 This line starts with a space, so it becomes
 a literal paragraph rendered in monospace.
```

## Inline formatting

### Constrained (at word boundaries)

| Syntax        | Meaning        |
| ------------- | -------------- |
| `*bold*`      | strong         |
| `_italic_`    | emphasis       |
| `` `mono` ``  | code/monospace |
| `#highlight#` | mark           |
| `^super^`     | superscript    |
| `~sub~`       | subscript      |

### Unconstrained (can appear mid-word)

| Syntax          | Meaning  |
| --------------- | -------- |
| `**bold**`      | strong   |
| `__italic__`    | emphasis |
| ` `` mono `` `  | code     |
| `##highlight##` | mark     |

Constrained forms require the mark to be at a word boundary (preceded/followed
by whitespace, punctuation, or start/end of line). Unconstrained forms use
doubled marks and can appear anywhere.

The ASG represents these as `span` nodes with `variant`
(strong/emphasis/code/mark) and `form` (constrained/unconstrained).

### Backslash escapes

A backslash before an inline formatting character prevents interpretation:

```
\*not bold*
\_not italic_
\http://example.com
\<<not-a-xref>>
\[[not-an-anchor]]
```

The parser must recognize escaped syntax and the printer must preserve the
escapes.

### Role/style attributes on inline formatting

Inline formatting marks can be preceded by an attribute list specifying roles or
styles:

```
[red]#styled text#
[big red yellow-background]*bold styled text*
[underline]#underlined text#
[line-through]#strikethrough#
```

The `[.role]#text#` form with the dot prefix is the most common way to apply CSS
classes to arbitrary inline text:

```
[.line-through]#struck through text#
[.summary]#This text has the "summary" role.#
```

The `#text#` (mark/highlight) syntax is the primary carrier for arbitrary
roles/styles because it has no default visual styling of its own beyond
highlighting.

### Links and references

```
https://example.com                     ← autolink (bare URL)
https://example.com[Link Text]          ← URL with text
link:path/to/file.html[Link Text]       ← link macro
mailto:user@example.com[Email]          ← mailto
<<section-id>>                          ← cross-reference (same document)
<<section-id,Custom Text>>              ← xref with display text
xref:other-doc.adoc#anchor[Text]        ← inter-document xref
```

The ASG represents these as `ref` nodes with `variant` (link/xref) and `target`.

### Other inline elements

```
image:icon.png[Alt]                     ← inline image
kbd:[Ctrl+S]                            ← keyboard shortcut
btn:[OK]                                ← button
menu:File[Save]                         ← menu selection
footnote:[Footnote text]                ← footnote
footnoteref:["name","Footnote text"]    ← named footnote
footnoteref:[name]                      ← footnote reference
+literal passthrough+                   ← inline literal (no substitutions)
pass:[<raw>]                            ← passthrough macro
[[inline-anchor]]                       ← inline anchor (mid-paragraph)
[[[biblio-id]]]                         ← bibliography anchor (in list items)
[[[biblio-id, reftext]]]                ← bibliography anchor with display text
```

### Index terms

```
((visible index term))                  ← double-paren (inline)
(((primary,secondary,tertiary)))        ← triple-paren (inline)
indexterm:[primary,secondary]           ← macro form
indexterm2:[visible term]               ← macro form
```

The parser must recognize these to avoid misinterpreting the parentheses as
regular text.

### Hard line break

A `+` at the end of a line forces a line break:

```
First line +
Second line
```

Or use `[%hardbreaks]` on the paragraph.

## Lists

### Unordered

```
* Item 1
* Item 2
** Nested item
*** Deeper
```

Markers: `*` (level 1), `**` (level 2), through `*****` (level 5).

### Ordered

```
. First
. Second
.. Sub-step
... Deeper
```

Markers: `.` (level 1), `..` (level 2), through `.....` (level 5).

Explicit numbering styles are also supported:

```
1. Arabic numerals
a. Lowercase alpha
A. Uppercase alpha
i) Lowercase roman
I) Uppercase roman
```

The `[start=N]` attribute controls the starting number:

```
[start=7]
. Seventh item
. Eighth item
```

### Checklist

```
* [*] Checked
* [x] Also checked
* [ ] Unchecked
```

### Description list

```
Term:: Definition on same line
Another Term::
  Definition on next line
```

Nested description lists use increasing numbers of colons: `::` (level 1), `:::`
(level 2), `::::` (level 3):

```
Operating Systems::
  Linux:::
    Ubuntu::::
      A Debian-based distribution.
    Fedora::::
      An RPM-based distribution.
  macOS:::
    Apple's desktop OS.
```

Description list items can have complex content attached via list continuation:

```
Term::
  Definition paragraph.
+
A second paragraph attached to this term.
+
----
A code block also attached to this term.
----
```

### List continuation

A `+` on its own line attaches the next block to the current list item:

```
* List item
+
Continuation paragraph attached to the item above.
+
----
Code block also attached.
----
```

An open block (`--`) can wrap multiple elements to attach them all to a list
item without needing `+` between each:

```
* First item

* Second item with complex content
+
--
This paragraph is attached to the second item.

So is this one — no `+` needed between them inside
the open block.

----
And this code block too.
----
--

* Third item
```

### Callout list

```
[source,ruby]
----
puts "hello" # <1>
puts "world" # <2>
----
<1> Prints hello
<2> Prints world
```

## Delimited blocks

Blocks are enclosed by matching delimiter lines. The delimiter must be at least
4 characters (except open blocks which use `--`). Opening and closing delimiters
must use the same character and the same length.

Delimiters can be longer than the minimum for visual clarity, especially when
nesting:

```
----
short listing
----

----------
longer delimiter (still a listing block)
----------
```

### Leaf blocks (content is NOT parsed as AsciiDoc)

| Delimiter | Name        | Purpose                             |
| --------- | ----------- | ----------------------------------- |
| `----`    | listing     | Code/preformatted text              |
| `....`    | literal     | Literal text (monospace, preserved) |
| `++++`    | passthrough | Raw output (HTML, etc.)             |

```
----
#include <stdio.h>

int main() {
   printf("Hello World!\n");
   return 0;
}
----
```

```
....
This text is rendered exactly as written.
  Indentation and *markup* are preserved literally.
....
```

```
++++
<div class="custom">
  <p>Raw HTML passed through to output.</p>
</div>
++++
```

Listing blocks are commonly used with `[source,language]` for syntax-highlighted
code:

```
[source,python]
----
def greet(name):
    print(f"Hello, {name}!")
----
```

### Backtick-fenced code blocks

Asciidoctor supports Markdown-style triple-backtick fenced code blocks as an
alternative to `----` listing blocks. An optional language hint follows the
opening fence:

````
```rust
fn main() {
    println!("Hello, world!");
}
```
````

These are equivalent to `[source,lang]` + `----` blocks. The parser must
recognize the opening ` ``` ` (with optional language) and closing ` ``` ` as
leaf block delimiters. The formatter normalizes these to AsciiDoc-native
`[source,lang]` + `----` blocks.

Verse (`____`) is a leaf block when preceded by `[verse]` — line breaks are
preserved but inline markup is still processed:

```
[verse, William Blake, Auguries of Innocence]
____
To see a world in a grain of sand,
And a heaven in a *wild flower*,
Hold infinity in the palm of your hand,
And eternity in an hour.
____
```

Stem (`____` with `[stem]`) is for math notation — content is passed through
without AsciiDoc processing:

```
[stem]
____
sqrt(4) = 2
____
```

Comment blocks (`////`) are also delimited blocks — their content is discarded
in output but must be preserved by a formatter:

```
////
This is a block comment.
The parser ignores everything in here.
////
```

### Parent blocks (content IS parsed recursively as AsciiDoc)

| Delimiter | Name    | Purpose                                          |
| --------- | ------- | ------------------------------------------------ |
| `====`    | example | Example content                                  |
| `****`    | sidebar | Sidebar content                                  |
| `____`    | quote   | Block quote (default, without `[verse]`)         |
| `--`      | open    | Generic container, can masquerade as other types |

```
====
This is an example block. It can contain *formatted text*,
lists, and other AsciiDoc elements.

. Step one
. Step two
====
```

```
****
This is a sidebar. Sidebars are typically rendered in a box
set apart from the main content flow.
****
```

```
____
This is a block quote. The content is parsed as AsciiDoc,
so *bold* and other markup works.
____
```

```
--
An open block groups elements together. On its own it has
no visual styling — it just acts as a container.
--
```

### Nesting parent blocks

Parent blocks can nest. Use longer delimiters on the outer block so the parser
can distinguish them:

```
========
An outer example block.

====
A nested example block inside the outer one.
====

Back in the outer block.
========
```

Different block types can nest freely since their delimiter characters differ:

```
====
An example containing a sidebar:

****
Sidebar content nested inside the example.
****
====
```

### Block masquerading

A style attribute on a delimited block can change the block's effective context
and content model. This is called "masquerading." The most common case is open
blocks, but other block types support it too.

Open blocks adopt the behavior of other block types via a preceding attribute
list:

```
[source,python]
--
def hello():
    print("world")
--
```

When `[source]` or `[listing]` is applied, the open block behaves like a leaf
block (verbatim content). When `[verse]` or `[quote]` is applied, it gains
attribution syntax.

Open blocks can also masquerade as admonitions:

```
[NOTE]
--
This note can contain multiple paragraphs,
lists, and other block elements.

* Item one
* Item two
--
```

The full masquerade table from the Asciidoctor converter:

| Delimiter        | Default context | Masquerade styles                                                                                        |
| ---------------- | --------------- | -------------------------------------------------------------------------------------------------------- |
| `--` (open)      | open            | comment, example, literal, listing, pass, quote, sidebar, source, verse, admonition, abstract, partintro |
| `----` (listing) | listing         | literal, source                                                                                          |
| `....` (literal) | literal         | listing, source                                                                                          |
| `====` (example) | example         | admonition (NOTE, TIP, IMPORTANT, CAUTION, WARNING)                                                      |
| `____` (quote)   | quote           | verse                                                                                                    |
| `++++` (pass)    | pass            | stem, latexmath, asciimath                                                                               |

**Impact on content model:** Masquerading changes how the block's content is
parsed. A `____` block is normally a compound quote (content parsed as
AsciiDoc), but with `[verse]` it becomes verbatim (line breaks preserved, no
reflow). A `++++` block is normally raw passthrough, but with `[stem]` it's math
notation. An `====` block with `[NOTE]` becomes an admonition container. A
formatter must check the style attribute to determine the correct content model
— otherwise it risks reflowing verbatim content or failing to parse compound
content.

### Quote/verse attribution

The second and third positional attributes on quote and verse blocks provide
attribution:

```
[quote, Albert Einstein, Relativity]
____
God does not play dice with the universe.
____

[verse, Carl Sandburg, Fog]
____
The fog comes
on little cat feet.
____
```

Attribution also works on paragraph-form quotes/verses and open-block
masquerading:

```
[quote, Marcus Aurelius]
--
The happiness of your life depends upon the
quality of your thoughts.
--
```

### Block forms

The ASG schema distinguishes three forms:

- **delimited**: enclosed by delimiter lines (`----` ... `----`)
- **indented**: a literal paragraph (indented by space)
- **paragraph**: paragraph-form (e.g., `NOTE: text` for an admonition)

Paragraph-form blocks use a preceding attribute list to change how a plain
paragraph is interpreted:

```
[verse, Author, Source]
This is a verse paragraph.
Line breaks are preserved.

[quote, Author, Source]
This is a quote paragraph.

[source,ruby]
puts "hello"
```

### Block with attributes

```
.Block Title
[source,ruby]
----
puts "hello"
----
```

The `.Title` line and `[attributes]` line must be immediately above the block
with no blank lines.

## Admonitions

Paragraph form — a single paragraph prefixed by the admonition label:

```
NOTE: This is a note.
TIP: This is a tip.
IMPORTANT: This is important.
CAUTION: Use caution.
WARNING: This is a warning.
```

Block form — any of the five types can use an example block delimiter for
multi-paragraph content:

```
[NOTE]
====
First paragraph of the note.

Second paragraph with *formatting* and a list:

* Item one
* Item two
====
```

Block-form admonitions can also use an open block (`--`) instead of `====`:

```
[WARNING]
--
This warning contains multiple blocks.

----
code example inside the warning
----
--
```

### Custom block styles

Asciidoctor is not limited to the five standard admonition types. Arbitrary
uppercase names are valid as block styles:

```
[EXERCISE]
====
Design a circuit that...
====
```

Asciidoctor treats unknown uppercase names as custom admonitions (or styled
blocks). The parser should preserve these as opaque attributed blocks rather
than rejecting them — the same structure as standard admonitions, just with a
non-standard label.

## Tables

Basic table with implicit header (first row followed by a blank line):

```
|===
|Name |Role |Status

|Alice
|Developer
|Active

|Bob
|Designer
|On leave
|===
```

Equivalent explicit header: `[%header]` or `[options="header"]`.

### Column specification

`[cols="..."]` controls widths, alignment, and content style:

```
[cols="1,3,^1"]
|===
|ID |Description |Count

|1
|Widget assembly
|42

|2
|Gadget packaging
|17
|===
```

- Numbers are proportional widths (`1,3,1` = 20%, 60%, 20%)
- Alignment prefixes: `<` left (default), `^` center, `>` right
- Vertical alignment: `.<` top (default), `.^` middle, `.>` bottom
- Content style `a` marks a column as AsciiDoc content (cells are parsed
  recursively). Other styles (`m`, `s`, `e`, `l`, `v`, `h`) are rendering hints
  the formatter preserves as-is.

### Header and footer rows

```
[%header%footer,cols="2,1"]
|===
|Item |Price

|Coffee
|$3

|Tea
|$2

|Total
|$5
|===
```

The last row is treated as a footer when `%footer` or `options="footer"` is set.

### Merged cells

Column span — `N+|` merges N columns:

```
|===
|A |B |C

3+|This cell spans all three columns

|X |Y |Z
|===
```

Row span — `.N+|` merges N rows:

```
|===
|A |B

.2+|Spans two rows
|Right 1

|Right 2
|===
```

Combined — `C.R+|` spans C columns and R rows:

```
|===
|A |B |C

2.2+|Spans 2 cols and 2 rows
|C1

|C2

|X |Y |Z
|===
```

Cell-level alignment overrides column defaults: `^|` (center), `>|` (right),
`.^|` (vertical middle).

### Full cell prefix grammar

All cell prefix components can be combined on a single cell. The full grammar in
order is:

```
[col-span][.row-span+][h-align][.v-align][content-style]|
```

Where:

- **Column span**: `N+` (merge N columns)
- **Row span**: `.N+` (merge N rows)
- **Horizontal alignment**: `<` (left), `^` (center), `>` (right)
- **Vertical alignment**: `.<` (top), `.^` (middle), `.>` (bottom)
- **Content style**: `a` (AsciiDoc), `h` (header), `m` (monospace), `s`
  (strong), `e` (emphasis), `l` (literal), `v` (verse)

Real-world examples of combined prefixes:

```
.2+^.^h|Distribution Option    ← row-span 2, center, v-middle, header
4+^h|Fraction of Design Load   ← col-span 4, center, header
>s|Total                        ← right-align, strong
.3+^.^a|                        ← row-span 3, center, v-middle, asciidoc
```

The table parser must handle the full combinatorial prefix, not just individual
features in isolation.

### CSV and DSV tables

CSV shorthand uses `,===` delimiters with comma-separated cells:

```
,===
a,b,c
1,2,3
,===
```

DSV shorthand uses `:===` with colon-separated cells:

```
:===
root:x:0
bin:x:1
:===
```

The `[format="csv"]` attribute can also be applied to a standard `|===` table.

### Nested tables

Inside an `a` (AsciiDoc) style cell, inner tables use `!` as the cell separator
and `!===` as delimiters:

```
[cols="1,2a"]
|===
|Normal cell
|Cell with a nested table:

!===
! Nested header 1 ! Nested header 2

! Cell A
! Cell B
!===
|===
```

## Block macros

```
image::path/to/image.png[Alt text]
video::video.mp4[]
video::RvRhUHTV_8k[youtube]
audio::audio.wav[]
toc::[]
```

## Include directives

```
include::path/to/file.adoc[]
include::file.txt[lines=5..10]
include::file.txt[tag=section-name]
include::file.adoc[leveloffset=+1]
```

A formatter must preserve include directives literally — do NOT resolve them.

## Conditional directives

```
ifdef::attribute-name[]
Content shown if attribute is set.
endif::[]

ifndef::attribute-name[]
Content shown if attribute is NOT set.
endif::[]

ifeval::[{attribute} == "value"]
Content shown if expression is true.
endif::[]
```

A formatter must preserve these literally — do NOT evaluate them.

## Attribute entries

```
:attribute-name: value
:!attribute-name:              ← unset attribute
:attribute-name!:              ← also unset (alternative syntax)
:long-value: first part \
  continued on next line       ← line continuation with \
```

### Attribute references

Attribute references substitute the value of a document attribute inline:

```
:project: My Project
:version: 2.0

Welcome to {project} version {version}.
```

The syntax is `{attribute-name}`. References can appear anywhere inline content
is allowed — paragraphs, headings, list items, block titles, attribute values,
and even the author line position in a document header.

Counter attributes auto-increment: `{counter:name}` (display value),
`{counter2:name}` (increment without display).

A formatter preserves attribute references verbatim — it does not resolve them
to their values.

## Comments

Line comment:

```
// This is a comment
```

Block comment (a delimited block using `////`):

```
////
This is a
block comment.
////
```

Line comments can appear between block metadata lines without breaking the
attachment:

```
// TODO: improve this example
.Block Title
----
content
----
```

Comments are discarded by Asciidoctor during parsing. A formatter must preserve
them.

## Breaks

```
'''                             ← thematic break (horizontal rule)
<<<                             ← page break
```

## Block metadata

Blocks can be preceded by metadata lines (no blank lines between them):

```
[[anchor-id]]                   ← block anchor (single-argument)
[[id, reftext]]                 ← block anchor with reference text
[#id.role%option]               ← shorthand attributes (id, role, option)
[source,ruby]                   ← positional + named attributes
.Block Title                    ← block title
```

The two-argument form `[[id, reftext]]` sets both the anchor ID and the default
cross-reference display text — so `<<id>>` renders as "reftext" without needing
`<<id,reftext>>` at every call site.

`[[id]]` and `[#id]` both set the block's ID. The shorthand form `[#id]` can be
combined with other attributes: `[#myid.summary%collapsible]` sets the id to
`myid`, adds the role `summary`, and enables the option `collapsible`. These can
also be combined with positional attributes: `[source,ruby,#code-example]`.

These must appear in order: anchor, attribute list, title — all immediately
before the block. Here is a complete example:

```
[[api-example]]
[source,python]
.Making an API request
----
import requests
response = requests.get("https://api.example.com/data")
----
```

### Special section attributes

Certain attribute lists change section semantics without affecting formatting:

```
[abstract]                              ← abstract section
[appendix]                              ← appendix section
[bibliography]                          ← bibliography section
[glossary]                              ← glossary section
[index]                                 ← index section
```

A formatter preserves these as-is.

### Bibliography anchors

Inside a `[bibliography]` section, list items can define bibliography anchors
using triple brackets:

```
[bibliography]
== References

- [[[prag]]] Andy Hunt & Dave Thomas. The Pragmatic Programmer:
  From Journeyman to Master. Addison-Wesley, 1999.
- [[[gof,1]]] Erich Gamma et al. Design Patterns. Addison-Wesley, 1994.
```

The syntax `[[[id]]]` defines a referenceable anchor that renders as `[id]` in
output. The two-argument form `[[[id, reftext]]]` renders as `[reftext]` instead
— e.g., `[[[gof,1]]]` renders as `[1]`. These are referenced elsewhere with
standard xref syntax: `<<prag>>` or `<<gof>>`.

Structurally, bibliography anchors are inline elements that appear at the start
of unordered list items. They function like `[[id]]` block anchors but use
triple brackets and are scoped to bibliography entries.

A formatter preserves these verbatim.

## ASG node types (from the official schema)

The ASG represents parsed documents as a tree of typed nodes. Each node has
`name`, `type`, and `location`.

**Block nodes** (`type: "block"`):

- `document` — root
- `section` — with `level` and `title` (array of inline nodes)
- `paragraph` — with `inlines`
- `listing`, `literal`, `pass`, `stem`, `verse` — leaf blocks with `form` and
  optional `delimiter`
- `admonition`, `example`, `sidebar`, `open`, `quote` — parent blocks with
  `blocks`
- `list` (ordered/unordered/callout) — with `items`
- `dlist` — description list with `items` containing `terms`
- `discreteHeading` — non-section heading
- `break` (thematic/page)
- `blockMacro` (image/video/audio/toc)

**Inline nodes** (`type: "inline"`):

- `span` — with `variant` (strong/emphasis/code/mark) and `form`
  (constrained/unconstrained)
- `ref` — with `variant` (link/xref) and `target`
- `text` — plain text literal (`type: "string"`)
- `charref` — character reference (`type: "string"`)
- `raw` — passthrough content (`type: "string"`)

**Location format:**

```json
"location": [
  { "line": 1, "col": 1 },
  { "line": 1, "col": 16 }
]
```

Line numbers are 1-based. Column numbers are 0-based in the schema (though the
spec's own examples show 1-based — verify when implementing).

## What the ASG does NOT represent

The ASG is semantic — it intentionally omits:

- Comments (line and block)
- Attribute entries (consumed into document attributes)
- Include directives (resolved)
- Conditional directives (evaluated)
- Blank lines between blocks
- Block metadata lines (anchors, attribute lists — merged into block attributes)
- Delimiter syntax details beyond the `delimiter` field on leaf blocks

Our parser AST must represent all of these because the formatter needs to
preserve and normalize them.
