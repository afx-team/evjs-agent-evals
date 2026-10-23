import type { MiddlewareHandler } from "@evjs/ev/middleware";

const responseMetadata: MiddlewareHandler = async (ctx, next) => {
  await next();
  ctx.header("x-eval-app", "evjs-eval");
};

export default responseMetadata;
