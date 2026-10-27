import { expect, it } from "@effect/vitest";
import { Actor, ActorId, defineOperation, memoryUnitOfWork } from "@house-rules/domain";
import { Context, Effect, Layer, Schema } from "effect";
import { defineFeature, defineReadModel } from "../contract.ts";
import {
  bindOperation,
  CallWatch,
  composition,
  defineWay,
  Mean,
  protectedResource,
  Refused,
  StepTrace,
  toFetchHandler,
} from "../index.ts";
import { callMcpTool, mcpInitialize, mcpPost, openMcpSession } from "./delivery-mcp-client.ts";

const resource = "https://app.example/mcp";
const resourceMetadata =
  'resource_metadata="https://app.example/.well-known/oauth-protected-resource/mcp"';
const challenge = `Bearer ${resourceMetadata}`;
const ada = Actor.make({ id: ActorId.make("ada") });
const bob = Actor.make({ id: ActorId.make("bob") });
const fixture = Effect.acquireRelease(
  Effect.sync(() => {
    const calls: string[] = [];
    const seen: string[] = [];
    const checks: string[] = [];
    const base = {
      description: "Read a value for the admitted caller.",
      input: Schema.Struct({ value: Schema.Int }),
      output: Schema.Struct({ value: Schema.Int, actorId: Schema.String }),
      failure: Schema.Never,
    } as const;
    const read = defineOperation("Counter.read", {
      ...base,
      permission: "counter:read",
      readOnly: true,
    });
    const query = defineReadModel("query", {
      ...base,
      permission: null,
      edges: [read],
      handler: (input, { call }) => call(read, input),
    });
    // A staged read-only command advertises the same hint without changing kind.
    const command = defineFeature("command", {
      ...base,
      permission: null,
      edges: [read],
      flags: { readOnly: true },
      handler: (input, { call }) => call(read, input),
    });
    const hidden = defineReadModel("hidden", {
      ...base,
      permission: null,
      handler: () => Effect.succeed({ value: 99, actorId: "hidden" }),
    });
    const service = Context.Reference<undefined>("test/mcp-counter", {
      defaultValue: () => undefined,
    });
    const trace = StepTrace.make();
    const way = defineWay({
      name: "mcp",
      protocol: "mcp",
      path: "/mcp",
      features: [query, command],
      tools: [query, command].map((feature) => ({
        feature,
        title: feature.name,
        idempotent: true,
        openWorld: false,
      })),
      mean: Mean.no,
      server: { name: "read-model-proof", version: "1" },
      resource: protectedResource({ resource, authorizationServers: ["https://issuer.example"] }),
      who: {
        resolve: (incoming) => {
          const token = incoming.headers.get("authorization");
          return token === "Bearer ada" || token === "Bearer bob"
            ? Effect.succeed(token === "Bearer ada" ? ada : bob)
            : Effect.fail(
                new Refused({
                  status: 401,
                  code: "token_invalid",
                  message: "Send a valid token as Authorization: Bearer <token>.",
                  challenge,
                }),
              );
        },
      },
    });
    const app = composition({
      features: [query, command, hidden],
      ways: [way],
      system: [],
      may: Effect.succeed({
        permissionsOf: (caller) => {
          checks.push(caller.actor.id);
          return Effect.succeed(caller.actor.id === ada.id ? (["counter:read"] as const) : []);
        },
      }),
      modules: {
        mounts: [
          {
            service,
            operations: [read],
            layer: Layer.empty,
            bind: () => [
              bindOperation(read, ({ value }, scope) =>
                Effect.sync(() => {
                  expect(scope.caller.kind).toBe("person");
                  const actorId = scope.caller.kind === "person" ? scope.caller.actor.id : "system";
                  calls.push(actorId);
                  return { value, actorId };
                }),
              ),
            ],
          },
        ],
        layer: Layer.mergeAll(
          memoryUnitOfWork,
          Layer.succeed(StepTrace, trace),
          Layer.succeed(CallWatch, {
            around: (entry, _input, run) => {
              seen.push(`${entry.kind}:${entry.name}`);
              return run;
            },
          }),
        ),
      },
    });
    const router = toFetchHandler(app);
    return { app, router, query, command, calls, seen, checks, trace };
  }),
  ({ router, app }) => Effect.promise(() => router.dispose().then(() => app.dispose())),
);

