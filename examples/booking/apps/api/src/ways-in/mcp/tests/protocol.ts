import { Effect } from "effect";

type Handler = (request: Request) => Promise<Response>;
type Message = { id?: number; result?: Record<string, unknown>; error?: unknown };
export const rpcTesting = (handler: Handler, headers: Record<string, string>, body: unknown) =>
  Effect.promise(() =>
    handler(
      new Request("https://booking.example/mcp", {
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
          messages:
            response.status !== 200 || text === ""
              ? []
              : text.trimStart().startsWith("data:") || text.trimStart().startsWith("event:")
                ? text
                    .split("\n")
                    .filter((line) => line.startsWith("data: "))
                    .map((line) => JSON.parse(line.slice(6)) as Message)
                : [JSON.parse(text) as Message],
        })),
      ),
    ),
  );
export const sessionTesting = Effect.fnUntraced(function* (
  handler: Handler,
  headers: Record<string, string>,
) {
  const init = yield* rpcTesting(handler, headers, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "booking-test", version: "1" },
    },
  });
  const session = {
    ...headers,
    "mcp-session-id": init.headers.get("mcp-session-id") ?? "",
    "mcp-protocol-version": "2025-11-25",
  };
  yield* rpcTesting(handler, session, { jsonrpc: "2.0", method: "notifications/initialized" });
  return session;
});
export const requestTesting = (
  handler: Handler,
  headers: Record<string, string>,
  method: string,
  params: unknown,
) =>
  rpcTesting(handler, headers, { jsonrpc: "2.0", id: 7, method, params }).pipe(
    Effect.map((answer) => answer.messages.find((message) => message.id === 7)?.result),
  );
