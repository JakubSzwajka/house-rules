import type { PublicBooking } from "@example/bookings/contract";
import { ChevronRightIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "./components/ui/button.js";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./components/ui/card.js";
import { ProblemAlert } from "./problem-alert.js";
import type { Member } from "./session.js";
import { StatusBadge } from "./status-badge.js";
import { useCall } from "./use-call.js";

type Props = Readonly<{ member: Member; onOpen: (id: string) => void }>;

export function MyBookingsPanel({ member, onOpen }: Props) {
  const [items, setItems] = useState<ReadonlyArray<PublicBooking> | null>(null);
  const { problem, run } = useCall();

  const refresh = useCallback(
    () =>
      run(
        () => member.listMyBookings({}),
        (list) => setItems(list.items),
      ),
    [member, run],
  );

  // The parent remounts this panel after each booking, so the list is fresh.
  useEffect(refresh, [refresh]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>My bookings</CardTitle>
        <CardDescription>Open one to see its comments.</CardDescription>
        <CardAction>
          <Button variant="ghost" size="icon" aria-label="Refresh" onClick={refresh}>
            <RefreshCwIcon />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2">
          {items?.length === 0 && (
            <p className="text-sm text-muted-foreground">No bookings yet. Book a stay above.</p>
          )}
          {items !== null && items.length > 0 && (
            <ul className="grid gap-2">
              {items.map((booking) => (
                <li key={booking.id}>
                  <Button
                    variant="outline"
                    className="w-full justify-between"
                    onClick={() => onOpen(booking.id)}
                  >
                    <span>{booking.guestName}</span>
                    <span className="flex items-center gap-2">
                      <StatusBadge status={booking.status} />
                      <ChevronRightIcon />
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <ProblemAlert problem={problem} />
        </div>
      </CardContent>
    </Card>
  );
}
