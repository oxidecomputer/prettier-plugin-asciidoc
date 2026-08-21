/**
 * Serializes inline AST nodes back to their AsciiDoc source
 * representation. Covers the unified InlineMacroNode, bare-URL
 * links, xref shorthands, and inline anchors. Shared by the
 * printer and the paragraph-form transformer.
 */
import type {
  InlineAnchorNode,
  InlineMacroNode,
  LinkNode,
  XrefNode,
} from "./ast.js";
import { EMPTY } from "./constants.js";

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
  return node.target.length === EMPTY
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
 * Serialize an inline anchor AST node back to AsciiDoc
 * source. Produces `[[id]]` or `[[id, reftext]]`
 * depending on whether optional reference text is present.
 * @param node - The parsed anchor with an id and
 *   optional reftext used as the default display text
 *   when another section references this anchor.
 * @returns AsciiDoc source string for the anchor.
 */
export function anchorToSource(node: InlineAnchorNode): string {
  return node.reftext === undefined
    ? `[[${node.id}]]`
    : `[[${node.id}, ${node.reftext}]]`;
}
