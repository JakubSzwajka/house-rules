import * as Effect from "effect/Effect";
import { CurrentActor } from "../actor/current-actor.context.ts";
import { Forbidden } from "./forbidden.rejection.ts";
import { can, type Permission } from "./permission.ts";

export const requirePermission = Effect.fn("requirePermission")(function* (permission: Permission) {
  const actor = yield* CurrentActor;
  if (!can(actor, permission)) return yield* new Forbidden({ permission });
  return actor;
});
