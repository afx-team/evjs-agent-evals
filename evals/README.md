# EVJS coding-agent evaluations

[中文](./README.zh-CN.md)

This pilot measures whether an agent can develop and repair **`@evjs/ev` core**
applications. It does not evaluate the `@alipay/evjs` facade. No model scores are
included in the source tree: reference-solution validation is not an AI result.

## Six independent tasks

| Task | Capability | Hidden acceptance |
| --- | --- | --- |
| `page-colocation` | File-based Pages and ordinary colocated components | Direct access, SPA navigation, existing home, discovery boundary |
| `nested-dynamic-page` | Dynamic parameters and nested rendering | Two IDs, unknown ID, parent content, history navigation |
| `page-metadata` | Adjacent static Page configuration | Title/meta transitions, template defaults, no stale/duplicate tags |
| `api-method-policy` | Global versus method middleware | POST validation, GET/HEAD/OPTIONS/405, body handling, response headers |
| `fixed-api-root-migration` | Migration from removed `server.routing.dir` | Stable URLs and dynamic parameters under the current API convention |
| `server-function-mutation` | Server-function arguments and query invalidation | Real RPC, randomized input, persistence, error recovery, no page reload |

Each case has a user prompt, starter files, reference-solution overlay, and a
hidden verifier. A shared app supplies configuration, HTML and TypeScript
settings. The reference overlay is kept outside the uploaded fixture.

## Prepare a versioned experiment

From the repository root, install the framework dependencies and separate eval
tooling. Use the repository's npm 11.6.2: npm 10 hit an edgesOut resolver failure locally. The eval package is deliberately not a monorepo workspace.

```bash
npx --yes npm@11.6.2 ci
npx --yes npm@11.6.2 --prefix evals ci
npm run evals:prepare
```

Use `npm run evals:prepare -- --framework /path/to/clean/evjs` to evaluate another
checkout. Preparation requires clean framework sources, public docs, and the
root dependency lock. All six necessary workspace packages are packed locally;
the app uses those tarballs, never a guessed published `0.0.0` version. The
prepare command automatically builds the `@evjs/cli` dependency graph before
packing. Framework packages' direct external dependencies are pinned through
overrides from the source lock. An explicit `@swc/helpers@0.5.17` peer keeps
SWC's peer resolution separate from Utoopack's nested `0.5.15` copy. Preparation
checks the generated lock with `npm@11.6.2 ci --dry-run --ignore-scripts` before
freezing it; this checks lock consistency, not build or runtime behavior. The
snapshot records the commit, tarball hashes, dependency lock, public-doc hash,
Skill hash, suite hash, Node version and platform. It lives in
`evals/.generated/<hash>/`; `.generated/latest.json` points to it.
Changing cases, runtime, scripts, starter assets or knowledge materials requires
a new snapshot; experiment loading checks the suite hash before proceeding.

The agent receives only the fixture. It cannot see sibling cases, reference
solutions, or verifier helpers. The complete hidden verifier is assembled into
one `EVAL.ts`, which `agent-eval` withholds until validation. A fresh verifier
sandbox receives only allowed changes. Dependency manifests, locks, vendored
framework packages, supplied knowledge files, TypeScript configuration and
test-runner configuration are protected. These pilot tasks do not require
changing type-check policy. Protected changes fail the run even if assertions pass.

`agent-eval` 2.6.0 requires `"type": "module"` when discovering fixtures, whereas
this EVJS application snapshot uses a manifest without that field. The uploaded
discovery manifest adds only this field. Setup verifies it and restores the exact
application manifest from `dependencies/package.json` before installation and
before either the agent or separate verifier runs. Local reference validation
uses that same application manifest. Both manifest identities are recorded; this
bridge satisfies harness discovery and does not change framework source or the
application's runtime module mode.

## Validate the benchmark before running a model

```bash
npm run evals:test
npm run evals:validate
# Faster follow-up after dependency/browser installation:
npm run evals:validate -- --skip-install --task page-colocation
```

This runs the actual `ev inspect`, production build and TypeScript checks,
then starts the Utoopack development runtime and uses Chromium/HTTP assertions.
Each solution must pass; every original starter must fail. The historical
migration starter is expected to fail during inspection. A failure to start the
browser/runtime is not accepted as a successful negative control. Reports go to
`evals/results/fixture-validation-*/`. Application copies and their dependencies
live under a system temporary directory so Utoopack cannot discover the parent
monorepo while resolving the fixture. The report's `appRoot` records this location
for inspection; these copies remain available after validation.

Local fixture validation runs trusted reference/starter code on the host. It is
not the isolated model execution path. Production artifacts are built, but
browser behavior is tested against the development server; deployment, SSR,
SSG, RSC, bundler comparison and continuous multi-task evolution are outside
this first pilot.

