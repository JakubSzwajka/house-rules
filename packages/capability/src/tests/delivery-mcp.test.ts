import { afterAll, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { makeApp, metadataUrl, webRequest } from "./delivery-fixtures.ts";

const t = makeApp();
afterAll(() => t.dispose());

type Message = Readonly<{ id?: number; result?: Record<string, unknown> }>;

type ToolResult = Readonly<{
  isError: boolean;
  content: ReadonlyArray<{ text: string }>;
  structuredContent?: Record<string, unknown>;
}>;

const messagesOf = (text: string): ReadonlyArray<Message> =>
  text.trimStart().startsWith("data:") || text.trimStart().startsWith("event:")
    ? text
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => JSON.parse(line.slice(6)) as Message)
    : text === ""
      ? []
      : [JSON.parse(text) as Message];

const rpc = (token: string | undefined, session: Record<string, string>, body: unknown) =>
  Effect.promise(() =>
    t.mcp(
      webRequest("https://app.example/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
          ...session,
        },
        body: JSON.stringify(body),
      }),
    ),
  ).pipe(
    Effect.flatMap((response) =>
      Effect.promise(() => response.text()).pipe(
        Effect.map((text) => ({
          status: response.status,
          headers: response.headers,
          messages: messagesOf(text),
        })),
      ),
    ),
  );

const open = (token: string) =>
  Effect.gen(function* openSession() {
    const init = yield* rpc(
      token,
      {},
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "demo", version: "1" },
        },
      },
    );
    expect(init.status).toBe(200);
    const session = {
      "mcp-session-id": init.headers.get("mcp-session-id") ?? "",
      "mcp-protocol-version": "2025-11-25",
    };
    yield* rpc(token, session, { jsonrpc: "2.0", method: "notifications/initialized" });
    return session;
  });

const callTool = (token: string, name: string, args: unknown) =>
  Effect.gen(function* callOneTool() {
    const session = yield* open(token);
    const r = yield* rpc(token, session, {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name, arguments: args },
    });
    return r.messages.find((message) => message.id === 7)?.result as ToolResult;
  });

it.effect("no token is a 401 challenge before the MCP server runs", () =>
  Effect.gen(function* noToken() {
    const r = yield* rpc(
      undefined,
      {},
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    );
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toBe(`Bearer resource_metadata="${metadataUrl}"`);
    expect(r.headers.get("x-request-id")).toMatch(/^[0-9a-f]{32}$/u);
  }),
);

it.effect("tools/list takes input schemas from the contracts, a Union root included", () =>
  Effect.gen(function* listsTools() {
    const session = yield* open("tok-ada");
    const r = yield* rpc("tok-ada", session, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    const tools = r.messages.find((message) => message.id === 2)?.result?.[
      "tools"
    ] as ReadonlyArray<{
      name: string;
      inputSchema: { type: string; properties: Record<string, unknown> };
      annotations: Record<string, unknown>;
    }>;
    expect(tools.map((entry) => entry.name)).toEqual([
      "show_booking",
      "find_bookings",
      "cancel_booking",
    ]);
    const find = tools[1];
    expect(find?.inputSchema.type).toBe("object");
    expect(Object.keys(find?.inputSchema.properties ?? {})).toEqual(["by", "guest", "minNights"]);
    expect(tools[2]?.annotations).toMatchObject({ destructiveHint: true, idempotentHint: false });
  }),
);

it.effect("tools/call show_booking answers with structuredContent", () =>
  Effect.gen(function* showsBooking() {
    const result = yield* callTool("tok-ada", "show_booking", { id: "b-1" });
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({ guestName: "Ada" });
  }),
);

it.effect("tools/call find_bookings takes the Union input", () =>
  Effect.gen(function* findsBookings() {
    const result = yield* callTool("tok-ada", "find_bookings", { by: "nights", minNights: 5 });
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual({
      bookings: [{ id: "b-2", owner: "ada", guestName: "Grace", nights: 7 }],
    });
  }),
);

it.effect("a contract failure over MCP is isError with the same view body", () =>
  Effect.gen(function* contractFailure() {
    const result = yield* callTool("tok-ada", "show_booking", { id: "b-3" });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? "")).toEqual({
      error: { code: "not_found", message: "Booking b-3 was not found." },
    });
  }),
);

it.effect("Forbidden over MCP is isError with scope_too_wide, from the caller", () =>
  Effect.gen(function* forbidden() {
    const result = yield* callTool("tok-ada-read", "cancel_booking", { id: "b-1" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/scope_too_wide/u);
  }),
);

it.effect("needsApproval over MCP, with a client that cannot elicit, is approval_denied", () =>
  Effect.gen(function* approvalDenied() {
    const result = yield* callTool("tok-ada", "cancel_booking", { id: "b-1" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/approval_denied/u);
  }),
);

it.effect("an incomplete Union member is refused and names the missing field", () =>
  Effect.gen(function* incompleteUnion() {
    const result = yield* callTool("tok-ada", "find_bookings", { by: "guest" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/guest/u);
  }),
);

it.effect("bad arguments are an isError tool result before the handler runs", () =>
  Effect.gen(function* badArguments() {
    const before = t.work.calls;
    const result = yield* callTool("tok-ada", "find_bookings", { by: "nights", minNights: "five" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/Invalid parameters/u);
    expect(result.content[0]?.text).not.toMatch(/five/u);
    expect(t.work.calls).toBe(before);
  }),
);
