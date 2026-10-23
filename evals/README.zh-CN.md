# EVJS 编码 Agent 评测

[English](./README.md)

本试点评测 **`@evjs/ev` 核心框架**的应用开发和修复能力，不包含
`@alipay/evjs` 内网 facade。源码中不提供模型成绩；参考实现通过验收不能当作 AI 成功率。

## 首批 6 题

| 任务 | 考察能力 | 隐藏验收 |
| --- | --- | --- |
| `page-colocation` | 文件式 Page 与同目录辅助代码 | 直接访问、SPA 导航、首页回归、路由发现边界 |
| `nested-dynamic-page` | 动态参数与嵌套渲染 | 不同 ID、未知 ID、父页面保留、历史导航 |
| `page-metadata` | 相邻静态 Page 配置 | title/meta 切换、模板默认值恢复、无残留或重复标签 |
| `api-method-policy` | 全局与方法级中间件 | POST 验证、GET/HEAD/OPTIONS/405、请求体与响应头 |
| `fixed-api-root-migration` | 移除 server.routing.dir 后的迁移 | 当前 API 约定下 URL 和动态参数保持不变 |
| `server-function-mutation` | 服务端函数参数与查询失效 | 真实 RPC、随机输入、持久状态、错误恢复、不刷新页面 |

每题包含中文题面、初始工程、参考实现覆盖文件和隐藏验证器。共享工程提供配置、HTML 和
TypeScript 设置。参考实现保存在上传给 Agent 的 fixture 之外。

## 准备版本快照

在仓库根目录安装框架依赖与独立的评测工具。evals 有自己的锁文件，不属于 monorepo workspace。
使用仓库声明的 npm 11.6.2；本地 npm 10 的依赖解析曾出现 edgesOut 异常。

```bash
npx --yes npm@11.6.2 ci
npx --yes npm@11.6.2 --prefix evals ci
npm run evals:prepare
```

评测其他 checkout 可使用 `npm run evals:prepare -- --framework /path/to/clean/evjs`。
框架源码、公开文档和根锁文件必须无未提交修改。所需的 6 个 workspace 包从本地构建产物打包，
不会把源码中的 `0.0.0` 当作已发布版本。prepare 会在打包前自动构建 `@evjs/cli` 依赖图，
并从源码锁文件读取框架包直接外部依赖的版本，通过 overrides 固定。
显式声明 `@swc/helpers@0.5.17` peer，使 SWC 的 peer 解析与 Utoopack 嵌套的 `0.5.15` 副本分开。
冻结前执行 `npm@11.6.2 ci --dry-run --ignore-scripts` 检查生成锁的一致性；这不替代构建和运行验证。
快照记录 Git commit、tarball hash、依赖锁、公开文档 hash、
Skill hash、题库/工具 hash、Node 版本和平台。输出位于 `evals/.generated/<hash>/`，
`.generated/latest.json` 指向最近一次快照。
修改题目、验证器、脚本、初始工程或知识材料后需要重新生成快照；实验加载时会检查题库与工具 hash。

Agent 只得到自己的初始工程，不获得其他题目、参考解和验收辅助文件。所有隐藏验收组装进一个
`EVAL.ts`，由 agent-eval 在执行结束后注入。独立验证沙箱只重放允许的修改；依赖清单、锁文件、
框架包、知识材料、TypeScript 配置与测试运行配置受保护。首批题目不要求改变类型检查策略；
修改受保护文件会直接使该次运行失败，即使功能断言通过。

`agent-eval` 2.6.0 在发现题目时要求清单包含 `"type": "module"`，而当前 EVJS 应用快照
使用不含该字段的清单。上传的发现清单只额外添加这一字段；setup 验证发现清单后，
在安装依赖、Agent 执行和独立验证器运行之前，恢复 `dependencies/package.json` 中的完整原始清单。
本地参考实现验证也使用相同应用清单。结果记录两份清单的身份；这层适配只满足 harness 的题目
发现检查，不修改框架源码或应用实际的模块模式。

## 先验证题库

```bash
npm run evals:test
npm run evals:validate
# 安装过依赖与浏览器后的单题复查：
npm run evals:validate -- --skip-install --task page-colocation
```

验证器实际执行 `ev inspect`、生产构建和 TypeScript 检查，再启动 Utoopack 开发服务进行
Chromium 与 HTTP 验收。参考实现必须通过，初始工程必须在预期阶段失败。历史迁移题的初始工程
预期在 inspect 阶段失败；不能把浏览器或工具缺失当作正确的负样本。
报告位于 `evals/results/fixture-validation-*/`。工程副本及其依赖复制到系统临时目录，避免
Utoopack 向上发现父级 monorepo 并影响 fixture 的依赖解析。报告的 `appRoot` 给出实际位置，
验证结束后保留这些副本供排查。

本地校验执行的是可信参考实现与初始工程，不是正式模型隔离运行。
当前会验证生产构建，但浏览器行为跑在开发服务上。部署、SSR、SSG、RSC、bundler 横向比较和
连续多任务演进不在第一版范围内。

