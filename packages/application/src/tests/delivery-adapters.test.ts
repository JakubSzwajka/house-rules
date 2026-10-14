import { afterAll, expect, it } from "@effect/vitest";
import { Context, Effect, Layer, Option, Schema } from "effect";
import {
  Approval,
  CallRequestId,
  composition,
  defineContract,
  implement,
  route,
  toFetchHandler,
  toMcpHandler,
  tool,
} from "../index.ts";
import { bearerCallerFor, makeApp, showBooking, webRequest } from "./delivery-fixtures.ts";
import { callMcpTool, mcpInitialize, mcpPost, openMcpSession } from "./delivery-mcp-client.ts";

const t = makeApp();

const status = (handler: (request: Request) => Promise<Response>, request: Request) =>
  Effect.promise(() => handler(request)).pipe(Effect.map((response) => response.status));

const noteInput = Schema.Struct({ note: Schema.optionalKey(Schema.String) });

let approvedRuns = 0;
const approved = implement(
  defineContract("approved_action", {
    description: "Needs a human's yes.",
    input: noteInput,
    output: Schema.Struct({ ran: Schema.Boolean }),
    failure: Schema.Never,
    permission: "public",
    needsApproval: true,
  }),
  () =>
    Effect.sync(() => {
      approvedRuns += 1;
      return { ran: true };
    }),
);

const yesMan = composition({
  layer: Layer.empty,
  caller: () => Effect.succeed(Context.make(Approval, { approve: () => Effect.void })),
});
const yesManHttp = toFetchHandler(yesMan, { routes: [route(approved)] });
const yesManTrusted = toFetchHandler(yesMan, {
  approval: "fromCaller",
  routes: [route(approved, "POST /trusted")],
});
const yesManMcp = toMcpHandler(yesMan, {
  path: "/mcp",
  name: "approval",
  version: "1",
  tools: [tool(approved, { title: "Approved", idempotent: false, openWorld: false })],
});

const admissionIds: Array<string> = [];
const echo = implement(
  defineContract("echo_request_id", {
    description: "Answers with the request id the tool ran under.",
    input: noteInput,
    output: Schema.Struct({ requestId: Schema.String }),
    failure: Schema.Never,
    permission: "public",
    annotations: { readOnly: true },
  }),
  () =>
    Effect.serviceOption(CallRequestId).pipe(
      Effect.map((id) => ({ requestId: Option.getOrUndefined(id) ?? "none" })),
    ),
);
const echoApp = composition({
  layer: Layer.empty,
  caller: () =>
    Effect.serviceOption(CallRequestId).pipe(
      Effect.map((id) => {
        admissionIds.push(Option.getOrUndefined(id) ?? "none");
        return Context.empty();
      }),
    ),
});
const echoMcp = toMcpHandler(echoApp, {
  path: "/mcp",
  name: "echo",
  version: "1",
  tools: [tool(echo, { title: "Echo", idempotent: true, openWorld: false })],
});

const sameOne = toFetchHandler(t.app, {
  caller: bearerCallerFor(t.work),
  routes: [route(showBooking, "GET /same/:id")],
});
const sameTwo = toFetchHandler(t.app, {
  caller: bearerCallerFor(t.work),
  routes: [route(showBooking, "GET /same/:id")],
});

afterAll(() =>
  Promise.all(
    [yesManHttp, yesManTrusted, yesManMcp, echoMcp, sameOne, sameTwo].map((h) => h.dispose()),
  )
    .then(() => Promise.all([yesMan.dispose(), echoApp.dispose()]))
    .then(t.dispose),
);

it.effect("the HTTP handler never answers MCP, not even an unauthenticated initialize", () =>
  Effect.gen(function* noMcpOverHttp() {
    const before = { ...t.work };
    const initialize = yield* mcpPost(t.api, {}, mcpInitialize);
    expect(initialize.status).toBe(404);
    expect(initialize.messages).toEqual([]);
    expect(t.work).toEqual(before);
  }),
);

it.effect("an HTTP handler serves only its own routes", () =>
  Effect.gen(function* ownRoutesOnly() {
    const webRoute = webRequest("https://app.example/web/bookings/b-1", {
      headers: { cookie: "session=s-ada" },
    });
    expect(yield* status(t.api, webRoute)).toBe(404);
    const apiRoute = webRequest("https://app.example/api/bookings/b-1", {
      headers: { authorization: "Bearer tok-ada" },
    });
    expect(yield* status(t.web, apiRoute)).toBe(404);
  }),
);

it.effect("two handlers on one composition may mount the same path", () =>
  Effect.gen(function* samePath() {
    const get = () =>
      webRequest("https://app.example/same/b-1", { headers: { authorization: "Bearer tok-ada" } });
    expect(yield* status(sameOne, get())).toBe(200);
    expect(yield* status(sameTwo, get())).toBe(200);
  }),
);

it.effect("a caller's own Approval does not beat HTTP's denyAll", () =>
  Effect.gen(function* httpApprovalHolds() {
    const before = approvedRuns;
    const r = yield* Effect.promise(() =>
      yesManHttp(webRequest("https://app.example/approved_action", { method: "POST", body: "{}" })),
    );
    expect(r.status).toBe(403);
    expect(yield* Effect.promise(() => r.json())).toMatchObject({
      error: { code: "approval_denied" },
    });
    expect(approvedRuns).toBe(before);
  }),
);

it.effect("approval: fromCaller lets the caller's Approval decide, by name", () =>
  Effect.gen(function* optedIn() {
    const r = yield* status(
      yesManTrusted,
      webRequest("https://app.example/trusted", { method: "POST", body: "{}" }),
    );
    expect(r).toBe(200);
  }),
);

it.effect("a caller's own Approval does not beat MCP elicitation", () =>
  Effect.gen(function* mcpApprovalHolds() {
    const before = approvedRuns;
    const session = yield* openMcpSession(yesManMcp);
    const { result } = yield* callMcpTool(yesManMcp, session, "approved_action", {});
    expect(result?.["isError"]).toBe(true);
    expect(JSON.stringify(result)).toMatch(/approval_denied/u);
    expect(approvedRuns).toBe(before);
  }),
);

it.effect("MCP keeps one request id from admission to the tool and the response", () =>
  Effect.gen(function* mcpRequestIds() {
    const session = yield* openMcpSession(echoMcp);
    const fresh = yield* callMcpTool(echoMcp, session, "echo_request_id", {});
    const freshId = fresh.answer.headers.get("x-request-id");
    expect(freshId).toMatch(/^[0-9a-f]{32}$/u);
    expect(fresh.result?.["structuredContent"]).toEqual({ requestId: freshId });
    expect(admissionIds.at(-1)).toBe(freshId);
    const kept = yield* callMcpTool(
      echoMcp,
      { ...session, "x-request-id": "mcp-kept-1" },
      "echo_request_id",
      {},
    );
    expect(kept.answer.headers.get("x-request-id")).toBe("mcp-kept-1");
    expect(kept.result?.["structuredContent"]).toEqual({ requestId: "mcp-kept-1" });
    expect(admissionIds.at(-1)).toBe("mcp-kept-1");
  }),
);
