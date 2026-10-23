import { expect, it } from "@effect/vitest";
import { defineOperation } from "@house-rules/domain";
import { Effect, Option, Schema } from "effect";
import { McpSchema } from "effect/ai";
import { HttpServerRequest } from "effect/http";
import { CallRequestId, CallerContext, endpoint } from "../index.ts";
import { bindFixture, testActor } from "./execution-fixtures.ts";
import { featureFixture } from "./feature-fixtures.ts";
import { webRequest } from "./delivery-fixtures.ts";
import { callMcpTool, openMcpSession } from "./delivery-mcp-client.ts";
import { httpFixture, mcpFixture } from "./router-fixtures.ts";

const credentials = {
  authorization: "Bearer boundary-test",
  cookie: "session=boundary-cookie",
  "proxy-authorization": "Basic boundary-proxy",
  "set-cookie": "hidden=boundary-set-cookie",
};

const inspectContext = Effect.gen(function* () {
  const context = yield* Effect.context();
  const request = Option.getOrUndefined(
    yield* Effect.serviceOption(HttpServerRequest.HttpServerRequest),
  );
  const scope = context.mapUnsafe.get("@house-rules/application/CallerScope") as
    | { incoming: { headers: Headers } }
    | undefined;
  for (const name of Object.keys(credentials)) {
    expect(request?.headers[name]).toBeUndefined();
    expect(scope?.incoming.headers.get(name) ?? null).toBeNull();
  }
  return yield* Effect.serviceOption(CallRequestId);
});

it.effect(
  "HTTP handlers cannot recover credential headers from Effect.context or CallerScope",
  () =>
    Effect.gen(function* () {
      let inspected = false;
      let admitted = 0;
      const read = bindFixture(
        featureFixture(
          defineOperation("http_boundary", {
            description: "Inspect the HTTP boundary.",
            input: Schema.Struct({ id: Schema.String }),
            output: Schema.String,
            failure: Schema.Never,
            permission: null,
            readOnly: true,
          }),
        ),
        () =>
          Effect.gen(function* () {
            expect(Option.getOrUndefined(yield* inspectContext)).toBe("http-boundary");
            inspected = true;
            return "checked";
          }),
      );
      const fixture = httpFixture([read], {
        endpoints: [endpoint(read, "GET /inspect/:id")],
        who: {
          resolve: (incoming) =>
            Effect.sync(() => {
              for (const [name, value] of Object.entries(credentials))
                expect(incoming.headers.get(name)).toBe(value);
              admitted += 1;
              return testActor;
            }),
        },
      });
      try {
        const response = yield* Effect.promise(() =>
          fixture.handler(
            webRequest("https://app.example/inspect/one", {
              headers: { ...credentials, "x-request-id": "http-boundary" },
            }),
          ),
        );
        expect(response.status).toBe(200);
        expect(response.headers.get("x-request-id")).toBe("http-boundary");
        expect(inspected).toBe(true);
        expect(admitted).toBe(1);
      } finally {
        yield* Effect.promise(fixture.dispose);
      }
    }),
);

it.effect(
  "MCP handlers cannot recover credential headers from Effect.context or CallerScope across session calls",
  () =>
    Effect.gen(function* () {
      const token = "boundary-test-bearer";
      let observed: unknown;
      let admitted = 0;
      const read = bindFixture(
        featureFixture(
          defineOperation("inspect_boundary", {
            description: "Inspect the handler boundary.",
            input: Schema.Struct({ id: Schema.String }),
            output: Schema.String,
            failure: Schema.Never,
            permission: null,
            readOnly: true,
          }),
        ),
        (_input, { caller }) =>
          Effect.gen(function* () {
            expect(Option.getOrUndefined(yield* inspectContext)).toBe("mcp-boundary");
            expect(Option.isSome(yield* Effect.serviceOption(McpSchema.McpServerClient))).toBe(
              true,
            );
            const callerContext = yield* Effect.serviceOption(CallerContext);
            const request = yield* Effect.serviceOption(HttpServerRequest.HttpServerRequest);
            const mcp = yield* Effect.serviceOption(McpSchema.McpRequestContext);
            observed = {
              caller,
              callerContext: Option.getOrUndefined(callerContext),
              mcp: Option.getOrUndefined(mcp),
            };
            expect(Option.getOrUndefined(request)?.headers.authorization).toBeUndefined();
            expect(JSON.stringify(observed)).not.toContain(token);
            expect(JSON.stringify(observed).toLowerCase()).not.toContain("authorization");
            expect(caller.kind).toBe("person");
            return "checked";
          }),
      );
      const fixture = mcpFixture([read], {
        who: {
          resolve: (incoming) =>
            Effect.sync(() => {
              expect(incoming.headers.get("authorization")).toBe(`Bearer ${token}`);
              expect(incoming.headers.get("cookie")).toBe(credentials.cookie);
              admitted += 1;
              return testActor;
            }),
        },
        tools: [{ feature: read, title: "Inspect", idempotent: true, openWorld: false }],
      });
      try {
        const session = yield* openMcpSession(fixture.handler, {
          ...credentials,
          authorization: `Bearer ${token}`,
          "x-request-id": "mcp-boundary",
        });
        expect(session["mcp-session-id"]).not.toBe("");
        for (let i = 0; i < 2; i++) {
          const result = yield* callMcpTool(fixture.handler, session, read.name, { id: "one" });
          expect(result.answer.status).toBe(200);
          expect(result.answer.headers.get("x-request-id")).toBe("mcp-boundary");
          expect(result.result?.["isError"]).toBe(false);
        }
        expect(observed).toBeDefined();
        expect(admitted).toBeGreaterThan(0);
      } finally {
        yield* Effect.promise(fixture.dispose);
      }
    }),
);
