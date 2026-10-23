import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";

const USAGE_FIELDS = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "reasoningTokens",
  "totalTokens",
  "costUsd",
];
const SCORED = new Set(["passed", "model", "timeout"]);
const finiteCount = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const fraction = (numerator, denominator) =>
  denominator > 0 ? numerator / denominator : null;

function verifierInfrastructureFailure(output) {
  if (typeof output !== "string") return false;
  // agent-eval combines Vitest stdout + stderr in outputContent.eval and saves
  // it to result.outputPaths.eval. The marker is in the rendered Error message,
  // not necessarily result.error. Parse its JSON so source excerpts or ordinary
  // task failures mentioning the marker cannot be mistaken for infra failures.
  for (const line of stripVTControlCharacters(output).split(/\r?\n/)) {
    const match = /EVJS_EVAL_INFRA:\s*(\{.*\})\s*$/.exec(line);
    if (!match) continue;
    try {
      if (JSON.parse(match[1]).failureType === "infrastructure") return true;
    } catch {
      // Vitest may repeat the throw statement as a source excerpt.
    }
  }
  return false;
}

/** Classify conservatively: an arbitrary CLI crash is not evidence of bad model code. */
export function classifyRun(record) {
  const result = record.result;
  if (
    result.tampering?.length ||
    result.error?.startsWith("EVJS_EVAL_TAMPERING:")
  )
    return "model";
  if (result.status === "passed") return "passed";
  if (verifierInfrastructureFailure(record.outputContent?.eval)) return "infra";
  if (
    ["model", "infra", "timeout"].includes(record.classification?.failureType)
  ) {
    return record.classification.failureType;
  }
  const error = result.error ?? "";
  if (
    error.startsWith("EVJS_EVAL_INFRA") ||
    /^(npm install failed|Claude Code install failed|Failed to create sandbox)/.test(
      error,
    )
  )
    return "infra";
  if (/^Eval timed out after \d+s/.test(error)) return "timeout";
  if (record.validationOutputMissing) return "unknown";
  // In 2.6.0 the orchestrator reaches separate validation only after the CLI
  // exits successfully. Failed assertions have no run-level error string.
  if (!error && result.verifier === "separate" && result.outputPaths?.eval)
    return "model";
  return "unknown";
}

function aggregateUsage(records) {
  const metrics = {};
  for (const field of USAGE_FIELDS) {
    const values = records.map(({ result }) => result.usage?.[field]);
    const reported = values.filter(finiteCount);
    const complete = records.length > 0 && reported.length === records.length;
    metrics[field] = {
      reportedRuns: reported.length,
      missingRuns: records.length - reported.length,
      complete,
      reportedSum: reported.length
        ? reported.reduce((sum, value) => sum + value, 0)
        : null,
      total: complete ? reported.reduce((sum, value) => sum + value, 0) : null,
    };
  }
  return metrics;
}

function costPerSuccess(usage, successes) {
  return successes > 0 && usage.costUsd.total !== null
    ? usage.costUsd.total / successes
    : null;
}

function normalizeRecord(record, fallbackRuns) {
  const meta = record.result?.metadata?.evjsEval ?? {};
  const normalized = {
    ...record,
    task: record.task ?? meta.task,
    condition: record.condition ?? meta.condition ?? "unknown",
    model:
      record.model ??
      meta.model ??
      record.result?.requestedModel ??
      record.result?.model ??
      "unknown",
    agent: record.agent ?? meta.agent ?? "unknown",
    cliPackage: record.cliPackage ?? meta.cliPackage ?? "unknown",
    snapshotHash: record.snapshotHash ?? meta.snapshotHash ?? "unknown",
    expectedRuns: record.expectedRuns ?? meta.expectedRuns ?? fallbackRuns,
    runIndex: record.runIndex ?? meta.runIndex,
    batchId: record.batchId ?? "default",
    sampleKind: record.smoke ? "smoke" : "evaluation",
  };
  if (!normalized.task) throw new Error("Each run must identify its task");
  if (
    !Number.isSafeInteger(normalized.expectedRuns) ||
    normalized.expectedRuns < 1
  )
    throw new Error("expectedRuns must be a positive integer");
  if (
    !Number.isSafeInteger(normalized.runIndex) ||
    normalized.runIndex < 0 ||
    normalized.runIndex >= normalized.expectedRuns
  ) {
    throw new Error(
      `Invalid runIndex for ${normalized.task}: ${normalized.runIndex}`,
    );
  }
  if (!["passed", "failed"].includes(normalized.result?.status))
    throw new Error(`Invalid result status for ${normalized.task}`);
  normalized.outcome = record.smoke ? "smoke" : classifyRun(normalized);
  return normalized;
}

function cohortKey(record) {
  return JSON.stringify([
    record.task,
    record.condition,
    record.model,
    record.agent,
    record.cliPackage,
    record.snapshotHash,
    record.expectedRuns,
    record.sampleKind,
  ]);
}

