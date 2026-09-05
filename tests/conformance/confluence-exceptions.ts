/**
 * The declared exceptions to confluence: render-equal spelling pairs
 * the formatter is knowingly allowed to keep apart, and the pairs the
 * oracle does not hold render-equal at all.
 *
 * APPEND-REVIEWED. A row may be added only with a cited reason - an
 * issue number, or the source site and the policy case it falls under
 * (docs/architecture.md, "Formatting policy": bytes that are content,
 * or a structure-bearing spelling with no proven respelling). "The
 * gate went red" is not a reason. Deleting a row needs no argument
 * beyond a green run: the counts are exact in both directions, so a
 * fix that removes a divergence turns the gate red until its row
 * goes, and the tables shrink instead of rotting.
 *
 * The counts are pairs, not documents: one row's key is one spelling
 * difference, and its count is how many of the reader states that
 * pair was placed in came out apart. A count that MOVES is as red as
 * an undeclared key, because a divergence spreading to more states is
 * a regression that a set-membership check would miss.
 *
 * The digest is why a count is not the whole pin. Every key here
 * covers many independently varying placements - one per marker
 * style, per description delimiter, per line position - and the
 * mechanisms run through exactly those per-style branches, so a
 * change that fixes one placement and regresses a sibling inside the
 * same key would keep the total and pass. `sha256` is over the whole
 * sorted list of divergent pair ids under the key, the third fact
 * registry-sweep-clusters.ts records for the deep sweep's clusters
 * and for the same reason: a pair that appears, vanishes, or moves
 * between keys changes a hash, so a row cannot absorb a new
 * divergence by luck. Recompute it from a green run; the gate prints
 * the ids behind any digest that moved.
 */

/**
 * Why a declared pair is allowed to stay apart. One member per
 * distinct cause, so the report can count by mechanism and a fix can
 * be aimed at a mechanism rather than at a list of ids.
 */
export type Mechanism =
  | "listMarkerSpelling"
  | "tildeOpenDelimiter"
  | "passthroughContent"
  | "descriptionItemHeldBreak"
  | "listContinuationJoin"
  | "inlineMacroReplay";

/** The cited reason each mechanism stands on. */
export const MECHANISM_REASONS: Readonly<Record<Mechanism, string>> = {
  // docs/architecture.md, formatting policy case 2. `ListNode.marker`
  // holds what the classifier parsed because sibling matching is by
  // style and the ordered dot count selects the numbering, so a naive
  // respell changes nesting; issue #42 is the scar. Every marker
  // spelling here is a normalization candidate, not a settled policy.
  listMarkerSpelling:
    "a list marker's spelling is structure-bearing and no uniform respelling is proven yet (issue #42)",
  // `~~~~` opens the same content model as `--` but the printer's
  // open-block delimiter is exactly two dashes
  // (OPEN_BLOCK_DELIMITER_LENGTH, src/print/blocks.ts), so a tilde
  // open has no canonical spelling to normalize onto and its source
  // delimiter is replayed. The spelling is absent from the vendored
  // Ruby entirely (issue #64).
  tildeOpenDelimiter:
    "a tilde-spelled open block has no canonical delimiter to normalize onto and replays its source (issue #64)",
  // docs/architecture.md, formatting policy case 1: the bytes inside
  // an inline passthrough are content. `renderedHtml` (tests/helpers.ts)
  // folds a line break outside <pre>, and its own KNOWN COST note
  // says a passthrough renders as bare text with no element to
  // shelter it - so the two spellings are equal to this lens while
  // the oracle's own bytes differ. Collapsing the break would edit
  // the document.
  passthroughContent:
    "a line break inside an inline passthrough is content; renderedHtml folds it but the oracle's bytes keep it",
  // Same shape one level down: a bare URL and `link:` around the same
  // address are one anchor, and the inline node replays the authored
  // spelling.
  inlineMacroReplay:
    "a bare URL and its link macro are one anchor, and the authored spelling is replayed",
  // Issue #192: a description item's text holds a break so the line
  // Ruby re-reads stays a text line (keepTextOnFirstRestLine,
  // src/print/reflow.ts, driven by hazard, src/print/list-hazard.ts).
  // The guard fires only where the SOURCE split the text, so the
  // joined spelling never asks the question and the output is a
  // function of where the author broke lines.
  descriptionItemHeldBreak:
    "a description item's held break fires only where the source split the text (issue #192)",
  // Issue #192, the same source-dependence from the other side: a
  // paragraph attached to a list item keeps the author's break in
  // front of a run the block-start hazard net refuses to strand
  // (keepBlockStartBreak, src/print/block-start-hazard.ts, reading
  // ParagraphNode.firstWordEndsItsLine), and the joined spelling has
  // no break to keep.
  listContinuationJoin:
    "an attached paragraph's block-start hazard trades a break the source wrote (issue #192)",
};

