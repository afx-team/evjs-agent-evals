# 新增可导航的 About 页面

这个 evjs SPA 目前只有首页。请新增 `/about` 页面，页面主标题为 `About evjs`，并展示已经准备好的 `src/pages/about/components/index.tsx` 组件及其文案。

首页保留 `EVJS eval` 标题，新增名为 `About` 的站内链接；About 页面提供名为 `Home` 的站内链接。页面之间应使用 SPA 导航，直接打开或刷新 `/about` 也应正常显示。

使用 evjs 的文件式页面约定。保留 About 目录内现有组件和内容文件，它们只是页面辅助代码，不能成为独立页面。访问 `/about/components` 时应保持未找到页面的状态，不能显示 About 页或辅助组件内容；框架内置的 `Not Found` 提示即可。保留现有首页与站内导航行为。
