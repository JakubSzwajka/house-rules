import { Context, type Effect } from "effect";
import type { MyBooking, ReadUnavailable } from "./booking/my-bookings.ts";

export class MyBookingStore extends Context.Service<
  MyBookingStore,
  {
    readonly forPerson: (personId: string) => Effect.Effect<readonly MyBooking[], ReadUnavailable>;
  }
>()("@example/api/read-models/my-bookings/MyBookingStore") {}
