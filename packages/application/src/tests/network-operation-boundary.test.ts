import { expect, it } from "@effect/vitest";
import { defineOperation, memoryUnitOfWork } from "@house-rules/domain";
import { Context, Effect, Layer, Schema } from "effect";
import { HttpServerRequest } from "effect/http";
import {
  bindOperation,
  composition,
  defineFeature,
  defineWay,
  endpoint,
  May,
  Mean,
  protectedResource,
  StepTrace,
  toFetchHandler,
} from "../index.ts";
import { webRequest } from "./delivery-fixtures.ts";
import { testActor } from "./execution-fixtures.ts";
import { callMcpTool, openMcpSession } from "./delivery-mcp-client.ts";

it.effect(
  "HTTP and MCP feature handlers and inner operations share a credential-free context",
  () =>
    Effect.gen(function* () {
      const credentials = {
        authorization: "Bearer operation-boundary",
        cookie: "session=operation-cookie",
        "proxy-authorization": "Basic operation-proxy",
        "set-cookie": "secret=operation-cookie",
      };
      let inspected = 0;
      const inspect = Effect.gen(function* () {
        const context = yield* Effect.context();
        const scope = context.mapUnsafe.get("@house-rules/application/CallerScope") as
          | { incoming: { headers: Headers } }
          | undefined;
        const request = Context.getOrUndefined(context, HttpServerRequest.HttpServerRequest);
        for (const name of Object.keys(credentials)) {
          expect(request?.headers[name]).toBeUndefined();
          expect(scope?.incoming.headers.has(name) ?? false).toBe(false);
        }
        inspected++;
      });
      const operation = defineOperation("inspectOperation", {
        description: "Inspect operation context.",
        input: Schema.Struct({ id: Schema.String }),
        output: Schema.String,
        failure: Schema.Never,
        permission: null,
        readOnly: true,
      });
      const feature = defineFeature("inspectFeature", {
        ...operation,
        edges: [operation],
        flags: { readOnly: true, transactional: false, destructive: false, needsApproval: false },
        handler: (input, { call }) => inspect.pipe(Effect.andThen(call(operation, input))),
      });
      const who = { resolve: () => Effect.succeed(testActor) };
      const http = defineWay({
        name: "web",
        path: "/",
        protocol: "http",
        features: [feature],
        who,
        mean: Mean.no,
        endpoints: [endpoint(feature, "GET /inspect/:id")],
      });
      const mcp = defineWay({
        name: "mcp",
        path: "/mcp",
        protocol: "mcp",
        features: [feature],
        who,
        mean: Mean.no,
        server: { name: "boundary", version: "1" },
        resource: protectedResource({
          resource: "https://app.example/mcp",
          authorizationServers: ["https://issuer.example"],
        }),
        tools: [{ feature, title: "Inspect", idempotent: true, openWorld: false }],
      });
      const service = Context.Reference<undefined>("test/boundary", {
        defaultValue: () => undefined,
      });
      const app = composition({
        modules: {
          mounts: [
            {
              service,
              operations: [operation],
              layer: Layer.empty,
              bind: () => [bindOperation(operation, () => inspect.pipe(Effect.as("checked")))],
            },
          ],
          layer: Layer.merge(memoryUnitOfWork, StepTrace.layer()),
        },
        features: [feature],
        ways: [http, mcp],
        may: Effect.succeed(May.fixed([])),
        system: [],
      });
      const handler = toFetchHandler(app);
      try {
        const response = yield* Effect.promise(() =>
          handler(webRequest("https://app.example/inspect/one", { headers: credentials })),
        );
        expect(response.status).toBe(200);
        const session = yield* openMcpSession(handler, credentials);
        const result = yield* callMcpTool(handler, session, feature.name, { id: "one" });
        expect(result.result?.["isError"]).toBe(false);
        expect(inspected).toBe(4);
      } finally {
        yield* Effect.promise(() => handler.dispose().then(() => app.dispose()));
      }
    }),
);
