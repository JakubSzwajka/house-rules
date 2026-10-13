import { afterAll, expect, it } from "@effect/vitest";
import { Context, Effect, Layer } from "effect";
import {
  type Admitted,
  call,
  composition,
  type Forbidden,
  route,
  toFetchHandler,
  toMcpHandler,
  tool,
  type View,
} from "../index.ts";
import {
  type BookingNotFound,
  Bookings,
  bearerCallerFor,
  findBookings,
  showBooking,
  type Viewer,
  views,
} from "./delivery-fixtures.ts";

const work = { calls: 0, callers: 0 };
const layer = Bookings.fromRecords([], work);
const bare = composition({ layer, caller: bearerCallerFor(work) });
const viewed = composition({ layer, caller: bearerCallerFor(work), views });
const incoming = { headers: new Headers(), url: "/" };
const handlers: Array<{ dispose: () => Promise<void> }> = [];
afterAll(() =>
  Promise.all(handlers.map((handler) => handler.dispose())).then(() =>
    Promise.all([bare.dispose(), viewed.dispose()]),
  ),
);

it("a mount with a view for every failure tag compiles", () => {
  handlers.push(toFetchHandler(viewed, { routes: [route(showBooking), route(findBookings)] }));
  handlers.push(
    toFetchHandler(bare, {
      routes: [route(showBooking)],
      views: { BookingNotFound: views.BookingNotFound },
    }),
  );
  expect(handlers).toHaveLength(2);
});

it("a missing view is a type error on every adapter", () => {
  handlers.push(
    // @ts-expect-error BookingNotFound has no view.
    toFetchHandler(bare, { routes: [route(showBooking)] }),
  );
  handlers.push(
    // @ts-expect-error BookingNotFound has no view.
    toMcpHandler(bare, {
      path: "/mcp",
      name: "test",
      version: "0",
      tools: [tool(showBooking, { title: "Show", idempotent: true, openWorld: false })],
    }),
  );
  const missing = () =>
    // @ts-expect-error BookingNotFound has no view.
    call(bare, showBooking, { id: "b-1" }, incoming);
  expect(typeof missing).toBe("function");
});

it("a capability without failures needs no app view", () => {
  handlers.push(toFetchHandler(bare, { routes: [route(findBookings)] }));
  expect(handlers.length).toBeGreaterThan(0);
});

it("a view whose error type does not match its tag is a type error", () => {
  const wrong = composition({
    layer,
    caller: bearerCallerFor(work),
    views: {
      BookingNotFound: (error: Forbidden): View => ({ status: 404, body: error.permission }),
    },
  });
  handlers.push(
    // @ts-expect-error The BookingNotFound view takes a Forbidden.
    toFetchHandler(wrong, { routes: [route(showBooking)] }),
  );
  handlers.push(wrong);
  expect(wrong._tag).toBe("Composition");
});

it("a service that neither the app, the caller nor the adapter provides is a type error", () => {
  const noBookings = composition({
    layer: Layer.empty,
    caller: () => Effect.succeed(Context.empty() as Context.Context<Viewer>),
    views,
  });
  handlers.push(
    // @ts-expect-error Bookings and Grant are missing.
    toFetchHandler(noBookings, { routes: [route(showBooking)] }),
  );
  handlers.push(noBookings);
  expect(noBookings._tag).toBe("Composition");
});

it("call() cannot take caller and admitted together", () => {
  const together = (admitted: Admitted) =>
    call(viewed, showBooking, { id: "b-1" }, incoming, {
      admitted,
      // @ts-expect-error A resolved caller and a caller cannot both be supplied.
      caller: bearerCallerFor(work),
    });
  expect(typeof together).toBe("function");
});

it("Admitted cannot be constructed by app code", () => {
  // @ts-expect-error The private brand cannot be supplied by consumers.
  const forged: Admitted = {};
  expect(forged).toEqual({});
});

it("views see the error and the caller with their own types", () => {
  const forbidden: (error: Forbidden, caller: Context.Context<Viewer> | undefined) => View =
    views.Forbidden;
  const notFound: (error: BookingNotFound) => View = views.BookingNotFound;
  expect([typeof forbidden, typeof notFound]).toEqual(["function", "function"]);
});
