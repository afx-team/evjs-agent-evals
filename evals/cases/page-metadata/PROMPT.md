# 修复页面静态元数据

首页与 About 页面已经可以使用 SPA 导航，但浏览器标题和描述还是旧值。请用 evjs 的页面静态配置完成以下修改：

| 页面 | title | description | keywords | theme-color |
| --- | --- | --- | --- | --- |
| `/` | `Task Desk` | `Organize everyday work.` | `tasks,work` | `#ffffff` |
| `/about` | `About Task Desk` | `About our task workspace.` | 不设置 | `#123456` |

About 的 `keywords` 应不存在，不能沿用首页值。HTML 模板的 `viewport` 和默认 `theme-color: #ffffff` 需要保留，首页应使用这个默认主题色。每种命名 meta 和 title 只能有一份。

直接打开、刷新、站内来回切换、浏览器前进后退时，页面元数据都要和当前页面一致。保留两个页面现有的正文标题、`Home` / `About` 链接和 SPA 导航行为，不要在页面组件里手动操作 `document.head` 或 `document.title`。
