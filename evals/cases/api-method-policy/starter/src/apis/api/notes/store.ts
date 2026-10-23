const notes = [{ id: "welcome", title: "欢迎" }];

export function listNotes() {
  return notes;
}

export function createNote(title: string) {
  const note = { id: crypto.randomUUID(), title };
  notes.push(note);
  return note;
}
