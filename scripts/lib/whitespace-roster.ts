/**
 * The template roster of the whitespace battery: the synthetic
 * documents whose whitespace positions the battery perturbs.
 *
 * A TEMPLATE is a list of segments where {@link SLOT} marks a
 * whitespace position and fixed text may itself carry a newline,
 * for a construct that needs a line boundary at a fixed place. The
 * battery holds every other slot at one space and gives the target
 * slot each member of the alphabet, so one case differs from its
 * siblings in exactly one run.
 *
 * The roster is the judgement in the measurement. Which constructs
 * appear, and which slot roles each one gets (before, inside where
 * whitespace is legal, after), is chosen; everything downstream of
 * it is derived by rendering. So the roster is written out in full,
 * rather than generated from the parser's own tables, for two
 * reasons: a battery generated from what the reader already believes
 * cannot find a construct the reader does not know about, and a
 * roster a person can read is a roster a person can say is missing
 * something.
 */

/** The marker for a whitespace position inside a template. */
export const SLOT = Symbol("whitespace slot");

/** Fixed text, or a whitespace position the battery perturbs. */
type Segment = string | typeof SLOT;

/**
 * The construct family a template belongs to. Families group the
 * report and nothing else; a template's class is measured, never
 * inherited from its family.
 */
type Family =
  | "attrref"
  | "block"
  | "emdash"
  | "hardbreak"
  | "intrinsic"
  | "link"
  | "macro"
  | "mark"
  | "passthrough"
  | "plain"
  | "replacement"
  | "setref"
  | "shelter"
  | "xref";

/** One synthetic document with at least one whitespace position. */
export interface Template {
  /** Stable id; the first field of every case id built from it. */
  readonly name: string;
  /** The reporting group. */
  readonly family: Family;
  /** Fixed text and slots, in document order. */
  readonly segments: readonly Segment[];
  /** Header lines the body needs, empty when it needs none. */
  readonly header: string;
  /**
   * Attributes supplied from outside the document, empty for all but
   * the one template that measures that route. The harness lens takes
   * source text only, so a template with external attributes is
   * rendered by the reference alone and reports no comparison.
   */
  readonly attributes: Readonly<Record<string, string>>;
  /** Why the template is shaped the way it is, where that is not obvious. */
  readonly note: string;
}

/**
 * Builds a roster row, so the roster below reads as data.
 * @param name - the template's stable id
 * @param family - its reporting group
 * @param segments - fixed text and slots in document order
 * @param extra - header lines, external attributes, or a note
 * @returns the template
 */
function template(
  name: string,
  family: Family,
  segments: readonly Segment[],
  extra: Partial<Pick<Template, "header" | "attributes" | "note">> = {},
): Template {
  return {
    name,
    family,
    segments,
    header: extra.header ?? "",
    attributes: extra.attributes ?? {},
    note: extra.note ?? "",
  };
}

/** Attribute values that reach the same reference through the header. */
const ATTRIBUTE_VALUES: ReadonlyArray<readonly [string, string]> = [
  ["dashdash", "--"],
  ["xx", "xx"],
  ["xplus", "x+"],
  ["plus", "+"],
  ["dash", "-"],
  ["space", "a b"],
];

/** The replacement rows other than the em dash, by their spelling. */
const REPLACEMENT_SPELLINGS: ReadonlyArray<readonly [string, string]> = [
  ["copyright", "(C)"],
  ["registered", "(R)"],
  ["trademark", "(TM)"],
  ["ellipsis", "..."],
  ["rarr", "->"],
  ["rArr", "=>"],
  ["larr", "<-"],
  ["lArr", "<="],
  ["apostrophe", "it's"],
];

