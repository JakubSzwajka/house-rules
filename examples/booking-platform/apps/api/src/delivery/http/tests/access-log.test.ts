import { afterAll, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { app } from "../../../composition/index.js";
import { callNotes } from "../../../composition/request-log.js";
import { handler, web } from "../../../main.js";
import { formatAccessLine, logRequests } from "../access-log.js";

afterAll(() => handler.dispose().then(app.dispose));

const read = (id: string, requestId: string) =>
  new Request(`https://booking.example/api/bookings/${id}`, {
    headers: { "x-request-id": requestId },
  });

it.live("the CallWatch notes each call's capability, actor and outcome under its request id", () =>
  Effect.gen(function* notes() {
    yield* Effect.promise(() => web(read("demo", "req-note-ok")));
    expect(callNotes.take("req-note-ok")).toEqual({
      capability: "show_booking",
      actor: null,
      outcome: "ok",
    });
    yield* Effect.promise(() => web(read("missing", "req-note-missing")));
    expect(callNotes.take("req-note-missing")).toMatchObject({ outcome: "BookingNotFound" });
  }),
);

it.live("the access log joins the note and leaves nothing behind", () =>
  Effect.gen(function* joins() {
    const response = yield* logRequests(web, callNotes)(read("demo", "req-note-joined"));
    expect(response.status).toBe(200);
    expect(callNotes.take("req-note-joined")).toBeUndefined();
  }),
);

it("an access line reads left to right: time, method, path, status, ms, call, actor, request", () => {
  const line = formatAccessLine(
    {
      method: "POST",
      path: "/api/edit_comment",
      status: 404,
      ms: 3,
      requestId: "9b1c2d3e4f5a6b7c",
      capability: "edit_comment",
      outcome: "CommentTargetNotFound",
      actor: "p-bob",
    },
    "21:14:05.120",
  );
  expect(line).toBe(
    "21:14:05.120 POST /api/edit_comment 404 3ms edit_comment:CommentTargetNotFound actor=p-bob req=9b1c2d3e",
  );
});
