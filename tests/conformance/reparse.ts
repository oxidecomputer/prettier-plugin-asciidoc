/**
 * The REPARSE INVARIANT: the document our reader makes of the
 * formatter's output is the document it made of the source.
 *
 *     projectionOf(format(d))    == projectionOf(d)
 *     projectionOf(format^2(d))  == projectionOf(format(d))
 *
 * This is the question `src/print` asks about bytes it has not
 * written yet, asked instead about bytes it has: format, hand the
 * output back to `parse`, and compare the two trees. Nothing here
 * models a hazard. The reader is the authority on what bytes mean,
 * and the only thing this module supplies is the LENS - the list of
 * differences a normalization is licensed to make.
 *
 * WHY A LENS AND NOT TREE IDENTITY. A formatter that changed nothing
 * would pass tree identity, and be useless. Uniformity is the job:
 * the printer deliberately rewrites whitespace runs, delimiter
 * lengths, attribute-list spacing and span spellings. The lens is the
 * enumeration of exactly those intentions, one row per licensed
 * difference, each row naming the format test that declares the
 * transform deliberate. A difference with no row is a breach.
 *
 * The asymmetry that makes this worth doing: intentions are
 * enumerable because we choose them; the hazards a printed byte can
 * run into are not, because the language chooses those.
 *
 * WHAT IT IS NOT. It is not the render oracle
 * (`tests/conformance/properties.ts` runs Asciidoctor for that) and
 * it is not the line-kind reading of tests/lib/reading.ts. It sits
 * between them: stronger than a line-kind projection because it sees
 * inline structure and substitution results, weaker than Asciidoctor
 * because it can only see what our own reader models. Where our
 * reader has a gap, both sides of the comparison share it, and this
 * check is blind to it by construction - which is the same blindness
 * a verify-and-retry printer would have, and the reason to measure it
 * before building on it.
 */
import { rstrip } from "../../src/parse/line-shapes.js";
import { parse } from "../../src/parser.js";
import { formatAdoc } from "../helpers.js";
import { diffSignature } from "../lib/reading.js";

/**
 * How one field reaches the comparison. The default for a string
 * field is {@link squash} OUTSIDE a verbatim context and
 * {@link verbatimOf} inside one; the rows below are the exceptions,
 * and every exception is a licensed normalization.
 */
type FieldLens =
  /** Dropped: the field records a spelling the printer chooses. */
  | "drop"
  /** Interior bytes exact; only the reader's own trailing rstrip. */
  | "verbatim"
  /** Whitespace runs collapse, and a comma sheds its blanks. */
  | "attrlist"
  /** Whitespace runs collapse, then the value is lowercased. */
  | "lowercase"
  /** Whitespace runs collapse, then both edges are trimmed. */
  | "trim"
  /** Whitespace runs collapse, then the leading edge is trimmed. */
  | "trimStart";

