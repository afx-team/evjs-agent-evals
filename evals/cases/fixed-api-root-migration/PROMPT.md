这个应用升级 evjs 后，原来放在 `src/endpoints` 的接口不再可用。当前工程仍保留旧的 `server.routing.dir` 设置。请迁移到当前版本支持的文件路由约定，让配置检查和应用构建成功，同时保持下面的对外 HTTP 契约。

- `GET /health?echo=<任意字符串>` 返回 `{ "ok": true, "echo": "<原始参数值>" }`；没有 echo 时返回空字符串。
- `GET /users/alice` 返回 `{ "id": "alice", "name": "Alice" }`；`bob` 对应 `Bob`。
- `GET /users/<不存在的ID>` 返回 404，以及 `{ "error": "User not found", "id": "<请求ID>" }`，不能返回首页或固定写死的ID。
- 这些 URL 没有额外的 `/api` 前缀；不要为了适配目录而改变公开 URL。
- 用户数据仍放在可导入的普通 helper 模块里，helper 不应变成独立 HTTP 接口。
- 首页继续显示 `EVJS eval`。移除已失效的配置和旧接口目录，使源码只保留当前使用的一份路由实现。

通过 evjs 自身的配置和文件约定完成迁移，不引入另外的服务器、重定向或中间件来模拟这些接口；不修改依赖。
