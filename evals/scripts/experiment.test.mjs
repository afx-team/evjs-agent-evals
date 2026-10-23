import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { makeExperiment, selectTaskIds } from "./experiment.mjs";

const taskIds = ["api-method-policy", "page-colocation"];

test("task selection defaults to every frozen task and preserves requested order", () => {
  assert.deepEqual(selectTaskIds(undefined, taskIds), taskIds);
  assert.deepEqual(
    selectTaskIds("page-colocation, api-method-policy", taskIds),
    ["page-colocation", "api-method-policy"],
  );
});

test("task selection rejects empty, wildcard, path, duplicate, and unknown inputs", () => {
  for (const input of [
    "",
    " ",
    "*",
    "../page-colocation",
    "page-colocation,",
    "page-colocation,,api-method-policy",
    "page-colocation,page-colocation",
    "unknown-task",
    "api-method-policy;echo",
    ["page-colocation"],
  ]) {
    assert.throws(() => selectTaskIds(input, taskIds), /EVJS_EVAL_TASKS/);
  }
  assert.throws(() => selectTaskIds(undefined, []), /snapshot/);
});

test("the validated task filter becomes the native agent-eval evals selection", (context) => {
  const root = mkdtempSync(join(tmpdir(), "evjs-experiment-filter-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (name, value) => {
    const target = join(root, name);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, value);
  };
  write("manifest.json", JSON.stringify({ taskIds }));
  write("dependencies/package.json", JSON.stringify({ name: "fixture" }));
  write("dependencies/package-lock.json", "{}");
  write("materials/docs/index.md", "# Public docs\n");
  write("materials/skill/SKILL.md", "# Core skill\n");
  const options = {
    condition: "baseline",
    snapshotDir: root,
    model: "test-model-not-called",
    cliPackage: "@anthropic-ai/claude-code@1.2.3",
  };
  assert.deepEqual(makeExperiment(options).evals, taskIds);
  assert.deepEqual(
    makeExperiment({ ...options, taskFilter: "page-colocation" }).evals,
    ["page-colocation"],
  );
  assert.throws(
    () => makeExperiment({ ...options, taskFilter: "missing-task" }),
    /Unknown EVJS_EVAL_TASKS/,
  );
});