/**
 * THE LICENSED DIFFERENCES, keyed `<node type>.<field>` with `*` for
 * every type. Each row is a normalization the printer performs on
 * purpose, and each names where that is pinned.
 *
 * - `*.position`, `*.offset`: the printer moves bytes; that IS the
 *   job, and every gate in the repo already asserts against output
 *   text rather than output offsets.
 * - `*.constrained`: `**a**` may print as `*a*`
 *   (tests/format/inline-formatting.test.ts).
 * - `delimitedBlock.sourceDelimiter`: a delimiter run normalizes to
 *   the shortest safe length (tests/format/delimited-block.test.ts).
 * - `paragraph.firstWordEndsItsLine`, `*.everyTextLineIndented`: bits
 *   about the SOURCE's line layout, recorded for the printer's hazard
 *   predicates. Reflow rewrites the layout by design
 *   (tests/format/reflow.test.ts).
 * - `descriptionTerm.line`, `descriptionListItem.textLines`,
 *   `descriptionListItem.printing`: the source LINES a description
 *   item is replayed from, and the reader's decision about whether it
 *   may be reflowed instead. A reflowed item moves its description
 *   onto the term line and wraps it, which rewrites all three; what
 *   the item MEANS is the term nodes and the description's inline
 *   nodes beside them (tests/format/description-list.test.ts).
 * - `table.open`, `table.leadingRuns`,
 *   `tableCell.opening`, `tableCell.runs`: the byte-replay partition
 *   of a table's extent. What a cell MEANS is its content and its
 *   spec, projected by {@link tableCellFields}; where the padding
 *   blanks and the closing line's spelling sit is the printer's
 *   (tests/format/table.test.ts).
 * - the attrlist rows: `[source, ruby]` prints as `[source,ruby]`
 *   (tests/format/block-attributes.test.ts,
 *   tests/format/attrlist-whitespace.test.ts).
 * - `attributeEntry.name`: Asciidoctor downcases attribute names on
 *   the way in, and the printer spells them downcased
 *   (tests/format/attribute-entry.test.ts).
 * - `blockAnchor.reftext`, `inlineAnchor.reftext`: the anchor
 *   serializer's normalized `[[id, reftext]]` spelling moves the
 *   blank that lands in the reftext
 *   (tests/format/anchor-spelling.test.ts).
 * - `xref.text`: a shorthand xref's text loses its LEADING blank and
 *   keeps its trailing one, because `link_text.lstrip`
 *   (substitutors.rb l.746) is what reads it
 *   (tests/format/inline-links.test.ts).
 *
 * `table.close` is deliberately NOT a row: a blanket drop would
 * launder whether the table was ever CLOSED, which the printer is not
 * free to change. {@link tableFields} keeps that half and drops the
 * closing delimiter's length, which the printer does normalize.
 */
export const REPARSE_LENS: Readonly<Record<string, FieldLens>> = {
  "*.position": "drop",
  "*.offset": "drop",
  "*.constrained": "drop",
  "delimitedBlock.sourceDelimiter": "drop",
  "paragraph.firstWordEndsItsLine": "drop",
  "*.everyTextLineIndented": "drop",
  "descriptionTerm.line": "drop",
  "descriptionListItem.textLines": "drop",
  "descriptionListItem.printing": "drop",
  "table.open": "drop",
  "table.leadingRuns": "drop",
  "tableCell.opening": "drop",
  "tableCell.runs": "drop",
  "blockAttributeList.value": "attrlist",
  "blockMacro.attrlist": "attrlist",
  "inlineMacro.attrlist": "attrlist",
  "delimitedBlock.annotatedBy": "attrlist",
  "table.annotatedBy": "attrlist",
  "attributeEntry.name": "lowercase",
  "blockAnchor.reftext": "trim",
  "inlineAnchor.reftext": "trim",
  "xref.text": "trimStart",
};

/**
 * Whitespace runs collapse to one blank.
 *
 * The widest single license here, and the one reflow spends: the
 * printer decides where a line ends, so the run between two words in
 * PROSE is its to choose (tests/format/reflow.test.ts). It is a run
 * transform and NOT a trim - a run that disappears entirely at a text
 * node's leading edge is an indentation loss, which is a breach and
 * has an issue.
 *
 * Its LIMIT is issue #32, and tests/format/whitespace-runs.test.ts
 * states it in the opposite direction from this function: inside a
 * verbatim block, a monospace span or a passthrough a whitespace run
 * is CONTENT, `` `a  b` `` renders `<code>a  b</code>`, and
 * collapsing it is corruption. So squash never reaches those - see
 * {@link VERBATIM_CONTEXTS} and {@link verbatimOf}. A bold, italic or
 * highlight span is NOT held to that bar, and that same file says so:
 * those render plain inline text with no preservation contract.
 *
 * ONE CONTENT PATH THIS CANNOT REACH, and it is a limit of the
 * structural context model rather than an oversight:
 * `attributeEntry.value` takes squash, because an attribute entry is
 * not inside anything. Its value can still ARRIVE inside a verbatim
 * block through a reference, and the context model cannot follow it
 * there - the two nodes are siblings, not ancestor and descendant.
 * Measured: `:foo: a    b` with a `{foo}` listing block under
 * `[subs="attributes+"]` renders `<pre>a    b</pre>`, run kept, so
 * those four blanks are content. Nothing is red today because the
 * printer replays an attribute value byte for byte (that same
 * document formats byte-identical), so the license is unspent; a
 * printer that ever normalized attribute values would spend it
 * silently, and this comment is the warning that it would.
 * @param value - the recorded bytes
 * @returns the bytes with every whitespace run spelled as one blank
 */
