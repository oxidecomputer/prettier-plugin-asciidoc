/**
 * What a held style does at a block's OPENING line — the style tables
 * that lived in paragraph-form.ts, in their one home.
 * Behavior is Ruby's next_block style handling (parser.rb:533-555 for
 * delimited blocks, :723-729 for paragraph-form styles), pinned by
 * tests/{parser,format}/block-masquerade.test.ts and
 * tests/parser/verbatim-styled.test.ts; the STRUCTURE — resolving at
 * the reader's dispatch point instead of unshifting the line back
 * through build_block — is a declared departure from Ruby's
 * mechanism, with its behavior unchanged.
 */
import type { BlockNode, ParentBlockNode, VerbatimVariant } from "../../ast.js";
import { canonicalAttrlist } from "../attrlist.js";
import type { DelimiterKind, ParagraphContext } from "../line-shapes.js";
import type { VerbatimRole } from "../build/delimited.js";
import type { TableFormat } from "./table-reader.js";

// The model a BARE delimiter opens, before any held style speaks —
// one row per DELIMITER_KINDS entry, totality compiler-checked by the
// Record key. Compound rows are `DELIMITED_BLOCKS`' block content
// model; everything else keeps its bytes (a comment block builds a
// CommentNode, a table its own recorded cells).
const DELIMITER_MODELS: Record<
  DelimiterKind,
  | { readonly compound: ParentBlockNode["variant"] }
  | { readonly role: VerbatimRole }
  | { readonly cuts: TableFormat }
> = {
  listing: { role: { builds: "leafBlock", variant: "listing" } },
  literal: { role: { builds: "leafBlock", variant: "literal" } },
  pass: { role: { builds: "leafBlock", variant: "pass" } },
  example: { compound: "example" },
  sidebar: { compound: "sidebar" },
  quote: { compound: "quote" },
  commentBlock: { role: { builds: "comment" } },
  openBlock: { compound: "open" },
  // The same content model as `openBlock` above; see this map's own
  // doc comment for why the tilde spelling is still its own row, and
  // resolveDelimitedOpen below for the one place that keys off `kind`
  // itself rather than off this shared `compound` value.
  openBlockTilde: { compound: "open" },
  // Fences imply the `source` style even without a language hint; the
  // reader completes the role with the hint parsed from the line.
  fencedCode: { role: { builds: "fencedBlock" } },
  // A table row carries the FORMAT its hint character contributes,
  // which a `format=` attribute then overrides: `,` contributes csv
  // and `:` dsv (`attributes['format'] ||=`, parser.rb:874-877),
  // while `|` and `!` contribute the psv every other path defaults
  // to. The separator is NOT here - it follows from the resolved
  // format and the block's own attribute list, where the held line is
  // readable (lines/table-open.ts).
  tablePipe: { cuts: "psv" },
  tableComma: { cuts: "csv" },
  tableColon: { cuts: "dsv" },
  tableBang: { cuts: "psv" },
};

// Styles that masquerade a parent block's content model to verbatim,
// keyed parent variant -> style -> target variant (coverage unchanged;
// widening toward Ruby's full masq sets, asciidoctor.rb:278-292, is
// out of scope). Pass-block masquerades ([stem] on ++++) are
// deliberately absent: they do not change the content model.
const VERBATIM_MASQUERADES: ReadonlyMap<
  ParentBlockNode["variant"],
  ReadonlyMap<string, VerbatimVariant>
> = new Map([
  [
    "quote",
    new Map<string, VerbatimVariant>([
      ["verse", "verse"],
      ["stem", "pass"],
      ["latexmath", "pass"],
      ["asciimath", "pass"],
    ]),
  ],
  [
    "open",
    new Map<string, VerbatimVariant>([
      ["source", "listing"],
      ["listing", "listing"],
      ["literal", "literal"],
      ["pass", "pass"],
      ["comment", "pass"],
      ["verse", "verse"],
    ]),
  ],
]);

// Matches any single word of uppercase ASCII letters, after the style
// is uppercased — so any single alphabetic word reads as an admonition
// variant. KNOWN, benign, byte-round-tripping divergence from Ruby's
// five-style ADMONITION_STYLES; narrowing it is out of scope here.
const UPPERCASE_WORD = /^[A-Z]+$/v;

/**
 * The admonition variant a held style selects on a compound
 * delimiter, or undefined.
 * @param style - the held first positional attribute
 * @returns the lowercase variant, or undefined
 */
function admonitionVariant(style: string): string | undefined {
  const upper = style.toUpperCase();
  return UPPERCASE_WORD.test(upper) ? upper.toLowerCase() : undefined;
}

/** What resolveDelimitedOpen decides: the content model and payload. */
type DelimitedOpen =
  | {
      /** Open model: an interior parsed as blocks. */
      readonly model: "compound";
      /** Which parent block the delimiter opened. */
      readonly variant: ParentBlockNode["variant"];
      /** Set when an admonition style renames the block at open. */
      readonly admonition?: string;
    }
  | {
      /** Open model: an interior kept verbatim. */
      readonly model: "verbatim";
      /** What the extent will build once it is collected. */
      readonly role: VerbatimRole;
    }
  | {
      /** Open model: an interior cut into cells and rows. */
      readonly model: "table";
      /** The format the delimiter's hint character contributed. */
      readonly hint: TableFormat;
    };