## Run the three conditions

`@vercel/agent-eval` is pinned to 2.6.0. The first adapter is Claude Code because
this harness release supports pinning its CLI package version. Set an exact
model ID and exact CLI package version explicitly; do not use a moving alias.
Configure `ANTHROPIC_API_KEY` or supported Claude OAuth credentials in the
environment. Never put credentials in tracked files.

```bash
export EVJS_EVAL_MODEL='<exact-model-id>'
export EVJS_EVAL_CLI_PACKAGE='@anthropic-ai/claude-code@<exact-version>'
export EVJS_EVAL_RUNS=3
cd evals/.generated/<hash>
../../node_modules/.bin/agent-eval baseline --dry
../../node_modules/.bin/agent-eval docs --dry
../../node_modules/.bin/agent-eval skill --dry
env -u AI_GATEWAY_API_KEY -u VERCEL_OIDC_TOKEN \
  ../../node_modules/.bin/agent-eval run baseline docs skill --force --ack-failures
```

The dry commands load configuration and discover fixtures; they do not test
Docker, credentials, dependency installation or model access. The run command
disables the optional upstream LLM failure classifier and retains failed results
for the local deterministic report. It requires the direct Claude credentials above.

Docker must be installed and running. The backend is explicitly `docker`; it
does not silently switch to a cloud account. All conditions run the same tasks,
model, pinned CLI, budget, package snapshot and verifier:

| Condition | Added context |
| --- | --- |
| `baseline` | Existing application and installed package artifacts only |
| `docs` | Version-matched public docs plus an `AGENTS.md` index, imported by `CLAUDE.md` |
| `skill` | The same docs, discovered through a project-local `evjs-core` Skill |

Use `--force` for a fresh campaign: upstream fingerprints do not cover every setup/CLI input. Runs do not stop after the first success. Bundled agent skills are disabled.
No LLM judge is used. The Skill is a new core-only experimental artifact, not a
copy of the internal facade Skill. New conditions such as MCP should be added
only with a real available tool, followed by a separate interaction experiment.

The upstream Docker image tag and OS package installation are not digest-locked.
Chromium OS packages require root. The pinned 2.6.0 Docker adapter has no public
custom-image/root-setup option, so setup uses its existing private
`runCommandAsRoot` hook only to install these packages before the agent starts.
Browser download and agent execution run as the ordinary `node` user. Setup
fails explicitly if the hook is unavailable; revalidate this integration before
upgrading the harness.
`webResearch: false` disables dedicated web tools, not all shell networking.
The harness performs `npm install` after setup's `npm ci`; the lock is supplied
and protected, but this remains a pilot rather than a hermetically offline
benchmark. Use a controlled registry/network/image before claiming strict
cross-machine reproducibility. Baseline can still read installed package code.

## Interpret results

```bash
node evals/scripts/report.mjs <agent-eval-results-directory> --out report.json
```

Report each condition/model/snapshot independently. Keep repeated-run success,
first-run success and any-of-N success distinct. Include failed attempts in
cost per successful run; missing usage is unknown, not zero. Infrastructure
and unclassified failures require investigation and must remain visible.
Timeouts count as fixed-budget failures and are listed separately; the 1,200-second
budget includes dependency setup and verification. Smoke runs are excluded from
success rates. Missing verifier logs remain unclassified.
Without a complete planned task/run roster, a report cannot detect a task that
never produced any result; `--plan` supplies the expected batch/task roster. Start with three repeats to debug the pilot; use
more repeats and paired uncertainty estimates before claiming small gains.

Inspect full transcripts to distinguish retrieval failure, wrong API/version,
runtime behavior and recovery failures. These six tasks are a diagnostic seed,
not representative evidence for every framework capability. Retain held-out
tasks when improving docs or the Skill.

## Known source-document inconsistency

At the initial source snapshot, the recommended tree in
`docs/docs/project-structure.md` describes `src/apis/middleware.ts` as middleware
for all API routes. The convention matrix, `server-routes.md`, and tested
implementation instead distinguish explicit method composition from the global
`src/middlewares/middleware.*` anchor. This suite preserves the public docs in
the baseline snapshot. Correct that documentation in a separate measured
revision rather than changing one condition's reference material unnoticed.

## Community references

- [agent-eval](https://github.com/vercel-labs/agent-eval): execution and isolation.
- [Next.js evals](https://github.com/vercel/next.js/tree/canary/evals): controlled documentation experiments.
- [Svelte evals](https://github.com/sveltejs/svelte-evals): structural and browser acceptance.
- [WebDev-Skills-Bench](https://arxiv.org/html/2608.23067v1): matched controls and content ablations.