## 运行三组实验

执行底座锁定为 `@vercel/agent-eval@2.6.0`。首个适配器使用 Claude Code，因为该版本的
harness 支持锁定其 CLI 包。显式提供准确的模型 ID 与 CLI 版本，不使用随时间变化的别名。
在环境中配置 `ANTHROPIC_API_KEY` 或支持的 Claude OAuth 凭据，不把凭据写进跟踪文件。

```bash
export EVJS_EVAL_MODEL='<准确模型 ID>'
export EVJS_EVAL_CLI_PACKAGE='@anthropic-ai/claude-code@<准确版本>'
export EVJS_EVAL_RUNS=3
cd evals/.generated/<hash>
../../node_modules/.bin/agent-eval baseline --dry
../../node_modules/.bin/agent-eval docs --dry
../../node_modules/.bin/agent-eval skill --dry
env -u AI_GATEWAY_API_KEY -u VERCEL_OIDC_TOKEN \
  ../../node_modules/.bin/agent-eval run baseline docs skill --force --ack-failures
```

dry 命令只检查配置加载和题目发现，不验证 Docker、凭据、依赖安装或模型访问。
正式运行命令关闭上游可选的 LLM 失败分类器，并保留失败结果供本地确定性报告分析；
需要使用前文的 Claude 直连凭据。

需要已启动的 Docker。后端显式设为 docker，不自动切到云端账号。三组共享任务、模型、
CLI 版本、时间预算、框架包和验收规则：

| 条件 | 增加的上下文 |
| --- | --- |
| `baseline` | 只有应用和安装后的包产物 |
| `docs` | 同版本公开文档和 AGENTS.md 索引，由 CLAUDE.md 导入 |
| `skill` | 相同文档，通过项目内 evjs-core Skill 发现 |

关闭首次成功后的提前退出与 Agent 内置 Skill，不使用 LLM 裁判。
该 Skill 是独立的 core 实验材料，没有复制内网 facade 的约定。以后只有接入真实可用工具后
才增加 MCP 条件，并单独评测组合效果。上游缓存指纹不覆盖 setup/CLI 等所有信息，正式运行
使用 `--force`，不要复用不同条件的旧成绩。

上游 Docker 镜像 tag 和系统依赖尚未锁定 digest。安装 Chromium 系统包需要 root；
固定的 2.6.0 Docker 适配器没有公开的自定义镜像/root setup 选项，因此 setup 仅在 Agent 开始前
使用现有私有 `runCommandAsRoot` 方法安装系统包。浏览器下载与 Agent 执行仍使用普通 node 用户。
方法不存在时会明确失败；升级 harness 前必须重新验证这项适配。
`webResearch: false` 关闭专用网页工具，
不等于禁止 shell 联网。setup 提供并保护依赖锁，但 harness 在 npm ci 后还会运行 npm install。
setup 会将容器普通用户的全局 npm 固定并校验为 11.6.2，确保这两步使用相同版本。
因此当前是试点方案，不应宣称完全离线或跨机器严格复现；正式比较前应控制镜像、网络和 registry。
baseline 仍可阅读安装包的代码。

## 解读报告

```bash
node evals/scripts/report.mjs <agent-eval结果目录> --out report.json
```

按条件、模型和快照分别统计。重复运行通过率、首次运行成功率和 N 次至少成功一次必须分开。
成功成本需要包含失败尝试；缺失 usage 必须保持未知，不能补零。基础设施和无法分类的失败应
单独列出并调查。超时计为固定预算内失败，并单独列出；1,200 秒预算包含依赖准备和验证过程。
Smoke 试跑不计入成功率；缺少验证日志时保留为无法分类。
未提供完整计划清单时，报告无法发现从未生成结果的整道题；`--plan` 可以提供
预期批次与任务。先用三次重复调试试点；要宣称小幅增益，需要更多重复和配对不确定性分析。

从完整轨迹归因文档检索、API/版本选择、运行行为和错误恢复问题。六题是诊断种子，不代表全部
框架能力。改进文档和 Skill 时保留未参与调优的任务，避免对题库过拟合。

## 已知文档基线问题

初始源码快照的 `docs/docs/project-structure.md` 推荐目录树仍将 `src/apis/middleware.ts`
描述为所有 API 路由的中间件，而约定矩阵、server-routes.md 和当前测试区分显式方法组合与
`src/middlewares/middleware.*` 全局入口。本评测保留该公开文档快照。应在另一个可测量的版本中
修正文档，避免悄悄给不同实验组使用不同知识材料。

## 社区依据

- [agent-eval](https://github.com/vercel-labs/agent-eval)：执行与隔离。
- [Next.js evals](https://github.com/vercel/next.js/tree/canary/evals)：文档对照实验。
- [Svelte evals](https://github.com/sveltejs/svelte-evals)：结构与浏览器验收。
- [WebDev-Skills-Bench](https://arxiv.org/html/2608.23067v1)：匹配对照与内容消融。
