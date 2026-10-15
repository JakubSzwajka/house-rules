import { expect, it } from "@effect/vitest";
import { call } from "@house-rules/application";
import { Effect } from "effect";
import { addComment } from "../../../use-cases/comments/add-comment.js";
import { bookBooking } from "../../../use-cases/book-booking.js";
import { mcpRequest, openMcpSession } from "./mcp-client.js";
import { bearer, incomingWith, mcpMemberCaller, signedInApp } from "./signed-in.js";

const target = { kind: "booking", id: "b-1" };

const errorOf = (result: Record<string, unknown> | undefined): unknown => {
  const content = (result?.["content"] ?? []) as ReadonlyArray<{ text?: string }>;
  return JSON.parse(content[0]?.text ?? "null");
};

type Handler = (request: Request) => Promise<Response>;

const toolCall = (mcp: Handler, session: Record<string, string>, name: string, args: unknown) =>
  mcpRequest(mcp, session, "tools/call", { name, arguments: args });

const aliceBooksAndComments = Effect.gen(function* setUp() {
  const mounted = yield* signedInApp;
  // Alice's MCP identity writes, so her MCP session later reads her own comment.
  const incoming = incomingWith(yield* mounted.mcpToken("alice"));
  const options = { caller: mcpMemberCaller };
  const booked = yield* Effect.promise(() =>
    call(mounted.app, bookBooking, { id: "b-1", guestName: "Ada" }, incoming, options),
  );
  expect(booked.ok).toBe(true);
  const commented = yield* Effect.promise(() =>
    call(mounted.app, addComment, { target, body: "Late check-in, please." }, incoming, options),
  );
  if (!commented.ok) return yield* Effect.die("Alice could not comment");
  return { ...mounted, aliceId: commented.value.authorId };
});

it.live("lists only the two read-only tools", () =>
  Effect.gen(function* listsTools() {
    const { mcp, mcpToken } = yield* signedInApp;
    const session = yield* openMcpSession(mcp, bearer(yield* mcpToken("alice")));
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

it.live("show_booking returns the public booking, never its owner", () =>
  Effect.gen(function* showsBooking() {
    const { mcp, mcpToken } = yield* aliceBooksAndComments;
    const session = yield* openMcpSession(mcp, bearer(yield* mcpToken("bob")));
    const shown = yield* toolCall(mcp, session, "show_booking", { id: "b-1" });
    expect(shown?.["isError"]).toBe(false);
    expect(shown?.["structuredContent"]).toEqual({ id: "b-1", guestName: "Ada", status: "active" });
    const missing = yield* toolCall(mcp, session, "show_booking", { id: "nobody" });
    expect(missing?.["isError"]).toBe(true);
    expect(errorOf(missing)).toEqual({
      error: { code: "not_found", message: "No booking with id nobody is visible to you." },
    });
  }),
);

it.live("list_comments shows A's comments to A, and user B cannot read them", () =>
  Effect.gen(function* accessHolds() {
    const { mcp, mcpToken, aliceId } = yield* aliceBooksAndComments;
    const asOwner = yield* openMcpSession(mcp, bearer(yield* mcpToken("alice")));
    const own = yield* toolCall(mcp, asOwner, "list_comments", { target, page: { size: 20 } });
    expect(own?.["isError"]).toBe(false);
    expect(own?.["structuredContent"]).toMatchObject({
      items: [{ body: "Late check-in, please.", authorId: aliceId }],
    });

    const asOther = yield* openMcpSession(mcp, bearer(yield* mcpToken("bob")));
    const other = yield* toolCall(mcp, asOther, "list_comments", { target, page: { size: 20 } });
    const nowhere = yield* toolCall(mcp, asOther, "list_comments", {
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
