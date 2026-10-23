import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const CONDITIONS = ["baseline", "docs", "skill"];
export const TASKS = [
  "page-colocation",
  "nested-dynamic-page",
  "page-metadata",
  "api-method-policy",
  "fixed-api-root-migration",
  "server-function-mutation",
];
const shardId = (condition, task) => `model-${condition}-${task}`;

/** Combine only matching identities; missing jobs remain explicit missing data. */
export function aggregateBenchmark(shards, expected) {
  if (!/^[a-f0-9]{16}$/.test(expected.snapshotId ?? ""))
    throw new Error("Expected a frozen snapshot ID");
  if (typeof expected.model !== "string" || !expected.model.trim())
    throw new Error("Expected an explicit model ID");
  if (
    !/^@anthropic-ai\/claude-code@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(
      expected.cliPackage ?? "",
    )
  )
    throw new Error("Expected an exact Claude Code CLI package");
  if (
    !Number.isSafeInteger(expected.runs) ||
    expected.runs < 1 ||
    expected.runs > 3
  )
    throw new Error("Expected runs in 1..3");
  const roster = CONDITIONS.flatMap((condition) =>
    TASKS.map((task) => ({ condition, task, id: shardId(condition, task) })),
  );
  const known = new Set(roster.map(({ id }) => id));
  const errors = Object.keys(shards)
    .filter((id) => !known.has(id))
    .map((id) => `Unexpected shard: ${id}`);
  let snapshotHash = null;
  const groups = [];
  const entries = roster.map(({ condition, task, id }) => {
    const source = shards[id];
    const issues = [];
    const entry = {
      id,
      condition,
      task,
      status: "missing",
      completeRecorded: false,
      completeScored: false,
      observedRuns: null,
      issues,
    };
    if (!source) {
      issues.push("Entire job artifact is missing");
      return entry;
    }
    if (source.readErrors?.length) issues.push(...source.readErrors);
    if (!source.expected) issues.push("expected.json is missing");
    if (!source.report) issues.push("report.json is missing");
    if (issues.length) return { ...entry, status: "invalid" };
    const identity = {
      condition,
      task,
      model: expected.model,
      cliPackage: expected.cliPackage,
      runs: expected.runs,
    };
    const checkIdentity = (record, label) => {
      for (const [key, value] of Object.entries(identity)) {
        if (record?.[key] !== value)
          issues.push(`${label}.${key} does not match the requested campaign`);
      }
      const hash = record?.snapshotHash;
      if (
        !/^[a-f0-9]{64}$/.test(hash ?? "") ||
        !hash.startsWith(expected.snapshotId)
      )
        issues.push(`${label}.snapshotHash does not match the frozen snapshot`);
      else if (snapshotHash && hash !== snapshotHash)
        issues.push(`${label}.snapshotHash differs from another shard`);
    };
    checkIdentity(source.expected, "expected");
    checkIdentity(source.report.campaign, "report.campaign");
    if (source.expected.snapshotHash !== source.report.campaign?.snapshotHash)
      issues.push("Report and expected manifest have different snapshots");
    const shardGroups = source.report.groups;
    if (!Array.isArray(shardGroups))
      issues.push("Report groups must be an array");
    else {
      if (shardGroups.length > 1)
        issues.push(
          "A job must not combine multiple task/model/snapshot groups",
        );
      for (const group of shardGroups) {
        checkIdentity({ ...group, runs: group.expectedRuns }, "group");
        if (group.agent !== "claude-code" || group.sampleKind !== "evaluation")
          issues.push(
            "Group must contain Claude Code evaluations, not smoke runs",
          );
        if (group.snapshotHash !== source.expected.snapshotHash)
          issues.push("Group and expected manifest have different snapshots");
      }
    }
    if (issues.length) return { ...entry, status: "invalid" };
    snapshotHash ??= source.expected.snapshotHash;
    const campaign = source.report.campaign;
    const group = shardGroups[0];
    const completeRecorded =
      campaign.complete === true &&
      campaign.observedRuns === expected.runs &&
      Array.isArray(campaign.missingRunIndices) &&
      campaign.missingRunIndices.length === 0 &&
      group?.observedRuns === expected.runs &&
      group?.missingRuns === 0 &&
      group?.batchCount === 1;
    const completeScored =
      completeRecorded &&
      group.complete === true &&
      group.scoredRuns === expected.runs;
    // Keep usage and rates as reported; missing usage remains null, never zero.
    groups.push(...shardGroups);
    return {
      ...entry,
      status: completeScored ? "complete" : "incomplete",
      completeRecorded,
      completeScored,
      observedRuns: campaign.observedRuns ?? null,
    };
  });
  return {
    schemaVersion: 1,
    kind: "model-benchmark-campaign",
    expected: {
      ...expected,
      conditions: CONDITIONS,
      tasks: TASKS,
      plannedJobs: roster.length,
      plannedRuns: roster.length * expected.runs,
    },
    snapshotHash,
    completeRecorded:
      errors.length === 0 && entries.every((entry) => entry.completeRecorded),
    completeScored:
      errors.length === 0 && entries.every((entry) => entry.completeScored),
    missingShards: entries
      .filter((entry) => entry.status === "missing")
      .map((entry) => entry.id),
    invalidShards: entries
      .filter((entry) => entry.status === "invalid")
      .map((entry) => entry.id),
    errors,
    shards: entries,
    groups,
    note: "No cross-task averaging. Infrastructure, unknown, missing runs and missing jobs remain visible. Usage is preserved without imputing missing values.",
  };
}