/**
 * Summarize native result.json records. Optional plan entries enumerate fully
 * missing task batches: {id, tasks, condition, model, agent, cliPackage,
 * snapshotHash, expectedRuns}. IDs must equal the result timestamp-directory path.
 * Rates are fractions (0..1), never percentages. Unknown data stays null.
 */
export function summarizeRuns(records, { expectedRuns = 3, plan = [] } = {}) {
  const groups = new Map();
  function groupFor(record) {
    const key = cohortKey(record);
    if (!groups.has(key)) {
      groups.set(key, {
        task: record.task,
        condition: record.condition,
        model: record.model,
        agent: record.agent,
        cliPackage: record.cliPackage,
        snapshotHash: record.snapshotHash,
        expectedRuns: record.expectedRuns,
        sampleKind: record.sampleKind,
        batches: new Map(),
      });
    }
    return groups.get(key);
  }
  for (const raw of records) {
    const record = normalizeRecord(raw, expectedRuns);
    const group = groupFor(record);
    if (!group.batches.has(record.batchId))
      group.batches.set(record.batchId, new Map());
    const batch = group.batches.get(record.batchId);
    if (batch.has(record.runIndex))
      throw new Error(
        `Duplicate run ${record.runIndex} in ${record.batchId}/${record.task}`,
      );
    batch.set(record.runIndex, record);
  }
  for (const batchPlan of plan) {
    if (!batchPlan.id || !Array.isArray(batchPlan.tasks))
      throw new Error("Each planned batch requires id and tasks");
    for (const task of batchPlan.tasks) {
      const record = normalizeRecord(
        {
          ...batchPlan,
          task,
          batchId: batchPlan.id,
          runIndex: 0,
          result: { status: "failed" },
        },
        expectedRuns,
      );
      const group = groupFor(record);
      if (!group.batches.has(record.batchId))
        group.batches.set(record.batchId, new Map());
    }
  }
  const summaries = [...groups.values()]
    .map((group) => {
      const all = [...group.batches.values()].flatMap((batch) => [
        ...batch.values(),
      ]);
      const scored = all.filter((record) => SCORED.has(record.outcome));
      const passed = scored.filter(
        (record) => record.outcome === "passed",
      ).length;
      const batches = [...group.batches.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, batch]) => {
          const runs = [...batch.values()].sort(
            (a, b) => a.runIndex - b.runIndex,
          );
          const missingRunIndices = Array.from(
            { length: group.expectedRuns },
            (_, i) => i,
          ).filter((i) => !batch.has(i));
          const completeRecorded = missingRunIndices.length === 0;
          const completeScored =
            completeRecorded &&
            runs.every((record) => SCORED.has(record.outcome));
          const first = batch.get(0);
          return {
            id,
            observedRuns: runs.length,
            missingRunIndices,
            completeRecorded,
            completeScored,
            firstRunSuccess:
              first && SCORED.has(first.outcome)
                ? first.outcome === "passed"
                : null,
            anyOfNSuccess: completeScored
              ? runs.some((record) => record.outcome === "passed")
              : null,
            observedAnySuccess: runs.some(
              (record) => record.outcome === "passed",
            ),
            outcomes: runs.map((record) => ({
              runIndex: record.runIndex,
              outcome: record.outcome,
              source: record.source ?? null,
            })),
          };
        });
      const firstScored = batches.filter(
        (batch) => batch.firstRunSuccess !== null,
      );
      const completeBatches = batches.filter((batch) => batch.completeScored);
      const allUsage = aggregateUsage(all);
      const scoredUsage = aggregateUsage(scored);
      const durations = all
        .map(({ result }) => result.duration)
        .filter(finiteCount);
      const { batches: _batches, ...identity } = group;
      return {
        ...identity,
        batchCount: batches.length,
        plannedRuns: batches.length * group.expectedRuns,
        observedRuns: all.length,
        missingRuns: batches.reduce(
          (sum, batch) => sum + batch.missingRunIndices.length,
          0,
        ),
        scoredRuns: scored.length,
        passedRuns: passed,
        modelFailures: all.filter((record) => record.outcome === "model")
          .length,
        timeouts: all.filter((record) => record.outcome === "timeout").length,
        infrastructureFailures: all.filter(
          (record) => record.outcome === "infra",
        ).length,
        unclassifiedFailures: all.filter(
          (record) => record.outcome === "unknown",
        ).length,
        smokeRuns: all.filter((record) => record.outcome === "smoke").length,
        complete: batches.every((batch) => batch.completeScored),
        repeatedRunSuccessRate: fraction(passed, scored.length),
        firstRunSuccessRate: fraction(
          firstScored.filter((batch) => batch.firstRunSuccess).length,
          firstScored.length,
        ),
        firstRunDenominator: firstScored.length,
        anyOfNSuccessRate: fraction(
          completeBatches.filter((batch) => batch.anyOfNSuccess).length,
          completeBatches.length,
        ),
        anyOfNDenominator: completeBatches.length,
        durationSeconds: {
          reportedRuns: durations.length,
          mean: durations.length
            ? durations.reduce((sum, value) => sum + value, 0) /
              durations.length
            : null,
        },
        usage: { allRecorded: allUsage, scored: scoredUsage },
        costUsdPerSuccess: {
          allRecorded: costPerSuccess(allUsage, passed),
          scored: costPerSuccess(scoredUsage, passed),
        },
        batches,
      };
    })
    .sort((a, b) => cohortKey(a).localeCompare(cohortKey(b)));
  return {
    schemaVersion: 1,
    methodology: {
      rates:
        "Fractions in [0,1]; null means unavailable. No cross-task averaging is implied.",
      repeatedRunSuccessRate:
        "Passed / (passed + model failures + timeouts); infra and unknown excluded and completeness flagged.",
      firstRunSuccessRate:
        "Only runIndex=0 in each batch; an infra failure is not replaced with a later run.",
      anyOfNSuccessRate:
        "Share of complete, scored N-run batches with at least one pass; not a per-run rate or unbiased pass@k estimator.",
      cost: "Includes failed attempts. AllRecorded also includes infra/unknown. Missing usage is null, never zero. Only saved attempts are observable.",
      timeout:
        "Counts as a fixed wall-budget failure; the harness budget includes setup and verification, so inspect timeouts separately.",
    },
    limitations: [
      "agent-eval may retry very fast failures before saving a run; those discarded attempts and their costs cannot be recovered here.",
      ...(plan.length
        ? []
        : [
            "Without a run plan, tasks with no saved results cannot be detected.",
          ]),
      "Task-level classification.json cannot identify mixed failure causes in a multi-run batch; only single-run task classifications are applied.",
      "Smoke runs are reported separately and excluded from success rates.",
    ],
    groups: summaries,
  };
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(`Cannot read JSON ${path}: ${error.message}`);
  }
}

