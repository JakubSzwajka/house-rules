import { Effect } from "effect";

export type RpcMessage = Readonly<{
  id?: number;
  result?: Record<string, unknown>;
  error?: unknown;
}>;

export type RpcAnswer = Readonly<{
  status: number;
  headers: Headers;
  body: string;
  messages: ReadonlyArray<RpcMessage>;
}>;

type Handler = (request: Request) => Promise<Response>;

const messagesOf = (text: string): ReadonlyArray<RpcMessage> =>
  text.trimStart().startsWith("data:") || text.trimStart().startsWith("event:")
    ? text
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => JSON.parse(line.slice(6)) as RpcMessage)
    : text === ""
      ? []
      : [JSON.parse(text) as RpcMessage];

export const mcpUrl = "https://booking.example/mcp";

export const mcpSend = (
  handler: Handler,
  headers: Readonly<Record<string, string>>,
  body: unknown,
  method = "POST",
): Effect.Effect<RpcAnswer> =>
  Effect.promise(() =>
    handler(
      new Request(mcpUrl, {
        method,
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...headers,
        },
        ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
      }) as Request,
    ),
  ).pipe(
    Effect.flatMap((response) =>
      Effect.promise(() => response.text()).pipe(
        Effect.map((text) => ({
          status: response.status,
          headers: response.headers,
          body: text,
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
  handler: Handler,
  headers: Readonly<Record<string, string>>,
): Effect.Effect<Record<string, string>> =>
  Effect.gen(function* openSession() {
    const init = yield* mcpSend(handler, headers, mcpInitialize);
    const session = {
      ...headers,
      "mcp-session-id": init.headers.get("mcp-session-id") ?? "",
      "mcp-protocol-version": "2025-11-25",
    };
    yield* mcpSend(handler, session, { jsonrpc: "2.0", method: "notifications/initialized" });
    return session;
  });

export const mcpRequest = (
  handler: Handler,
  session: Readonly<Record<string, string>>,
  method: string,
  params: unknown,
): Effect.Effect<Record<string, unknown> | undefined> =>
  mcpSend(handler, session, { jsonrpc: "2.0", id: 7, method, params }).pipe(
    Effect.map((answer) => answer.messages.find((message) => message.id === 7)?.result),
  );
