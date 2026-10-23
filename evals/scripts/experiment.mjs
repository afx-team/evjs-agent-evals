import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CONDITIONS = new Set(["baseline", "docs", "skill"]);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

/** Resolve a literal task list; never interpret workflow input as a glob. */
export function selectTaskIds(taskFilter, available) {
  if (!Array.isArray(available) || available.length === 0)
    throw new Error("The frozen snapshot must contain taskIds");
  if (taskFilter === undefined) return [...available];
  if (typeof taskFilter !== "string" || !taskFilter.trim())
    throw new Error("EVJS_EVAL_TASKS must be a non-empty comma-separated list");
  const selected = taskFilter.split(",").map((task) => task.trim());
  for (const task of selected) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(task))
      throw new Error(
        `Invalid EVJS_EVAL_TASKS task ID: ${JSON.stringify(task)}`,
      );
    if (!available.includes(task))
      throw new Error(`Unknown EVJS_EVAL_TASKS task ID: ${task}`);
  }
  if (new Set(selected).size !== selected.length)
    throw new Error("EVJS_EVAL_TASKS must not contain duplicate task IDs");
  return selected;
}

function materialFiles(root) {
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(root, entry.name);
      if (entry.isSymbolicLink())
        throw new Error(`Unexpected material symlink: ${path}`);
      return entry.isDirectory() ? materialFiles(path) : [path];
    })
    .sort();
}

function materialHash(root) {
  return sha256(
    JSON.stringify(
      materialFiles(root).map((path) => [
        relative(root, path),
        sha256(readFileSync(path)),
      ]),
    ),
  );
}

async function checkedCommand(sandbox, command, args, asRoot = false) {
  if (
    asRoot &&
    (sandbox.backend !== "docker" ||
      typeof sandbox.runCommandAsRoot !== "function")
  ) {
    throw new Error(
      "EVJS_EVAL_INFRA_SETUP: agent-eval 2.6.0 Docker root setup hook is unavailable; Chromium OS dependencies cannot be installed",
    );
  }
  // The pinned Docker backend has no public custom-image/root-setup API. This
  // runtime method exists in 2.6.0 but is marked private in its TypeScript API.
  // Limit it to dependency installation before any evaluated-agent code runs.
  const result = asRoot
    ? await sandbox.runCommandAsRoot(command, args)
    : await sandbox.runCommand(command, args);
  if (result.exitCode !== 0) {
    throw new Error(
      `EVJS_EVAL_INFRA_SETUP: ${command} ${args.join(" ")} exited ${result.exitCode}\n${result.stderr || result.stdout}`,
    );
  }
}

