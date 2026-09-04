/**
 * Serializes inline AST nodes back to their AsciiDoc source
 * representation. Covers the unified InlineMacroNode, bare-URL
 * links, xref shorthands, and inline anchors. Consumed by the
 * printer (src/print/inline.ts).
 *
 * The bottom half is the printer's ONE entry into all of it:
 * {@link verbatimText}, which turns any {@link VerbatimNode} — the
 * four constructs above, plus attribute references, character
 * references, escaped marks and passthroughs, into the single line
 * the atom packer measures. It sits here rather
 * than in inline.ts because it is serialization, and because
 * inline.ts is at the max-lines limit.
 */
import type {
  AttributeReferenceNode,
  CharacterReferenceNode,
  EscapedMarkNode,
  InlineAnchorNode,
  InlineMacroNode,
  LinkNode,
  PassthroughNode,
  XrefNode,
} from "../ast.js";
import { canonicalAttrlist } from "../parse/attrlist.js";
import {
  ASCII_HORIZONTAL_WHITESPACE,
  ASCII_WHITESPACE,
  BLOCK_ANCHOR,
} from "../parse/line-shapes.js";

/**
 * The inline macros whose brackets Asciidoctor hands to
 * `AttributeList` — the only ones the attrlist spacing rule may
 * touch.
 *
 * It is a SHORT list because most inline macros put TEXT between the
 * brackets, and text is content: `link:u[Read, now]` and
 * `xref:t[the, text]` render the comma-space into the anchor,
 * `pass:[a, b]`, `stem:[a, b]`, `latexmath:[a, b]` and
 * `asciimath:[a, b]` pass it through verbatim, `kbd:[Ctrl, T]` and
 * `btn:[OK, now]` label with it, and `footnote:[a, b]` is the
 * footnote's own prose. Each of those was measured against the oracle
 * and each renders DIFFERENTLY once the blank goes, which is what
 * keeps them off this list. `image:` is the one name left — the
 * positional `[alt, width, height]` list — and it renders identically
 * either way. (`icon:` is the same kind of list and would join it,
 * but the tokenizer does not know the name: src/parse/inline/
 * rules.ts's macro alternation is the roster, and this set is a
 * SUBSET of it by construction.)
 */
const ATTRLIST_MACROS = new Set(["image"]);

/**
 * Serialize a unified inline macro node back to AsciiDoc
 * source as `name:target[attrlist]`. Handles every macro name
 * src/parse/inline/rules.ts's `MACRO_NAMES` lists (link, mailto,
 * xref, image, icon, kbd, btn, menu, footnoteref, footnote, pass,
 * stem, latexmath, asciimath) uniformly.
 * @param node - The parsed inline macro with name, target,
 *   and raw attrlist content.
 * @returns AsciiDoc source string for the macro.
 */
function inlineMacroToSource(node: InlineMacroNode): string {
  const attrlist = ATTRLIST_MACROS.has(node.name)
    ? canonicalAttrlist(node.attrlist)
    : node.attrlist;
  // One template for both: an empty target interpolates to nothing,
  // which is the same `name:[attrlist]` the split arm wrote by hand.
  return `${node.name}:${node.target}[${attrlist}]`;
}

/**
 * Serialize a bare-URL link AST node back to AsciiDoc source.
 * Handles `https://example.com` (no bracket group at all),
 * `https://example.com[]` (an empty group, which is what ends the
 * target) and `https://example.com[label]`. The three are the three
 * states of {@link LinkNode#text}, and each keeps its own bytes. Only
 * used for the `"url"` form — macro-form links are now
 * InlineMacroNode.
 * @param node - The parsed link with target and its bracket group's
 *   interior. Form is always `"url"`.
 * @returns AsciiDoc source string for the bare URL.
 */
