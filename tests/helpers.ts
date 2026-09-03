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
import { LoggerManager, NullLogger, convert } from "@asciidoctor/core";
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
  const result = await convert(input, {
    safe: "safe",
    logger: nullLogger,
  });
  if (typeof result !== "string") {
    throw new TypeError("expected convert() to return a string");
  }
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
    withPlaceholders
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
