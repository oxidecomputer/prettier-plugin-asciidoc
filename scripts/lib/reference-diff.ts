/**
 * Measuring the INSTRUMENT against the REFERENCE: where
 * `@asciidoctor/core` and Asciidoctor's Ruby gem read the same
 * document differently.
 *
 * WHY THIS EXISTS. Two documents in this repository say the same
 * thing in two different ways. `docs/architecture.md` says the oracle
 * wins where our reading of the Ruby and the oracle disagree, and
 * `docs/coding-standards.md` calls the Ruby "the design spec it was
 * transpiled from". The second is not true of the program we render
 * through: `@asciidoctor/core`'s own README says its code "was
 * generated from the Ruby source using Claude Code" and reviewed by a
 * person. A rewrite is not a transpile, so the distance between the
 * program the registries CITE and the program the harnesses MEASURE
 * is a real quantity, and until this harness nothing had measured it
 * over a population.
 *
 * WHAT A ROW IS NOT. Most differences between two HTML converters are
 * not disagreements about the document. Each row therefore carries a
 * FAMILY, and each family carries its own classification, written
 * beside it in {@link FAMILIES}:
 *
 * - `environment`: the two runtimes supply a value differently (their
 *   own version, a path). Not a defect in either.
 * - `converter`: the same reading, spelled differently in HTML. Not a
 *   defect in either, but it is why a byte-for-byte comparison of the
 *   two programs is useless without this classification.
 * - `reading`: the two programs read the document differently. These
 *   are the rows that matter, and each one is either an instrument
 *   defect or a reference defect.
 *
 * The classification is per family and not per row, so that adding a
 * row to a family is a decision somebody already made and can be
 * argued with, rather than a judgement made silently at triage time.
 */
import { readFileSync } from "node:fs";
import { conformanceFold } from "../../tests/helpers.js";

/**
 * What a render is replaced by when the program REFUSED the
 * document.
 *
 * Both programs refuse some corpus documents (a backend neither can
 * convert to, an include neither may resolve in safe mode), and each
 * one words its refusal differently. Comparing the wordings would
 * make every jointly refused document a difference about nothing, so
 * a refusal on either side becomes this constant: two refusals are
 * equal, and a document one program renders and the other refuses is
 * a difference that says something.
 */
export const REFUSED = "RENDER_REFUSED";

/** What a family of differences says about the two programs. */
type Classification = "environment" | "converter" | "reading";

/** One family of differences, with the rule that recognizes it. */
export interface Family {
  /** The ledger's key for the family. */
  readonly name: string;
  /** What the family says about the two programs. */
  readonly classification: Classification;
  /** Why that classification, in one sentence a reviewer can dispute. */
  readonly reason: string;
  /**
   * Whether a pair of normalized renders belongs to this family. Read
   * in {@link FAMILIES} order, first match wins, so a narrow family
   * must stand before a broad one.
   */
  readonly holds: (reference: string, oracle: string) => boolean;
}

/**
 * The two tags a converter may spell a width on. The lookahead is
 * what keeps `<colgroup>` out: it is not a width-carrying tag, and a
 * rule that reduced it to a bare tag would be discarding an element
 * name.
 */
const WIDTH_TAG = /<(?:col|table)(?=[\s>])[^>]*>/gv;

/** The number inside a `style="width: N%;"` or a `width="N%"`. */
const WIDTH_VALUE = /(?<width>\d+(?:\.\d+)?)%/v;

/**
 * The widths a document's `<table>` and `<col>` tags carry, in
 * document order.
 * @param html - normalized HTML
 * @returns one entry per tag: its width, or the empty string where it
 *   carries none
 */
function widths(html: string): string[] {
  return [...html.matchAll(WIDTH_TAG)].map(
    ([tag]) => WIDTH_VALUE.exec(tag)?.groups?.width ?? "",
  );
}

/** The width attribute itself, in either of its two spellings. */
const WIDTH_ATTRIBUTE = / (?:style="width: ?[\d.]+%;?"|width="[\d.]+%")/gv;

