import type { PublicBooking } from "@example/bookings/contract";
import type { Comment } from "@house-rules/comments/contract";
import type { Person } from "@house-rules/party/contract";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Button } from "./components/ui/button.js";
import { Input } from "./components/ui/input.js";
import { Label } from "./components/ui/label.js";
import { Separator } from "./components/ui/separator.js";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "./components/ui/sheet.js";
import { EditCommentPanel } from "./edit-comment-panel.js";
import { ProblemAlert } from "./problem-alert.js";
import type { Member } from "./session.js";
import { StatusBadge } from "./status-badge.js";
import { useCall } from "./use-call.js";

type Props = Readonly<{
  member: Member;
  me: Person;
  bookingId: string | null;
  onClose: () => void;
}>;

const target = (bookingIdOf: string) => ({ kind: "booking", id: bookingIdOf });

export function BookingPanel({ member, me, bookingId, onClose }: Props) {
  return (
    <Sheet open={bookingId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent>
        {bookingId !== null && (
          <BookingDetail key={bookingId} member={member} me={me} id={bookingId} />
        )}
      </SheetContent>
    </Sheet>
  );
}

type DetailProps = Readonly<{ member: Member; me: Person; id: string }>;

function BookingDetail({ member, me, id }: DetailProps) {
  const [booking, setBooking] = useState<PublicBooking | null>(null);
  const [comments, setComments] = useState<ReadonlyArray<Comment> | null>(null);
  const [draft, setDraft] = useState("");
  const { problem, run } = useCall();

  const listComments = useCallback(
    () =>
      run(
        () => member.listComments({ target: target(id), page: { size: 50 } }),
        (list) => setComments(list.items),
      ),
    [member, run, id],
  );

  useEffect(() => {
    run(
      () => member.showBooking({ id }),
      (found) => {
        setBooking(found);
        listComments();
      },
    );
  }, [member, run, id, listComments]);

  const add = (event: FormEvent) => {
    event.preventDefault();
    run(
      () => member.addComment({ target: target(id), body: draft }),
      () => {
        setDraft("");
        listComments();
      },
    );
  };

  return (
    <>
      <SheetHeader>
        <SheetTitle>{booking?.guestName ?? "Booking"}</SheetTitle>
        <SheetDescription>A stay you booked, and the notes on it.</SheetDescription>
        {booking !== null && (
          <div>
            <StatusBadge status={booking.status} />
          </div>
        )}
      </SheetHeader>
      <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto px-4 pb-4">
        <Separator />
        <h3 className="text-sm font-medium">Comments</h3>
        {comments?.length === 0 && (
          <p className="text-sm text-muted-foreground">No comments yet.</p>
        )}
        {comments !== null && comments.length > 0 && (
          <ul className="grid gap-3">
            {comments.map((comment) => (
              <EditCommentPanel
                key={comment.id}
                member={member}
                comment={comment}
                mine={comment.authorId === me.id}
                onChanged={listComments}
              />
            ))}
          </ul>
        )}
        {booking !== null && (
          <form className="grid gap-2" onSubmit={add}>
            <Label htmlFor="comment-draft">Add a comment</Label>
            <div className="flex gap-2">
              <Input
                id="comment-draft"
                placeholder="Late check-in, around 22:00."
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                required
              />
              <Button type="submit">Add</Button>
            </div>
          </form>
        )}
        <ProblemAlert problem={problem} />
      </div>
    </>
  );
}
