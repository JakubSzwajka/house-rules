import { afterAll, expect, it } from "@effect/vitest";
import { call } from "@house-rules/application";
import { Effect } from "effect";
import { addComment } from "../../../use-cases/comments/add-comment.js";
import { bookBooking } from "../../../use-cases/book-booking.js";
import { mcpRoute } from "../route.js";
import { appWithFakeVerifier, config } from "./fake-verifier.js";
import { mcpRequest, openMcpSession } from "./mcp-client.js";

const app = appWithFakeVerifier();
const mcp = mcpRoute(app, config);
afterAll(() => mcp.dispose().then(() => app.dispose()));

const incoming = { headers: new Headers(), url: "https://hosti.example" };
const target = { kind: "booking", id: "b-1" };

const booked = Effect.promise(() =>
  call(app, bookBooking, { id: "b-1", guestName: "Ada" }, incoming),
);
const commented = Effect.promise(() =>
  call(app, addComment, { target, body: "Late check-in, please." }, incoming),
);

const errorOf = (result: Record<string, unknown> | undefined): unknown => {
  const content = (result?.["content"] ?? []) as ReadonlyArray<{ text?: string }>;
  return JSON.parse(content[0]?.text ?? "null");
};

const toolCall = (session: Record<string, string>, name: string, args: unknown) =>
  mcpRequest(mcp, session, "tools/call", { name, arguments: args });

it.effect("lists only the two read-only tools", () =>
  Effect.gen(function* listsTools() {
    const session = yield* openMcpSession(mcp, { authorization: "Bearer tok-a" });
    const listed = yield* mcpRequest(mcp, session, "tools/list", {});
    const tools = (listed?.["tools"] ?? []) as ReadonlyArray<{
      name: string;
      annotations?: Record<string, unknown>;
    }>;
    expect(tools.map((tool) => tool.name).sort()).toEqual(["list_comments", "show_booking"]);
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    }
  }),
);

it.effect("show_booking returns the public booking, never its owner", () =>
  Effect.gen(function* showsBooking() {
    yield* booked;
    const session = yield* openMcpSession(mcp, { authorization: "Bearer tok-b" });
    const shown = yield* toolCall(session, "show_booking", { id: "b-1" });
    expect(shown?.["isError"]).toBe(false);
    expect(shown?.["structuredContent"]).toEqual({ id: "b-1", guestName: "Ada", status: "active" });
    const missing = yield* toolCall(session, "show_booking", { id: "nobody" });
    expect(missing?.["isError"]).toBe(true);
    expect(errorOf(missing)).toEqual({
      error: { code: "not_found", message: "No booking with id nobody is visible to you." },
    });
  }),
);

it.effect("list_comments shows A's comments to A, and user B cannot read them", () =>
  Effect.gen(function* accessHolds() {
    yield* booked;
    yield* commented;
    const asOwner = yield* openMcpSession(mcp, { authorization: "Bearer tok-a" });
    const own = yield* toolCall(asOwner, "list_comments", { target, page: { size: 20 } });
    expect(own?.["isError"]).toBe(false);
    expect(own?.["structuredContent"]).toMatchObject({
      items: [{ body: "Late check-in, please.", authorId: "actor-a" }],
    });

    const asOther = yield* openMcpSession(mcp, { authorization: "Bearer tok-b" });
    const other = yield* toolCall(asOther, "list_comments", { target, page: { size: 20 } });
    const nowhere = yield* toolCall(asOther, "list_comments", {
      target: { kind: "booking", id: "nobody" },
      page: { size: 20 },
    });
    expect(other?.["isError"]).toBe(true);
    // B learns nothing: the answer is the one a missing booking gets.
    expect(errorOf(other)).toEqual(errorOf(nowhere));
    expect(errorOf(other)).toEqual({
      error: { code: "not_found", message: "No such booking is visible to you." },
    });
  }),
);