/** Every template the battery renders, in report order. */
export const TEMPLATES: readonly Template[] = [
  // Plain prose is the control: a run between two words with no
  // construct near it should be free in every dimension, and a
  // battery whose control is bound is measuring the wrong thing.
  template("plain-words", "plain", ["aa", SLOT, "bb"]),
  template("plain-sentence", "plain", ["aa bb", SLOT, "cc dd"]),

  // The em-dash row is the one REPLACEMENTS entry whose pattern reads
  // a flanking whitespace character, so it gets every neighbourhood:
  // both line edges, an escape, a word it is glued to, and the pair
  // shape where one run stands between two dashes.
  template("emdash", "emdash", ["aa", SLOT, "--", SLOT, "bb"]),
  template("emdash-escaped", "emdash", [
    "aa",
    SLOT,
    String.raw`\--`,
    SLOT,
    "bb",
  ]),
  template("emdash-linestart", "emdash", ["zz\n--", SLOT, "bb"], {
    note: "the dashes open line 2",
  }),
  template("emdash-lineend", "emdash", ["aa", SLOT, "--\nbb"], {
    note: "the dashes close line 1",
  }),
  template("emdash-pair", "emdash", ["ww", SLOT, "--", SLOT, "--", SLOT, "yy"]),
  template("emdash-word-glued", "emdash", ["aa", SLOT, "x--y", SLOT, "bb"], {
    note: "unconstrained: no whitespace beside the dashes",
  }),

  // One template per attribute VALUE, because what the reference does
  // with the run beside a reference depends on what the reference
  // expands to, not on the reference itself.
  ...ATTRIBUTE_VALUES.map(([tag, value]) =>
    template(`attr-${tag}`, "attrref", ["aa", SLOT, "{d}", SLOT, "bb"], {
      header: `:d: ${value}`,
    }),
  ),
  template("attr-unset", "attrref", ["aa", SLOT, "{d}", SLOT, "bb"], {
    note: "attribute-missing defaults to skip",
  }),
  template("attr-external", "attrref", ["aa", SLOT, "{d}", SLOT, "bb"], {
    attributes: { d: "--" },
    note: "the value arrives from outside the document; reference only",
  }),
  template(
    "attr-pair",
    "attrref",
    ["ww", SLOT, "{d}", SLOT, "{d}", SLOT, "yy"],
    { header: ":d: --" },
  ),
  template("attr-space-plus", "attrref", ["aa", SLOT, "{d}\nbb"], {
    header: ":d: a +",
    note: "the value ends in the legacy line continuation",
  }),
  template("attr-plus-alone", "attrref", ["aa", SLOT, "{d}\nbb"], {
    header: ":d: +",
  }),
  template(
    "attr-missing-dropline",
    "attrref",
    ["aaaa", SLOT, "{nope}", SLOT, "bbbb"],
    { header: ":attribute-missing: drop-line" },
  ),
  template(
    "attr-missing-warn",
    "attrref",
    ["aaaa", SLOT, "{nope}", SLOT, "bbbb"],
    { header: ":attribute-missing: warn" },
  ),
  // A hyphen fused to a reference: the em-dash row's pattern reads
  // the character on each side of the dashes, and a dash pair that
  // arrives half from the source and half from an attribute value is
  // still a dash pair by the time the replacement pass runs.
  template("attr-hyphen-fused", "attrref", ["aa", SLOT, "-{d}", SLOT, "bb"], {
    header: ":d: -",
    note: "one hyphen in the source, one in the value",
  }),
  template(
    "attr-hyphen-fused-dashdash",
    "attrref",
    ["aa", SLOT, "-{d}", SLOT, "bb"],
    { header: ":d: --", note: "three hyphens once the value expands" },
  ),
  template(
    "attr-hyphen-fused-right",
    "attrref",
    ["aa", SLOT, "{d}-", SLOT, "bb"],
    { header: ":d: -", note: "the fused hyphen on the other side" },
  ),

  // The directive references, which have effects the run can move.
  template("set-unset", "setref", ["aaaa", SLOT, "{set:x!}", SLOT, "bbbb"]),
  template("set-value", "setref", ["aaaa", SLOT, "{set:x:v}", SLOT, "bbbb"]),
  template("counter", "setref", ["aaaa", SLOT, "{counter:c}", SLOT, "bbbb"]),
  template("counter2", "setref", ["aaaa", SLOT, "{counter2:c}", SLOT, "bbbb"]),
  template("sp-ref", "intrinsic", ["aa", SLOT, "{sp}", SLOT, "bb"]),
  template("nbsp-ref", "intrinsic", ["aa", SLOT, "{nbsp}", SLOT, "bb"]),
  template("plus-ref", "intrinsic", ["aa", SLOT, "{plus}", SLOT, "bb"]),

  // The hard break is armed by a SPACE before a line-final plus, so
  // every way of reaching that plus gets a row: written, mid-line,
  // through {sp}, and through an attribute whose value is or ends in
  // a plus.
  template("hardbreak", "hardbreak", ["aa", SLOT, "+\nbb"]),
  template("plus-midline", "hardbreak", ["aa", SLOT, "+", SLOT, "bb"]),
  template("hardbreak-sp-ref", "hardbreak", ["aa", SLOT, "{sp}+\nbb"]),
  template("hardbreak-attr-plus", "hardbreak", ["aa", SLOT, "{p}\nbb"], {
    header: ":p: +",
  }),
  template("hardbreak-attr-xplus", "hardbreak", ["aa", SLOT, "{q}\nbb"], {
    header: ":q: x+",
  }),

  // Both forms of every mark, because the constrained form reads its
  // boundaries and the unconstrained form does not.
  template("bold", "mark", ["xx", SLOT, "*aa", SLOT, "bb*", SLOT, "yy"]),
  template("bold-unc", "mark", ["xx", SLOT, "**aa", SLOT, "bb**", SLOT, "yy"]),
  template("italic", "mark", ["xx", SLOT, "_aa", SLOT, "bb_", SLOT, "yy"]),
  template("italic-unc", "mark", [
    "xx",
    SLOT,
    "__aa",
    SLOT,
    "bb__",
    SLOT,
    "yy",
  ]),
  template("mono", "mark", ["xx", SLOT, "`aa", SLOT, "bb`", SLOT, "yy"]),
  template("mono-unc", "mark", ["xx", SLOT, "``aa", SLOT, "bb``", SLOT, "yy"]),
  template("highlight", "mark", ["xx", SLOT, "#aa", SLOT, "bb#", SLOT, "yy"]),
  template("superscript", "mark", ["xx", SLOT, "^aa", SLOT, "bb^", SLOT, "yy"]),
  template("subscript", "mark", ["xx", SLOT, "~aa", SLOT, "bb~", SLOT, "yy"]),

  // A passthrough's interior is not normalized by the reference, and
  // is invisible through the lens because it renders as bare text
  // with no wrapping element. Both facts are worth a measured row.
  template("compat-plus", "passthrough", [
    "xx",
    SLOT,
    "+aa",
    SLOT,
    "bb+",
    SLOT,
    "yy",
  ]),
  template("triple-plus", "passthrough", [
    "xx",
    SLOT,
    "+++aa",
    SLOT,
    "bb+++",
    SLOT,
    "yy",
  ]),
  template("pass-macro", "passthrough", [
    "xx",
    SLOT,
    "pass:[aa",
    SLOT,
    "bb]",
    SLOT,
    "yy",
  ]),
  template("dollar-pass", "passthrough", [
    "xx",
    SLOT,
    "$$aa",
    SLOT,
    "bb$$",
    SLOT,
    "yy",
  ]),
  template("stem", "passthrough", [
    "xx",
    SLOT,
    "stem:[aa",
    SLOT,
    "bb]",
    SLOT,
    "yy",
  ]),

  // Links, including the two boundaries a bare URL has: the run in
  // front of it decides whether the URL is a link at all.
  template("link-macro", "link", [
    "xx",
    SLOT,
    "link:https://e.com[tt]",
    SLOT,
    "yy",
  ]),
  template("link-text", "link", [
    "xx",
    SLOT,
    "link:https://e.com[aa",
    SLOT,
    "bb]",
    SLOT,
    "yy",
  ]),
  template("link-empty", "link", [
    "xx",
    SLOT,
    "link:https://e.com[]",
    SLOT,
    "yy",
  ]),
  template("bare-url", "link", ["xx", SLOT, "https://e.com", SLOT, "yy"]),
  // The left boundary of a bare URL is a character class, not a
  // whitespace rule: it holds a line start, a blank, and each of
  // `>()[];"'` (rx.rb:526, InlineLinkRx). A run in front of a URL
  // that already stands after a bracket is the position where those
  // two ways of qualifying meet.
  template("bare-url-left-boundary", "link", [
    "xx(",
    SLOT,
    "https://e.com",
    SLOT,
    "yy",
  ]),
  template("mailto", "link", ["xx", SLOT, "mailto:a@b.c[]", SLOT, "yy"]),
  template("bare-email", "link", ["xx", SLOT, "a@b.c", SLOT, "yy"]),

  // Macros, with the target and the attrlist as separate slot roles:
  // the reference normalizes an attrlist and does not normalize a
  // target, so the two roles cannot share a row.
  template("image-alt", "macro", [
    "xx",
    SLOT,
    "image:a.png[alt",
    SLOT,
    "tt]",
    SLOT,
    "yy",
  ]),
  template("image-target", "macro", [
    "xx",
    SLOT,
    "image:a",
    SLOT,
    "b.png[]",
    SLOT,
    "yy",
  ]),
  template("icon", "macro", ["xx", SLOT, "icon:x[]", SLOT, "yy"]),
  template(
    "menu-text",
    "macro",
    ["xx", SLOT, "menu:File[Save", SLOT, "As]", SLOT, "yy"],
    { header: ":experimental:" },
  ),
  template(
    "menu-target",
    "macro",
    ["xx", SLOT, "menu:File", SLOT, "Edit[Save]", SLOT, "yy"],
    { header: ":experimental:" },
  ),
  // The implicit menu form has no macro name at all: what makes it a
  // menu is a quoted string with an angle bracket inside it, and the
  // whitespace around that bracket is part of the pattern
  // (rx.rb:570, InlineMenuRx).
  template(
    "menu-implicit",
    "macro",
    ["xx", SLOT, '"File', SLOT, ">", SLOT, 'New"', SLOT, "yy"],
    { header: ":experimental:", note: "the implicit menu form" },
  ),
  template("kbd", "macro", ["xx", SLOT, "kbd:[Ctrl+A]", SLOT, "yy"], {
    header: ":experimental:",
  }),
  template("btn", "macro", ["xx", SLOT, "btn:[OK]", SLOT, "yy"], {
    header: ":experimental:",
  }),
  template("footnote", "macro", [
    "xx",
    SLOT,
    "footnote:[aa",
    SLOT,
    "bb]",
    SLOT,
    "yy",
  ]),
  template("indexterm", "macro", [
    "xx",
    SLOT,
    "indexterm:[aa,",
    SLOT,
    "bb]",
    SLOT,
    "yy",
  ]),
  template("indexterm2", "macro", [
    "xx",
    SLOT,
    "((aa",
    SLOT,
    "bb))",
    SLOT,
    "yy",
  ]),
  template("indexterm3", "macro", [
    "xx",
    SLOT,
    "(((aa",
    SLOT,
    "bb)))",
    SLOT,
    "yy",
  ]),

  // References and anchors: the id half of each one carries the run
  // into an attribute value, where the lens can no longer see it.
  template("xref-short", "xref", [
    "xx",
    SLOT,
    "<<aa",
    SLOT,
    "bb>>",
    SLOT,
    "yy",
  ]),
  template("xref-short-text", "xref", [
    "xx",
    SLOT,
    "<<aa,bb",
    SLOT,
    "cc>>",
    SLOT,
    "yy",
  ]),
  template("xref-macro", "xref", [
    "xx",
    SLOT,
    "xref:aa[bb",
    SLOT,
    "cc]",
    SLOT,
    "yy",
  ]),
  template("anchor-inline", "xref", [
    "xx",
    SLOT,
    "[[aa,bb",
    SLOT,
    "cc]]",
    SLOT,
    "yy",
  ]),
  template("anchor-macro", "xref", [
    "xx",
    SLOT,
    "anchor:aa[bb",
    SLOT,
    "cc]",
    SLOT,
    "yy",
  ]),
  template("role-span", "xref", [
    "xx",
    SLOT,
    "[#aa]#bb",
    SLOT,
    "cc#",
    SLOT,
    "yy",
  ]),

  ...REPLACEMENT_SPELLINGS.map(([tag, spelling]) =>
    template(`repl-${tag}`, "replacement", ["aa", SLOT, spelling, SLOT, "bb"]),
  ),

  // The shelters the LENS itself has, which are not facts about
  // AsciiDoc: a run inside <code> or <pre> survives the fold, so the
  // repository treats it as meaning whether or not the reference
  // gives it any.
  template(
    "compat-mono-pass",
    "shelter",
    ["xx", SLOT, "`+aa", SLOT, "bb+`", SLOT, "yy"],
    { note: "a monospace passthrough renders inside <code>" },
  ),
  template("mono-in-double", "shelter", [
    "xx",
    SLOT,
    "`aa",
    SLOT,
    "bb cc`",
    SLOT,
    "yy",
  ]),
  template(
    "kbd-run",
    "shelter",
    ["xx", SLOT, "kbd:[Ctrl", SLOT, "A]", SLOT, "yy"],
    { header: ":experimental:" },
  ),

  // Block-level whitespace, where the containing block decides what
  // the run means before any inline rule sees it.
  template("literal-indent", "block", ["  aa", SLOT, "bb"], {
    note: "an indented first line makes the block literal",
  }),
  template("listing-block", "block", ["----\naa", SLOT, "bb\n----"]),
  template("verse-block", "block", ["[verse]\n____\naa", SLOT, "bb\n____"]),
  template("literal-style", "block", ["[literal]\naa", SLOT, "bb"]),
  template("subs-none", "block", ["[subs=none]\naa", SLOT, "-- bb"]),
  template("hardbreaks-blk", "block", ["[%hardbreaks]\naa", SLOT, "bb"]),
  template("hardbreaks-doc", "block", ["aa", SLOT, "bb"], {
    header: ":hardbreaks-option:",
  }),
  template("quote-block", "block", ["____\naa", SLOT, "bb\n____"]),
  template("open-block", "block", ["--\naa", SLOT, "bb\n--"]),
  template("passthrough-blk", "block", ["++++\naa", SLOT, "bb\n++++"]),
];
