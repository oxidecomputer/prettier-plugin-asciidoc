/**
 * Shared test utilities for parser and format tests.
 *
 * Format tests import the plugin object directly from source (via vitest's
 * TS handling) rather than from dist/. This avoids needing a build step
 * before running tests — only the identity.test.ts smoke tests use dist/.
 *
 * NOTE: `identity.test.ts` intentionally does NOT use this helper. It has
 * its own `formatAdoc` that imports from the built `dist/` output, so it
 * validates that the build artifact works end-to-end. Do not refactor
 * identity.test.ts to use this shared helper — that would defeat its purpose.
 */
import { format, type Options } from "prettier";
import {
  LoggerManager,
  MemoryLogger,
  NullLogger,
  convert,
  load,
} from "@asciidoctor/core";
import type {
  BlockNode,
  DelimitedBlockNode,
  ListNode,
  ParagraphNode,
} from "../src/ast.js";
import type { parse } from "../src/parser.js";
import plugin from "../src/index.js";
import { narrow } from "../src/narrow.js";

/**
 * Formats AsciiDoc input through Prettier with optional overrides.
 * Shared test helper that avoids duplicating plugin configuration
 * in every test file.
 * @param input - raw AsciiDoc source text
 * @param options - optional Prettier overrides; the asciidoc parser
 *   and plugin are always injected regardless of what is passed here
 * @param options.printWidth - line width limit for the formatter
 * @param options.endOfLine - the line terminator Prettier writes; the
 *   printer reads its own output back to place a list item boundary
 *   (`printedLines`, src/print/list.ts), so this is the one option
 *   besides the width that changes what that rule sees
 * @returns the formatted output string; Prettier always appends a
 *   trailing newline, so callers can rely on that invariant
 */
export async function formatAdoc(
  input: string,
  options?: { printWidth?: number; endOfLine?: Options["endOfLine"] },
): Promise<string> {
  return await format(input, {
    parser: "asciidoc",
    plugins: [plugin],
    ...options,
  });
}

/**
 * Narrows the first child of a document's children array to
 * ListNode. Using an explicit throw rather than a cast means
 * test setup errors surface immediately with a readable message
 * instead of a silent type lie.
 * @param children - the children array from a `parse()` result
 * @returns the first child, narrowed to ListNode
 */
export function firstList(
  children: ReturnType<typeof parse>["children"],
): ListNode {
  const [block] = children;
  narrow(block, "list");
  return block;
}

/**
 * Narrows a BlockNode to ParagraphNode. Using an explicit
 * throw rather than a cast means test setup errors surface
 * immediately with a readable message instead of a silent
 * type lie.
 * @param node - block node expected to be a paragraph
 * @returns the node narrowed to ParagraphNode
 */
export function asParagraph(node: BlockNode): ParagraphNode {
  narrow(node, "paragraph");
  return node;
}

/**
 * Narrows the first child of a document's children array to
 * DelimitedBlockNode. Using an explicit throw rather than a
 * cast means test setup errors surface immediately with a
 * readable message instead of a silent type lie.
 * @param children - the children array from a `parse()` result
 * @returns the first child narrowed to DelimitedBlockNode
 */
export function firstDelimitedBlock(
  children: ReturnType<typeof parse>["children"],
): DelimitedBlockNode {
  const [block] = children;
  narrow(block, "delimitedBlock");
  return block;
}

// convert() is stateless, so the module-level import is safe across
// all tests. The null logger suppresses stderr noise from
// intentionally odd inputs. Asciidoctor.js 4.x routes some diagnostics
// (a misplaced `partintro`, for one) through the PROCESS-wide logger
// no matter what a single call passes, so the same logger is installed
// both ways — the per-call option alone leaves the corpus sweeps
// printing errors over their own output.
const nullLogger = NullLogger.create();
LoggerManager.setLogger(nullLogger);

