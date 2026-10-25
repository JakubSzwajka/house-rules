import { assert, it } from "@effect/vitest";
import { toFetchHandler } from "@house-rules/application";
import { Actor, ActorId } from "@house-rules/domain";
import { Effect } from "effect";
import { createApp } from "../../../composition/app.ts";
import { seedRoleTesting } from "../../../composition/tests/roles-testing.ts";
import { webWay } from "../way.ts";
it.live("an admin delegating an unheld permission gets a nonempty public HTTP refusal", () =>
  Effect.gen(function* () {
    const actor = Actor.make({ id: ActorId.make("role-message-admin") });
    const app = yield* Effect.acquireRelease(
      Effect.sync(() => createApp([{ ...webWay, who: { resolve: () => Effect.succeed(actor) } }])),
      (app) => Effect.promise(() => app.dispose()),
    );
    const context = yield* app.runtime.contextEffect;
    yield* seedRoleTesting(actor.id, "admin").pipe(Effect.provideContext(context));
    const handler = yield* Effect.acquireRelease(
      Effect.sync(() => toFetchHandler(app)),
      (handler) => Effect.promise(() => handler.dispose()),
    );
    const response = yield* Effect.promise(() =>
      handler(
        new Request("https://booking.example/api/define_role", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "https://booking.example" },
          body: JSON.stringify({
            key: "unheld-role",
            name: "Unheld",
            permissions: ["billing:expire"],
            organisationId: null,
          }),
        }),
      ),
    );
    assert.strictEqual(response.status, 403);
    assert.deepStrictEqual(yield* Effect.promise(() => response.json()), {
      error: {
        code: "forbidden",
        message: "You do not have permission for this action in this scope.",
      },
    });
  }).pipe(Effect.scoped),
);
