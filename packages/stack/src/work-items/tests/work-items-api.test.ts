import * as Domain from "@alchemy.run/domain";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { Roles } from "../../access/roles.ts";
import { devTokens } from "../../auth/dev-tokens.ts";
import { SessionLive } from "../../auth/session-live.ts";
import { sessionClient } from "../../auth/session.middleware.ts";
import * as WorkItems from "../index.ts";
import { ann, Model, w1 } from "./fixtures.ts";

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
      }),
      Roles.layer({
        member: [WorkItemsPermissions.read, WorkItemsPermissions.write],
      }),
    ),
  ),
  Layer.provideMerge(Model.layer(WorkItems.handlers).pipe(Layer.provide(Domain.InMemory))),
);
const as = (token: string) =>
  WorkItemsApi.clientInProcess.pipe(Effect.provide(sessionClient(token)));

describe("WorkItemsApi", () => {
  it.live("creates and claims through Session, workflow config and Roles", () =>
    Effect.gen(function* () {
      const annClient = yield* as("ann-token");
      yield* annClient.CreateWorkItem(w1, { title: "Fix the roof", container: "p-1" });
      yield* annClient.ClaimWorkItem(w1);
      const held = yield* annClient.HeldWorkItems.watch(ann).pipe(
        Stream.filter(({ state }) => state?.items[w1] !== undefined),
        Stream.runHead,
      );
      expect(Option.getOrUndefined(held)?.state?.items[w1]).toMatchObject({ status: "doing" });
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
});
