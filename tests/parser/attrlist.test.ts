import { describe, expect, test } from "vitest";
import {
  attrlistFields,
  canonicalAttrlist,
  parseAttrlist,
} from "../../src/parse/attrlist.js";

describe("parseAttrlist — the one first-positional spelling", () => {
  // Two views of the same first entry: `style` is the entry itself,
  // which is what every open decision reads, and `styleAttribute` is
  // what Ruby STORES for it (`parse_style_attribute`, parser.rb) -
  // undefined for a named entry, for shorthand alone, and for an
  // empty one. The rows where the two differ are the last four.
  test.each<[string, string, string | undefined]>([
    ["", "", undefined],
    ["source,ruby", "source", "source"],
    [" verse , x", "verse", "verse"],
    ["#myid", "#myid", undefined],
    [".role", ".role", undefined],
    ["a]b", "a]b", "a]b"],
    ["NOTE", "NOTE", "NOTE"],
    ["quote, Firstname Lastname", "quote", "quote"],
    ["separator=::", "separator=::", undefined],
    ["%opt", "%opt", undefined],
    ["foo#id", "foo#id", "foo"],
    // Ruby's own guard: a space means this is not shorthand, so the
    // whole entry is the style.
    ["foo bar", "foo bar", "foo bar"],
    // Issue #77: a no-break space is not blank to Ruby's `BlankRx`
    // (`/[ \t]+/`, attribute_list.rb:46), so it survives on either
    // edge of the first entry instead of being trimmed away with the
    // ASCII blanks around it - unlike the plain-ASCII-space and tab
    // rows right after, which stay blank and get trimmed down to the
    // bare admonition name Ruby's ADMONITION_STYLES recognizes.
    ["NOTE\u00A0", "NOTE\u00A0", "NOTE\u00A0"],
    ["\u00A0NOTE", "\u00A0NOTE", "\u00A0NOTE"],
    ["NOTE ", "NOTE", "NOTE"],
    ["NOTE\t", "NOTE", "NOTE"],
    // Issue #81: a quoted comma is not a boundary, in `style` any
    // more than it already was in `attrlistFields`. The oracle
    // (`@asciidoctor/core` 4.0.11, a paragraph's `attributes[1]`,
    // which is what a generic block's style reads) stores the quotes
    // stripped and the comma kept: `["a,b",c]` -> `{"1":"a,b","2":"c"}`.
    // The unquoted control right after has the SAME three letters and
    // splits at the first comma instead, style `a` - the contrast is
    // the quoting, nothing else.
    ['"a,b",c', "a,b", "a,b"],
    ["a,b,c", "a", "a"],
    // A single-quoted first entry unquotes the same way
    // (`parse_attribute_value`, attribute_list.rb:186-198) - oracle
    // confirms `['a,b',c]` -> `{"1":"a,b"}` too.
    ["'a,b',c", "a,b", "a,b"],
    // An escaped quote does not close the value (attribute_list.rb's
    // `BoundaryRx[QUOT]`, `/.*?[^\\](?=")/`), so it stays part of the
    // content and is then unescaped on the way out
    // (`EscapedQuotes[QUOT]`, l.37-40, l.193). Oracle: `["a\"b",c]` ->
    // `{"1":"a\"b"}` (a literal quote inside the style, one
    // character).
    [String.raw`"a\"b",c`, 'a"b', 'a"b'],
    // An UNCLOSED quote is the one shape the unified scan declines
    // (`attrlistFields` returns undefined), so `style` falls back to
    // the blind first-comma split - which is what Ruby itself does
    // here too: `parse_attribute_value`'s "leading quote only" branch
    // (attribute_list.rb:194-197) keeps the quote character literal
    // and stops at the delimiter. Oracle: `["a,b]` -> `{"1":"\"a"}`.
    [String.raw`"a,b`, '"a', '"a'],
    // Trailing bytes right after a closing quote, before the next
    // comma: Ruby starts a NEW attribute there whether or not a comma
    // ever shows up (`parse` re-enters `parse_attribute`
    // unconditionally, attribute_list.rb:73-77), so the first
    // attribute is still just the quoted content - `x` and `y` land
    // on attributes 2 and 3, not glued onto the style. Oracle:
    // `["a,b"x,y]` -> `{"1":"a,b","2":"x","3":"y"}`. A blank before
    // the trailing bytes changes nothing (`skip_blank` eats it,
    // attribute_list.rb:200-202) - same oracle result for
    // `["a,b" x,y]`.
    ['"a,b"x,y', "a,b", "a,b"],
    ['"a,b" x,y', "a,b", "a,b"],
    // The same shape, single-quoted - oracle: `['a,b'x,y]` and
    // `['a,b' x,y]` both -> `{"1":"a,b","2":"x","3":"y"}`.
    ["'a,b'x,y", "a,b", "a,b"],
    ["'a,b' x,y", "a,b", "a,b"],
    // A NAMED first entry whose quoted value carries a comma: the
    // unified scan reads the whole `foo="b,z"` field instead of
    // truncating at the comma inside the quotes (the incidental fix
    // issue #81's own report flagged as unpinned). `style` is the
    // raw field, unprocessed, because the field does not itself start
    // with a quote (`unquoteField` only strips a BARE quoted value);
    // `styleAttribute` is undefined because a named entry claims no
    // positional slot. Oracle: `[foo="b,z",c]` -> `style: null`,
    // `attrs: {"2":"c","foo":"b,z"}` - no `attributes[1]` at all.
    ['foo="b,z",c', 'foo="b,z"', undefined],
  ])(
    "interior %j has style %j and style attribute %j",
    (raw, style, styleAttribute) => {
      // The WHOLE record, not one field: a structural compare is what
      // makes a re-added field show up here rather than pass
      // unnoticed.
      expect(parseAttrlist(raw)).toEqual({ style, styleAttribute });
    },
  );
});

