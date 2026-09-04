/**
 * `scripts/parity.ts`'s command-line parsing and its expected-diff
 * ledger, which lives in COMMIT MESSAGES: `parseArguments`, the closed
 * family enumeration, the staleness/cross-check gate, and the
 * detail-printing it drives.
 *
 * Split out of `scripts/parity.ts` to keep that file under the
 * project's `max-lines` ceiling — which is also why the two SHAPE
 * FOLDS at the bottom of this file live here: they belong to the
 * DUMPER's embedded, SELF-CONTAINED function cluster (see
 * `normalizeTree`'s JSDoc in parity.ts) and carry that cluster's
 * rules with them — no reference to anything outside their own
 * bodies, because `.toString()` embeds them into a baseline checkout
 * that has never seen this module. Everything ABOVE them only parses
 * arguments and post-processes the two dumps' digests.
 *
 * The `Parity-Diff:` trailer SCAN moved to `scripts/parity-trailers.ts`
 * when this file reached the same `max-lines` ceiling on its own
 * account; that module imports {@link ExpectedDiff} from here, never
 * the reverse. `reportExpectedDiffs` takes `reportCase` as a parameter
 * rather than importing it, so this module never imports FROM
 * `parity.ts`: `parity.ts` imports from here, never the reverse, which
 * keeps the pair acyclic (the metrics gate holds import cycles at 0).
 */
import { GATE_FAILED } from "./lib/cli.js";
import { blanketCoverage } from "./parity-keys.js";

// `no-magic-numbers` is on outside tests; these are ordinary array
// bookkeeping, duplicated from parity.ts rather than imported for the
// same acyclic-imports reason as `reportCase`. The exit code is the
// exception: it comes from the one place that states the contract.
const ZERO = 0;
const DEFAULT_LIMIT = 20;

/**
 * The options that take no value. Kept as a Set so `parseArguments`
 * spends one branch on all of them (see the comment at its use site).
 */
const BOOLEAN_FLAGS = new Set([
  "--allow-parent-block-end",
  "--formatted-ledger",
]);

/**
 * The family sets the ledger gate runs under: the closed
 * enumeration, and the subset whose cases may differ in formatted
 * output only. A PARAMETER of the gate — the production call site
 * (scripts/parity.ts) passes {@link LEDGER_FAMILIES}; the
 * unit tests pass synthetic sets, so swapping the enum is a one-line
 * data change with no test edits.
 */
