# EVJS 编码 Agent 评测

[![Validate fixtures and Docker](https://github.com/afx-team/evjs-agent-evals/actions/workflows/validate.yml/badge.svg)](https://github.com/afx-team/evjs-agent-evals/actions/workflows/validate.yml)

[English](README.md) · [题库与评测方法](evals/README.zh-CN.md)

面向 **`@evjs/ev` 核心框架**的任务型评测，比较基础工程、同版本公开文档和项目内 Skill 三组条件。不包含内网 `@alipay/evjs` facade。

六道题覆盖同目录页面组织、动态嵌套、元数据、HTTP 中间件、API 迁移和 Server Function mutation。验收实际执行框架 inspect、生产构建、TypeScript、Chromium 与 HTTP 检查。**参考解通过不能当作 AI 成功率。**

## 在 GitHub 运行

**Validate fixtures and Docker** 在 push、PR 或手动触发时运行。它构建 [framework.json](framework.json) 固定的 EVJS commit，冻结快照，验证六个参考解和六个失败对照，再用真实 Docker/Vitest harness 验证 API 参考解。不需要模型密钥，也不调用模型。结果与冻结快照保存在 Actions artifacts。

**Model benchmark (manual)** 仅在手动触发时运行。先配置仓库 Secret `ANTHROPIC_API_KEY`，然后填入模型精确 ID、`@anthropic-ai/claude-code@x.y.z` 精确版本和 1–3 次重复。工作流先验证同一份共享快照，再按任务与条件分为 18 个 job，最多同时运行两个 job，每个 job 最多三次重复。失败尝试和不完整运行同样保留结果。最后汇总检查全部 18 个任务/条件组合，明确标出完全缺失的报告。

没有配置定时或自动付费模型任务。工作流使用只读仓库权限，模型密钥只提供给显式启动的评测步骤。

## 本地运行

需要 Node 22+（CI 为 Node 24）和 npm 11.6.2。Docker 参考验收与真实模型评测需要 Docker。

```bash
npx --yes npm@11.6.2 --prefix evals ci
npm test
git clone https://github.com/afx-team/evjs.git framework
git -C framework checkout 6793f3491d6e6f5d95d420fcbf99bca11db74823
(cd framework && npx --yes npm@11.6.2 ci)
npm run ci:prepare
# Linux 需要浏览器系统依赖；其他平台可省略 --with-deps。
evals/node_modules/.bin/playwright install --with-deps chromium
npm run evals:validate
node evals/scripts/validate-docker.mjs
npm run ci:dry
```

框架 checkout、依赖、生成快照和运行结果均不进入 Git。更新评测框架时，修改 `framework.json` 中的精确 commit，然后重新生成快照。

## 结果边界

重复运行成功率、首次成功率、N 次内至少成功一次与 usage 分开统计，缺失数据保持未知。六题用于定位问题，不能代表框架全部能力。生产构建之后的浏览器验收使用开发服务；第一版不覆盖部署、SSR、SSG 和 RSC。

执行底座固定为 `@vercel/agent-eval@2.6.0`。Docker 镜像 tag 和系统包尚未固定 digest；安装浏览器系统依赖使用该锁定版本的内部 root setup 方法。禁用网页工具也不等于禁止 shell 联网。详细限制见[评测说明](evals/README.zh-CN.md)。

参考社区实践：[Vercel agent-eval](https://github.com/vercel-labs/agent-eval)、[Svelte evals](https://github.com/sveltejs/svelte-evals)、[WebDev-Skills-Bench](https://arxiv.org/html/2608.23067v1)。
