import { platformForTests } from "@house-rules/domain-postgres";
import * as Domain from "@alchemy.run/domain";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Roles } from "../../access/roles.ts";
import { devTokens } from "../../auth/dev-tokens.ts";
import { SessionLive } from "../../auth/session-live.ts";
import { sessionClient } from "../../auth/session.middleware.ts";
import * as WorkItems from "../index.ts";
import { ann, claudeId, Model, w1, w2 } from "./fixtures.ts";

const { board, WorkItemsPermissions } = WorkItems;

class WorkItemsApi extends Domain.Api("WorkItemsApi", {
  model: Model,
  commands: ["CreateWorkItem", "ClaimWorkItem", "ReleaseWorkItem"],
  views: ["WorkItemCard", "ContainerWorkItems", "HeldWorkItems"],
}) {}

const World = Layer.mergeAll(SessionLive, WorkItems.workflowConfig(board)).pipe(
  Layer.provide(
    Layer.mergeAll(
      devTokens({
        "ann-token": { subject: "ann", orgId: null, roles: ["member"] },
        "bob-token": { subject: "bob", orgId: null, roles: ["member"] },
        "eve-token": { subject: "eve", orgId: null, roles: [] },
        "claude-token": {
          subject: "agent:claude",
          orgId: null,
          roles: ["agent"],
          agent: { name: "Claude", forPerson: "ann" },
        },
      }),
      Roles.layer({
        member: [WorkItemsPermissions.read, WorkItemsPermissions.write],
        agent: [WorkItemsPermissions.read, WorkItemsPermissions.write],
      }),
    ),
  ),
  Layer.provideMerge(Model.layer(WorkItems.handlers).pipe(Layer.provide(platformForTests))),
);
const as = (token: string) =>
  WorkItemsApi.clientInProcess.pipe(Effect.provide(sessionClient(token)));

describe("WorkItemsApi", () => {
  it.live("creates and claims through Session, workflow config and Roles", () =>
    Effect.gen(function* () {
      const annClient = yield* as("ann-token");
      yield* annClient.CreateWorkItem(w1, { title: "Fix the roof", container: "p-1" });
      const claimed = yield* annClient.ClaimWorkItem(w1);
      const card = yield* annClient.WorkItemCard.snapshot(w1, { atLeast: claimed });
      const held = yield* annClient.HeldWorkItems.get(ann, {
        atLeast: { stream: `WorkItemCard/${w1}`, version: card.cursor },
      });
      expect(held?.items[w1]).toMatchObject({ status: "doing" });
      const bobClient = yield* as("bob-token");
      const taken = yield* bobClient.ClaimWorkItem(w1).pipe(Effect.flip);
      expect(taken).toMatchObject({ _tag: "WorkItemHeld", holder: ann });
      const notHolder = yield* bobClient.ReleaseWorkItem(w1).pipe(Effect.flip);
      expect(notHolder._tag).toBe("NotHolder");
      const eve = yield* as("eve-token");
      const refused = yield* eve.ContainerWorkItems.get("p-1").pipe(Effect.flip);
      expect(refused._tag).toBe("Forbidden");
    }).pipe(Effect.scoped, Effect.provide(World)),
  );

  it.live("lets an agent token claim an item and read the items it holds", () =>
    Effect.gen(function* () {
      const annClient = yield* as("ann-token");
      yield* annClient.CreateWorkItem(w2, { title: "Answer the mail", container: "p-2" });
      const claude = yield* as("claude-token");
      const claimed = yield* claude.ClaimWorkItem(w2);
      const card = yield* claude.WorkItemCard.snapshot(w2, { atLeast: claimed });
      expect(card.state).toMatchObject({ holder: "agent:claude", status: "doing" });
      const held = yield* claude.HeldWorkItems.get(claudeId, {
        atLeast: { stream: `WorkItemCard/${w2}`, version: card.cursor },
      });
      expect(Object.keys(held?.items ?? {})).toEqual([w2]);
      const taken = yield* annClient.ClaimWorkItem(w2).pipe(Effect.flip);
      expect(taken).toMatchObject({ _tag: "WorkItemHeld", holder: "agent:claude" });
    }).pipe(Effect.scoped, Effect.provide(World)),
  );
});
