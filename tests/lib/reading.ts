/**
 * The REFLOW RE-CLASSIFICATION INVARIANT (issue #58): formatting may
 * move where a line breaks, never what a line IS.
 *
 * A document's READING is the sequence of verdicts the production
 * classifier hands the reader while `parse` runs, projected to a token
 * stream that legitimate reflow cannot change. The invariant is
 * sequence equality:
 *
 *     readingOf(format(d))    == readingOf(d)
 *     readingOf(format^2(d))  == readingOf(format(d))   when bytes moved
 *
 * The oracle here is OUR OWN reader, traced through
 * `setClassifyObserver` (src/parse/lines/classify.ts) rather than
 * re-derived: a test-owned context tracker would be a second reader
 * dialect that drifts, and the whole point is to assert against the
 * reader's own reading. Everything below is either a recorded verdict
 * or a documented projection rule, and every projection rule names
 * the format test that declares its transform deliberate - a rule
 * without such a license would be a hazard the net has been told to
 * ignore.
 *
 * WHAT THIS IS NOT. It is not an AST comparison (that converges on
 * render-equality without the oracle's authority, and points at a
 * subtree rather than a line), and it is not per-line provenance (the
 * printer does not track which source line an output line came from).
 * Sequence equality over a reflow-invariant projection proves the
 * same theorem: a join or split that manufactures a structural
 * reading, destroys one, or re-kinds one moves the sequence; a join
 * or split inside prose does not.
 *
 * WHAT IT CANNOT SEE, measured rather than assumed: divergence
 * visible only to Asciidoctor's own reading (issue #57's five
 * allowlisted instances), intra-line whitespace (issue #32), and
 * blank-line placement (issue #54) - see docs/harnesses.md.
 */
import { formatAdoc } from "../helpers.js";
import { rstrip } from "../../src/parse/line-shapes.js";
import {
  attributeContinuation,
  isContinuationLine,
  parseListMarker,
  setClassifyObserver,
  type LineKind,
} from "../../src/parse/lines/classify.js";
import { frontMatterExtent } from "../../src/parse/lines/front-matter.js";
import { documentBom, splitLines } from "../../src/parse/lines/split.js";
import { parse } from "../../src/parser.js";

/**
 * One parse's raw trace: the LAST verdict recorded per source offset.
 *
 * Last-wins is what makes the trace the reader's ACTED-ON reading: a
 * line classified speculatively during a lookahead and again in its
 * final context keeps the final verdict. Offsets stay document-global
 * through confined readers, which slice the same SourceLine objects
 * rather than re-splitting a substring.
 * @param document - the document to parse
 * @returns the verdict per source offset
 */
function traceOf(document: string): Map<number, LineKind> {
  const events = new Map<number, LineKind>();
  setClassifyObserver((offset, kind) => {
    events.set(offset, kind);
  });
  try {
    parse(document);
  } finally {
    setClassifyObserver(undefined);
  }
  return events;
}

/**
 * Project one recorded verdict to its token, or undefined for a blank.
 *
 * The token keeps the payload the reading depends on and drops the
 * spelling the formatter is licensed to change. Two folds happen
 * here, each with its license:
 *
 * - a `raw` anchor folds onto `anchor`: a `[[id]]` read as a raw line
 *   inside a paragraph and one read as block metadata are one reading
 *   for our purposes, and the serializer's spelling contract is
 *   pinned by tests/format/anchor-spelling.test.ts;
 * - an attribute entry lowercases its name: the printer spells
 *   attribute names lowercase (Asciidoctor downcases them on the way
 *   in), pinned by tests/format/attribute-entry.test.ts.
 *
 * A list marker folds NOTHING: it projects its variant AND its style,
 * because the style is what tells `*` from `**` - that is, what tells
 * an item from the nested item under it. A projection that kept only
 * the variant read a flattened nesting as no change at all, which is
 * exactly the corruption class the sweep alphabet spells `* a` and
 * `** b` to catch. There is nothing to license away: marker spellings
 * are data the printer replays byte for byte
 * (tests/format/marker-spelling.test.ts), so both readings carry the
 * same spelling. The style is Ruby's RESOLVED one, which is the fact
 * that decides structure and so the fact this check is about - `5.`
 * and `6.` project alike because they really are one list, and no
 * transform the formatter makes can reach that collapse.
 *
 * `textv` - the verbatim-flagged foreign marker line - stays a token
 * of its own rather than folding onto `text`. Its COLUMN is
 * load-bearing (it decides what the next `+` means), so its
 * disappearance has to move the sequence.
 * @param kind - one recorded verdict
 * @returns the token, or undefined when the line is blank
 */
