import { describe, expect, test } from "vitest";
import {
  attrlistFields,
  canonicalAttrlist,
  parseAttrlist,
} from "../../src/parse/attrlist.js";

describe("parseAttrlist — the one first-positional spelling", () => {
  test.each([
    ["", ""],
    ["source,ruby", "source"],
    [" verse , x", "verse"],
    ["#myid", "#myid"],
    [".role", ".role"],
    ["a]b", "a]b"],
    ["NOTE", "NOTE"],
    ["quote, Firstname Lastname", "quote"],
  ])("interior %j has style %j", (raw, style) => {
    // The WHOLE record, not `.style`: the type has one field today
    // (`raw` was deleted as unread), and a structural compare is what
    // makes a re-added field show up here rather than pass unnoticed.
    expect(parseAttrlist(raw)).toEqual({ style });
  });
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
    // ...and only at a value POSITION. After a quoted value the next
    // quote is an ordinary character, and a blank does not re-open the
    // position — so this comma SPLITS.
    ['"a" "b,c"', ['"a" "b', 'c"']],
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
    // A declined interior comes back byte for byte.
    ['quote, "A B, c', 'quote, "A B, c'],
    ["a,\nb", "a,\nb"],
  ])("%j prints %j", (raw, canonical) => {
    expect(canonicalAttrlist(raw)).toBe(canonical);
  });
});