/** One declared exception: its mechanism and which pairs it covers. */
export interface DeclaredDivergence {
  /** Why the pair stays apart; the reason is on the mechanism. */
  readonly mechanism: Mechanism;
  /** Exactly how many placements of this pair diverge. */
  readonly pairs: number;
  /** Hex sha256 of the sorted divergent pair ids under this key. */
  readonly sha256: string;
}

/**
 * Every render-equal pair the formatter keeps apart today, keyed by
 * the pair id without its placement.
 *
 * The join rows are the first harvest of the axis issue #192 names:
 * render-equal spellings that differ only in where the author broke a
 * line. They are the measurement that issue's entry gate asked for,
 * not a licence - each is a normalization the formatter does not yet
 * make.
 */
export const CONFLUENCE_EXCEPTIONS: Readonly<
  Record<string, DeclaredDivergence>
> = {
  "markerSpelling/ulist-star-dash": {
    mechanism: "listMarkerSpelling",
    pairs: 1,
    sha256: "03dd2552257e2af9806062a77455c3d1cbc7009ec62fca5b73566b72e55f5503",
  },
  "markerSpelling/ulist-star-bullet": {
    mechanism: "listMarkerSpelling",
    pairs: 1,
    sha256: "b8b5229f6253dde599af8eef6134b0dd7338d33eafaf62ee512caee5e6e06aff",
  },
  "markerSpelling/ulist-nested-star-dash": {
    mechanism: "listMarkerSpelling",
    pairs: 1,
    sha256: "ddffd1c742c24fc86b6fa892574e0f60350a534968b8bd57b0e5630003cea792",
  },
  "markerSpelling/olist-dot-arabic": {
    mechanism: "listMarkerSpelling",
    pairs: 1,
    sha256: "1deca21464602b477152b7b3af2e470769c0d6a8e83534dd16d7628f431e5294",
  },
  "markerSpelling/olist-nested-dot-arabic": {
    mechanism: "listMarkerSpelling",
    pairs: 1,
    sha256: "14d9134f0949f161b9ac3be465c5b0e273fd3c02b31d33ee560445e4e21b952b",
  },
  "markerSpelling/callout-explicit-auto": {
    mechanism: "listMarkerSpelling",
    pairs: 23,
    sha256: "52ea7fcb2a5a4682f8027662ee9e771a0bc6cecadb0525e4f4554d6135f20213",
  },
  "inlineSpelling/url-macro": {
    mechanism: "inlineMacroReplay",
    pairs: 23,
    sha256: "93f4764b4c302c750f404f0bae7b7337d0171a4cbd3b84b093c8a6ec42a4d374",
  },
  "delimiterLength/openBlockTilde": {
    mechanism: "tildeOpenDelimiter",
    pairs: 23,
    sha256: "9fd26ccda99d10efca39a52e17384d1b465db367b9a8a5069b8ec7c0033b34aa",
  },
  // The break falls INSIDE `+++ pass +++`, so it diverges in every
  // reflowed state; the two rows are the two interior positions.
  "lineJoin/passthrough@2": {
    mechanism: "passthroughContent",
    pairs: 142,
    sha256: "fd334858800a849ff26cb99b323a993eda6bdbfe1366012a7516f2e50707eac4",
  },
  "lineJoin/passthrough@3": {
    mechanism: "passthroughContent",
    pairs: 142,
    sha256: "1c594fefb313717662c7bcf22da8292bb235a09b8d54e0c3e538086a522a2ddf",
  },
  // Sixteen each: the eight description-item states and the eight
  // textless-term ones, which are the only states where the held
  // break fires.
  "lineJoin/passthrough@1": {
    mechanism: "descriptionItemHeldBreak",
    pairs: 16,
    sha256: "6b94bd9cb1d2bc03e0fc92fc4a5165a3895b66cbe170f93c944a4b5fb2cee9f9",
  },
  "lineJoin/passthrough@4": {
    mechanism: "descriptionItemHeldBreak",
    pairs: 16,
    sha256: "8d953bc089bd17e359ec3631a21e2f035c91d199f78911a3d5d121fd64e4f606",
  },
  "lineJoin/anchor@1": {
    mechanism: "descriptionItemHeldBreak",
    pairs: 16,
    sha256: "eeed23719f693b7605771c6523a1d2390ec96d2539c11d14223b02cf651b2083",
  },
  "lineJoin/anchor@2": {
    mechanism: "descriptionItemHeldBreak",
    pairs: 16,
    sha256: "e2b97904550b78da0415162df6ef3b598061388b6a0a4b7904acc41457b00e12",
  },
  "lineJoin/anchor@3": {
    mechanism: "descriptionItemHeldBreak",
    pairs: 16,
    sha256: "fa2887ab3323fbeab3093a0103becbfa6be185afbabfd42b779806dd92ff9fb5",
  },
  "lineJoin/attribute-line@1": {
    mechanism: "descriptionItemHeldBreak",
    pairs: 16,
    sha256: "b05940ff7a1d1079bab6e3ec38c37dd28577c4be8c956a8434fa69116e1db2b3",
  },
  "lineJoin/attribute-line@2": {
    mechanism: "descriptionItemHeldBreak",
    pairs: 16,
    sha256: "3034033dd059e4b68f2ef31fa0b0b313c5876e87a56094263b3bdcc39b446743",
  },
  "lineJoin/attribute-line@3": {
    mechanism: "descriptionItemHeldBreak",
    pairs: 16,
    sha256: "f9005749fc99cb3049b3751463face8268b3ebafa62d0c842e7f1c9d0e19f3af",
  },
  "lineJoin/block-title@1": {
    mechanism: "descriptionItemHeldBreak",
    pairs: 16,
    sha256: "ef137c853599a22320958d99364e768f5a24152d64c9f78a15dea122b6c6b43a",
  },
  "lineJoin/block-title@2": {
    mechanism: "descriptionItemHeldBreak",
    pairs: 16,
    sha256: "78285836fb984ec54ee6dd6e6a6790c9de3d74c8314c79a49249bf105f28489b",
  },
  "lineJoin/block-title@3": {
    mechanism: "descriptionItemHeldBreak",
    pairs: 16,
    sha256: "ab34b5d6810435123a351d624657a9c9bcab8549b3e5b7a67c0100bbb689de68",
  },
  "lineJoin/listing-delimiter@1": {
    mechanism: "descriptionItemHeldBreak",
    pairs: 16,
    sha256: "eea8f2c181bb29d52508ab9a1a6f9684d4010f71be2ed5d32c21f0c3207b910b",
  },
  "lineJoin/listing-delimiter@2": {
    mechanism: "descriptionItemHeldBreak",
    pairs: 16,
    sha256: "7aae9b3105deac017e695f1912ec3153e637ad8a03c160927699bdb0237d1847",
  },
  "lineJoin/listing-delimiter@3": {
    mechanism: "descriptionItemHeldBreak",
    pairs: 16,
    sha256: "fa9578ac76a9eb1e0faa6c39bfb655a67cc70061af6e63abbf885796bffcf05c",
  },
  "lineJoin/open-delimiter@1": {
    mechanism: "descriptionItemHeldBreak",
    pairs: 16,
    sha256: "69d02c8c4ffd1df84c07b46e6241a369accddde65bba2037f9d745abbf109e08",
  },
  "lineJoin/open-delimiter@2": {
    mechanism: "descriptionItemHeldBreak",
    pairs: 16,
    sha256: "eba88c2afb5acfa2d76d9ff6d5765d9bea2df58c17c989cb9320f97433980990",
  },
  "lineJoin/open-delimiter@3": {
    mechanism: "descriptionItemHeldBreak",
    pairs: 16,
    sha256: "45247e1f8a1fff6969ae8f86a12ee7783f4ddf3f9d03d66a2acb8fa6454a69e0",
  },
  "lineJoin/open-delimiter@4": {
    mechanism: "descriptionItemHeldBreak",
    pairs: 16,
    sha256: "241129e81e72bf039741fbdf4f9524cf4cdbf9750ea69c1a863573cc9777a034",
  },
  "lineJoin/open-delimiter@5": {
    mechanism: "descriptionItemHeldBreak",
    pairs: 16,
    sha256: "9021636f5f0d70d92eadc6ced4e91aabbba6d64a3ba5f3ccc4da651f527a167e",
  },
  "lineJoin/open-delimiter@6": {
    mechanism: "descriptionItemHeldBreak",
    pairs: 16,
    sha256: "f25c1a5360cfddbecf8c0a54c1e3542ba657463840049362f6ed008c807d6f24",
  },
  "lineJoin/ordered-marker@1": {
    mechanism: "descriptionItemHeldBreak",
    pairs: 16,
    sha256: "ae2f45275399b4d714d447f7015456db8bed1c790cceef12e397e255de4b518b",
  },
  "lineJoin/ordered-marker@3": {
    mechanism: "descriptionItemHeldBreak",
    pairs: 16,
    sha256: "39bec213eb5edd1867a104e9caad16a91f2fe326ba230c6bf22a86014a62aaba",
  },
  "lineJoin/ordered-marker@4": {
    mechanism: "descriptionItemHeldBreak",
    pairs: 16,
    sha256: "80403c24391676f6279a1b0f97a5543ee262cfdaf3260d73966feae5035851c2",
  },
  "lineJoin/thematic-break@1": {
    mechanism: "descriptionItemHeldBreak",
    pairs: 16,
    sha256: "1a02253674219c63f0321072e074578c219cf4a80fb830a9ca7f0086f53b90d3",
  },
  "lineJoin/thematic-break@2": {
    mechanism: "descriptionItemHeldBreak",
    pairs: 16,
    sha256: "1b00a94d08e604720eadca02d18f3aa0e7d5115ca0850de0c8d855a959bb2710",
  },
  "lineJoin/thematic-break@3": {
    mechanism: "descriptionItemHeldBreak",
    pairs: 16,
    sha256: "6521d458540024eb25d5e616af8548d56393aba8eb2c1343e5923ddc59f6a60e",
  },
  // Forty-two: the twenty-two continuation states at each line
  // position, less the two the oracle puts outside the domain for
  // `ulist-marker@1` (see OUTSIDE_DOMAIN).
  "lineJoin/ordered-marker@2": {
    mechanism: "listContinuationJoin",
    pairs: 42,
    sha256: "80957ae0f4b74c4ceff58f3c7c640fe401fca1461e7545a61ad9ddec0a7e6791",
  },
  "lineJoin/ulist-marker@1": {
    mechanism: "listContinuationJoin",
    pairs: 42,
    sha256: "7a0091c9b78a63813251420987fec3156242dd902237ca24349c610e5d09400f",
  },
  "lineJoin/ulist-marker@2": {
    mechanism: "listContinuationJoin",
    pairs: 42,
    sha256: "ce4a192238e7e1f8766bd1fe1903a1eacac7d635dafb8736859872ab423d89ec",
  },
  "lineJoin/ulist-marker@3": {
    mechanism: "listContinuationJoin",
    pairs: 42,
    sha256: "fbb8dd9d356a159c848e649e5e68aaacc055aef9c7265e932310483f3c3bd4a0",
  },
  "lineJoin/ulist-marker@4": {
    mechanism: "listContinuationJoin",
    pairs: 42,
    sha256: "5ee9587dfce9e475adcae8f8d788d331dd75729d068e819adca642e69e2bdd58",
  },
};

