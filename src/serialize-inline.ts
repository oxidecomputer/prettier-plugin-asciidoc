/**
 * Serializes inline AST nodes back to their AsciiDoc source
 * representation. Covers the unified InlineMacroNode, bare-URL
 * links, xref shorthands, and inline anchors. Consumed by the
 * printer (print-inline.ts).
 */
import type {
  InlineAnchorNode,
  InlineMacroNode,
  LinkNode,
  XrefNode,
} from "./ast.js";
import { BLOCK_ANCHOR } from "./parse/line-shapes.js";

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
  return node.target.length === 0
    ? `${node.name}:[${node.attrlist}]`
    : `${node.name}:${node.target}[${node.attrlist}]`;
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
 * @param node - The parsed xref with target and optional
 *   display text. Form is always `"shorthand"`.
 * @returns AsciiDoc source string for the xref.
 */
export function xrefToSource(node: XrefNode): string {
  return node.text === undefined
    ? `<<${node.target}>>`
    : `<<${node.target},${node.text}>>`;
}

/**
 * Serialize an inline anchor AST node back to AsciiDoc source. A
 * VALID id takes the normalized spelling `[[id, reftext]]` (print-time
 * trim of the verbatim-captured reftext — byte-identical to the old
 * always-normalize behavior on valid ids); a grammar-REJECTED id
 * emits the author's interior verbatim, `[[id,` + reftext + `]]`,
 * because to the re-reader that line is TEXT and respelling it
 * changes the rendered characters (the grammar home is the registry's
 * BLOCK_ANCHOR — behavior is Ruby's BlockAnchorRx, rx.rb:163 — pinned
 * by tests/format/anchor-spelling.test.ts). Accepts any id/reftext
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
  const normalized = `[[${node.id}, ${node.reftext.trimStart()}]]`;
  return BLOCK_ANCHOR.test(normalized)
    ? normalized
    : `[[${node.id},${node.reftext}]]`;
}
