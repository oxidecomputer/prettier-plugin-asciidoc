/**
 * The parsed view of a block-attribute line's interior — beside the
 * registry on purpose: line-shapes.ts owns line SHAPES; this module
 * owns the bracket line's INTERIOR. One shared boundary scan
 * ({@link attrlistFields}), so the reader's first positional
 * attribute and the printer's canonical spelling read the same field
 * boundaries - one parser, one answer; the two spellings it replaced
 * (`firstPositional`, `extractStyle`) agreed by luck, in two modules.
 *
 * Named attributes (`cols`, `format`, `separator`, `%options` —
 * Ruby's `AttributeList` / `parse_style_attribute`) are read as
 * VALUES by {@link attrlistValues}, over the same boundary scan: a
 * table's open is the consumer (#10), and it asks the four keys that
 * change how a table cuts. Nothing else about a named attribute is
 * modeled - no substitution, no `attributes[N]` positional map - so
 * the values are what the interior spells and nothing more.
 */
import { BLOCK_ANCHOR } from "./line-shapes.js";

/**
 * The reader-side view of one `[…]` block-attribute line's interior.
 *
 * ONE field. It carried a second, `raw` — the interior as given — and
 * NOTHING ever read it: the reader kept the record for its style, and
 * every consumer that wanted the bytes had a better source for them
 * (`annotatedBy` pairs the held NODE's `value`, which spells the
 * interior exactly - both sides decompose the rstripped line - and
 * {@link canonicalAttrlist} takes the interior as an argument). It was
 * the standing example in the scorecard's unread-published-field
 * report; deleting it is what let that report be armed as a gate.
 */
export interface Attrlist {
  /**
   * The first positional attribute, trimmed — Ruby's `attributes[1]`,
   * the style every open decision reads (parser.rb:533). `""` for
   * `[]`. Shorthand values (`#id`, `.role`) pass through
   * unrecognized, exactly as both replaced spellings behaved.
   */
  readonly style: string;
  /**
   * The style Ruby actually STORES - `attributes['style']` after
   * `parse_style_attribute` (parser.rb) has had the first entry -
   * or undefined when the line names no style at all.
   *
   * A second view of the same split rather than a second parse, and
   * a second view rather than a correction to {@link Attrlist.style}
   * because the open decisions' behaviour on `[source#id]` is pinned
   * by their own oracle rows: aligning them is a byte-changing change
   * of its own, not a side effect of this one.
   *
   * It differs from `style` in three ways, each measured against the
   * oracle (tests/conformance/document-header.test.ts):
   *
   * - A NAMED first entry names no style: `[separator=::]` and
   *   `[a=b,c]` both leave it undefined, because Ruby's positional
   *   index counts ENTRIES, so a named first entry means there is no
   *   `attributes[1]` at all.
   * - SHORTHAND is stripped: an entry with no space that carries `.`,
   *   `#` or `%` keeps only the part before the first of them, so
   *   `[foo#id]` is `foo` and `[.role#id]` is undefined.
   * - An EMPTY entry names no style: `[]` and `[,bar]` are undefined,
   *   where `style` is `""`.
   *
   * WHAT CONSUMES IT is a rule the pinned oracle has and Ruby does
   * not, so do not read this field's existence as Ruby semantics: the
   * one reader is the document header's reachability, and there a
   * style above the title demotes it to a section only because
   * `@asciidoctor/core` 4.0.11 tests `blockAttrs.style`
   * (src/parser.js:180). Ruby 2.0.26 bails on `block_attrs['title']`
   * alone (parser.rb:132) and builds a header under `[foo]`.
   */
  readonly styleAttribute: string | undefined;
}