function squash(value: string): string {
  return value.replaceAll(/\s+/gv, " ");
}

/**
 * The node kinds whose own strings, and every string beneath them,
 * are CONTENT rather than layout.
 *
 * Issue #32's set, plus front matter, which is bytes for the same
 * reason and had the same hole. A `pass` inline macro is here through
 * {@link verbatimContext} rather than by type, because it is one
 * spelling of `inlineMacro` and the others are not verbatim.
 *
 * The interiors of these are compared BYTE FOR BYTE. Only the value's
 * trailing run of ASCII whitespace is licensed away, because the
 * reader takes it off every line before anything sees it
 * (`prepare_lines` reaching the `prepare_source` pair, reader.rb
 * l.582-584), so a trailing run is never content that reached us in
 * the first place.
 */
export const VERBATIM_CONTEXTS: ReadonlySet<string> = new Set([
  "delimitedBlock",
  "monospace",
  "passthrough",
  "frontMatter",
]);

/**
 * One field that is content only for a particular spelling of its
 * node, named by the value that selects it.
 */
export interface VerbatimByValue {
  /** The node's `type`. */
  readonly type: string;
  /** The field whose bytes are content. */
  readonly field: string;
  /** The field whose value decides it. */
  readonly discriminant: string;
  /** The value that turns the exception on. */
  readonly value: string;
}

/**
 * The verbatim rows a TYPE cannot express, as data.
 *
 * `VERBATIM_CONTEXTS` keys on a node's type, which is enough for
 * every context that is one kind of node. A `pass` inline macro is
 * not: its attrlist IS its text (`pass:[a  b]` renders both blanks)
 * while every other macro's attrlist is a spelling the printer
 * normalizes, and the two are one `type`.
 *
 * Exported as data rather than written into {@link lensFor} as a
 * condition so the completeness test in
 * tests/conformance/reparse.test.ts can DERIVE what it demands a pair
 * for. A second by-value exception added here owes a pair on the
 * commit that adds it; a second one written inline would owe nothing
 * and nothing would say so.
 */
export const VERBATIM_BY_VALUE: readonly VerbatimByValue[] = [
  {
    type: "inlineMacro",
    field: "attrlist",
    discriminant: "name",
    value: "pass",
  },
];

/**
 * The coverage key one by-value exception owes a pair for.
 * @param row - the exception
 * @returns its key in the pair table's vocabulary
 */
export function verbatimByValueKey(row: VerbatimByValue): string {
  return `verbatim:${row.type}.${row.value}`;
}

/**
 * Does this node open a verbatim context for everything inside it?
 * @param type - the node's `type`
 * @returns whether the strings below it are content
 */
function verbatimContext(type: string): boolean {
  return VERBATIM_CONTEXTS.has(type);
}