/**
 * The console methods Asciidoctor's logging fallback can reach.
 *
 * A THIRD sink, past both logger installs above. The Logging mixin
 * resolves its logger as `this._document?.logger ?? console`
 * (`@asciidoctor/core/build/node/index.cjs` l.6604, l.7334), so a
 * Reader that carries no document writes straight to the global
 * console and neither `LoggerManager.setLogger` nor the per-call
 * `logger` option is consulted. A delimited block left unterminated
 * INSIDE a list item is read by such a Reader: `----\ncontent` on its
 * own is silent, and `* item\n+\n----\ncontent` prints a
 * `console.warn` of the raw log record. The registry grid spells that
 * coordinate hundreds of times over, so the escape hatch has to be
 * closed here or a green sweep buries its own result.
 */
interface ConsoleSink {
  /** Where `logger.warn` lands. */
  warn: typeof console.warn;
  /** Where `logger.error` lands. */
  error: typeof console.error;
  /** Where `logger.info` lands. */
  info: typeof console.info;
}

/** The muted console method while a conversion is running. */
function swallow(): void {
  // Dropping the record IS the behavior: see ConsoleSink for why
  // these records have nowhere better to go.
}

/** The sink installed while any conversion is running. */
const SWALLOWING: ConsoleSink = {
  warn: swallow,
  error: swallow,
  info: swallow,
};

/**
 * Reads the console methods currently installed.
 * @returns the three methods, as they are right now
 */
function currentConsole(): ConsoleSink {
  /* eslint-disable-next-line no-console -- reading the sink this module mutes */
  return { warn: console.warn, error: console.error, info: console.info };
}

/**
 * Installs three console methods.
 * @param sink - the methods to install
 */
function installConsole(sink: ConsoleSink): void {
  /* eslint-disable no-console -- writing the sink this module mutes */
  console.warn = sink.warn;
  console.error = sink.error;
  console.info = sink.info;
  /* eslint-enable no-console */
}

/**
 * How many conversions are muting the console right now, and what to
 * put back when the last of them finishes.
 *
 * MODULE state, not per-call state. `oracleHtml` is async and callers
 * overlap it (`Promise.all` in tests/conformance/interruption.test.ts),
 * so a call that saved the console on entry could capture an earlier
 * overlapping call's {@link swallow} as "the original" and restore
 * THAT, muting the process for the rest of the worker. The counter
 * makes the OUTERMOST conversion the only one that installs or
 * restores, and `savedConsole` is only ever read from the console at a
 * moment when nothing is muted, so it can never hold a swallow.
 */
let mutedConversions = 0;
let savedConsole: ConsoleSink = currentConsole();

/**
 * Runs the oracle with its console fallback muted.
 *
 * Scoped to the call rather than installed once at module load: this
 * silences the process's console, so anything else logging while it
 * is in effect would be swallowed too, and the window has to be no
 * wider than the conversions themselves. `finally` restores even when
 * the oracle throws, which it does on inputs the grids are built to
 * contain.
 * @param convertOnce - the conversion to run muted
 * @returns whatever the conversion returned
 */
async function withoutConsoleFallback<T>(
  convertOnce: () => Promise<T>,
): Promise<T> {
  if (mutedConversions === 0) {
    savedConsole = currentConsole();
    installConsole(SWALLOWING);
  }
  mutedConversions += 1;
  try {
    return await convertOnce();
  } finally {
    mutedConversions -= 1;
    if (mutedConversions === 0) {
      installConsole(savedConsole);
    }
  }
}

/**
 * Renders AsciiDoc to HTML via Asciidoctor and hands back what the
 * oracle emitted, byte for byte, with nothing normalized.
 *
 * This is the lens for pinning what the oracle SPELLS. A test whose
 * expectation names `&#8217;` is making a claim about the bytes
 * Asciidoctor writes, and {@link renderedHtml} cannot carry that
 * claim by design: through it a numeric character reference and the
 * character it names are one thing. So a byte pin reads the bytes
 * here, and {@link renderedHtml} compares one render against another.
 * @param input - AsciiDoc source text.
 * @returns Asciidoctor's HTML in safe mode with logging suppressed.
 */