/**
 * The document with only the WIDTH ATTRIBUTE removed from its
 * width-carrying tags, and everything else about those tags left
 * standing.
 *
 * Removing the whole tag would discard the rest of it, and the rest
 * of a `<table>` tag is a reading: `frame-ends` against
 * `frame-topbot`, a grid, a float, `stripes-even`. Those say what the
 * document MEANS and must fall through to the reading family, so only
 * the attribute the rule exists for is set aside.
 * @param html - normalized HTML
 * @returns the same HTML with the width attributes gone
 */
function withoutWidths(html: string): string {
  return html.replaceAll(WIDTH_TAG, (tag) =>
    tag.replaceAll(WIDTH_ATTRIBUTE, ""),
  );
}

/**
 * The class tokens a syntax highlighter writes, and nothing else.
 *
 * `language-<name>` is here because the name in it is the same fact
 * as `data-lang`, which is compared rather than discarded; every
 * other token on a `<pre>` or `<code>` is the document's own and
 * stays. The name matches anything but a space or a quote because it
 * comes from the block's attrlist and a document may spell it
 * however it likes (`[source, n/a]` writes `language-n/a`); nothing
 * is lost by that width, since a language the two programs disagree
 * about differs in `data-lang` as well.
 */
const HIGHLIGHTER_CLASS =
  /^(?:highlight|nowrap|rouge|pygments|coderay|CodeRay|language-[^\s"]+)$/v;

/**
 * The document with the highlighter's own class tokens removed from
 * `<pre>` and `<code>`, and nothing else touched.
 *
 * An earlier form reduced both tags to bare tags, which discarded an
 * `id`, a role, and the LANGUAGE the block's attrlist asked for -
 * each of which is a reading. `data-lang` is deliberately left in
 * place: it carries the language, so two programs that disagree
 * about it disagree about the document.
 * @param html - normalized HTML
 * @returns the same HTML with only highlighter classes dropped
 */
function stripDressing(html: string): string {
  return html.replaceAll(/<(?:pre|code)(?=[\s>])[^>]*>/gv, (tag) =>
    tag.replaceAll(/ class="(?<tokens>[^"]*)"/gv, (attribute, tokens) => {
      const kept = String(tokens)
        .split(" ")
        .filter((token) => token !== "" && !HIGHLIGHTER_CLASS.test(token));
      return kept.length === 0 ? "" : ` class="${kept.join(" ")}"`;
    }),
  );
}

/**
 * Whether the two sides are the same document once BOTH kinds of
 * dressing are set aside, with every width proved equal number by
 * number.
 *
 * The two normalizations are applied together because one document
 * can carry both (a highlighted source block inside a table), and a
 * rule that stripped only its own dressing would call such a row a
 * reading difference. The widths are compared rather than stripped:
 * a width is a reading (it comes from the table's attributes and from
 * what each program computed), so a table or column the two programs
 * sized differently must fall through to the reading family.
 * @param reference - the reference's normalized HTML
 * @param oracle - the oracle's normalized HTML
 * @returns whether nothing but dressing separates them
 */
function equalAfterDressing(reference: string, oracle: string): boolean {
  const left = widths(reference);
  const right = widths(oracle);
  return (
    left.length === right.length &&
    left.every((width, index) => width === right[index]) &&
    stripDressing(withoutWidths(reference)) ===
      stripDressing(withoutWidths(oracle))
  );
}

/** Every `<pre>` and `<code>` tag, which is where dressing lands. */
const DRESSED_TAG = /<(?:pre|code)[^>]*>/gv;

/**
 * The dressing a document carries, tag by tag, so two documents can
 * be asked whether their dressing differs without asking whether
 * anything else does.
 * @param html - normalized HTML
 * @returns the opening `<pre>` and `<code>` tags, joined
 */
function dressingOf(html: string): string {
  return [...html.matchAll(DRESSED_TAG)].map(([tag]) => tag).join("");
}

/**
 * The width-carrying tags a document has, spelled as it spells them.
 * @param html - normalized HTML
 * @returns the `<table>` and `<col>` tags, joined
 */
