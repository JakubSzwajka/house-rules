import { type FormEvent, useState } from "react";
import { Button } from "./components/ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card.js";
import { Input } from "./components/ui/input.js";
import { Label } from "./components/ui/label.js";
import { ProblemAlert } from "./problem-alert.js";
import { type Member, newBookingId } from "./session.js";
import { useCall } from "./use-call.js";

type Props = Readonly<{ member: Member; onBooked: (id: string) => void }>;

export function BookPanel({ member, onBooked }: Props) {
  const [guestName, setGuestName] = useState("");
  const [booked, setBooked] = useState<string | null>(null);
  const { problem, run } = useCall();

  const book = (event: FormEvent) => {
    event.preventDefault();
    setBooked(null);
    run(
      () => member.bookBooking({ id: newBookingId(), guestName: guestName.trim() }),
      (booking) => {
        setBooked(`Booked a stay for ${booking.guestName}.`);
        setGuestName("");
        onBooked(booking.id);
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>New booking</CardTitle>
        <CardDescription>Who is staying?</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4">
          <form className="flex items-end gap-2" onSubmit={book}>
            <div className="grid flex-1 gap-2">
              <Label htmlFor="guest-name">Guest name</Label>
              <Input
                id="guest-name"
                placeholder="Ada Lovelace"
                value={guestName}
                onChange={(event) => setGuestName(event.target.value)}
                required
              />
            </div>
            <Button type="submit">Book</Button>
          </form>
          {booked !== null && (
            <p role="status" className="text-sm text-muted-foreground">
              {booked}
            </p>
          )}
          <ProblemAlert problem={problem} />
        </div>
      </CardContent>
    </Card>
  );
}
