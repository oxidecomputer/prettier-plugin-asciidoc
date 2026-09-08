/**
 * Unit tests for `scripts/internal-anchors.ts`: the slug rule, the
 * duplicate rule, what counts as a prose line, which destinations are
 * claimed, and the check itself.
 *
 * THE SLUG CASES ARE MEASURED, not described. Every expectation in
 * "GitHub's slug of a heading" is the `id` GitHub's own markdown
 * rendering gave that heading, so the table is a record of what the
 * renderer does rather than a second reading of a written rule. The
 * headings are this repository's, and the shapes that used to be got
 * wrong by hand are among them: a colon, an em-dash, a run of hyphens.
 */
import path from "node:path";
import { describe, expect, test } from "vitest";
import { documentsOf } from "../../scripts/internal-anchors.js";
import { ignoreRules } from "../../scripts/lib/ignored.js";
import {
  anchorsIn,
  checkFragment,
  checkFragments,
  fragmentCitations,
  proseLines,
  slug,
  type FragmentTally,
} from "../../scripts/internal-anchors.js";

/**
 * A tally with nothing in it, for the scan over a whole checkout.
 * @returns the three fields the scan writes into
 */
function tally(): FragmentTally {
  return { anchors: 0, listing: [], failures: [] };
}

describe("GitHub's slug of a heading", () => {
  test("a colon is DROPPED, not hyphenated", () => {
    // The rot this gate exists for: `docs/harnesses.md` linked this
    // very heading as `bun-run-test-deep-tiers-...`, which resolves
    // nowhere, and nothing said so.
    expect(
      slug("`bun run test:deep-tiers` - the deep sweeps that run per push"),
    ).toBe("bun-run-testdeep-tiers---the-deep-sweeps-that-run-per-push");
  });

  test("an em-dash is dropped and leaves the blanks around it", () => {
    expect(
      slug(
        `\`bun run coverage\` \u2014 the suite, against the recorded minimums`,
      ),
    ).toBe("bun-run-coverage--the-suite-against-the-recorded-minimums");
  });

  test("angle brackets go and the hyphens of a flag stay", () => {
    expect(
      slug(
        `\`bun run parity -- --base <rev>\` \u2014 same output as revision X`,
      ),
    ).toBe("bun-run-parity------base-rev--same-output-as-revision-x");
  });

  test("an at sign goes and a dot goes", () => {
    expect(slug("The `@internal` split")).toBe("the-internal-split");
    expect(slug("Why not Asciidoctor.js")).toBe("why-not-asciidoctorjs");
  });

  test("an underscore is kept, because it is a word character", () => {
    expect(slug("snake_case_name kept")).toBe("snake_case_name-kept");
  });

  test("a run of blanks becomes a run of hyphens", () => {
    expect(slug("Extra   spaces   here")).toBe("extra---spaces---here");
  });

  test("a link contributes its label and not its destination", () => {
    // The one inline shape the bytes alone get wrong: the destination
    // would otherwise be slugged into the anchor.
    expect(slug("A [linked phrase](https://example.com/x) here")).toBe(
      "a-linked-phrase-here",
    );
  });

  test("a link written inside a code span stays bytes", () => {
    expect(slug("Code `[a](b)` span")).toBe("code-ab-span");
  });
});

describe("the anchors a file defines", () => {
  test("a repeated heading takes the next suffix", () => {
    expect([...anchorsIn("## Tests\n\n## Tests\n")]).toEqual([
      "tests",
      "tests-1",
    ]);
  });

  test("a heading whose own slug is a suffix does not collide with it", () => {
    // GitHub counts per BASE slug, so the third heading here is
    // `tests-1-1` rather than a second `tests-1`.
    expect([...anchorsIn("## Tests\n## Tests\n## Tests 1\n")]).toEqual([
      "tests",
      "tests-1",
      "tests-1-1",
    ]);
  });

  test("a closing run of hashes is decoration, not title", () => {
    expect([...anchorsIn("## Trailing hash form ##\n")]).toEqual([
      "trailing-hash-form",
    ]);
  });

  test("a hash with no blank after it opens no heading", () => {
    expect([...anchorsIn("#hashtag\n")]).toEqual([]);
  });

  test("a heading inside a fenced block is not a heading", () => {
    // Which the documentation needs: it shows shell in fenced blocks,
    // and a `#` there opens a comment.
    expect([...anchorsIn("```sh\n# not a heading\n```\n## Real\n")]).toEqual([
      "real",
    ]);
  });

  test("a shorter fence inside a longer one does not close it", () => {
    expect(
      [...anchorsIn("````md\n```\n# no\n```\n````\n## Real\n")].length,
    ).toBe(1);
  });
});

describe("the lines a scan reads", () => {
  test("a fence line is never prose, whichever end it is", () => {
    expect(proseLines("a\n```\nb\n```\nc\n").map((one) => one.line)).toEqual([
      "a",
      "c",
      "",
    ]);
  });

  test("prose lines keep the number an editor opens", () => {
    expect(proseLines("a\n```\nb\n```\nc\n").at(-2)?.number).toBe(5);
  });
});