/** Make a @vercel/agent-eval 2.6.0 config; never starts a model itself. */
export function makeExperiment({
  condition,
  snapshotDir,
  model,
  runs = 3,
  cliPackage,
  taskFilter,
}) {
  if (!CONDITIONS.has(condition))
    throw new Error(`Unknown condition: ${condition}`);
  if (typeof model !== "string" || !model.trim())
    throw new Error("An explicit model ID is required");
  if (!Number.isSafeInteger(runs) || runs < 1)
    throw new Error("runs must be a positive integer");
  if (
    !/^@anthropic-ai\/claude-code@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(
      cliPackage ?? "",
    )
  ) {
    throw new Error(
      "cliPackage must pin @anthropic-ai/claude-code to an exact version",
    );
  }
  const snapshot = resolve(snapshotDir);
  const manifestSource = readFileSync(join(snapshot, "manifest.json"), "utf8");
  const manifest = JSON.parse(manifestSource);
  const selectedTasks = selectTaskIds(taskFilter, manifest.taskIds);
  if (manifest.suiteSha256) {
    const evalRoot = fileURLToPath(new URL("..", import.meta.url));
    const currentSuiteHash = sha256(
      JSON.stringify(
        ["cases", "runtime", "scripts", "assets", "materials"].map((name) => [
          name,
          materialHash(join(evalRoot, name)),
        ]),
      ),
    );
    if (currentSuiteHash !== manifest.suiteSha256) {
      throw new Error(
        "Evaluation suite changed after this snapshot was prepared; run evals:prepare again",
      );
    }
  }
  const manifestSha256 = sha256(manifestSource);
  const snapshotHash = manifest.snapshotHash ?? manifestSha256;
  const lockPath = existsSync(
    join(snapshot, "dependencies", "package-lock.json"),
  )
    ? join(snapshot, "dependencies", "package-lock.json")
    : join(snapshot, "package-lock.json");
  const lockSource = readFileSync(lockPath, "utf8");
  const lockSha256 = sha256(lockSource);
  if (manifest.lockSha256 && manifest.lockSha256 !== lockSha256) {
    throw new Error(
      "Snapshot package-lock.json does not match manifest.lockSha256",
    );
  }
  const packageSource = readFileSync(
    join(snapshot, "dependencies", "package.json"),
    "utf8",
  );
  const packageJsonSha256 = sha256(packageSource);
  if (
    manifest.packageJsonSha256 &&
    manifest.packageJsonSha256 !== packageJsonSha256
  ) {
    throw new Error(
      "Application package.json differs from the frozen snapshot manifest",
    );
  }
  const packageManifest = JSON.parse(packageSource);
  const fixturePackageManifest = { ...packageManifest, type: "module" };
  const canonicalManifest = (value) => {
    if (Array.isArray(value)) return value.map(canonicalManifest);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, canonicalManifest(value[key])]),
      );
    return value;
  };
  const manifestJson = (value) => JSON.stringify(canonicalManifest(value));
  const fixturePackageJsonSha256 = sha256(manifestJson(fixturePackageManifest));
  const docsDir = join(snapshot, "materials", "docs");
  if (manifest.docsSha256 && materialHash(docsDir) !== manifest.docsSha256) {
    throw new Error("Documentation differs from the frozen snapshot manifest");
  }
  const skillDir = join(snapshot, "materials", "skill");
  if (manifest.skillSha256 && materialHash(skillDir) !== manifest.skillSha256) {
    throw new Error("Skill differs from the frozen snapshot manifest");
  }
  const docs = Object.fromEntries(
    materialFiles(docsDir)
      .filter((path) => path.endsWith(".md"))
      .map((path) => [
        `.evjs-docs/${relative(docsDir, path)}`,
        readFileSync(path, "utf8"),
      ]),
  );
  if (Object.keys(docs).length === 0)
    throw new Error("The snapshot contains no public documentation");
  const docsHashes = Object.fromEntries(
    Object.entries(docs).map(([name, value]) => [name, sha256(value)]),
  );
  const docsSha256 = sha256(JSON.stringify(docsHashes));
  const skill = readFileSync(
    join(snapshot, "materials", "skill", "SKILL.md"),
    "utf8",
  );
  const skillSha256 = sha256(skill);
  const injected = {};
  if (condition !== "baseline") Object.assign(injected, docs);
  if (condition === "docs") {
    injected["AGENTS.md"] = [
      "# evjs framework documentation",
      "",
      "This project uses @evjs/ev. Read the relevant local documentation before changing framework code or configuration.",
      "These documents match the installed framework snapshot. Use the public APIs and conventions described there.",
      "",
      ...Object.keys(docs).map(
        (path) => `- [${path.slice(".evjs-docs/".length)}](${path})`,
      ),
      "",
    ].join("\n");
    // Native Claude Code reads CLAUDE.md; the bridge activates the same AGENTS.md index.
    injected["CLAUDE.md"] = "@AGENTS.md\n";
  }
  if (condition === "skill") {
    injected[".agents/skills/evjs-core/SKILL.md"] = skill;
    injected[".claude/skills/evjs-core/SKILL.md"] = skill;
  }
  return {
    agent: "claude-code",
    evals: selectedTasks,
    model,
    runs,
    earlyExit: false,
    sandbox: "docker",
    verifier: "separate",
    validation: "vitest",
    scripts: [],
    timeout: 1200,
    copyFiles: "changed",
    disableBundledSkills: true,
    webResearch: false,
    agentOptions: { cliPackage },
    protectedPaths: [
      "**/package.json",
      "**/package-lock.json",
      "**/fixture-lock.json",
      "**/fixture-meta.json",
      // None of the pilot tasks changes type-check or test-runner policy.
      "**/tsconfig*.json",
      "**/vitest.config.*",
      "**/vitest.workspace.*",
      "**/vite.config.*",
      "vendor/**",
      "**/AGENTS.md",
      "**/CLAUDE.md",
      ".agents/**",
      ".claude/**",
      ".evjs-docs/**",
      "**/EVAL.*",
      "**/PROMPT.md",
      "**/.npmrc",
      ".gitignore",
    ],
    async setup(sandbox) {
      const fixturePackage = JSON.parse(await sandbox.readFile("package.json"));
      if (
        manifestJson(fixturePackage) !== manifestJson(fixturePackageManifest)
      ) {
        throw new Error(
          "EVJS_EVAL_INFRA_SETUP: fixture package.json differs from the expected discovery manifest",
        );
      }
      const fixtureLock = await sandbox.readFile("fixture-lock.json");
      if (sha256(fixtureLock) !== lockSha256) {
        throw new Error(
          "EVJS_EVAL_INFRA_SETUP: fixture-lock.json differs from the frozen snapshot lock",
        );
      }
      await sandbox.writeFiles({
        // agent-eval discovery requires type:module, but this EVJS app uses the
        // frozen application manifest at runtime. Restore it before installation,
        // the evaluated agent, and the separate verifier run.
        "package.json": packageSource,
        "package-lock.json": fixtureLock,
        ...injected,
      });
      await checkedCommand(sandbox, "npx", [
        "--yes",
        "npm@11.6.2",
        "ci",
        "--no-audit",
        "--no-fund",
      ]);
      await checkedCommand(
        sandbox,
        "npx",
        ["--no-install", "playwright", "install-deps", "chromium"],
        true,
      );
      await checkedCommand(sandbox, "npx", [
        "--no-install",
        "playwright",
        "install",
        "chromium",
      ]);
      if (sha256(await sandbox.readFile("package-lock.json")) !== lockSha256) {
        throw new Error(
          "EVJS_EVAL_INFRA_SETUP: dependency installation modified the frozen lock",
        );
      }
      if (
        sha256(await sandbox.readFile("package.json")) !== packageJsonSha256
      ) {
        throw new Error(
          "EVJS_EVAL_INFRA_SETUP: dependency installation modified the application manifest",
        );
      }
      // agent-eval 2.6.0 captures changes relative to HEAD, which otherwise predates
      // setup. Commit our files so the separate verifier never mistakes treatment
      // material or the restored lock for changes authored by the evaluated agent.
      await checkedCommand(sandbox, "git", [
        "add",
        "--",
        "package.json",
        "package-lock.json",
        ...Object.keys(injected),
      ]);
      await checkedCommand(sandbox, "git", [
        "-c",
        "user.name=evjs-eval",
        "-c",
        "user.email=evjs-eval@localhost",
        "commit",
        "--allow-empty",
        "-m",
        "Freeze evaluation setup before agent execution",
      ]);
    },
    onRunComplete({ fixture, runIndex, runData, config }) {
      const tampering = runData.result.tampering ?? [];
      const result = { ...runData.result };
      if (tampering.length > 0) {
        result.status = "failed";
        result.error = `EVJS_EVAL_TAMPERING: protected files changed: ${tampering.join(", ")}`;
      }
      result.metadata = {
        ...result.metadata,
        evjsEval: {
          schemaVersion: 1,
          condition,
          task: fixture.name,
          model,
          agent: "claude-code",
          cliPackage,
          dependencyInstaller: "npm@11.6.2",
          runIndex,
          expectedRuns: config.runs,
          selectedTasks,
          snapshotHash,
          manifestSha256,
          lockSha256,
          packageJsonSha256,
          fixturePackageJsonSha256,
          fixturePackageHashEncoding: "canonical-json",
          discoveryManifestBridge:
            "type:module restored to frozen application manifest during setup",
          // Record the shared corpus even for baseline; exposedDocuments is empty there.
          docsSha256,
          docsHashes,
          exposedDocuments: condition === "baseline" ? [] : Object.keys(docs),
          skillSha256: condition === "skill" ? skillSha256 : null,
          docsEntry:
            condition === "docs" ? "CLAUDE.md imports AGENTS.md" : null,
          networkIsolation: false,
          budgetIncludesSetupAndVerifier: true,
        },
      };
      return { ...runData, result };
    },
  };
}
