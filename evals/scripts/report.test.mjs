import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { classifyRun, readResultTree, summarizeRuns } from "./report.mjs";

function run(runIndex, status, overrides = {}) {
  return {
    task: "routing",
    condition: "docs",
    model: "model-a",
    agent: "claude-code",
    cliPackage: "@anthropic-ai/claude-code@1.2.3",
    snapshotHash: "snapshot-a",
    batchId: "batch-a",
    runIndex,
    expectedRuns: 3,
    result: {
      status,
      duration: 10,
      verifier: "separate",
      outputPaths: { eval: "./outputs/eval.txt" },
      usage: { totalTokens: 100, costUsd: 1 },
    },
    ...overrides,
  };
}

test("reports repeated, first, and any-of-N success separately and includes failed-run costs", () => {
  const [group] = summarizeRuns([
    run(0, "failed"),
    run(1, "passed"),
    run(2, "failed"),
  ]).groups;
  assert.equal(group.complete, true);
  assert.equal(group.repeatedRunSuccessRate, 1 / 3);
  assert.equal(group.firstRunSuccessRate, 0);
  assert.equal(group.anyOfNSuccessRate, 1);
  assert.equal(group.usage.scored.costUsd.total, 3);
  assert.equal(group.usage.scored.totalTokens.total, 300);
  assert.equal(group.costUsdPerSuccess.scored, 3);
});

test("missing usage never becomes zero or a complete cost estimate", () => {
  const missing = run(1, "passed");
  delete missing.result.usage;
  const [group] = summarizeRuns([
    run(0, "failed"),
    missing,
    run(2, "failed"),
  ]).groups;
  assert.deepEqual(group.usage.scored.costUsd, {
    reportedRuns: 2,
    missingRuns: 1,
    complete: false,
    reportedSum: 2,
    total: null,
  });
  assert.equal(group.costUsdPerSuccess.scored, null);
  assert.equal(group.usage.scored.reasoningTokens.total, null);
  assert.equal(group.usage.scored.reasoningTokens.reportedSum, null);
});

test("infra is excluded from scoring but retained in recorded cost and completeness", () => {
  const infra = run(0, "failed", { classification: { failureType: "infra" } });
  const [group] = summarizeRuns([
    infra,
    run(1, "passed"),
    run(2, "failed"),
  ]).groups;
  assert.equal(group.infrastructureFailures, 1);
  assert.equal(group.scoredRuns, 2);
  assert.equal(group.repeatedRunSuccessRate, 1 / 2);
  assert.equal(group.firstRunSuccessRate, null);
  assert.equal(group.firstRunDenominator, 0);
  assert.equal(group.anyOfNSuccessRate, null);
  assert.equal(group.complete, false);
  assert.equal(group.usage.allRecorded.costUsd.total, 3);
  assert.equal(group.usage.scored.costUsd.total, 2);
});

test("incomplete runs cannot claim an any-of-N score even with an observed pass", () => {
  const [group] = summarizeRuns([run(0, "passed"), run(2, "failed")]).groups;
  assert.equal(group.plannedRuns, 3);
  assert.equal(group.missingRuns, 1);
  assert.equal(group.complete, false);
  assert.equal(group.anyOfNSuccessRate, null);
  assert.equal(group.batches[0].observedAnySuccess, true);
  assert.deepEqual(group.batches[0].missingRunIndices, [1]);
});

test("timeouts are budget failures, while unrecognized CLI failures require classification", () => {
  const timeout = run(1, "failed", {
    result: {
      status: "failed",
      duration: 1200,
      error: "Eval timed out after 1200s",
    },
  });
  const unknown = run(2, "failed", {
    result: { status: "failed", duration: 7, error: "CLI exited with code 1" },
  });
  const [group] = summarizeRuns([run(0, "passed"), timeout, unknown]).groups;
  assert.equal(group.timeouts, 1);
  assert.equal(group.unclassifiedFailures, 1);
  assert.equal(group.repeatedRunSuccessRate, 1 / 2);
  assert.equal(group.complete, false);
  assert.equal(
    classifyRun({
      result: { status: "failed", error: "EVJS_EVAL_INFRA_SETUP: npm failed" },
    }),
    "infra",
  );
  assert.equal(
    classifyRun({ result: { status: "passed", tampering: ["package.json"] } }),
    "model",
  );
});

test("different conditions, snapshots, and CLI versions never merge", () => {
  const records = [
    run(0, "passed"),
    run(0, "passed", { condition: "baseline" }),
    run(0, "passed", { snapshotHash: "snapshot-b" }),
    run(0, "passed", { cliPackage: "@anthropic-ai/claude-code@1.2.4" }),
  ];
  assert.equal(summarizeRuns(records).groups.length, 4);
  assert.throws(
    () => summarizeRuns([run(0, "passed"), run(0, "failed")]),
    /Duplicate run/,
  );
});

