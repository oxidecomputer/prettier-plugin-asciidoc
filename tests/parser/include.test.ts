import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import { narrow } from "../../src/unreachable.js";

describe("include directive parsing", () => {
  // Basic include directive with empty options.
  test("basic include directive", () => {
    const { children } = parse("include::path/to/file.adoc[]\n");
    expect(children).toHaveLength(1);
    const [node] = children;
    narrow(node, "includeDirective");
    expect(node.target).toBe("path/to/file.adoc");
    expect(node.attrlist).toBe("");
  });

  // Include with lines option.
  test("include with lines option", () => {
    const { children } = parse("include::file.txt[lines=5..10]\n");
    expect(children).toHaveLength(1);
    const [node] = children;
    narrow(node, "includeDirective");
    expect(node.target).toBe("file.txt");
    expect(node.attrlist).toBe("lines=5..10");
  });

  // Include with tag option.
  test("include with tag option", () => {
    const { children } = parse("include::file.txt[tag=section-name]\n");
    expect(children).toHaveLength(1);
    const [node] = children;
    narrow(node, "includeDirective");
    expect(node.target).toBe("file.txt");
    expect(node.attrlist).toBe("tag=section-name");
  });

  // Include with leveloffset option.
  test("include with leveloffset option", () => {
    const { children } = parse("include::file.adoc[leveloffset=+1]\n");
    expect(children).toHaveLength(1);
    const [node] = children;
    narrow(node, "includeDirective");
    expect(node.target).toBe("file.adoc");
    expect(node.attrlist).toBe("leveloffset=+1");
  });

  // Include between paragraphs.
  test("include between paragraphs", () => {
    const { children } = parse(
      "Before.\n\ninclude::chapter.adoc[]\n\nAfter.\n",
    );
    expect(children).toHaveLength(3);
    expect(children[0].type).toBe("paragraph");
    expect(children[1].type).toBe("includeDirective");
    expect(children[2].type).toBe("paragraph");
  });

  // Position tracking.
  test("position tracking", () => {
    const { children } = parse("include::file.adoc[]\n");
    const [node] = children;
    expect(node.type).toBe("includeDirective");
    expect(node.position.start.line).toBe(1);
    expect(node.position.start.column).toBe(1);
    expect(node.position.start.offset).toBe(0);
  });

  // Include with path containing directories.
  test("include with deep path", () => {
    const { children } = parse(
      "include::chapters/intro/getting-started.adoc[]\n",
    );
    expect(children).toHaveLength(1);
    const [node] = children;
    narrow(node, "includeDirective");
    expect(node.target).toBe("chapters/intro/getting-started.adoc");
  });

  // Include with multiple options.
  test("include with multiple options", () => {
    const { children } = parse("include::file.adoc[lines=1..5,indent=0]\n");
    expect(children).toHaveLength(1);
    const [node] = children;
    narrow(node, "includeDirective");
    expect(node.attrlist).toBe("lines=1..5,indent=0");
  });

  // Trailing text after the closing bracket means this is
  // not an include directive — the (?![^\n]) lookahead
  // rejects it. Should fall through to paragraph.
  test("trailing text prevents include match", () => {
    const { children } = parse("include::file.adoc[] extra\n");
    expect(children).toHaveLength(1);
    expect(children[0].type).toBe("paragraph");
  });

  // URL targets are valid in AsciiDoc include directives.
  test("include with URL target", () => {
    const { children } = parse("include::https://example.com/file.adoc[]\n");
    expect(children).toHaveLength(1);
    const [node] = children;
    narrow(node, "includeDirective");
    expect(node.target).toBe("https://example.com/file.adoc");
  });
});