/**
 * Content bytes, with the reader's own rstrip and nothing else.
 *
 * PER LINE, because that is where the reader does it: every line is
 * rstripped on the way in (`prepare_lines` reaching the
 * `prepare_source` pair, reader.rb l.582-584), so a trailing run
 * inside a listing block never reached the oracle in the first place
 * and the printer is right to drop it. OUR reader keeps those bytes,
 * because it records the raw span for byte replay, which is why the
 * two sides need this rule to agree. Everything else - leading
 * indentation, interior runs, blank lines - is untouched: that is the
 * whole point of the row (issue #32).
 *
 * `rstrip` is imported rather than spelled again: two definitions of
 * the reader's trailing set would be two dialects of what counts as
 * content, and this one has to be the reader's (a trailing NBSP is
 * content, issue #67).
 * @param value - the recorded bytes
 * @returns the bytes, interiors untouched
 */
function verbatimOf(value: string): string {
  return value
    .split("\n")
    .map((line) => rstrip(line))
    .join("\n");
}

/**
 * An attribute list, with the blanks the printer strips taken out.
 * @param value - the recorded attrlist interior
 * @returns the interior with each comma comma-tight
 */
function attrlistOf(value: string): string {
  return squash(value).replaceAll(/ *, */gv, ",");
}

/** One projected document: its token sequence. */
export interface Projection {
  /** The tokens, in document order. */
  readonly tokens: readonly string[];
}

/**
 * An object walked by the projection: any AST node, plus the two
 * wrappers that carry no `type` (an item's block record and a cell
 * spec).
 */
type Walked = Readonly<Record<string, unknown>>;

/**
 * Is this value one of those objects? A type PREDICATE rather than an
 * assertion, because the walk reaches every value in the tree and an
 * assertion at each arrival would be an unchecked claim per node.
 * @param value - any value from the tree
 * @returns whether it can be walked as a node
 */
function isWalked(value: unknown): value is Walked {
  return typeof value === "object" && value !== null;
}

/**
 * The bytes of a table cell's own text, as Asciidoctor buffers them:
 * the `content` runs joined, whitespace squashed, both edges trimmed
 * (Asciidoctor strips `cell_text` on the way in: `rstrip` for an
 * asciidoc cell at table.rb l.266, for a literal one at l.276, a full
 * `strip` for an ordinary psv cell at l.282, and a `strip` over the
 * buffer that fed it at l.629).
 * @param runs - the cell's recorded run partition
 * @returns the cell's text
 */
function cellText(runs: unknown): string {
  return runImages(runs, "content").trim();
}

/**
 * The `//` lines a reader deleted inside the cell's region. Kept in
 * the projection because losing one changes the document, even though
 * it changes no render.
 * @param runs - the cell's recorded run partition
 * @returns the dropped comment bytes
 */
function cellComments(runs: unknown): string {
  return runImages(runs, "droppedComment").trim();
}

/**
 * The squashed images of a cell's runs of one kind.
 * @param runs - the cell's recorded run partition
 * @param kind - the run kind to keep
 * @returns the joined, squashed images
 */
function runImages(runs: unknown, kind: string): string {
  if (!Array.isArray(runs)) {
    return "";
  }
  const images = runs
    .filter((run) => isWalked(run) && run.kind === kind)
    .map((run) => (isWalked(run) ? String(run.image) : ""));
  return squash(images.join(""));
}

/**
 * The node rewrites, named so the pair table in
 * tests/conformance/reparse.test.ts owes each one a pair.
 *
 * A rewrite is a licensed difference no `<type>.<field>` row can
 * spell: it restates a recorded spelling as the fact that spelling
 * stands for, across several fields at once. Each is as capable of
 * being too generous as a field row is, and the completeness test
 * treats them alike.
 */
export const REPARSE_REWRITES: readonly string[] = [
  "tableFields",
  "tableCellFields",
  "fencedBlockFields",
];

/**
 * A table as the lens sees it: its close reduced to the fact that
 * decides structure.
 *
 * `close` is a union of "the terminator line was met" and "the extent
 * ran to the end of the stream", and only the first carries an
 * `image`. The IMAGE is the delimiter's length, which the printer
 * normalizes the way it normalizes every other delimiter
 * (`|=======` prints as `|===`); the KIND is whether the table was
 * ever closed, which it is not free to change - an unterminated table
 * is declined and replayed byte for byte
 * (tests/format/table.test.ts, "an unterminated table is declined").
 * A blanket drop of `close` laundered both; this keeps the second.
 * @param table - the recorded table
 * @returns the fields to project in place of the table's own
 */