function tokenOf(kind: LineKind): string | undefined {
  switch (kind.kind) {
    case "blank": {
      return undefined;
    }
    case "text": {
      return kind.verbatim === true ? "textv" : "text";
    }
    case "raw": {
      return kind.form === "anchor" ? "anchor" : `raw:${kind.form}`;
    }
    case "indented": {
      return "indented";
    }
    case "sectionTitle": {
      return `section:${String(kind.level)}`;
    }
    case "listMarker": {
      return `marker:${kind.variant}:${kind.style}`;
    }
    case "dlistTerm": {
      return `dlist:${kind.delimiter}`;
    }
    case "delimiterOpen": {
      return `delim:${kind.block}`;
    }
    case "admonitionLabel": {
      return `admon:${kind.label}`;
    }
    case "attributeEntry": {
      return `attrentry:${kind.name.toLowerCase()}${kind.unset ? "!" : ""}`;
    }
    case "blockMacro": {
      return `macro:${kind.name}`;
    }
    case "continuation": {
      return "cont";
    }
    case "anchor": {
      return "anchor";
    }
    case "attributeLine": {
      return "attrline";
    }
    case "blockTitle": {
      return "title";
    }
    case "thematicBreak": {
      return "break:thematic";
    }
    case "pageBreak": {
      return "break:page";
    }
  }
}

/** What one physical line contributes to the reading. */
type LineContribution =
  | {
      /** The line has a reading. */
      readonly kind: "token";
      /** Its normalized token. */
      readonly token: string;
    }
  | {
      /** A blank line: no token, and it ENDS any fold (see append). */
      readonly kind: "blank";
    }
  | {
      /**
       * A line the reader consumed without classifying and without a
       * marker shape - a delimited-block interior, a
       * literal-paragraph body line, a front-matter line, or a line
       * an attribute entry's value ran onto. Invisible to the
       * reading, and it ends no fold, because the reader never read
       * it as structure.
       */
      readonly kind: "opaque";
    };

/**
 * What one physical line contributes, from the trace and the text.
 *
 * A line with no recorded verdict is one the reader consumed without
 * classifying. Two shapes are SYNTHESIZED rather than left invisible,
 * and it is one fact about the reader that makes both necessary: the
 * list extent scan takes sibling and nested marker lines through
 * `parseListMarker` and continuation lines through
 * `isContinuationLine`, and neither of those is a `classifyLine`
 * call.
 *
 * - A MARKER line, because the fold-absorption rule below has to be
 *   able to see an absorber.
 * - A lone `+`, because a continuation is the whole difference
 *   between an item that owns the block below it and one that does
 *   not. Left opaque, every `+` the extent scan consumed was
 *   invisible here, so a formatter that dropped one, moved one across
 *   a boundary, or dissolved one into the prose beside it moved no
 *   token and the invariant held VACUOUSLY. That blindness is why
 *   `lone-plus-join` could sit in the family enumeration as a
 *   declared mechanism with no rows: the rows were always there, the
 *   alphabet had no letter to spell them with.
 *
 * Synthesis is a modeled guess rather than a recorded reading; inside
 * a verbatim interior the same guess is made on both sides of the
 * comparison and cancels, and `untracedLines` bounds what else it can
 * be hiding.
 * @param events - the trace, keyed by source offset
 * @param offset - this line's source offset
 * @param line - this line, rstripped the way the reader rstrips it
 * @returns the contribution
 */
function contributionOf(
  events: ReadonlyMap<number, LineKind>,
  offset: number,
  line: string,
): LineContribution {
  // Before the verdict, not after it: a `+` the reader ERASED comes
  // back from `classifyLine` as a blank, and taking that verdict at
  // face value is the second half of the same blindness - the line is
  // still a `+` in the source, and whether the formatter keeps it is
  // exactly the question. Every lone `+` gets a token; no verdict
  // folds one away.
  if (isContinuationLine(line)) {
    return { kind: "token", token: "cont" };
  }
  const kind = events.get(offset);
  if (kind !== undefined) {
    const token = tokenOf(kind);
    return token === undefined ? { kind: "blank" } : { kind: "token", token };
  }
  if (line.length === 0) {
    return { kind: "blank" };
  }
  const marker = parseListMarker(line);
  return marker === undefined
    ? { kind: "opaque" }
    : { kind: "token", token: `marker:${marker.variant}:${marker.style}` };
}

