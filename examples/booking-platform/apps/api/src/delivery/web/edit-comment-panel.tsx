import type { Comment } from "@house-rules/comments/contract";
import { PencilIcon, Trash2Icon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "./components/ui/button.js";
import { Input } from "./components/ui/input.js";
import { ProblemAlert } from "./problem-alert.js";
import { clockAt, type Member } from "./session.js";
import { useCall } from "./use-call.js";

type Props = Readonly<{
  member: Member;
  comment: Comment;
  mine: boolean;
  onChanged: () => void;
}>;

export function EditCommentPanel({ member, comment, mine, onChanged }: Props) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(comment.body);
  const { problem, run } = useCall();

  const save = (event: FormEvent) => {
    event.preventDefault();
    run(
      () => member.editComment({ id: comment.id, body }),
      () => {
        setEditing(false);
        onChanged();
      },
    );
  };

  const remove = () => run(() => member.removeComment({ id: comment.id }), onChanged);

  const when = clockAt(comment.editedAt ?? comment.createdAt);
  const byline = `${mine ? "You" : "Someone else"} · ${comment.editedAt === undefined ? "" : "edited "}${when}`;

  return (
    <li className="grid gap-2 rounded-md border p-3">
      {editing ? (
        <form className="flex gap-2" onSubmit={save}>
          <Input
            aria-label="Comment text"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            required
          />
          <Button type="submit">Save</Button>
          <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <p className="text-sm">{comment.body}</p>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{byline}</span>
        {mine && !editing && (
          <span className="flex gap-1">
            <Button variant="ghost" size="icon" aria-label="Edit" onClick={() => setEditing(true)}>
              <PencilIcon />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Remove" onClick={remove}>
              <Trash2Icon />
            </Button>
          </span>
        )}
      </div>
      <ProblemAlert problem={problem} />
    </li>
  );
}
