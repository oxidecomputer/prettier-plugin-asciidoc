/**
 * The two generated document products, and the population they join.
 *
 * What these rows are FOR: the products are pinned at exact sizes
 * because every measurement over them is a count OUT OF them -
 * "6,300 of 6,384 render as their source" is a claim about one
 * specific set, and two runs are comparable only while the
 * denominator is the same. A generator that quietly spelled 6,383
 * documents would move that denominator silently. The size assertions
 * are the pins; the property assertions below them are what make the
 * size meaningful, since a product could hit its count with
 * duplicates in it.
 */
import { describe, expect, it } from "vitest";
import {
  DIRECTIVE_PRODUCT_SIZE,
  directiveProduct,
} from "../../scripts/lib/directive-product.js";
import {
  DLIST_PRODUCT_SIZE,
  dlistProduct,
} from "../../scripts/lib/dlist-product.js";
import { population, populationLine } from "../../scripts/lib/population.js";

/** How many body lines the description-list product spells. */
const BODY_LINES = 3;

/** The four term lines that product puts a body under. */
const TERMS = ["t:: d", "t::", "t;; d", "u:: d"];

describe("the directive product", () => {
  it("spells exactly the size it is pinned at", () => {
    expect(directiveProduct()).toHaveLength(DIRECTIVE_PRODUCT_SIZE);
  });

  it("spells no document twice", () => {
    const documents = directiveProduct();
    expect(new Set(documents).size).toBe(documents.length);
  });

  it("wraps every document in one directive pair", () => {
    for (const document_ of directiveProduct()) {
      expect(document_, document_).toContain("ifdef::x[]\n");
      expect(document_, document_).toContain("\nendif::[]\n");
    }
  });

  it("ends every document with a newline, so a final-newline fix moves no bytes", () => {
    for (const document_ of directiveProduct()) {
      expect(document_.endsWith("\n"), document_).toBe(true);
    }
  });

  it("spells the blank body and the absent body as one document", () => {
    // The sixteen duplicates the product dedupes are all this
    // collision, and it is a real property of the alphabet rather than
    // an accident: a body of one blank line and no body at all join to
    // the same text. If this ever stops being true the size pin above
    // fails, which is the point of asserting it here as well.
    const documents = new Set(directiveProduct());
    expect(documents.has("ifdef::x[]\n\nendif::[]\npara\n")).toBe(true);
  });
});

describe("the description-list product", () => {
  it("spells exactly the size it is pinned at", () => {
    expect(dlistProduct()).toHaveLength(DLIST_PRODUCT_SIZE);
  });

  it("spells no document twice", () => {
    const documents = dlistProduct();
    expect(new Set(documents).size).toBe(documents.length);
  });

  it("ends every document with a newline", () => {
    for (const document_ of dlistProduct()) {
      expect(document_.endsWith("\n"), document_).toBe(true);
    }
  });

  it("gives every document a three-line body under its term", () => {
    // The property the size rests on. No alphabet symbol contains a
    // newline, so a three-line body carries exactly two separators and
    // splits back uniquely - which is why 4 x 4 x 15^3 needs no dedup
    // to be 54,000. Asserting the ending newline alone would leave
    // that argument unchecked.
    for (const document_ of dlistProduct()) {
      // Drop the wrapper: the body is the last three lines before the
      // trailing newline, and the term line sits directly above them.
      const lines = document_.slice(0, -1).split("\n");
      const body = lines.slice(-BODY_LINES);
      expect(body, document_).toHaveLength(BODY_LINES);
      const term = lines[lines.length - BODY_LINES - 1];
      expect(TERMS, document_).toContain(term);
    }
  });
});

describe("the population", () => {
  it("walks the corpus, the sweep product and the witnesses", () => {
    const walked = population();
    expect(walked.corpus).toBeGreaterThan(0);
    expect(walked.generated).toBeGreaterThan(0);
    expect(walked.witnesses).toBeGreaterThan(0);
  });

  it("is deduplicated, so its parts may overlap freely", () => {
    const walked = population();
    expect(new Set(walked.documents).size).toBe(walked.documents.length);
    // The parts overlap - most witnesses are corpus cases or sweep
    // documents - so the distinct set is smaller than the sum.
    expect(walked.documents.length).toBeLessThan(
      walked.corpus + walked.generated + walked.witnesses,
    );
  });

  it("states the count it walked, and the share of it that is generated", () => {
    const line = populationLine(population());
    expect(line).toContain("distinct document(s)");
    expect(line).toContain("% generated");
  });
});