/**
 * Where the fold stands after the token just appended.
 *
 * `armed`: the last token's own line carries principal text that
 * later source lines legitimately fold into. `textrun`: a prose run
 * is open and further text lines join it. `indentedrun`: a literal
 * paragraph's body is open and further indented lines join it.
 * `none`: the next text or indented line opens a run of its own.
 *
 * A blank line resets this to `none`, which is what keeps the runs
 * BLOCK-scoped: two literal paragraphs with a blank between them are
 * two blocks and must read as two tokens, or deleting one of them
 * would be invisible.
 */
type FoldMode = "armed" | "textrun" | "indentedrun" | "none";

/**
 * Tokens whose line carries principal text a later line folds into.
 *
 * `* a` / `X` formatting to `* a X` is ordinary reflow, not a reading
 * change (tests/format/unordered-list.test.ts, "short flush
 * continuation is reflowed"); the same is true of an admonition label
 * (tests/format/admonition.test.ts reflows a long `NOTE:`) and of a
 * description-list term line, which will produce the same join when
 * issue #9 parses dlists.
 * @param token - the token just projected
 * @returns whether a following text run is absorbed into it
 */
function absorbsText(token: string): boolean {
  return (
    token.startsWith("marker:") ||
    token.startsWith("dlist:") ||
    token.startsWith("admon:")
  );
}

/**
 * A reading under construction: the tokens, and the source line each
 * token was projected from.
 *
 * The lines are carried so a breach can say WHERE. A signature names
 * the tokens that moved, which is enough for a six-line sweep
 * document and not enough for a corpus document of several hundred
 * lines.
 */
interface ReadingBuilder {
  /** The tokens so far. */
  readonly tokens: string[];
  /** For each token, the 1-based source line it came from. */
  readonly lines: number[];
  /** The 1-based line being projected right now. */
  line: number;
}

/**
 * Push one token, recording the line it came from.
 * @param reading - the reading under construction
 * @param token - the token to record
 */
function emit(reading: ReadingBuilder, token: string): void {
  reading.tokens.push(token);
  reading.lines.push(reading.line);
}

/**
 * Append one token to the reading, applying the reflow-invariance
 * rules, and report the fold state that follows it.
 *
 * The rules, and the transform each one is licensed to hide:
 *
 * - consecutive `text` tokens collapse to one. A paragraph is ONE
 *   reading however many lines it wraps to
 *   (tests/format/reflow.test.ts).
 * - a text run directly after an absorbing token is swallowed by it
 *   (see {@link absorbsText}).
 * - `raw:comment` is transparent to a fold: the reader deletes comment
 *   lines, so a comment interrupts no join
 *   (tests/format/comment.test.ts).
 * - consecutive `indented` tokens collapse to one WITHIN one block. A
 *   literal paragraph's body is one reading however many lines it
 *   spans (tests/format/literal-paragraph.test.ts, "multiple indented
 *   lines preserved") - but the collapse is gated on the fold mode,
 *   not on the last token, so a blank line ends it: two literal
 *   paragraphs are two blocks, and deleting one of them has to move
 *   the sequence. The reader hands back `indented` for the line that
 *   STARTS a literal body and reads the body's remaining lines as
 *   text, so what this rule mostly does is scope the run; it stays
 *   shaped like the text run's so a reader that classified more of the
 *   body would fold the same way.
 * - `delim:fencedCode` canonicalizes to the PAIR
 *   `attrline delim:listing`: the printer respells a fenced block as
 *   `[source,...]` + `----` (tests/format/fenced-code.test.ts), so the
 *   source side is projected to what the output will read. The
 *   `attrline` is the fence's OWN, and is emitted unconditionally -
 *   the printer emits one whatever precedes the fence, so a `[role]`
 *   line before it is a second attrline on both sides rather than the
 *   fence's.
 *
 * A blank line is handled by the caller and ends every fold. Blank
 * INSERTION and collapse are owned by the idempotence and
 * render-equality nets, not by this one: a gap-sensitive variant was
 * measured and floods with deliberate gap normalization
 * (docs/harnesses.md).
 * @param reading - the reading built so far, appended to in place
 * @param token - the token this line projects to
 * @param mode - the fold state the previous line left
 * @returns the fold state after this line
 */