function readEvalOutput(runDirectory, result) {
  if (!result.outputPaths?.eval) return undefined;
  const path = resolve(runDirectory, result.outputPaths.eval);
  if (!path.startsWith(`${resolve(runDirectory)}/`)) {
    throw new Error(
      `Evaluation output path escapes run directory: ${result.outputPaths.eval}`,
    );
  }
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

/** Read only harness run directories, never copied project/result.json files. */
export function readResultTree(resultsDir) {
  const records = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      if (!entry.isDirectory()) continue;
      const child = join(directory, entry.name);
      const match = /^run-([1-9]\d*)$/.exec(entry.name);
      if (match) {
        const result = readJson(join(child, "result.json"));
        if (!result) continue;
        const summary = readJson(join(directory, "summary.json"));
        const perRunClassification = readJson(
          join(child, "classification.json"),
        );
        const taskClassification = readJson(
          join(directory, "classification.json"),
        );
        const evalOutput = readEvalOutput(child, result);
        records.push({
          result,
          outputContent: { eval: evalOutput },
          validationOutputMissing:
            Boolean(result.outputPaths?.eval) && evalOutput === undefined,
          smoke: summary?.smoke === true,
          task: result.metadata?.evjsEval?.task ?? basename(directory),
          runIndex: result.metadata?.evjsEval?.runIndex ?? Number(match[1]) - 1,
          batchId: dirname(directory),
          source: join(child, "result.json"),
          classification:
            perRunClassification ??
            (summary?.totalRuns === 1 ? taskClassification : null),
          taskClassification,
        });
      } else if (!["project", "node_modules", ".git"].includes(entry.name)) {
        walk(child);
      }
    }
  }
  walk(resolve(resultsDir));
  return records;
}

function main() {
  const args = process.argv.slice(2);
  const resultsDir = args.shift();
  if (!resultsDir || resultsDir.startsWith("--"))
    throw new Error(
      "Usage: node report.mjs <resultsDir> [--out report.json] [--plan run-plan.json]",
    );
  let out;
  let plan = [];
  while (args.length) {
    const flag = args.shift();
    const value = args.shift();
    if (!value) throw new Error(`Missing value for ${flag}`);
    if (flag === "--out") out = resolve(value);
    else if (flag === "--plan") {
      const document = readJson(resolve(value));
      if (!document || !Array.isArray(document.batches))
        throw new Error("Run plan must have a batches array");
      plan = document.batches;
    } else throw new Error(`Unknown option ${flag}`);
  }
  const report = summarizeRuns(readResultTree(resultsDir), { plan });
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, serialized);
    process.stdout.write(
      `Wrote ${report.groups.length} task/model/condition groups to ${out}\n`,
    );
  } else process.stdout.write(serialized);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
