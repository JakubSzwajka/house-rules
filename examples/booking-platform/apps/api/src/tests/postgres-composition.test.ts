import * as NodeServices from "@effect/platform-node/NodeServices";
import { PgClient } from "@effect/sql-pg";
import { BookingPermissions } from "@example/bookings";
import { afterAll, expect, it } from "@effect/vitest";
import { Actor, ActorId } from "@house-rules/domain";
import {
  Approval,
  call,
  composition,
  CurrentActor,
  Grant,
  toFetchHandler,
} from "@house-rules/application";
import { toPromiseClient } from "@house-rules/application/contract";
import { Migrations, MigrationsTesting } from "@house-rules/migrations";
import { AccountsIssuer } from "@example/accounts";
import { Context, Effect, Layer, Option } from "effect";
import { api, publicApi, publicPaths, tokenApi } from "../delivery/http/api.js";
import { memberRoutes, publicRoutes } from "../delivery/http/routes.js";
import { bookBooking } from "../use-cases/book-booking.js";
import { cancelBooking } from "../use-cases/cancel-booking.js";
import { addComment } from "../use-cases/comments/add-comment.js";
import { listComments } from "../use-cases/comments/list-comments.js";
import { postgresAppLayer } from "../composition/app-layer.js";
import type { SignInSettings } from "../composition/sign-in.js";
import { sessionCookie, visitorCaller } from "../composition/callers.js";
import { webCaller } from "../composition/index.js";
import { bookingViews } from "../composition/views.js";

const moduleList = new URL("../../../../../../migrations.json", import.meta.url).pathname;

const database = Layer.effectDiscard(Migrations.runList(moduleList)).pipe(
  Layer.provideMerge(
    MigrationsTesting.database({
      label: "api",
      client: (url) => PgClient.layer({ url, maxConnections: 4 }),
    }),
  ),
  Layer.provide(NodeServices.layer),
  Layer.orDie,
);

const actor = Actor.make({ id: ActorId.make("actor-a") });
const app = composition({
  layer: postgresAppLayer(database),
  caller: () =>
    Effect.succeed(
      Context.make(CurrentActor, actor).pipe(
        Context.add(
          Grant,
          Grant.fromPermissions([
            BookingPermissions.read,
            BookingPermissions.write,
            BookingPermissions.cancel,
            "comments:read",
            "comments:write",
          ]),
        ),
      ),
    ),
  views: bookingViews,
});
const served = toFetchHandler(app, { routes: memberRoutes });
afterAll(() => served.dispose().then(() => app.dispose()), 30_000);

const incoming = { headers: new Headers(), url: "https://booking.example" };

const show = (id: string) =>
  Effect.promise(() =>
    served(new Request(`https://booking.example/api/bookings/${id}`) as Request),
  ).pipe(
    Effect.flatMap((response) =>
      Effect.promise((): Promise<unknown> => response.json()).pipe(
        Effect.map((body) => ({ status: response.status, body })),
      ),
    ),
  );

it.effect(
  "the Postgres composition builds, migrates, and serves book, show, cancel and comments",
  () =>
    Effect.gen(function* postgresMode() {
      const booked = yield* Effect.promise(() =>
        call(app, bookBooking, { id: "pg-1", guestName: "Ada" }, incoming),
      );
      expect(booked).toEqual({
        ok: true,
        value: { id: "pg-1", guestName: "Ada", status: "active" },
      });
      expect(yield* show("pg-1")).toEqual({
        status: 200,
        body: { id: "pg-1", guestName: "Ada", status: "active" },
      });

      const cancelled = yield* Effect.promise(() =>
        call(app, cancelBooking, { id: "pg-1" }, incoming, { approval: Approval.allowAll }),
      );
      expect(cancelled.ok).toBe(true);
      expect((yield* show("pg-1")).body).toMatchObject({ status: "cancelled" });

      const target = { kind: "booking", id: "pg-1" };
      yield* Effect.promise(() => call(app, addComment, { target, body: "Stored." }, incoming));
      const listed = yield* Effect.promise(() =>
        call(app, listComments, { target, page: { size: 20 } }, incoming),
      );
      expect(listed).toMatchObject({ ok: true, value: { items: [{ body: "Stored." }] } });
    }),
  60_000,
);