// Where one attribute ends and the next begins, as `AttributeList`
// decides it (attribute_list.rb): `skip_blank` (l.200-202) eats the
// blanks before an attribute and before a value, `BoundaryRx[',']`
// (l.30-34) ends an unquoted value before them, and a quoted value
// runs to its closing quote whatever it contains.
describe("attrlistFields — where one attribute ends", () => {
  test.each<[string, string[] | undefined]>([
    ["", [""]],
    ["source", ["source"]],
    ["source,ruby", ["source", "ruby"]],
    ["source, ruby", ["source", "ruby"]],
    ["source ,	ruby ", ["source", "ruby"]],
    // Issue #77: a no-break space is not blank to Ruby's `BlankRx`
    // (`/[ \t]+/`, attribute_list.rb:46) the way the ASCII space and
    // tab above are, so it survives a field boundary instead of being
    // folded away with them - on either side of a comma, and whether
    // or not the field carries one at all.
    ["NOTE\u00A0", ["NOTE\u00A0"]],
    ["NOTE ", ["NOTE"]],
    ["NOTE\t", ["NOTE"]],
    ["#id\u00A0", ["#id\u00A0"]],
    [".role%hardbreaks\u00A0", [".role%hardbreaks\u00A0"]],
    ["source,ruby\u00A0", ["source", "ruby\u00A0"]],
    ["source,\u00A0ruby", ["source", "\u00A0ruby"]],
    // The blanks INSIDE an attribute are data (l.144).
    [
      "quote, Famous Person, A Book (2001)",
      ["quote", "Famous Person", "A Book (2001)"],
    ],
    // A quoted value keeps its comma AND its blanks.
    ['quote, "A, B", c', ["quote", '"A, B"', "c"]],
    ["a, 'b, c'", ["a", "'b, c'"]],
    ['cols="1,2", options="header"', ['cols="1,2"', 'options="header"']],
    // A quote that opens no value is an ordinary character.
    ['a"b, c', ['a"b', "c"]],
    ['a=b"c, d', ['a=b"c', "d"]],
    // An escaped quote does not close the value. The second row is the
    // one that DISTINGUISHES the rule: in the first, the field is the
    // same string whether the backslash is honoured or not (the pieces
    // re-concatenate), so it pins nothing about the escape — put a
    // comma between the escaped quote and the real closing one and the
    // two readings split into different fields. Found by mutation
    // testing, which killed nothing on the first row alone.
    [String.raw`a="b\"c", d`, [String.raw`a="b\"c"`, "d"]],
    [String.raw`a="b\",c"`, [String.raw`a="b\",c"`]],
    // A quote opens a value at the START of the interior, too.
    ['"a,b"', ['"a,b"']],
    // Trailing bytes right after a closing quote start a NEW field,
    // comma or not - Ruby never requires a delimiter between
    // attributes (`parse` re-enters `parse_attribute` unconditionally,
    // attribute_list.rb:73-77), so `skip_delimiter`
    // (`SkipRx[',']`, l.48-50) finding nothing to skip costs nothing.
    // Oracle: `["a,b"x,y]` -> `{"1":"a,b","2":"x","3":"y"}`, three
    // attributes, not one field carrying the trailing bytes.
    ['"a,b"x,y', ['"a,b"', "x", "y"]],
    // A blank between the closing quote and the trailing bytes is
    // just `skip_blank` (attribute_list.rb:200-202) - it disappears,
    // it does not turn the bytes back into part of the quoted field.
    // Same oracle result as the row above.
    ['"a,b" x,y', ['"a,b"', "x", "y"]],
    // The same shape, single-quoted.
    ["'a,b'x,y", ["'a,b'", "x", "y"]],
    ["'a,b' x,y", ["'a,b'", "x", "y"]],
    // A second quoted value right after the first, with only a blank
    // between them, is the same shape as the trailing-bytes rows
    // above: the blank is `skip_blank`, then the quote opens the next
    // attribute's value at that attribute's own start. Oracle:
    // `["a" "b,c"]` -> `{"1":"a","2":"b,c"}`, two attributes.
    ['"a" "b,c"', ['"a"', '"b,c"']],
    // Blanks around the `=` keep the value position open (`skip_blank`
    // runs before the value), space and tab alike.
    ['a = "b,c"', ['a = "b,c"']],
    ['a=\t"b,c"', ['a=\t"b,c"']],
    // Empty attributes are attributes.
    ["a,,b", ["a", "", "b"]],
    [",", ["", ""]],
    // Shorthand carries no comma and passes through.
    ["#id", ["#id"]],
    [".role%hardbreaks", [".role%hardbreaks"]],
    // DECLINED: an unclosed quote, and an interior with a newline.
    ['quote, "A B, c', undefined],
    ["a,\nb", undefined],
  ])("interior %j splits to %j", (raw, fields) => {
    expect(attrlistFields(raw)).toEqual(fields);
  });
});

