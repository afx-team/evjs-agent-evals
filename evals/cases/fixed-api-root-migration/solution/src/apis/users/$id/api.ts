import type { RouteHandlerFn } from "@evjs/ev/api";
import { findUser } from "../users-store";

export const GET: RouteHandlerFn<"/users/:id"> = (_req, ctx) => {
  const id = ctx.req.param("id");
  const user = findUser(id);
  return user
    ? Response.json(user)
    : Response.json({ error: "User not found", id }, { status: 404 });
};
