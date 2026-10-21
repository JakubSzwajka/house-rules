import { featureFixture } from "./feature-fixtures.ts";
import { defineOperation, type Permission } from "@house-rules/domain";
import { Effect, Layer, Logger, References, Schema } from "effect";
import {
  composition,
  defineWay,
  endpoint,
  May,
  Mean,
  protectedResource,
  toFetchHandler,
  type Endpoint,
  type CorsOptions,
  type SessionOptions,
} from "../index.ts";
import { bearerWhoFor, sessionWhoFor } from "./delivery-auth-fixtures.ts";
export { bearerWhoFor, sessionWhoFor, metadataUrl } from "./delivery-auth-fixtures.ts";
import { bindFixture, fixtureLayer } from "./execution-fixtures.ts";
import {
  type Actor,
  Booking,
  BookingNotFound,
  Bookings,
  type Work,
} from "./delivery-bookings-fixtures.ts";
export {
  type Actor,
  Booking,
  BookingNotFound,
  Bookings,
  Requester,
  type Work,
} from "./delivery-bookings-fixtures.ts";

const viewerOf = (id: string): Actor => ({ userId: id, scope: "write" });
export const showBooking = bindFixture(
  featureFixture(
    defineOperation("show_booking", {
      description: "Show one booking by its id.",
      input: Schema.Struct({ id: Schema.String }),
      output: Booking,
      failure: BookingNotFound,
      permission: "bookings:read",
      readOnly: true,
    }),
  ),
  ({ id }, scope) =>
    Effect.gen(function* () {
      const bookings = yield* Bookings;
      if (scope.caller.kind !== "person") return yield* new BookingNotFound({ id });
      return yield* bookings.get(viewerOf(scope.caller.actor.id), id);
    }),
);
export const findBookings = bindFixture(
  featureFixture(
    defineOperation("find_bookings", {
      description: "Find your bookings by guest name, or by a minimum number of nights.",
      input: Schema.Union([
        Schema.Struct({ by: Schema.Literal("guest"), guest: Schema.String }),
        Schema.Struct({ by: Schema.Literal("nights"), minNights: Schema.Int }),
      ]),
      output: Schema.Struct({ bookings: Schema.Array(Booking) }),
      failure: Schema.Never,
      permission: "bookings:read",
      readOnly: true,
    }),
  ),
  (input, scope) =>
    Effect.gen(function* () {
      const bookings = yield* Bookings;
      if (scope.caller.kind !== "person") return { bookings: [] };
      return {
        bookings: yield* bookings.find(
          viewerOf(scope.caller.actor.id),
          input.by === "guest" ? { guest: input.guest } : { minNights: input.minNights },
        ),
      };
    }),
);
export const cancelBooking = bindFixture(
  featureFixture(
    defineOperation("cancel_booking", {
      description: "Cancel one of your bookings.",
      input: Schema.Struct({ id: Schema.String }),
      output: Schema.Struct({ cancelled: Schema.String }),
      failure: BookingNotFound,
      permission: "bookings:write",
      needsApproval: true,
      destructive: true,
    }),
  ),
  ({ id }, scope) =>
    Effect.gen(function* () {
      const bookings = yield* Bookings;
      if (scope.caller.kind !== "person") return yield* new BookingNotFound({ id });
      yield* bookings.cancel(viewerOf(scope.caller.actor.id), id);
      return { cancelled: id };
    }),
);
export const renameGuest = bindFixture(
  featureFixture(
    defineOperation("rename_guest", {
      description: "Rename the guest on one of your bookings.",
      input: Schema.Struct({ id: Schema.String, guestName: Schema.String }),
      output: Schema.Struct({ id: Schema.String }),
      failure: BookingNotFound,
      permission: "bookings:write",
    }),
  ),
  ({ id }, scope) =>
    Effect.gen(function* () {
      const bookings = yield* Bookings;
      if (scope.caller.kind !== "person") return yield* new BookingNotFound({ id });
      yield* bookings.get(viewerOf(scope.caller.actor.id), id);
      return { id };
    }),
);
export const crash = bindFixture(
  featureFixture(
    defineOperation("crash", {
      description: "Dies to show the defect response.",
      input: Schema.Struct({}),
      output: Schema.Struct({}),
      failure: Schema.Never,
      permission: null,
    }),
  ),
  () => Effect.die("a bug in the handler"),
);
export const features = [showBooking, findBookings, cancelBooking, renameGuest, crash] as const;
const permissions: readonly Permission[] = ["bookings:read", "bookings:write"];
export const overrides = {
  BookingNotFound: (error: BookingNotFound) => `Booking ${error.id} was not found.`,
};
export type LogLine = Readonly<{
  message: unknown;
  annotations: Readonly<Record<string, unknown>>;
}>;
type HttpFixtureOptions = Readonly<{
  path?: `/${string}`;
  endpoints?: readonly Endpoint[];
  who?: "bearer" | "session";
  cors?: CorsOptions;
  origins?: readonly string[];
  session?: SessionOptions;
  maxBodyBytes?: number;
  overrides?: Readonly<Record<string, (error: never) => string>>;
}>;
export const makeApp = (options: HttpFixtureOptions = {}) => {
  const work: Work = { calls: 0, callers: 0 };
  const logs: LogLine[] = [];
  const modules = Layer.merge(
    Bookings.fromRecords(
      [
        { id: "b-1", owner: "ada", guestName: "Ada", nights: 3 },
        { id: "b-2", owner: "ada", guestName: "Grace", nights: 7 },
        { id: "b-3", owner: "bob", guestName: "Bob", nights: 1 },
      ],
      work,
    ),
    Logger.layer([
      Logger.make(({ message, fiber }) => {
        logs.push({ message, annotations: fiber.getRef(References.CurrentLogAnnotations) });
      }),
    ]),
  );
  const selectedEndpoints = options.endpoints ?? [
    endpoint(showBooking, "GET /bookings/:id"),
    endpoint(findBookings, "GET /bookings"),
    endpoint(findBookings),
    endpoint(cancelBooking, "POST /bookings/:id/cancel"),
    endpoint(crash),
  ];
  const selectedEntries = features.filter((feature) =>
    selectedEndpoints.some((shape) => shape.feature === feature),
  );
  const apiWay = defineWay({
    name: "api",
    path: options.path ?? "/api",
    protocol: "http",
    features: selectedEntries,
    endpoints: selectedEndpoints,
    who: options.who === "session" ? sessionWhoFor(work) : bearerWhoFor(work),
    may: May.fixed(selectedEntries, permissions),
    mean: Mean.no,
    overrides: { ...overrides, ...options.overrides },
    ...(options.cors === undefined ? {} : { cors: options.cors }),
    ...(options.origins === undefined ? {} : { origins: options.origins }),
    ...(options.session === undefined ? {} : { session: options.session }),
    ...(options.maxBodyBytes === undefined ? {} : { maxBodyBytes: options.maxBodyBytes }),
  });
  const webWay = defineWay({
    name: "web",
    path: "/web",
    protocol: "http",
    features: [renameGuest, showBooking],
    endpoints: [
      endpoint(renameGuest, "PATCH /bookings/:id"),
      endpoint(renameGuest, "POST /hooks/rename", {
        csrf: { skip: true, reason: "A signed webhook, not a browser form." },
      }),
      endpoint(showBooking, "GET /bookings/:id"),
    ],
    origins: ["https://app.example"],
    who: sessionWhoFor(work),
    may: May.fixed([renameGuest, showBooking], permissions),
    mean: Mean.no,
    overrides,
  });
  const readWay = defineWay({
    name: "read",
    path: "/read",
    protocol: "http",
    features: [showBooking, findBookings],
    endpoints: [
      endpoint(showBooking, "GET /bookings/:id"),
      endpoint(findBookings, "GET /bookings"),
    ],
    who: bearerWhoFor(work, true),
    may: May.fixed([showBooking, findBookings], ["bookings:read"]),
    mean: Mean.no,
    overrides,
  });
  const mcpWay = defineWay({
    name: "mcp",
    path: "/mcp",
    protocol: "mcp",
    features: [showBooking, findBookings, cancelBooking],
    who: bearerWhoFor(work),
    may: May.fixed([showBooking, findBookings, cancelBooking], permissions),
    mean: Mean.elicitation,
    overrides,
    resource: protectedResource({
      resource: "https://app.example/mcp",
      authorizationServers: ["https://issuer.example"],
    }),
    server: { name: "test", version: "0.0.0" },
    tools: [
      { feature: showBooking, title: "Show a booking", idempotent: true, openWorld: false },
      { feature: findBookings, title: "Find bookings", idempotent: true, openWorld: false },
      { feature: cancelBooking, title: "Cancel a booking", idempotent: false, openWorld: false },
    ],
  });
  const layer = fixtureLayer(features).pipe(Layer.provideMerge(modules));
  const app = composition({
    layer,
    features: features,
    ways: [apiWay, webWay, readWay, mcpWay],
    system: [],
  });
  const router = toFetchHandler(app);
  const dispose = () => router.dispose().then(() => app.dispose());
  return { app, api: router, web: router, mcp: router, router, work, logs, dispose };
};
export type TestApp = ReturnType<typeof makeApp>;
export type JsonAnswer = Readonly<{ status: number; headers: Headers; body: unknown }>;
export const answer = (
  handler: (request: Request) => Promise<Response>,
  request: Request,
): Effect.Effect<JsonAnswer> =>
  Effect.promise(() => handler(request)).pipe(
    Effect.flatMap((response) =>
      Effect.promise((): Promise<unknown> => response.json()).pipe(
        Effect.map((body) => ({ status: response.status, headers: response.headers, body })),
      ),
    ),
  );
export const webRequest = (url: string, init?: RequestInit): Request =>
  new Request(url, init) as Request;
