import { listMyActivityContract } from "@example/activity/contract";
import type { Person } from "@house-rules/party/contract";
import { useEffect, useMemo, useState } from "react";
import { AccountPanel } from "./account-panel.js";
import { AuditDock } from "./audit-dock.js";
import { BookPanel } from "./book-panel.js";
import { BookingPanel } from "./booking-panel.js";
import { Button } from "./components/ui/button.js";
import { MyBookingsPanel } from "./my-bookings-panel.js";
import { ProblemAlert } from "./problem-alert.js";
import { ProfilePanel } from "./profile-panel.js";
import { clientsFor } from "./session.js";
import { useCall } from "./use-call.js";

export function App() {
  const [pageCalls, setPageCalls] = useState(0);
  const [me, setMe] = useState<Person | null>(null);
  // The cookie is the only session, so the page asks the server who it is before it draws a card.
  const [restoring, setRestoring] = useState(true);
  const [opened, setOpened] = useState<string | null>(null);
  const [bookings, setBookings] = useState(0);

  const clients = useMemo(
    () =>
      clientsFor((entry) => {
        // The dock's own read would otherwise ask again after every answer, forever.
        if (entry.name !== listMyActivityContract.name) setPageCalls((count) => count + 1);
      }),
    [],
  );

  useEffect(() => {
    let current = true;
    clients.member
      .showMe({})
      .then(
        (person) => {
          if (current) setMe(person);
        },
        // A 401 means no session. Any other failure also leaves the sign-in card, which can retry.
        () => undefined,
      )
      .finally(() => {
        if (current) setRestoring(false);
      });
    return () => {
      current = false;
    };
  }, [clients]);

  const signOutCall = useCall();

  const signOut = () => {
    // On a failure the cookie may still be live, so only a successful sign-out clears the person.
    signOutCall.run(
      () => clients.accounts.signOut({}),
      () => {
        setOpened(null);
        setMe(null);
      },
    );
  };

  const log = (
    <AuditDock
      key={me?.id ?? "signed-out"}
      member={me === null ? null : clients.member}
      pageCalls={pageCalls}
    />
  );

  if (restoring) {
    return (
      <div className="flex min-h-svh flex-col">
        <main className="flex flex-1 items-center justify-center p-6">
          <h1 className="sr-only">Stays</h1>
          <p role="status" className="text-sm text-muted-foreground">
            Loading…
          </p>
        </main>
        {log}
      </div>
    );
  }

  if (me === null) {
    return (
      <div className="flex min-h-svh flex-col">
        <main className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
          <h1 className="sr-only">Stays</h1>
          <AccountPanel clients={clients} onMe={setMe} />
        </main>
        {log}
      </div>
    );
  }

  return (
    <div className="min-h-svh">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-3">
          <h1 className="font-semibold">Stays</h1>
          <ProfilePanel member={clients.member} me={me} onMe={setMe} onSignOut={signOut} />
        </div>
      </header>
      {signOutCall.problem !== null && (
        <div className="mx-auto grid max-w-5xl gap-3 px-6 pt-6">
          <ProblemAlert problem={signOutCall.problem} />
          <div>
            <Button variant="outline" size="sm" onClick={signOut}>
              Try signing out again
            </Button>
          </div>
        </div>
      )}
      <main className="mx-auto grid max-w-5xl gap-6 p-6 md:grid-cols-2">
        <BookPanel member={clients.member} onBooked={() => setBookings((count) => count + 1)} />
        <MyBookingsPanel key={`${me.id}/${bookings}`} member={clients.member} onOpen={setOpened} />
      </main>
      {log}
      <BookingPanel
        member={clients.member}
        me={me}
        bookingId={opened}
        onClose={() => setOpened(null)}
      />
    </div>
  );
}
