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
import { isReaderConsumedLine } from "../../block-metadata.js";
import { parseAttrlist, type Attrlist } from "../attrlist.js";
import type { LocationIndex } from "../positions.js";
import type { LineKind } from "./classify.js";
import { heldMetadataNode } from "./frames.js";
import type { SourceLine } from "./split.js";

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
    if (node === undefined) return false;
    if (kind.kind === "attributeLine") {
      this.attrlist = parseAttrlist(line.text.slice(1, -1));
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
    this.pending = [];
    this.attrlist = undefined;
    return nodes;
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
    if (this.attrlist === undefined) return undefined;
    let transparent = true;
    for (const node of this.pending) {
      if (node.type === "blockAttributeList") transparent = true;
      else if (!isReaderConsumedLine(node)) transparent = false;
    }
    return transparent ? this.attrlist.style : undefined;
  }

  /**
   * The reader's own record of the annotation it is about to act on:
   * set iff the held run's LAST node is the attribute line — stricter
   * than actionableStyle's transparency on purpose, so the recorded
   * value equals the sibling BlockAttributeListNode's `value` by
   * construction and invariant (xi) can check the pairing on every
   * parse. Copied from the held NODE, never from the interior the
   * splitter rstripped, so the equality holds even on a
   * trailing-whitespace attribute line, where the two differ. (That
   * rstripped interior used to be published as `Attrlist.raw`; it was
   * deleted as unread, and this is the comment that says why it never
   * had a reader here.)
   * @returns the sibling-to-be's value, or undefined
   */
  annotation(): string | undefined {
    const last = this.pending.at(-1);
    return last?.type === "blockAttributeList" ? last.value : undefined;
  }
}
