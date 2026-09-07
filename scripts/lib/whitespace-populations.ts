/**
 * The three populations the whitespace battery perturbs, and what
 * each one is evidence about.
 *
 * - `templates` is the cross product of the roster in
 *   `whitespace-roster.ts`: one construct per document, one slot role
 *   per position. It is evidence about CONSTRUCTS, and it is the only
 *   population where a person chose the shapes.
 * - `witnesses` is the repro text of the open `tier-1` issues, taken
 *   from the tracker once and committed. It is evidence about the
 *   documents this project already knows it gets wrong, and it is
 *   adversarial by construction: several of its documents are probe
 *   scripts rather than AsciiDoc, which is why a row names its
 *   document.
 * - `grid` is the registry's own deep grid, deduplicated by document
 *   text. It is the population nobody wrote by hand: the shapes come
 *   from `scripts/shape-registry.ts`, which builds near misses and
 *   unterminated blocks a corpus never contains, and its whitespace
 *   was never placed to make a point about whitespace.
 *
 * A population is a list of POSITIONS, each with the four documents
 * that measure it. Nothing here renders.
 */
import { readFileSync } from "node:fs";
import { pairGrid, standingGrid } from "../shape-registry.js";
import {
  FILLERS,
  PERTURBATIONS,
  templatePositions,
  type PositionCases,
} from "./whitespace-perturbation.js";
import {
  guessConstruct,
  LINE_KINDS,
  respell,
  scanDocument,
  windowAround,
  type LineKind,
} from "./whitespace-positions.js";

/** The populations, by the name the command line and ledger use. */
export const POPULATIONS = ["templates", "witnesses", "grid"] as const;

/** One population's name. */
export type PopulationName = (typeof POPULATIONS)[number];

/** Where the committed tracker witnesses live. */
export const WITNESSES_PATH = "scripts/whitespace-witnesses.json";

/** One committed witness document. */
export interface Witness {
  /** `i<issue>/<kind><n>`: the issue it came from and which block. */
  readonly id: string;
  /** The issue number, so a row can name its origin. */
  readonly issue: number;
  /** The document as the issue spelled it. */
  readonly src: string;
}

/** One tracker issue, as `gh issue list --json number,body` writes it. */
export interface IssueBody {
  /** The issue number. */
  readonly number: number;
  /** The body as the tracker holds it. */
  readonly body: string;
}

// A fenced or indented block in an issue body. Three fence spellings
// because tracker prose uses all three, and the four-or-more-dash one
// because an AsciiDoc witness is often quoted in its own delimiters.
const FENCE_OPEN = /^(?<fence>```+|~~~+|-{4,}$)/v;
const DASH_FENCE = /^-{4,}$/v;
const INDENTED = /^ {4}\S/v;
const INDENT_CONTINUES = /^ {4}/v;

/** How deep an indented block is indented. */
const INDENT_WIDTH = 4;

/** How much of a backtick or tilde fence its closing line repeats. */
const FENCE_PREFIX = 3;

// Many bodies quote a witness inline as a double-quoted string with
// escapes rather than fencing it, and those are witnesses too.
const QUOTED_WITH_NEWLINE =
  /"(?<text>(?:[^"\n\\]|\\.)*\\n(?:[^"\n\\]|\\.)*)"/gv;

/**
 * Where a fence closes, or the end of the body when it never does.
 * @param lines - the body's lines
 * @param from - the line after the opening fence
 * @param fence - the opening fence, as it was spelled
 * @returns the index of the closing line, or the line count
 */
function closingIndex(
  lines: readonly string[],
  from: number,
  fence: string,
): number {
  for (let index = from; index < lines.length; index += 1) {
    const line = lines[index];
    const closes = fence.startsWith("-")
      ? DASH_FENCE.test(line)
      : line.startsWith(fence.slice(0, FENCE_PREFIX));
    if (closes) {
      return index;
    }
  }
  return lines.length;
}

/**
 * Where an indented run ends.
 * @param lines - the body's lines
 * @param from - the run's first line
 * @returns the index of the first line that is not part of it
 */
function indentEnd(lines: readonly string[], from: number): number {
  let index = from;
  while (index < lines.length && INDENT_CONTINUES.test(lines[index])) {
    index += 1;
  }
  return index;
}

/** One quoted block of an issue body, and how it was quoted. */
interface Block {
  /** How the body carried it, which names the document. */
  readonly kind: "fence" | "indent" | "quoted";
  /** The text, without its fence or its indentation. */
  readonly text: string;
}

/**
 * The blocks an issue body carries, in body order: fenced blocks and
 * indented runs first, then the witnesses quoted inline as escaped
 * strings, which many bodies use instead of a fence.
 * @param body - one issue body
 * @returns each block, in the order the ids number them
 */
function blocksOf(body: string): Block[] {
  const lines = body.split("\n");
  const blocks: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const open = FENCE_OPEN.exec(line);
    if (open !== null) {
      const end = closingIndex(lines, index + 1, open.groups?.fence ?? "");
      blocks.push({
        kind: "fence",
        text: lines.slice(index + 1, end).join("\n"),
      });
      index = end + 1;
      continue;
    }
    if (INDENTED.test(line)) {
      const end = indentEnd(lines, index);
      blocks.push({
        kind: "indent",
        text: lines
          .slice(index, end)
          .map((indented) => indented.slice(INDENT_WIDTH))
          .join("\n"),
      });
      index = end;
      continue;
    }
    index += 1;
  }
  for (const match of body.matchAll(QUOTED_WITH_NEWLINE)) {
    blocks.push({
      kind: "quoted",
      text: (match.groups?.text ?? "")
        .replaceAll(String.raw`\n`, "\n")
        .replaceAll(String.raw`\t`, "\t")
        .replaceAll(String.raw`\"`, '"'),
    });
  }
  return blocks;
}