export interface FamilySets {
  /** Every family a ledger entry may cite. */
  readonly families: ReadonlySet<string>;
  /** The subset whose cases may differ in formatted output ONLY. */
  readonly formattedOnly: ReadonlySet<string>;
  /**
   * The families a BARE trailer may declare, each with the serialized
   * AST keys it owns, spelled as they appear in the dumped JSON.
   *
   * A schema change - a node kind that starts recording a fact - moves
   * every case that has that node kind and no case's bytes, so the
   * per-id form would spell a thousand identical lines whose only
   * information is a number. A family here says instead: these keys,
   * and nothing else, may differ. {@link blanketCoverage} is the
   * canonical statement of why the gate still has to PROVE that of
   * every case it excuses, rather than take the declaration on faith.
   *
   * A family absent from this map cannot be declared bare. That is
   * deliberate: a bare trailer on a family whose diffs are NOT one
   * schema key would excuse arbitrary tree changes.
   */
  readonly blanketKeys: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * The family ids, one declaration each — grid rows in
 * scripts/shape-registry-list-run.ts and the `Parity-Diff:` trailers
 * in commit messages cite these, so a rename cannot orphan a
 * spelling. Two name the printer's byte-only changes — the
 * invented-`+` deletion and the pseudo-run-fold corruption fix — two
 * name the marker families (author spellings replayed, nesting
 * fidelity restored), one names the retirement of the `+` that
 * attached nothing, and one its return where the tail it lands in
 * re-reads inert.
 */
export const AUTHOR_PLUS_FAMILY = "author-plus";
export const PSEUDO_RUN_FOLD_FAMILY = "pseudo-run-fold";
export const MARKER_SPELLING_FAMILY = "marker-spelling";
export const NESTING_FIDELITY_FAMILY = "nesting-fidelity";
/**
 * A `+` that attached nothing is popped, renders nothing and is no
 * longer written — where the reader can prove the pop is Ruby's own.
 * Formatted-only: the field the item carries is dropped from BOTH
 * sides by parity's `normalizeOneItem`, so the record's own shape is
 * invisible here whether it exists or not.
 */
export const NO_OP_CONTINUATION_FAMILY = "no-op-continuation";
/**
 * The third and later `+` of an adjacent run is read and dropped, as
 * `parse_list_item`'s own gate always said. NOT formatted-only, and
 * one id: `lists_test.rb#consecutive list continuation lines are
 * folded#0`, whose tree moves by exactly two things — the `paragraph`
 * child holding a single `rawLine` `"+"` at offsets 67-68 goes, and
 * the item's `position.end` follows it back onto the end of the last
 * remaining content line. Its own family so the byte-only ids above
 * keep the AST cross-check armed. NOT exported: no grid row cites it,
 * and knip holds dead exports at 0.
 */
const NO_OP_CONTINUATION_TREE_FAMILY = "no-op-continuation-tree";
/**
 * The other side of `no-op-continuation`: a `+` the item scan popped
 * (parser.rb l.1580-82) is written back wherever the tail it would
 * land in re-reads inert, instead of only where the item's last block
 * reads on past the item. The block-shape half of the old test asked
 * a question our node kinds cannot answer, and it deleted the byte on
 * items whose held metadata closed a block early. Formatted-only, and
 * this is the whole of the byte-level claim: `trailingContinuation`
 * is not one of the seven fields `normalizeOneItem` keeps, so it is
 * dropped from BOTH sides of the comparison and every id below moves
 * bytes with a normalized tree that is identical hash for hash. NOT
 * exported: no grid row cites it, and knip holds dead exports at 0.
 */
const TRAILING_CONTINUATION_KEPT_FAMILY = "trailing-continuation-kept";
/**
 * One unset spelling (`:name!:` respelled `:!name:`, one fact per
 * `store_attribute`, parser.rb l.2131-41) and lowercase entry names
 * (`sanitize_attribute_name`, l.2770-71). Formatted-only: the
 * `unset` field's own shape change rides
 * {@link foldAttributeEntryUnset}, and the name's case never left the
 * printer. NOT exported, unlike the four above it: no grid row cites
 * it — attribute entries are outside every shape grid — and knip
 * holds dead exports at 0.
 */
const ATTRIBUTE_ENTRY_SPELLING_FAMILY = "attribute-entry-spelling";
/**
 * One spacing for every bracket interior Asciidoctor hands to
 * `AttributeList` — no blank around a comma, none at the edges
 * (attribute_list.rb l.30-34, l.199-201). Formatted-only: the
 * interior is an opaque slice in the AST and the rule runs at print
 * time, so no tree moves. Not exported: no grid row cites it.
 */
const ATTRLIST_SPACING_FAMILY = "attrlist-spacing";
/**
 * A shorthand xref's leading blank, trimmed (`link_text.lstrip`,
 * substitutors.rb l.746). Formatted-only: a print-time derivation
 * over a field the AST already carried. Not exported: no grid row
 * cites it.
 *
 * NAMED FOR ITS MEMBER. It was `inline-mark-spelling`, after the
 * constrained-mark respell that landed in the same commit — and that
 * half moved NOTHING: 25 unconstrained spans in 5 corpus documents,
 * in = out = 25, every one refused for a stated reason. A family id is
 * what a future reader greps for, and that one pointed away from the
 * only id in it. If a mark respell ever moves a corpus id it gets a
 * family of its own, with its own argument.
 */
const XREF_TEXT_TRIM_FAMILY = "xref-text-trim";
/**
 * A blank RUN inside a list item's gap collapses to one blank, up to
 * the gap's first `+` (a run after one erases it, parser.rb l.1576).
 * Formatted-only: the recorded gap is unchanged and the collapse
 * happens in `gapParts`. Not exported: no grid row cites it.
 */
const GAP_COLLAPSE_FAMILY = "gap-collapse";
/**
 * The erased tail behind a frozen `+` paragraph is printed back (one
 * blank and a `+` — the shield that absorbs the re-read's single
 * tagged pop, parser.rb l.1576/l.1580-82), and a list whose tail
 * keeps a `+` armed through metadata is separated from the next block
 * by TWO blanks (one attaches, l.1483). Formatted-only: the item
 * fields carrying the two facts (`detachedTail`, `activeTail`) are
 * dropped by the item canonicalization the way `trailingContinuation`
 * is, so only bytes move. Not exported: no grid row cites it.
 */
const PLUS_RUN_TAIL_KEPT_FAMILY = "plus-run-tail-kept";
/**
 * A `+` run's parse follows the JS oracle's tagged Strings: an inner
 * item scan hard-stops at the erased Placeholder (parser.js l.2168),
 * the sibling probe eats it, and a frozen `+` opened after a skipped
 * blank heads a FOLDED paragraph that runs through marker lines
 * (l.1065, l.3018-47). NOT formatted-only — the trees move (a nested
 * list splits around the `+` paragraph, marker lines become its raw
 * lines) while the bytes hold. Not exported: no grid row cites it.
 */
const PLUS_RUN_PARAGRAPH_FAMILY = "plus-run-paragraph";
/**
 * A leading U+FEFF strips off the document head before line splitting,
 * as `Helpers.prepare_source_string` always did (helpers.rb, and
 * helpers.js in the pinned JS oracle; reader.rb only calls it) - so a
 * first line the BOM used to hide behind (a doctitle, an attribute
 * entry) now reads as itself. NOT formatted-only: the bytes hold (the
 * mark is put back on the formatted head) while the tree moves - the
 * fixture's paragraph becomes the level-0 heading it always was to
 * Asciidoctor.
 * Not exported: no grid row cites it.
 */
const BOM_DOCUMENT_HEAD_FAMILY = "bom-document-head";
/**
 * The constrained-mark boundary set is Ruby's own (`QUOTE_SUBS`,
 * asciidoctor.rb l.448-464, transcribed in
 * src/parse/inline/quote-boundaries.ts): a single mark is a token
 * only where the constrained pattern could open or close with it, and
 * the builder's pairing is directional. NOT formatted-only - spans
 * DISSOLVE into text or CRYSTALLIZE out of it. Nine ids, three
 * mechanisms, each verified render-equal before ledgering:
 *
 * - curved-quote monospace dissolves (`"` sits in mono's
 *   excluded-left class and right lookahead - `"\`word\`"` is a
 *   curved-quote pair to Ruby, not a span):
 *   docs/modules/ROOT/pages/index.adoc, localization-support.adoc,
 *   convert/pages/available.adoc, manpage-backend/pages/index.adoc,
 *   migrate/pages/asciidoc-py.adoc - AST-only, bytes identical,
 *   formatted output measured render-equal to the source;
 * - a highlight over `#`-adjacent text dissolves (whats-new.adoc's
 *   `... for # in xref target (#4393)`: the closing `#` stands
 *   before a word character) - AST-only, measured render-equal;
 * - bold crystallizes where `=` follows the closing mark
 *   (`*-B, --base-dir*=_DIR_`: `=` fails Ruby's `(?!\p{Word})`, so
 *   the span is real to the oracle too):
 *   cli/partials/man-asciidoctor.adoc, whose reflow also moves bytes
 *   (the fused span atoms pack differently at width), and
 *   manpage-backend/examples/manpage.adoc (AST-only); and the
 *   spurious bold over indented `* one` list lines dissolves in
 *   lists_test.rb#appends indented list to first term that is
 *   attached by a continuation and adjacent to second term#0
 *   (AST-only). These three carry a PRE-EXISTING render divergence
 *   to their source that this family does not touch: measured
 *   head-formatted == base-formatted rendering, byte-for-byte of the
 *   normalized HTML. Not exported: no grid row cites it.
 */
const INLINE_BOUNDARY_SET_FAMILY = "inline-boundary-set";
/**
 * A span's edge line break is content the oracle keeps (`sub_quotes`
 * matches across the joined lines and carries the `\n` into the HTML
 * verbatim, substitutors.rb l.189-196); the builder strips trailing
 * newlines at the block-level entry only, and the printer replays
 * the kept break as the one space inside the marks. NOT
 * formatted-only - span text values gain `\n` and the bytes gain the
 * edge space. One id: blocks_test.rb#should not recognize fenced
 * code blocks with more than three delimiters#0, whose unconstrained
 * monospace span (the four-backtick pseudo-fence) keeps its trailing
 * break and prints the closing marks after a space. Verified: the
 * formatted rendering MOVED TOWARD the source - the base output
 * dropped the span's trailing whitespace where the source renders
 * `World!" </code>`, the head output renders that fragment exactly
 * as the source does - and the residual divergence (the `~~~~`
 * pseudo-fence paragraph) is byte-identical between the base and
 * head renderings. Not exported: no grid row cites it.
 */
const INLINE_SPAN_KEEPS_BREAK_FAMILY = "inline-span-keeps-break";
/**
 * A `+` that was its own source line keeps its own output line:
 * reflow's line-END exemption (`keepContinuationLine`,
 * src/print/reflow.ts) refuses the join that used to pull the
 * following text up onto the `+`, because Asciidoctor's reader would
 * re-read the joined line as prose instead of a continuation
 * (issue #43). Formatted-only: the `+` line's placement never
 * entered the AST - the tree recorded the continuation either way,
 * and only the printed line layout moves. Not exported: no grid row
 * cites it.
 */
const CONTINUATION_KEEPS_LINE_FAMILY = "continuation-keeps-line";
/**
 * An explicit ordered marker (`1.`, `a.`, `A.`, `i)`, `I)` - Ruby's
 * `OrderedListRx`, rx.rb l.300) now reads as a list marker where the
 * registry used to see prose. NOT formatted-only: the trees move
 * (paragraph text becomes an ordered list, `start` preserved via the
 * replayed spelling) and the bytes move with them; the family also
 * carries the width-refusal wrap shifts of the same change's
 * block-start guard, whose bytes move while the input tree holds.
 * Not exported: no grid row cites it.
 */
const EXPLICIT_ORDERED_MARKER_FAMILY = "explicit-ordered-marker";
/**
 * `+text+`, `++text++` and `+++text+++` are ONE atomic node carrying
 * their own bytes, because `extract_passthroughs` (substitutors.rb
 * l.1018) removes them from the line before any other substitution
 * runs and nothing between the delimiters is ever a construct to the
 * oracle (issue #25). NOT formatted-only - a passthrough ATOM
 * replaces whatever the old tokenizer spelled in its place: a run of
 * text, and sometimes a whole SPAN that the delimiters had hidden
 * from Ruby. Eight ids, measured old-vs-new over the 1,614-case
 * corpus:
 *
 * - seven are AST-ONLY, bytes identical: docs safe-modes.adoc
 *   (two `+include::[]+`), whats-new.adoc (`+<<idname,>>+` and
 *   `+\*(Aq+`), html-backend/skip-front-matter.adoc (`+---+`),
 *   cli/process-multiple-files.adoc, and the three
 *   document_test.rb legacy-doctitle compat-mode cases
 *   (`+content+`). process-multiple-files.adoc is the one that
 *   changes what the tree MEANS rather than only how it is spelled:
 *   a spurious constrained bold used to span the `*` of the two
 *   globs the page writes, `+*.adoc+` and the directory one spelled
 *   `+*` then `/*.adoc+`, and the passthroughs now hide those marks
 *   the way Ruby hides them (one bold node, gone). The three
 *   compat-mode
 *   cases carry a PRE-EXISTING render divergence to their source
 *   that this family does not touch - bytes identical, so the
 *   formatted rendering is unchanged.
 * - ONE moves bytes: blocks_test.rb#should display latexmath block
 *   in alt of equation in DocBook backend#1, where
 *   `+(1+x)^2 < y]]></alt>\n<mathphrase><![CDATA[\sqrt{3x-1}+` is
 *   now a single unbreakable atom and the packer wraps the
 *   surrounding line differently. Verified render-equal to its
 *   source on both sides.
 *
 * Not exported: no grid row cites it.
 */
const INLINE_PASSTHROUGH_FAMILY = "inline-passthrough";

/**
 * Issue #20: a bare email address becomes one atomic `link` node
 * (`form: "email"`) where the base read plain text. NOT
 * formatted-only: the tree moves. All fourteen cases are AST-only -
 * author lines and fixture prose gain the node with bytes identical,
 * so the formatted rendering is unchanged (Asciidoctor already made
 * the address a mailto link; the model only now agrees).
 *
 * Not exported: no grid row cites it.
 */
const EMAIL_AUTOLINK_FAMILY = "email-autolink";

/**
 * Issue #18: a titled document's header is one `documentHeader` node
 * owning its author line, revision line and header attribute entries,
 * where the base serialized a level-0 `heading` and let the lines
 * fall into the first paragraph. NOT formatted-only: every titled
 * document's first node changes kind (281 AST-only cases), and the 62
 * byte-moving cases are the ones where the base inserted the blank
 * line after the title that demoted the header lines to body content
 * - removing it is the fix the oracle agrees with. Twelve of the
 * byte-moving cases carry an email address on the author line and are
 * DECLARED UNDER email-autolink instead: a case takes one family, and
 * those twelve first diverged when issue #20 landed, one commit
 * earlier, so keeping their trailers there is what keeps every prefix
 * of the commit range self-consistent.
 *
 * Not exported: no grid row cites it.
 */
const DOCUMENT_HEADER_FAMILY = "document-header";

/**
 * A `"\`...\`"` or `'\`...\`'` pair becomes a `curvedQuote` node
 * (issue #74). The formatted bytes do not move - the printer writes
 * the pair's own delimiters back - so every declared case differs in
 * the AST alone: flattening the new nodes back to their source
 * delimiters reproduces the base tree exactly.
 *
 * Not exported: no grid row cites it.
 */
const CURVED_QUOTE_NODE_FAMILY = "curved-quote-node";

/**
 * Every paragraph records whether its first source line ends after
 * its first word (`ParagraphNode.firstWordEndsItsLine`, src/ast.ts),
 * the fact the printer's block-start hazard net reads in place of
 * re-deriving it from inline fragment values. The formatted bytes do
 * not move over this corpus - the net's answer changes only for a
 * paragraph whose first source line holds one marker-shaped word,
 * which no corpus case spells - so every declared case differs in the
 * AST alone, by that one key and nothing else. NOT formatted-only:
 * the key IS the difference, and a formatted-only family would fail
 * the cross-check for every case.
 *
 * Not exported: no grid row cites it.
 */
const BLOCK_START_LINE_FACT_FAMILY = "block-start-line-fact";

/**
 * A `[role]` in front of any mark span is the span's own attrlist
 * rather than a text node beside it (issue #108). Every declared
 * case therefore loses a text node, moves the span's
 * `position.start` onto the bracket, and gains a `role`; thirteen of
 * them also pack `[.path]_file_` as the one word it now is, so the
 * family is NOT formatted-only. Not a blanket family either: the
 * base tree also holds the extra text node and different span
 * positions, so no single-key strip could make the two dumps
 * deep-equal, and the per-id trailers carry the declaration.
 *
 * Not exported: no grid row cites it.
 */
const SPAN_ROLE_NODE_FAMILY = "span-role-node";

/**
 * A continued attribute entry (a value ending in ` \\`) is ONE entry
 * whose value reaches over the lines the continuation claims (issue
 * #24): the base tree read each continued line as its own block, the
 * head tree folds them into the entry's value, and the formatted
 * bytes keep the author's split points while the render is identical.
 * NOT formatted-only: the tree loses the blocks the value absorbed.
 *
 * Not exported: no grid row cites it.
 */
const ATTRIBUTE_CONTINUATION_FAMILY = "attribute-continuation";

/**
 * A document opening with a `---` fence holds YAML front matter
 * (issue #21): the base tree read the block as paragraph prose, the
 * head tree holds one frontMatter leaf replaying the author's bytes,
 * fence to fence. NOT formatted-only: the paragraph the base built is
 * gone and a leaf stands in its place.
 *
 * Not exported: no grid row cites it.
 */
const FRONT_MATTER_FAMILY = "front-matter";

/**
 * Issue #10: a `|===` block is a `table` node holding rows and cells,
 * where the base serialized a `delimitedBlock` whose `content` was
 * the whole block's text, delimiter lines included. NOT
 * formatted-only: every table-bearing case changes the kind of one
 * node and gains the tree under it. Not a blanket family either - no
 * single key strip makes the two dumps deep-equal, since the base
 * tree's `content`, `variant` and `form` all go and rows, cells,
 * openings and runs all arrive - so the per-id trailers carry the
 * declaration.
 *
 * The BYTE side is empty and measured, not assumed, RELATIVE TO A
 * BASE THAT ALREADY REPLAYS THE INTERIOR: across such a range the
 * printer writes the same partition the passthrough wrote, so a case
 * declared here differs in the AST alone. An id whose bytes also move
 * leaves this family's domain rather than joining it, because one id
 * takes exactly ONE trailer (`recordTrailer`,
 * scripts/parity-trailers.ts, fails an id declared under two
 * families, and `differingCases`, scripts/parity.ts, puts an id in
 * the AST stream or the formatted stream and never in both). Which
 * one it takes follows from that split: where the AST is unchanged
 * and only the delimiter moved it is
 * {@link TABLE_DELIMITER_LENGTH_FAMILY}, and where the table fold
 * itself is in the range the id differs in the AST, so `table-node`
 * is the single legal declaration and the byte side of the family is
 * NOT empty over that range.
 *
 * Not exported: no grid row cites it.
 */
const TABLE_NODE_FAMILY = "table-node";

/**
 * A table's two delimiter lines take the shortest spelling that is at
 * least three characters long and equals no interior line, so a
 * longer-than-canonical `|=======` comes back as `|===` and the
 * terminator moves with it. FORMATTED-ONLY: the length is a property
 * of the OUTPUT, and neither tree records it - the opening and closing
 * images the base and head both hold are the author's - so an AST
 * diff at one of these ids is a real failure.
 *
 * Exported: the standing grid's `tablePipe` rows cite it where a
 * container swallows the opening delimiter and the interior `|====`
 * opens a table of its own (`TABLE_PIPE_FAMILIES`,
 * scripts/shape-registry-families.ts).
 */
export const TABLE_DELIMITER_LENGTH_FAMILY = "table-delimiter-length";

/**
 * Every table cell records the column it inherits its style from
 * (`TableCellNode.columnIndex`, src/ast.ts): its physical position in
 * its row after duplicate expansion, which a consumer would otherwise
 * re-derive by counting the same cells a second time. The formatted
 * bytes do not move at all, over this corpus or any other, because
 * nothing in src/print reads the field yet - so every declared case
 * differs in the AST alone, by that one key and nothing else. NOT
 * formatted-only: the key IS the difference, and a formatted-only
 * family would fail the cross-check for every case.
 *
 * Not exported: no grid row cites it.
 */
const TABLE_CELL_COLUMN_INDEX_FAMILY = "table-cell-column-index";

/**
 * A table whose facts the model fully records takes one NORMAL FORM:
 * one recorded row per source line, one space in front of every
 * mid-line separator, the separator flush against its cell's first
 * content byte, and one blank line after the first row exactly when
 * the first row is a header row. A table holding any of ten facts
 * the layout cannot answer for keeps its interior byte for byte
 * instead.
 *
 * FORMATTED-ONLY: the tree is untouched. Every fact the gate reads and
 * every byte the emission writes comes off records the reader already
 * made, so an AST diff at one of these ids is a real failure. Ids
 * whose delimiter ALSO moved take this family and not
 * {@link TABLE_DELIMITER_LENGTH_FAMILY}, because one id takes exactly
 * ONE trailer (`recordTrailer`, scripts/parity-trailers.ts) and this
 * is the wider of the two: the delimiter is respelled from the
 * interior this family produced.
 *
 * Not exported: no grid row cites it.
 */
const TABLE_LAYOUT_FAMILY = "table-layout";

/**
 * A table records that a block attribute line stood above it whose
 * values its open could NOT read: a second attribute line, or one
 * standing behind a title or an anchor, which the reader's
 * last-node rule refuses (`TableNode.attrlistUnread`, src/ast.ts).
 * Asciidoctor reads every metadata line above a block into one
 * attribute hash whatever the order (`parse_block_metadata_lines`,
 * parser.rb:2014-2021), so the fact is what stops a consumer acting
 * on a `cutting`, a `columns` or a `header` resolved from less than
 * the author wrote.
 *
 * NOT formatted-only: the key IS the difference at these ids. Their
 * bytes move too - the delimiter rule reaches every table - but an id
 * takes exactly ONE trailer and an id whose AST differs may not take a
 * formatted-only family, so this is the single legal declaration for
 * one, exactly as {@link TABLE_NODE_FAMILY} is over its own range.
 *
 * Not exported: no grid row cites it.
 */
const TABLE_UNREAD_ATTRLIST_FAMILY = "table-unread-attrlist";

/**
 * The closed family enum. SURFACE HONESTY, not an armed
 * gate: a family id can only legally be a corpus id or an
 * identity-fixture id. The formatted-only subset is exactly
 * author-plus, pseudo-run-fold, no-op-continuation,
 * attribute-entry-spelling, attrlist-spacing, xref-text-trim,
 * gap-collapse, plus-run-tail-kept, trailing-continuation-kept,
 * continuation-keeps-line, table-delimiter-length (which respells a
 * table's two delimiter lines, a length neither tree records) and
 * table-layout (which rewrites an accepted table's interior from
 * records both trees already hold): they change BYTES only,
 * while both marker families ride the list tree
 * fold (`marker` added, `depth` dropped), no-op-continuation-tree
 * drops a block the reader used to build, plus-run-paragraph reshapes
 * a `+` run's item blocks, bom-document-head re-reads the line a
 * leading BOM hid, the two inline SPAN families move spans
 * (dissolved, crystallized, or holding a kept `\n`),
 * inline-passthrough replaces text - and sometimes a whole span -
 * with one atomic passthrough node,
 * explicit-ordered-marker turns prose into ordered lists,
 * email-autolink hardens a bare address into one atomic link node,
 * document-header re-roots a titled document's opening lines under
 * one header node, curved-quote-node turns a quoted backtick pair
 * into a node, block-start-line-fact records the source-line
 * question the printer used to re-derive, table-node replaces a
 * table's opaque text with the cells it was cut into, and
 * table-cell-column-index records the column every cell inherits its
 * style from, and table-unread-attrlist records that an attribute line
 * above a table went unread, so an entry of those sixteen whose AST
 * differs is legal
 * and an entry of any other family whose AST differs fails the
 * cross-check.
 */
export const LEDGER_FAMILIES: FamilySets = {
  families: new Set([
    ATTRIBUTE_CONTINUATION_FAMILY,
    AUTHOR_PLUS_FAMILY,
    FRONT_MATTER_FAMILY,
    CURVED_QUOTE_NODE_FAMILY,
    PSEUDO_RUN_FOLD_FAMILY,
    MARKER_SPELLING_FAMILY,
    NESTING_FIDELITY_FAMILY,
    NO_OP_CONTINUATION_FAMILY,
    NO_OP_CONTINUATION_TREE_FAMILY,
    TRAILING_CONTINUATION_KEPT_FAMILY,
    ATTRIBUTE_ENTRY_SPELLING_FAMILY,
    ATTRLIST_SPACING_FAMILY,
    XREF_TEXT_TRIM_FAMILY,
    GAP_COLLAPSE_FAMILY,
    PLUS_RUN_TAIL_KEPT_FAMILY,
    PLUS_RUN_PARAGRAPH_FAMILY,
    BOM_DOCUMENT_HEAD_FAMILY,
    INLINE_BOUNDARY_SET_FAMILY,
    INLINE_SPAN_KEEPS_BREAK_FAMILY,
    CONTINUATION_KEEPS_LINE_FAMILY,
    EXPLICIT_ORDERED_MARKER_FAMILY,
    INLINE_PASSTHROUGH_FAMILY,
    EMAIL_AUTOLINK_FAMILY,
    DOCUMENT_HEADER_FAMILY,
    BLOCK_START_LINE_FACT_FAMILY,
    SPAN_ROLE_NODE_FAMILY,
    TABLE_NODE_FAMILY,
    TABLE_DELIMITER_LENGTH_FAMILY,
    TABLE_CELL_COLUMN_INDEX_FAMILY,
    TABLE_LAYOUT_FAMILY,
    TABLE_UNREAD_ATTRLIST_FAMILY,
  ]),
  formattedOnly: new Set([
    AUTHOR_PLUS_FAMILY,
    PSEUDO_RUN_FOLD_FAMILY,
    NO_OP_CONTINUATION_FAMILY,
    TRAILING_CONTINUATION_KEPT_FAMILY,
    ATTRIBUTE_ENTRY_SPELLING_FAMILY,
    ATTRLIST_SPACING_FAMILY,
    XREF_TEXT_TRIM_FAMILY,
    GAP_COLLAPSE_FAMILY,
    PLUS_RUN_TAIL_KEPT_FAMILY,
    CONTINUATION_KEEPS_LINE_FAMILY,
    TABLE_DELIMITER_LENGTH_FAMILY,
    TABLE_LAYOUT_FAMILY,
  ]),
  // Two families, and each owns exactly the field it named, as the
  // dumper serializes it: `ParagraphNode.firstWordEndsItsLine` and
  // `TableCellNode.columnIndex` (both src/ast.ts). Every other family
  // names a change to what the tree MEANS at some ids; these two name
  // a field every paragraph, or every table cell, gained.
  blanketKeys: new Map([
    [BLOCK_START_LINE_FACT_FAMILY, new Set(["firstWordEndsItsLine"])],
    [TABLE_CELL_COLUMN_INDEX_FAMILY, new Set(["columnIndex"])],
  ]),
};

/** One expected-diff ledger entry: a case allowed to differ, and why. */
export interface ExpectedDiff {
  /** Corpus case id, or `fixture:<name>`. */
  id: string;
  /** The family that explains the difference (see {@link FamilySets}). */
  family: string;
}

/**
 * One ledger entry's own failure, if any: an unknown family, an id
 * that has vanished from the corpus, an id that no longer differs,
 * and the formatted-only cross-check. Split out from
 * {@link expectedDiffFailures} to stay under the complexity ceiling;
 * each entry produces AT MOST one failure — the inline version this
 * replaces used `continue` after the first match — so returning a
 * single value keeps the caller's ordering identical.
 * @param entry - the ledger entry to check
 * @param streams - the two differing-id sets from differingCases
 * @param streams.ast - ids whose AST differs (or one side lacks)
 * @param streams.formatted - ids differing in formatted output only
 * @param corpusIds - every id this checkout's dump produced
 * @param familySets - the closed family enumeration
 * @returns the failure message, or undefined when the entry is clean
 */
function ledgerEntryFailure(
  entry: ExpectedDiff,
  streams: { ast: ReadonlySet<string>; formatted: ReadonlySet<string> },
  corpusIds: ReadonlySet<string>,
  familySets: FamilySets,
): string | undefined {
  const { id, family } = entry;
  const { ast, formatted } = streams;
  if (!familySets.families.has(family)) {
    return `expected-diffs: unknown family ${JSON.stringify(family)} on ${id} - the enum is ${[...familySets.families].join(" | ")}`;
  }
  if (!corpusIds.has(id)) {
    return `expected-diffs: ${id} is not in the corpus (vanished id, stale entry - delete it)`;
  }
  if (!ast.has(id) && !formatted.has(id)) {
    return `expected-diffs: ${id} no longer differs from the baseline (stale entry - delete it)`;
  }
  if (ast.has(id) && familySets.formattedOnly.has(family)) {
    return `expected-diffs: ${id} differs in the AST but ${family} is a formatted-only family`;
  }
  return undefined;
}

/**
 * The expected-diff gate: which findings fail a run under
 * `--expected-diffs-trailers` — every failure an entry can carry (see
 * {@link ledgerEntryFailure}) plus the other direction, an id that
 * differs with NO entry excusing it. Every returned line is a
 * failure; an empty result is a pass.
 * @param entries - the declared ledger entries
 * @param streams - the two differing-id lists from differingCases
 * @param streams.ast - ids whose AST differs (or one side lacks)
 * @param streams.formatted - ids differing in formatted output only
 * @param corpusIds - every id this checkout's dump produced
 * @param familySets - the closed family enumeration
 * @returns one message per failure
 */
export function expectedDiffFailures(
  entries: readonly ExpectedDiff[],
  streams: { ast: readonly string[]; formatted: readonly string[] },
  corpusIds: ReadonlySet<string>,
  familySets: FamilySets,
): string[] {
  const failures: string[] = [];
  const byId = new Map(entries.map((entry) => [entry.id, entry.family]));
  const ast = new Set(streams.ast);
  const formatted = new Set(streams.formatted);
  for (const entry of entries) {
    const failure = ledgerEntryFailure(
      entry,
      { ast, formatted },
      corpusIds,
      familySets,
    );
    if (failure !== undefined) {
      failures.push(failure);
    }
  }
  for (const id of streams.ast) {
    if (!byId.has(id)) {
      failures.push(
        `parity: ${id} differs in the AST and is not declared by a Parity-Diff trailer`,
      );
    }
  }
  for (const id of streams.formatted) {
    if (!byId.has(id)) {
      failures.push(
        `parity: ${id} differs in formatted output and is not declared by a Parity-Diff trailer`,
      );
    }
  }
  return failures;
}

/**
 * The `--expected-diffs-trailers` report path: print the ledger's
 * verdict and detail exactly the ids a human must read. Split out of
 * `report` in parity.ts to stay under the complexity ceiling.
 * @param options - everything the gate and its detail pass need
 * @param options.expectedDiffs - the entries the trailers declared
 * @param options.trailerFailures - the declarations that did not
 *   parse, or that contradicted each other; they fail the run the
 *   same way an undeclared diff does, and are printed first because a
 *   trailer that did not parse is why an id below looks undeclared
 * @param options.ast - ids whose AST differs
 * @param options.formatted - ids differing in formatted output only
 * @param options.headIds - every id this checkout's dump produced
 * @param options.headSize - how many cases this checkout's dump
 *   produced, for the "cases match" message
 * @param options.baseRoot - the materialized baseline checkout
 * @param options.revision - the revision compared against, for the
 *   message
 * @param options.limit - how many differing cases to detail
 * @param options.allowParentBlockEnd - whether forced-closed
 *   parentBlock ends were blanked on both sides
 * @param options.familySets - the closed family enumeration
 * @param options.blanket - the families a bare trailer declared
 * @param options.covers - proves one id against one family's declared
 *   keys, injected for the same reason `reportCase` is
 * @param options.reportCase - prints one case's per-side difference;
 *   injected rather than imported so this module never imports FROM
 *   parity.ts (see the module-level comment)
 */
export function reportExpectedDiffs(options: {
  expectedDiffs: readonly ExpectedDiff[];
  blanket: readonly string[];
  trailerFailures: readonly string[];
  ast: readonly string[];
  formatted: readonly string[];
  headIds: ReadonlySet<string>;
  headSize: number;
  baseRoot: string;
  revision: string;
  limit: number;
  allowParentBlockEnd: boolean;
  familySets: FamilySets;
  covers: (id: string, keys: ReadonlySet<string>) => boolean;
  reportCase: (id: string, baseRoot: string, allow: boolean) => void;
}): void {
  const {
    expectedDiffs,
    trailerFailures,
    headIds,
    headSize,
    baseRoot,
    revision,
    limit,
    allowParentBlockEnd,
    familySets,
    reportCase,
  } = options;
  // The blanket pass runs FIRST and only ever REMOVES ids, so what
  // reaches the per-id gate below is exactly the set no bare trailer
  // could prove - and the detail pass reads the same reduced streams,
  // so a covered case is neither failed nor printed.
  const blanketPass = blanketCoverage(
    { blanket: options.blanket, entries: expectedDiffs },
    { ast: options.ast, formatted: options.formatted },
    familySets,
    options.covers,
  );
  const { ast, formatted } = blanketPass.streams;
  const failures = [
    ...trailerFailures,
    ...blanketPass.failures,
    ...expectedDiffFailures(
      blanketPass.entries,
      { ast, formatted },
      headIds,
      familySets,
    ),
  ];
  for (const line of failures) {
    process.stdout.write(`${line}\n`);
  }
  // Detail exactly the ids whose DIFF a human must read: unlisted
  // differing cases, and listed ones whose AST moved under a
  // formatted-only family. Exact id matching, never a substring
  // search over the failure text — a short id could select the
  // wrong case for reportCase.
  const families = new Map(
    expectedDiffs.map((entry) => [entry.id, entry.family]),
  );
  const astIds = new Set(ast);
  const needsDetail = (id: string): boolean => {
    const family = families.get(id);
    if (family === undefined) {
      return true;
    }
    return astIds.has(id) && familySets.formattedOnly.has(family);
  };
  const detailIds = [...new Set([...ast, ...formatted])].filter(needsDetail);
  for (const id of detailIds.slice(ZERO, limit)) {
    reportCase(id, baseRoot, allowParentBlockEnd);
  }
  if (failures.length > ZERO) {
    process.exitCode = GATE_FAILED;
    return;
  }
  // The count says how many of the expected diffs a BARE trailer
  // proved, because that number is the whole claim such a trailer
  // makes and the per-id lines that would otherwise carry it are gone.
  const blanketed = options.ast.length - ast.length;
  process.stdout.write(
    `parity: ${String(headSize)} cases match ${revision} (${String(ast.length + formatted.length + blanketed)} expected diffs, all ledgered; ${String(blanketed)} under a bare trailer's declared keys)\n`,
  );
}

/**
 * Validate and parse `--limit`'s argument. Split out of
 * {@link parseArguments} to stay under the complexity ceiling once
 * `--expected-diffs-trailers` added a branch there.
 * @param raw - the token after `--limit`, or undefined when it was
 *   the last argument
 * @returns the parsed limit
 * @throws {Error} when `raw` is missing or not a non-negative integer
 */
function parseLimit(raw: string | undefined): number {
  // `Number("fast")` is NaN, and `slice(0, NaN)` is empty: the run
  // would still exit 1 but print not one differing case, which
  // reads exactly like a harness that found nothing to say.
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < ZERO) {
    throw new Error(
      `parity: --limit needs a non-negative integer, got ${String(raw)}`,
    );
  }
  return limit;
}

