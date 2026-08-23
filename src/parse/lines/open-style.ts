/**
 * What a held style does at a block's OPENING line — the style tables
 * that lived in paragraph-form.ts, in their one home (spec D4).
 * Behavior is Ruby's next_block style handling (parser.rb:527-549 for
 * delimited blocks, :716-722 for paragraph-form styles), pinned by
 * tests/{parser,format}/block-masquerade.test.ts and the D4 suites;
 * the STRUCTURE — resolving at the reader's dispatch point instead of
 * unshifting the line back through build_block — is a declared
 * departure (owner directive 3).
 */
import type { DelimitedBlockNode, ParentBlockNode } from "../../ast.js";
import type { DelimiterKind } from "../line-shapes.js";
import type { VerbatimRole } from "./frames.js";

// The model a BARE delimiter opens, before any held style speaks —
// one row per DELIMITER_KINDS entry, totality compiler-checked by the
// Record key. Compound rows are `DELIMITED_BLOCKS`' block content
// model; everything else keeps its bytes (a comment block builds a
// CommentNode, a table an opaque table extent — spec D1).
const DELIMITER_MODELS: Record<
  DelimiterKind,
  | { readonly compound: ParentBlockNode["variant"] }
  | { readonly role: VerbatimRole }
> = {
  listing: { role: { builds: "delimitedBlock", variant: "listing" } },
  literal: { role: { builds: "delimitedBlock", variant: "literal" } },
  pass: { role: { builds: "delimitedBlock", variant: "pass" } },
  example: { compound: "example" },
  sidebar: { compound: "sidebar" },
  quote: { compound: "quote" },
  commentBlock: { role: { builds: "comment" } },
  openBlock: { compound: "open" },
  // Fences imply the `source` style even without a language hint; the
  // reader completes the role with the hint parsed from the line.
  fencedCode: {
    role: { builds: "delimitedBlock", variant: "listing", fenced: true },
  },
  tablePipe: { role: { builds: "table" } },
  tableComma: { role: { builds: "table" } },
  tableColon: { role: { builds: "table" } },
  tableBang: { role: { builds: "table" } },
};

// Styles that masquerade a parent block's content model to verbatim,
// keyed parent variant -> style -> target variant (coverage unchanged;
// widening toward Ruby's full masq sets, asciidoctor.rb:279-293, is
// out of scope). Pass-block masquerades ([stem] on ++++) are
// deliberately absent: they do not change the content model.
const VERBATIM_MASQUERADES: ReadonlyMap<
  ParentBlockNode["variant"],
  ReadonlyMap<string, DelimitedBlockNode["variant"]>
> = new Map([
  [
    "quote",
    new Map<string, DelimitedBlockNode["variant"]>([
      ["verse", "verse"],
      ["stem", "pass"],
      ["latexmath", "pass"],
      ["asciimath", "pass"],
    ]),
  ],
  [
    "open",
    new Map<string, DelimitedBlockNode["variant"]>([
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
// five-style ADMONITION_STYLES, recorded in the spec's §5; narrowing
// it is out of α's scope.
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
export type DelimitedOpen =
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
    };

/**
 * What a delimiter line opens once the held style has spoken —
 * behavior is parser.rb:530-549, pinned by the block-masquerade
 * tests. TOTAL over (kind x style): a style that matches no
 * masquerade for the kind resolves to the delimiter's own model,
 * which is Ruby's unknown-style downgrade (parser.rb:542-543) —
 * modulo the uppercase-word admonition rule above, which claims any
 * single alphabetic word first (today's tables, verbatim).
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
  const { compound } = model;
  if (style !== undefined) {
    const masquerade = VERBATIM_MASQUERADES.get(compound)?.get(style);
    if (masquerade !== undefined) {
      return {
        model: "verbatim",
        role: {
          builds: "delimitedBlock",
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
const PARAGRAPH_FORM_STYLES: ReadonlyMap<
  string,
  DelimitedBlockNode["variant"]
> = new Map([
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
): DelimitedBlockNode["variant"] | undefined {
  return style === undefined ? undefined : PARAGRAPH_FORM_STYLES.get(style);
}

// The styles that switch a paragraph's whole extent rule — Ruby's
// VERBATIM_STYLES (asciidoctor.rb:277): source, listing, literal,
// verse. NOT pass (oracle-pinned: `[pass]\nfoo\n[NOTE]\nbar` renders
// foo raw and [NOTE] interrupts; issue #41's prose says [pass] where
// it means [verse], corrected in the close-out note).
const VERBATIM_STYLES: ReadonlyMap<string, DelimitedBlockNode["variant"]> =
  new Map([
    ["source", "listing"],
    ["listing", "listing"],
    ["literal", "literal"],
    ["verse", "verse"],
  ]);

/**
 * The verbatim-styled paragraph's target variant, or undefined when
 * the style is not one of VERBATIM_STYLES (asciidoctor.rb:277) — the
 * four styles that switch a paragraph's whole extent rule
 * (parser.rb:555-560).
 * @param style - the held first positional attribute, if any
 * @returns the target variant, or undefined
 */
export function verbatimStyledVariant(
  style: string | undefined,
): DelimitedBlockNode["variant"] | undefined {
  return style === undefined ? undefined : VERBATIM_STYLES.get(style);
}
