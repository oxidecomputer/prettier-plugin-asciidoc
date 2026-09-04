/**
 * The plugin's own options: camelCase and language-prefixed, by
 * Prettier convention (`asciidocTableLayout`, not `tableLayout`).
 *
 * A spelling earns a place here only when BOTH spellings are provably
 * safe: something a reader can pick between without one choice being
 * wrong. A spelling with only one safe form is never an option (it is
 * a rule instead) - the pad in front of a mid-line separator is
 * absent for exactly this reason.
 *
 * A table's canonical delimiter length is 3 and is NOT governed by
 * any block-delimiter-length option a later change adds
 * (`MIN_TABLE_DELIMITER_LENGTH`, src/constants.ts).
 */
import type { SupportOptions } from "prettier";

// Prettier's own options type already admits arbitrary names as
// `unknown` (index.d.ts, RequiredOptions' `[_: string]: unknown`).
// Declaring the two here is what gives them real types, and it is
// legal because a declared member's type must be assignable to the
// index signature's, which `unknown` always is.
declare module "prettier" {
  interface RequiredOptions {
    /** One recorded row per source line, or one cell per line after the first row. */
    asciidocTableLayout: "row" | "cell";
    /** Whether an accepted table's cell text is padded so the separators line up. */
    asciidocTableAlignColumns: boolean;
  }
}

export const asciidocOptions: SupportOptions = {
  asciidocTableLayout: {
    type: "choice",
    category: "Global",
    default: "row",
    description:
      "How an accepted table's rows are laid out. `row` puts one recorded row on one source line, unless the table does not fit in the print width, in which case it prints in the cell style. `cell` puts one cell per line after the first row, whatever the width.",
    choices: [
      { value: "row", description: "One recorded row per source line." },
      {
        value: "cell",
        description: "One cell per source line after the first row.",
      },
    ],
  },
  asciidocTableAlignColumns: {
    // `true` is also safe, measured. The argument for `false` is diff
    // churn, and that an aligned table sitting beside a table the
    // layout declines is worse than neither being aligned. Flip this
    // one field to take the other side.
    type: "boolean",
    category: "Global",
    default: false,
    description:
      "Pad cell text so the separators line up. Applies only where rows are on one line, and is a no-op for a table holding a colspan or a rowspan.",
  },
};

/**
 * The style a table reads off, the printer's own vocabulary.
 * Exported for tests/plugin.test.ts; `src/print/` is the real `src`
 * consumer once the table printer reads it.
 * @internal
 */
export interface TableStyle {
  /** One recorded row per line, or one cell per line after the first row. */
  readonly layout: "row" | "cell";
  /** Whether cell text is padded so the separators line up. */
  readonly alignColumns: boolean;
  /** The width in force, which is what chooses a `"row"` table's real layout. */
  readonly printWidth: number;
}

// The three fields the printer reads, module-private: an exported
// type with no named importer is a knip failure.
interface TableOptionsSource {
  readonly printWidth: number;
  readonly asciidocTableLayout: "row" | "cell";
  readonly asciidocTableAlignColumns: boolean;
}

/**
 * Renames the two plugin options and the print width into the
 * printer's own vocabulary. The ONE read of these fields: nothing in
 * `src/print/` reads `options.asciidocTable*` directly, so the
 * printer has one view of the style and there is no second place for
 * a default to be spelled.
 *
 * Exported for tests/plugin.test.ts; `src/print/` is the real `src`
 * consumer once the table printer calls it.
 * @internal
 * @param options - the three fields Prettier resolves for this run
 * @returns the printer's own table style
 */
export function tableStyle(options: TableOptionsSource): TableStyle {
  return {
    layout: options.asciidocTableLayout,
    alignColumns: options.asciidocTableAlignColumns,
    printWidth: options.printWidth,
  };
}