// A named attribute's name, and the `=` that makes it one: `NameRx`
// anchored at the entry's start. An entry that matches is `name=value`
// and takes no positional slot, which is why `[separator=::]` names no
// style.
//
// The NAME CLASS is the PINNED ORACLE'S, and the two authorities
// disagree here. Ruby's `NameRx` is `#{CG_WORD}[#{CC_WORD}\-.]*`
// (attribute_list.rb:44) and admits a dot; `@asciidoctor/core` 4.0.11
// spells it `${CG_WORD}[${CC_WORD}\\-]*`
// (build/node/index.cjs:9929) and does NOT. We follow the oracle,
// because the oracle is what renders: given `[foo.bar = baz]` it
// scans the name as `foo`, finds `.` where it wants `=`, and reads
// the whole entry as positional - so the entry names a style, and
// above a title that style is a barrier. Ruby reads the same entry as
// the named attribute `foo.bar` and keeps the header. Do not "fix"
// the dot back in to match the Ruby.
//
// The BLANKS before the `=` are both authorities': `parse_attribute`
// scans the name, then `skip_blank`, and only then tests for `=`
// (attribute_list.rb:110-120), and `skip_blank` skips `BlankRx`,
// which is `/[ \t]+/` in Ruby (attribute_list.rb:46) and identically
// in the oracle (build/node/index.cjs:9932, read by `#skipBlank` at
// :10250) - a TAB is as blank as a space. So `[foo = bar]`,
// `[foo =bar]` and `[foo<TAB>=bar]` are named attributes and leave a
// header standing, exactly as `[foo=bar]` does - measured against the
// oracle. Blanks on the VALUE side (`[foo= bar]`) are the same
// attribute for the same reason and need no expression here.
const NAMED_ATTRIBUTE = /^\w[\w\-]*[ \t]*=/v;