it.live(
  "in Postgres with a fixed key, an account and its token survive a new composition",
  () =>
    Effect.gen(function* postgresAccounts() {
      // One database for both compositions, as one server restarted against the same Postgres.
      const shared = Layer.succeedContext(yield* Layer.build(database));
      const settings: SignInSettings = {
        accounts: {
          issuer: "https://booking.example",
          signingKey: Option.some(yield* AccountsIssuer.newSigningKey),
        },
        mcp: Option.none(),
      };
      const start = Effect.acquireRelease(
        Effect.sync(() => {
          const built = composition({
            layer: postgresAppLayer(shared, settings),
            caller: webCaller,
            views: bookingViews,
          });
          const members = toFetchHandler(built, { routes: memberRoutes });
          const accounts = toFetchHandler(built, {
            routes: publicRoutes,
            caller: visitorCaller,
            session: { cookie: sessionCookie },
          });
          const fetch = (input: string | URL | Request, init?: RequestInit) => {
            const request = new Request(input, init);
            return publicPaths.has(new URL(request.url).pathname)
              ? accounts(request)
              : members(request);
          };
          const options = { baseUrl: "https://booking.example", fetch };
          return {
            built,
            members,
            accounts,
            visitor: toPromiseClient(publicApi, {
              ...options,
              // A browser sends its page's Origin on a write; the session routes need it.
              fetch: (input: string | URL | Request, init?: RequestInit) => {
                const request = new Request(input, init);
                request.headers.set("origin", options.baseUrl);
                return fetch(request);
              },
            }),
            tokens: toPromiseClient(tokenApi, options),
            as: (token: string) => toPromiseClient(api, { ...options, token: () => token }),
          };
        }),
        ({ built, members, accounts }) =>
          Effect.promise(() =>
            Promise.all([members.dispose(), accounts.dispose()]).then(() => built.dispose()),
          ),
      );
      const credentials = { email: "pg@example.test", password: "a long enough secret" };

      const first = yield* Effect.scoped(
        Effect.gen(function* firstRun() {
          const { visitor, tokens, as } = yield* start;
          yield* Effect.promise(() => visitor.signUp({ ...credentials, displayName: "Pat" }));
          const { token } = yield* Effect.promise(() => tokens.signIn(credentials));
          const me = yield* Effect.promise(() => as(token).showMe({}));
          yield* Effect.promise(() => as(token).bookBooking({ id: "pg-pat", guestName: "Pat" }));
          return { token, me };
        }),
      );
      expect(first.me.displayName).toBe("Pat");

      const { tokens, as } = yield* start;
      const again = yield* Effect.promise(() => tokens.signIn(credentials));
      expect((yield* Effect.promise(() => as(again.token).showMe({}))).id).toBe(first.me.id);
      // The token from before the restart still checks: the key is the same.
      expect((yield* Effect.promise(() => as(first.token).showMe({}))).id).toBe(first.me.id);
      const mine = yield* Effect.promise(() => as(again.token).listMyBookings({}));
      expect(mine.items).toEqual([{ id: "pg-pat", guestName: "Pat", status: "active" }]);
      const activity = yield* Effect.promise(() => as(again.token).listMyActivity({}));
      // The strict audit keeps reads too, so the trail holds both runs' calls, newest first.
      expect(activity.items.map((entry) => [entry.capability, entry.targetId])).toEqual([
        ["list_my_bookings", null],
        ["show_me", null],
        ["show_me", null],
        ["book_booking", "pg-pat"],
        ["show_me", null],
      ]);
      expect(activity.items.every((entry) => entry.requestId !== null)).toBe(true);
    }),
  60_000,
);