it.effect(
  "MCP lists a directly exposed query with readOnlyHint without reclassifying a command",
  () =>
    Effect.gen(function* () {
      const t = yield* fixture;
      const session = yield* openMcpSession(t.router, { authorization: "Bearer ada" });
      expect(session["mcp-session-id"]).not.toBe("");
      const listed = yield* mcpPost(t.router, session, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      });
      expect(listed.status).toBe(200);
      const tools = listed.messages.find((message) => message.id === 2)?.result?.["tools"];
      expect(tools).toEqual([
        expect.objectContaining({
          name: "query",
          annotations: expect.objectContaining({ readOnlyHint: true, idempotentHint: true }),
        }),
        expect.objectContaining({
          name: "command",
          annotations: expect.objectContaining({ readOnlyHint: true, idempotentHint: true }),
        }),
      ]);
      expect(t.query.kind).toBe("read-model");
      expect(t.command.kind).toBe("feature");
      for (const name of ["query", "command"]) {
        const called = yield* callMcpTool(t.router, session, name, { value: 7 });
        expect(called.answer.status).toBe(200);
        expect(called.result).toMatchObject({
          isError: false,
          structuredContent: { value: 7, actorId: "ada" },
        });
      }
      expect(t.seen).toEqual(["read-model:query", "feature:command"]);
      expect(t.calls).toEqual(["ada", "ada"]);
      expect(t.checks).toEqual(["ada", "ada"]);
      const hidden = yield* callMcpTool(t.router, session, "hidden", { value: 7 });
      expect(hidden.result).toBeUndefined();
      expect(hidden.answer.messages.find((message) => message.id === 7)?.error).toMatchObject({
        code: -32602,
        message: "Tool 'hidden' not found",
      });
      expect(t.calls).toEqual(["ada", "ada"]);
      expect(t.seen).toEqual(["read-model:query", "feature:command"]);
    }).pipe(Effect.scoped),
);

it.effect(
  "MCP query checks the admitted actor's May closure and audits refusal before operation work",
  () =>
    Effect.gen(function* () {
      const t = yield* fixture;
      const session = yield* openMcpSession(t.router, { authorization: "Bearer bob" });
      const denied = yield* callMcpTool(t.router, session, "query", { value: 7 });
      expect(denied.result).toMatchObject({ isError: true });
      expect(JSON.stringify(denied.result)).toContain("forbidden");
      expect(t.calls).toEqual([]);
      expect(t.checks).toEqual(["bob"]);
      expect(t.seen).toEqual(["read-model:query"]);
      const allowed = yield* callMcpTool(
        t.router,
        { ...session, authorization: "Bearer ada" },
        "query",
        { value: 7 },
      );
      expect(allowed.result).toMatchObject({
        isError: false,
        structuredContent: { value: 7, actorId: "ada" },
      });
      expect(t.checks).toEqual(["bob", "ada"]);
      expect(t.calls).toEqual(["ada"]);
      expect(
        (yield* t.trace.read(allowed.answer.headers.get("x-request-id") ?? "")).steps[0],
      ).toMatchObject({ feature: "query", target: "Counter.read", outcome: "success" });
    }).pipe(Effect.scoped),
);

it.effect(
  "MCP query rechecks bearer admission on sessions and rejects invalid input before execution",
  () =>
    Effect.gen(function* () {
      const t = yield* fixture;
      for (const headers of [{}, { authorization: "Bearer invalid" }]) {
        const denied = yield* mcpPost(t.router, headers, mcpInitialize);
        expect(denied.status).toBe(401);
        expect(denied.headers.get("www-authenticate")).toContain(resourceMetadata);
      }
      const session = yield* openMcpSession(t.router, { authorization: "Bearer ada" });
      for (const authorization of ["", "Bearer invalid"]) {
        const denied = yield* callMcpTool(t.router, { ...session, authorization }, "query", {
          value: 7,
        });
        expect(denied.answer.status).toBe(401);
        expect(denied.answer.headers.get("www-authenticate")).toContain(resourceMetadata);
      }
      const invalid = yield* callMcpTool(t.router, session, "query", { value: "bad" });
      expect(invalid.result?.["isError"]).toBe(true);
      expect(JSON.stringify(invalid.result)).toContain("Invalid parameters");
      expect(t.calls).toEqual([]);
      expect(t.checks).toEqual([]);
      expect(t.seen).toEqual([]);
    }).pipe(Effect.scoped),
);
