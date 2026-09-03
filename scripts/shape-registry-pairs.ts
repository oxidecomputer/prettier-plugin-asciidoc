/**
 * The width-2 pair grid: any two alphabet members, adjacent or across
 * a blank line, in a body-context subset; in its own module because
 * scripts/shape-registry.ts is at its `max-lines` ceiling and the
 * coding standard splits rather than condenses (the same reason
 * scripts/shape-registry-list-run.ts and
 * scripts/shape-registry-byte-operators.ts exist). It reads the
 * registry's construct and container dimensions, so the dependency
 * is CIRCULAR, unlike the list-run precedent: shape-registry.ts
 * re-exports pairGrid while this module imports the registry's
 * dimension tables back. The cycle is tolerated by keeping this
 * module's top level free of registry reads (see pairAlphabet's
 * laziness note below); consumers (scripts/metrics/shape-census.ts)
 * may import both sides
 * `pairGrid` and `pairAlphabet` from here.
 *
 * The alphabet is every `ConstructEntry.body` plus every `nearMiss`:
 * the almost-valid space is where classification flips live, so a
 * near miss belongs beside its valid twin, not only beside itself.
 * The pair is exhaustive over that alphabet times two joins (adjacent,
 * blank) times a small container subset, since a full product across every
 * `CONTAINERS` entry is quadratic in the alphabet size and unneeded:
 * the three kept containers cover the distinct reading regimes
 * (unconfined, item-confined, dlist description) that a pair's
 * classification can depend on.
 *
 * A LIBRARY module, not a command, on the same terms as
 * `scripts/shape-registry.ts`.
 */
import { CONSTRUCTS, CONTAINERS, type Shape } from "./shape-registry.js";

/** One pair-alphabet member: a construct's canonical body, or one near miss. */
export interface PairAlphabetMember {
  /** Stable name: the construct id, or `<constructId>-near-<index>`. */
  readonly id: string;
  /** The text this member contributes to a pair. */
  readonly body: string;
}

/**
 * The pair alphabet: every construct body and every near miss. A
 * delimited construct's `body` is already its CLOSED form
 * (`DELIMITER_PARTS`-derived `open\ncontent\nclose`, not a bare
 * opener) because that is what `ConstructEntry.body` stores for those
 * dimensions; pairing it directly, with no separate realization step,
 * keeps the grid from drowning in unterminated-block rows that Task 1
 * of the standing grid already covers.
 * @returns the alphabet, in `CONSTRUCTS` order
 */
export function pairAlphabet(): readonly PairAlphabetMember[] {
  return CONSTRUCTS.flatMap((entry) => [
    { id: entry.id, body: entry.body },
    ...entry.nearMisses.map((miss, index) => ({
      id: `${entry.id}-near-${String(index)}`,
      body: miss,
    })),
  ]);
}

/** How two alphabet members meet: touching, or separated by one blank line. */
const PAIR_JOINS: ReadonlyArray<{
  readonly id: string;
  readonly glue: string;
}> = [
  { id: "adjacent", glue: "\n" },
  { id: "blank", glue: "\n\n" },
];

/**
 * The body contexts pairs run in; a subset because the pair product is
 * quadratic where the standing grid is linear. The three cover the
 * distinct reading regimes: unconfined, item-confined, dlist
 * description.
 */
const PAIR_CONTAINER_IDS = new Set(["doc", "item", "dlist-desc-line"]);

/**
 * Every alphabet id that spells `commentBlock` material (the
 * construct's own body and each of its near misses), so a pair
 * carrying one can be marked `renderBlind`, matching the standing
 * grid's comment-block exemption (a comment block renders nothing, so
 * render equality across such a pair is vacuous). A function, not a
 * module-scope constant: `shape-registry.ts` re-exports this module,
 * so the two files import each other, and a top-level read of
 * `CONSTRUCTS` here can run before that circular import finishes
 * initializing it. Computed inside `pairGrid()` instead, the same way
 * `pairGrid()` already reads `CONTAINERS` lazily.
 * @returns the comment-block member ids
 */
function commentBlockAlphabetIds(): ReadonlySet<string> {
  return new Set(
    CONSTRUCTS.filter((entry) => entry.delimiter === "commentBlock").flatMap(
      (entry) => [
        entry.id,
        ...entry.nearMisses.map(
          (_, index) => `${entry.id}-near-${String(index)}`,
        ),
      ],
    ),
  );
}

/**
 * The width-2 pair grid: deterministic and exhaustive over the
 * alphabet x alphabet x join x container product, deduplicated on the
 * realized document (a near miss can coincide with another member's
 * canonical spelling). Realized size pinned by the census (rule (v)).
 * @returns the realized rows, in a stable order
 */
export function pairGrid(): Shape[] {
  const alphabet = pairAlphabet();
  const containers = CONTAINERS.filter((container) =>
    PAIR_CONTAINER_IDS.has(container.id),
  );
  const commentBlockIds = commentBlockAlphabetIds();
  const shapes: Shape[] = [];
  const seen = new Set<string>();
  for (const first of alphabet) {
    for (const second of alphabet) {
      for (const join of PAIR_JOINS) {
        for (const container of containers) {
          const input = container.wrap(first.body + join.glue + second.body);
          if (seen.has(input)) {
            continue;
          }
          seen.add(input);
          shapes.push({
            id: `pair/${first.id}/${second.id}/${join.id}/${container.id}`,
            input,
            renderBlind:
              commentBlockIds.has(first.id) || commentBlockIds.has(second.id),
          });
        }
      }
    }
  }
  return shapes;
}