/**
 * Parse the command line. Exported for tests/scripts/parity.test.ts.
 * @param argv - the arguments after the script name
 * @returns the base revision, the report limit, the allowlist flag,
 *   whether formatted-only differences are a ledger listing rather
 *   than a failure, and the head revision whose `Parity-Diff`
 *   trailers arm the ledger gate, if given
 * @throws {Error} when an argument is unrecognised or `--base` is
 *   missing — a silently dropped `--base` would compare a checkout
 *   with itself
 */
export function parseArguments(argv: readonly string[]): {
  revision: string;
  limit: number;
  allowParentBlockEnd: boolean;
  formattedLedger: boolean;
  expectedDiffsTrailers: string | undefined;
} {
  let revision: string | undefined = undefined;
  let limit = DEFAULT_LIMIT;
  let expectedDiffsTrailers: string | undefined = undefined;
  const flags = new Set<string>();
  // A queue rather than an index, because two of the five options
  // consume the argument after them.
  const rest = [...argv];
  while (rest.length > ZERO) {
    const argument = rest.shift() ?? "";
    if (argument.startsWith("--base=")) {
      revision = argument.slice("--base=".length);
      continue;
    }
    if (argument === "--base") {
      revision = rest.shift();
      continue;
    }
    if (argument === "--limit") {
      limit = parseLimit(rest.shift());
      continue;
    }
    if (argument === "--expected-diffs-trailers") {
      const raw = rest.shift();
      if (raw === undefined) {
        throw new Error("parity: --expected-diffs-trailers needs a revision");
      }
      expectedDiffsTrailers = raw;
      continue;
    }
    // The two value-less options share one arm: a branch each puts this
    // function over the complexity ceiling, and a Set of accepted
    // spellings is where the third flag will go too.
    if (BOOLEAN_FLAGS.has(argument)) {
      flags.add(argument);
      continue;
    }
    throw new Error(`parity: unrecognised argument ${argument}`);
  }
  if (revision === undefined) {
    throw new Error("parity: --base <rev> is required");
  }
  return {
    revision,
    limit,
    allowParentBlockEnd: flags.has("--allow-parent-block-end"),
    formattedLedger: flags.has("--formatted-ledger"),
    expectedDiffsTrailers,
  };
}