/**
 * What a delimiter line opens once the held style has spoken —
 * behavior is parser.rb:536-555, pinned by the block-masquerade
 * tests. TOTAL over (kind x style): a style that matches no
 * masquerade for the kind resolves to the delimiter's own model,
 * which is Ruby's unknown-style downgrade (parser.rb:548-549) —
 * modulo the uppercase-word admonition rule above, which claims any
 * single alphabetic word first (tables are outside both: they cut
 * cells whatever the style says, and a tilde-spelled open ignores
 * style entirely: see the `kind === "openBlockTilde"` guard below).
 * @param kind - which delimiter opened
 * @param style - the held style, if the (c) guard released one
 * @returns what the opened block will build
 */
export function resolveDelimitedOpen(
  kind: DelimiterKind,
  style: string | undefined,
): DelimitedOpen {
  const model = DELIMITER_MODELS[kind];
  if ("role" in model) {
    return { model: "verbatim", role: model.role };
  }
  // A table's model never consults the held style: no style
  // masquerades a table into anything else, and the style entry it
  // does read (a `%header` shorthand) is an attribute VALUE, read
  // where the whole interior is (lines/table-open.ts).
  if ("cuts" in model) {
    return { model: "table", hint: model.cuts };
  }
  const { compound } = model;
  // A tilde run's masquerade set is `{abstract, partintro}` to the
  // oracle (`DELIMITED_BLOCKS['~~~~']`, index.cjs l.1108), narrower
  // than the two-hyphen open's, and neither target is a variant this
  // parser models (partintro is `oracle:book-partintro` territory;
  // abstract has none at all): MEASURED, every style tried against a
  // tilde open, matched member included, still returns `context:
  // "open"` to the oracle (`getContext()`, probed against 4.0.11).
  // So every style on a tilde open reverts to the bare compound
  // exactly as an unrecognized one would, decided HERE and ahead of
  // the masquerade and admonition tables below: those are keyed by
  // the CONTENT variant ("open"), which cannot see which delimiter
  // spelling asked, so letting them run would masquerade or rename a
  // block the printer could only ever spell back as `--`
  // (ParentBlockNode.openDelimiter, src/ast.ts), silently changing
  // the author's bytes. The style still prints: its attribute list is
  // a sibling node the reader flushes unconditionally, so the run
  // through here changes only what this block models, not what a
  // re-render of the formatted output sees.
  if (kind === "openBlockTilde") {
    return { model: "compound", variant: compound };
  }
  if (style !== undefined) {
    const masquerade = VERBATIM_MASQUERADES.get(compound)?.get(style);
    if (masquerade !== undefined) {
      return {
        model: "verbatim",
        role: {
          builds: "masqueradedBlock",
          variant: masquerade,
          sourceDelimiter: compound,
        },
      };
    }
    const admonition = admonitionVariant(style);
    if (admonition !== undefined) {
      return { model: "compound", variant: compound, admonition };
    }
  }
  return { model: "compound", variant: compound };
}

// Recognized paragraph-form styles -> the variant they produce
// (`source` and `listing` both map to "listing").
//
// The four rows VERBATIM_STYLES also carries are NOT shadowed by it.
// `verbatimStyledOpen` (lines/reader.ts) leaves a SECTION TITLE
// before it reads the held style at all, and a section title inside
// a confinement falls through to `paragraph()`, which resolves the
// style here: `====` / `[source]` / `== Title` / `====` builds a
// verbatim listing, and dropping the rows reflows its content.
const PARAGRAPH_FORM_STYLES: ReadonlyMap<string, VerbatimVariant> = new Map([
  ["source", "listing"],
  ["listing", "listing"],
  ["literal", "literal"],
  ["pass", "pass"],
  ["verse", "verse"],
  ["quote", "quote"],
  ["example", "example"],
  ["sidebar", "sidebar"],
]);

/**
 * Today's PARAGRAPH_FORM_STYLES lookup in its one home: the
 * paragraph-form target for a style, or undefined when the style
 * converts nothing.
 * @param style - the held first positional attribute, if any
 * @returns the target variant, or undefined
 */
export function paragraphFormVariant(
  style: string | undefined,
): VerbatimVariant | undefined {
  return style === undefined ? undefined : PARAGRAPH_FORM_STYLES.get(style);
}

