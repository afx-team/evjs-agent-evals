import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

export function sourceFiles(root, directory = "src") {
  return readdirSync(path.join(root, directory), { withFileTypes: true })
    .flatMap((entry) => {
      const relative = path.posix.join(directory, entry.name);
      if (entry.isSymbolicLink())
        throw new Error(`Source symlink: ${relative}`);
      return entry.isDirectory() ? sourceFiles(root, relative) : [relative];
    })
    .sort();
}

export async function command(commandName, args, cwd, timeout = 120_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(commandName, args, {
      cwd,
      env: { ...process.env, CI: "1", NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let output = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      stopProcess(child, "SIGKILL");
    }, timeout);
    child.stdout.on("data", (data) => {
      output += data;
    });
    child.stderr.on("data", (data) => {
      output += data;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && !timedOut) resolve(output);
      else
        reject(
          new Error(
            `${commandName} ${args.join(" ")} ${timedOut ? "timed out" : `exited ${code}`}\n${output.slice(-16000)}`,
          ),
        );
    });
  });
}

function stopProcess(child, signal = "SIGTERM") {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

export async function runVerification(root, verify, onPhase = () => {}) {
  const started = Date.now();
  let phase = "environment";
  let child;
  let browser;
  let output = "";
  try {
    onPhase(phase);
    const cli = fileURLToPath(
      new URL("../bin/ev.js", import.meta.resolve("@evjs/cli")),
    );
    const tsc = fileURLToPath(
      new URL("./bin/tsc", import.meta.resolve("typescript/package.json")),
    );
    for (const executable of [cli, tsc, chromium.executablePath()]) {
      if (!existsSync(executable))
        throw new Error(`Missing evaluation dependency: ${executable}`);
    }
    phase = "inspect";
    onPhase(phase);
    const raw = await command(
      process.execPath,
      [cli, "inspect", "--json"],
      root,
    );
    const inspection = JSON.parse(raw);
    expect(
      inspection.diagnostics.filter((item) => item.level === "error"),
    ).toEqual([]);
    expect(inspection.routing.routingMode).toBe("spa");
    phase = "build";
    onPhase(phase);
    await command(process.execPath, [cli, "build"], root);
    phase = "types";
    onPhase(phase);
    await command(
      process.execPath,
      [tsc, "--noEmit", "-p", "tsconfig.json"],
      root,
    );
    phase = "runtime";
    onPhase(phase);
    const port = await freePort();
    const apiPort = await freePort();
    const origin = `http://localhost:${port}`;
    const bootstrap = path.join(root, ".eval-dev.mjs");
    writeFileSync(
      bootstrap,
      `import {dev,loadConfig} from '@evjs/cli';\nconst config=await loadConfig(process.cwd());\nawait dev({...config,dev:{...config?.dev,port:${port},cliShortcuts:false},server:{...config?.server,dev:{...config?.server?.dev,port:${apiPort}}}},{cwd:process.cwd(),reloadInitialConfig:false,cliShortcuts:false});\n`,
    );
    child = spawn(process.execPath, [bootstrap], {
      cwd: root,
      env: { ...process.env, CI: "1", NODE_ENV: "development", NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let launchError;
    child.on("error", (error) => {
      launchError = error;
    });
    child.stdout.on("data", (data) => {
      output = (output + data).slice(-32000);
    });
    child.stderr.on("data", (data) => {
      output = (output + data).slice(-32000);
    });
    let ready = false;
    for (let i = 0; i < 180; i++) {
      if (launchError) throw launchError;
      if (child.exitCode !== null)
        throw new Error(`Dev server exited ${child.exitCode}\n${output}`);
      try {
        const response = await fetch(origin, {
          signal: AbortSignal.timeout(1500),
        });
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {
        /* The server is still booting. */
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!ready) throw new Error(`Dev server did not become ready\n${output}`);
    phase = "browser";
    onPhase(phase);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    phase = "behavior";
    onPhase(phase);
    await verify({
      page,
      origin,
      expect,
      inspection,
      readSource: (relative) => readFileSync(path.join(root, relative), "utf8"),
      sourceFiles: () => sourceFiles(root),
    });
    return { passed: true, phase, durationMs: Date.now() - started };
  } catch (error) {
    return {
      passed: false,
      phase,
      failureType: ["environment", "browser"].includes(phase)
        ? "infrastructure"
        : "task",
      durationMs: Date.now() - started,
      error: error.stack ?? String(error),
      runtimeLog: output,
    };
  } finally {
    await browser?.close();
    if (child) {
      const exited = new Promise((resolve) => child.once("close", resolve));
      stopProcess(child);
      await Promise.race([
        exited,
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ]);
      stopProcess(child, "SIGKILL");
    }
  }
}