export async function oracleHtml(input: string): Promise<string> {
  const result = await withoutConsoleFallback(
    async () =>
      await convert(input, {
        safe: "safe",
        logger: nullLogger,
      }),
  );
  if (typeof result !== "string") {
    throw new TypeError("expected convert() to return a string");
  }
  return result;
}

/**
 * The three characters that carry markup meaning in HTML text, and
 * the named entity each one is spelled with. A numeric reference to
 * one of them decodes to the NAME, never to the raw character, so
 * that decoding can never turn text into something that reads as a
 * tag or as the start of another entity.
 */
const MARKUP_CHARACTER_NAMES = new Map([
  ["&", "&amp;"],
  ["<", "&lt;"],
  [">", "&gt;"],
]);

/**
 * Decodes decimal and hex numeric character references to the
 * characters they name. See {@link renderedHtml} for why numeric
 * references decode and named entities do not.
 *
 * A form this cannot read as a character is left exactly as it
 * stands. Each radix reads only its own alphabet: the alternation
 * has no branch that would match a decimal form holding a hex letter
 * (`&#4a;`), so a mixed form is not a reference and never parses.
 * Of the forms that do parse, a code point past the Unicode range
 * names nothing, and NUL is the byte the region sentinel is built
 * from, so decoding one would forge a placeholder.
 * @param html - HTML with its whitespace-significant regions stashed
 * @returns the same HTML with numeric references decoded
 */
function decodeNumericReferences(html: string): string {
  return html.replaceAll(
    /&#(?:[xX][0-9a-fA-F]+|[0-9]+);/gv,
    (match: string): string => {
      // Between the `&#` and the `;` sits either an `x`-marked hex
      // form or a decimal one; the marker says which radix reads it.
      const body = match.slice(2, -1);
      const codePoint = /^[xX]/v.test(body)
        ? Number.parseInt(body.slice(1), 16)
        : Number.parseInt(body, 10);
      // Each branch's alphabet matches its radix, so the parse is
      // never NaN; what remains ungoverned is the VALUE. A code
      // point past the Unicode range names nothing, and NUL is the
      // byte the region sentinel is built from, so decoding one
      // would forge a placeholder.
      if (!(codePoint > 0 && codePoint <= 0x10_ff_ff)) {
        return match;
      }
      const character = String.fromCodePoint(codePoint);
      return MARKUP_CHARACTER_NAMES.get(character) ?? character;
    },
  );
}