// Ruby's ADMONITION_STYLES (asciidoctor.rb:270), the five a style line
// over a PARAGRAPH turns into an admonition (parser.rb:730).
//
// EXACT and case-sensitive, which the delimited-block rule above
// (admonitionVariant, any uppercase word) deliberately is not. Two
// separate reasons hold it here. Ruby tests set membership on the
// style as written, so `[note]` and `[Note]` leave an ordinary
// paragraph, measured against the oracle. And the printer spells this
// form back as a `NAME: ` label, which only these five names read
// back as (ADMONITION_LABEL, line-shapes.ts): widening the set would
// print a label the re-reader takes for prose.
const ADMONITION_STYLES: ReadonlySet<string> = new Set([
  "NOTE",
  "TIP",
  "IMPORTANT",
  "WARNING",
  "CAUTION",
]);

/**
 * The admonition a bracket line names when it names one of Ruby's
 * five admonition styles and NOTHING else - `[NOTE]` and no other
 * shape.
 *
 * The argument is the interior rather than a parsed style, because
 * "and nothing else" is the whole condition: an interior that carries
 * a role, an option or a second entry cannot be spelled as a `NOTE: `
 * label, so it is not this. It is compared in the CANONICAL spelling
 * the printer would write ({@link canonicalAttrlist}), or `[NOTE] `
 * would answer no on the first pass and yes on the second, once its
 * trailing blank had been printed away.
 * @param interior - a held bracket line's interior
 * @returns the label the printer writes (`NOTE`), or undefined
 */
export function admonitionStyleLabel(interior: string): string | undefined {
  const canonical = canonicalAttrlist(interior);
  return ADMONITION_STYLES.has(canonical) ? canonical : undefined;
}

// The styles that switch a paragraph's whole extent rule — Ruby's
// VERBATIM_STYLES (asciidoctor.rb:276): source, listing, literal,
// verse. NOT pass (oracle-pinned: `[pass]\nfoo\n[NOTE]\nbar` renders
// foo raw and [NOTE] interrupts; issue #41's prose says [pass] where
// it means [verse], corrected in the close-out note).
const VERBATIM_STYLES: ReadonlyMap<string, VerbatimVariant> = new Map([
  ["source", "listing"],
  ["listing", "listing"],
  ["literal", "literal"],
  ["verse", "verse"],
]);

/**
 * The verbatim-styled paragraph's target variant, or undefined when
 * the style is not one of VERBATIM_STYLES (asciidoctor.rb:276) — the
 * four styles that switch a paragraph's whole extent rule
 * (parser.rb:561-567).
 * @param style - the held first positional attribute, if any
 * @returns the target variant, or undefined
 */
export function verbatimStyledVariant(
  style: string | undefined,
): VerbatimVariant | undefined {
  return style === undefined ? undefined : VERBATIM_STYLES.get(style);
}

// A fenced opener is three backticks then the optional language hint.
const BACKTICK_COUNT = 3;

/**
 * Complete a fence's role with the language hint parsed from its
 * opening line — {@link resolveDelimitedOpen} is pure over
 * (kind x style) and cannot see the line (`is_delimited_block?`
 * rewrites a fence line to its tip and keeps the rest as the hint,
 * parser.rb:992-1002), so the completion lives beside it rather than
 * in the reader that happens to hold the line.
 *
 * The role alone says which delimiter opened: `builds: "fencedBlock"`
 * is DELIMITER_MODELS' `fencedCode` row and nothing else writes it,
 * so asking the kind a second time asked one fact twice.
 * @param role - the resolved role
 * @param text - the opening line, rstripped
 * @returns the role, with `language` set for a hinted fence
 */
export function withFenceLanguage(
  role: VerbatimRole,
  text: string,
): VerbatimRole {
  if (role.builds !== "fencedBlock") {
    return role;
  }
  const language = text.slice(BACKTICK_COUNT).trim();
  return language.length === 0 ? role : { ...role, language };
}

/**
 * Whether a `NAME: ` label written where a paragraph is opening would
 * still OPEN a block, rather than being read as more of what stands
 * above it.
 *
 * A `[NAME]` bracket line opens a block from any position - it is a
 * SHARED_INTERRUPTER (line-shapes.ts) - and an admonition label is
 * not, so the two spell one admonition only where both start a block.
 * Two positions where the label does not, each MEASURED against the
 * oracle (tests/format/admonition.test.ts):
 *
 * - `listItem`: the paragraph opens directly under an item's own
 *   principal text with no continuation between, so a label line
 *   there is more of that text and the admonition is gone;
 * - directly after a description item that spent NO description,
 *   which takes whatever is written under it next - across a blank
 *   line - as that description. A bracket line is refused there
 *   because the item's own scan refuses an interrupter; a label line
 *   is not refused, and the item swallows it.
 *
 * A function of the two facts the reader already holds, so the reader
 * derives nothing of its own: the context it was handed, and the
 * block it last pushed.
 * @param context - which paragraph is opening
 * @param previous - the block pushed before it, if any
 * @returns whether a label line here opens a block
 */
export function admonitionLabelOpensABlock(
  context: ParagraphContext,
  previous: BlockNode | undefined,
): boolean {
  if (context === "listItem") {
    return false;
  }
  return (
    previous?.type !== "descriptionList" ||
    !previous.children
      .slice(-1)
      .some((item) => item.text.length + item.blocks.length === 0)
  );
}
