import { Context, Effect, Layer, Logger, Option, References, Schema } from "effect";
import {
  type Caller,
  composition,
  defineContract,
  type Forbidden,
  Grant,
  implement,
  type Incoming,
  type Permission,
  Refused,
  route,
  toFetchHandler,
  toMcpHandler,
  tool,
  type View,
} from "../index.ts";
import {
  type Actor,
  Booking,
  BookingNotFound,
  Bookings,
  Viewer,
  type Work,
} from "./delivery-bookings-fixtures.ts";

export {
  type Actor,
  Booking,
  BookingNotFound,
  Bookings,
  Viewer,
  type Work,
} from "./delivery-bookings-fixtures.ts";

export const showBooking = implement(
  defineContract("show_booking", {
    description: "Show one booking by its id.",
    input: Schema.Struct({ id: Schema.String }),
    output: Booking,
    failure: BookingNotFound,
    permission: "bookings:read",
    annotations: { readOnly: true },
  }),
  ({ id }) =>
    Effect.gen(function* showBookingHandler() {
      const viewer = yield* Viewer;
      return yield* (yield* Bookings).get(viewer, id);
    }),
);

export const findBookings = implement(
  defineContract("find_bookings", {
    description: "Find your bookings by guest name, or by a minimum number of nights.",
    input: Schema.Union([
      Schema.Struct({ by: Schema.Literal("guest"), guest: Schema.String }),
      Schema.Struct({ by: Schema.Literal("nights"), minNights: Schema.Int }),
    ]),
    output: Schema.Struct({ bookings: Schema.Array(Booking) }),
    failure: Schema.Never,
    permission: "bookings:read",
    annotations: { readOnly: true },
  }),
  (input) =>
    Effect.gen(function* findBookingsHandler() {
      const viewer = yield* Viewer;
      const filter = input.by === "guest" ? { guest: input.guest } : { minNights: input.minNights };
      return { bookings: yield* (yield* Bookings).find(viewer, filter) };
    }),
);

export const cancelBooking = implement(
  defineContract("cancel_booking", {
    description: "Cancel one of your bookings.",
    input: Schema.Struct({ id: Schema.String }),
    output: Schema.Struct({ cancelled: Schema.String }),
    failure: BookingNotFound,
    permission: "bookings:write",
    needsApproval: true,
    annotations: { destructive: true },
  }),
  ({ id }) =>
    Effect.gen(function* cancelBookingHandler() {
      const viewer = yield* Viewer;
      yield* (yield* Bookings).cancel(viewer, id);
      return { cancelled: id };
    }),
);

export const renameGuest = implement(
  defineContract("rename_guest", {
    description: "Rename the guest on one of your bookings.",
    input: Schema.Struct({ id: Schema.String, guestName: Schema.String }),
    output: Schema.Struct({ id: Schema.String }),
    failure: BookingNotFound,
    permission: "bookings:write",
  }),
  ({ id }) =>
    Effect.gen(function* renameGuestHandler() {
      const viewer = yield* Viewer;
      yield* (yield* Bookings).get(viewer, id);
      return { id };
    }),
);

export const crash = implement(
  defineContract("crash", {
    description: "Dies, to show the defect view.",
    input: Schema.Struct({}),
    output: Schema.Struct({}),
    failure: Schema.Never,
    permission: "public",
  }),
  () => Effect.die("a bug in the handler"),
);

const permissionsOf = (actor: Actor): ReadonlyArray<Permission> =>
  actor.scope === "write" ? ["bookings:read", "bookings:write"] : ["bookings:read"];

const callerOf = (actor: Actor) =>
  Context.make(Viewer, actor).pipe(Context.add(Grant, Grant.fromPermissions(permissionsOf(actor))));

const sessions: Readonly<Record<string, Actor>> = { "s-ada": { userId: "ada", scope: "write" } };

const tokens: Readonly<Record<string, Actor>> = {
  "tok-ada": { userId: "ada", scope: "write" },
  "tok-ada-read": { userId: "ada", scope: "read" },
};

