import type { Person } from "@house-rules/party/contract";
import { useMemo, useRef, useState } from "react";
import { BookPanel } from "./book-panel.js";
import { BookingPanel } from "./booking-panel.js";
import { EditCommentPanel } from "./edit-comment-panel.js";
import { RequestLog } from "./request-log.js";
import { clientsFor, clockNow, type LoggedCall } from "./session.js";
import { SignInPanel } from "./sign-in-panel.js";

export function App() {
  const token = useRef<string | undefined>(undefined);
  const counter = useRef(0);
  const [calls, setCalls] = useState<ReadonlyArray<LoggedCall>>([]);
  const [me, setMe] = useState<Person | null>(null);
  const [bookingId, setBookingId] = useState("b-1");

  const clients = useMemo(
    () =>
      clientsFor(
        () => token.current,
        (entry) => {
          counter.current += 1;
          const logged = { ...entry, at: clockNow(), key: counter.current };
          setCalls((previous) => [logged, ...previous].slice(0, 200));
        },
      ),
    [],
  );

  return (
    <main>
      <header>
        <h1>Booking example</h1>
        <p>The booking example, end to end: dev sign-in, a Person, bookings and comments.</p>
      </header>
      <div className="columns">
        <div className="screens">
          <SignInPanel
            clients={clients}
            me={me}
            onToken={(value) => {
              token.current = value;
            }}
            onMe={setMe}
          />
          {me !== null && (
            <>
              <BookPanel member={clients.member} onBooked={setBookingId} />
              <BookingPanel
                key={`${me.id}/${bookingId}`}
                member={clients.member}
                me={me}
                bookingId={bookingId}
              />
              <EditCommentPanel member={clients.member} />
            </>
          )}
        </div>
        <RequestLog calls={calls} onClear={() => setCalls([])} />
      </div>
    </main>
  );
}
