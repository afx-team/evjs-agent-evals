便签 API 的写入校验最近被挪到了全局中间件，现在不登录连列表也打不开，预检也失败；合法的新建请求偶尔还会报请求体已读。请修复现有实现。

接口约定：

- `GET /api/notes` 公开返回便签数组，保留现有的“欢迎”便签。
- 只有 `POST /api/notes` 要求请求头 `x-writer: enabled`；缺失或错误时返回 401，JSON 为 `{ "error": "Writer access required" }`。
- POST 的 JSON 需要非空字符串 `title`；前后空格不算内容。无效字段或非法 JSON 返回 400，JSON 为 `{ "error": "A non-empty title is required" }`，不能创建便签。
- 合法 POST 返回 201，以及 `{ id, title }`；保存和返回的标题去掉前后空格。`id` 是非空字符串，后续 GET 可以读到新便签。
- 所有这些 API 响应都有 `x-eval-app: evjs-eval`，包括拒绝请求、自动 OPTIONS 和 405；只有成功 POST 带 `x-note-validated: true`。
- GET、自动 HEAD、自动 OPTIONS、未支持的 DELETE 都不应执行 POST 的鉴权或 JSON 校验。HEAD 返回空响应体；OPTIONS 为 204，DELETE 为 405，二者的 Allow 都反映本接口支持的方法。
- `/api/health` 仍公开返回 `{ "ok": true }`，且不受写入校验影响。

使用 evjs 当前公开的 HTTP 方法中间件组合方式，把可复用的写入策略留在普通源码模块中；让框架继续提供默认 HEAD、OPTIONS 和 405 行为。不要添加额外 HTTP 服务或修改依赖。
