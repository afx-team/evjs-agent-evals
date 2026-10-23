import type { MiddlewareHandler } from "@evjs/ev/middleware";

export const requireWriter: MiddlewareHandler = async (ctx, next) => {
  if (ctx.req.header("x-writer") !== "enabled") {
    return ctx.json({ error: "Writer access required" }, 401);
  }
  await next();
};

export const validateNote: MiddlewareHandler = async (ctx, next) => {
  let value: unknown;
  try {
    value = await ctx.req.json();
  } catch {
    return ctx.json({ error: "A non-empty title is required" }, 400);
  }
  if (
    !value ||
    typeof value !== "object" ||
    !("title" in value) ||
    typeof value.title !== "string" ||
    !value.title.trim()
  ) {
    return ctx.json({ error: "A non-empty title is required" }, 400);
  }
  await next();
  ctx.header("x-note-validated", "true");
};