function widthTagsOf(html: string): string {
  return [...html.matchAll(WIDTH_TAG)].map(([tag]) => tag).join("");
}

/**
 * Whether the highlighter dressing is what differs.
 * @param reference - the reference's normalized HTML
 * @param oracle - the oracle's normalized HTML
 * @returns whether the two sides dress a verbatim block differently
 *   and agree about everything else
 */
function isHighlighterDressing(reference: string, oracle: string): boolean {
  return (
    equalAfterDressing(reference, oracle) &&
    dressingOf(reference) !== dressingOf(oracle)
  );
}

/**
 * Whether a width's spelling is what differs.
 * @param reference - the reference's normalized HTML
 * @param oracle - the oracle's normalized HTML
 * @returns whether the two sides spell the same widths differently
 *   and agree about everything else
 */
function isWidthSpelling(reference: string, oracle: string): boolean {
  return (
    equalAfterDressing(reference, oracle) &&
    widthTagsOf(reference) !== widthTagsOf(oracle)
  );
}

/**
 * The family every remaining difference belongs to, named so that
 * {@link familyOf} can be total without a defensive branch: it stands
 * last in {@link FAMILIES} and its rule is the constant true, so a
 * pair of renders that reaches it is a pair the narrower families
 * declined.
 */
const READING: Family = {
  name: "reading",
  classification: "reading",
  reason:
    "the text itself differs, so the two programs read the document differently; every row here is a defect in one of them",
  holds: () => true,
};

/**
 * The families, in the order a row is tested against them. Narrow
 * families stand first: a row that is a column-width spelling is also
 * an attribute spelling, and the narrower name is the one that says
 * something.
 */
export const FAMILIES: readonly Family[] = [
  {
    name: "refusal-mismatch",
    classification: "reading",
    reason:
      "one program refused the document and the other rendered it, which is the strongest form of reading it differently",
    holds: (reference, oracle) => reference === REFUSED || oracle === REFUSED,
  },
  {
    name: "highlighter-dressing",
    classification: "environment",
    reason:
      "which syntax highlighter each runtime has installed, seen as the classes and data-lang written onto <pre> and <code>; the block's text is identical and so is the rest of the document. A row carrying this AND a width spelling is named here, because the installed highlighter is the stronger claim about the cause",
    holds: isHighlighterDressing,
  },
  {
    name: "width-attribute-spelling",
    classification: "converter",
    reason:
      "both programs computed the same table and column widths, proved number by number, and wrote them into different attributes of the same elements",
    holds: isWidthSpelling,
  },
  READING,
];

/**
 * What a neutralized environment value is written as.
 *
 * `{asciidoctor-version}` is the environment value that actually
 * appears: the reference renders `2.0.26` where the instrument
 * renders `4.0.11`, in any document that references it, and a ledger
 * carrying those rows would be a ledger of the version pin. Only each
 * program's OWN version string is neutralized, never a version-shaped
 * run of text, so a document whose prose happens to hold a version
 * number still compares as prose.
 */
const NEUTRALIZED_VERSION = "<version>";

/**
 * The clock values a document can ask for, and what they are
 * replaced by.
 *
 * `{docdate}`, `{doctime}` and `{localtime}` are read from the clock
 * at render time, and the two programs render in two processes: a
 * corpus fixture that prints the time differs whenever the two runs
 * straddle a second. That is a difference about when the harness ran,
 * so the ledger would carry a row that appears and disappears on its
 * own. Neutralized on both sides, the fixture compares as what it is.
 */
const CLOCK_VALUES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\d{4}-\d{2}-\d{2}/gv, "<date>"],
  [/\d{2}:\d{2}:\d{2}(?: [+\-]\d{4})?/gv, "<time>"],
];

