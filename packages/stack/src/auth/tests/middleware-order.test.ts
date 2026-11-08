import * as Domain from "@alchemy.run/domain";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as RpcMiddleware from "effect/rpc/RpcMiddleware";
import * as Schema from "effect/Schema";
import {
  CurrentActor,
  devTokens,
  Forbidden,
  requirePermission,
  Roles,
  Session,
  SessionLive,
  sessionClient,
} from "../../index.ts";

class OrgRequired extends Schema.TaggedError<OrgRequired>()(
  "OrgRequired",
  { sawActor: Schema.Boolean },
  { httpApiStatus: 403 },
) {}

class OrgOnly extends RpcMiddleware.Service<OrgOnly>()("Test/OrgOnly", { error: OrgRequired }) {}

const OrgOnlyLive = Layer.succeed(OrgOnly, (effect) =>
  Effect.flatMap(
    Effect.serviceOption(CurrentActor),
    Option.match({
      onNone: () => Effect.fail(new OrgRequired({ sawActor: false })),
      onSome: (actor) =>
        actor._tag === "Person" && actor.orgId !== null
          ? effect
          : Effect.fail(new OrgRequired({ sawActor: true })),
    }),
  ),
);

const RoomId = Schema.String.pipe(Schema.brand("RoomId"));

class GuardInside extends Domain.Command("GuardInside", {
  target: RoomId,
  middleware: [OrgOnly, Session],
  rejects: [Forbidden],
}) {}

class GuardOutside extends Domain.Command("GuardOutside", {
  target: RoomId,
  middleware: [Session, OrgOnly],
  rejects: [Forbidden],
}) {}

const enter = Effect.fn(function* () {
  yield* requirePermission("rooms:enter");
  return [];
});

class Room extends Domain.Aggregate("Room", {
  id: RoomId,
  state: Schema.Struct({}),
  initial: {},
  commands: [GuardInside, GuardOutside],
  decide: { GuardInside: enter, GuardOutside: enter },
  evolve: {},
}) {}

class Rooms extends Domain.Model("Rooms", { aggregates: [Room] }) {}
class RoomsApi extends Domain.Api("RoomsApi", {
  model: Rooms,
  commands: ["GuardInside", "GuardOutside"],
}) {}

const World = Layer.mergeAll(SessionLive, OrgOnlyLive).pipe(
  Layer.provide(
    Layer.mergeAll(
      devTokens({ "carol-token": { subject: "carol", orgId: "acme", roles: ["guest"] } }),
      Roles.layer({ guest: ["rooms:enter"] }),
    ),
  ),
  Layer.provideMerge(Rooms.layer(Layer.empty).pipe(Layer.provide(Domain.InMemory))),
);

describe("middleware order: Effect 4.1.2 runs the last listed first, unlike the beta.85 docs", () => {
  it("the model is well defined", () => expect(Domain.verify(Rooms)).toEqual([]));

  it.live("a guard listed before Session runs after it and sees the actor", () =>
    Effect.gen(function* () {
      const carol = yield* RoomsApi.clientInProcess.pipe(
        Effect.provide(sessionClient("carol-token")),
      );
      const inside = yield* carol.GuardInside(RoomId.make("r-1"));
      expect(inside).toMatchObject({ stream: "Room/r-1" });
      const outside = yield* carol.GuardOutside(RoomId.make("r-2")).pipe(Effect.flip);
      expect(outside).toMatchObject({ _tag: "OrgRequired", sawActor: false });
    }).pipe(Effect.scoped, Effect.provide(World)),
  );
});