function append(
  reading: ReadingBuilder,
  token: string,
  mode: FoldMode,
): FoldMode {
  if (token === "text") {
    if (mode === "armed" || mode === "textrun") {
      return mode;
    }
    emit(reading, token);
    return "textrun";
  }
  if (token === "raw:comment") {
    emit(reading, token);
    return mode;
  }
  if (token === "indented") {
    if (mode === "indentedrun") {
      return mode;
    }
    emit(reading, token);
    return "indentedrun";
  }
  if (token === "delim:fencedCode") {
    emit(reading, "attrline");
    emit(reading, "delim:listing");
    return "none";
  }
  emit(reading, token);
  return absorbsText(token) ? "armed" : "none";
}

/**
 * The document's reading, with the source line behind each token.
 *
 * The walk starts AFTER any byte-order mark, because `splitLines`
 * does (src/parse/lines/split.ts): the mark is skipped rather than cut
 * out, so the first line's offset is the mark's width and a walk
 * starting at zero would miss the trace's very first key - and a
 * marked document's whole first line would fall through to `opaque`
 * and vanish from the reading.
 * @param document - the document to read
 * @returns the tokens and the line each came from
 */
function projectionOf(document: string): ReadingBuilder {
  const events = traceOf(document);
  const bom = documentBom(document);
  const reading: ReadingBuilder = { tokens: [], lines: [], line: 1 };
  let mode: FoldMode = "none";
  let offset = bom.length;
  for (const rawLine of document.slice(bom.length).split("\n")) {
    const contribution = contributionOf(events, offset, rstrip(rawLine));
    offset += rawLine.length + 1;
    if (contribution.kind === "blank") {
      mode = "none";
    } else if (contribution.kind === "token") {
      mode = append(reading, contribution.token, mode);
    }
    reading.line += 1;
  }
  return reading;
}

/**
 * The document's reading: one token per line that has one, in source
 * order, with the reflow-invariance rules applied.
 * @param document - the document to read
 * @returns the projected token sequence
 */
export function readingOf(document: string): string[] {
  return projectionOf(document).tokens;
}

/**
 * The suffix an attribute entry at this offset leaves open, when it
 * has one.
 *
 * An entry whose value ends in ` \` (or the legacy ` +`) reaches past
 * its own line, and the lines it reaches over are consumed by the
 * entry's extent (src/parse/lines/attribute-entry.ts) rather than
 * classified - the same way a delimited block's interior is. They are
 * therefore opaque with a REASON, and this is what {@link
 * untracedLines} reads to tell them from a line nothing accounted
 * for.
 * @param events - the trace, keyed by offset
 * @param offset - the line's offset
 * @returns the suffix the entry's value ends with, or undefined
 */
function continuationSuffixAt(
  events: ReadonlyMap<number, LineKind>,
  offset: number,
): string | undefined {
  const kind = events.get(offset);
  return kind?.kind === "attributeEntry"
    ? attributeContinuation(kind.value)?.suffix
    : undefined;
}

/**
 * The suffix still open BELOW this line: the one an entry standing on
 * it opens, or the one carried down from above while the line
 * repeats it. A blank line closes the run, as
 * `process_attribute_entry`'s `while` does.
 * @param events - the trace, keyed by offset
 * @param offset - the line's offset
 * @param line - the rstripped line
 * @param carried - the suffix open OVER this line, if any
 * @returns the suffix open below it, or undefined
 */
function continuationBelow(
  events: ReadonlyMap<number, LineKind>,
  offset: number,
  line: string,
  carried: string | undefined,
): string | undefined {
  const opened = continuationSuffixAt(events, offset);
  if (opened !== undefined) {
    return opened;
  }
  return carried !== undefined && line !== "" && line.endsWith(carried)
    ? carried
    : undefined;
}

