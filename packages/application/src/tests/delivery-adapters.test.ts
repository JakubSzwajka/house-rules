import { featureFixture } from "./feature-fixtures.ts";
import { afterAll, expect, it } from "@effect/vitest";
import { defineOperation } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import {
  Approval,
  CallRequestId,
  composition,
  defineWay,
  endpoint,
  May,
  Mean,
  protectedResource,
  toFetchHandler,
} from "../index.ts";
import { makeApp, showBooking, webRequest } from "./delivery-fixtures.ts";
import { bindFixture, fixtureLayer, testActor } from "./execution-fixtures.ts";
import { mcpFixture } from "./router-fixtures.ts";
import { callMcpTool, mcpInitialize, mcpPost, openMcpSession } from "./delivery-mcp-client.ts";
const t = makeApp();
const one = makeApp({ path: "/one", endpoints: [endpoint(showBooking, "GET /bookings/:id")] });
const two = makeApp({ path: "/two", endpoints: [endpoint(showBooking, "GET /bookings/:id")] });
let approvedRuns = 0;
const approved = bindFixture(
  featureFixture(
    defineOperation("approved_action", {
      description: "Needs a human's yes.",
      input: Schema.Struct({ note: Schema.optionalKey(Schema.String) }),
      output: Schema.Struct({ ran: Schema.Boolean }),
      failure: Schema.Never,
      permission: null,
      needsApproval: true,
    }),
  ),
  () =>
    Effect.sync(() => {
      approvedRuns += 1;
      return { ran: true };
    }),
);
const features = [approved] as const;
const plugs = {
  features,
  who: { resolve: () => Effect.succeed(testActor) },
};
const http = defineWay({
  ...plugs,
  name: "http",
  path: "/http",
  protocol: "http",
  endpoints: [endpoint(approved)],
  mean: Mean.no,
});
const trusted = defineWay({
  ...plugs,
  name: "trusted",
  path: "/trusted",
  protocol: "http",
  endpoints: [endpoint(approved)],
  mean: Mean.allow,
});
const mcp = defineWay({
  ...plugs,
  name: "mcp",
  path: "/mcp",
  protocol: "mcp",
  mean: Mean.elicitation,
  resource: protectedResource({
    resource: "https://app.example/mcp",
    authorizationServers: ["https://issuer.example"],
  }),
  server: { name: "approval", version: "1" },
  tools: [{ feature: approved, title: "Approved", idempotent: false, openWorld: false }],
});
const yesMan = composition({
  layer: fixtureLayer(features).pipe(Layer.provideMerge(Approval.allowAll)),
  features: features,
  ways: [http, trusted, mcp],
  may: May.fixed([]),
  system: [],
});
const yesManRouter = toFetchHandler(yesMan);
const admissionIds: Array<string | null> = [];
const echo = bindFixture(
  featureFixture(
    defineOperation("echo_request_id", {
      description: "Echo the id seen by the tool.",
      input: Schema.Struct({ note: Schema.optionalKey(Schema.String) }),
      output: Schema.Struct({ requestId: Schema.String }),
      failure: Schema.Never,
      permission: null,
      readOnly: true,
    }),
  ),
  () => Effect.map(CallRequestId, (id) => ({ requestId: id ?? "none" })),
);
const echoApp = mcpFixture([echo], {
  tools: [{ feature: echo, title: "Echo", idempotent: true, openWorld: false }],
  who: {
    resolve: () =>
      Effect.gen(function* () {
        admissionIds.push(yield* CallRequestId);
        return testActor;
      }),
  },
});
const sameOne = toFetchHandler(t.app);
const sameTwo = toFetchHandler(t.app);
afterAll(() =>
  Promise.all([
    sameOne.dispose(),
    sameTwo.dispose(),
    one.dispose(),
    two.dispose(),
    echoApp.dispose(),
    yesManRouter.dispose(),
  ])
    .then(() => yesMan.dispose())
    .then(t.dispose),
);
const status = (handler: (request: Request) => Promise<Response>, request: Request) =>
  Effect.map(
    Effect.promise(() => handler(request)),
    (response) => response.status,
  );
