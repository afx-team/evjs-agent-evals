---
name: evjs-core
description: Develop, migrate, and debug applications using the @evjs/ev core framework. Use for file-based Pages, navigation, page metadata, HTTP routes, middleware, and server functions. This is not the @alipay/evjs facade.
---

# EVJS core development

Use the version-matched public documentation in `.evjs-docs/`. Start with
`project-structure.md` and follow the guide for the current task:

- Pages and navigation: `client-routes.md`, `file-conventions.md`.
- Configuration and metadata: `config.md`, `rendering.md`.
- HTTP APIs and middleware: `server-routes.md`.
- Server functions and queries: `server-functions.md`.
- Build and diagnostics: `build.md`, `dev.md`.

Read the relevant guide before selecting an API. Inspect the existing app and
its package manifest. Use the installed version's public authoring entries.
Use `npm run inspect` to diagnose discovery and configuration, then run the
application's build and type checks. Preserve existing behavior when fixing or
extending the app. Do not modify dependency manifests, generated output, or the
evaluation tooling.