// ── the DUMPER's embedded shape folds ────────────────────────────────

/**
 * Narrow an unknown value to an object whose properties can be read
 * by name.
 *
 * The narrowing every fold below opens with, spelled under the name
 * the DUMPER's embedded cluster uses: those folds are embedded into a
 * baseline checkout by `.toString()`, and the dumper defines
 * `isRecordLike` and `isUnknownArray` for them there. The names must
 * match, and the bodies must not reach outside themselves.
 * @param value - anything at all
 * @returns whether its properties can be read by name
 */
function isRecordLike(value: unknown): value is Record<string, unknown> {
  return value instanceof Object;
}

/**
 * Narrow an unknown value to an array whose elements are unknown.
 *
 * The same local duplicate story as {@link isRecordLike}: the name is
 * the one the DUMPER's embedded copy defines.
 * @param value - anything at all
 * @returns whether it is an array
 */
function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/**
 * Fold the anchor and admonition shape changes so SHAPE-preserving
 * refactors compare: a `blockAnchor` node folds back to the old
 * anchor-paragraph encoding; an admonition folds `form`/`delimiter`
 * to the old
 * spelling and blanks the body on BOTH sides (`content` → `""`,
 * `text` → `[]` — body BYTES stay policed by the formatted
 * comparison, the fixtures and the render-equality suite); the
 * `annotatedBy` key is dropped (its pin is invariant (xi), not
 * parity). Tolerates BOTH tree shapes — old and new — because the
 * dumper embeds this body into the BASELINE checkout too.
 *
 * KEY ORDER IS LOAD-BEARING: parity digests the JSON STRING, so every
 * arm constructs a fresh object with one explicit key order — never a
 * spread, which would keep each input shape's own insertion order and
 * make the two sides hash differently. The synthesized orders match
 * the old builders' literals (buildBlockAnchor, makeInlineAnchor);
 * the string-equality rows in tests/scripts/parity.test.ts pin them.
 * @param key - the reviver key
 * @param value - the revived value
 * @returns the folded value
 */
