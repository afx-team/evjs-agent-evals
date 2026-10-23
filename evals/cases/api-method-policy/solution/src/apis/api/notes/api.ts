import { withMiddlewares } from "@evjs/ev/api";
import { requireWriter, validateNote } from "./policies";
import { createNote, listNotes } from "./store";

export const GET = () => Response.json(listNotes());

export const POST = withMiddlewares(
  async (_req, ctx) => {
    const { title } = await ctx.req.json<{ title: string }>();
    return Response.json(createNote(title.trim()), { status: 201 });
  },
  [requireWriter, validateNote],
);
