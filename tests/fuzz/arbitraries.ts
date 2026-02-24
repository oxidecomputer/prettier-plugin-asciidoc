/* eslint-disable require-unicode-regexp -- fc.stringMatching does not support the v flag */

/**
 * fast-check arbitraries for AsciiDoc parser fuzzing.
 *
 * Two tiers of input generation:
 * - Tier 1: random Unicode strings (baseline crash testing)
 * - Tier 2: AsciiDoc "line soup" — random lines drawn from a
 *   vocabulary covering every token type in src/parse/tokens.ts
 *
 * See docs/plans/2026-02-22-parser-fuzzing-design.md for rationale.
 */
import fc from "fast-check";

/**
 * Tier 1: purely random Unicode input. Catches crashes on
 * null bytes, emoji, BOM, control characters, multi-byte
 * sequences — anything the lexer doesn't expect at all.
 */
export const randomInput = fc.string({
  unit: "grapheme-composite",
  maxLength: 10_000,
});

/**
 * Tier 2: AsciiDoc-flavored line soup. Each line is drawn
 * from a vocabulary that covers every token type defined in
 * src/parse/tokens.ts. Lines are shuffled randomly with no
 * nesting awareness — the point is to produce unexpected
 * token sequences that stress recovery paths.
 */
const adocLine = fc.oneof(
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

  // IncludeDirective: `include::path[opts]`
  fc
    .tuple(
      fc.stringMatching(/[A-Za-z][\w/.-]{0,20}/),
      fc.string({ maxLength: 15 }),
    )
    .map(([path, opts]) => `include::${path}[${opts}]`),

  // BlockMacro: `name::target[attrlist]`
  fc
    .tuple(
      fc.constantFrom("image", "video", "audio", "toc", "plantuml"),
      fc.stringMatching(/[A-Za-z][\w/.-]{0,20}/),
      fc.string({ maxLength: 15 }),
    )
    .map(([name, target, attrs]) => `${name}::${target}[${attrs}]`),

  // ConditionalDirective: `ifdef::name[]`, `endif::[]`
  fc.oneof(
    fc
      .tuple(
        fc.constantFrom("ifdef", "ifndef", "ifeval"),
        fc.stringMatching(/[A-Za-z_][\w-]{0,9}/),
      )
      .map(([dir, name]) => `${dir}::${name}[]`),
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
    .map((s) => `some *${s.trim() || "x"}* text`),
  fc
    .string({ minLength: 1, maxLength: 20 })
    .map((s) => `some **${s.trim() || "x"}** text`),

  // ItalicMark: `_word_` or `__word__`
  fc
    .string({ minLength: 1, maxLength: 20 })
    .map((s) => `some _${s.trim() || "x"}_ text`),
  fc
    .string({ minLength: 1, maxLength: 20 })
    .map((s) => `some __${s.trim() || "x"}__ text`),

  // MonoMark: `` `word` `` or ``` ``word`` ```
  fc
    .string({ minLength: 1, maxLength: 20 })
    .map((s) => `some \`${s.trim() || "x"}\` text`),
  fc
    .string({ minLength: 1, maxLength: 20 })
    .map((s) => `some \`\`${s.trim() || "x"}\`\` text`),

  // HighlightMark: `#word#` or `##word##`
  fc
    .string({ minLength: 1, maxLength: 20 })
    .map((s) => `some #${s.trim() || "x"}# text`),
  fc
    .string({ minLength: 1, maxLength: 20 })
    .map((s) => `some ##${s.trim() || "x"}## text`),

  // AttributeReference: `{name}`
  fc
    .stringMatching(/[A-Za-z_][\w.-]{0,14}/)
    .map((s) => `text {${s}} here`),

  // BackslashEscape: `\*`, `\_`, `` \` ``, `\#`
  fc.constantFrom("a \\* b", "a \\_ b", "a \\` b", "a \\# b"),

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

  // LinkMacro: `link:url[text]`
  fc
    .tuple(
      fc.stringMatching(/[a-z][\w/.-]{0,15}/),
      fc.string({ maxLength: 15 }),
    )
    .map(([url, text]) => `click link:${url}[${text}]`),

  // MailtoLink: `mailto:addr[text]`
  fc
    .tuple(
      fc.stringMatching(/[a-z][\w.-]{0,15}/),
      fc.string({ maxLength: 15 }),
    )
    .map(([addr, text]) => `email mailto:${addr}@example.com[${text}]`),

  // XrefMacro: `xref:target[text]`
  fc
    .tuple(
      fc.stringMatching(/[a-z][\w-]{0,15}/),
      fc.string({ maxLength: 15 }),
    )
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
    .map(([role, text]) => `[.${role}]#${text.trim() || "x"}#`),

  // IndentedLine: leading spaces + content
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
);

/**
 * Tier 2 document: random lines from the AsciiDoc token
 * vocabulary, assembled into a single string.
 */
export const adocDocument = fc
  .array(adocLine, { minLength: 1, maxLength: 50 })
  .map((lines) => lines.join("\n"));
