import type { RouteHandlerFn } from "@evjs/ev/api";
import { createNote, listNotes } from "./store";

export const GET = () => Response.json(listNotes());

export const POST: RouteHandlerFn = async (req) => {
  const { title } = (await req.json()) as { title: string };
  return Response.json(createNote(title.trim()), { status: 201 });
};