export function foldAnchorAndAdmonitionShapes(
  key: string,
  value: unknown,
): unknown {
  if (key === "annotatedBy") {
    return undefined;
  }
  if (!isRecordLike(value)) {
    return value;
  }
  if (value.type === "blockAnchor") {
    const { id, reftext, position } = value;
    return {
      type: "paragraph",
      children: [{ type: "inlineAnchor", id, reftext, position }],
      position,
    };
  }
  if (value.type !== "admonition") {
    return value;
  }
  const { type, variant, form, children, position } = value;
  const paragraph = form === "paragraph";
  return {
    type,
    variant,
    form: paragraph ? "paragraph" : "delimited",
    delimiter: paragraph
      ? undefined
      : (value.delimiter ?? (form === "delimited" ? undefined : form)),
    content: "",
    children,
    text: [],
    position,
  };
}

/**
 * Fold the section and heading shape changes: a `section` container
 * splices to `[heading, ...children]` IN ITS PARENT ARRAY — the
 * revive is bottom-up, so an inner section is already spliced when
 * the outer array is visited; `documentTitle` retypes to a level-0
 * `heading`; `discreteHeading`'s old `heading` key reads as `title`.
 * ONE canonical key order — `type, level, title, position` — is
 * emitted for BOTH tree shapes, because parity digests the JSON
 * STRING (pinned by the string-equality rows in
 * tests/scripts/parity-ledger.test.ts). AST-only by covenant: the
 * formatted comparison runs with ZERO allowances through the flatten.
 * @param key - the reviver key
 * @param value - the revived value
 * @returns the folded value
 */
