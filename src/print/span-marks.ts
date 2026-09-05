/**
 * Where a span's two MARKS go among the atoms its content produced.
 *
 * Split from inline.ts, which owns the walk over a block's inline
 * nodes; this module owns the one question that walk asks about a
 * span's own delimiters - fuse each mark onto the content atom beside
 * it, or stand it apart, or put it alone on the author's line. All
 * three answers write the same characters in the same order, so the
 * choice is about where the packer may BREAK and never about bytes.
 */
import { withBoundary, type Boundary, type Cursor } from "./atom-join.js";
import { atomOf, HARD_BREAK_IMAGE, type Atom } from "./reflow.js";
import { openMarkStandsApart } from "./block-start-hazard.js";

/**
 * Where a span's OPENING mark goes relative to the content atom beside
 * it.
 *
 * `"fused"` is the ordinary case: mark and first content atom become
 * one atom, which is what keeps them adjacent for AsciiDoc's
 * constrained formatting. The other two keep the mark as an atom of
 * its own and differ only in the join behind it - `"detached"` puts
 * the source's break there outright, `"apart"` puts the space the
 * fusion would have written and leaves the break to the block-start
 * hazard net.
 */
type OpenMarkPlacement = "fused" | "apart" | "detached";

/**
 * Where a span's marks go: the opening one's placement, and whether
 * the closing one must stand alone against a literal break. Split from
 * `appendSpan` (inline.ts) for the complexity ceiling.
 *
 * A RAW LINE at a span EDGE owns its output line, and a mark cannot
 * ride it: fusing the close onto a kept comment line writes `// c**`,
 * which the re-reader swallows into the comment, and the rendered
 * text loses the mark and everything behind it (measured on
 * `para\n** b\n// c\n** b`). The span keeps the SOURCE break on that
 * side instead - the mark stands alone against a literal break,
 * exactly where the author's line boundary was.
 *
 * Both edges reach this: the oracle deletes a raw line before the
 * quote pass, so a pair spans one and the delimiter beside it is the
 * one the reader records (quote-pass.ts). `**` / `// c` / `b** d` is
 * the open edge and `a **b` / `// c` / `** d` the close edge.
 *
 * The question is asked of the ATOM and not of the span's children,
 * because a child can stand between the raw line and the mark and
 * still produce no atom of its own: content whitespace becomes a
 * JOIN, so in `para` / `  ** z` / `// c` / `  ** z` the two spaces in
 * front of the closing mark are the span's last child and the raw
 * line's atom is still the one the close would fuse onto
 * ({@link Atom.ownsItsLine} is the fact, set where the raw line's atom
 * is built).
 *
 * At a BLOCK START the mark comes apart from the content without a
 * break behind it (see {@link openMarkStandsApart}): the two atoms pack
 * into the same bytes the fusion would have written, and the net that
 * can see the whole packed line decides afterwards whether the space
 * becomes the author's break. A raw-line edge outranks it, because
 * there the break is not a trade but the only legal placement.
 *
 * A HARD LINE BREAK last in the content owns its line END the same
 * way: `LineBreakRx` is `^(.*)[ \t]\+$`, so the ` +` must stay at the
 * end of a line to be a break at all, and fusing the close mark
 * behind it writes `b +**` - literal text, the `<br>` gone (measured
 * on `a **b +\n** c`). Detaching puts the close on the next line and
 * leaves the break where the author had it. The OPEN side needs
 * nothing there: a break that is not last has an atom behind it
 * carrying the literal join (`appendHardLineBreak`, inline.ts), and a `+` pushed
 * to column 0 would be a list continuation.
 * @param cursor - where the span sits.
 * @param inner - the span's content atoms.
 * @returns the two placements {@link pushSpanAtoms} takes.
 */
export function markPlacement(
  cursor: Cursor,
  inner: readonly Atom[],
): { openPlacement: OpenMarkPlacement; detachClose: boolean } {
  return {
    openPlacement: openMarkPlacement(cursor, inner),
    detachClose:
      inner.at(-1)?.ownsItsLine === true ||
      inner.at(-1)?.text === HARD_BREAK_IMAGE,
  };
}

