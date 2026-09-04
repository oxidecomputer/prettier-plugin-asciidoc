/**
 * The reader's held-back METADATA run — `parse_block_metadata_line`'s
 * state as one small object: the nodes waiting for the block they
 * annotate, and the parsed view of the held `[…]` line. Split from
 * reader.ts by responsibility (the reader owns the read position and
 * the block sequence; this owns only what is held), and because the
 * `max-lines` ceiling made the split mandatory rather than optional.
 *
 * Comment and preprocessor lines ride along with the metadata so their
 * SOURCE ORDER relative to it survives whatever lands between them
 * (see the `raw` case in reader.ts's blockLine).
 */
import type { BlockNode } from "../../ast.js";
import { isBlockMetadata, isReaderConsumedLine } from "../../block-metadata.js";
import { parseAttrlist, type Attrlist } from "../attrlist.js";
import {
  buildBlockAnchor,
  buildBlockAttributeList,
  buildBlockTitle,
  buildRawBlockLine,
} from "../build/metadata.js";
import type { Fragment, LocationIndex } from "../positions.js";
import type { LineKind } from "./classify.js";
import { fragmentOfLine, type SourceLine } from "./split.js";

// Line kinds `parse_block_metadata_line` claims, and the node each
// becomes: an anchor, an attribute list, a block title, and the
// comment/preprocessor lines the same scan consumes. An attribute
// ENTRY is deliberately absent: Ruby processes it as a document
// attribute where it stands, so it stays a leaf where it was
// written. This table is the one source of truth for which line
// kinds are held-back metadata.
const HELD_BUILDERS = new Map<
  LineKind["kind"],
  (line: Fragment, at: LocationIndex) => BlockNode
>([
  ["anchor", buildBlockAnchor],
  ["attributeLine", buildBlockAttributeList],
  ["blockTitle", buildBlockTitle],
  ["raw", buildRawBlockLine],
]);

/**
 * The node a held-back metadata line becomes once it is known what it
 * annotates: what `BlockReader.holdMetadata` in reader.ts holds and
 * releases.
 * @param kind - what the classifier made of the line
 * @param line - the line itself
 * @param at - the document's location index
 * @returns the node, or undefined when the line is not held-back
 *   metadata
 * Exported for its table-driven unit rows (tests/parser/frames.test.ts);
 * its one src caller is `hold` below.
 * @internal
 */
export function heldMetadataNode(
  kind: LineKind,
  line: SourceLine,
  at: LocationIndex,
): BlockNode | undefined {
  // The classifier judged the RSTRIPPED spelling (`line.text`), so
  // the builder has to take apart the same bytes: handing it the raw
  // span let `[NOTE]␠`'s `slice(1, -1)` cut the blank instead of the
  // `]` and store a value with the delimiter still in it (#69, #97).
  return HELD_BUILDERS.get(kind.kind)?.(
    fragmentOfLine(line, 0, line.text.length),
    at,
  );
}

/** The held-back run. One instance per BlockReader (reader.ts). */
export class HeldMetadata {
  // Metadata NODES held back until we know what they annotate.
  private pending: BlockNode[] = [];
  // Parsed view of the held-back `[…]` line, if any — set per
  // attribute line (the last one wins, as Ruby's drain overwrites
  // `attributes`), cleared by drain(). Every open decision reads it;
  // the line is parsed ONCE, by the single attrlist parser
  // (src/parse/attrlist.ts), and nothing downstream re-derives it.
  private attrlist: Attrlist | undefined = undefined;
  // Attribute lines this run already released, counted because the
  // run is NOT over: `parse_block_metadata_lines` (parser.rb:2014-2021)
  // keeps looping past lines this reader pushes as blocks of their own
  // (an attribute entry, a comment block), so `pending` can be empty
  // while the run Ruby would still be collecting goes on. Reset at
  // {@link blockJoined}, the one place a block that ENDS the run
  // reaches.
  private released = 0;