// The shorthand separators `parse_style_attribute` splits an entry
// on: `.role`, `#id`, `%option`. The style is whatever stands before
// the first of them.
const SHORTHAND = /[.#%]/v;

// An interior that names an id and nothing else: the `#` sigil, then
// at least one character that is none of the shorthand separators, no
// comma opening a second entry, and no blank. Ruby reads shorthand off
// the first positional entry only, and only when that entry carries no
// space ("spaces are not allowed in shorthand", parse_style_attribute),
// so any of those means the line spells more than the id and the
// author's bytes have to stand. The ID CLASS is not restated here:
// {@link attrlistAnchorId} asks BLOCK_ANCHOR whether the id can be
// spelled as an anchor line, so there is one grammar for the id and
// not a copy that can drift from it.
const ID_SHORTHAND_ONLY = /^#[^ \t.,%#]+$/v;

// Ruby's own blank set for attrlist scanning - NOT the six-character
// {@link ASCII_WHITESPACE} class line-shapes.ts uses for a whole LINE
// (issue #75). `skip_blank` runs `BlankRx`, which is `/[ \t]+/`
// (attribute_list.rb:46); the boundary that ends an unquoted value is
// `/.*?(?=[ \t]*(,|$))/` (`BoundaryRx[',']`, attribute_list.rb:30-34)
// and the delimiter it eats is `/[ \t]*(,|$)/` (`SkipRx`,
// attribute_list.rb:50) - space and tab, every time, never LF, VT,
// FF or CR. So this is deliberately narrower than the six-character
// class: reusing it here would over-strip a VT/FF/CR that a real
// interior can still carry (only a literal newline turns
// {@link attrlistFields} away, at the top of this file) and that
// Ruby's own scan leaves standing. `.trim()` is wrong for the same
// reason issue #75 gave for a line: JavaScript's notion of "blank"
// also takes a no-break space and the rest of Unicode's space
// separators, which Ruby's literal `[ \t]` never does (issue #77).
const ATTRLIST_BLANK = new Set([" ", "\t"]);

/**
 * Trim the blanks Asciidoctor's `AttributeList` itself trims from an
 * attrlist field - space and tab, {@link ATTRLIST_BLANK}, and nothing
 * wider.
 * @param field - one attrlist field, or the interior's first entry
 * @returns the field with its leading and trailing blanks removed
 */
function trimBlank(field: string): string {
  let start = 0;
  let end = field.length;
  while (start < end && ATTRLIST_BLANK.has(field[start])) {
    start += 1;
  }
  while (end > start && ATTRLIST_BLANK.has(field[end - 1])) {
    end -= 1;
  }
  return field.slice(start, end);
}

/**
 * Parse a block-attribute line's interior. The ONE spelling: the
 * first positional attribute comes from {@link attrlistFields}'s own
 * quote-aware boundary scan, the same scan that decides where every
 * later attribute starts and ends, so a quoted first entry
 * (`["a,b",c]`) cannot read differently here than it does there. A
 * comma inside a closed quote is not a boundary either place; only
 * an interior {@link attrlistFields} declines (an unclosed quote, an
 * embedded newline) falls back to the blind first-comma split, which
 * is what Ruby itself does for an unclosed quote (`parse_attribute_value`'s
 * "leading quote only" branch, attribute_list.rb:194-197, keeps the
 * quote character literal and stops at the next comma) - so the
 * fallback is not a second parser, it is the first entry's answer on
 * the one shape the unified scan cannot commit to.
 * @param raw - the text between the brackets, brackets excluded
 * @returns its first positional attribute, in both views
 */
export function parseAttrlist(raw: string): Attrlist {
  const fields = attrlistFields(raw);
  const first =
    fields === undefined
      ? trimBlank(raw.split(",")[0])
      : unquoteField(fields[0]);
  return { style: first, styleAttribute: styleAttributeOf(first) };
}

/**
 * The id a block-attribute line names when it names an id and NOTHING
 * else: `[#intro]` and no other shape.
 *
 * WHY IT IS ASKED. `[[intro]]` and `[#intro]` give the following block
 * the same id and render the same, so which one the author typed is a
 * spelling; the reader records the id and the printer writes the
 * anchor line, rather than replaying the bracket the author reached
 * for (docs/architecture.md, "Formatting policy": derive syntax from
 * the recorded structure). Where this answers, the line's meaning is
 * exactly the id, so nothing about the line is lost by recording it as
 * one.
 *
 * The answer is deliberately narrow and every rejection keeps the
 * author's bytes: a role, an option, a second entry, a blank or an
 * id no block-anchor line can spell (`[#3bad]`, `[#a.b]`) all leave
 * the line an attribute list. Soundness measured against the oracle:
 * an accepted interior renders byte-identically in both spellings and
 * every rejection is conservative, which the accepted and rejected
 * rows of tests/parser/build/metadata.test.ts,
 * tests/parser/block-attributes.test.ts and
 * tests/format/block-attributes.test.ts carry between them. The
 * grammar it defers to is ASCII where the oracle's is not, which
 * makes it refuse ids the oracle accepts and never the other way
 * (issue #203).
 * @param raw - the text between the brackets, brackets excluded
 * @returns the id, or undefined when the line spells anything else
 */
export function attrlistAnchorId(raw: string): string | undefined {
  // Asked of the CANONICAL interior, not the author's: the printer
  // writes `[#id ]` back as `[#id]` ({@link canonicalAttrlist}), so a
  // test over the author's bytes would answer no on the first pass and
  // yes on the second, and the two passes would print different
  // documents. One interior, one answer.
  const interior = canonicalAttrlist(raw);
  if (!ID_SHORTHAND_ONLY.test(interior)) {
    return undefined;
  }
  const id = interior.slice(1);
  return BLOCK_ANCHOR.test(`[[${id}]]`) ? id : undefined;
}

/**
 * The style Ruby stores for a first entry - see
 * {@link Attrlist.styleAttribute} for the three ways it differs from
 * the entry itself.
 * @param first - the first entry of the interior, trimmed
 * @returns the stored style, or undefined when there is none
 */
function styleAttributeOf(first: string): string | undefined {
  if (NAMED_ATTRIBUTE.test(first)) {
    return undefined;
  }
  // The space test is Ruby's own guard: "spaces are not allowed in
  // shorthand, so if we detect one, this ain't no shorthand", which
  // is why `[foo bar]` keeps its whole spelling as the style.
  const shorthand = first.includes(" ") ? -1 : first.search(SHORTHAND);
  const style = shorthand === -1 ? first : first.slice(0, shorthand);
  return style === "" ? undefined : style;
}

/** A quote character that can open an attribute value. */
const QUOTES = new Set(['"', "'"]);

/**
 * Split an attrlist interior into its attributes, each trimmed of the
 * blanks Asciidoctor never sees.
 *
 * Ruby's `AttributeList` skips `[ \t]+` before every attribute and
 * before every value (`skip_blank`, attribute_list.rb l.200-202),
 * ends an unquoted value at `/.*?(?=[ \t]*(,|$))/` (`BoundaryRx[',']`,
 * l.30-34) and eats the delimiter with `/[ \t]*(,|$)/` (`SkipRx`,
 * l.48-50). So the blanks around an attribute are not data — but the
 * blanks INSIDE one are (`name = %(#{name}#{' ' * skipped}#{c}...)`,
 * l.144, is how `[quote, Famous Person]` keeps its space), and so is
 * everything between a value's quotes, comma included.
 *
 * Conservative by construction: the scan gives up — and the caller
 * replays the author's bytes — on an interior it cannot read the same
 * way Ruby does. That is a quote opened and never closed (Ruby falls
 * back to treating the quote as literal, l.194-96) and an interior
 * carrying a newline (`BlankRx` is `[ \t]+`; a newline is not blank
 * to the scanner, and only a serialized inline macro can hold one).
 * @param raw - the text between the brackets, brackets excluded
 * @returns one string per attribute, or undefined when the interior
 *   is one this scan will not rewrite
 * Exported for its branch table (tests/parser/attrlist.test.ts); the
 * only src consumer is {@link canonicalAttrlist}, below.
 * @internal
 */
export function attrlistFields(raw: string): string[] | undefined {
  if (raw.includes("\n")) {
    return undefined;
  }
  const fields: string[] = [];
  let field = "";
  // A value POSITION: the start of an attribute, or just past its
  // `=`. Only there does a quote open a quoted value — `[a"b,c]` has
  // an ordinary quote in the middle of a name, and Ruby reads it that
  // way too.
  let atValue = true;
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (atValue && QUOTES.has(character)) {
      const end = closingQuote(raw, index);
      if (end === undefined) {
        return undefined;
      }
      field += raw.slice(index, end + 1);
      if (!endsAttributeHere(raw, end + 1)) {
        // Trailing bytes right after the closing quote, with nothing
        // between them and the last one but blanks - Ruby starts a
        // new attribute here whether or not a comma ever shows up
        // (see {@link endsAttributeHere}), so this field is done.
        fields.push(trimBlank(field));
        field = "";
        atValue = true;
        index = end;
        continue;
      }
      index = end;
      atValue = false;
      continue;
    }
    if (character === ",") {
      fields.push(trimBlank(field));
      field = "";
      atValue = true;
      continue;
    }
    field += character;
    // Blanks keep the value position open — `foo = "bar"` is Ruby's
    // `skip_blank` after the `=` (l.121).
    if (character !== " " && character !== "\t") {
      atValue = character === "=";
    }
  }
  fields.push(trimBlank(field));
  return fields;
}

