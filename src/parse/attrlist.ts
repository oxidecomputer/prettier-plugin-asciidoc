/**
 * The parsed view of a block-attribute line's interior — beside the
 * registry on purpose: line-shapes.ts owns line SHAPES; this module
 * owns the bracket line's INTERIOR. One function, so the reader and
 * every style decision read the same first positional attribute
 * — one parser, one answer; the two spellings it replaced
 * (`firstPositional`,
 * `extractStyle`) agreed by luck, in two modules.
 *
 * Named attributes (`cols`, `format`, `separator`, `%options` —
 * Ruby's `AttributeList` / `parse_style_attribute`) are still OUT of
 * scope as VALUES: nothing consumes them yet. What this module does
 * own beyond the style is where one attribute ENDS and the next
 * begins ({@link attrlistFields}), which is all the printer needs to
 * spell the interior canonically. The revisit trigger for the values
 * themselves is real table modeling (#10).
 */

/**
 * The reader-side view of one `[…]` block-attribute line's interior.
 *
 * ONE field. It carried a second, `raw` — the interior as given — and
 * NOTHING ever read it: the reader kept the record for its style, and
 * every consumer that wanted the bytes had a better source for them
 * (`annotatedBy` pairs the held NODE's `value`, which differs from the
 * interior on a trailing-whitespace attribute line, and
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
}

/**
 * Parse a block-attribute line's interior. The ONE spelling.
 * @param raw - the text between the brackets, brackets excluded
 * @returns its first positional attribute
 */
export function parseAttrlist(raw: string): Attrlist {
  // Split on the first comma to isolate the style from any further
  // positional attributes (the language in `[source,ruby]`, the
  // attribution in `[quote, Name]`). Shorthand values like `#myid`
  // and `.role` carry no comma and pass through as-is; they match no
  // entry in any caller's lookup table, so no caller special-cases
  // them.
  const [first] = raw.split(",");
  return { style: first.trim() };
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
  if (raw.includes("\n")) return undefined;
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
      if (end === undefined) return undefined;
      field += raw.slice(index, end + 1);
      index = end;
      atValue = false;
      continue;
    }
    if (character === ",") {
      fields.push(field.trim());
      field = "";
      atValue = true;
      continue;
    }
    field += character;
    // Blanks keep the value position open — `foo = "bar"` is Ruby's
    // `skip_blank` after the `=` (l.121).
    if (character !== " " && character !== "\t") atValue = character === "=";
  }
  fields.push(field.trim());
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
    if (raw[index] === quote) return index;
  }
  return undefined;
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
