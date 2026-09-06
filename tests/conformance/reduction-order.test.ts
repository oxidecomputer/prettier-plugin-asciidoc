/**
 * The reduction order's own gate (issue #220).
 *
 * The order carries two obligations, and they are measured in two
 * places because they have two domains.
 *
 * NON-INCREASE runs over the vendored corpus, as a fifth differential
 * property (tests/conformance/properties.ts): it must hold of every
 * document there is, and it is a text scan over bytes that battery
 * already produced. Not over the registry sweep, for the reason
 * reduction-order.ts states under "WHERE IT IS NOT RUN".
 *
 * STRICT DECREASE is measured HERE, over the confluence roster
 * (confluence-variants.ts), because that roster IS the conversion
 * inventory: each row is a render-equal pair of spellings, and a row
 * the formatter converges is a landed conversion whose losing spelling
 * must descend the order. The claim's domain is exactly that roster,
 * placed at document level - not "every document", because a real
 * document's output differs from its input for layout reasons the
 * order does not rank (see reduction-order.ts, WHAT THE ORDER
 * DELIBERATELY DOES NOT RANK).
 *
 * THE PERTURBATION PROOF is the third block: rewrites built here, not
 * landed anywhere, that respell canonical output back into the
 * non-canonical spelling of each component in turn. A check that
 * passes because nothing ever raises the order is worth nothing, so
 * each perturbation is asserted to raise its own component AND NO
 * OTHER, and to be reported by the same `reductionBreach` the corpus
 * battery calls. Beside it stands the one pair in the tree that pins
 * the components' SEQUENCE, which no landed conversion exercises.
 */
import { describe, expect, test } from "vitest";
import { formatAdoc } from "../helpers.js";
import { BLOCK_VARIANTS, type Variant } from "./confluence-variants.js";
import {
  compareWeight,
  describeWeight,
  reductionBreach,
  weigh,
  WEIGHT_COMPONENTS,
  type SpellingWeight,
} from "./reduction-order.js";

/** One roster row with its axis, as a whole document, formatted. */
interface OrientedRow {
  /** `axis/variant`, the confluence gate's own declaration key. */
  readonly key: string;
  /** One spelling, as a whole document. */
  readonly left: string;
  /** The other spelling of the same content. */
  readonly right: string;
  /** What the left spelling formatted to. */
  readonly leftOut: string;
  /** What the right spelling formatted to. */
  readonly rightOut: string;
}

/**
 * The whole roster as documents: each variant at document level, which
 * is the placement every row stands in (`stands` narrows the OTHER
 * placements, never this one).
 * @returns one row per variant, in table order
 */
function rosterRows(): Array<{ key: string; variant: Variant }> {
  return Object.entries(BLOCK_VARIANTS).flatMap(([axis, variants]) =>
    variants.map((variant) => ({ key: `${axis}/${variant.id}`, variant })),
  );
}

/**
 * Formats both spellings of every roster row.
 * @returns the rows with their outputs, in table order
 */
async function orientedRows(): Promise<OrientedRow[]> {
  const rows: OrientedRow[] = [];
  for (const { key, variant } of rosterRows()) {
    const left = `${variant.left}\n`;
    const right = `${variant.right}\n`;
    // eslint-disable-next-line no-await-in-loop -- sequential on purpose, as runConfluence explains: the formatter is CPU-bound on this thread
    const leftOut = await formatAdoc(left);
    // eslint-disable-next-line no-await-in-loop -- same reason
    const rightOut = await formatAdoc(right);
    rows.push({ key, left, right, leftOut, rightOut });
  }
  return rows;
}

/**
 * The axes the order does not separate: the formatter keeps the two
 * spellings apart AND they weigh the same, so the order says nothing
 * about which way a conversion there would be oriented.
 *
 * A CONVERGING axis whose two sides weigh the same is not here: both
 * sides lose to the output, which is orientation, not a gap
 * (`sectionTitleSpelling/setext-underline-length` is that shape - two
 * underline lengths, both underlines, both formatting to the `=`
 * form).
 *
 * Seven rows, from two axes, and both are here for one reason: the
 * order derives from LANDED conversions only, without exception.
 *
 * Six are the list-marker axis, all declared confluence exceptions
 * (`listMarkerSpelling`, confluence-exceptions.ts). No conversion has
 * landed, so there is no landed evidence to derive a component from,
 * and inventing one would be the ad hoc orientation the order exists to
 * replace. When issue #42's respelling question is answered, the
 * conversion arrives with its own component and this list shrinks.
 *
 * The seventh is `link:target[]` against the bare URL. Its orientation
 * is not in doubt and its class is the one `generalPurposeForms`
 * already counts, but the conversion is formally PARKED (issue #219),
 * and charging a parked conversion here while refusing the marker axes
 * a component would be the same decision made two ways. #219 reopens on
 * two conditions - the capability-typed emission chokepoint (#221)
 * exists, and the inline reader carries a faithful pre-macros image of
 * the block - and the charge comes back with the conversion, not before
 * it.
 *
 * Pinned exactly in both directions: an axis that stopped tying is as
 * much a change as one that started.
 */
