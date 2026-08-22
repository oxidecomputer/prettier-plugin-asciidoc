/* eslint-disable require-unicode-regexp -- fc.stringMatching does not support the v flag */

/**
 * fast-check arbitraries for AsciiDoc parser fuzzing.
 *
 * Two tiers of input generation:
 * - Tier 1: random Unicode strings (baseline crash testing)
 * - Tier 2: AsciiDoc "line soup" — random lines drawn from a fixed
 *   vocabulary of AsciiDoc-shaped lines. The vocabulary samples the
 *   inline kinds of src/parse/inline/tokens.ts and the line kinds of
 *   src/parse/lines/classify.ts; it does not enumerate either, and the
 *   coverage across the LineKinds is uneven by construction.
 */
import fc from "fast-check";
import type { Arbitrary } from "fast-check";

// Trim whitespace, falling back to "x" if the result is empty.
// Extracted to satisfy strict-boolean-expressions (no truthy
// checks on strings).
const trimOrFallback = (s: string): string => {
  const trimmed = s.trim();
  return trimmed === "" ? "x" : trimmed;
};

/**
 * Tier 1: purely random Unicode input. Catches crashes on
 * null bytes, emoji, BOM, control characters, multi-byte
 * sequences — anything the classifier and the tokenizer have no
 * rule for.
 */
export const randomInput = fc.string({
  unit: "grapheme-composite",
  maxLength: 10_000,
});

// ── Tier 2: AsciiDoc-flavored line soup ─────────────────────
// Each line is drawn from a vocabulary of AsciiDoc-shaped lines
// sampling the inline kinds of src/parse/inline/tokens.ts. Lines are
// shuffled randomly with no nesting awareness — the point is to feed
// the reader line sequences no real document would produce, and check
// that it still returns a total, well-formed AST.
//
// Split into two arrays so callers can opt out of include
// directives (which can't be resolved in synthetic input and
// cause Asciidoctor to produce different HTML from the
// formatter's block-level treatment).