describe("canonicalAttrlist — one spelling of the interior", () => {
  test.each([
    ["source, ruby", "source,ruby"],
    [" source , ruby ", "source,ruby"],
    ['quote, "A, B", c', 'quote,"A, B",c'],
    ["alt, 10", "alt,10"],
    [".role", ".role"],
    // Issue #77: the four render-visible witnesses print byte for
    // byte - a no-break space is not one of Ruby's `[ \t]` blanks,
    // so it is never trimmed off the printed interior.
    ["NOTE\u00A0", "NOTE\u00A0"],
    ["#id\u00A0", "#id\u00A0"],
    ["source,ruby\u00A0", "source,ruby\u00A0"],
    [".role%hardbreaks\u00A0", ".role%hardbreaks\u00A0"],
    // The other direction of the same boundary: an ASCII space or
    // tab is still a Ruby blank, so it prints trimmed away exactly
    // as it did before this fix.
    ["NOTE ", "NOTE"],
    ["NOTE\t", "NOTE"],
    // Interior whitespace is content, not a boundary - a no-break
    // space inside a positional value (the attribution name) never
    // sat at a field edge, so it printed unchanged even before this
    // fix; pinned here as the control that proves the fix does not
    // reach past the boundary it owns.
    ["quote, Author\u00A0Name", "quote,Author\u00A0Name"],
    // A declined interior comes back byte for byte.
    ['quote, "A B, c', 'quote, "A B, c'],
    ["a,\nb", "a,\nb"],
  ])("%j prints %j", (raw, canonical) => {
    expect(canonicalAttrlist(raw)).toBe(canonical);
  });
});