function tableFields(table: Walked): Walked {
  const close = isWalked(table.close) ? table.close.kind : undefined;
  return { ...table, close: undefined, closedAt: close };
}

/**
 * A table cell as the lens sees it: where it sits, what it spans,
 * what its spec said, and what it holds.
 * @param cell - the recorded cell
 * @returns the fields to project in place of the cell's own
 */
function tableCellFields(cell: Walked): Walked {
  return {
    type: cell.type,
    columnIndex: cell.columnIndex,
    repeat: cell.repeat,
    spec: isWalked(cell.opening) ? cell.opening.parsed : undefined,
    content: cellText(cell.runs),
    comments: cellComments(cell.runs),
  };
}

/**
 * A fenced block as the listing block it prints as: a markdown fence
 * carrying the language `ruby` becomes `[source,ruby]` over `----`
 * (tests/format/fenced-code.test.ts). Rewriting the SOURCE side into
 * the output's spelling, rather than the other way round, keeps the
 * comparison in one vocabulary.
 * @param block - the recorded fenced block
 * @returns the fields to project in place of the block's own
 */
function fencedBlockFields(block: Walked): Walked {
  const language = typeof block.language === "string" ? block.language : "";
  const separator = language === "" ? "" : ",";
  return {
    ...block,
    fenced: undefined,
    language: undefined,
    annotatedBy: `source${separator}${language}`,
  };
}

/**
 * Is this element a block attribute list whose whole content the next
 * element already carries as its `annotatedBy`?
 *
 * The reader records an attribute line twice: once as a node of its
 * own and once on the block it annotates. A fenced block has only the
 * second (it writes no bracket line), so without this the fenced
 * rewrite above would have to invent a sibling node and get the
 * ARITY of `blocks` wrong inside a list item. Eliding the duplicate
 * instead compares the same fact once, from the side both spellings
 * share.
 * @param element - the candidate attribute list
 * @param next - the element after it, if any
 * @returns whether the attribute list is a duplicate record
 */
function isDuplicateAttributeList(element: unknown, next: unknown): boolean {
  const node = innerOf(element);
  if (node?.type !== "blockAttributeList" || typeof node.value !== "string") {
    return false;
  }
  const annotated = annotatedByOf(next);
  return annotated !== undefined && attrlistOf(node.value) === annotated;
}

/**
 * The attribute-list interior a following element records, reaching
 * through an item's `{ gap, block }` wrapper.
 * @param element - the element after an attribute list
 * @returns the normalized interior, or undefined when it records none
 */
function annotatedByOf(element: unknown): string | undefined {
  const inner = innerOf(element);
  if (inner === undefined) {
    return undefined;
  }
  if (inner.fenced === true) {
    return attrlistOf(String(fencedBlockFields(inner).annotatedBy));
  }
  return typeof inner.annotatedBy === "string"
    ? attrlistOf(inner.annotatedBy)
    : undefined;
}

/**
 * The node an array element stands for, reaching through an item's
 * `{ gap, block }` wrapper.
 * @param element - an array element
 * @returns the node, or undefined when the element is not one
 */
function innerOf(element: unknown): Walked | undefined {
  if (!isWalked(element)) {
    return undefined;
  }
  if (element.type !== undefined || element.block === undefined) {
    return element;
  }
  return isWalked(element.block) ? element.block : undefined;
}