/**
 * The opening mark's placement alone, split off so
 * {@link markPlacement} stays a flat pair of answers.
 * @param cursor - where the span sits.
 * @param inner - the span's content atoms.
 * @returns the placement.
 */
function openMarkPlacement(
  cursor: Cursor,
  inner: readonly Atom[],
): OpenMarkPlacement {
  if (inner[0].ownsItsLine) {
    return "detached";
  }
  // `glueLeft` on the first content atom is where `openSpace` came
  // from (see `appendSpan` (inline.ts)), so its negation is exactly "the
  // fusion writes a space the content's own whitespace stood for".
  return openMarkStandsApart(cursor, !inner[0].glueLeft) ? "apart" : "fused";
}

/**
 * Push a span's atoms with its marks placed: fused onto the edge
 * content atoms in the ordinary case, or standing as atoms of their
 * own where fusing would corrupt or would hide a break the net may
 * need (a raw-line edge, the block start, a hard line break last in
 * the content). Split from `appendSpan` (inline.ts) for the complexity
 * ceiling.
 * @param out - the block's atoms so far (mutated).
 * @param boundary - the join standing in front of the span.
 * @param inner - the span's content atoms (mutated: marks fuse on).
 * @param marks - how to place the two marks.
 * @param marks.openText - the open mark plus the space the content's
 *   leading whitespace became.
 * @param marks.closeText - the space the content's trailing
 *   whitespace became, plus the close mark.
 * @param marks.openPlacement - where the open mark goes
 *   ({@link OpenMarkPlacement}).
 * @param marks.detachClose - emit the close mark on its own line at
 *   column 0 instead of fusing it onto the last atom.
 */
export function pushSpanAtoms(
  out: Atom[],
  boundary: Boundary,
  inner: Atom[],
  marks: {
    openText: string;
    closeText: string;
    openPlacement: OpenMarkPlacement;
    detachClose: boolean;
  },
): void {
  const { openText, closeText, openPlacement, detachClose } = marks;
  const last = inner.length - 1;
  if (!detachClose) {
    inner[last] = { ...inner[last], text: `${inner[last].text}${closeText}` };
  }
  if (openPlacement === "fused") {
    inner[0] = { ...inner[0], text: `${openText}${inner[0].text}` };
    out.push(withBoundary(inner[0], boundary), ...inner.slice(1));
  } else {
    // `"apart"` writes the SPACE the fusion would have written, so the
    // packer measures and prints the same bytes and the net that reads
    // the whole packed line decides afterwards whether that space
    // becomes the author's break; `"detached"` writes the author's
    // break, where no other placement is legal.
    out.push(
      withBoundary(atomOf(openText.trimEnd()), boundary),
      withBoundary(inner[0], openPlacement === "apart" ? "space" : "literal"),
      ...inner.slice(1),
    );
  }
  if (detachClose) {
    out.push(withBoundary(atomOf(closeText.trimStart()), "literal"));
  }
}

/**
 * Emit a span whose children produced NO atoms: bare marks around the
 * whitespace they stood for. Split from `appendSpan` (inline.ts) for the
 * complexity ceiling. The block-start hazard net applies here too:
 * `**\n**` replayed as `** **` at column 0 is a ulist line, so at a
 * block start the two marks stay two atoms and the net puts the source
 * break between them.
 * @param out - the block's atoms so far (mutated).
 * @param boundary - the join standing in front of the span.
 * @param cursor - where the span sits.
 * @param parts - the marks and the space the content whitespace
 *   became.
 * @param parts.open - the opening mark.
 * @param parts.close - the closing mark.
 * @param parts.closeSpace - the space the whitespace-only content
 *   stands for ("" when there was none).
 */
export function appendWhitespaceOnlySpan(
  out: Atom[],
  boundary: Boundary,
  cursor: Cursor,
  parts: { open: string; close: string; closeSpace: string },
): void {
  const { open, close, closeSpace } = parts;
  // The whitespace this span held is all there is between the two
  // marks, so `closeSpace` is the whole fusion's space here.
  if (openMarkStandsApart(cursor, closeSpace !== "")) {
    out.push(
      withBoundary(atomOf(open), boundary),
      withBoundary(atomOf(close), "space"),
    );
    return;
  }
  out.push(withBoundary(atomOf(`${open}${closeSpace}${close}`), boundary));
}
