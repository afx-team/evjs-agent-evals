import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const evalRoot = fileURLToPath(new URL("..", import.meta.url));
export const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex");
export const json = (file) => JSON.parse(readFileSync(file, "utf8"));
export function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
export function files(root) {
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const file = path.join(root, entry.name);
      if (entry.isSymbolicLink())
        throw new Error(`Unexpected symlink: ${file}`);
      return entry.isDirectory() ? files(file) : [file];
    })
    .sort();
}
export function hashTree(root) {
  return sha256(
    JSON.stringify(
      files(root).map((file) => [
        path.relative(root, file),
        sha256(readFileSync(file)),
      ]),
    ),
  );
}
export function tasks() {
  return readdirSync(path.join(evalRoot, "cases"))
    .sort()
    .map((id) => {
      const directory = path.join(evalRoot, "cases", id);
      return { ...json(path.join(directory, "task.json")), id, directory };
    });
}
export function overlay(source, target) {
  if (!existsSync(source)) return;
  mkdirSync(target, { recursive: true });
  cpSync(source, target, { recursive: true });
}
export function applySolution(task, target) {
  for (const relative of task.remove ?? []) {
    const destination = path.resolve(target, relative);
    if (!destination.startsWith(`${path.resolve(target)}${path.sep}`))
      throw new Error(`Unsafe removal: ${relative}`);
    rmSync(destination, { recursive: true, force: true });
  }
  overlay(path.join(task.directory, "solution"), target);
}

export function hiddenEval(task, runtimeSource) {
  const verifier = readFileSync(
    path.join(task.directory, "verify.mjs"),
    "utf8",
  );
  return `${runtimeSource}\n${verifier}\nimport { test as evalTest } from 'vitest';\nevalTest('evjs: ${task.id}', async () => {\n  const result = await runVerification(process.cwd(), verify);\n  if (!result.passed) throw new Error((result.failureType === 'infrastructure' ? 'EVJS_EVAL_INFRA: ' : 'EVJS_EVAL_TASK: ') + JSON.stringify(result));\n}, 300000);\n`;
}