/**
 * Renders AsciiDoc to normalized HTML via Asciidoctor for
 * semantic-fidelity comparisons: asserting that formatting did
 * not change what a document MEANS, not just that it round-trips
 * textually. Each source LINE BREAK outside `<pre>` blocks — with
 * the indentation that surrounds it — collapses to a single space,
 * because Asciidoctor copies a line break and the indentation
 * after it straight into paragraph text (`a\n  b` renders as `a`,
 * newline, two spaces, `b`) while the formatter reflows lines. That
 * difference is invisible in rendered HTML and not a semantic
 * change.
 *
 * Whitespace RUNS within a line collapse for the same reason, but
 * under a narrower shelter: outside `<pre>` AND outside `<code>`.
 * Reflowing prose is what a formatter does and two spaces after a
 * full stop are not something a document MEANS, while a run inside
 * `` `a  b` `` or a verbatim block is exactly issue #32's failure -
 * whitespace the reader can see. So a formatter that collapses a
 * double space inside a code span still fails this comparison; one
 * that collapses it in a sentence no longer does.
 *
 * The two rules have deliberately different shelters. A line BREAK
 * is folded inside `<code>` as well, because reflow may legitimately
 * break a line inside an inline code span and Asciidoctor copies
 * that break into the element; only `<pre>`, where a line break is
 * content, is exempt from it.
 *
 * A NUMERIC character reference is read as the character it names.
 * `&#43;` and `+` are the same character to a reader, and Asciidoctor
 * spells one or the other depending on how the source reached it: a
 * literal `+` stays `+`, while the `{plus}` attribute the formatter
 * escapes with renders as `&#43;`. Comparing the two spellings as
 * unequal reports a rendering change where the reader sees none, and
 * once did (issue #33). Decimal (`&#NNN;`) and hex (`&#xHH;`) both
 * decode, and only outside the stashed regions. That shelter is
 * CONSERVATIVE, not semantic: an HTML reader decodes a reference
 * inside `<code>` exactly as outside, so `` `a {plus} b` `` and
 * `` `a + b` `` display identically yet compare unequal here. The
 * decode shares the whitespace rules' zone so that every
 * normalization stays out of verbatim regions (one rule, one zone),
 * and the error it can make points only one way: a false FAILURE a
 * test author sees and questions, never a false pass. The decode
 * also runs after the line-break fold, so a newline a reference
 * names (`&#10;`, which the oracle passes through) decodes to a
 * newline that no longer folds. That too is harmless for equality,
 * since both renders decode alike. A test that means to pin the
 * SPELLING rather
 * than compare two renders reads {@link oracleHtml} instead, which
 * normalizes nothing.
 *
 * NAMED entities do NOT decode. `&amp;`, `&lt;`, `&gt;` and `&quot;`
 * are HTML's structural escapes, and decoding them would leave text
 * that reads as markup indistinguishable from markup. For the same
 * reason a numeric reference that names one of `<`, `>` or `&`
 * decodes to the NAMED spelling rather than the raw character: the
 * two spellings still compare equal, and no comparison ever sees a
 * `<` that the document did not mean as a tag.
 *
 * KNOWN COST: an inline passthrough (`+++a  b+++`) renders as bare
 * text with no wrapping element, so a collapsed run inside one is
 * invisible here. The `<pre>`/`<code>` split is what the rendered
 * HTML makes available; a passthrough's whitespace needs a test
 * against pinned bytes.
 *
 * Asciidoctor.js 4.x converts asynchronously — there is no sync
 * entry point in any of its builds — so this returns a promise and
 * every caller awaits it.
 * @param input - AsciiDoc source text.
 * @returns Normalized HTML string produced by Asciidoctor in
 *   safe mode with logging suppressed.
 */
export async function renderedHtml(input: string): Promise<string> {
  const result = await oracleHtml(input);
  // Stash every whitespace-significant region, normalize what is
  // left, then put the regions back. <pre> is stashed FIRST, so a
  // stashed <code> can never contain a placeholder: a source block
  // is <pre ...><code ...>, and the whole <pre> leaves in one piece
  // before the <code> pass runs. Asciidoctor nests neither tag in
  // itself.
  // The sentinel carries a letter as well as the NUL pair, because a
  // bare NUL-digits-NUL is a sequence a document can itself contain,
  // and one that did would have its own text replaced by a stashed
  // region here.
  const kept: string[] = [];
  const stash = (html: string, region: RegExp): string =>
    html.replaceAll(region, (match) => {
      kept.push(match);
      return `\0R${String(kept.length - 1)}\0`;
    });
  // The two rules have different shelters, and the order says which.
  // A LINE BREAK is folded everywhere outside <pre>, inside an
  // inline code span included: reflow may legitimately break a line
  // inside `` `a b` ``, and Asciidoctor copies that break into the
  // <code> element. A whitespace RUN is folded only outside <code>
  // as well, which is the #32 line. So: stash <pre>, fold breaks,
  // stash <code>, fold runs.
  const withPlaceholders = stash(
    stash(result, /<pre[^>]*>[\s\S]*?<\/pre>/gv).replaceAll(
      /[ \t]*\n[ \t]*/gv,
      " ",
    ),
    /<code[^>]*>[\s\S]*?<\/code>/gv,
  );
  return (
    decodeNumericReferences(withPlaceholders)
      .replaceAll(/[ \t]{2,}/gv, " ")
      // The second callback argument is the first capture — being
      // named does not change its position. (The `groups` object
      // is the LAST argument, after offset and source; reading it
      // positionally is how a previous version of this helper
      // silently replaced every <pre> block with "undefined".)
      .replaceAll(
        /\0R(?<index>\d+)\0/gv,
        (_match: string, index: string) => kept[Number(index)],
      )
  );
}