/**
 * The lens row for one field of one node type.
 *
 * A DECLARED ROW WINS over the verbatim context, and the split is the
 * point: a row names a spelling the printer chooses, and a spelling
 * recorded ON a verbatim block is not content INSIDE it. A listing
 * block's `annotatedBy` is its attribute line's interior and stays
 * comma-tight; its `content` has no row and is bytes.
 *
 * The exceptions a type cannot express are {@link VERBATIM_BY_VALUE},
 * read here rather than spelled here: a `pass` inline macro's
 * attrlist IS its text, so it takes the verbatim lens where every
 * other macro's attrlist takes the attrlist one.
 * @param type - the node's `type`, or `-` for a wrapper
 * @param field - the field name
 * @param node - the node the field belongs to
 * @param verbatim - whether this node sits in a verbatim context
 * @returns the row, or undefined when the field takes plain squash
 */
function lensFor(
  type: string,
  field: string,
  node: Walked,
  verbatim: boolean,
): FieldLens | undefined {
  if (
    VERBATIM_BY_VALUE.some(
      (row) =>
        row.type === type &&
        row.field === field &&
        node[row.discriminant] === row.value,
    )
  ) {
    return "verbatim";
  }
  const keyed = `${type}.${field}`;
  if (Object.hasOwn(REPARSE_LENS, keyed)) {
    return REPARSE_LENS[keyed];
  }
  const wildcard = `*.${field}`;
  if (Object.hasOwn(REPARSE_LENS, wildcard)) {
    return REPARSE_LENS[wildcard];
  }
  return verbatim ? "verbatim" : undefined;
}

/**
 * One string field, through its lens row.
 * @param lens - the row, or undefined for the default
 * @param value - the recorded bytes
 * @returns the projected bytes
 */
function projectString(lens: FieldLens | undefined, value: string): string {
  switch (lens) {
    case "verbatim": {
      return verbatimOf(value);
    }
    case "attrlist": {
      return attrlistOf(value);
    }
    case "lowercase": {
      return squash(value).toLowerCase();
    }
    case "trim": {
      return squash(value).trim();
    }
    case "trimStart": {
      return squash(value).trimStart();
    }
    default: {
      return squash(value);
    }
  }
}

/**
 * Walk one value, appending its tokens.
 *
 * `last` says the value is the final element of the array it sits in,
 * which is the one place a trailing whitespace run may vanish: the
 * reader takes it off every line it hands out (`prepare_lines`
 * reaching the `prepare_source` pair, reader.rb l.582-584), so a
 * block's final run is not content and the printer writes none.
 *
 * `verbatim` says some ancestor opened a verbatim context, so every
 * string below here is content. It is inherited rather than looked up
 * per node because the contexts NEST: a monospace span inside a
 * listing block does not stop being content.
 * @param value - the node, array or scalar to project
 * @param out - the token sink
 * @param last - whether the value ends the array it belongs to
 * @param verbatim - whether an ancestor opened a verbatim context
 */
function emit(
  value: unknown,
  out: string[],
  last: boolean,
  verbatim: boolean,
): void {
  if (Array.isArray(value)) {
    emitArray(value, out, verbatim);
    return;
  }
  if (!isWalked(value)) {
    return;
  }
  emitNode(value, out, last, verbatim);
}

/**
 * Walk an array of nodes, eliding the duplicate attribute-list
 * records the fenced rewrite would otherwise disagree with.
 * @param values - the array
 * @param out - the token sink
 * @param verbatim - whether an ancestor opened a verbatim context
 */
function emitArray(
  values: readonly unknown[],
  out: string[],
  verbatim: boolean,
): void {
  for (const [index, element] of values.entries()) {
    if (isDuplicateAttributeList(element, values[index + 1])) {
      continue;
    }
    if (typeof element === "string") {
      // A string INSIDE an array is a recorded line, not a field: a
      // description term's gap holds them. Emitted as a token of its
      // own so a lost one moves the sequence, where the walk below
      // would drop it silently.
      out.push(
        JSON.stringify(verbatim ? verbatimOf(element) : squash(element)),
      );
      continue;
    }
    emit(element, out, index === values.length - 1, verbatim);
  }
}