  /**
   * Hold one line's node back, when the line is one this run holds:
   * an anchor, an attribute list, a block title, or a riding
   * comment/preprocessor line.
   * @param line - the source line
   * @param kind - what the classifier made of it
   * @param at - the document's offset→Location index
   * @returns whether the line was held (the caller advances past it)
   */
  hold(line: SourceLine, kind: LineKind, at: LocationIndex): boolean {
    const node = heldMetadataNode(kind, line, at);
    if (node === undefined) {
      return false;
    }
    // The interior is read back off the node just built, which holds
    // exactly the bytes between the brackets: the line is taken apart
    // in ONE place, and the record and the sibling node cannot come to
    // spell it differently. Narrowed on the node, not on `kind`, so
    // the pairing does not rest on the builder table's routing.
    if (node.type === "blockAttributeList") {
      this.attrlist = parseAttrlist(node.value);
    }
    this.pending.push(node);
    return true;
  }

  /**
   * Release every held-back node, in source order, clearing the run.
   * @returns the nodes, for the caller to append
   */
  drain(): BlockNode[] {
    const nodes = this.pending;
    this.released += attributeLines(nodes);
    this.pending = [];
    this.attrlist = undefined;
    return nodes;
  }

  /**
   * A block joined the sequence: END the metadata run, unless it is a
   * line `parse_block_metadata_line` (parser.rb:2043-2089) claims for
   * itself and this reader nevertheless pushes as a block.
   *
   * SIX line kinds are metadata there: an anchor (:2047-2055), an
   * attribute list (:2056-2063), a block title (:2064-2070), a `//`
   * line (:2072-2073), a `////` comment block (:2074-2078) and an
   * attribute entry (:2083-2085); blank lines between them are
   * skipped and the loop goes on (:2018). Four of the six are held
   * back here and reach this method only as a drain releases them.
   * The other two do not: a comment block and an attribute entry are
   * pushed where they were written, which is what left the run
   * looking finished when it was not.
   *
   * A PREPROCESSOR DIRECTIVE is the seventh kind the guard tests and
   * is not one of the six: `parse_block_metadata_line` never sees
   * one, because the reader DELETES the line before the parser reads
   * it (`PreprocessorReader#process_line`, reader.rb:824). So it
   * cannot end a held run either, by a different mechanism and to the
   * same effect: the six are CLAIMED by the metadata loop, and this
   * one is GONE before the loop runs.
   * The kinds are tested here rather than delegated to
   * `isReaderConsumedLine` (src/block-metadata.ts) because that
   * predicate answers for a `//` line and a preprocessor directive
   * and NOT for a `////` comment block, which is one of the six.
   *
   * Called from the reader's one push site, so no dispatch arm can
   * forget it - the same guarantee the header-reachability bit takes
   * from sitting there.
   * @param node - the block that just joined the sequence
   */
  blockJoined(node: BlockNode): void {
    if (
      isBlockMetadata(node) ||
      node.type === "comment" ||
      node.type === "preprocessorDirective" ||
      node.type === "attributeEntry"
    ) {
      return;
    }
    this.released = 0;
  }

  /**
   * The held `[…]` line's style, RAW — no transparency guard. The one
   * consumer is the discrete-heading gate, which Ruby drains through
   * `parse_block_metadata_lines` before `next_section` reads the
   * title, attribute position notwithstanding.
   * @returns the style, or undefined when no attribute line is held
   */
  heldStyle(): string | undefined {
    return this.attrlist?.style;
  }

  /**
   * Whether the held `[...]` line names a STYLE - see
   * {@link Attrlist.styleAttribute}. The one consumer is the reader's
   * document-header reachability: a style above the document title
   * demotes it to a section (`[foo]`, `[NOTE]`, `[quote,Name]`),
   * while an id, a role, an option or a named attribute leaves the
   * header standing (`[#id]`, `[.role]`, `[%opt]`, `[separator=::]`).
   *
   * That demotion is the PINNED ORACLE's rule and not Ruby's: Ruby
   * 2.0.26 builds a header under `[foo]` too (parser.rb:132 bails on
   * a block title alone), and it is `@asciidoctor/core` 4.0.11 that
   * adds `|| blockAttrs.style` (src/parser.js:180). The oracle wins;
   * the sentence is here so the next reader does not align the code
   * to the Ruby and re-open issue #18.
   * @returns whether a style is held
   */
  holdsStyleAttribute(): boolean {
    return this.attrlist?.styleAttribute !== undefined;
  }

