/**
 * THE ONE CONSTRUCTION SITE for a span's mark record
 * ({@link SpanMarks}, src/mark-record.ts).
 *
 * Called from the builder that turns a resolved span into its node,
 * so the record is made AFTER the marks are paired and from the same
 * token slice the span's children are built from. That ordering is
 * the whole point: which characters stand inside a span is a fact
 * only the pairing settles, and it settles it once.
 */
import { ASCII_WHITESPACE } from "../line-shapes.js";
import type { MarkFact, SpanMarks } from "../../mark-record.js";
import type { InlineToken } from "./tokens.js";

/** The one value of each arm; neither carries a payload. */
const ENTANGLED: MarkFact = { kind: "entangled" };
const ISOLATED: MarkFact = { kind: "isolated" };

/** Which of a span's two marks a question is about. */
type MarkSide = "open" | "close";

/**
 * The content character facing one mark.
 *
 * The content is the tokens between the marks, in the order the
 * builder recurses into them, so the first character of the first
 * token faces the opening mark and the last character of the last
 * token faces the closing one. Reading the TOKENS rather than the
 * document is what makes the answer survive the recursion: a nested
 * span's own slice is the same shape, and no offset arithmetic is
 * repeated.
 * @param content - the span's content tokens, in source order.
 * @param side - which mark to look inside of.
 * @returns that character, or undefined where the span holds no
 *   content at all.
 */
function facingCharacter(
  content: readonly InlineToken[],
  side: MarkSide,
): string | undefined {
  switch (side) {
    case "open": {
      return content.at(0)?.image.at(0);
    }
    case "close": {
      return content.at(-1)?.image.at(-1);
    }
  }
}

/**
 * The fact of one mark.
 *
 * ASCII whitespace and not JavaScript's `\s`: the class the
 * constrained rows' `\S` complements is Ruby's, which is the literal
 * `[ \t\r\n\f\v]` ({@link ASCII_WHITESPACE}, issue #75), so a
 * no-break space against a mark is CONTENT and leaves the mark
 * entangled.
 *
 * A span with no content at all cannot arise from the pairing - a
 * close adjacent to its own open is skipped (`closeForOpen`,
 * src/parse/inline/span-pairing.ts), so `____` is never a span - and
 * the arm such a span would take is stated rather than left to a
 * fallback: nothing stands between the two marks, which is what
 * entangled means.
 *
 * SURVIVING BYTES, per arm, at the site that assigns it. `entangled`
 * is carried by the mark and the content character flush against it,
 * and the printer writes those two adjacent, so its carrying bytes
 * are re-emitted and a second read re-derives the arm. `isolated` is
 * carried by the whitespace between them, and the printer writes at
 * least one whitespace byte there (the fusion's space, a run whose
 * bytes it replays, or a break the whitespace record holds), so its
 * carrying bytes are re-emitted too. Neither arm consumes the
 * whitespace's SPELLING, which is the one thing here that a fold
 * would destroy.
 * @param content - the span's content tokens, in source order.
 * @param side - which mark to answer for.
 * @returns the mark's fact.
 */
function markFact(content: readonly InlineToken[], side: MarkSide): MarkFact {
  const facing = facingCharacter(content, side);
  return facing !== undefined && ASCII_WHITESPACE.test(facing)
    ? ISOLATED
    : ENTANGLED;
}

/**
 * The mark record of one span, read off its content's own bytes.
 * @param content - the span's content tokens, in source order.
 * @returns what each of the span's two marks stands against.
 */
export function spanMarkFacts(content: readonly InlineToken[]): SpanMarks {
  return {
    open: markFact(content, "open"),
    close: markFact(content, "close"),
  };
}
