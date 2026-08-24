import type { Plugin } from "prettier";
import language from "./language.js";
import parser from "./parser.js";
import printer from "./print/printer.js";

const plugin: Plugin = {
  languages: [language],
  parsers: {
    asciidoc: parser,
  },
  printers: {
    "asciidoc-ast": printer,
  },
};

export default plugin;
export { locStart, locEnd } from "./parser.js";
