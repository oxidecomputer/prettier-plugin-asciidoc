import { describe, test, expect } from "vitest";
import {
  extractCorpusCases,
  serializeCorpus,
} from "../../scripts/heredoc-extractor.js";

// Ruby sources are inlined as TS template literals. Note: in the
// real corpus the heredoc terminator may be indented (Ruby's <<~
// allows it) and bodies are dedented by the minimum space indent.
describe("extractCorpusCases", () => {
  test("extracts a single-quoted squiggly heredoc with dedent", () => {
    const ruby = [
      "context 'Lists' do",
      "  test 'dash elements' do",
      "    input = <<~'EOS'",
      "    - Foo",
      "    - Boo",
      "    EOS",
      "    output = convert_string input",
      "  end",
      "end",
    ].join("\n");
    expect(extractCorpusCases(ruby, "lists_test.rb")).toEqual([
      { id: "lists_test.rb#dash elements#0", input: "- Foo\n- Boo\n" },
    ]);
  });

  test("preserves relative indentation beyond the margin", () => {
    const ruby = [
      "test 'nested' do",
      "  input = <<~'EOS'",
      "  * a",
      "    ** b",
      "  EOS",
      "end",
    ].join("\n");
    expect(extractCorpusCases(ruby, "t.rb")[0]?.input).toBe("* a\n  ** b\n");
  });

  test("keeps blank lines and does not dedent them", () => {
    const ruby = [
      "test 'blanks' do",
      "  input = <<~'EOS'",
      "  para one",
      "",
      "  para two",
      "  EOS",
      "end",
    ].join("\n");
    expect(extractCorpusCases(ruby, "t.rb")[0]?.input).toBe(
      "para one\n\npara two\n",
    );
  });

  test("indexes multiple heredocs within one test", () => {
    const ruby = [
      "test 'two docs' do",
      "  input = <<~'EOS'",
      "  one",
      "  EOS",
      "  expected = <<~'EOS'",
      "  two",
      "  EOS",
      "end",
    ].join("\n");
    expect(extractCorpusCases(ruby, "t.rb").map((c) => c.id)).toEqual([
      "t.rb#two docs#0",
      "t.rb#two docs#1",
    ]);
  });

  test("disambiguates duplicate test names", () => {
    const ruby = [
      "test 'same' do",
      "  input = <<~'EOS'",
      "  a",
      "  EOS",
      "end",
      "test 'same' do",
      "  input = <<~'EOS'",
      "  b",
      "  EOS",
      "end",
    ].join("\n");
    expect(extractCorpusCases(ruby, "t.rb").map((c) => c.id)).toEqual([
      "t.rb#same#0",
      "t.rb#same~2#0",
    ]);
  });

  test("skips double-quoted heredocs (escapes and interpolation)", () => {
    const ruby = [
      "test 'escaped' do",
      "  input = <<~EOS",
      String.raw`  \x20- Foo`,
      "  EOS",
      "end",
    ].join("\n");
    expect(extractCorpusCases(ruby, "t.rb")).toEqual([]);
  });

  test("attributes heredocs outside any test block", () => {
    const ruby = ["SAMPLE = <<~'EOS'", "sample", "EOS"].join("\n");
    expect(extractCorpusCases(ruby, "t.rb")).toEqual([
      { id: "t.rb#(outside test)#0", input: "sample\n" },
    ]);
  });

  test("leaves tab-indented lines intact (margin from spaces only)", () => {
    // Ruby's <<~ treats a tab as advancing to the next 8-column stop
    // when computing the margin. We approximate: the margin is the
    // minimum count of leading SPACES across non-empty lines, so any
    // line starting with a tab forces margin 0 and no dedent. At the
    // pinned commit no single-quoted heredoc mixes tab and space
    // margins, so the approximation is exact in practice.
    const ruby = [
      "test 'tabs' do",
      "  input = <<~'EOS'",
      "\t- Foo",
      "  EOS",
      "end",
    ].join("\n");
    expect(extractCorpusCases(ruby, "t.rb")[0]?.input).toBe("\t- Foo\n");
  });
});

describe("serializeCorpus", () => {
  test("emits one JSON object per line with trailing newline", () => {
    const jsonl = serializeCorpus([
      { id: "a#t#0", input: "x\n" },
      { id: "b#t#0", input: "y \n" },
    ]);
    expect(jsonl).toBe(
      '{"id":"a#t#0","input":"x\\n"}\n{"id":"b#t#0","input":"y \\n"}\n',
    );
  });

  test("returns empty string for an empty corpus", () => {
    expect(serializeCorpus([])).toBe("");
  });

  test("escapes non-ASCII so a BOM is visible and round-trips", () => {
    // Escapes, not literal characters: a literal BOM in test source
    // would be invisible and vulnerable to editor stripping — the
    // exact failure mode the ASCII-only serialization guards against.
    const input = "\u{FEFF}= \u{DC}n\u{EF}code \u{1F600}\n";
    const jsonl = serializeCorpus([{ id: "bom", input }]);
    // The emitted line must be pure ASCII with the BOM legible and
    // the astral emoji escaped as its surrogate pair...
    expect(jsonl).toBe(
      '{"id":"bom","input":"\\ufeff= \\u00dcn\\u00efcode \\ud83d\\ude00\\n"}\n',
    );
    // ...and parsing must recover the exact original string.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- JSON.parse returns unknown
    expect((JSON.parse(jsonl) as { input: string }).input).toBe(input);
  });
});