/**
 * One cell's structural facts, read from the oracle's own
 * `Table::Cell`: its colspan, rowspan and the alignment/style
 * `getAttributes()` carries. Text is read separately, into
 * {@link OracleTable.rows}, because the structure suite compares it
 * against a different transform than these facts (issue #10).
 */
export interface OracleCellSpec {
  /** `Table::Cell#colspan`. */
  readonly colspan: number;
  /** `Table::Cell#rowspan`. */
  readonly rowspan: number;
  /** The resolved horizontal alignment, absent when none applies. */
  readonly halign: string | undefined;
  /** The resolved vertical alignment, absent when none applies. */
  readonly valign: string | undefined;
  /** The resolved cell style, absent when none applies. */
  readonly style: string | undefined;
}

/**
 * The oracle's own structural read of the FIRST table `findBy` meets
 * in a document: its rows' cell text, a parallel per-cell spec grid
 * (same row and column indices as `rows`), the header and footer row
 * counts, its resolved column count, and every severity the run
 * logged.
 */
export interface OracleTable {
  /** Every row's cell text, `head` then `body` then `foot`, in order. */
  readonly rows: ReadonlyArray<readonly string[]>;
  /** Each row's cells' colspan/rowspan/alignment/style, same shape as `rows`. */
  readonly specs: ReadonlyArray<readonly OracleCellSpec[]>;
  /** `table.rows.head.length`. */
  readonly head: number;
  /** `table.rows.foot.length`. */
  readonly foot: number;
  /** `table.getAttribute("colcount")`, as a number. */
  readonly colcount: number;
  /**
   * One severity label (`"ERROR"`, `"WARN"`, ...) per message loading
   * the document logged, in order; empty for a clean load.
   */
  readonly severities: readonly string[];
}

/**
 * The oracle's own `Table::Cell` shape, restated because
 * `@asciidoctor/core`'s published types do not export `Table` or
 * `Table.Cell` (probed on 4.0.11: `source()`, `colspan`, `rowspan`
 * and `getAttributes()` all answer directly).
 */
interface OracleRubyCell {
  /**
   * The cell's own text BEFORE substitutions: `source` answers
   * `\@text` directly (`def source; \@text; end`, table.rb:391-393,
   * just above the `file`/`lineno` pair that reads `\@source_location`
   * instead), where `text` wraps the SAME `\@text` in `apply_subs`
   * (`def text; apply_subs \@text, \@subs; end`, table.rb:357-359).
   * `\@text` is `close_cell`'s already strip/style/csv-unquote-resolved
   * buffer (table.rb:617-683, `Table::Cell#initialize`). Structure,
   * not rendering, is this suite's question.
   */
  readonly source: () => string;
  /**
   * How many columns this cell spans, or `null` for a csv/dsv cell
   * (`Table::Cell#initialize` sets `\@colspan = \@rowspan = nil` when
   * it carries no cellspec at all, table.rb:285).
   */
  readonly colspan: number | null;
  /** How many rows this cell spans, or `null`; see `colspan`. */
  readonly rowspan: number | null;
  /** The cell's own attributes, `halign`/`valign`/`style` among them. */
  readonly getAttributes: () => Record<string, unknown>;
}