export const metadataUrl = "https://app.example/.well-known/oauth-protected-resource/mcp";

const cookieOf = (incoming: Incoming, name: string): string | undefined =>
  (incoming.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim().split("="))
    .find(([key]) => key === name)?.[1];

export const sessionCallerFor =
  (work: Work): Caller<Viewer | Grant, Bookings> =>
  (incoming) =>
    Effect.gen(function* sessionCaller() {
      work.callers += 1;
      const session = cookieOf(incoming, "session");
      const actor = session === undefined ? undefined : sessions[session];
      if (actor === undefined) {
        return yield* new Refused({
          status: 401,
          code: "session_invalid",
          message: "Sign in again.",
        });
      }
      return callerOf(actor);
    });

export const bearerCallerFor =
  (work: Work): Caller<Viewer | Grant, Bookings> =>
  (incoming) =>
    Effect.gen(function* bearerCaller() {
      work.callers += 1;
      const token = /^Bearer\s+(\S+)$/iu.exec(incoming.headers.get("authorization") ?? "")?.[1];
      const actor = token === undefined ? undefined : tokens[token];
      if (actor === undefined) {
        return yield* new Refused({
          status: 401,
          code: token === undefined ? "token_missing" : "token_invalid",
          message: "Send a valid token as Authorization: Bearer <token>.",
          challenge: `Bearer resource_metadata="${metadataUrl}"`,
        });
      }
      return callerOf(actor);
    });

export const views = {
  BookingNotFound: (error: BookingNotFound): View => ({
    status: 404,
    body: { error: { code: "not_found", message: `Booking ${error.id} was not found.` } },
  }),
  Forbidden: (_error: Forbidden, caller: Context.Context<Viewer> | undefined): View => {
    const viewer = caller === undefined ? Option.none() : Context.getOption(caller, Viewer);
    const readScope = Option.isSome(viewer) && viewer.value.scope === "read";
    return {
      status: 403,
      body: {
        error: readScope
          ? { code: "scope_too_wide", message: "A read token cannot change anything." }
          : { code: "not_permitted", message: "You may not do that." },
      },
    };
  },
};

export type LogLine = Readonly<{
  message: unknown;
  annotations: Readonly<Record<string, unknown>>;
}>;

export const makeApp = () => {
  const work: Work = { calls: 0, callers: 0 };
  const logs: Array<LogLine> = [];
  const layer = Layer.merge(
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
  const app = composition({ layer, caller: sessionCallerFor(work), views });
  const bearer = bearerCallerFor(work);
  const api = toFetchHandler(app, {
    prefix: "/api",
    caller: bearer,
    routes: [
      route(showBooking, "GET /bookings/:id"),
      route(findBookings, "GET /bookings"),
      route(findBookings),
      route(cancelBooking, "POST /bookings/:id/cancel"),
      route(crash),
    ],
  });
  const web = toFetchHandler(app, {
    prefix: "/web",
    origins: ["https://app.example"],
    routes: [
      route(renameGuest, "PATCH /bookings/:id"),
      route(renameGuest, "POST /hooks/rename", {
        csrf: { skip: true, reason: "A signed webhook, not a browser form." },
      }),
      route(showBooking, "GET /bookings/:id"),
    ],
  });
  const mcp = toMcpHandler(app, {
    path: "/mcp",
    name: "test",
    version: "0.0.0",
    caller: bearer,
    tools: [
      tool(showBooking, { title: "Show a booking", idempotent: true, openWorld: false }),
      tool(findBookings, { title: "Find bookings", idempotent: true, openWorld: false }),
      tool(cancelBooking, { title: "Cancel a booking", idempotent: false, openWorld: false }),
    ],
  });
  const dispose = () =>
    Promise.all([api.dispose(), web.dispose(), mcp.dispose()]).then(() => app.dispose());
  return { app, api, web, mcp, work, logs, dispose };
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
  // This workspace loads two @types/node versions, so tsc sees the Request constructor and the Request type differ.
  new Request(url, init) as Request;
