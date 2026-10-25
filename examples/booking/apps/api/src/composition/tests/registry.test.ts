import { it } from "@effect/vitest";
import { Context, Effect } from "effect";
import { Party } from "@house-rules/party";
import { Actor, ActorId, UnitOfWork } from "@house-rules/domain";
import { createApp } from "../app.ts";

it.effect("validates role permissions on a fresh app before any request", () =>
  Effect.gen(function* () {
    const app = createApp([]);
    try {
      const context = yield* app.runtime.contextEffect;
      const party = Context.get(context, Party);
      const id = ActorId.make("fresh-admin");
      const system = { kind: "system", reason: "test setup", startedBy: "test" } as const;
      yield* UnitOfWork.atomic(
        Effect.gen(function* () {
          yield* party.createPerson({ id, displayName: "Fresh admin" });
          yield* party.assignRole(system, { personId: id, roleKey: "admin", organisationId: null });
          yield* party.defineRole(
            { kind: "person", actor: Actor.make({ id }), via: "test" },
            { key: "fresh", name: "Fresh", permissions: ["bookings:read"], organisationId: null },
          );
        }),
      ).pipe(Effect.provideContext(context));
    } finally {
      yield* Effect.promise(() => app.dispose());
    }
  }),
);