// Lines that every fuzz arbitrary should include.
const commonLines: Array<Arbitrary<string>> = [
  // DocumentTitle: `= Title`
  fc.string({ minLength: 1, maxLength: 40 }).map((s) => `= ${s}`),

  // SectionMarker: `={2,6} Title`
  fc.integer({ min: 2, max: 6 }).map((n) => `${"=".repeat(n)} Title`),

  // Leaf block open delimiters (push into verbatim modes)
  fc.integer({ min: 4, max: 8 }).map((n) => "-".repeat(n)),
  fc.integer({ min: 4, max: 8 }).map((n) => ".".repeat(n)),
  fc.integer({ min: 4, max: 8 }).map((n) => "+".repeat(n)),

  // Parent block delimiters (stay in default mode)
  fc.integer({ min: 4, max: 8 }).map((n) => "=".repeat(n)),
  fc.integer({ min: 4, max: 8 }).map((n) => "*".repeat(n)),
  fc.integer({ min: 4, max: 8 }).map((n) => "_".repeat(n)),
  fc.constant("--"),

  // Block comment delimiter (pushes into block_comment mode)
  fc.integer({ min: 4, max: 8 }).map((n) => "/".repeat(n)),

  // LineComment
  fc.string({ maxLength: 40 }).map((s) => `// ${s}`),

  // ThematicBreak / PageBreak
  fc.constantFrom("'''", "<<<"),

  // AttributeEntry: `:name: value`
  fc
    .tuple(
      fc.stringMatching(/[A-Za-z_][\w-]{0,9}/),
      fc.string({ maxLength: 20 }),
    )
    .map(([name, value]) => `:${name}: ${value}`),

  // Anchor shorthand: `[[id]]` (parsed as inline anchor)
  fc.stringMatching(/[A-Za-z_][\w-]{0,14}/).map((s) => `[[${s}]]`),

  // BlockAttributeList: `[source,ruby]`, `[#myid]`, `[.role]`
  fc.string({ maxLength: 20 }).map((s) => `[${s}]`),

  // BlockTitle: `.TitleText` (dot + non-space non-dot)
  fc
    .string({ minLength: 1, maxLength: 30 })
    .map((s) => `.${s.replace(/^[. ]/v, "T")}`),

  // AdmonitionMarker
  fc.constantFrom(
    "NOTE: text",
    "TIP: text",
    "IMPORTANT: text",
    "CAUTION: text",
    "WARNING: text",
  ),

  // UnorderedListMarker: `*{1,5} item` or `- item`
  fc.oneof(
    fc.integer({ min: 1, max: 5 }).map((n) => `${"*".repeat(n)} item`),
    fc.constant("- item"),
  ),

  // OrderedListMarker: `.{1,5} item`
  fc.integer({ min: 1, max: 5 }).map((n) => `${".".repeat(n)} item`),

  // CalloutListMarker: `<N> item` or `<.> item`
  fc.oneof(
    fc.integer({ min: 1, max: 99 }).map((n) => `<${String(n)}> item`),
    fc.constant("<.> item"),
  ),

  // BlockMacro: `name::target[attrlist]`
  fc
    .tuple(
      fc.constantFrom("image", "video", "audio", "toc", "plantuml"),
      fc.stringMatching(/[A-Za-z][\w/.-]{0,20}/),
      fc.string({ maxLength: 15 }),
    )
    .map(([name, target, attributes]) => `${name}::${target}[${attributes}]`),

  // Conditional preprocessor line: `ifdef::name[]`, `endif::[]`
  fc.oneof(
    fc
      .tuple(
        fc.constantFrom("ifdef", "ifndef", "ifeval"),
        fc.stringMatching(/[A-Za-z_][\w-]{0,9}/),
      )
      .map(([directive, name]) => `${directive}::${name}[]`),
    fc.constant("endif::[]"),
  ),

  // FencedCodeOpen: ``` or ```lang
  fc.oneof(
    fc.constant("```"),
    fc
      .constantFrom("rust", "ruby", "python", "java", "js", "ts")
      .map((lang) => `\`\`\`${lang}`),
  ),

  // ── Inline formatting embedded in paragraph text ──────────
  // BoldMark: `*word*` or `**word**`
  fc
    .string({ minLength: 1, maxLength: 20 })
    .map((s) => `some *${trimOrFallback(s)}* text`),
  fc
    .string({ minLength: 1, maxLength: 20 })
    .map((s) => `some **${trimOrFallback(s)}** text`),

  // ItalicMark: `_word_` or `__word__`
  fc
    .string({ minLength: 1, maxLength: 20 })
    .map((s) => `some _${trimOrFallback(s)}_ text`),
  fc
    .string({ minLength: 1, maxLength: 20 })
    .map((s) => `some __${trimOrFallback(s)}__ text`),

  // MonoMark: `` `word` `` or ``` ``word`` ```
  fc
    .string({ minLength: 1, maxLength: 20 })
    .map((s) => `some \`${trimOrFallback(s)}\` text`),
  fc
    .string({ minLength: 1, maxLength: 20 })
    .map((s) => `some \`\`${trimOrFallback(s)}\`\` text`),

  // HighlightMark: `#word#` or `##word##`
  fc
    .string({ minLength: 1, maxLength: 20 })
    .map((s) => `some #${trimOrFallback(s)}# text`),
  fc
    .string({ minLength: 1, maxLength: 20 })
    .map((s) => `some ##${trimOrFallback(s)}## text`),

  // AttributeReference: `{name}`
  fc.stringMatching(/[A-Za-z_][\w.-]{0,14}/).map((s) => `text {${s}} here`),

  // BackslashEscape: `\*`, `\_`, `` \` ``, `\#`
  fc.constantFrom(
    String.raw`a \* b`,
    String.raw`a \_ b`,
    "a \\` b",
    String.raw`a \# b`,
  ),

  // InlineUrl: `https://example.com` or `https://example.com[text]`
  fc.oneof(
    fc
      .stringMatching(/[a-z][\w.-]{0,15}/)
      .map((s) => `see https://${s}.example.com for info`),
    fc
      .tuple(
        fc.stringMatching(/[a-z][\w.-]{0,15}/),
        fc.string({ maxLength: 15 }),
      )
      .map(([s, text]) => `see https://${s}.example.com[${text}] here`),
  ),

  // InlineMacro: `name:target[attrlist]` (link, mailto, xref variants)
  fc
    .tuple(
      fc.stringMatching(/[a-z][\w/.-]{0,15}/),
      fc.string({ maxLength: 15 }),
    )
    .map(([url, text]) => `click link:${url}[${text}]`),

  fc
    .tuple(fc.stringMatching(/[a-z][\w.-]{0,15}/), fc.string({ maxLength: 15 }))
    .map(([addr, text]) => `email mailto:${addr}@example.com[${text}]`),

  fc
    .tuple(fc.stringMatching(/[a-z][\w-]{0,15}/), fc.string({ maxLength: 15 }))
    .map(([target, text]) => `see xref:${target}[${text}]`),

  // XrefShorthand: `<<target>>` or `<<target,text>>`
  fc.oneof(
    fc.stringMatching(/[a-z][\w-]{0,15}/).map((s) => `see <<${s}>>`),
    fc
      .tuple(
        fc.stringMatching(/[a-z][\w-]{0,15}/),
        fc.string({ minLength: 1, maxLength: 15 }),
      )
      .map(([target, text]) => `see <<${target},${text}>>`),
  ),

  // RoleAttribute + HighlightMark: `[.role]#text#`
  fc
    .tuple(
      fc.stringMatching(/[a-z][\w-]{0,9}/),
      fc.string({ minLength: 1, maxLength: 15 }),
    )
    .map(([role, text]) => `[.${role}]#${trimOrFallback(text)}#`),

  // An indented line: leading spaces + content
  fc
    .tuple(
      fc.integer({ min: 1, max: 8 }),
      fc.string({ minLength: 1, maxLength: 40 }),
    )
    .map(([spaces, text]) => `${" ".repeat(spaces)}${text.trimStart()}`),

  // Blank line
  fc.constant(""),

  // Random text (garbage / paragraph content)
  fc.string({ unit: "grapheme-composite", maxLength: 100 }),
];

