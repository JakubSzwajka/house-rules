import { type Actor, defineModule } from "@house-rules/domain";
import { Effect } from "effect";
import { MyBookingStore } from "./storage.ts";
import { type MyBooking, type ReadUnavailable, ReadCallerDenied } from "./booking/my-bookings.ts";

export class MyBookings extends defineModule<
  MyBookings,
  {
    readonly myBookings: (actor: Actor) => Effect.Effect<readonly MyBooking[], ReadUnavailable>;
  }
>()("@example/api/read-models/my-bookings/MyBookings", {
  make: Effect.gen(function* () {
    const store = yield* MyBookingStore;
    return { myBookings: (actor: Actor) => store.forPerson(actor.id) };
  }),
}) {}
