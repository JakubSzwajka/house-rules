import {
  BookingPermissions,
  Bookings,
  BookingStore,
  BookingStoreUnavailable,
} from "@hosti/bookings";
import { afterAll, expect, it } from "@effect/vitest";
import { composition, Grant, toFetchHandler } from "@house-rules/application";
import { Context, Effect, Layer } from "effect";
import { bookingRoutes } from "../delivery/http/routes.js";
import { bookingViews } from "../composition/views.js";

const bookings = Bookings.fromRecords([
  { id: "b-1", guestName: "Ada", ownerId: "actor-a", status: "active" },
]);
const reader = Grant.layerFromPermissions([BookingPermissions.read]);
const brokenStore = Layer.succeed(BookingStore, {
  find: () =>
    Effect.fail(new BookingStoreUnavailable({ message: "The Booking could not be read." })),
  insert: () => Effect.die("not used"),
  transition: () => Effect.die("not used"),
});

const mountWith = (layer: Layer.Layer<Bookings | Grant>) => {
  const app = composition({
    layer,
    caller: () => Effect.succeed(Context.empty()),
    views: bookingViews,
  });
  const api = toFetchHandler(app, { prefix: "/api", routes: bookingRoutes });
  return { api, dispose: () => api.dispose().then(app.dispose) };
};

const open = mountWith(Layer.merge(bookings, reader));
const closed = mountWith(Layer.merge(bookings, Grant.denyAll));
const broken = mountWith(Layer.merge(Bookings.layer.pipe(Layer.provide(brokenStore)), reader));
afterAll(() => Promise.all([open, closed, broken].map((mount) => mount.dispose())));

const get = (api: (request: Request) => Promise<Response>, id: string) =>
  Effect.promise(() =>
    api(new Request(`https://hosti.example/api/bookings/${id}`) as Request),
  ).pipe(
    Effect.flatMap((response) =>
      Effect.promise((): Promise<unknown> => response.json()).pipe(
        Effect.map((body) => ({ status: response.status, body })),
      ),
    ),
  );

it.effect("answers 200 for a visitor without revealing the ownerId", () =>
  Effect.gen(function* answersOk() {
    expect(yield* get(open.api, "b-1")).toEqual({
      status: 200,
      body: { id: "b-1", guestName: "Ada", status: "active" },
    });
  }),
);

it.effect("maps BookingNotFound to 404", () =>
  Effect.gen(function* answersNotFound() {
    expect(yield* get(open.api, "missing")).toEqual({
      status: 404,
      body: { error: { code: "not_found", message: "Booking missing was not found." } },
    });
  }),
);

it.effect("maps Forbidden to 403 before it reads the booking", () =>
  Effect.gen(function* answersForbidden() {
    const forbidden = {
      status: 403,
      body: { error: { code: "forbidden", message: "You may not use show_booking." } },
    };
    expect(yield* get(closed.api, "b-1")).toEqual(forbidden);
    expect(yield* get(closed.api, "missing")).toEqual(forbidden);
  }),
);

it.effect("maps BookingStoreUnavailable to 503", () =>
  Effect.gen(function* answersUnavailable() {
    expect(yield* get(broken.api, "b-1")).toEqual({
      status: 503,
      body: { error: { code: "unavailable", message: "Bookings are unavailable right now." } },
    });
  }),
);
