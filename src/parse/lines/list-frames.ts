/**
 * How the reader's stack is searched for an open list.
 *
 * Split out of list-reader.ts by responsibility: this module answers the
 * two questions the stack has to answer for `read_lines_for_list_item`
 * (`is_sibling_list_item?` and "how many lists are open at this level").
 * list-reader.ts is the loop that reads them; list-item.ts is the
 * per-item state an open list frame carries (`Item`); frames.ts is where
 * `ListFrame`'s shape actually lives, as the "list" branch of `Frame` —
 * this file derives `ListFrame` from it rather than restating the
 * fields, so the two can never drift apart.
 *
 * A list is identified by its marker STYLE: `is_sibling_list_item?`
 * compares `resolve_list_marker` results, so `-` and `*` are different
 * lists while `<2>` continues a `<1>` list. Nesting depth is not part
 * of the identity — Asciidoctor derives nesting from where a marker
 * that is NOT a sibling appears, never from indentation.
 *
 * Nothing here scans backwards or reads the token history.
 */
import { EMPTY, LAST_ELEMENT, NEXT, NOT_FOUND } from "../../constants.js";
import type { Frame, ListHost } from "./frames.js";

/**
 * An open list and the item it is reading — `Frame`'s "list" branch,
 * under its own name for list-reader.ts and this file to spell out.
 */
export type ListFrame = Extract<Frame, Record<"kind", "list">>;

/**
 * Narrow a frame to a list frame.
 * @param frame - a frame off the stack, or undefined past its end
 * @returns whether it is an open list
 */
function isList(frame: Frame | undefined): frame is ListFrame {
  return frame?.kind === "list";
}

/**
 * The outermost list of the innermost run — the item Ruby's
 * `read_lines_for_list_item` is reading from the REAL reader while every
 * nested list is still just lines in its buffer.
 * @param reader - the reader that owns the stack
 * @returns the run's outermost frame
 */
export function outermostList(reader: ListHost): ListFrame {
  const frame = reader.stack.at(listRunBase(reader));
  if (!isList(frame)) {
    // Unreachable: every caller runs only while a list is open.
    throw new Error("list-reader called outside a list frame");
  }
  return frame;
}

/**
 * Stack index of the innermost list frame BELOW the top one (within
 * the run) whose item has a `+` pending — the item a line that ends
 * the nested lists above it attaches to.
 * @param reader - the reader that owns the stack
 * @returns the frame's stack index, or NOT_FOUND
 */
export function innermostActiveList(reader: ListHost): number {
  const { stack } = reader;
  const base = listRunBase(reader);
  for (
    let index = stack.length + LAST_ELEMENT + LAST_ELEMENT;
    index >= base;
    index -= NEXT
  ) {
    const frame = stack.at(index);
    if (isList(frame) && frame.item.continuation === "active") {
      return index;
    }
  }
  return NOT_FOUND;
}

/**
 * The innermost open list.
 * @param reader - the reader that owns the stack
 * @returns the top frame, narrowed
 */
export function innermostList(reader: ListHost): ListFrame {
  const frame = reader.topFrame();
  if (!isList(frame)) {
    // Unreachable: every caller runs only while a list is open.
    throw new Error("list-reader called outside a list frame");
  }
  return frame;
}

/**
 * Stack index of the outermost frame in the INNERMOST run of lists —
 * the depth at which "end every open list" stops.
 *
 * A non-list frame is a barrier: Ruby parses a delimited block from a
 * fresh, confined reader that never sees the lists enclosing the
 * block, so a line inside it can end only the lists opened inside it.
 * @param reader - the reader that owns the stack
 * @returns the depth to close down to
 */
export function listRunBase(reader: ListHost): number {
  const { stack } = reader;
  let { length: base } = stack;
  while (base > EMPTY && isList(stack.at(base + LAST_ELEMENT))) {
    base -= NEXT;
  }
  return base;
}

/**
 * The open list a marker is a sibling of, if any — the online form of
 * `is_sibling_list_item?`, asked of the whole ancestry at once because
 * Ruby asks it once per nested `read_lines_for_list_item` call.
 *
 * Searched over the innermost run of list frames only, for the reason
 * {@link listRunBase} gives.
 * @param reader - the reader that owns the stack
 * @param style - the marker style to match (`resolve_list_marker`)
 * @returns the frame's stack index, or NOT_FOUND
 */
export function findSiblingList(reader: ListHost, style: string): number {
  const { stack } = reader;
  const base = listRunBase(reader);
  for (let index = stack.length + LAST_ELEMENT; index >= base; index -= NEXT) {
    const frame = stack.at(index);
    // Style alone, no variant test: the three variants' style sets are
    // disjoint by construction. They come from `MARKER_STYLES` in
    // line-shapes.ts — unordered `\*{1,5}|-`, ordered `\.{1,5}`, and
    // callout, whose every marker collapses to the single
    // `CALLOUT_STYLE` (`<>`) because `resolve_list_marker` makes `<2>`
    // a sibling of `<1>`. No string is in two of those sets, so equal
    // styles mean the same list. The isList test only narrows the type
    // — every frame in the run is one.
    if (isList(frame) && frame.style === style) {
      return index;
    }
  }
  return NOT_FOUND;
}
