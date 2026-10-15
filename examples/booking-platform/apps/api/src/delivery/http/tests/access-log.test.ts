import { afterAll, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { app } from "../../../composition/index.js";
import { callNotes } from "../../../composition/request-log.js";
import { handler, web } from "../../../main.js";
import { formatAccessLine, logRequests } from "../access-log.js";

afterAll(() => handler.dispose().then(app.dispose));

const credentials = { email: "log@example.test", password: "a long enough secret" };
const post = (path: string, body: unknown) =>
  handler(
    new Request(`https://booking.example/api${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://booking.example" },
      body: JSON.stringify(body),
    }),
  );

const token = Effect.promise(() =>
  post("/sign-up", { ...credentials, displayName: "Log" })
    .then(() => post("/token", credentials))
    .then((response) => response.json())
    .then((body: { token: string }) => body.token),
);

const read = (id: string, requestId: string, bearer: string) =>
  new Request(`https://booking.example/api/bookings/${id}`, {
    headers: { "x-request-id": requestId, authorization: `Bearer ${bearer}` },
  });

it.live("the CallWatch notes each call's capability, actor and outcome under its request id", () =>
  Effect.gen(function* notes() {
    const bearer = yield* token;
    yield* Effect.promise(() => web(read("demo", "req-note-ok", bearer)));
    const note = callNotes.take("req-note-ok");
    expect(note).toMatchObject({ capability: "show_booking", outcome: "ok" });
    expect(note?.actor).toMatch(/^[0-9a-f]+$/u);
    yield* Effect.promise(() => web(read("missing", "req-note-missing", bearer)));
    expect(callNotes.take("req-note-missing")).toMatchObject({ outcome: "BookingNotFound" });
  }),
);

it.live("the access log joins the note and leaves nothing behind", () =>
  Effect.gen(function* joins() {
    const response = yield* logRequests(
      web,
      callNotes,
    )(read("demo", "req-note-joined", yield* token));
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