/**
 * The TRACE-FIDELITY self-check: lines the reader consumed without
 * leaving a verdict, in a document where every line should have one.
 *
 * Last-wins-per-offset assumes offsets survive confined readers and
 * that a line's final classification is the acted-on one. A reader
 * refactor could silently break that, and silent under-tracing would
 * make the net quietly weaker rather than red - so it is measured.
 *
 * HONEST BOUND, and it is why this is a self-check and not a gate on
 * the formatter: a delimited block's interior and a literal
 * paragraph's body are legitimately unclassified - the extent scan
 * collects them before classification runs - and telling those lines
 * apart from an under-traced one needs a second reader dialect, which
 * this module refuses to grow. So the check runs only on documents
 * whose reading opens no delimited block and starts no literal
 * paragraph; there, every non-blank line must carry a verdict or be
 * one of the two shapes `contributionOf` synthesizes. Documents with
 * either token report nothing.
 *
 * There is no `+` EXEMPTION here any more, and its disappearance
 * changes nothing this check reports. A lone `+` used to be named and
 * excused at this test; it is now accounted for the same way a marker
 * line is, by having a token - `contributionOf` gives it one before
 * the trace is read, so it is never `opaque` and never reaches the
 * test to be excused. The exemption went away because it became
 * unreachable, not because the check grew teeth: an untraced `+` is
 * still not reported here, one step earlier. What the token buys is
 * paid out in the PROJECTION, where a dropped `+` now moves the
 * sequence. Measured across the corpus and both sweep products, a
 * continuation and a marker are the only lines the reader consumes
 * without a verdict outside a delimited extent, a literal body, a
 * document's front matter and the lines an attribute entry's value
 * runs onto - and those last two are excused by their own extent
 * rather than by the document, so a line past either is still
 * reported.
 *
 * That measurement is a GATE at all three scales - the generator
 * sweeps both products, tests/format/reading-invariant.test.ts runs
 * this over the format fixtures and over every corpus case. The
 * corpus half is there because it was once missing: the sweep
 * alphabet spells no byte-order mark, so the one document that opens
 * with one went unchecked, and its whole first line was falling
 * through to `opaque`.
 * @param document - the document to check
 * @returns the unaccounted lines, empty when the trace is complete
 */
export function untracedLines(document: string): string[] {
  const reading = readingOf(document);
  const opaqueAllowed = reading.some(
    (token) => token.startsWith("delim:") || token === "indented",
  );
  if (opaqueAllowed) {
    return [];
  }
  const events = traceOf(document);
  const missed: string[] = [];
  // Past the byte-order mark, for {@link projectionOf}'s reason.
  const bom = documentBom(document);
  let offset = bom.length;
  // The suffix an attribute entry left open over THIS line, if any -
  // carried forward exactly as far as the entry's own extent reaches,
  // so the lines its value runs onto are excused and the first line
  // past them is not.
  let openSuffix: string | undefined = undefined;
  // The document's front matter, in lines. Its `---` fences and the
  // YAML between them are read by the document reader before any line
  // is classified (src/parse/lines/front-matter.ts), so they are
  // opaque with a reason, the way a delimited block's interior is.
  const front = frontMatterExtent(splitLines(document)) ?? 0;
  let index = 0;
  for (const rawLine of document.slice(bom.length).split("\n")) {
    const line = rstrip(rawLine);
    const inFrontMatter = index < front;
    index += 1;
    const contribution = contributionOf(events, offset, line);
    // Annotated, not inferred: the assignment below reads this
    // binding, so leaving it to inference asks the checker to type an
    // expression in terms of itself.
    const continued: string | undefined = openSuffix;
    openSuffix = continuationBelow(events, offset, line, continued);
    offset += rawLine.length + 1;
    if (
      contribution.kind === "opaque" &&
      continued === undefined &&
      !inFrontMatter
    ) {
      missed.push(line);
    }
  }
  return missed;
}

/** Where two readings first differ, and how. */
interface ReadingDiff {
  /**
   * The index of the first differing token - the length of the common
   * prefix. Meaningless when {@link ReadingDiff.signature} is empty.
   */
  readonly at: number;
  /** `[a b] -> [c]`, or "" when the two readings are equal. */
  readonly signature: string;
}

/**
 * The difference between two readings: strip the longest common
 * prefix and suffix, show the middles, and keep the index the strip
 * stopped at.
 *
 * Localization is half the point of sequence equality - a violation
 * names the exact tokens that changed rather than "the trees differ".
 * The index is what lets a caller turn that into a LINE: the tokens
 * alone are enough to read a six-line sweep document and not enough
 * to find the spot in a corpus document of several hundred lines.
 * @param before - the earlier reading
 * @param after - the later reading
 * @returns the divergence index and the signature
 */
function readingDiff(
  before: readonly string[],
  after: readonly string[],
): ReadingDiff {
  let start = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  ) {
    start += 1;
  }
  let endBefore = before.length;
  let endAfter = after.length;
  while (
    endBefore > start &&
    endAfter > start &&
    before[endBefore - 1] === after[endAfter - 1]
  ) {
    endBefore -= 1;
    endAfter -= 1;
  }
  if (start === endBefore && start === endAfter) {
    return { at: start, signature: "" };
  }
  const left = before.slice(start, endBefore).join(" ");
  const right = after.slice(start, endAfter).join(" ");
  return { at: start, signature: `[${left}] -> [${right}]` };
}

