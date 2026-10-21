import type { NoOpenUnit } from "@house-rules/domain";
import { Context, type Effect } from "effect";
import type { Booking, BookingStatus, BookingStoreUnavailable } from "./booking/booking.ts";

export class BookingStore extends Context.Service<
  BookingStore,
  {
    readonly find: (id: string) => Effect.Effect<Booking | undefined, BookingStoreUnavailable>;
    readonly insert: (
      booking: Booking,
    ) => Effect.Effect<boolean, BookingStoreUnavailable | NoOpenUnit>;
    readonly transition: (
      id: string,
      ownerId: string,
      from: BookingStatus,
      to: BookingStatus,
    ) => Effect.Effect<boolean, BookingStoreUnavailable | NoOpenUnit>;
  }
>()("@example/api/modules/bookings/BookingStore") {}
