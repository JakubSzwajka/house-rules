import type { ActorId } from "@house-rules/domain";
import { Context, Effect, Layer } from "effect";
import { IdentityStoreUnavailable } from "../storage.js";

export type Standing = "active" | "disabled" | "missing";
export type StandingCheck = (actorId: ActorId) => Effect.Effect<Standing, IdentityStoreUnavailable>;

export class ActorStanding extends Context.Service<ActorStanding, { check: StandingCheck }>()(
  "@house-rules/identity/ActorStanding",
) {
  static readonly layer = <E, R>(
    check: Effect.Effect<(actorId: ActorId) => Effect.Effect<Standing, E>, E, R>,
  ) =>
    Layer.effect(
      ActorStanding,
      Effect.map(check, (check) => ({
        check: (id: ActorId) =>
          check(id).pipe(Effect.mapError((cause) => new IdentityStoreUnavailable({ cause }))),
      })),
    );
}

export const everyoneActive = Layer.succeed(ActorStanding, {
  check: () => Effect.succeed("active"),
});
