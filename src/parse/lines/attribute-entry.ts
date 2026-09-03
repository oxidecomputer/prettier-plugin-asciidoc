/**
 * How far an attribute entry reaches, and what its value is.
 *
 * Most entries are one line and this module is a pass-through for
 * them. A value ending in ` \` (or the legacy ` +`) is not:
 * `process_attribute_entry` (parser.rb l.2103-20) keeps reading lines
 * into the same value until one does not end with that same suffix,
 * stopping at a blank line or at the end of input, and the caller
 * then discards every line it read. So the entry's extent is decided
 * HERE, where the following lines are visible, and both readers that
 * can meet an attribute entry - the document header's
 * (header-reader.ts) and the block reader's - take their resume index
 * from it rather than each counting lines for themselves.
 *
 * WHAT THE FORMATTER DOES with a continued entry: it keeps the
 * author's split points and the lines exactly as they were written.
 * Asciidoctor joins the pieces into one value (with a space, or with
 * a newline behind a ` +` hard break) and lstrips every continuation
 * line before joining, so the alignment an author writes under the
 * value is invisible to the rendered document - which cuts both ways.
 * Nothing downstream can see the split points, so preserving them
 * cannot change what the document renders as; and joining the pieces
 * onto one line, besides destroying the alignment, would have to
 * re-derive the value Asciidoctor computes rather than reprint the
 * one the author wrote. The value therefore travels as the SOURCE
 * spelling, newlines and all, and the printer writes those lines back
 * (src/print/blocks.ts, `printAttributeEntry`) - the same shape a
 * block comment's `value` carries.
 *
 * A DANGLING suffix - ` \` with a blank line or end of input under it
 * - continues nothing and is left exactly where it stands. It is one
 * line, so the entry is the ordinary case, and Asciidoctor strips the
 * suffix off the value either way.
 */
import type { AttributeEntryFields } from "../../ast.js";
import type { Fragment } from "../positions.js";
import { attributeContinuation } from "./classify.js";
import { fragmentOfLine, type SourceLine } from "./split.js";

/** One attribute entry, as far as it reaches. */
interface AttributeEntryRead {
  /**
   * What the node is built from: the classifier's own fields for a
   * one-line entry, and the same fields with the value replaced by
   * the source spelling of every line it runs onto for a continued
   * one.
   */
  readonly fields: AttributeEntryFields;
  /** The whole entry's span, first line through last. */
  readonly span: Fragment;
  /** Index of the first line past the entry. */
  readonly resume: number;
}

/**
 * The lines a continued value runs onto, in source order.
 *
 * The loop is `process_attribute_entry`'s (parser.rb l.2109-14) with
 * its two exits kept apart: the `while` condition stops at a blank
 * line or at end of input, and `break unless keep_open` stops one
 * line AFTER a line that does not repeat the suffix - that last line
 * belongs to the value, which is why it is pushed before the test.
 * Ruby lstrips each line and rstrips the suffix off it; neither is
 * done here, because the lines are kept as the author wrote them and
 * neither strip can change whether a line ends with the suffix.
 * @param lines - the stream the entry was read from
 * @param from - index of the first line below the entry
 * @param suffix - the two characters the entry's own line ended with
 * @returns the continuation lines, empty when nothing continued
 */
function continuationLines(
  lines: readonly SourceLine[],
  from: number,
  suffix: string,
): SourceLine[] {
  const taken: SourceLine[] = [];
  for (let index = from; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.text === "") {
      break;
    }
    taken.push(line);
    if (!line.text.endsWith(suffix)) {
      break;
    }
  }
  return taken;
}

/**
 * Read the attribute entry standing at `index`.
 *
 * Total: an entry that continues nothing answers with its own line
 * and the classifier's own fields, so the callers have one path.
 * @param scan - the stream the entry stands in and the source its
 *   spans are cut from; both readers that can meet an attribute entry
 *   already carry these two facts together
 * @param scan.source - the whole document, for the span's image
 * @param scan.lines - the lines this reader walks
 * @param index - index of the entry's own line
 * @param fields - the classifier's parse of that line
 * @returns the entry's fields, span and resume index
 */
export function readAttributeEntry(
  scan: { readonly source: string; readonly lines: readonly SourceLine[] },
  index: number,
  fields: AttributeEntryFields,
): AttributeEntryRead {
  const { source, lines } = scan;
  const line = lines[index];
  const oneLine = {
    fields,
    span: fragmentOfLine(line),
    resume: index + 1,
  };
  const continues = attributeContinuation(fields.value);
  if (continues === undefined) {
    return oneLine;
  }
  const taken = continuationLines(lines, index + 1, continues.suffix);
  const last = taken.at(-1);
  if (last === undefined) {
    return oneLine;
  }
  return {
    fields: {
      ...fields,
      value: [continues.value, ...taken.map((each) => each.text)].join("\n"),
    },
    span: {
      image: source.slice(line.offset, last.offset + last.raw.length),
      offset: line.offset,
    },
    resume: index + 1 + taken.length,
  };
}