// Include directives can't be resolved in synthetic fuzz input
// (the referenced files don't exist). When an include fails,
// Asciidoctor inlines the error as paragraph text, while the
// formatter preserves the directive as a separate block element.
// Both are correct — the mismatch is an artifact of testing
// without real include targets. The semantic preservation test
// uses adocDocumentNoIncludes to avoid this false failure.
const includeLines: Array<Arbitrary<string>> = [
  // Include preprocessor line: `include::path[opts]`
  fc
    .tuple(
      fc.stringMatching(/[A-Za-z][\w/.-]{0,20}/),
      fc.string({ maxLength: 15 }),
    )
    .map(([path, options]) => `include::${path}[${options}]`),
];

// Full vocabulary including includes (crash/idempotency tests).
const adocLine = fc.oneof(...commonLines, ...includeLines);

// Vocabulary without includes (semantic preservation tests).
const adocLineNoIncludes = fc.oneof(...commonLines);

/**
 * Tier 2 document: random lines from the full AsciiDoc token
 * vocabulary, assembled into a single string.
 */
export const adocDocument = fc
  .array(adocLine, { minLength: 1, maxLength: 50 })
  .map((lines) => lines.join("\n"));

/**
 * Tier 2 document without include directives. Used by the
 * semantic preservation test where Asciidoctor's error recovery
 * for missing includes would produce false failures.
 */
export const adocDocumentNoIncludes = fc
  .array(adocLineNoIncludes, { minLength: 1, maxLength: 50 })
  .map((lines) => lines.join("\n"));

// ── Tier 3: BlockReader line soup ───────────────────────────
// The vocabulary the BlockReader's own state machine branches
// on, at the density that makes the branches collide: list
// markers of every style, continuation markers, blank lines,
// block metadata, indented lines and delimiters. Tier 2 covers
// each of these too, but spread across so many other shapes
// that the list reader's `+` / blank-line / metadata
// interactions almost never line up in one document.
//
// This one found two real ordering bugs while the list reader
// was being written (a held metadata run released after the
// token that followed it), so it earns its place next to the
// tier-2 soup rather than replacing it.
const readerLine = fc.constantFrom(
  "* a",
  "** b",
  "  ** b",
  "- c",
  ". d",
  ".. e",
  "<1> f",
  "<.> g",
  "*\tt",
  "+",
  "+ ",
  "",
  "  lit",
  "flush",
  "----",
  "====",
  "--",
  "////",
  "```",
  "[source]",
  "[[x]]",
  ".T",
  ":a: b",
  "term:: def",
  "NOTE: x",
  "== H",
  "// c",
  "ifdef::x[]",
  "endif::[]",
  "image::a[]",
  "'''",
  "<<<",
);

/**
 * Tier 3 document: dense BlockReader line soup, always OPENING
 * with a list marker so that the list reader — the half of the
 * reader with the state machine in it — is live for every
 * generated line. Short by design: the interesting collisions
 * need three or four lines, and short cases shrink to readable
 * counterexamples.
 */
export const readerDocument = fc
  .tuple(
    fc.constantFrom("* a", "** a", ". a", "- a", "<1> a"),
    fc.array(readerLine, { minLength: 1, maxLength: 10 }),
  )
  .map(([marker, lines]) => [marker, ...lines].join("\n"));