const UNORIENTED_AXES: readonly string[] = [
  "inlineSpelling/url-macro",
  "markerSpelling/callout-explicit-auto",
  "markerSpelling/olist-dot-arabic",
  "markerSpelling/olist-nested-dot-arabic",
  "markerSpelling/ulist-nested-star-dash",
  "markerSpelling/ulist-star-bullet",
  "markerSpelling/ulist-star-dash",
];

describe("the spelling reduction order", () => {
  test("every component is a count, which is what makes it well-founded", () => {
    const negative: string[] = [];
    for (const { variant } of rosterRows()) {
      for (const source of [variant.left, variant.right]) {
        const weight = weigh(`${source}\n`);
        for (const component of WEIGHT_COMPONENTS) {
          if (!Number.isInteger(weight[component]) || weight[component] < 0) {
            negative.push(`${source}: ${describeWeight(weight)}`);
          }
        }
      }
    }
    expect(negative).toEqual([]);
  });

  test("a spelling never outranks itself", () => {
    for (const { variant } of rosterRows()) {
      const weight = weigh(`${variant.left}\n`);
      expect(compareWeight(weight, weight)).toBe(0);
    }
  });

  test("formatting never raises the order on either spelling", async () => {
    const rows = await orientedRows();
    const raised: string[] = [];
    for (const row of rows) {
      const breaches = [
        reductionBreach(row.left, row.leftOut),
        reductionBreach(row.right, row.rightOut),
      ];
      for (const breach of breaches) {
        if (breach !== undefined) {
          raised.push(`${row.key}: ${breach}`);
        }
      }
    }
    expect(raised).toEqual([]);
  }, 120_000);

  test("every landed conversion strictly descends the order", async () => {
    const notDescending: string[] = [];
    for (const row of orientedRowsOf(await orientedRows())) {
      const output = weigh(row.leftOut);
      const heavier = [weigh(row.left), weigh(row.right)].some(
        (side) => compareWeight(output, side) < 0,
      );
      if (!heavier) {
        notDescending.push(row.key);
      }
    }
    expect(notDescending, UNORIENTED_HINT).toEqual([]);
  }, 120_000);

  test("the axes the order leaves unoriented are exactly the declared ones", async () => {
    const rows = await orientedRows();
    const tied = rows
      .filter(
        (row) =>
          row.leftOut !== row.rightOut &&
          compareWeight(weigh(row.left), weigh(row.right)) === 0,
      )
      .map((row) => row.key)
      .toSorted();
    expect(tied).toEqual([...UNORIENTED_AXES]);
  }, 120_000);
});

// The message a non-descending conversion carries: the two ways out,
// so the finding does not read as "make the gate green".
const UNORIENTED_HINT =
  "a converging conversion that does not descend the order is either mis-oriented " +
  "or names a component the order is missing; add the component from the landed " +
  "evidence, do not bend the order around one row";

/**
 * The rows that are LANDED conversions: the pair converges and its two
 * spellings differ, so one spelling was replaced by the other.
 * @param rows - every roster row, formatted
 * @returns the converging rows
 */
function orientedRowsOf(rows: readonly OrientedRow[]): OrientedRow[] {
  return rows.filter(
    (row) => row.leftOut === row.rightOut && row.left !== row.right,
  );
}

/**
 * One perturbation: a rewrite built here that respells canonical bytes
 * back into a non-canonical spelling, and the component it must raise.
 */
interface Perturbation {
  /** What it does, as the test's name. */
  readonly what: string;
  /** The canonical document it starts from - a roster spelling. */
  readonly canonical: string;
  /** The rewrite, applied to the canonical document. */
  readonly apply: (source: string) => string;
  /** The component the rewrite must raise. */
  readonly raises: keyof SpellingWeight;
}

/**
 * One perturbation per component, so the check is proved able to catch
 * a raise at every level of the order rather than at one of them.
 *
 * Each starts from a spelling the roster already holds canonical and
 * runs the landed conversion BACKWARDS - the exact shape of a rule
 * that would not terminate. None of these rewrites is in `src`; they
 * exist to fail the check on purpose.
 */
