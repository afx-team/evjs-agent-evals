import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readResultTree, summarizeRuns } from "../evals/scripts/report.mjs";

const root = path.resolve(import.meta.dirname, "..");
const snapshotId = process.env.EVJS_EVAL_SNAPSHOT;
if (!/^[a-f0-9]{16}$/.test(snapshotId ?? ""))
  throw new Error("EVJS_EVAL_SNAPSHOT must be a snapshot ID");
const snapshot = path.join(root, "evals/.generated", snapshotId);
const manifest = JSON.parse(
  readFileSync(path.join(snapshot, "manifest.json"), "utf8"),
);
const condition = process.env.EVJS_EVAL_CONDITION;
const task = process.env.EVJS_EVAL_TASKS;
const runs = Number(process.env.EVJS_EVAL_RUNS ?? 3);
if (!["baseline", "docs", "skill"].includes(condition))
  throw new Error("Unknown condition");
if (!manifest.taskIds.includes(task))
  throw new Error("Choose exactly one task per job");
if (!Number.isSafeInteger(runs) || runs < 1 || runs > 3)
  throw new Error("runs must be 1..3 on GitHub-hosted runners");
if (!process.env.ANTHROPIC_API_KEY)
  throw new Error(
    "Configure the repository ANTHROPIC_API_KEY secret before running the model benchmark",
  );
const artifacts = path.join(root, "artifacts");
mkdirSync(artifacts, { recursive: true });
const expected = {
  condition,
  task,
  runs,
  model: process.env.EVJS_EVAL_MODEL,
  cliPackage: process.env.EVJS_EVAL_CLI_PACKAGE,
  snapshotHash: manifest.snapshotHash,
};
writeFileSync(
  path.join(artifacts, "expected.json"),
  JSON.stringify(expected, null, 2),
);
const result = spawnSync(
  path.join(root, "evals/node_modules/.bin/agent-eval"),
  ["run", condition, "--force", "--ack-failures"],
  { cwd: snapshot, env: process.env, stdio: "inherit" },
);
const resultDir = path.join(snapshot, "results");
const records = existsSync(resultDir) ? readResultTree(resultDir) : [];
const report = summarizeRuns(records, { expectedRuns: runs });
const selected = records.filter(
  (r) =>
    r.result.metadata?.evjsEval?.condition === condition && r.task === task,
);
const observed = new Set(selected.map((r) => r.runIndex));
const missing = Array.from({ length: runs }, (_, i) => i).filter(
  (i) => !observed.has(i),
);
report.campaign = {
  ...expected,
  missingRunIndices: missing,
  observedRuns: selected.length,
  complete: missing.length === 0 && selected.length === runs,
};
writeFileSync(
  path.join(artifacts, "report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
if (result.error) throw result.error;
if (!report.campaign.complete)
  throw new Error(
    `Incomplete campaign: ${selected.length}/${runs} records, missing ${missing.join(", ")}`,
  );
process.exitCode = result.status ?? 1;
