/**
 * The two ways bytes may reach the output, and the type that keeps a
 * third one out of the honest paths.
 *
 * The printer either REPLAYS what the source spelled or emits a
 * respelling some rule licenses. Until this module existed both looked
 * the same in the code - a string handed to an atom - so "every byte we
 * changed is an application of a declared rule" was a property to
 * check after the fact, by rendering the output and comparing. Three
 * bugs in this repository's history were the same failure of it: the
 * admonition fold firing in item-text position, the gridgaps newline
 * destruction, and the bare-URL absorptions all changed bytes at a site
 * no rule licensed.
 *
 * The shape here moves most of that from a check to the types. An
 * {@link Emission} is nominal - a class with a `#private` field - so
 * the only two ways to WRITE one are {@link replay}, which anybody may
 * call and which changes nothing, and {@link declareRule}, which
 * demands the five things a rule has to say about itself before it may
 * respell anything.
 *
 * WHAT THAT DOES AND DOES NOT BUY, exactly, because an earlier draft of
 * this comment overclaimed it. Every honest way to obtain an emission -
 * writing one, copying one, spreading one, assembling one from a
 * genuine one's parts - runs through this module's two constructors,
 * and the attempts are compiled one by one in
 * `tests/print/emission-forgery.test.ts`. What remains is what no type
 * system refuses: a written-out type ASSERTION (`as Emission<T>`, or
 * the `Object.assign` intersection that is an assertion in all but
 * spelling) forges one anyway. That is not a hole this design can
 * close, and the mitigation is narrower than it sounds. An assertion
 * that NAMES this module's type is greppable, and the check that keeps
 * the value capability to ONE module
 * (`tests/print/declared-rules.test.ts`) bounds where a holder may
 * sit; that is why the check is part of the design and not a belt on
 * top of it. One form escapes both: `Object.assign` can take its
 * result type off a value that already holds an emission
 * (`ReturnType<typeof held>`), so it spells neither the module nor the
 * type, no grep has a token to look for and no location check has a
 * specifier to match. Reading the diff is what is left against that
 * one. The forgery test records which attempts the compiler refuses
 * and which of the survivors name this module at all, so the domain is
 * measured rather than claimed.
 *
 * A SECOND thing the types cannot decide, said plainly: no type knows
 * which bytes the source actually spelled, so {@link replay} takes the
 * bytes it is handed and believes them. That is the design's other
 * trust point, and what it buys is that the trust point is ONE line per
 * converted site - the derivation from the recorded node - instead of
 * every string literal on the printing path. Both trust points sit in
 * the same place, and that is the property the location check pins: no
 * module but the rules module imports this one, so both arms of every
 * conversion stand next to each other where a reader can compare them.
 *
 * MIGRATION, not a finished state. One site goes through this today
 * (the delimiters a formatting span prints, src/print/declared-rules.ts);
 * every other emission path still writes strings directly, and converts
 * as its axis is touched. So the guarantee is exact and narrow: it
 * holds AT a site that asks for its bytes through this module, and says
 * nothing about a site that has not converted yet.
 */

/** The licence a replayed emission carries: no rule, no change. */
const REPLAY = "replay";

/**
 * What a rule says about itself before it may change a byte.
 *
 * Five fields, each of which a review would otherwise have to ask for
 * by hand. They are data rather than prose so a reader can find every
 * rule's answer in one place, and so the rules can be enumerated -
 * which is what critical-pair analysis needs (docs/architecture.md,
 * obligation 4).
 */
interface RuleDeclaration {
  /** What the rule is called in reports and in issue threads. */
  readonly id: string;
  /** The shape it matches, in one line, as the code below decides it. */
  readonly matches: string;
  /**
   * Why the respelling preserves meaning: the Ruby row, spec page or
   * measurement that says the two spellings render the same.
   */
  readonly licence: string;
  /** The gates that would fail if the rule stopped holding. */
  readonly pins: readonly string[];
  /**
   * The reduction-order component this rule strictly decreases
   * (docs/architecture.md, "The spelling reduction order"), in one
   * line - the orientation every conversion states in place of a
   * per-case argument that the target spelling is nicer.
   */
  readonly decreases: string;
}