it.effect(
  "the router dispatches MCP itself and refuses an unauthenticated initialize before callables",
  () =>
    Effect.gen(function* () {
      const before = { ...t.work };
      const result = yield* mcpPost(t.router, {}, mcpInitialize);
      expect(result.status).toBe(401);
      expect(result.headers.get("www-authenticate")).toContain("resource_metadata");
      expect(t.work).toEqual(before);
    }),
);
it.effect("each composition's router serves only its configured ways", () =>
  Effect.gen(function* () {
    expect(
      yield* status(
        one.router,
        webRequest("https://app.example/two/bookings/b-1", {
          headers: { authorization: "Bearer tok-ada" },
        }),
      ),
    ).toBe(404);
    expect(
      yield* status(
        two.router,
        webRequest("https://app.example/one/bookings/b-1", {
          headers: { authorization: "Bearer tok-ada" },
        }),
      ),
    ).toBe(404);
  }),
);
it.effect(
  "two routers on one composition can serve the same path without a global route table",
  () =>
    Effect.gen(function* () {
      for (const handler of [sameOne, sameTwo])
        expect(
          yield* status(
            handler,
            webRequest("https://app.example/api/bookings/b-1", {
              headers: { authorization: "Bearer tok-ada" },
            }),
          ),
        ).toBe(200);
    }),
);
it.effect("a root Approval allow plug cannot beat an HTTP way's Mean.no", () =>
  Effect.gen(function* () {
    const before = approvedRuns;
    const result = yield* Effect.promise(() =>
      yesManRouter(
        webRequest("https://app.example/http/approved_action", { method: "POST", body: "{}" }),
      ),
    );
    expect(result.status).toBe(403);
    expect(yield* Effect.promise(() => result.json())).toMatchObject({
      error: { code: "forbidden" },
    });
    expect(approvedRuns).toBe(before);
  }),
);
it.effect("an explicitly trusted way supplies its own Mean.allow", () =>
  Effect.gen(function* () {
    expect(
      yield* status(
        yesManRouter,
        webRequest("https://app.example/trusted/approved_action", { method: "POST", body: "{}" }),
      ),
    ).toBe(200);
  }),
);
it.effect("a root Approval allow plug cannot beat MCP elicitation", () =>
  Effect.gen(function* () {
    const before = approvedRuns;
    const session = yield* openMcpSession(yesManRouter, { authorization: "Bearer fixture" });
    const { result } = yield* callMcpTool(yesManRouter, session, "approved_action", {});
    expect(result?.["isError"]).toBe(true);
    expect(JSON.stringify(result)).toContain("forbidden");
    expect(approvedRuns).toBe(before);
  }),
);
it.effect("MCP keeps one request id from Who through the tool and response", () =>
  Effect.gen(function* () {
    const session = yield* openMcpSession(echoApp.handler, { authorization: "Bearer fixture" });
    const fresh = yield* callMcpTool(echoApp.handler, session, "echo_request_id", {});
    const id = fresh.answer.headers.get("x-request-id");
    expect(id).toMatch(/^[0-9a-f]{32}$/u);
    expect(fresh.result?.["structuredContent"]).toEqual({ requestId: id });
    expect(admissionIds.at(-1)).toBe(id);
    const kept = yield* callMcpTool(
      echoApp.handler,
      { ...session, "x-request-id": "mcp-kept-1" },
      "echo_request_id",
      {},
    );
    expect(kept.answer.headers.get("x-request-id")).toBe("mcp-kept-1");
    expect(kept.result?.["structuredContent"]).toEqual({ requestId: "mcp-kept-1" });
    expect(admissionIds.at(-1)).toBe("mcp-kept-1");
  }),
);