/**
 * The index of the quote that closes the one at `open`, skipping a
 * backslash-escaped quote the way `BoundaryRx[QUOT]`
 * (`/.*?[^\\](?=")/`) does.
 * @param raw - the attrlist interior
 * @param open - index of the opening quote
 * @returns the closing quote's index, or undefined when there is none
 */
function closingQuote(raw: string, open: number): number | undefined {
  const quote = raw[open];
  for (let index = open + 1; index < raw.length; index += 1) {
    if (raw[index] === "\\") {
      index += 1;
      continue;
    }
    if (raw[index] === quote) {
      return index;
    }
  }
  return undefined;
}

/**
 * Whether the byte at `from` - the position right after a value's
 * closing quote - can still belong to the SAME field, or whether a
 * new field starts there instead.
 *
 * Ruby's own loop never requires a delimiter between attributes:
 * `parse` calls `parse_attribute` again unconditionally right after
 * every attribute, quoted or not (l.73-77), and the `skip_delimiter`
 * call between them (`SkipRx[',']`, `/[ \t]*(,|$)/`, l.48-50) is a
 * plain `StringScanner#skip` - it eats a run of blanks then a comma
 * when one is there, but costs nothing when it is not, and either way
 * the next `parse_attribute` starts right where the quote closed. So
 * the only bytes that mean "nothing more to split off here" are the
 * ones `skip_delimiter` would itself have consumed: a run of `[ \t]`
 * up to a comma, or the end of the interior. Anything else - another
 * quote, a bare word, digits - is the start of a new attribute, the
 * same as it would be at the top of the whole interior.
 * @param raw - the attrlist interior
 * @param from - the index right after a value's closing quote
 * @returns true when the field can keep absorbing raw text unchanged
 */
