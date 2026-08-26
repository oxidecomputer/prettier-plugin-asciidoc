/**
 * Serializes inline AST nodes back to their AsciiDoc source
 * representation. Covers the unified InlineMacroNode, bare-URL
 * links, xref shorthands, and inline anchors. Consumed by the
 * printer (src/print/inline.ts).
 */
import type {
  InlineAnchorNode,
  InlineMacroNode,
  LinkNode,
  XrefNode,
} from "../ast.js";
import { canonicalAttrlist } from "../parse/attrlist.js";
import { BLOCK_ANCHOR } from "../parse/line-shapes.js";

/**
 * The inline macros whose brackets Asciidoctor hands to
 * `AttributeList` — the only ones the attrlist spacing rule may
 * touch.
 *
 * It is a SHORT list because most inline macros put TEXT between the
 * brackets, and text is content: `link:u[Read, now]` and
 * `xref:t[the, text]` render the comma-space into the anchor,
 * `pass:[a, b]` and `stem:[a, b]` pass it through verbatim,
 * `kbd:[Ctrl, T]` and `btn:[OK, now]` label with it, and
 * `footnote:[a, b]` is the footnote's own prose. Each of those was
 * measured against the oracle and each renders DIFFERENTLY once the
 * blank goes, which is what keeps them off this list. `image:` is the
 * one name left — the positional `[alt, width, height]` list — and it
 * renders identically either way. (`icon:` is the same kind of list
 * and would join it, but the tokenizer does not know the name:
 * src/parse/inline/rules.ts's macro alternation is the roster, and
 * this set is a SUBSET of it by construction.)
 */
const ATTRLIST_MACROS = new Set(["image"]);

/**
 * Serialize a unified inline macro node back to AsciiDoc
 * source as `name:target[attrlist]`. Handles all ten
 * macro types (link, mailto, xref, image, kbd, btn, menu,
 * footnote, footnoteref, pass) uniformly.
 * @param node - The parsed inline macro with name, target,
 *   and raw attrlist content.
 * @returns AsciiDoc source string for the macro.
 */
export function inlineMacroToSource(node: InlineMacroNode): string {
  const attrlist = ATTRLIST_MACROS.has(node.name)
    ? canonicalAttrlist(node.attrlist)
    : node.attrlist;
  return node.target.length === 0
    ? `${node.name}:[${attrlist}]`
    : `${node.name}:${node.target}[${attrlist}]`;
}

/**
 * Serialize a bare-URL link AST node back to AsciiDoc source.
 * Handles `https://example.com` (no display text) and
 * `https://example.com[label]` (with display text). Only
 * used for the `"url"` form — macro-form links are now
 * InlineMacroNode.
 * @param node - The parsed link with target and optional
 *   display text. Form is always `"url"`.
 * @returns AsciiDoc source string for the bare URL.
 */
export function linkToSource(node: LinkNode): string {
  return node.text === undefined ? node.target : `${node.target}[${node.text}]`;
}

/**
 * Serialize a shorthand cross-reference AST node back to
 * AsciiDoc source. Emits `<<target>>` or `<<target,text>>`.
 * Only used for the `"shorthand"` form — macro-form xrefs
 * are now InlineMacroNode.
 *
 * The text's LEADING whitespace goes, the same trim the anchor
 * serializer below has always done: the shorthand's post-comma bytes
 * reach the link as `link_text.lstrip` (substitutors.rb l.746), so
 * `<<a, b>>` and `<<a,b>>` are one document. TRAILING whitespace
 * STAYS — nothing strips it, and `<<a,b >>` renders the space inside
 * the anchor.
 * @param node - The parsed xref with target and optional
 *   display text. Form is always `"shorthand"`.
 * @returns AsciiDoc source string for the xref.
 */
export function xrefToSource(node: XrefNode): string {
  return node.text === undefined
    ? `<<${node.target}>>`
    : `<<${node.target},${node.text.trimStart()}>>`;
}

/**
 * Serialize an inline anchor AST node back to AsciiDoc source. An
 * anchor whose AUTHOR'S spelling the grammar accepts takes the
 * normalized `[[id, reftext]]` (print-time trim of the
 * verbatim-captured reftext - byte-identical to the old
 * always-normalize behavior on valid ids); one the grammar REJECTS
 * emits the author's interior verbatim, `[[id,` + reftext + `]]`,
 * because to the re-reader that spelling is TEXT and respelling it
 * changes the rendered characters. BOTH spellings are asked of the
 * grammar: a rejected id (`[[3-bad, Ref]]`) fails on either, and an
 * EMPTY reftext (`[[id,]]`) fails verbatim while its normalized
 * respell `[[id, ]]` would pass - and render as a live anchor where
 * the author's bytes render literal, so the verbatim test must win
 * (the grammar home is the registry's BLOCK_ANCHOR - behavior is
 * Ruby's BlockAnchorRx, rx.rb:164 - pinned by
 * tests/format/anchor-spelling.test.ts). Accepts any id/reftext
 * pair so the block-anchor printer shares this one spelling.
 * @param node - The parsed anchor with an id and optional verbatim
 *   reftext.
 * @returns AsciiDoc source string for the anchor.
 */
export function anchorToSource(
  node: Pick<InlineAnchorNode, "id" | "reftext">,
): string {
  if (node.reftext === undefined) {
    return `[[${node.id}]]`;
  }
  const verbatim = `[[${node.id},${node.reftext}]]`;
  if (!BLOCK_ANCHOR.test(verbatim)) {
    return verbatim;
  }
  const normalized = `[[${node.id}, ${node.reftext.trimStart()}]]`;
  return BLOCK_ANCHOR.test(normalized) ? normalized : verbatim;
}