  /**
   * The held style, when the reader may ACT on it: the LAST held
   * attribute line's first positional, valid only while every held
   * node after that attribute line is reader-eaten (a raw
   * comment/directive line) — the transparency the deleted
   * `annotatedBlockIndex` scan implemented, applied BEFORE the open
   * instead of after the parse. The guard REPRODUCES the shape
   * observed today and never widens it. A held title or anchor after
   * the attribute line disables the style, pinned by the
   * characterization rows in tests/parser/block-masquerade.test.ts
   * and tests/parser/verbatim-styled.test.ts (the recorded
   * divergences from Ruby's own style handling, kept
   * byte-round-tripping). Written as a forward walk — the flag resets
   * at each attribute line, so it ends true exactly when the run's
   * tail is transparent — because architecture.test.ts bans
   * `findLast(` and `findLastIndex(` under src/parse.
   * @returns the style, or undefined when none is actionable
   */
  actionableStyle(): string | undefined {
    if (this.attrlist === undefined) {
      return undefined;
    }
    let transparent = true;
    for (const node of this.pending) {
      if (node.type === "blockAttributeList") {
        transparent = true;
      } else if (!isReaderConsumedLine(node)) {
        transparent = false;
      }
    }
    return transparent ? this.attrlist.style : undefined;
  }

  /**
   * The reader's own record of the annotation it is about to act on:
   * set iff the held run's LAST node is the attribute line — stricter
   * than actionableStyle's transparency on purpose, so the recorded
   * value equals the sibling BlockAttributeListNode's `value` by
   * construction and invariant (xi) can check the pairing on every
   * parse. Copied from the held NODE, which is the very string `hold`
   * hands `parseAttrlist` above. (That interior used to be published
   * as `Attrlist.raw`; it was deleted as unread, and this is the
   * comment that says why it never had a reader here.)
   * @returns the sibling-to-be's value, or undefined
   */
  annotation(): string | undefined {
    const last = this.pending.at(-1);
    return last?.type === "blockAttributeList" ? last.value : undefined;
  }

  /**
   * Whether the held run carried a block attribute line whose values
   * {@link annotation} does not carry: a SECOND attribute line, of
   * which only the last is recorded, or one standing behind a title,
   * an anchor or any other held node, which the last-node rule above
   * refuses outright.
   *
   * Asciidoctor has no such gap. `parse_block_metadata_lines`
   * (parser.rb:2014-2021) loops until the next line is not metadata
   * and accumulates every attribute line, title and anchor into ONE
   * attributes hash whatever their order - an anchor writes `id`, a
   * title writes `title`, an attribute line merges its own parse - and
   * the block that follows reads that hash. So where this answers
   * true, the block's attribute VALUES were resolved from less than
   * the author wrote, and a consumer that acts on them has to know it.
   *
   * Counted over the whole RUN and not over what is still pending:
   * an attribute entry or a comment block between the attribute line
   * and the block empties `pending` without ending the run, so the
   * count carries across a drain ({@link blockJoined} is what ends
   * it). One count answers both shapes and the second-attribute-line
   * one, because they are the same question asked once: was every
   * attribute line accounted for.
   * @returns whether an attribute line's values went unrecorded
   */
  unreadAttrlist(): boolean {
    const seen = this.released + attributeLines(this.pending);
    return seen > (this.annotation() === undefined ? 0 : 1);
  }
}

/**
 * How many block attribute lines a released run held.
 * @param nodes - the run's nodes, in source order
 * @returns the count
 */
function attributeLines(nodes: readonly BlockNode[]): number {
  let seen = 0;
  for (const node of nodes) {
    if (node.type === "blockAttributeList") {
      seen += 1;
    }
  }
  return seen;
}
