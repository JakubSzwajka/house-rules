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
import { Migrations, MigrationsTesting } from "@house-rules/migrations";
import { Context, Effect, Layer } from "effect";
import { bookingRoutes } from "../delivery/http/routes.js";
import { bookBooking } from "../use-cases/book-booking.js";
import { cancelBooking } from "../use-cases/cancel-booking.js";
import { addComment } from "../use-cases/comments/add-comment.js";
import { listComments } from "../use-cases/comments/list-comments.js";
import { postgresAppLayer } from "../composition/app-layer.js";
import { TokenVerifier } from "../composition/token-verifier.js";
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
  layer: Layer.merge(postgresAppLayer(database), TokenVerifier.none),
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
const api = toFetchHandler(app, { prefix: "/api", routes: bookingRoutes });
afterAll(() => api.dispose().then(() => app.dispose()), 30_000);

const incoming = { headers: new Headers(), url: "https://hosti.example" };

const show = (id: string) =>
  Effect.promise(() =>
    api(new Request(`https://hosti.example/api/bookings/${id}`) as Request),
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
