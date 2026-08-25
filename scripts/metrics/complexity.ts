/**
 * Cyclomatic and cognitive complexity, both from one eslint run.
 *
 * Cyclomatic (eslint's own `complexity` rule) counts decision points;
 * it is blind to nesting, so a flat dispatch table scores as badly as
 * three nested loops. Cognitive complexity (SonarSource) charges for
 * nesting and forgives `switch`, and is the metric with the best
 * evidence for tracking TIME TO UNDERSTAND. They are reported side by
 * side because they disagree in informative ways — see
 * `docs/harnesses.md`.
 *
 * Both rules run at threshold 0 so that every function reports its
 * value instead of only the ones over a limit, and both run from a
 * generated config rather than the repository's own: base and head
 * must be measured with identical rules and ignores, and the base
 * copy has no `node_modules` of its own.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { isArray, isObject, parseJson, stdoutOf } from "./json.js";
import {
  CHILD_MAX_BUFFER,
  layersFor,
  ONE,
  perLayer,
  REPO_ROOT,
  ZERO,
  type ComplexityTotals,
  type Layer,
  type Offender,
} from "./model.js";

// eslint's `complexity` and SonarSource's cognitive complexity are
// different scales, so their tails are different numbers: 10 is the
// conventional cyclomatic limit, 15 is SonarSource's default.
const CYCLOMATIC_TAIL = 10;
const COGNITIVE_TAIL = 15;

/** eslint's `complexity` message carries the value in prose. */
export const CYCLOMATIC_VALUE = /complexity of (?<value>\d+)/v;

/** SonarSource's message likewise. */
export const COGNITIVE_VALUE = /Complexity from (?<value>\d+)/v;

// eslint names the function in the message: "Function 'itemContent'
// has a complexity of 11." Arrow functions and methods are spelled
// differently, hence the loose quote match.
const NAMED = /'(?<name>[^']+)'/v;

/** One eslint message, narrowed to the fields this script reads. */
interface EslintMessage {
  /** Rule that produced it; other rules' messages are ignored. */
  ruleId: string;
  /** Human text, out of which the metric value is parsed. */
  message: string;
  /** Line the reported function starts on, for naming offenders. */
  line: number;
}

/** One file's eslint result. */
export interface EslintFileResult {
  /** Absolute path of the linted file. */
  filePath: string;
  /** Messages for that file. */
  messages: EslintMessage[];
}

/** Both complexity metrics, aggregated per layer. */
export interface ComplexityMeasurement {
  /** eslint `complexity` per layer. */
  cyclomatic: Record<Layer, ComplexityTotals>;
  /** `sonarjs/cognitive-complexity` per layer. */
  cognitive: Record<Layer, ComplexityTotals>;
  /**
   * Every function over the cyclomatic tail, by name and place.
   *
   * That count is report-only, which is only defensible if
   * the report says WHICH functions — a flat dispatch over a
   * discriminated union and a genuinely branchy function score the
   * same here, and only a human can tell them apart.
   */
  cyclomaticOver: Offender[];
}

/**
 * Write the metrics-only eslint config to a file.
 *
 * The plugins are imported by ABSOLUTE path into this checkout's
 * `node_modules`, which is what lets the same config lint a base
 * revision materialized without installing anything.
 * @param directory - directory to write the config into
 * @returns absolute path of the written config
 */
export function writeEslintConfig(directory: string): string {
  const parser = path.join(
    REPO_ROOT,
    "node_modules/typescript-eslint/dist/index.js",
  );
  const sonar = path.join(
    REPO_ROOT,
    "node_modules/eslint-plugin-sonarjs/cjs/plugin.js",
  );
  const file = path.join(directory, "metrics.eslint.config.mjs");
  writeFileSync(
    file,
    [
      `import tseslint from ${JSON.stringify(parser)};`,
      `import sonarjs from ${JSON.stringify(sonar)};`,
      "export default [",
      '  { ignores: ["node_modules/**", "dist/**", "vendor/**"] },',
      "  {",
      '    files: ["**/*.ts"],',
      "    languageOptions: { parser: tseslint.parser },",
      "    plugins: { sonarjs },",
      "    rules: {",
      '      complexity: ["warn", 0],',
      '      "sonarjs/cognitive-complexity": ["warn", 0],',
      "    },",
      "  },",
      "];",
      "",
    ].join("\n"),
  );
  return file;
}

/**
 * Turn eslint's JSON report into the two fields this module reads,
 * by narrowing rather than by asserting.
 * @param output - eslint's stdout
 * @returns one entry per file, empty when the output was not a report
 */
export function parseReport(output: string): EslintFileResult[] {
  const parsed = parseJson(output);
  if (!isArray(parsed)) return [];
  const results: EslintFileResult[] = [];
  for (const entry of parsed) {
    if (!isObject(entry)) continue;
    const { filePath, messages } = entry;
    if (typeof filePath !== "string" || !isArray(messages)) continue;
    results.push({ filePath, messages: parseMessages(messages) });
  }
  return results;
}

/**
 * Narrow one file's message list.
 * @param messages - the raw `messages` array from the report
 * @returns the messages that carry a rule id and text
 */