/** A pair the oracle does not hold render-equal, and why. */
export interface OutsideDomain {
  /** Why the two spellings render differently. */
  readonly reason: string;
  /** Exactly how many placements of this pair render differently. */
  readonly pairs: number;
}

/**
 * Pairs the generator emits that the oracle does NOT hold
 * render-equal, so they carry no claim about the formatter.
 *
 * Three rows are join-axis seeds whose break puts a construct at the
 * head of a line, in the states where that construct INTERRUPTS the
 * open block: the break changes the reading rather than the layout,
 * so the two spellings are different documents and the formatter is
 * right to keep them apart. Which states those are is the
 * interruption question the registry answers
 * (tests/conformance/reader-context-grid.test.ts), and it is a
 * per-state fact, which is why the seed is generated everywhere and
 * excluded here rather than trimmed at the source.
 *
 * The fourth is the same fact one axis over: in ITEM-TEXT position a
 * bracket line and a label line are not two spellings of one
 * admonition at all, because only the bracket line opens a block
 * there. The row is why the reader refuses to respell one into the
 * other in that position (`admonitionLabelOpensABlock`,
 * src/parse/lines/open-style.ts), and the axis carries its own
 * render-preservation check beside it, because a pair outside this
 * property is exactly where a formatter can move a block and the
 * property say nothing.
 *
 * The counts are pinned for the same reason the divergence counts
 * are: a generator change that quietly moved pairs out of the claim
 * would otherwise look like progress.
 */
export const OUTSIDE_DOMAIN: Readonly<Record<string, OutsideDomain>> = {
  // Twenty-two: one per confinement style. The anchor and table-cell
  // members of the same axis are absent because they DO render alike
  // in item-text position and converge there.
  "itemTextForm/admonition-form": {
    reason:
      "in item-text position only the `[NOTE]` bracket line opens a block; a `NOTE: ` label is more of the item's text",
    pairs: 22,
  },
  "lineJoin/dlist-separator@1": {
    reason: "`term:: def here` at a line head opens a description item",
    pairs: 98,
  },
  "lineJoin/ordered-marker@2": {
    reason: "`1. item here` at a line head opens an ordered list",
    pairs: 98,
  },
  "lineJoin/ulist-marker@1": {
    reason: "`* not at start here` at a line head opens an unordered list",
    pairs: 98,
  },
};
