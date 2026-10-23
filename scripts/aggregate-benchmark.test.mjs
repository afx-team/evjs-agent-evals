import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateBenchmark,
  CONDITIONS,
  TASKS,
} from "./aggregate-benchmark.mjs";

const snapshotHash = "a".repeat(64);
const expected = {
  model: "exact-test-model",
  cliPackage: "@anthropic-ai/claude-code@2.1.0",
  snapshotId: snapshotHash.slice(0, 16),
  runs: 3,
};
function completeShards() {
  return Object.fromEntries(
    CONDITIONS.flatMap((condition) =>
      TASKS.map((task) => {
        const identity = {
          condition,
          task,
          model: expected.model,
          cliPackage: expected.cliPackage,
          snapshotHash,
          runs: expected.runs,
        };
        return [
          `model-${condition}-${task}`,
          {
            expected: identity,
            report: {
              campaign: {
                ...identity,
                complete: true,
                observedRuns: 3,
                missingRunIndices: [],
              },
              groups: [
                {
                  ...identity,
                  agent: "claude-code",
                  sampleKind: "evaluation",
                  expectedRuns: 3,
                  observedRuns: 3,
                  scoredRuns: 3,
                  passedRuns: 2,
                  missingRuns: 0,
                  batchCount: 1,
                  complete: true,
                  usage: { allRecorded: { costUsd: { total: null } } },
                },
              ],
            },
          },
        ];
      }),
    ),
  );
}

test("all 18 shards form a campaign without inventing absent usage", () => {
  const report = aggregateBenchmark(completeShards(), expected);
  assert.equal(report.completeRecorded, true);
  assert.equal(report.completeScored, true);
  assert.equal(report.groups.length, 18);
  assert.equal(report.expected.plannedRuns, 54);
  assert.equal(report.groups[0].usage.allRecorded.costUsd.total, null);
});

test("an entirely missing matrix job is reported and never treated as a scored zero", () => {
  const shards = completeShards();
  const id = "model-docs-page-colocation";
  delete shards[id];
  const report = aggregateBenchmark(shards, expected);
  assert.equal(report.completeRecorded, false);
  assert.equal(report.completeScored, false);
  assert.deepEqual(report.missingShards, [id]);
  assert.equal(report.groups.length, 17);
  assert.equal(
    report.shards.find((shard) => shard.id === id).observedRuns,
    null,
  );
});

test("different model, CLI, or full snapshot identity is rejected rather than merged", () => {
  for (const [key, value] of [
    ["model", "different-model"],
    ["cliPackage", "@anthropic-ai/claude-code@2.1.1"],
    ["snapshotHash", `${snapshotHash.slice(0, 16)}${"b".repeat(48)}`],
  ]) {
    const shards = completeShards();
    const id = "model-skill-page-colocation";
    shards[id].report.groups[0][key] = value;
    const report = aggregateBenchmark(shards, expected);
    assert.equal(report.completeRecorded, false);
    assert.deepEqual(report.invalidShards, [id]);
    assert.equal(report.groups.length, 17);
  }
});

test("missing report files and infrastructure-only repetitions remain incomplete", () => {
  const shards = completeShards();
  delete shards["model-docs-page-colocation"].report;
  const infra = shards["model-skill-page-colocation"].report.groups[0];
  infra.complete = false;
  infra.scoredRuns = 0;
  infra.passedRuns = 0;
  infra.infrastructureFailures = 3;
  const report = aggregateBenchmark(shards, expected);
  assert.equal(report.completeScored, false);
  assert.deepEqual(report.invalidShards, ["model-docs-page-colocation"]);
  const retained = report.shards.find(
    (shard) => shard.id === "model-skill-page-colocation",
  );
  assert.equal(retained.completeRecorded, true);
  assert.equal(retained.completeScored, false);
});