/**
 * Cuts the witness documents out of a set of issue bodies.
 *
 * The population is a SNAPSHOT, not a live read: a gate that asked
 * the tracker would measure a different population every day and its
 * ledger would mean nothing. This is how the snapshot was cut, in the
 * tree, so it can be cut again when the issues move.
 * @param issues - the issue bodies, as the tracker holds them
 * @returns one document per block, deduplicated by text and sorted by
 *   id, with the issue each came from
 */
export function harvestWitnesses(issues: readonly IssueBody[]): Witness[] {
  const documents: Witness[] = [];
  for (const issue of issues) {
    for (const [index, block] of blocksOf(
      issue.body.replaceAll("\r\n", "\n"),
    ).entries()) {
      // A blank block still takes its number, so an id names the
      // block's place in the body rather than its place among the
      // ones that survived this filter.
      if (/\S/v.test(block.text)) {
        documents.push({
          id: `i${String(issue.number)}/${block.kind}${String(index)}`,
          issue: issue.number,
          src: block.text.endsWith("\n") ? block.text : `${block.text}\n`,
        });
      }
    }
  }
  const seen = new Set<string>();
  return documents
    .filter((document) => {
      if (seen.has(document.src)) {
        return false;
      }
      seen.add(document.src);
      return true;
    })
    .toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** What a document population left out, so the report can say so. */
interface ScanTotals {
  /** Documents read. */
  readonly documents: number;
  /** Lines skipped, by the kind that skipped them. */
  readonly skippedLines: Readonly<Record<LineKind, number>>;
  /** Runs found at a line edge, where the alphabet is not well formed. */
  readonly edgeRuns: number;
}

/** A population: its positions, and what its scan passed over. */
export interface Population {
  /** Every whitespace position the population offers. */
  readonly positions: readonly PositionCases[];
  /** Absent for the template roster, which skips nothing. */
  readonly totals: ScanTotals | undefined;
}

/**
 * Reads a document population's every perturbable run.
 * @param documents - the documents, each with a stable id
 * @returns the positions and the scan's skip counts
 */
function scanPopulation(
  documents: ReadonlyArray<{ id: string; src: string }>,
): Population {
  const positions: PositionCases[] = [];
  const skippedLines: Record<LineKind, number> = {
    "attribute-entry": 0,
    "block-attribute": 0,
    delimiter: 0,
    eligible: 0,
    "inside-delimited": 0,
    marker: 0,
  };
  let edgeRuns = 0;
  for (const document of documents) {
    const scan = scanDocument(document.src);
    edgeRuns += scan.edgeRuns;
    for (const kind of LINE_KINDS) {
      skippedLines[kind] += scan.skippedLines[kind];
    }
    for (const run of scan.runs) {
      const id = `${document.id}/l${String(run.line)}c${String(run.column)}`;
      positions.push({
        position: {
          id,
          group: guessConstruct(document.src, run),
          window: windowAround(document.src, run),
          referenceOnly: false,
        },
        cases: PERTURBATIONS.map((perturbation) => ({
          id: `${id}/${perturbation}`,
          src: respell(document.src, run, FILLERS[perturbation]),
          attrs: {},
        })),
      });
    }
  }
  return {
    positions,
    totals: { documents: documents.length, skippedLines, edgeRuns },
  };
}

/**
 * The registry grid's documents, deduplicated by text.
 *
 * The grid mints the same document at many coordinates (a shape
 * inside a document, inside a list item, inside a table cell), and
 * the whitespace question is about the document. Keeping the first
 * coordinate that spelled each text keeps the row nameable without
 * measuring the same bytes many times.
 * @returns one entry per distinct grid document, in grid order
 */
function gridDocuments(): Array<{ id: string; src: string }> {
  const byText = new Map<string, { id: string; src: string }>();
  for (const shape of [...standingGrid(), ...pairGrid()]) {
    if (!byText.has(shape.input)) {
      byText.set(shape.input, { id: shape.id, src: shape.input });
    }
  }
  return [...byText.values()];
}

/**
 * Builds one population's positions.
 * @param name - which population to build
 * @returns its positions, and the skip counts of a document scan
 */
export function population(name: PopulationName): Population {
  switch (name) {
    case "templates": {
      return { positions: templatePositions(), totals: undefined };
    }
    case "witnesses": {
      // The snapshot is written by the harvest that produced it and
      // read back here; its shape is checked by the battery's own
      // test, which reads the same file.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- committed fixture in this repository
      const witnesses: Witness[] = JSON.parse(
        readFileSync(WITNESSES_PATH, "utf8"),
      ) as Witness[];
      return scanPopulation(witnesses);
    }
    case "grid": {
      return scanPopulation(gridDocuments());
    }
  }
}
