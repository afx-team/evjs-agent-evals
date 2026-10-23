# EVJS agent evals

[![Validate fixtures and Docker](https://github.com/afx-team/evjs-agent-evals/actions/workflows/validate.yml/badge.svg)](https://github.com/afx-team/evjs-agent-evals/actions/workflows/validate.yml)

[中文说明](README.zh-CN.md) · [Evaluation design and task details](evals/README.md)

A task-based evaluation suite for AI coding agents using **`@evjs/ev` core**. It compares a baseline app, version-matched public documentation, and a project-local Skill. The internal `@alipay/evjs` facade is outside scope.

Six tasks cover page colocation, nested dynamic pages, metadata, HTTP middleware, API migration, and server-function mutations. Reference solutions and negative controls are checked with framework inspection, a production build, TypeScript, Chromium and HTTP assertions. Reference validation is **not an AI success rate**.

## GitHub Actions

**Validate fixtures and Docker** runs on pushes, pull requests and manual dispatch. It builds the framework commit pinned in [framework.json](framework.json), freezes an evaluation snapshot, verifies all six references and six negative controls, and runs the API reference through the actual Docker/Vitest harness. No model key or model call is needed. Reports and the frozen snapshot are saved as workflow artifacts.

**Model benchmark (manual)** runs only when explicitly dispatched. Configure the repository secret `ANTHROPIC_API_KEY`, then provide an exact model ID, exact `@anthropic-ai/claude-code@x.y.z` package and 1–3 repetitions. It first validates the shared snapshot, then runs 18 task/condition jobs, at most two jobs at once. Each job contains at most three repetitions. Failed attempts and incomplete runs are retained in artifacts. A final campaign summary checks all 18 task/condition jobs and explicitly lists missing reports.

No scheduled or automatic paid model runs are configured. The workflows use read-only repository permissions, and model credentials are only supplied to the explicit benchmark step.

## Local use

Use Node 22+ (CI uses Node 24) and npm 11.6.2. Docker is needed for the Docker reference check and model evaluations.

```bash
npx --yes npm@11.6.2 --prefix evals ci
npm test
git clone https://github.com/afx-team/evjs.git framework
git -C framework checkout 6793f3491d6e6f5d95d420fcbf99bca11db74823
(cd framework && npx --yes npm@11.6.2 ci)
npm run ci:prepare
# Linux needs browser OS dependencies; other platforms can omit --with-deps.
evals/node_modules/.bin/playwright install --with-deps chromium
npm run evals:validate
node evals/scripts/validate-docker.mjs
npm run ci:dry
```

The framework checkout and generated dependencies/results are ignored by Git. To evaluate a different framework version, update the exact commit in `framework.json` and rebuild the snapshot.

## Interpretation and limits

The pilot reports repeated-run success, first-run success, any-of-N success and available usage separately. Missing usage stays unknown. Six tasks diagnose specific problems; they do not establish a comprehensive framework ranking. Browser checks use the dev server after a production build; deployment, SSR, SSG and RSC are not covered.

The harness is pinned to `@vercel/agent-eval@2.6.0`. Its Docker image tag and system packages are not pinned by digest, and browser OS installation uses a version-specific internal root setup hook. Web-tool disabling does not prohibit shell networking. See the detailed [methodology and limitations](evals/README.md).

Inspired by [Vercel agent-eval](https://github.com/vercel-labs/agent-eval), [Svelte evals](https://github.com/sveltejs/svelte-evals), and [WebDev-Skills-Bench](https://arxiv.org/html/2608.23067v1).
