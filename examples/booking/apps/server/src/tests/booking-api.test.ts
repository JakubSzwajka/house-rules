import { platformForTests } from "@house-rules/domain-postgres";
import { BookingApi, BookingId } from "@example/booking-domain";
import { devTokens, PersonId, sessionClient } from "@house-rules/stack";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { DEV_TOKENS, everyoneIsMember } from "../auth.ts";
import { bookingLive } from "../booking-live.ts";

const World = bookingLive(devTokens(DEV_TOKENS)).pipe(Layer.provide(platformForTests));

const as = (token: string) => BookingApi.clientInProcess.pipe(Effect.provide(sessionClient(token)));

const paymentOf = (token: string, owner: string, bookingId: string, payment: string) =>
  Effect.gen(function* () {
    const client = yield* as(token);
    const seen = yield* client.MyBookings.watch(PersonId.make(owner)).pipe(
      Stream.map(({ state }) => state?.bookings.find((row) => row.bookingId === bookingId)),
      Stream.filter((row) => row?.payment === payment),
      Stream.runHead,
      Effect.timeout("5 seconds"),
    );
    return Option.getOrUndefined(seen);
  });

describe("BookingApi in memory, with Session, dev tokens and Roles", () => {
  it.live("a member books, is charged, cancels and is refunded", () =>
    Effect.gen(function* () {
      const ann = yield* as("ann-token");
      const id = BookingId.make("api-1");
      yield* ann.MakeBooking(id, { guestName: "Grace", amount: 100 });
      expect(yield* paymentOf("ann-token", "ann", id, "paid")).toMatchObject({ status: "active" });
      yield* ann.CancelBooking(id, {});
      expect(yield* paymentOf("ann-token", "ann", id, "refunded")).toMatchObject({
        status: "cancelled",
      });
    }).pipe(Effect.scoped, Effect.provide(World)),
  );

  it.live("a declined charge leaves the payment pending", () =>
    Effect.gen(function* () {
      const ann = yield* as("ann-token");
      const id = BookingId.make("api-2");
      yield* ann.MakeBooking(id, { guestName: "Hal", amount: 5_000 });
      expect(yield* paymentOf("ann-token", "ann", id, "pending")).toMatchObject({
        status: "active",
      });
    }).pipe(Effect.scoped, Effect.provide(World)),
  );

  it.live("an org admin cancels a colleague's organisation booking", () =>
    Effect.gen(function* () {
      const carol = yield* as("carol-token");
      const id = BookingId.make("api-3");
      yield* carol.MakeBooking(id, { guestName: "Ivy", amount: 80, orgId: "acme" });
      yield* paymentOf("carol-token", "carol", id, "paid");
      const ann = yield* as("ann-token");
      const refused = yield* ann.CancelBooking(id, {}).pipe(Effect.flip);
      expect(refused._tag).toBe("NotBookingOwner");
      const dave = yield* as("dave-token");
      yield* dave.CancelBooking(id, { reason: "duplicate" });
      expect(yield* paymentOf("carol-token", "carol", id, "refunded")).toMatchObject({
        status: "cancelled",
      });
    }).pipe(Effect.scoped, Effect.provide(World)),
  );

  it.live("refuses guests, strangers and other people's bookings", () =>
    Effect.gen(function* () {
      const gus = yield* as("gus-token");
      const forbidden = yield* gus
        .MakeBooking(BookingId.make("api-4"), { guestName: "Jo", amount: 10 })
        .pipe(Effect.flip);
      expect(forbidden).toMatchObject({ _tag: "Forbidden", permission: "bookings:make" });
      const stranger = yield* as("nope");
      const anonymous = yield* stranger
        .MakeBooking(BookingId.make("api-4"), { guestName: "Jo", amount: 10 })
        .pipe(Effect.flip);
      expect(anonymous._tag).toBe("Unauthenticated");
      const carol = yield* as("carol-token");
      const notYours = yield* carol.MyBookings.get(PersonId.make("ann")).pipe(Effect.flip);
      expect(notYours._tag).toBe("NotYourBookings");
    }).pipe(Effect.scoped, Effect.provide(World)),
  );

  it.live(
    "a signed-in person with no role is a member, as Clerk users without an organisation are",
    () =>
      Effect.gen(function* () {
        const nia = yield* as("nia-token");
        const done = yield* nia.MakeBooking(BookingId.make("api-5"), {
          guestName: "Lou",
          amount: 10,
        });
        expect(done.stream).toBe("Booking/api-5");
      }).pipe(
        Effect.scoped,
        Effect.provide(
          bookingLive(
            everyoneIsMember(
              devTokens({ "nia-token": { subject: "nia", orgId: null, roles: [] } }),
            ),
          ).pipe(Layer.provide(platformForTests)),
        ),
      ),
  );
});