function parseMessages(messages: unknown[]): EslintMessage[] {
  const parsed: EslintMessage[] = [];
  for (const raw of messages) {
    if (!isObject(raw)) continue;
    const { ruleId, message, line } = raw;
    if (typeof ruleId === "string" && typeof message === "string") {
      parsed.push({
        ruleId,
        message,
        line: typeof line === "number" ? line : ZERO,
      });
    }
  }
  return parsed;
}

/**
 * Run eslint over one checkout's `src` with the metrics config.
 * @param directory - checkout root to lint
 * @param configPath - absolute path of the metrics eslint config
 * @returns the parsed report
 */
function runEslint(directory: string, configPath: string): EslintFileResult[] {
  const binary = path.join(REPO_ROOT, "node_modules/.bin/eslint");
  const arguments_ = ["src", "--config", configPath, "--format", "json"];
  try {
    return parseReport(
      execFileSync(binary, arguments_, {
        cwd: directory,
        encoding: "utf8",
        maxBuffer: CHILD_MAX_BUFFER,
      }),
    );
  } catch (error) {
    const output = stdoutOf(error);
    if (output === undefined) throw error;
    return parseReport(output);
  }
}

/** Which rule to aggregate, and how to read its value. */
export interface Aggregation {
  /** The eslint report, already parsed. */
  report: EslintFileResult[];
  /** The measured checkout root, for relative paths. */
  root: string;
  /** The rule whose messages carry the metric. */
  ruleId: string;
  /** Captures the number out of the message text as `value`. */
  valuePattern: RegExp;
  /** Values above this count towards `over`. */
  tail: number;
}

/**
 * Aggregate one rule's per-function values by layer.
 * @param aggregation - the report, the rule, and how to read it
 * @returns the distribution per layer
 */
export function aggregate(
  aggregation: Aggregation,
): Record<Layer, ComplexityTotals> {
  const { report, root, ruleId, valuePattern, tail } = aggregation;
  const totals = perLayer<ComplexityTotals>(() => ({
    functions: ZERO,
    sum: ZERO,
    max: ZERO,
    over: ZERO,
  }));
  for (const file of report) {
    const relative = path.relative(root, file.filePath);
    for (const message of file.messages) {
      if (message.ruleId !== ruleId) continue;
      const captured = valuePattern.exec(message.message)?.groups?.value;
      if (captured === undefined) continue;
      const value = Number(captured);
      for (const layer of layersFor(relative)) {
        const { [layer]: totalsForLayer } = totals;
        totalsForLayer.functions += ONE;
        totalsForLayer.sum += value;
        totalsForLayer.max = Math.max(totalsForLayer.max, value);
        if (value > tail) totalsForLayer.over += ONE;
      }
    }
  }
  return totals;
}

/**
 * Measure both complexity metrics for one checkout.
 * @param directory - checkout root to measure
 * @param configPath - absolute path of the metrics eslint config
 * @returns cyclomatic and cognitive distributions per layer
 */
export function measureComplexity(
  directory: string,
  configPath: string,
): ComplexityMeasurement {
  const report = runEslint(directory, configPath);
  return {
    cyclomaticOver: offendersOver({
      report,
      root: directory,
      ruleId: "complexity",
      valuePattern: CYCLOMATIC_VALUE,
      tail: CYCLOMATIC_TAIL,
    }),
    cyclomatic: aggregate({
      report,
      root: directory,
      ruleId: "complexity",
      valuePattern: CYCLOMATIC_VALUE,
      tail: CYCLOMATIC_TAIL,
    }),
    cognitive: aggregate({
      report,
      root: directory,
      ruleId: "sonarjs/cognitive-complexity",
      valuePattern: COGNITIVE_VALUE,
      tail: COGNITIVE_TAIL,
    }),
  };
}

/**
 * One message read as an offender, when it names a value over the
 * tail for the rule being aggregated.
 * @param message - one eslint message
 * @param where - the message's file, relative to the measured root
 * @param aggregation - the rule, the pattern and the tail
 * @returns the offender, or undefined when the message is not one
 */
function offenderOf(
  message: EslintMessage,
  where: string,
  aggregation: Aggregation,
): Offender | undefined {
  if (message.ruleId !== aggregation.ruleId) return undefined;
  const captured = aggregation.valuePattern.exec(message.message)?.groups
    ?.value;
  if (captured === undefined) return undefined;
  const value = Number(captured);
  if (value <= aggregation.tail) return undefined;
  return {
    where: `${where}:${String(message.line)}`,
    what: NAMED.exec(message.message)?.groups?.name ?? "(anonymous)",
    value,
  };
}

/**
 * Every function whose value exceeds the tail, named and placed.
 * @param aggregation - the report, the rule, and how to read it
 * @returns the offenders, worst first
 */
function offendersOver(aggregation: Aggregation): Offender[] {
  const offenders: Offender[] = [];
  for (const file of aggregation.report) {
    const where = path.relative(aggregation.root, file.filePath);
    if (layersFor(where).length === ZERO) continue;
    for (const message of file.messages) {
      const offender = offenderOf(message, where, aggregation);
      if (offender !== undefined) offenders.push(offender);
    }
  }
  return offenders.toSorted((left, right) => right.value - left.value);
}

/**
 * The tail thresholds, for the table's row labels.
 * @returns the cyclomatic and cognitive thresholds
 */
export function tails(): { cyclomatic: number; cognitive: number } {
  return { cyclomatic: CYCLOMATIC_TAIL, cognitive: COGNITIVE_TAIL };
}
