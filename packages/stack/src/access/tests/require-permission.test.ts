import { platformForTests } from "@house-rules/domain-postgres";
import * as Domain from "@alchemy.run/domain";
import { Story } from "@alchemy.run/domain/Story";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import {
  CurrentActor,
  devTokens,
  Forbidden,
  person,
  requirePermission,
  Roles,
  Session,
  SessionLive,
  sessionClient,
} from "../../index.ts";

const CounterId = Schema.String.pipe(Schema.brand("CounterId"));

class Bumped extends Domain.Event("Bumped", { by: Schema.String, total: Schema.Int }) {}

class Bump extends Domain.Command("Bump", {
  target: CounterId,
  middleware: [Session],
  events: [Bumped],
  rejects: [Forbidden],
  reply: { total: Schema.Int },
}) {}

class Counter extends Domain.Aggregate("Counter", {
  id: CounterId,
  state: Schema.Struct({ total: Schema.Int }),
  initial: { total: 0 },
  commands: [Bump],
  decide: {
    Bump: Effect.fn(function* (s) {
      const actor = yield* requirePermission("counters:bump");
      return [
        new Bumped({ by: actor._tag === "Person" ? actor.id : actor.name, total: s.total + 1 }),
      ];
    }),
  },
  evolve: { Bumped: (_, e) => ({ total: e.total }) },
  reply: { Bump: (s) => ({ total: s.total }) },
}) {}

class Counters extends Domain.Model("Counters", { aggregates: [Counter] }) {}
class CountersApi extends Domain.Api("CountersApi", { model: Counters, commands: ["Bump"] }) {}

const story = Story.make(Counters, {});
const c1 = Counter.ref(CounterId.make("c-1"));

describe("requirePermission in decide", () => {
  it("the model is well defined", () => expect(Domain.verify(Counters)).toEqual([]));

  it.effect("lets a person with the permission act", () =>
    story(
      Story.provide(CurrentActor, person("ann", { permissions: ["counters:bump"] })),
      Story.when(c1, new Bump()),
      Story.then(c1, new Bumped({ by: "ann", total: 1 })),
      Story.replied({ total: 1 }),
    ),
  );

  it.effect("refuses a person without it", () =>
    story(
      Story.provide(CurrentActor, person("bob")),
      Story.when(c1, new Bump()),
      Story.rejected(new Forbidden({ permission: "counters:bump" })),
    ),
  );
});

describe("Session over the Api", () => {
  const World = SessionLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        devTokens({
          "ann-token": { subject: "ann", orgId: null, roles: ["member"] },
          "bob-token": { subject: "bob", orgId: null, roles: ["guest"] },
        }),
        Roles.layer({ member: ["counters:bump"], guest: [] }),
      ),
    ),
    Layer.provideMerge(Counters.layer(Layer.empty).pipe(Layer.provide(platformForTests))),
  );
  const as = (token: string) =>
    CountersApi.clientInProcess.pipe(Effect.provide(sessionClient(token)));

  it.live("resolves roles to permissions and authorizes in decide", () =>
    Effect.gen(function* () {
      const ann = yield* as("ann-token");
      const done = yield* ann.Bump(CounterId.make("c-2"));
      expect(done.reply).toEqual({ total: 1 });
      const bob = yield* as("bob-token");
      const refused = yield* bob.Bump(CounterId.make("c-2")).pipe(Effect.flip);
      expect(refused._tag).toBe("Forbidden");
      const stranger = yield* as("nope");
      const anonymous = yield* stranger.Bump(CounterId.make("c-2")).pipe(Effect.flip);
      expect(anonymous._tag).toBe("Unauthenticated");
    }).pipe(Effect.scoped, Effect.provide(World)),
  );
});