function endsAttributeHere(raw: string, from: number): boolean {
  let index = from;
  while (index < raw.length && ATTRLIST_BLANK.has(raw[index])) {
    index += 1;
  }
  return index === raw.length || raw[index] === ",";
}

/**
 * Ruby's own unescape for a quoted value's escaped quote:
 * `EscapedQuotes[quote]` turns `\"` into `"` (double-quoted) or `\'`
 * into `'` (single-quoted) - a literal two-character replacement,
 * not a general backslash unescape, and specific to the quote that
 * opened the value (attribute_list.rb:37-40, l.193). A backslash
 * before any other character is left exactly as written.
 * @param inner - a quoted field's content, quotes already stripped
 * @param quote - the quote character that opened the value
 * @returns the content with that one escape resolved
 */
function unescapeQuoted(inner: string, quote: string): string {
  return inner.split(`\\${quote}`).join(quote);
}

/**
 * The value Ruby stores for one {@link attrlistFields} field: the
 * field itself, unless the field IS a bare quoted value - opening
 * and closing quote both present and nothing else in the field -
 * in which case the quotes are stripped and any escaped quote inside
 * is unescaped (`parse_attribute_value`, attribute_list.rb:186-198).
 * A field with text outside its quotes (`foo="bar"`, a name=value
 * pair {@link attrlistFields} keeps whole) is not a bare quoted value
 * and passes through unchanged; the first positional entry is always
 * a bare value or a bare quoted one, never a name=value pair, so
 * that is the only shape {@link parseAttrlist} ever asks this to
 * unquote.
 * @param field - one field from {@link attrlistFields}, already
 *   trimmed of its surrounding blanks
 * @returns the value Ruby's parser would store for that field
 */
function unquoteField(field: string): string {
  if (field.length < 2) {
    return field;
  }
  const [quote] = field;
  if (!QUOTES.has(quote) || !field.endsWith(quote)) {
    return field;
  }
  const inner = field.slice(1, -1);
  return inner.includes("\\") ? unescapeQuoted(inner, quote) : inner;
}

/**
 * The values a table's open reads out of one `[...]` interior: every
 * named attribute, and every option name, over {@link attrlistFields}'s
 * own boundary scan so a quoted `cols="1,1"` splits here exactly as
 * it splits for the printer.
 */
export interface AttrlistValues {
  /** Named attribute values, keyed by the name the interior spells. */
  readonly named: ReadonlyMap<string, string>;
  /** The option names, both spellings below folded into one set. */
  readonly options: ReadonlySet<string>;
}

/**
 * A reading that names nothing: the answer for a block with no
 * attribute line at all, and the TOTAL FALLBACK for an interior
 * {@link attrlistFields} declines - an unclosed quote, an embedded
 * newline. The fallback is the same conservatism the canonical
 * spelling takes on those interiors, and it costs a table nothing a
 * reader can see: an unresolved `format=` or `cols=` changes where
 * the table's own records say its cells were cut, never which bytes
 * it replays.
 *
 * Exported so a caller with no interior to read spells the empty
 * reading THIS way rather than assembling one of its own - two empty
 * containers are easy to build and easy to build differently.
 */
export const NO_ATTRLIST_VALUES: AttrlistValues = {
  named: new Map(),
  options: new Set(),
};

// A field's name half, when the field is `name=value`: `NameRx`
// anchored at the field's start, then the blanks `skip_blank` eats
// before the `=` (attribute_list.rb:110-124). A field whose text
// before its first `=` fails this is POSITIONAL, and takes an
// `attributes[N]` slot Ruby counts but nothing here models.
const NAMED_HALF = /^\w[\w\-]*[ \t]*$/v;

