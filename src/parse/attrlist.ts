/**
 * The parsed view of a block-attribute line's interior — beside the
 * registry on purpose: line-shapes.ts owns line SHAPES; this module
 * owns the bracket line's INTERIOR. One function, so the reader and
 * every style decision read the same first positional attribute
 * (spec D3); the two spellings it replaced (`firstPositional`,
 * `extractStyle`) agreed by luck, in two modules.
 *
 * Named attributes (`cols`, `format`, `separator`, `%options`, quoted
 * values — Ruby's `AttributeList` / `parse_style_attribute`) are OUT
 * of scope: nothing in plan α consumes them. This module is their
 * designated home; the revisit trigger is real table modeling (#10).
 */

/** The reader-side view of one `[…]` block-attribute line's interior. */
export interface Attrlist {
  /**
   * The bracket interior as given — but always RSTRIPPED: the one
   * caller today (reader.ts's `holdMetadata`, ~line 586) passes
   * `line.text.slice(1, -1)`, and the splitter rstrips `line.text`
   * before the reader ever sees it. A caller that needs the raw,
   * unstripped bytes must say so here rather than assume this field
   * carries them — annotatedBy's node-value pairing (spec D5a) needs
   * exactly that distinction: it copies the held node's raw `value`,
   * not `Attrlist.raw`, because the two differ on a trailing-
   * whitespace attribute line.
   */
  readonly raw: string;
  /**
   * The first positional attribute, trimmed — Ruby's `attributes[1]`,
   * the style every open decision reads (parser.rb:527). `""` for
   * `[]`. Shorthand values (`#id`, `.role`) pass through
   * unrecognized, exactly as both replaced spellings behaved.
   */
  readonly style: string;
}

/**
 * Parse a block-attribute line's interior. The ONE spelling.
 * @param raw - the text between the brackets, brackets excluded
 * @returns the interior and its first positional attribute
 */
export function parseAttrlist(raw: string): Attrlist {
  // Split on the first comma to isolate the style from any further
  // positional attributes (the language in `[source,ruby]`, the
  // attribution in `[quote, Name]`). Shorthand values like `#myid`
  // and `.role` carry no comma and pass through as-is; they match no
  // entry in any caller's lookup table, so no caller special-cases
  // them.
  const [first] = raw.split(",");
  return { raw, style: first.trim() };
}
