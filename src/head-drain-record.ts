/**
 * THE HEAD-DRAIN RECORD: the type of what the reader decides about
 * the run of `//`-headed lines at one list-like item's head, and the
 * printer reads back.
 *
 * A LEAF, deliberately, for the reason src/whitespace-record.ts is
 * one: src/ast.ts names the record on the body both item kinds
 * share, and the module that CONSTRUCTS it
 * (src/parse/lines/list-read.ts) names the AST's own node types.
 * Declaring the record there would make the cross-file cycle the
 * metrics graph gate refuses even for type-only imports
 * (scripts/metrics/graph.ts). Nothing is imported here, so nothing
 * can.
 */
/**
 * What `parse_list_item`'s head drain did with the run of `//`-headed
 * lines at an item's head.
 *
 * WHY THE READER AND NOT THE PRINTER. `parse_list_item` peeks past a
 * run of `//`-headed lines before it reads an item's first block and
 * unshifts the run only when a line FOLLOWS it (parser.rb l.1362-71,
 * over `Reader#skip_line_comments`, reader.rb l.332-345). Which of
 * the peek's three answers an item got is a fact about THE LINES ITS
 * BUFFER HELD, and the drain's own spelling is the bare `//` prefix,
 * wider than `CommentLineRx`. Deriving it from the words the printer
 * is about to write asks a different question: a run whose paragraph
 * carries a second word or an inline node is one the drain takes and
 * the words say it does not, so the shield that keeps that paragraph
 * alive was withheld from every such run (issue #267).
 *
 * TWO ARMS FOR THREE ANSWERS, and the merge is what makes the record
 * a FIXED POINT rather than a fact the printer destroys. The
 * reference's `dropped` answer - the run reached the buffer's end and
 * every line of it was lost - changes no rendering a printer can
 * protect: the lines come back as a replay where they stood, and
 * whether the next read loses them again is a question about that
 * read's own buffer. Told apart from `kept` it would be a fact the
 * printed bytes do not carry: one corpus document (an item whose text
 * wraps over a `// c` line) moves from one answer to the other with
 * no byte and no rendering changing. So both collapse into `none`.
 *
 * WHAT HOLDS THE SURVIVING ARM STILL is the item's own reflow guard.
 * A detached run's reading is its POSITION - at the buffer's head it
 * is the item's first block, one line lower it is the text's own last
 * words - so `nextLineNeedsItsPosition`
 * (src/parse/lines/list-item-node.ts) keeps the item's opening line
 * exactly as the source spelled it wherever a run was detached. The
 * run therefore still heads the buffer on the next read, and the same
 * peek reaches the same arm.
 *
 * NO PAYLOAD, and the two questions a payload would have carried are
 * both answered elsewhere. Whether a `+` stood under the run is
 * implied: for a detached run to be an item's WHOLE body the trailing
 * blank must have survived `buffer.pop if (last_line = buffer[-1]) &&
 * last_line.empty?` (parser.rb l.1584-85), and the only thing that
 * breaks that walk one line under the blank is the marker pop's own
 * `ListContinuationMarker === last_line` (l.1580-82). Whether the run
 * RENDERS is not asked at all - a line the next read's drain loses is
 * a line lost whatever it renders, so the shield is written over a
 * run of true `//` comments too.
 *
 * EVERY ARM BELOW IS A NAMED INTERFACE, never written inline in a
 * union, and neither of them is exported: {@link HeadDrainFact} is
 * what travels. The record census names an anonymous union member by
 * position, so a change that reordered inline arms would rename every
 * one of them.
 */
export type HeadDrainFact = UndrainedItem | DetachedRun;

/**
 * The peek's other two answers together. `kept`: no run left the
 * item's buffer, because the peek took none or because a non-blank
 * line under the run put every line back into an item that is
 * content-adjacent, so each line is where the item's own scan left it
 * and is printed there. `dropped`: the run reached the buffer's END,
 * so `unshift_lines` never ran and the reference lost it; its lines
 * come back as a replay where they stood and the next read loses them
 * the same way. Neither leaves a block standing that a `+` could
 * shield.
 */
interface UndrainedItem {
  /** Arm discriminant. */
  readonly kind: "none";
}

/**
 * A BLANK stopped the peek, so the run went back into the reader
 * without making the item content-adjacent (`unless
 * subsequent_line.empty?` guards `content_adjacent = true`,
 * parser.rb l.1366-67): the run reads as the item's own first block,
 * or as the whole description of a term line that carried none.
 */
interface DetachedRun {
  /** Arm discriminant. */
  readonly kind: "detached";
}