const PERTURBATIONS: readonly Perturbation[] = [
  {
    what: "respelling `'''` as the Markdown `---`",
    canonical: "a\n\n'''\n\nb\n",
    apply: (source) => source.replace("'''", "---"),
    raises: "compatibilityForms",
  },
  {
    what: "respelling the anchor line `[[id]]` as the `[#id]` shorthand",
    canonical: "[[id]]\n\npara\n",
    apply: (source) => source.replace("[[id]]", "[#id]"),
    raises: "generalPurposeForms",
  },
  {
    what: "spelling a listing delimiter two characters past its minimum",
    canonical: "----\ncode\n----\n",
    apply: (source) => source.replaceAll("----", "------"),
    raises: "redundantSyntax",
  },
  {
    what: "padding an attribute list after its comma",
    canonical: "[source,ruby]\n----\nx\n----\n",
    apply: (source) => source.replace("[source,ruby]", "[source, ruby]"),
    raises: "padding",
  },
  {
    what: "respelling `:!name:` as `:name!:`",
    canonical: ":!name:\n\ntext\n",
    apply: (source) => source.replace(":!name:", ":name!:"),
    raises: "nonPreferredForms",
  },
];

describe("the reduction check catches a rule that raised the order", () => {
  test.each(PERTURBATIONS)("$what", ({ canonical, apply, raises }) => {
    const perturbed = apply(canonical);
    expect(perturbed).not.toBe(canonical);
    const before = weigh(canonical);
    const after = weigh(perturbed);
    expect(after[raises]).toBeGreaterThan(before[raises]);
    // ITS OWN component and no other. Without this a recognizer that
    // began double-charging would leave the perturbation green, and
    // that failure mode is live rather than hypothetical: `### T`
    // already mints a compatibility form AND a doubled-mark occurrence.
    const others = WEIGHT_COMPONENTS.filter(
      (component) => component !== raises,
    );
    expect(others.map((component) => after[component])).toEqual(
      others.map((component) => before[component]),
    );
    expect(reductionBreach(canonical, perturbed)).toContain(
      "raised the reduction order",
    );
  });

  // THE LEXICOGRAPHIC PROOF: the only rows in this file that fail if
  // the five components are read any other way.
  //
  // No landed conversion moves two components in opposite directions
  // (0 of the 44 roster rows, 0 of the 1,614 corpus cases), so nothing
  // MEASURED distinguishes reading the components in sequence from
  // reading them pointwise ("no component may rise"), as a sum, or in
  // the reverse sequence. These two documents do. One trades a
  // compatibility form for two blank lines of padding, the other trades
  // back:
  //
  //   COMPATIBILITY_OVER_PADDING   compatibility 1, padding 0
  //   PADDING_OVER_COMPATIBILITY   compatibility 0, padding 2
  //
  // Descending the order means the first may become the second and not
  // the reverse. A POINTWISE reading refuses the first direction
  // (padding rose); a SUM refuses it too (1 against 2) and permits the
  // second (2 against 1); the REVERSE sequence does the same as the
  // sum. Only the sequence as written passes both rows.
  const COMPATIBILITY_OVER_PADDING = "a\n\n---\n\nb\n";
  const PADDING_OVER_COMPATIBILITY = "a\n\n'''\n\n\n\nb\n";

  test("the components are read in sequence, not as a set or a sum", () => {
    const higher = weigh(COMPATIBILITY_OVER_PADDING);
    const lower = weigh(PADDING_OVER_COMPATIBILITY);
    // The two documents are the shape the argument needs, measured
    // here rather than asserted in the comment above.
    expect(lower.compatibilityForms).toBeLessThan(higher.compatibilityForms);
    expect(lower.padding).toBeGreaterThan(higher.padding);
    expect(
      reductionBreach(COMPATIBILITY_OVER_PADDING, PADDING_OVER_COMPATIBILITY),
    ).toBeUndefined();
  });

  test("and the same trade backwards is a breach", () => {
    expect(
      reductionBreach(PADDING_OVER_COMPATIBILITY, COMPATIBILITY_OVER_PADDING),
    ).toContain("raised the reduction order");
  });

  // And the floor: a document the formatter leaves alone must not
  // register as a breach, or every green run would be luck.
  test("an unchanged document is no breach", () => {
    for (const { variant } of rosterRows()) {
      const source = `${variant.left}\n`;
      expect(reductionBreach(source, source)).toBeUndefined();
    }
  });
});