// One `%option` segment of a shorthand style entry: the marker and
// everything up to the next one (`parse_style_attribute`, parser.rb).
const SHORTHAND_OPTION = /%[^.#%]+/gv;

// The two spellings of the attribute that names options; Ruby stores
// each entry of either as `<name>-option` (attribute_list.rb).
const OPTION_KEYS = new Set(["options", "opts"]);

/**
 * The `%option` names a STYLE entry carries. Ruby reads shorthand out
 * of `attributes[1]` and nowhere else, and refuses it outright on an
 * entry with a space in it ("spaces are not allowed in shorthand, so
 * if we detect one, this ain't no shorthand"), so `[a,%header]` names
 * an option and `[a b,%header]` names none.
 * @param first - the first POSITIONAL field, unquoted
 * @returns the option names it spells, in order
 */
function shorthandOptions(first: string): string[] {
  if (first.includes(" ")) {
    return [];
  }
  return [...first.matchAll(SHORTHAND_OPTION)].map((match) =>
    match[0].slice(1),
  );
}

/**
 * What one attrlist field IS: Ruby's two kinds, as a value the caller
 * records rather than a flag it has to decode
 * (`parse_attribute`, attribute_list.rb:110-124).
 */
type Field =
  | {
      /** Field discriminant: `name=value`. */
      readonly kind: "named";
      /** The name, blanks before the `=` removed. */
      readonly name: string;
      /** The value, unquoted the way Ruby stores it. */
      readonly value: string;
    }
  | {
      /**
       * Field discriminant: anything else, which takes an
       * `attributes[N]` slot Ruby counts and nothing here models.
       */
      readonly kind: "positional";
    };

/**
 * Read one field.
 *
 * The `=` is found by INDEX rather than by a capture, so the name and
 * the value are two slices of the field and no branch here is
 * unreachable: a field with no `=`, and one whose text before the
 * first `=` is not a name, are the same positional answer.
 * @param field - one field from {@link attrlistFields}
 * @returns what the field is
 */
function readField(field: string): Field {
  const equals = field.indexOf("=");
  if (equals === -1 || !NAMED_HALF.test(field.slice(0, equals))) {
    return { kind: "positional" };
  }
  return {
    kind: "named",
    name: trimBlank(field.slice(0, equals)),
    value: unquoteField(trimBlank(field.slice(equals + 1))),
  };
}

/**
 * Read one block-attribute interior's named values and options.
 * @param raw - the text between the brackets, brackets excluded
 * @returns the values it names
 */
export function attrlistValues(raw: string): AttrlistValues {
  const fields = attrlistFields(raw);
  if (fields === undefined) {
    return NO_ATTRLIST_VALUES;
  }
  const named = new Map<string, string>();
  const options = new Set<string>();
  for (const [index, field] of fields.entries()) {
    const read = readField(field);
    if (read.kind === "positional") {
      // Shorthand is read out of `attributes[1]` and nowhere else
      // (`parse_style_attribute` runs only on `attributes[1]`,
      // parser.rb:2057-2061), and `attributes[1]` is the first FIELD
      // when that field is unnamed - not the first unnamed field.
      // `AttributeList#parse` counts every field, named or not, and
      // stores an unnamed one under its own field position
      // (`@attributes[index + 1] = name`, attribute_list.rb:180, over
      // the loop at :71-77). So the `%header` of `[cols="1,1",%header]`
      // is `attributes[2]`, is never read as shorthand, and gives the
      // table no header - which is what the oracle renders.
      if (index === 0) {
        for (const option of shorthandOptions(unquoteField(field))) {
          options.add(option);
        }
      }
      continue;
    }
    named.set(read.name, read.value);
    if (OPTION_KEYS.has(read.name)) {
      for (const option of read.value.split(",")) {
        options.add(trimBlank(option));
      }
    }
  }
  // An empty option name is no option: `[%]` and `[options=" ,a"]`
  // both spell one, and Ruby stores `-option` for neither.
  options.delete("");
  return { named, options };
}

/**
 * The canonical spelling of an attrlist interior: one attribute per
 * comma, no blanks around either. Returns the author's bytes
 * unchanged when {@link attrlistFields} declines the interior.
 * @param raw - the text between the brackets, brackets excluded
 * @returns the interior to print
 */
export function canonicalAttrlist(raw: string): string {
  return attrlistFields(raw)?.join(",") ?? raw;
}