const escapeCell = (value) =>
  String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
export function campaignSummary(report) {
  const diagnostics = [];
  const lines = [
    "## EVJS model benchmark",
    "",
    `Model: ${escapeCell(report.expected.model)}; CLI: ${escapeCell(report.expected.cliPackage)}; snapshot: ${report.expected.snapshotId}.`,
    `Jobs with all repetitions recorded: ${report.shards.filter((shard) => shard.completeRecorded).length}/${report.expected.plannedJobs}.`,
    `Jobs with all repetitions scored: ${report.shards.filter((shard) => shard.completeScored).length}/${report.expected.plannedJobs}.`,
    "Missing jobs and invalid identities are not counted as zero-success measurements. See campaign.json for diagnostics and usage.",
    "",
    "| Condition | Task | State | Passed / scored | Missing runs |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const shard of report.shards) {
    const group = report.groups.find(
      (item) => item.condition === shard.condition && item.task === shard.task,
    );
    const score = group
      ? `${group.passedRuns} / ${group.scoredRuns}`
      : "unavailable";
    lines.push(
      `| ${shard.condition} | ${shard.task} | ${shard.status} | ${score} | ${group?.missingRuns ?? "unknown"} |`,
    );
    if (shard.issues.length)
      diagnostics.push(
        `${shard.id}: ${shard.issues.map(escapeCell).join("; ")}`,
      );
  }
  if (diagnostics.length)
    lines.push("", ...diagnostics.map((issue) => `- ${issue}`));
  if (report.errors.length) lines.push("", ...report.errors.map(escapeCell));
  return `${lines.join("\n")}\n`;
}

function main() {
  const root = path.resolve(import.meta.dirname, "..");
  const directory = path.join(root, "artifacts/shards");
  const shards = {};
  if (existsSync(directory)) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const shard = { readErrors: [] };
      for (const [key, filename] of [
        ["expected", "expected.json"],
        ["report", "report.json"],
      ]) {
        try {
          // upload-artifact's common ancestor is the repository root.
          shard[key] = JSON.parse(
            readFileSync(
              path.join(directory, entry.name, "artifacts", filename),
              "utf8",
            ),
          );
        } catch (error) {
          shard.readErrors.push(
            `${filename}: ${error.code === "ENOENT" ? "missing" : "unreadable or invalid JSON"}`,
          );
        }
      }
      shards[entry.name] = shard;
    }
  }
  const report = aggregateBenchmark(shards, {
    model: process.env.EVJS_EVAL_MODEL,
    cliPackage: process.env.EVJS_EVAL_CLI_PACKAGE,
    runs: Number(process.env.EVJS_EVAL_RUNS),
    snapshotId: process.env.EVJS_EVAL_SNAPSHOT,
  });
  const artifacts = path.join(root, "artifacts");
  mkdirSync(artifacts, { recursive: true });
  const summary = campaignSummary(report);
  writeFileSync(
    path.join(artifacts, "campaign.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  writeFileSync(path.join(artifacts, "summary.md"), summary);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  process.stdout.write(summary);
  if (!report.completeScored) process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  main();
