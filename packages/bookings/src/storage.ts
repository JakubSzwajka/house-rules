import type { NoOpenUnit } from "@house-rules/capability";
import { Context, type Effect } from "effect";
import type { BookingStoreUnavailable } from "./store-unavailable.js";
import type { Booking } from "./types.js";

export class BookingStore extends Context.Service<
  BookingStore,
  {
    readonly find: (id: string) => Effect.Effect<Booking | undefined, BookingStoreUnavailable>;
    readonly insert: (
      booking: Booking,
    ) => Effect.Effect<boolean, BookingStoreUnavailable | NoOpenUnit>;
  }
>()("@hosti/bookings/BookingStore") {}
