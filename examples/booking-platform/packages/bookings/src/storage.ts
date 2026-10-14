import type { NoOpenUnit } from "@house-rules/domain";
import { Context, type Effect } from "effect";
import type { BookingStoreUnavailable } from "./booking/store-unavailable.js";
import type { Booking, BookingStatus } from "./booking/booking.js";

export class BookingStore extends Context.Service<
  BookingStore,
  {
    readonly find: (id: string) => Effect.Effect<Booking | undefined, BookingStoreUnavailable>;
    readonly insert: (
      booking: Booking,
    ) => Effect.Effect<boolean, BookingStoreUnavailable | NoOpenUnit>;
    readonly transition: (
      id: string,
      from: BookingStatus,
      to: BookingStatus,
    ) => Effect.Effect<boolean, BookingStoreUnavailable | NoOpenUnit>;
  }
>()("@example/bookings/BookingStore") {}