test("smoke samples remain visible without entering evaluation success rates", () => {
  const report = summarizeRuns([
    run(0, "passed", { expectedRuns: 1 }),
    run(0, "passed", { expectedRuns: 1, smoke: true }),
  ]);
  assert.equal(report.groups.length, 2);
  const smoke = report.groups.find((group) => group.sampleKind === "smoke");
  assert.equal(smoke.smokeRuns, 1);
  assert.equal(smoke.scoredRuns, 0);
  assert.equal(smoke.repeatedRunSuccessRate, null);
  assert.equal(smoke.usage.allRecorded.costUsd.total, 1);
});

test("a run plan exposes entirely missing task batches", () => {
  const plan = [
    {
      id: "batch-a",
      tasks: ["routing", "middleware"],
      condition: "docs",
      model: "model-a",
      agent: "claude-code",
      cliPackage: "@anthropic-ai/claude-code@1.2.3",
      snapshotHash: "snapshot-a",
      expectedRuns: 3,
    },
  ];
  const report = summarizeRuns([run(0, "passed")], { plan });
  const missing = report.groups.find((group) => group.task === "middleware");
  assert.equal(missing.observedRuns, 0);
  assert.equal(missing.missingRuns, 3);
  assert.equal(missing.repeatedRunSuccessRate, null);
  assert.equal(missing.usage.allRecorded.costUsd.total, null);
});

test("verifier infrastructure markers in Vitest output are excluded from model failure rate", (context) => {
  const root = mkdtempSync(join(tmpdir(), "evjs-report-browser-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const taskDir = join(root, "docs", "2026-10-23T00-00-00Z", "routing");
  const runDir = join(taskDir, "run-1");
  mkdirSync(join(runDir, "outputs"), { recursive: true });
  writeFileSync(
    join(runDir, "result.json"),
    JSON.stringify({
      ...run(0, "failed").result,
      metadata: {
        evjsEval: {
          task: "routing",
          condition: "docs",
          runIndex: 0,
          expectedRuns: 1,
        },
      },
    }),
  );
  writeFileSync(
    join(runDir, "outputs", "eval.txt"),
    [
      "FAIL EVAL.ts > evjs: routing",
      `\u001b[31mError: EVJS_EVAL_INFRA: ${JSON.stringify({ passed: false, failureType: "infrastructure", phase: "browser", error: "Executable does not exist; run playwright install" })}\u001b[0m`,
      " at EVAL.ts:123:11",
    ].join("\n"),
  );
  const [group] = summarizeRuns(readResultTree(root)).groups;
  assert.equal(group.infrastructureFailures, 1);
  assert.equal(group.modelFailures, 0);
  assert.equal(group.scoredRuns, 0);
  assert.equal(group.repeatedRunSuccessRate, null);
  assert.equal(group.complete, false);
  assert.equal(group.usage.allRecorded.costUsd.total, 1);

  const taskFailure = run(0, "failed", {
    outputContent: {
      eval: 'Error: EVJS_EVAL_INFRA: {"failureType":"task","phase":"assertion"}',
    },
  });
  assert.equal(classifyRun(taskFailure), "model");
  assert.equal(
    classifyRun(
      run(0, "failed", {
        outputContent: {
          eval: "throw new Error('EVJS_EVAL_INFRA: ' + JSON.stringify(result))",
        },
      }),
    ),
    "model",
  );
});

test("reads native result trees without copying task-level classifications to mixed runs", (context) => {
  const root = mkdtempSync(join(tmpdir(), "evjs-report-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const taskDir = join(root, "docs", "2026-10-23T00-00-00Z", "routing");
  function write(path, value) {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, JSON.stringify(value));
  }
  write(join(taskDir, "summary.json"), { totalRuns: 2 });
  write(join(taskDir, "classification.json"), { failureType: "infra" });
  for (let index = 0; index < 2; index += 1) {
    write(join(taskDir, `run-${index + 1}`, "result.json"), {
      ...run(index, "failed").result,
      model: "model-a",
      metadata: {
        evjsEval: {
          task: "routing",
          condition: "docs",
          runIndex: index,
          expectedRuns: 3,
        },
      },
    });
  }
  write(join(taskDir, "run-1", "project", "run-99", "result.json"), {
    status: "passed",
  });
  write(join(taskDir, "run-2", "classification.json"), {
    failureType: "infra",
  });
  const records = readResultTree(root);
  assert.equal(records.length, 2);
  assert.equal(records[0].validationOutputMissing, true);
  assert.equal(records[0].classification, null);
  assert.equal(records[1].classification.failureType, "infra");
  const [group] = summarizeRuns(records).groups;
  assert.equal(group.modelFailures, 0);
  assert.equal(group.unclassifiedFailures, 1);
  assert.equal(group.infrastructureFailures, 1);
  assert.equal(group.missingRuns, 1);
});
