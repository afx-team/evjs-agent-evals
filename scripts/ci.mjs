import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => JSON.parse(readFileSync(path.join(root, file), "utf8"));
const run = (cmd, args, cwd = root, env = process.env) =>
  execFileSync(cmd, args, { cwd, env, stdio: "inherit" });
const action = process.argv[2];
const artifacts = path.join(root, "artifacts");
mkdirSync(artifacts, { recursive: true });
if (action === "pin") {
  const pin = read("framework.json");
  if (
    !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(pin.repository) ||
    !/^[a-f0-9]{40}$/.test(pin.commit)
  )
    throw new Error("framework.json requires a repository and full commit SHA");
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `repository=${pin.repository}\ncommit=${pin.commit}\n`,
    );
} else if (action === "prepare") {
  const pin = read("framework.json");
  const framework = path.join(root, "framework");
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: framework,
    encoding: "utf8",
  }).trim();
  if (commit !== pin.commit)
    throw new Error(
      `Framework checkout mismatch: expected ${pin.commit}, got ${commit}`,
    );
  run(process.execPath, [
    "evals/scripts/prepare.mjs",
    "--framework",
    framework,
  ]);
  const { snapshotDir } = read("evals/.generated/latest.json");
  const snapshotId = path.basename(snapshotDir);
  run("tar", [
    "-czf",
    path.join(artifacts, "snapshot.tar.gz"),
    "-C",
    path.dirname(snapshotDir),
    snapshotId,
  ]);
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `snapshot_id=${snapshotId}\n`);
  writeFileSync(
    path.join(artifacts, "snapshot.json"),
    readFileSync(path.join(snapshotDir, "manifest.json")),
  );
} else if (action === "dry") {
  const { snapshotDir } = read("evals/.generated/latest.json");
  for (const condition of ["baseline", "docs", "skill"]) {
    run(
      path.join(root, "evals/node_modules/.bin/agent-eval"),
      [condition, "--dry"],
      snapshotDir,
      {
        ...process.env,
        EVJS_EVAL_MODEL: "dry-run-placeholder",
        EVJS_EVAL_CLI_PACKAGE: "@anthropic-ai/claude-code@2.1.0",
        EVJS_EVAL_RUNS: "3",
      },
    );
  }
} else if (action === "summary") {
  const resultsRoot = path.join(root, "evals/results");
  const reports = existsSync(resultsRoot)
    ? readdirSync(resultsRoot)
        .filter((name) => name.startsWith("fixture-validation-"))
        .map((name) => path.join(resultsRoot, name, "report.json"))
        .filter(existsSync)
        .map((file) => JSON.parse(readFileSync(file, "utf8")))
    : [];
  const results = reports.flatMap((report) => report.results);
  const solutions = results.filter((r) => r.variant === "solution");
  const starters = results.filter((r) => r.variant === "starter");
  const lines = [
    "## EVJS fixture validation",
    "",
    `Reference solutions: ${solutions.filter((r) => r.passed).length}/${solutions.length} passed.`,
    `Negative controls: ${starters.filter((r) => r.expected).length}/${starters.length} failed as expected.`,
    "",
    "These are fixture checks, not model performance scores.",
    "",
    "| Task | Variant | Expected outcome | Phase |",
    "| --- | --- | --- | --- |",
    ...results.map(
      (r) =>
        `| ${r.task} | ${r.variant} | ${r.expected ? "PASS" : "FAIL"} | ${r.phase} |`,
    ),
  ];
  const dockerReports = existsSync(resultsRoot)
    ? readdirSync(resultsRoot)
        .filter((name) => name.startsWith("docker-reference-"))
        .map((name) => path.join(resultsRoot, name, "report.json"))
        .filter(existsSync)
        .map((file) => JSON.parse(readFileSync(file, "utf8")))
    : [];
  for (const report of dockerReports)
    lines.push(
      "",
      `Docker reference (${report.condition}/${report.task}): ${report.passed ? "PASS" : "FAIL"} at ${report.phase}.`,
    );
  writeFileSync(path.join(artifacts, "summary.md"), `${lines.join("\n")}\n`);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
} else throw new Error("Usage: node scripts/ci.mjs pin|prepare|dry|summary");