/**
 * Walk one object: its scalars become the token's payload, its nested
 * values become the tokens between its open and close markers. An
 * item's `{ gap, block }` wrapper contributes NO token of its own -
 * the gap spelling is the printer's (tests/format/list-continuation.
 * test.ts) and the wrapper carries nothing else.
 * @param node - the object
 * @param out - the token sink
 * @param last - whether the node ends the array it belongs to
 * @param inherited - whether an ancestor opened a verbatim context
 */
function emitNode(
  node: Walked,
  out: string[],
  last: boolean,
  inherited: boolean,
): void {
  if (node.block !== undefined && node.type === undefined) {
    emit(node.block, out, last, inherited);
    return;
  }
  const type = typeof node.type === "string" ? node.type : "-";
  const verbatim = inherited || verbatimContext(type);
  const { scalars, nested } = partitionFields(type, node, last, verbatim);
  const head = `${type}(${scalars.join(",")})`;
  if (nested.length === 0) {
    out.push(head);
    return;
  }
  out.push(`<${head}`);
  for (const [field, held] of nested) {
    out.push(`.${field}`);
    emit(held, out, false, verbatim);
  }
  out.push(`>${type}`);
}

/** A node's fields, split into the token's payload and its children. */
interface Partition {
  /** `field=value` for every scalar the lens keeps, in field order. */
  readonly scalars: readonly string[];
  /** Field name and value for every nested value, in field order. */
  readonly nested: ReadonlyArray<readonly [string, unknown]>;
}

/**
 * Split one node's fields into the two halves {@link emitNode} spells
 * differently.
 * @param type - the node's `type`
 * @param node - the node
 * @param last - whether the node ends the array it belongs to
 * @param verbatim - whether this node's strings are content
 * @returns the two halves
 */
function partitionFields(
  type: string,
  node: Walked,
  last: boolean,
  verbatim: boolean,
): Partition {
  const scalars: string[] = [];
  const nested: Array<readonly [string, unknown]> = [];
  for (const [field, held] of sortedEntries(projectedFields(type, node))) {
    const lens = lensFor(type, field, node, verbatim);
    if (lens === "drop" || held === undefined) {
      continue;
    }
    if (typeof held === "string") {
      scalars.push(
        `${field}=${JSON.stringify(textOf(type, lens, held, last))}`,
      );
    } else if (typeof held === "number" || typeof held === "boolean") {
      scalars.push(`${field}=${String(held)}`);
    } else {
      nested.push([field, held]);
    }
  }
  return { scalars, nested };
}

/**
 * One string field, through its lens row and the trailing-edge rule.
 * @param type - the node's `type`
 * @param lens - the field's lens row, or undefined for the default
 * @param held - the recorded bytes
 * @param last - whether the node ends the array it belongs to
 * @returns the projected bytes
 */
function textOf(
  type: string,
  lens: FieldLens | undefined,
  held: string,
  last: boolean,
): string {
  const projected = projectString(lens, held);
  // `rstrip` and not `trimEnd`: the reader's trailing set is the six
  // ASCII whitespace characters, so a trailing NBSP is content that
  // survived the read (issue #67) and must not be licensed away here.
  return last && type === "text" ? rstrip(projected) : projected;
}

/**
 * The fields to project for one node, after the two rewrites that
 * restate a recorded spelling as the fact it stands for.
 * @param type - the node's `type`
 * @param node - the node
 * @returns the fields the walk reads
 */
function projectedFields(type: string, node: Walked): Walked {
  if (type === "table") {
    return tableFields(node);
  }
  if (type === "tableCell") {
    return tableCellFields(node);
  }
  if (type === "delimitedBlock" && node.fenced === true) {
    return fencedBlockFields(node);
  }
  return node;
}

/**
 * A node's own fields in a fixed order, so two trees that agree
 * compare equal whatever order the builders wrote the keys in.
 * @param node - the node
 * @returns its entries, sorted by field name
 */
