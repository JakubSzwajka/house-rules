import * as Domain from "@alchemy.run/domain";
import * as DomainAi from "@alchemy.run/domain/Ai";
import { describe, expect, it } from "@effect/vitest";
import type * as AiError from "effect/ai/AiError";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import {
  authorOf,
  devTokens,
  Forbidden,
  requirePermission,
  Roles,
  Session,
  SessionLive,
  sessionClient,
} from "../../index.ts";
import { viaAgent } from "../../auth/via-agent.ts";
import { Approval } from "../approval.ts";
import { ApprovalGate } from "../approval-gate.middleware.ts";

const VaultId = Schema.String.pipe(Schema.brand("VaultId"));

class VaultEmptied extends Domain.Event("VaultEmptied", { by: Schema.String }) {}

class EmptyVault extends Domain.Command("EmptyVault", {
  target: VaultId,
  middleware: [ApprovalGate, Session],
  events: [VaultEmptied],
  rejects: [Forbidden],
}) {}

class PeekVault extends Domain.Command("PeekVault", {
  target: VaultId,
  middleware: [Session, ApprovalGate],
  rejects: [Forbidden],
}) {}

class Vault extends Domain.Aggregate("Vault", {
  id: VaultId,
  state: Schema.Struct({ emptied: Schema.Boolean }),
  initial: { emptied: false },
  commands: [EmptyVault, PeekVault],
  decide: {
    PeekVault: Effect.fn(function* () {
      yield* requirePermission("vaults:empty");
      return [];
    }),
    EmptyVault: Effect.fn(function* () {
      const actor = yield* requirePermission("vaults:empty");
      return [new VaultEmptied({ by: authorOf(actor) })];
    }),
  },
  evolve: { VaultEmptied: () => ({ emptied: true }) },
}) {}

class Vaults extends Domain.Model("Vaults", { aggregates: [Vault] }) {}
class VaultsApi extends Domain.Api("VaultsApi", {
  model: Vaults,
  commands: ["EmptyVault", "PeekVault"],
}) {}

const worldWith = (approval: Layer.Layer<ApprovalGate>) =>
  Layer.mergeAll(SessionLive, approval).pipe(
    Layer.provide(
      Layer.mergeAll(
        devTokens({ "ann-token": { subject: "ann", orgId: null, roles: ["keeper"] } }),
        Roles.layer({ keeper: ["vaults:empty"] }),
      ),
    ),
    Layer.provideMerge(Vaults.layer(Layer.empty).pipe(Layer.provide(Domain.InMemory))),
  );

type ToolResult = { readonly isFailure: boolean; readonly result: unknown };

const as = (token: string, via: "user" | "agent") =>
  VaultsApi.clientInProcess.pipe(Effect.provide(sessionClient(token, via)));

describe("ApprovalGate", () => {
  it("the model is well defined", () => expect(Domain.verify(Vaults)).toEqual([]));

  it.live("denyAgents lets a person through and refuses the same person through an agent", () =>
    Effect.gen(function* () {
      const agent = yield* as("ann-token", "agent");
      const refused = yield* agent.EmptyVault(VaultId.make("v-1")).pipe(Effect.flip);
      expect(refused).toMatchObject({ _tag: "ApprovalRequired", command: "EmptyVault" });
      const ann = yield* as("ann-token", "user");
      const done = yield* ann.EmptyVault(VaultId.make("v-1"));
      expect(done).toMatchObject({ stream: "Vault/v-1", version: 1 });
    }).pipe(Effect.scoped, Effect.provide(worldWith(Approval.denyAgents))),
  );

  it.live("allowAll lets the agent act for the person", () =>
    Effect.gen(function* () {
      const agent = yield* as("ann-token", "agent");
      const done = yield* agent.EmptyVault(VaultId.make("v-2"));
      expect(done).toMatchObject({ stream: "Vault/v-2", version: 1 });
    }).pipe(Effect.scoped, Effect.provide(worldWith(Approval.allowAll))),
  );

  it.live("authenticates before asking for approval", () =>
    Effect.gen(function* () {
      const stranger = yield* as("nope", "agent");
      const refused = yield* stranger.EmptyVault(VaultId.make("v-3")).pipe(Effect.flip);
      expect(refused._tag).toBe("Unauthenticated");
    }).pipe(Effect.scoped, Effect.provide(worldWith(Approval.denyAgents))),
  );

  it.live("listed after Session, it runs first and refuses everyone", () =>
    Effect.gen(function* () {
      const ann = yield* as("ann-token", "user");
      const refused = yield* ann.PeekVault(VaultId.make("v-5")).pipe(Effect.flip);
      expect(refused).toMatchObject({ _tag: "ApprovalRequired", command: "PeekVault" });
    }).pipe(Effect.scoped, Effect.provide(worldWith(Approval.allowAll))),
  );

  it.live("a policy decides from the command and the actor", () =>
    Effect.gen(function* () {
      const agent = yield* as("ann-token", "agent");
      const done = yield* agent.EmptyVault(VaultId.make("v-4"));
      expect(done).toMatchObject({ stream: "Vault/v-4", version: 1 });
    }).pipe(
      Effect.scoped,
      Effect.provide(
        worldWith(
          Approval.policy(
            ({ command, actor }) => command === "EmptyVault" && actor._tag === "Person",
          ),
        ),
      ),
    ),
  );

  it.live("an agent's tool call carries its session and is held for approval", () => {
    const { toolkit, layer } = DomainAi.toToolkit(VaultsApi, {
      headers: viaAgent(Effect.succeed("ann-token")),
    });
    return Effect.gen(function* () {
      const tools = yield* toolkit;
      const handle = tools.handle as unknown as (
        name: string,
        params: unknown,
      ) => Effect.Effect<Stream.Stream<ToolResult, AiError.AiError>, AiError.AiError>;
      const call = handle("VaultsApi_EmptyVault_send", { target: "v-6", input: {} });
      const results = yield* Effect.flatMap(call, Stream.runCollect);
      expect(results.map(({ isFailure, result }) => ({ isFailure, result }))).toMatchObject([
        { isFailure: true, result: { _tag: "ApprovalRequired", command: "EmptyVault" } },
      ]);
    }).pipe(Effect.provide(layer), Effect.scoped, Effect.provide(worldWith(Approval.denyAgents)));
  });
});
