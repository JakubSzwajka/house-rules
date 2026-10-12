import { Effect } from "effect";
import { webRequest } from "./delivery-fixtures.ts";

export type RpcMessage = Readonly<{
  id?: number;
  result?: Record<string, unknown>;
  error?: unknown;
}>;

export type RpcAnswer = Readonly<{
  status: number;
  headers: Headers;
  messages: ReadonlyArray<RpcMessage>;
}>;

const messagesOf = (text: string): ReadonlyArray<RpcMessage> =>
  text.trimStart().startsWith("data:") || text.trimStart().startsWith("event:")
    ? text
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => JSON.parse(line.slice(6)) as RpcMessage)
    : text === ""
      ? []
      : [JSON.parse(text) as RpcMessage];

export const mcpPost = (
  handler: (request: Request) => Promise<Response>,
  headers: Readonly<Record<string, string>>,
  body: unknown,
): Effect.Effect<RpcAnswer> =>
  Effect.promise(() =>
    handler(
      webRequest("https://app.example/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...headers,
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
          messages: response.status === 200 ? messagesOf(text) : [],
        })),
      ),
    ),
  );

export const mcpInitialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "test-client", version: "1" },
  },
} as const;

export const openMcpSession = (
  handler: (request: Request) => Promise<Response>,
  headers: Readonly<Record<string, string>> = {},
): Effect.Effect<Record<string, string>> =>
  Effect.gen(function* openSession() {
    const init = yield* mcpPost(handler, headers, mcpInitialize);
    const session = {
      ...headers,
      "mcp-session-id": init.headers.get("mcp-session-id") ?? "",
      "mcp-protocol-version": "2025-11-25",
    };
    yield* mcpPost(handler, session, { jsonrpc: "2.0", method: "notifications/initialized" });
    return session;
  });

export const callMcpTool = (
  handler: (request: Request) => Promise<Response>,
  session: Readonly<Record<string, string>>,
  name: string,
  args: unknown,
): Effect.Effect<Readonly<{ answer: RpcAnswer; result: Record<string, unknown> | undefined }>> =>
  mcpPost(handler, session, {
    jsonrpc: "2.0",
    id: 7,
    method: "tools/call",
    params: { name, arguments: args },
  }).pipe(
    Effect.map((answer) => ({
      answer,
      result: answer.messages.find((message) => message.id === 7)?.result,
    })),
  );