function sortedEntries(node: Walked): Array<readonly [string, unknown]> {
  return Object.entries(node)
    .filter(([field]) => field !== "type")
    .toSorted(([left], [right]) => (left < right ? -1 : Number(left > right)));
}

/**
 * The document our reader makes of these bytes, seen through the
 * lens.
 * @param document - the document to read
 * @returns its token sequence
 */
export function projectionOf(document: string): Projection {
  const tokens: string[] = [];
  emit(parse(document), tokens, false, false);
  return { tokens };
}

/** One incompatibility: which pass produced it, and what changed. */
export interface ReparseBreach {
  /** `p1` is source versus once-formatted; `p2` is once versus twice. */
  readonly pass: "p1" | "p2";
  /** The `[before] -> [after]` difference between the two projections. */
  readonly signature: string;
}

/**
 * Assess one document's formatted pair against the invariant.
 *
 * The `p2` clause is skipped when the second pass moved no bytes:
 * byte-equal implies projection-equal.
 * @param source - the original document
 * @param once - `format(source)`
 * @param twice - `format(once)`
 * @returns one entry per failing pass; empty means compatible
 */
function reparseBreaches(
  source: string,
  once: string,
  twice: string,
): ReparseBreach[] {
  const breaches: ReparseBreach[] = [];
  const before = projectionOf(source).tokens;
  const after = projectionOf(once).tokens;
  const first = diffSignature(before, after);
  if (first !== "") {
    breaches.push({ pass: "p1", signature: first });
  }
  if (twice === once) {
    return breaches;
  }
  const second = diffSignature(after, projectionOf(twice).tokens);
  if (second !== "") {
    breaches.push({ pass: "p2", signature: second });
  }
  return breaches;
}

/**
 * Format a document twice and assess the pair.
 *
 * A formatter throw yields NO breach, for the reason
 * tests/lib/reading.ts gives: without an output there is no document
 * to re-read, and "the formatter crashed" is already the verdict of
 * the crash property. The catch covers the two formatter calls and
 * nothing else - a throw out of the projection is this harness
 * failing, and it must be loud.
 * @param source - the document to assess
 * @returns one entry per failing pass; empty means compatible
 */
export async function reparseBreachesOf(
  source: string,
): Promise<readonly ReparseBreach[]> {
  const outcome = await reparseOutcomeOf(source);
  return outcome.breaches;
}

/** One document's formatted pair and the breaches between them. */
export interface ReparseOutcome {
  /** `format(source)`, or the source itself when the formatter threw. */
  readonly once: string;
  /** One entry per failing pass; empty means compatible. */
  readonly breaches: readonly ReparseBreach[];
}

/**
 * Format a document twice and assess the pair, keeping the output.
 *
 * The output is part of the result because naming the MECHANISM
 * behind a breach needs both sides: the signature says what changed
 * in the tree, and only the two texts say whether a line was joined,
 * de-indented or dropped. See
 * tests/conformance/reparse-ledger.ts.
 *
 * A formatter throw yields NO breach, for the reason
 * tests/lib/reading.ts gives: without an output there is no document
 * to re-read, and "the formatter crashed" is already the verdict of
 * the crash property. The catch covers the two formatter calls and
 * nothing else - a throw out of the projection is this harness
 * failing, and it must be loud.
 * @param source - the document to assess
 * @returns the once-formatted text and the breaches
 */
export async function reparseOutcomeOf(
  source: string,
): Promise<ReparseOutcome> {
  const pair = await formattedTwice(source);
  if (pair === undefined) {
    return { once: source, breaches: [] };
  }
  return {
    once: pair.once,
    breaches: reparseBreaches(source, pair.once, pair.twice),
  };
}

/**
 * Format a document, then format the result - or nothing at all when
 * either call threw. A helper rather than two `let`s in the caller,
 * so the `try` covers exactly the two formatter calls.
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