export function foldSectionAndHeadingShapes(
  key: string,
  value: unknown,
): unknown {
  if (isUnknownArray(value)) {
    // Written as one flatMap rather than a push loop so the splice
    // arm's branching sits in the callback, where the complexity
    // ceiling counts it separately — the body must stay ONE function
    // for `.toString()`, so an extracted helper is not available.
    return value.flatMap((child) => {
      if (!isRecordLike(child) || child.type !== "section") {
        return [child];
      }
      const { level, heading, position, children } = child;
      const node = { type: "heading", level, title: heading, position };
      return isUnknownArray(children) ? [node, ...children] : [node];
    });
  }
  if (!isRecordLike(value)) {
    return value;
  }
  if (value.type === "documentTitle") {
    const { title, position } = value;
    return { type: "heading", level: 0, title, position };
  }
  if (value.type === "heading") {
    const { level, title, position } = value;
    return { type: "heading", level, title, position };
  }
  if (value.type === "discreteHeading") {
    const { level, heading, title, position } = value;
    return {
      type: "discreteHeading",
      level,
      title: title ?? heading,
      position,
    };
  }
  return value;
}

/**
 * Fold the marker and reftext shape changes, both arms in place: the
 * verbatim
 * reftext capture is invisible to corpus AST comparison — both sides
 * fold `reftext` to its trimStart() on inlineAnchor and blockAnchor
 * nodes — and a marker-bearing list folds back to the old shape,
 * dropping `marker` and re-deriving each item's `depth` from it. ONE
 * canonical key order per arm, because parity digests the JSON STRING
 * (pinned by the string-equality rows in
 * tests/scripts/parity-ledger.test.ts). Tolerates BOTH tree shapes —
 * the dumper embeds this body into the baseline checkout too.
 * @param key - the reviver key
 * @param value - the revived value
 * @returns the folded value
 */