describe("the fragment links a file writes", () => {
  test("a bare fragment names the citing file's own headings", () => {
    expect(fragmentCitations("docs/a.md", "see [x](#the-scorecard)")).toEqual([
      { at: "docs/a.md:1", file: "docs/a.md", fragment: "the-scorecard" },
    ]);
  });

  test("a relative destination resolves from the citing directory", () => {
    expect(
      fragmentCitations("docs/a.md", "[x](architecture.md#seams)")[0].file,
    ).toBe("docs/architecture.md");
    expect(
      fragmentCitations("docs/a.md", "[x](../README.md#usage)")[0].file,
    ).toBe("README.md");
  });

  test("a destination with a scheme belongs to whoever serves it", () => {
    expect(
      fragmentCitations("docs/a.md", "[x](https://prettier.io/docs#plugins)"),
    ).toEqual([]);
  });

  test("a link with no fragment claims no anchor", () => {
    expect(fragmentCitations("docs/a.md", "[x](architecture.md)")).toEqual([]);
  });

  test("a link inside a fenced block is an example, not a claim", () => {
    expect(fragmentCitations("docs/a.md", "```md\n[x](#gone)\n```\n")).toEqual(
      [],
    );
  });
});

describe("holding a fragment to the headings of the file it names", () => {
  const citation = {
    at: "docs/a.md:3",
    file: "docs/a.md",
    fragment: "bun-run-test-deep-tiers---the-deep-sweeps-that-run-per-push",
  };

  test("the pre-fix spelling of the colon heading fails, and says where", () => {
    // Red before the change: this exact link was in the tree, resolved
    // nowhere, and every gate passed.
    const anchors = anchorsIn(
      "### `bun run test:deep-tiers` - the deep sweeps that run per push\n",
    );
    expect(checkFragment(citation, anchors)).toEqual([
      "docs/a.md:3: `#bun-run-test-deep-tiers---the-deep-sweeps-that-run-per-push` names no heading in docs/a.md",
    ]);
  });

  test("the spelling GitHub gives that heading holds", () => {
    const anchors = anchorsIn(
      "### `bun run test:deep-tiers` - the deep sweeps that run per push\n",
    );
    expect(
      checkFragment(
        {
          ...citation,
          fragment:
            "bun-run-testdeep-tiers---the-deep-sweeps-that-run-per-push",
        },
        anchors,
      ),
    ).toEqual([]);
  });
});

describe("the scan over a checkout's markdown", () => {
  // Two documents that link at each other: one heading apiece, one
  // link that holds, one that names a heading the other file lacks,
  // one that names a file that is there and is not read, and one that
  // misspells the file it means.
  const markdown = new Map([
    [
      "docs/one.md",
      "## The other\n[across](two.md#the-target)\n[unread](../AGENTS.md#x)\n[typo](twoo.md#the-target)\n",
    ],
    ["docs/two.md", "## The target\n[back](one.md#gone)\n"],
  ]);
  const present = new Set([...markdown.keys(), "AGENTS.md"]);
  const found = tally();
  checkFragments(markdown, present, found);

  test("a cross-file link resolves against the file it names", () => {
    expect(found.failures).toContain(
      "docs/two.md:2: `#gone` names no heading in docs/one.md",
    );
  });

  test("a misspelled destination fails before its fragment is asked", () => {
    // Red before the change: a link naming no file at all was skipped
    // with the unread ones, so the commonest way a cross-file link
    // rots was the one shape the gate could not see.
    expect(found.failures).toContain(
      "docs/one.md:4: names docs/twoo.md, which is no document of this repository",
    );
  });

  test("a link naming a file the gate read no text for is skipped", () => {
    // Two of the four are counted; `AGENTS.md` is there and unread, so
    // whether it has the heading is unanswerable, which is the symbol
    // scan's rule too.
    expect(found.anchors).toBe(2);
    expect(found.failures).toHaveLength(2);
    expect(found.failures.join("\n")).not.toContain("AGENTS.md");
  });

  test("every link read is listed, with the file it resolved against", () => {
    expect(found.listing).toContain("docs/one.md:2\t#the-target\tdocs/two.md");
  });
});

describe("the markdown a checkout has", () => {
  // A checkout written out under tests/scripts/fixtures, with two
  // documents in it. The ignore rules are handed in rather than read
  // from a file beside them: a fixture whose own `.gitignore` hid the
  // second file would hide it from this repository's version control
  // too, and the row would then pass over a file that was never there.
  const root = path.resolve(import.meta.dirname, "fixtures/ignored-checkout");

  test("an ignored document is neither scanned nor counted as present", () => {
    // Red before the change: the walk read whatever was on disk, so a
    // working note under `docs` naming a function deleted long ago
    // failed a gate no landing could clear.
    const documents = documentsOf(root, ignoreRules("docs/notes/\n"));
    expect(documents.scanned).toContain("docs/kept.md");
    expect(documents.scanned).not.toContain("docs/notes/dead.md");
    expect(documents.present.has("docs/notes/dead.md")).toBe(false);
  });

  test("with nothing ignored the same checkout yields both", () => {
    // The other half of the pin: the file IS there, so the row above
    // is about the rule and not about an absent fixture.
    const documents = documentsOf(root, ignoreRules(""));
    expect(documents.scanned).toContain("docs/notes/dead.md");
    expect(documents.present.has("docs/notes/dead.md")).toBe(true);
  });
});