/**
 * The signature of the difference between two readings.
 * @param before - the earlier reading
 * @param after - the later reading
 * @returns `[a b] -> [c]`, or "" when the two readings are equal
 */
export function diffSignature(
  before: readonly string[],
  after: readonly string[],
): string {
  return readingDiff(before, after).signature;
}

/** One incompatibility: which pass produced it, where, and what changed. */
export interface ReadingBreach {
  /** `p1` is source versus once-formatted; `p2` is once versus twice. */
  readonly pass: "p1" | "p2";
  /** The {@link diffSignature} of the two readings. */
  readonly signature: string;
  /**
   * The 1-based line where the two readings part company, in the
   * EARLIER document of the pair - the source for `p1`, the
   * once-formatted output for `p2`.
   *
   * When the divergence is a token the later reading grew that the
   * earlier one has no counterpart for, the earlier reading has run
   * out and the line is the later document's instead. The signature
   * says which case it is: an empty left side is a token appearing.
   */
  readonly line: number;
}

/**
 * The source line the divergence sits on.
 * @param at - the divergence index
 * @param before - the earlier reading's line per token
 * @param after - the later reading's line per token
 * @returns the 1-based line, from whichever reading reaches that index
 */
function divergenceLine(
  at: number,
  before: readonly number[],
  after: readonly number[],
): number {
  return at < before.length ? before[at] : after[at];
}

/**
 * Assess one document's formatted pair against the invariant.
 *
 * The second clause is what catches corruption that only appears on
 * the second pass, and it is free: every consumer already formats
 * twice for its idempotence check. It is SKIPPED when the second pass
 * changed no bytes - byte-equal implies reading-equal.
 * @param source - the original document
 * @param once - `format(source)`
 * @param twice - `format(once)`
 * @returns one entry per failing pass; empty means compatible
 */
export function readingBreaches(
  source: string,
  once: string,
  twice: string,
): ReadingBreach[] {
  const breaches: ReadingBreach[] = [];
  const sourceReading = projectionOf(source);
  const onceReading = projectionOf(once);
  const first = readingDiff(sourceReading.tokens, onceReading.tokens);
  if (first.signature !== "") {
    breaches.push({
      pass: "p1",
      signature: first.signature,
      line: divergenceLine(first.at, sourceReading.lines, onceReading.lines),
    });
  }
  if (twice === once) {
    return breaches;
  }
  const twiceReading = projectionOf(twice);
  const second = readingDiff(onceReading.tokens, twiceReading.tokens);
  if (second.signature !== "") {
    breaches.push({
      pass: "p2",
      signature: second.signature,
      line: divergenceLine(second.at, onceReading.lines, twiceReading.lines),
    });
  }
  return breaches;
}

/**
 * Format a document twice and assess the pair.
 *
 * A formatter throw yields NO breach: without an output there is no
 * emitted reading to compare, and "the formatter crashed" is already
 * the verdict of the crash property (tests/conformance/properties.ts)
 * and of the sweep. This net has nothing to add to it.
 *
 * The catch covers the two formatter calls and NOTHING else. A throw
 * out of the projection itself is this harness failing, not the
 * formatter, and it must be loud.
 * @param source - the document to assess
 * @returns one entry per failing pass; empty means compatible
 */
export async function readingBreachesOf(
  source: string,
): Promise<ReadingBreach[]> {
  const pair = await formattedTwice(source);
  return pair === undefined
    ? []
    : readingBreaches(source, pair.once, pair.twice);
}

/**
 * Format a document, then format the result - or nothing at all when
 * either call threw.
 *
 * A helper rather than two `let`s in the caller, for the reason
 * tests/format/list-shape-sweep.ts has the same one: the lint rules
 * want every binding initialized on declaration, and this keeps the
 * `try` around exactly the two formatter calls.
 * @param source - the document to format
 * @returns the once- and twice-formatted texts, or undefined on a throw
 */
async function formattedTwice(
  source: string,
): Promise<{ once: string; twice: string } | undefined> {
  try {
    const once = await formatAdoc(source);
    return { once, twice: await formatAdoc(once) };
  } catch {
    return undefined;
  }
}
