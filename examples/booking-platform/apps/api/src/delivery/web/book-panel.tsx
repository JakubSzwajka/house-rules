import { type FormEvent, useState } from "react";
import type { Member } from "./session.js";
import { useCall } from "./use-call.js";

type Props = Readonly<{ member: Member; onBooked: (id: string) => void }>;

export function BookPanel({ member, onBooked }: Props) {
  const [id, setId] = useState("b-1");
  const [guestName, setGuestName] = useState("Ada");
  const [booked, setBooked] = useState<string | null>(null);
  const { problem, run } = useCall();

  const book = (event: FormEvent) => {
    event.preventDefault();
    run(
      () => member.bookBooking({ id: id.trim(), guestName: guestName.trim() }),
      (booking) => {
        setBooked(`Booked ${booking.id} for ${booking.guestName}: ${booking.status}.`);
        onBooked(booking.id);
      },
    );
  };

  return (
    <section>
      <h2>2. Book a stay</h2>
      <form onSubmit={book}>
        <label>
          Booking id <input value={id} onChange={(event) => setId(event.target.value)} />
        </label>
        <label>
          Guest <input value={guestName} onChange={(event) => setGuestName(event.target.value)} />
        </label>
        <button type="submit">Book</button>
      </form>
      {booked !== null && <p className="done">{booked}</p>}
      {problem !== null && <p className="problem">{problem}</p>}
    </section>
  );
}
