/**
 * The four generated domains, and the runner's exit-code contract.
 *
 * What these rows are FOR: every number the runner prints is a count
 * OUT of a domain, and a set difference between two trees is
 * meaningful only while both trees were asked about the same set. The
 * size assertions are the pins; the property assertions below them are
 * what make a size meaningful, since a product could hit its count
 * with duplicates or with documents of the wrong shape in it.
 */
import { rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sweepVerdict, verdictFails } from "../format/list-shape-sweep.js";
import {
  CANNOT_RUN,
  GATE_FAILED,
  runCli as runCliScript,
  writeStandInCheckout,
} from "./cli-runner.js";
import {
  PROBE_DOMAINS,
  probeDocuments,
  probeDomain,
  type ProbeDomain,
} from "../../scripts/lib/probe-domains.js";

/** The smallest domain, so the rows that drive the CLI stay quick. */
const ONE_DOMAIN = "indented-two-line";

/**
 * Whether one domain's alphabet carries a symbol occupying two source
 * lines.
 * @param domain - the domain to ask about
 * @returns true when one of its symbols holds a newline
 */
function spansLines(domain: ProbeDomain): boolean {
  return domain.symbols.some((symbol) => symbol.includes("\n"));
}

/**
 * Run the real CLI and report the code a shell would read.
 * @param argv - the arguments after the script name
 * @returns the process exit code
 */
function runCli(argv: readonly string[]): number {
  return runCliScript("scripts/probe-domains.ts", argv);
}

describe("the probe domains", () => {
  it.each(PROBE_DOMAINS)("$name spells the size it is pinned at", (domain) => {
    expect(probeDocuments(domain)).toHaveLength(domain.size);
  });

  it.each(PROBE_DOMAINS)("$name spells no document twice", (domain) => {
    const documents = probeDocuments(domain);
    expect(new Set(documents).size).toBe(documents.length);
  });

  it.each(PROBE_DOMAINS)(
    "$name opens every document with one item",
    (domain) => {
      // The marker line, not the whole prefix: one witness spells a
      // marker line that already carries text of its own, which is
      // the shape where an item's first source line is not the
      // marker's share alone.
      for (const document_ of probeDocuments(domain)) {
        expect(document_.startsWith("* a"), document_).toBe(true);
        expect(document_.endsWith("\n"), document_).toBe(true);
      }
    },
  );

  it.each(PROBE_DOMAINS)(
    "$name reaches its second prefix through its own first symbol",
    (domain) => {
      // The property the sizes rest on: the second prefix is the
      // first plus the alphabet's first symbol, so a document spelled
      // under it is also spelled under the first prefix by a body one
      // symbol longer - which is why the product deduplicates at all
      // rather than being twice a one-prefix product.
      const [continuation] = domain.symbols;
      const spelled = new Set(probeDocuments(domain));
      expect(spelled.has(`* a\n${continuation}\n${continuation}\n`)).toBe(true);
    },
  );

  it.each(PROBE_DOMAINS)("$name carries every witness it names", (domain) => {
    const spelled = new Set(probeDocuments(domain));
    for (const witness of domain.witnesses) {
      expect(spelled.has(witness), witness).toBe(true);
    }
  });

  it("spells a hard-break line no sweep document contains", () => {
    // The reason all four domains exist at all: the sweep's own
    // alphabet cannot put a ` +` line in a document, so no depth of
    // it reaches the shapes these sweep.
    const [hardBreak] = PROBE_DOMAINS;
    const documents = probeDocuments(hardBreak);
    expect(documents.some((one) => one.includes("\n +\n"))).toBe(true);
  });

  it("puts the symbols that span two source lines in two domains", () => {
    // A symbol carrying a newline is a construct broken across source
    // lines, which is the class no alphabet of single lines can spell
    // at any depth. Naming the two domains that carry them keeps the
    // other two honest: a symbol that grew a newline elsewhere would
    // silently change what its domain is a probe OF.
    const spanning = PROBE_DOMAINS.filter(spansLines);
    expect(spanning.map((domain) => domain.name)).toEqual([
      "two-line-construct",
      "indented-two-line",
    ]);
  });

  it("names no domain twice", () => {
    const names = PROBE_DOMAINS.map((domain) => domain.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("answers with no domain for a name it does not have", () => {
    expect(probeDomain("nope")).toBeUndefined();
  });
});

describe("the sweep verdict the runner compares trees on", () => {
  it("separates the render answer from the stability answer", async () => {
    const verdict = await sweepVerdict("* a\npara\n");
    expect(verdict.kind).toBe("formatted");
    expect(verdictFails(verdict)).toBe(false);
  });

  it("puts a document the formatter threw on in the failing set", () => {
    expect(verdictFails({ kind: "threw" })).toBe(true);
  });

  it("puts an unstable but render-equal document in the failing set", () => {
    expect(
      verdictFails({ kind: "formatted", unstable: true, renderUnequal: false }),
    ).toBe(true);
  });
});

describe("the runner's exit-code contract", () => {
  it("exits 2 on a domain it does not have", () => {
    expect(runCli(["--domain", "nope"])).toBe(CANNOT_RUN);
  });

  it("exits 2 on a base revision that does not exist", () => {
    expect(
      runCli(["--domain", "two-line-construct", "--base", "no-such-revision"]),
    ).toBe(CANNOT_RUN);
  });

  it("exits 2 on a flag with no value", () => {
    expect(runCli(["--base"])).toBe(CANNOT_RUN);
  });

  it("exits 2 on a word that names no flag", () => {
    expect(runCli(["extra"])).toBe(CANNOT_RUN);
  });

  it("exits 0 for --help, which is not an error", () => {
    expect(runCli(["--help"])).toBe(0);
  });

  it("exits 1 when a document fails here and not on the base", () => {
    // A base that returns its input unchanged fails nothing: its
    // output is a fixed point and renders as its source by
    // definition. So this checkout's own failing set IS the regressed
    // set, which is the decision the whole harness exists to make and
    // the one no other row drives.
    const root = writeStandInCheckout("  return source;");
    try {
      expect(runCli(["--domain", ONE_DOMAIN, "--base", root])).toBe(
        GATE_FAILED,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("exits 2 when the base threw on every document", () => {
    // The floor the exit-1 row above would otherwise hide: a base
    // that cannot format at all has the whole domain in its failing
    // set, so every set difference reports it as entirely fixed with
    // nothing regressed - a green tick over a tree that measured
    // nothing.
    const root = writeStandInCheckout(
      '  throw new Error("no formatter here");',
    );
    try {
      expect(runCli(["--domain", ONE_DOMAIN, "--base", root])).toBe(CANNOT_RUN);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
