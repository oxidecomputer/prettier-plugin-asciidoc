/**
 * The alphabet the whitespace battery perturbs with, the cases it
 * builds from the template roster, and the classification of what
 * came back.
 *
 * The alphabet has four members and they are not arbitrary. One
 * space is the base. Two spaces move the run's LENGTH and nothing
 * else. A tab moves its SPELLING and nothing else. A newline moves
 * the LINE the run's neighbours sit on. A formatter that reflows
 * prose does all three, so a whitespace position that renders the
 * same under all four is a position the printer may spell however it
 * likes, and a position that does not is a fact the printer has to
 * carry.
 *
 * The three dimensions are independent, and the battery has
 * witnesses on both sides: a position where a newline is safe and two
 * spaces are not, and a position where two spaces are safe and a
 * newline is not. That is why the result of a position is a
 * PARTITION of the four spellings rather than a single verdict.
 */
import { SLOT, TEMPLATES, type Template } from "./whitespace-roster.js";

/** The four spellings every whitespace position is rendered under. */
export const PERTURBATIONS = ["sp1", "sp2", "tab", "nl"] as const;

/** One member of the alphabet. */
export type Perturbation = (typeof PERTURBATIONS)[number];

/** What each member of the alphabet writes in place of the run. */
export const FILLERS: Readonly<Record<Perturbation, string>> = {
  sp1: " ",
  sp2: "  ",
  tab: "\t",
  nl: "\n",
};

/** One document to render, as both programs receive it. */
interface RenderCase {
  /** `<position id>/<perturbation>`, unique across the population. */
  readonly id: string;
  /** The whole document. */
  readonly src: string;
  /**
   * Attributes supplied from outside the document. Empty for every
   * case but the roster's external-attribute template; the harness
   * lens takes source text only, so a case with attributes is
   * rendered by the reference alone.
   */
  readonly attrs: Readonly<Record<string, string>>;
}

/** A whitespace position, named by the population it comes from. */
interface Position {
  /** `<template>/s<index>`, or `<document>/l<line>c<column>`. */
  readonly id: string;
  /** The reporting group: a template family, or a construct guess. */
  readonly group: string;
  /** What the source looks like around the position, for the report. */
  readonly window: string;
  /** True when only the reference can render this position's cases. */
  readonly referenceOnly: boolean;
}

/** A position together with the four documents that measure it. */
export interface PositionCases {
  /** What is being measured. */
  readonly position: Position;
  /** Its four documents, in {@link PERTURBATIONS} order. */
  readonly cases: readonly RenderCase[];
}

/**
 * Renders one template with a chosen slot given a filler and every
 * other slot given one space.
 *
 * Holding the other slots at one space is what makes a case's result
 * attributable: two moving runs would report the pair, and the
 * battery would need the product of the alphabet with itself to say
 * which one moved.
 * @param subject - the template to expand
 * @param slotIndex - which of its slots takes the filler
 * @param filler - the whitespace the chosen slot is spelled with
 * @returns the document body, without the header
 */
function expand(subject: Template, slotIndex: number, filler: string): string {
  let seen = -1;
  return subject.segments
    .map((segment) => {
      if (typeof segment === "string") {
        return segment;
      }
      seen += 1;
      return seen === slotIndex ? filler : " ";
    })
    .join("");
}

/**
 * How a template reads in a report: its fixed text with each slot
 * shown as an underscore, so `aa_bb` names a one-slot template.
 * @param subject - the template to spell
 * @returns the template's text with underscores where its slots are
 */
function display(subject: Template): string {
  return subject.segments
    .map((segment) => (typeof segment === "string" ? segment : "_"))
    .join("");
}

/**
 * Every position the template roster defines, with its four cases.
 *
 * Slots never sit at position 0 or at a line edge, by construction of
 * the roster, so every member of the alphabet is well formed there
 * and the newline is a line break rather than a blank line.
 * @returns the positions in roster order, each with four cases
 */
export function templatePositions(): PositionCases[] {
  const out: PositionCases[] = [];
  for (const subject of TEMPLATES) {
    const slots = subject.segments.filter((s) => s === SLOT).length;
    for (let slot = 0; slot < slots; slot += 1) {
      const id = `${subject.name}/s${String(slot)}`;
      out.push({
        position: {
          id,
          group: subject.family,
          window: display(subject),
          referenceOnly: Object.keys(subject.attributes).length > 0,
        },
        cases: PERTURBATIONS.map((perturbation) => ({
          id: `${id}/${perturbation}`,
          src:
            subject.header === ""
              ? `${expand(subject, slot, FILLERS[perturbation])}\n`
              : `${subject.header}\n\n${expand(subject, slot, FILLERS[perturbation])}\n`,
          attrs: subject.attributes,
        })),
      });
    }
  }
  return out;
}

/**
 * The canonical partition signature of one position's four renders:
 * class indices in first-occurrence order, so `0120` says the second
 * spelling stands alone and the fourth reads as the first.
 *
 * A signature rather than a set of flags because the flags lose the
 * case where two non-base spellings differ from the base and from
 * each other, and that case is real.
 * @param renders - the four renders, in {@link PERTURBATIONS} order
 * @returns four digits naming each render's equivalence class
 */
export function partitionOf(renders: readonly string[]): string {
  const classes = new Map<string, number>();
  return renders
    .map((render) => {
      const known = classes.get(render);
      if (known !== undefined) {
        return String(known);
      }
      classes.set(render, classes.size);
      return String(classes.size - 1);
    })
    .join("");
}

/**
 * The dimensions a partition moves in, relative to one space. The
 * three are named `...Bound` rather than `length`, `tab` and
 * `newline` because a field called `length` on any object reads as a
 * collection's size to every tool that scans this code.
 */
export interface Dimensions {
  /** Two spaces render differently from one. */
  readonly lengthBound: boolean;
  /** A tab renders differently from one space. */
  readonly tabBound: boolean;
  /** A newline renders differently from one space. */
  readonly newlineBound: boolean;
  /**
   * Two spellings differ from each other in a way the three flags do
   * not name, which is what a position with more equivalence classes
   * than moved dimensions plus one means.
   */
  readonly split: boolean;
}

/**
 * Reads a partition signature back as the dimensions it moves in.
 * @param partition - a signature from {@link partitionOf}
 * @returns which of the three perturbations the position is bound to
 */
export function dimensionsOf(partition: string): Dimensions {
  // Read by index rather than spread: a partition is four ASCII
  // digits, and the spread forms this lint config bans are for
  // strings whose characters are not.
  const digits = PERTURBATIONS.map((_perturbation, index) =>
    partition.charAt(index),
  );
  const [base, twoSpaces, tab, newline] = digits;
  const moved = [twoSpaces, tab, newline].filter(
    (digit) => digit !== base,
  ).length;
  return {
    lengthBound: twoSpaces !== base,
    tabBound: tab !== base,
    newlineBound: newline !== base,
    split: new Set(digits).size > moved + 1,
  };
}

/**
 * The position's class as the report spells it: `FREE`, or the
 * dimensions it is bound in joined by `+`.
 * @param partition - a signature from {@link partitionOf}
 * @returns the class name
 */
export function classOf(partition: string): string {
  const dimensions = dimensionsOf(partition);
  const names = [
    dimensions.lengthBound ? "LENGTH" : "",
    dimensions.tabBound ? "TAB" : "",
    dimensions.newlineBound ? "NEWLINE" : "",
    dimensions.split ? "SPLIT" : "",
  ].filter((name) => name !== "");
  return names.length > 0 ? names.join("+") : "FREE";
}
