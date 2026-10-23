import { execFileSync } from "node:child_process";
import {
  constants,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { applySolution, evalRoot, json, overlay, writeJson } from "./files.mjs";

const { values } = parseArgs({
  options: {
    snapshot: { type: "string" },
    task: { type: "string" },
    variant: { type: "string" },
    "skip-install": { type: "boolean", default: false },
  },
});
const snapshotDir = path.resolve(
  values.snapshot ??
    json(path.join(evalRoot, ".generated", "latest.json")).snapshotDir,
);
const snapshot = json(path.join(snapshotDir, "manifest.json"));
const dependencyRoot = path.join(snapshotDir, "dependencies");
if (!values["skip-install"]) {
  execFileSync(
    "npx",
    ["--yes", "npm@11.6.2", "ci", "--no-audit", "--no-fund"],
    {
      cwd: dependencyRoot,
      stdio: "inherit",
    },
  );
  execFileSync("npx", ["--no-install", "playwright", "install", "chromium"], {
    cwd: dependencyRoot,
    stdio: "inherit",
  });
}
const selected = snapshot.taskIds
  .filter((id) => !values.task || id === values.task)
  .map((id) => {
    const directory = path.join(snapshotDir, "validation", "cases", id);
    return { ...json(path.join(directory, "task.json")), id, directory };
  });
if (!selected.length) throw new Error(`Unknown task: ${values.task}`);
const variants = values.variant ? [values.variant] : ["solution", "starter"];
if (variants.some((variant) => !["solution", "starter"].includes(variant)))
  throw new Error("variant must be solution or starter");
const results = [];
const runRoot = path.join(
  evalRoot,
  "results",
  `fixture-validation-${Date.now()}`,
);
// A nested app is still treated as part of the parent monorepo by Utoopack.
// Keep application roots outside it, just like the evaluation containers.
const appRoot = mkdtempSync(path.join(tmpdir(), "evjs-fixture-validation-"));
for (const task of selected) {
  for (const variant of variants) {
    const app = path.join(appRoot, task.id, variant);
    overlay(path.join(snapshotDir, "evals", task.id), app);
    rmSync(path.join(app, "EVAL.ts"));
    rmSync(path.join(app, "PROMPT.md"));
    if (variant === "solution") applySolution(task, app);
    writeFileSync(
      path.join(app, "package.json"),
      readFileSync(path.join(dependencyRoot, "package.json")),
    );
    writeFileSync(
      path.join(app, "package-lock.json"),
      readFileSync(path.join(app, "fixture-lock.json")),
    );
    // Utoopack bounds resolution to the application's filesystem root. An
    // external node_modules symlink both escapes it and can leak host packages.
    cpSync(
      path.join(dependencyRoot, "node_modules"),
      path.join(app, "node_modules"),
      {
        recursive: true,
        mode: constants.COPYFILE_FICLONE,
        verbatimSymlinks: true,
      },
    );
    const source = `${readFileSync(path.join(snapshotDir, "validation", "runtime", "verify.mjs"), "utf8")}\n${readFileSync(path.join(task.directory, "verify.mjs"), "utf8")}\nconst result = await runVerification(process.cwd(), verify, phase => process.stdout.write(phase+'\\n'));\nwriteFileSync('validation.json', JSON.stringify(result,null,2));\nprocess.exitCode=result.passed ? 0 : 1;\n`;
    writeFileSync(path.join(app, ".verify.mjs"), source);
    process.stdout.write(`\n${task.id} / ${variant}\n`);
    let processError;
    try {
      execFileSync(process.execPath, [".verify.mjs"], {
        cwd: app,
        stdio: "inherit",
        timeout: 360_000,
      });
    } catch (error) {
      processError = error.message;
    }
    let result;
    try {
      result = json(path.join(app, "validation.json"));
    } catch {
      result = {
        passed: false,
        phase: "infrastructure",
        error: processError ?? "Missing verification output",
      };
    }
    const expected =
      variant === "solution"
        ? result.passed
        : !result.passed &&
          result.failureType === "task" &&
          result.phase === (task.expectedStarterFailure?.phase ?? "behavior") &&
          (!task.expectedStarterFailure?.errorIncludes ||
            result.error.includes(task.expectedStarterFailure.errorIncludes));
    results.push({ task: task.id, variant, expected, ...result });
    process.stdout.write(
      `${expected ? "OK" : "UNEXPECTED"}: ${result.passed ? "pass" : `fail at ${result.phase}`}\n`,
    );
  }
}
const report = {
  kind: "fixture-validation",
  note: "Reference/starter checks; these are NOT model evaluation scores.",
  snapshotHash: snapshot.snapshotHash,
  appRoot,
  results,
};
mkdirSync(runRoot, { recursive: true });
writeJson(path.join(runRoot, "report.json"), report);
process.stdout.write(`\nReport: ${path.join(runRoot, "report.json")}\n`);
process.exitCode = results.every((result) => result.expected) ? 0 : 1;
