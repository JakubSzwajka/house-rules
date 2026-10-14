import { BookingPermissions } from "@example/bookings";
import { expect, it } from "@effect/vitest";
import { Actor, ActorId, type Permission } from "@house-rules/domain";
import { Approval, call, composition, CurrentActor, Grant } from "@house-rules/application";
import { Context, Effect, type Layer } from "effect";
import { memoryAppLayer } from "../../composition/app-layer.js";
import { bookingViews } from "../../composition/views.js";
import { bookBooking } from "../book-booking.js";
import { cancelBooking } from "../cancel-booking.js";
import { showBooking } from "../show-booking.js";

const actorA = Actor.make({ id: ActorId.make("actor-a") });
const actorB = Actor.make({ id: ActorId.make("actor-b") });
const member = [BookingPermissions.read, BookingPermissions.write, BookingPermissions.cancel];

const callerFor =
  (actor: Actor, permissions: ReadonlyArray<Permission> = member) =>
  () =>
    Effect.succeed(
      Context.make(CurrentActor, actor).pipe(
        Context.add(Grant, Grant.fromPermissions(permissions)),
      ),
    );
const incoming = { headers: new Headers(), url: "https://hosti.example" };

const fresh = Effect.acquireRelease(
  Effect.sync(() =>
    composition({ layer: memoryAppLayer(), caller: callerFor(actorA), views: bookingViews }),
  ),
  (app) => Effect.promise(() => app.dispose()),
);

it.effect("A books, B cannot cancel it, a denied approval keeps it, A cancels it once", () =>
  Effect.gen(function* lifecycle() {
    const app = yield* fresh;
    const asB = { caller: callerFor(actorB) };
    const allow = { approval: Approval.allowAll };
    const show = () => Effect.promise(() => call(app, showBooking, { id: "b-1" }, incoming));
    const cancel = (approval: Layer.Layer<Approval>, caller = callerFor(actorA)) =>
      Effect.promise(() => call(app, cancelBooking, { id: "b-1" }, incoming, { caller, approval }));

    const booked = yield* Effect.promise(() =>
      call(app, bookBooking, { id: "b-1", guestName: "Ada" }, incoming),
    );
    expect(booked).toEqual({
      ok: true,
      value: { id: "b-1", guestName: "Ada", status: "active" },
    });

    const taken = yield* Effect.promise(() =>
      call(app, bookBooking, { id: "b-1", guestName: "Grace" }, incoming, asB),
    );
    expect(taken.ok).toBe(false);
    if (!taken.ok) expect(taken.view.status).toBe(409);

    // B's cancel answers exactly like a booking that does not exist.
    const missing = yield* Effect.promise(() =>
      call(app, cancelBooking, { id: "nobody" }, incoming, allow),
    );
    const byB = yield* cancel(Approval.allowAll, callerFor(actorB));
    expect(byB.ok).toBe(false);
    expect(missing.ok).toBe(false);
    if (!byB.ok && !missing.ok) {
      expect(byB.error?._tag).toBe("BookingNotFound");
      expect(byB.view.status).toBe(404);
      expect(byB.view.body).toEqual({
        error: { code: "not_found", message: "Booking b-1 was not found." },
      });
      expect(missing.view.status).toBe(byB.view.status);
    }

    const denied = yield* cancel(Approval.denyAll);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error?._tag).toBe("ApprovalDenied");
    expect(yield* show()).toMatchObject({ ok: true, value: { status: "active" } });

    const cancelled = yield* cancel(Approval.allowAll);
    expect(cancelled).toEqual({
      ok: true,
      value: { id: "b-1", guestName: "Ada", status: "cancelled" },
    });
    expect(yield* show()).toMatchObject({ ok: true, value: { status: "cancelled" } });

    const again = yield* cancel(Approval.allowAll);
    expect(again.ok).toBe(false);
    if (!again.ok) {
      expect(again.error?._tag).toBe("BookingAlreadyCancelled");
      expect(again.view.status).toBe(409);
    }
  }).pipe(Effect.scoped),
);

it.effect("the Grant runs first: without bookings:cancel nothing is asked or read", () =>
  Effect.gen(function* grantFirst() {
    const app = yield* fresh;
    yield* Effect.promise(() => call(app, bookBooking, { id: "b-2", guestName: "Ada" }, incoming));
    const reader = { caller: callerFor(actorA, [BookingPermissions.read]) };
    for (const id of ["b-2", "nobody"]) {
      const forbidden = yield* Effect.promise(() =>
        call(app, cancelBooking, { id }, incoming, { ...reader, approval: Approval.allowAll }),
      );
      expect(forbidden.ok).toBe(false);
      if (!forbidden.ok) expect(forbidden.error?._tag).toBe("Forbidden");
    }
    const booked = yield* Effect.promise(() =>
      call(app, bookBooking, { id: "b-3", guestName: "Ada" }, incoming, reader),
    );
    expect(booked.ok).toBe(false);
    if (!booked.ok) expect(booked.error?._tag).toBe("Forbidden");
  }).pipe(Effect.scoped),
);

it("book is a transactional write; cancel is destructive, transactional and needs approval", () => {
  expect(bookBooking.contract).toMatchObject({
    name: "book_booking",
    permission: "bookings:write",
    transactional: true,
    needsApproval: false,
    annotations: { readOnly: false, destructive: false },
  });
  expect(cancelBooking.contract).toMatchObject({
    name: "cancel_booking",
    permission: "bookings:cancel",
    transactional: true,
    needsApproval: true,
    annotations: { readOnly: false, destructive: true },
  });
});