/**
 * The normalization two CONVERTERS have to be compared through.
 *
 * It is its own function, deliberately. `renderedHtml` in
 * `tests/helpers.ts` was written to compare the oracle with ITSELF -
 * one render of a document against another render of the formatted
 * document - and widening it to absorb a second converter's spelling
 * would weaken every conformance assertion in the suite. So this
 * builds on that fold rather than changing it: neutralize what the
 * two runtimes supply differently, then apply the SAME fold both
 * sides of every other comparison in this repository are read
 * through.
 * @param html - one converter's HTML, nothing normalized
 * @param version - the rendering program's own version string, which
 *   it writes wherever a document names the Asciidoctor version
 * @returns the HTML with that version neutralized and the conformance
 *   fold applied
 */
export function normalizeForComparison(html: string, version: string): string {
  let out = html.replaceAll(version, NEUTRALIZED_VERSION);
  for (const [pattern, replacement] of CLOCK_VALUES) {
    out = out.replaceAll(pattern, replacement);
  }
  return conformanceFold(out);
}

/**
 * Whether a family name is one whose rows are reading differences,
 * and so need a verdict.
 * @param name - a family name from a ledger row
 * @returns whether that family is classified `reading`
 */
export function isReadingFamily(name: string): boolean {
  return (
    FAMILIES.find((family) => family.name === name)?.classification ===
    "reading"
  );
}

/**
 * The family a difference belongs to.
 * @param reference - the reference's normalized HTML
 * @param oracle - the oracle's normalized HTML
 * @returns the first family whose rule holds; the `reading` family
 *   holds for everything, so this is total
 */
export function familyOf(reference: string, oracle: string): Family {
  // The last family's rule is the constant true, so `find` cannot
  // answer undefined; the fallback exists because the types do not
  // know that and a defensive throw would be a branch no input takes.
  const family = FAMILIES.find((one) => one.holds(reference, oracle));
  return family ?? READING;
}

/** Where the pinned differences live. */
export const REFERENCE_DIFF_LEDGER_PATH = "scripts/reference-diff-ledger.json";

/**
 * The floor below which the corpus did not load. The vendored
 * extraction is four figures wide; a run that saw a hundred documents
 * is a run whose corpus is missing, which is the condition exit 2
 * exists for.
 */
export const MINIMUM_DOCUMENTS = 1000;

/**
 * What a `reading` row is, once somebody has read both sources.
 *
 * A row's FAMILY is mechanical; its verdict is not. Nothing is
 * reported to another repository, so this vocabulary is the whole
 * record: it says which program the difference belongs to, and the
 * project then does the simplest thing on that construct.
 *
 * - `instrument`: the rewrite disagrees with the reference it was
 *   generated from. Ours to work around, and the reason a reader
 *   should not take the oracle's answer as the Ruby's.
 * - `reference-version`: the rewrite follows a Ruby NEWER than the
 *   vendored 2.0.26, and the corpus (pinned at asciidoctor main)
 *   expects the newer behaviour. Neither program is wrong; the two
 *   we run are simply not the same version.
 * - `environment`: what the two runtimes have installed or can
 *   supply, not what they read.
 * - `unjudged`: nobody has read the two sources for this row yet.
 *   The gate refuses it, which is how a new reading difference gets
 *   looked at instead of accumulating.
 */
export type Verdict =
  | "environment"
  | "instrument"
  | "reference-version"
  | "unjudged";

/** What a converter-family row carries where a verdict would stand. */
export const NOT_A_READING = "n/a";

/** The verdicts a reading row may carry, as written in the ledger. */
const VERDICTS: readonly Verdict[] = [
  "environment",
  "instrument",
  "reference-version",
  "unjudged",
];

/**
 * The verdict a ledger row carries, or `unjudged` when it carries
 * none this vocabulary knows.
 *
 * A ledger is a file people edit, and a verdict misspelled by hand
 * has to read as "nobody judged this" rather than as a judgement the
 * gate cannot check.
 * @param written - whatever stands in the row's verdict field
 * @returns the verdict, or `unjudged`
 */
export function verdictOf(written: string): Verdict {
  return VERDICTS.find((verdict) => verdict === written) ?? "unjudged";
}

