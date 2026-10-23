import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  evalRoot,
  files,
  hashTree,
  hiddenEval,
  json,
  overlay,
  sha256,
  tasks,
  writeJson,
} from "./files.mjs";

const { values } = parseArgs({ options: { framework: { type: "string" } } });
const framework = path.resolve(values.framework ?? path.join(evalRoot, ".."));
const exec = (program, args, cwd = framework) =>
  execFileSync(program, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
const commit = exec("git", ["rev-parse", "HEAD"]).trim();
const sourceStatus = exec("git", [
  "status",
  "--porcelain",
  "--",
  "packages",
  "docs/docs",
  "package-lock.json",
]).trim();
if (sourceStatus)
  throw new Error(
    "Framework source/docs/lockfile have uncommitted changes. Commit or use a clean snapshot before preparing a scored experiment.",
  );
const packageNames = [
  "shared",
  "client",
  "server",
  "ev",
  "bundler-utoopack",
  "cli",
];
process.stdout.write(
  "Building the framework dependency graph before packing...\n",
);
exec("npx", ["--no-install", "turbo", "run", "build", "--filter=@evjs/cli"]);
for (const name of packageNames) {
  const buildDir = name === "cli" ? "dist" : "esm";
  if (!existsSync(path.join(framework, "packages", name, buildDir)))
    throw new Error(`Build @evjs/${name} first (npm run build).`);
}
const staging = path.join(evalRoot, ".generated", `preparing-${Date.now()}`);
const dependencyRoot = path.join(staging, "dependencies");
mkdirSync(path.join(dependencyRoot, "vendor"), { recursive: true });
const vendorHashes = {};
const dependencies = {};
for (const name of packageNames) {
  const result = JSON.parse(
    exec(
      "npm",
      [
        "pack",
        "--json",
        "--ignore-scripts",
        "--pack-destination",
        path.join(dependencyRoot, "vendor"),
      ],
      path.join(framework, "packages", name),
    ),
  );
  const file = result[0].filename;
  dependencies[`@evjs/${name}`] = `file:vendor/${file}`;
  vendorHashes[file] = sha256(
    readFileSync(path.join(dependencyRoot, "vendor", file)),
  );
}
const sourceLock = json(path.join(framework, "package-lock.json"));
const installedVersion = (name) => {
  const version = sourceLock.packages[`node_modules/${name}`]?.version;
  if (!version) throw new Error(`Missing locked package ${name}`);
  return version;
};
const overrides = {};
for (const owner of packageNames) {
  const ownedOverrides = {};
  const sourcePackage = json(
    path.join(framework, "packages", owner, "package.json"),
  );
  for (const name of Object.keys(sourcePackage.dependencies ?? {})) {
    if (name.startsWith("@evjs/")) continue;
    const locked =
      sourceLock.packages[`packages/${owner}/node_modules/${name}`] ??
      sourceLock.packages[`node_modules/${name}`];
    if (!locked?.version)
      throw new Error(`Missing source-locked dependency ${owner}/${name}`);
    ownedOverrides[name] = locked.version;
  }
  // Scope pins to their actual owner: a global override could force a newer
  // incompatible version onto an unrelated transitive dependency.
  if (Object.keys(ownedOverrides).length)
    overrides[`@evjs/${owner}`] = ownedOverrides;
}
Object.assign(dependencies, {
  react: installedVersion("react"),
  "react-dom": installedVersion("react-dom"),
});
const manifest = {
  name: "evjs-eval-app",
  version: "0.0.0",
  private: true,
  scripts: {
    inspect: "ev inspect --json",
    build: "ev build",
    dev: "ev dev --no-shortcuts",
    "check-types": "tsc --noEmit",
  },
  dependencies,
  overrides,
  devDependencies: {
    // Keep SWC's optional peer separate from Utoopack's pinned 0.5.15 copy.
    // Without an explicit peer, npm can emit a lock that its own ci rejects.
    "@swc/helpers": "0.5.17",
    "@playwright/test": "1.59.1",
    vitest: "4.1.4",
    typescript: installedVersion("typescript"),
    "@types/node": installedVersion("@types/node"),
    "@types/react": installedVersion("@types/react"),
    "@types/react-dom": installedVersion("@types/react-dom"),
  },
};
writeJson(path.join(dependencyRoot, "package.json"), manifest);
process.stdout.write(
  "Resolving a dependency lock for the packed framework snapshot...\n",
);
exec(
  "npx",
  [
    "--yes",
    "npm@11.6.2",
    "install",
    "--package-lock-only",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
  ],
  dependencyRoot,
);
// Reject internally inconsistent npm locks before freezing a snapshot.
exec(
  "npx",
  [
    "--yes",
    "npm@11.6.2",
    "ci",
    "--dry-run",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
  ],
  dependencyRoot,
);
overlay(
  path.join(framework, "docs", "docs"),
  path.join(staging, "materials", "docs"),
);
mkdirSync(path.join(staging, "materials", "skill"), { recursive: true });
writeFileSync(
  path.join(staging, "materials", "skill", "SKILL.md"),
  readFileSync(path.join(evalRoot, "materials", "SKILL.md")),
);
const snapshot = {
  schemaVersion: 1,
  frameworkCommit: commit,
  sourceStatus: "clean",
  sourceLockSha256: sha256(
    readFileSync(path.join(framework, "package-lock.json")),
  ),
  vendorHashes,
  packageJsonSha256: sha256(
    readFileSync(path.join(dependencyRoot, "package.json")),
  ),
  lockSha256: sha256(
    readFileSync(path.join(dependencyRoot, "package-lock.json")),
  ),
  docsSha256: hashTree(path.join(staging, "materials", "docs")),
  skillSha256: hashTree(path.join(staging, "materials", "skill")),
  suiteSha256: sha256(
    JSON.stringify(
      ["cases", "runtime", "scripts", "assets", "materials"].map((name) => [
        name,
        hashTree(path.join(evalRoot, name)),
      ]),
    ),
  ),
  harness: "@vercel/agent-eval@2.6.0",
  node: process.version,
  platform: `${process.platform}/${process.arch}`,
  bundler: "utoopack",
  taskIds: tasks().map((task) => task.id),
};
snapshot.snapshotHash = sha256(JSON.stringify(snapshot));
writeJson(path.join(staging, "manifest.json"), snapshot);
overlay(
  path.join(evalRoot, "cases"),
  path.join(staging, "validation", "cases"),
);
overlay(
  path.join(evalRoot, "runtime"),
  path.join(staging, "validation", "runtime"),
);
const runtime = readFileSync(
  path.join(evalRoot, "runtime", "verify.mjs"),
  "utf8",
);
for (const task of tasks()) {
  const target = path.join(staging, "evals", task.id);
  overlay(path.join(evalRoot, "assets", "base"), target);
  overlay(path.join(task.directory, "starter"), target);
  overlay(path.join(dependencyRoot, "vendor"), path.join(target, "vendor"));
  // agent-eval's fixture discovery insists on ESM; setup restores the actual
  // scaffold manifest before installation, model execution, and validation.
  writeJson(path.join(target, "package.json"), { ...manifest, type: "module" });
  writeFileSync(
    path.join(target, "fixture-lock.json"),
    readFileSync(path.join(dependencyRoot, "package-lock.json")),
  );
  writeJson(path.join(target, "fixture-meta.json"), {
    task: task.id,
    snapshotHash: snapshot.snapshotHash,
  });
  const prompt = `${readFileSync(path.join(task.directory, "PROMPT.md"), "utf8")}\n\n评测环境：这是 @evjs/ev 核心框架应用。保留现有依赖和脚本；不要修改 package.json、锁文件、vendor 或评测工具。可以使用 npm run inspect、npm run build、npm run check-types 验证修改。\n`;
  writeFileSync(path.join(target, "PROMPT.md"), prompt);
  writeFileSync(path.join(target, "EVAL.ts"), hiddenEval(task, runtime));
}
mkdirSync(path.join(staging, "experiments"), { recursive: true });
mkdirSync(path.join(staging, "results"), { recursive: true });
for (const condition of ["baseline", "docs", "skill"]) {
  writeFileSync(
    path.join(staging, "experiments", `${condition}.ts`),
    `import { fileURLToPath } from 'node:url';\nimport { makeExperiment } from '../../../scripts/experiment.mjs';\nexport default makeExperiment({ condition: '${condition}', snapshotDir: fileURLToPath(new URL('..', import.meta.url)), model: process.env.EVJS_EVAL_MODEL, cliPackage: process.env.EVJS_EVAL_CLI_PACKAGE, runs: Number(process.env.EVJS_EVAL_RUNS ?? 3), taskFilter: process.env.EVJS_EVAL_TASKS });\n`,
  );
}
const destination = path.join(
  evalRoot,
  ".generated",
  snapshot.snapshotHash.slice(0, 16),
);
if (existsSync(destination))
  throw new Error(
    `Snapshot already exists: ${destination}. Reuse it; do not overwrite results.`,
  );
renameSync(staging, destination);
writeJson(path.join(evalRoot, ".generated", "latest.json"), {
  snapshotDir: destination,
  snapshotHash: snapshot.snapshotHash,
});
process.stdout.write(
  `${JSON.stringify({ snapshotDir: destination, snapshotHash: snapshot.snapshotHash, tasks: snapshot.taskIds, uploadedFiles: files(path.join(destination, "evals")).length }, null, 2)}\n`,
);
