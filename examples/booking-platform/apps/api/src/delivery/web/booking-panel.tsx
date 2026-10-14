import type { PublicBooking } from "@example/bookings/contract";
import type { Comment } from "@house-rules/comments/contract";
import type { Person } from "@house-rules/party/contract";
import { type FormEvent, useState } from "react";
import type { Member } from "./session.js";
import { useCall } from "./use-call.js";

type Props = Readonly<{ member: Member; me: Person; bookingId: string }>;

export function BookingPanel({ member, me, bookingId }: Props) {
  const [id, setId] = useState(bookingId);
  const [booking, setBooking] = useState<PublicBooking | null>(null);
  const [comments, setComments] = useState<ReadonlyArray<Comment> | null>(null);
  const [draft, setDraft] = useState("Late check-in, around 22:00.");
  const { problem, run } = useCall();

  const target = (bookingIdOf: string) => ({ kind: "booking", id: bookingIdOf });

  const listFor = (bookingIdOf: string) =>
    run(
      () => member.listComments({ target: target(bookingIdOf), page: { size: 20 } }),
      (list) => setComments(list.items),
    );

  const open = (event: FormEvent) => {
    event.preventDefault();
    setBooking(null);
    setComments(null);
    run(
      () => member.showBooking({ id: id.trim() }),
      (found) => {
        setBooking(found);
        listFor(found.id);
      },
    );
  };

  const add = (event: FormEvent) => {
    event.preventDefault();
    if (booking === null) return;
    run(
      () => member.addComment({ target: target(booking.id), body: draft }),
      () => listFor(booking.id),
    );
  };

  const remove = (comment: Comment) =>
    run(
      () => member.removeComment({ id: comment.id }),
      () => listFor(comment.target.id),
    );

  return (
    <section>
      <h2>3. Open a booking and its comments</h2>
      <form onSubmit={open}>
        <label>
          Booking id <input value={id} onChange={(event) => setId(event.target.value)} />
        </label>
        <button type="submit">Open</button>
      </form>
      {booking !== null && (
        <div>
          <p>
            <strong>{booking.id}</strong>: {booking.guestName}, {booking.status}
          </p>
          {comments !== null && (
            <ul className="comments">
              {comments.map((comment) => (
                <li key={comment.id}>
                  <span>{comment.body}</span>
                  <small>
                    {comment.authorId === me.id ? "you" : comment.authorId} · id{" "}
                    <code>{comment.id}</code>
                  </small>
                  {comment.authorId === me.id && (
                    <button type="button" onClick={() => remove(comment)}>
                      Remove
                    </button>
                  )}
                </li>
              ))}
              {comments.length === 0 && <li className="empty">No comments yet.</li>}
            </ul>
          )}
          <form onSubmit={add}>
            <label>
              Comment <input value={draft} onChange={(event) => setDraft(event.target.value)} />
            </label>
            <button type="submit">Add comment</button>
          </form>
        </div>
      )}
      {problem !== null && <p className="problem">{problem}</p>}
    </section>
  );
}
