import { expect, layer } from "@effect/vitest";
import {
  composition,
  defineFeature,
  defineWay,
  endpoint,
  May,
  Mean,
  Runtime,
  StepTrace,
  toFetchHandler,
} from "@house-rules/application";
import { Actor, ActorId } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { SqlError } from "effect/sql/SqlError";
import { bindParty, Party, PartyOperations, PersonStoreUnavailable } from "../../index.js";

const { showMe } = PartyOperations;
import { stores } from "./stores.js";

layer(stores[0].layer, { timeout: "30 seconds" })("Party unavailable disclosure", (it) => {
  it.effect("cause-only errors keep driver details out of their message", () =>
    Effect.sync(() => {
      const cause = new Error("private PostgreSQL host and query detail");
      const error = new PersonStoreUnavailable({ cause });
      expect(error.message).toBe("People are unavailable. Try again shortly.");
      expect(error.message).not.toContain(cause.message);
      expect(error.cause).toBe(cause);
      expect(String(error.cause)).toContain(cause.message);
    }),
  );

  it.effect("the public showMe node hides a real backing Postgres failure over HTTP", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient;
      const party = yield* Party.pipe(Effect.provide(Party.layer({ builtInRoles: {} })));
      const entry = defineFeature("test_show_me", {
        ...showMe,
        permission: null,
        flags: { readOnly: true },
        edges: [showMe],
        handler: (input, { call }) => call(showMe, input),
      });
      const features = [entry] as const;
      const way = defineWay({
        name: "web",
        path: "/",
        protocol: "http",
        features,
        endpoints: [endpoint(entry, "POST /show_me")],
        who: { resolve: () => Effect.succeed(Actor.make({ id: ActorId.make("viewer") })) },
        mean: Mean.no,
      });
      const app = composition({
        layer: Layer.merge(
          Runtime.layer({ bindings: bindParty(party), features, ways: [way] }),
          StepTrace.layer(),
        ),
        features,
        ways: [way],
        may: May.fixed(["party:read"]),
        system: [],
      });
      const handler = toFetchHandler(app);
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => handler.dispose().then(() => app.dispose())),
      );
      yield* sql`alter table party_person rename to party_person_private_driver_detail`;
      yield* Effect.gen(function* () {
        const internal = yield* party
          .me(Actor.make({ id: ActorId.make("viewer") }))
          .pipe(Effect.flip);
        expect(internal).toBeInstanceOf(PersonStoreUnavailable);
        expect(Schema.is(SqlError)(internal.cause)).toBe(true);
        if (Schema.is(SqlError)(internal.cause)) {
          expect(String(internal.cause.reason.cause)).toContain("party_person");
        }
        const response = yield* Effect.promise(() =>
          handler(
            new Request("https://app.test/show_me", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: "{}",
            }) as Request,
          ),
        );
        const body = yield* Effect.promise(() => response.json());
        expect(response.status).toBe(503);
        expect(body).toEqual({
          error: { code: "unavailable", message: "People are unavailable. Try again shortly." },
        });
        expect(JSON.stringify(body)).not.toMatch(/party_person|relation|SqlError|cause|_tag/u);
      }).pipe(
        Effect.ensuring(
          sql`alter table party_person_private_driver_detail rename to party_person`.pipe(
            Effect.orDie,
          ),
        ),
      );
    }),
  );
});
