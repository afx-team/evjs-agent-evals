import {
  getFnQueryKey,
  useMutation,
  useQuery,
  useQueryClient,
} from "@evjs/ev/query";
import { useState } from "react";
import { createNote, getNotes } from "./notes.server";

export default function NotesPage() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const queryClient = useQueryClient();
  const { data: notes = [], isLoading } = useQuery(getNotes);
  const save = useMutation(createNote, {
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: getFnQueryKey(getNotes),
      });
      setTitle("");
      setBody("");
    },
  });

  return (
    <section>
      <h2>便签</h2>
      {isLoading ? (
        <p>加载中</p>
      ) : (
        <ul aria-label="便签列表">
          {notes.map((note) => (
            <li key={note.id}>
              {note.title} / {note.body}
            </li>
          ))}
        </ul>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate([title, body]);
        }}
      >
        <label>
          标题
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          内容
          <input
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        </label>
        <button type="submit" disabled={save.isPending}>
          保存
        </button>
      </form>
      {save.error && <p role="alert">{save.error.message}</p>}
    </section>
  );
}