export function foldMarkerAndReftextShapes(
  key: string,
  value: unknown,
): unknown {
  if (!isRecordLike(value)) {
    return value;
  }
  if (value.type === "inlineAnchor" || value.type === "blockAnchor") {
    const { type, id, reftext, position } = value;
    return {
      type,
      id,
      reftext: typeof reftext === "string" ? reftext.trimStart() : reftext,
      position,
    };
  }
  if (value.type === "list" && typeof value.marker === "string") {
    // Fold BOTH sides to the OLD shape: drop `marker`, re-derive each
    // item's `depth` from it (`-` and the callout sentinel are depth
    // 1; a run's length is its depth). Items are already canonical
    // here — the reviver is bottom-up, so normalizeOneItem rewrote
    // each item before its list is visited — and the re-spelled
    // literal repeats that key order exactly.
    const OUTERMOST = 1;
    const { type, variant, marker, children, position } = value;
    const depth = marker === "-" || marker === "<>" ? OUTERMOST : marker.length;
    const items = (isUnknownArray(children) ? children : []).map((item) =>
      isRecordLike(item)
        ? {
            type: item.type,
            depth,
            checkbox: item.checkbox,
            calloutNumber: item.calloutNumber,
            inline: item.inline,
            blocks: item.blocks,
            position: item.position,
          }
        : item,
    );
    return { type, variant, children: items, position };
  }
  return value;
}

/**
 * Fold the attribute-entry unset shape change: `unset` was
 * `false | "prefix" | "suffix"` — which `!` spelling the author used —
 * and is now the boolean fact both spellings mean. BOTH sides fold to
 * the boolean, so the retirement of the spelling is invisible to AST
 * comparison and the BYTES stay policed by the formatted comparison
 * (the `attribute-entry-spelling` ledger family).
 *
 * ONE canonical key order — `type, name, value, unset, position`, the
 * builder's literal — because parity digests the JSON STRING; a
 * `value` of undefined drops the key on both sides, as it always did.
 * Tolerates both tree shapes: the dumper embeds this body into the
 * baseline checkout too.
 * @param key - the reviver key
 * @param value - the revived value
 * @returns the folded value
 */
export function foldAttributeEntryUnset(key: string, value: unknown): unknown {
  if (!isRecordLike(value) || value.type !== "attributeEntry") {
    return value;
  }
  const { type, name, unset, position } = value;
  return { type, name, value: value.value, unset: unset !== false, position };
}