/**
 * The oracle's own `Table` shape, restated for the same reason as
 * {@link OracleRubyCell}: `table.rows` is a live property (an Opal
 * accessor, not a `getRows()` method), and `getAttribute("colcount")`
 * answers the resolved column count.
 */
interface OracleRubyTable {
  /** The table's rows, grouped by section. */
  readonly rows: {
    /** Header rows. */
    readonly head: OracleRubyCell[][];
    /** Body rows. */
    readonly body: OracleRubyCell[][];
    /** Footer rows. */
    readonly foot: OracleRubyCell[][];
  };
  /**
   * One node attribute's raw value.
   * @param name - the attribute's name
   * @returns the value, or undefined when unset
   */
  readonly getAttribute: (name: string) => unknown;
}

/**
 * One attribute value, read defensively: `getAttributes()` and
 * `getAttribute()` answer `unknown` here because Asciidoctor's own
 * attribute store is untyped.
 * @param value - the attribute's raw value
 * @returns the value as a string, or undefined when it is not one
 */
function stringAttribute(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * One oracle cell's structural facts.
 * @param cell - the oracle's own cell
 * @returns its colspan, rowspan, alignment and style
 */
function cellSpecOf(cell: OracleRubyCell): OracleCellSpec {
  const attributes = cell.getAttributes();
  return {
    colspan: cell.colspan ?? 1,
    rowspan: cell.rowspan ?? 1,
    halign: stringAttribute(attributes.halign),
    valign: stringAttribute(attributes.valign),
    style: stringAttribute(attributes.style),
  };
}

/**
 * One found table, read into {@link OracleTable}'s shape. Every table
 * in one document shares the same `severities`: they come from one
 * `load`, and Ruby's own log messages are not attributed to a single
 * table, so a warning anywhere in the document is a fact about all of
 * them here.
 * @param table - the oracle's own table
 * @param severities - the whole load's own logged severities
 * @returns the table's structure
 */
function oracleTableOf(
  table: OracleRubyTable,
  severities: readonly string[],
): OracleTable {
  const sections = [table.rows.head, table.rows.body, table.rows.foot];
  const rows: string[][] = [];
  const specs: OracleCellSpec[][] = [];
  for (const section of sections) {
    for (const row of section) {
      rows.push(row.map((cell) => cell.source()));
      specs.push(row.map(cellSpecOf));
    }
  }
  return {
    rows,
    specs,
    head: table.rows.head.length,
    foot: table.rows.foot.length,
    colcount: Number(table.getAttribute("colcount")),
    severities,
  };
}

/**
 * The oracle's own structural read of every table `findBy` meets in
 * `input`, in document order, via `load` rather than `convert`:
 * `load` reaches the parsed model (`doc.findBy({ context: "table" })`,
 * `table.rows`, each cell's `source()`/`colspan`/`rowspan`/
 * `getAttributes()`), which {@link convert}'s rendered HTML does not
 * expose (issue #10). Empty, not thrown, when `input` holds no table
 * context at all.
 *
 * Runs under its own `MemoryLogger`, passed as the `logger` load
 * option rather than swapped in through `LoggerManager`: `load`
 * accepts a per-call logger directly, so this needs no process-wide
 * state and is safe to run many of at once (`Promise.all` included).
 * @param input - AsciiDoc source text
 * @returns every table's structure, in document order
 */
export async function oracleTables(input: string): Promise<OracleTable[]> {
  const memory = MemoryLogger.create();
  const loadedDocument = await load(input, { safe: "safe", logger: memory });
  const found = loadedDocument.findBy({ context: "table" });
  const severities = memory
    .getMessages()
    .map((message) => message.getSeverity());
  return found.map((table) =>
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- @asciidoctor/core does not export Table's own shape; OracleRubyTable restates the probed 4.0.11 API
    oracleTableOf(table as unknown as OracleRubyTable, severities),
  );
}