function linkToSource(node: LinkNode): string {
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
function xrefToSource(node: XrefNode): string {
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

/**
 * Serialize a bibliography anchor AST node (`form: "bibliography"`)
 * back to AsciiDoc source: id and reftext rejoined around a bare
 * comma, with NO comma-space normalization - unlike
 * {@link anchorToSource}, which respells a valid id's
 * `[[id,reftext]]` as `[[id, reftext]]`.
 *
 * Two-bracket anchors can take that normalization for free because
 * `reftext` never reaches the HTML output at all (it feeds only
 * `xreflabel`, an attribute a different backend reads). A bibliography
 * anchor's reftext IS the rendered citation text: `InlineBiblioAnchorRx`
 * captures it as its own second group (rx.rb l.457), and
 * substitutors.rb's `.sub` on that same pattern builds the `Inline`
 * node straight from the captured groups (substitutors.rb l.715) that
 * the oracle then prints as `[reftext]` (measured, converter source
 * not vendored here). Ruby's separator is LITERAL spaces only (rx.rb
 * l.457's `, *` quantifies a space character, not `\s`), so a
 * canonical single space is safe after a run of spaces but wrong
 * after anything else - a tab right after the comma is not
 * separator, it is the reftext's own first character (measured:
 * `[[[id,\t1]]]` renders `[<TAB>1]`, not `[<TAB> 1]` or `[1]`).
 * Verbatim replay sidesteps that whole class of near-miss respells by
 * never attempting one: since the id/reftext split
 * ({@link splitAnchor}, inline-link-builder.ts) always cuts at the
 * first comma, rejoining around one always reproduces the author's
 * exact interior, for every id and every reftext - pinned by
 * tests/format/anchor-spelling.test.ts's own
 * "bibliography anchors print the author's interior verbatim" suite.
 * @param node - The parsed anchor with an id and optional verbatim
 *   reftext.
 * @returns AsciiDoc source string for the bibliography anchor.
 */
function bibliographyAnchorToSource(
  node: Pick<InlineAnchorNode, "id" | "reftext">,
): string {
  return node.reftext === undefined
    ? `[[[${node.id}]]]`
    : `[[[${node.id},${node.reftext}]]]`;
}

// A construct the printer emits verbatim, never breaking inside it —
// the argument {@link verbatimText} takes. Not exported: the printer
// reaches these nodes through that one function, never through the
// type.
type VerbatimNode =
  | AttributeReferenceNode
  | CharacterReferenceNode
  | InlineMacroNode
  | LinkNode
  | XrefNode
  | InlineAnchorNode
  | EscapedMarkNode
  | PassthroughNode;

/**
 * Collapse source line breaks inside a serialized inline
 * construct to single spaces. Bracketed text (`url[text]`,
 * `xref:t[text]`, `<<t,text>>`) may span source lines — the
 * tokenizer's `InlineMacro`/`InlineUrl` rules
 * (src/parse/inline/rules.ts) match it across `\n`. Re-emitting the
 * raw newline would make the output layout depend on the input
 * layout (breaking idempotency, issue #1) and an atom's text must be
 * newline-free for the packer to measure it.
 * AsciiDoc renders the line break as a space, so this rewrite
 * is semantics-preserving; intra-line spacing is left alone.
 * Exception: a line ending in ` +` is a hard line break —
 * joining it would drop the break and expose a literal `+`, so
 * sources containing one are returned unchanged (their layout
 * stays source-dependent, matching pre-issue-#1 behavior).
 * @param source - Serialized AsciiDoc source for an atomic
 *   inline construct (link, macro, xref, anchor).
 * @returns The source with each newline run (including any
 *   surrounding indentation whitespace) replaced by one space,
 *   or unchanged when a hard line break is present.
 */
function collapseSourceNewlines(source: string): string {
  if (source.includes(" +\n")) {
    return source;
  }
  return joinSourceLines(source);
}

// A run of newlines - and the ASCII whitespace around them - that
// joinSourceLines collapses to one space. ASCII only (ASCII_WHITESPACE,
// ASCII_HORIZONTAL_WHITESPACE, issue #75): a no-break space beside a
// join a multi-line macro or link text takes is content the construct
// carries, not indentation the reader would have consumed.
const SOURCE_LINE_JOIN = new RegExp(
  `${ASCII_HORIZONTAL_WHITESPACE.source}*\n${ASCII_WHITESPACE.source}*`,
  "gv",
);

/**
 * Replace each newline run — and the whitespace around it — with one
 * space. The rewrite {@link collapseSourceNewlines} performs once its
 * hard-break exception has not fired, split out because the
 * PASSTHROUGH case needs the rewrite without the exception: a ` +` in
 * passthrough content is content, not a break (the passthrough is
 * already out of the line by the time `sub_post_replacements` looks
 * for one), so keeping the newline there would put a newline inside an
 * atom — which the packer measures as one line and prints as two.
 * @param source - Serialized AsciiDoc source for one inline construct.
 * @returns The source on a single line.
 */
function joinSourceLines(source: string): string {
  return source.replaceAll(SOURCE_LINE_JOIN, " ");
}

// A passthrough whose content Asciidoctor substitutes NOTHING into:
// `extract_passthroughs` gives the `+++` boundary `subs: []`, and
// every other spelling - `$$` among them - `BASIC_SUBS`
// (substitutors.rb l.1049). The optional attrlist is the one the two
// pass patterns take (src/parse/inline/passthrough.ts).
const RAW_PASSTHROUGH = /^(?:\[[^\[\]]+\])?\+\+\+/v;

/**
 * One passthrough's output text: its own bytes, with the source's
 * line breaks kept ONLY where they can still be seen in the render.
 *
 * `+text+`, `++text++` and `$$text$$` carry `BASIC_SUBS`, so their
 * content reaches the backend as escaped character data inside flowed
 * text, where a newline and a space are the same thing to the
 * renderer; collapsing costs nothing and buys an atom the packer can
 * measure (the invariant {@link joinSourceLines} states). It is also
 * the oracle-pinned answer for the one shape where the two rules could
 * disagree: `+a +\nb+` renders `a + b`.
 *
 * `+++text+++` carries NO subs at all. Its bytes are copied into the
 * backend output verbatim, so a newline inside one can be structure
 * the render keeps — `+++<pre>a\nb</pre>+++` emits a real `<pre>`,
 * where the line break is the content. Those bytes are therefore
 * returned untouched, the way {@link collapseSourceNewlines} returns
 * a hard break's line untouched, and for the same reason: the layout
 * of a construct whose layout is meaningful stays the author's. The
 * cost is the one that exception already carries — the atom holds a
 * newline, so the packer measures it as one line and prints it as
 * two, and the block's continuation indent does not reach the second.
 * @param node - the passthrough node.
 * @returns its output bytes.
 */
function passthroughText(node: PassthroughNode): string {
  return RAW_PASSTHROUGH.test(node.value)
    ? node.value
    : joinSourceLines(node.value);
}

/**
 * The verbatim text of a source-preserved construct: these nodes are
 * emitted from the AST without reformatting, because their internal
 * syntax (URLs, target IDs, key combos, menu paths, etc.) is opaque to
 * the printer — changing whitespace or line breaks would alter
 * semantics or break rendering.
 * @param node - the construct.
 * @returns its one-line source text.
 */
export function verbatimText(node: VerbatimNode): string {
  switch (node.type) {
    case "attributeReference": {
      return `{${node.name}}`;
    }
    // The author's own bytes, with no collapse to run: a character
    // reference holds no whitespace at all (replacements.ts), so there
    // is no source line break inside one for joinSourceLines to find.
    case "characterReference": {
      return node.value;
    }
    case "inlineMacro": {
      return collapseSourceNewlines(inlineMacroToSource(node));
    }
    case "link": {
      return collapseSourceNewlines(linkToSource(node));
    }
    case "xref": {
      // Defense-in-depth: the XrefShorthand and InlineAnchor token
      // patterns exclude `\n`, so today these nodes can never contain a
      // newline — only InlineUrl and InlineMacro match across lines. The
      // collapse is kept so a future pattern change cannot silently
      // reintroduce multi-line output.
      return collapseSourceNewlines(xrefToSource(node));
    }
    case "inlineAnchor": {
      return collapseSourceNewlines(
        node.form === "bibliography"
          ? bibliographyAnchorToSource(node)
          : anchorToSource(node),
      );
    }
    // Both bytes, and no collapse to run: an escaped mark is a
    // backslash and one mark character, so it holds no whitespace and
    // no source line break for joinSourceLines to find. Emitting only
    // the mark would build the span the author escaped.
    case "escapedMark": {
      return node.value;
    }
    case "passthrough": {
      return passthroughText(node);
    }
  }
}
