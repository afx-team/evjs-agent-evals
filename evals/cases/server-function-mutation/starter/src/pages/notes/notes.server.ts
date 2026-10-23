"use server";

import { ServerError } from "@evjs/ev/server-context";

const notes = [{ id: "welcome", title: "欢迎", body: "第一条便签" }];

export async function getNotes() {
  return notes;
}

export async function createNote(title: string, body: string) {
  if (
    typeof title !== "string" ||
    typeof body !== "string" ||
    !title.trim() ||
    !body.trim()
  ) {
    throw new ServerError("标题和内容不能为空", { status: 400 });
  }
  const note = {
    id: crypto.randomUUID(),
    title: title.trim(),
    body: body.trim(),
  };
  notes.push(note);
  return note;
}
