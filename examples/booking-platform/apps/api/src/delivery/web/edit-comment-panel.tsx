import { type FormEvent, useState } from "react";
import type { Member } from "./session.js";
import { useCall } from "./use-call.js";

type Props = Readonly<{ member: Member }>;

export function EditCommentPanel({ member }: Props) {
  const [id, setId] = useState("");
  const [body, setBody] = useState("Changed by me.");
  const [edited, setEdited] = useState<string | null>(null);
  const { problem, run } = useCall();

  const edit = (event: FormEvent) => {
    // Any id goes, yours or not: the server decides, not this screen.
    event.preventDefault();
    setEdited(null);
    run(
      () => member.editComment({ id: id.trim(), body }),
      (comment) => setEdited(`Edited ${comment.id}: ${comment.body}`),
    );
  };

  return (
    <section>
      <h2>4. Edit a comment by id</h2>
      <form onSubmit={edit}>
        <label>
          Comment id <input value={id} onChange={(event) => setId(event.target.value)} />
        </label>
        <label>
          New text <input value={body} onChange={(event) => setBody(event.target.value)} />
        </label>
        <button type="submit">Edit</button>
      </form>
      {edited !== null && <p className="done">{edited}</p>}
      {problem !== null && <p className="problem">{problem}</p>}
    </section>
  );
}