/** One pinned difference. */
export interface DiffRow {
  /** The corpus case id. */
  readonly id: string;
  /** The family whose rule recognized it. */
  readonly family: string;
  /**
   * The verdict for a `reading` row, or {@link NOT_A_READING} for a
   * converter row, which needs none.
   */
  readonly verdict: Verdict | typeof NOT_A_READING;
  /** One line saying what the two programs did, for a reader. */
  readonly why: string;
}

/**
 * One place the two programs read a document differently, written
 * down in full: the witness, both readings, both deciding sources,
 * and what this project does there.
 *
 * These rows are not derived from a run. A `reading` row says the two
 * programs differ; saying WHICH construct is behind it, and what we
 * do about it, takes reading both sources. This is where that reading
 * lives, and it lives HERE and nowhere else: nothing is reported to
 * another repository. Where the two programs disagree the project is
 * free to do the simplest thing, and `ours` is what that turned out
 * to be.
 */
interface FidelityRow {
  /** Short name for the divergence. */
  readonly id: string;
  /** The smallest document that shows it. */
  readonly witness: string;
  /** What the reference renders for that document, through the fold. */
  readonly reference: string;
  /** What the instrument renders for it, through the same fold. */
  readonly oracle: string;
  /** Where the reference decides it. */
  readonly referenceSource: string;
  /** Where the instrument decides it. */
  readonly oracleSource: string;
  /** Which program the difference belongs to, and how that is known. */
  readonly verdict: string;
  /**
   * What this project does on that construct, under the ruling.
   *
   * Checked, not asserted: {@link formatted} is what the printer
   * makes of the witness and {@link referenceFixedPoint} says whether
   * the reference renders that output as it rendered the witness, and
   * the suite recomputes both. A sentence here that the two fields
   * contradict is the defect this pair exists to catch.
   */
  readonly ours: string;
  /** Which measured disagreements this row accounts for. */
  readonly covers: string;
  /** What the printer makes of the witness. */
  readonly formatted: string;
  /**
   * Whether the REFERENCE renders {@link formatted} as it renders the
   * witness. False is a legitimate answer and says the printer's
   * output is a fixed point of the oracle and not of the reference,
   * which is exactly the kind of place this ledger records.
   */
  readonly referenceFixedPoint: boolean;
}

/** The whole ledger. */
export interface ReferenceDiffLedger {
  /** The reference gem's version. */
  readonly reference: string;
  /** The oracle package's version. */
  readonly oracle: string;
  /**
   * The three-way version skew this measurement sits in, named
   * because it explains a whole class of rows and a reader who does
   * not know it will read those rows as defects.
   *
   * The corpus is extracted from asciidoctor at a commit on main; the
   * reference is the released gem 2.0.26; and the instrument was
   * generated from a Ruby source newer than 2.0.26 (it has
   * `link=self` resolution, `imagesdir` on a macro, an implicit
   * `start` and a `type` on ordered lists, a role on a thematic
   * break, and a `~~~~` delimiter, none of which is in the 2.0.26
   * source or its changelog). So a corpus case can expect behaviour
   * the reference does not have, and the instrument can be right
   * about a newer Ruby while disagreeing with the one we vendor and
   * cite.
   */
  readonly versionSkew: string;
  /** How the run came out. */
  readonly counts: {
    /** Corpus documents rendered through both programs. */
    readonly documents: number;
    /** Documents whose normalized renders are byte-identical. */
    readonly identical: number;
    /** Documents whose normalized renders differ. */
    readonly differing: number;
    /** Differing documents per family, keyed by family name. */
    readonly byFamily: Readonly<Record<string, number>>;
  };
  /** Every difference, sorted by id. */
  readonly rows: readonly DiffRow[];
  /** The instrument defects read out of both sources. */
  readonly instrumentFidelity: readonly FidelityRow[];
}

/**
 * Reads the pinned ledger.
 * @returns the ledger as it stands on disk
 */
export function loadReferenceDiffLedger(): ReferenceDiffLedger {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- our own generated file, regenerated by --write
  return JSON.parse(
    readFileSync(REFERENCE_DIFF_LEDGER_PATH, "utf8"),
  ) as ReferenceDiffLedger;
}
