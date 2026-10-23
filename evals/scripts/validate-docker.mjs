import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  collectLocalFiles,
  DockerSandboxManager,
  splitTestFiles,
  verifyNoTestFiles,
} from "@vercel/agent-eval";
import { makeExperiment } from "./experiment.mjs";
import {
  applySolution,
  evalRoot,
  json,
  overlay,
  sha256,
  writeJson,
} from "./files.mjs";

const { values } = parseArgs({
  options: {
    snapshot: { type: "string" },
    task: { type: "string", default: "api-method-policy" },
    condition: { type: "string", default: "baseline" },
  },
});
const snapshotDir = path.resolve(
  values.snapshot ??
    json(path.join(evalRoot, ".generated", "latest.json")).snapshotDir,
);
const manifest = json(path.join(snapshotDir, "manifest.json"));
const packageUrl = import.meta.resolve("@vercel/agent-eval/package.json");
if (json(fileURLToPath(packageUrl)).version !== "2.6.0")
  throw new Error(
    "Docker reference validation requires @vercel/agent-eval@2.6.0",
  );
// These helpers are not public exports. Keep the harness pinned and validate
// this integration before upgrading, just like experiment.setup's root hook.
const sharedUrl = new URL("./dist/lib/agents/shared.js", packageUrl);
const {
  createVitestConfig,
  EVAL_HELPER_PATH,
  initGitAndCommit,
  prepareNeutralWorkspace,
  runValidation,
} = await import(sharedUrl.href);
const experiment = makeExperiment({
  condition: values.condition,
  snapshotDir,
  taskFilter: values.task,
  runs: 1,
  // Only setup is used. No CLI is installed and no model is invoked.
  model: "docker-reference-validation-no-model",
  cliPackage: "@anthropic-ai/claude-code@0.0.0",
});
if (experiment.evals.length !== 1)
  throw new Error("Docker reference validation accepts exactly one task");
const taskId = experiment.evals[0];
const directory = path.join(snapshotDir, "validation", "cases", taskId);
const task = {
  ...json(path.join(directory, "task.json")),
  id: taskId,
  directory,
};
const fixture = path.join(snapshotDir, "evals", taskId);
const localGold = mkdtempSync(path.join(tmpdir(), "evjs-docker-gold-"));
const reportDir = path.join(
  evalRoot,
  "results",
  `docker-reference-${Date.now()}`,
);
mkdirSync(reportDir, { recursive: true });
let sandbox;
let phase = "fixture";
const report = {
  kind: "docker-reference-validation",
  note: "Reference solution through native Docker setup and Vitest; no model or model credentials used. Not an AI evaluation score.",
  task: taskId,
  condition: values.condition,
  snapshotHash: manifest.snapshotHash,
  harness: "@vercel/agent-eval@2.6.0",
  passed: false,
};
const progress = (next) => {
  phase = next;
  process.stdout.write(`Docker reference: ${phase}\n`);
};
const check = async (command, args) => {
  const result = await sandbox.runCommand(command, args);
  if (result.exitCode !== 0)
    throw new Error(
      `${command} failed (${result.exitCode})\n${result.stdout}${result.stderr}`,
    );
};
const started = Date.now();
try {
  const { workspaceFiles, testFiles } = splitTestFiles(
    await collectLocalFiles(fixture),
  );
  overlay(fixture, localGold);
  applySolution(task, localGold);
  const goldFiles = splitTestFiles(
    await collectLocalFiles(localGold),
  ).workspaceFiles;
  const initial = new Map(
    workspaceFiles.map((file) => [file.path, file.content]),
  );
  const final = new Map(goldFiles.map((file) => [file.path, file.content]));
  const changed = goldFiles.filter(
    (file) => !initial.get(file.path)?.equals(file.content),
  );
  const removed = [...initial.keys()].filter((name) => !final.has(name));

  progress("create-sandbox");
  sandbox = await DockerSandboxManager.create({
    timeout: 600_000,
    runtime: "node24",
  });
  report.sandboxId = sandbox.sandboxId;
  progress("native-setup");
  await sandbox.uploadFiles(workspaceFiles);
  await initGitAndCommit(sandbox);
  await experiment.setup(sandbox);
  const neutral = await prepareNeutralWorkspace(sandbox);
  await verifyNoTestFiles(sandbox);

  progress("reference-overlay");
  if (removed.length) await check("rm", ["-f", "--", ...removed]);
  await sandbox.uploadFiles(changed);
  // The native separate verifier repeats project installation after replaying
  // the patch. Exercise that same step, including any lockfile incompatibility.
  progress("native-project-install");
  await check("npm", ["install"]);
  if (
    sha256(await sandbox.readFile("package-lock.json")) !== manifest.lockSha256
  )
    throw new Error("Native npm install changed the frozen dependency lock");
  if (
    sha256(await sandbox.readFile("package.json")) !==
    manifest.packageJsonSha256
  )
    throw new Error("Native npm install changed the frozen package manifest");

  progress("native-validation");
  await sandbox.uploadFiles(testFiles);
  await createVitestConfig(sandbox);
  await sandbox.writeFiles({
    [EVAL_HELPER_PATH]: readFileSync(
      new URL("./eval-helper.mjs", sharedUrl),
      "utf8",
    ),
  });
  const validation = await runValidation(sandbox, [], "vitest", neutral.env);
  writeFileSync(
    path.join(reportDir, "eval.txt"),
    validation.test?.output ?? "",
  );
  report.passed = validation.allPassed;
  report.validation = validation;
  if (!report.passed)
    process.stderr.write(validation.test?.output ?? "Validation failed\n");
} catch (error) {
  report.error = error.stack ?? String(error);
  process.stderr.write(`${report.error}\n`);
} finally {
  await sandbox?.stop();
  rmSync(localGold, { recursive: true, force: true });
  report.phase = phase;
  report.durationMs = Date.now() - started;
  writeJson(path.join(reportDir, "report.json"), report);
  process.stdout.write(`Report: ${path.join(reportDir, "report.json")}\n`);
}
process.exitCode = report.passed ? 0 : 1;