/**
 * Bytes the printer may write at a site that asks through this module,
 * with the licence they were written under.
 *
 * A class holding a `#private` field, not an object carrying a branded
 * key, and the difference is the whole guarantee. A branded key is
 * STRUCTURAL: any value with that key has the type, and a spread
 * (`{ ...genuine, bytes: mine }`) copies the key off an emission the
 * caller legitimately holds, so a forgery needs no assertion and no
 * `any` - it type-checks. A private field is NOMINAL: the only values
 * that have one are the ones this file's constructor made, and the
 * same spread does not compile. `tests/print/emission-forgery.test.ts`
 * compiles this module against each attempt and records which ones the
 * type stops.
 *
 * Generic in what the site's bytes ARE - a span's two delimiters here,
 * a delimiter run or an attribute value at the next site - because the
 * licence question is the same whatever shape the bytes have; and
 * generic in the LICENCE so that {@link NormalizedSpelling} is this
 * same class with the replay arm removed, rather than a second type
 * whose relationship to this one has to be maintained.
 */
class LicensedEmission<Bytes, Licence extends RuleDeclaration | typeof REPLAY> {
  /**
   * The licence, held privately. This field is what makes the type
   * nominal; it is read through {@link LicensedEmission.licence}.
   */
  readonly #licence: Licence;

  /** The bytes themselves. */
  readonly bytes: Bytes;

  /**
   * Construct an emission. Reachable only from this module, which is
   * what {@link replay} and {@link declareRule} are.
   * @param licence - the rule that licensed these bytes, or
   *   {@link REPLAY} where they are the recorded spelling.
   * @param bytes - the bytes themselves.
   */
  constructor(licence: Licence, bytes: Bytes) {
    this.#licence = licence;
    this.bytes = bytes;
  }

  /**
   * The rule that licensed these bytes, or {@link REPLAY} where they
   * are the spelling the source already had.
   * @returns the licence these bytes were written under.
   */
  get licence(): Licence {
    return this.#licence;
  }
}

/**
 * Bytes and their licence, whichever arm they came out of: what a
 * converted site receives.
 */
export type Emission<Bytes> = LicensedEmission<
  Bytes,
  RuleDeclaration | typeof REPLAY
>;

/**
 * An emission a DECLARED RULE licensed: the only kind that may differ
 * from what the source spelled. {@link declareRule} is its one
 * constructor, so a respelling nobody declared cannot be expressed.
 */
type NormalizedSpelling<Bytes> = LicensedEmission<Bytes, RuleDeclaration>;

/**
 * A rule, declared and ready to apply: its declaration, readable, and
 * the one function that turns a site into the bytes it licenses.
 */
interface DeclaredRule<Site, Bytes> {
  /** What the rule says about itself. */
  readonly declaration: RuleDeclaration;
  /**
   * Apply the rule at one site.
   * @param site - the site being spelled.
   * @returns the respelling it licenses, or undefined where the rule
   *   does not match this site at all.
   */
  readonly apply: (site: Site) => NormalizedSpelling<Bytes> | undefined;
}

/**
 * Replay the spelling the source already had. Unrestricted, because
 * replaying changes nothing: the capability every caller has.
 * @param bytes - the recorded source spelling.
 * @returns the emission that writes it back.
 */
export function replay<Bytes>(bytes: Bytes): Emission<Bytes> {
  return new LicensedEmission(REPLAY, bytes);
}

/**
 * Declare a rule, which is the only way to obtain the capability to
 * change bytes.
 *
 * `Bytes` excludes `undefined` so that "the rule did not match" and
 * "the rule matched and licenses nothing" cannot be the same value:
 * `respell` returning undefined means the first, always.
 * @param declaration - the five things the rule says about itself.
 * @param respell - the rule's body: the bytes it licenses at a site,
 *   or undefined where its match shape does not hold there.
 * @returns the rule, applicable at a site.
 */
export function declareRule<Site, Bytes extends NonNullable<unknown>>(
  declaration: RuleDeclaration,
  respell: (site: Site) => Bytes | undefined,
): DeclaredRule<Site, Bytes> {
  return {
    declaration,
    apply: (site) => {
      const bytes = respell(site);
      return bytes === undefined
        ? undefined
        : new LicensedEmission(declaration, bytes);
    },
  };
}
