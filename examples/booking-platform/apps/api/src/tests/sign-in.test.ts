import { expect, it } from "@effect/vitest";
import { composition, toFetchHandler } from "@house-rules/application";
import { AuthJwtTesting } from "@house-rules/auth-jwt";
import { Effect, Option } from "effect";
import { memoryAppLayer } from "../composition/app-layer.js";
import { webCaller } from "../composition/index.js";
import { bookingViews } from "../composition/views.js";
import { memberRoutes } from "../delivery/http/routes.js";

const issuer = "https://id.example";

const signedInApi = Effect.acquireRelease(
  Effect.gen(function* mount() {
    const keys = yield* AuthJwtTesting.keys;
    const app = composition({
      layer: memoryAppLayer(Option.some({ issuer, jwks: keys.jwks })),
      caller: webCaller,
      views: bookingViews,
    });
    const api = toFetchHandler(app, { prefix: "/api", routes: memberRoutes });
    const tokenFor = (claims: Readonly<Record<string, unknown>>) =>
      keys.sign({ iss: issuer, ...claims });
    return { api, app, tokenFor };
  }),
  ({ api, app }) => Effect.promise(() => api.dispose().then(() => app.dispose())),
);

type Api = (request: Request) => Promise<Response>;

const send = (api: Api, method: string, path: string, token?: string, body?: unknown) =>
  Effect.promise(() =>
    api(
      new Request(`https://hosti.example/api${path}`, {
        method,
        headers: {
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }) as Request,
    ),
  ).pipe(
    Effect.flatMap((response) =>
      Effect.promise(() => response.text()).pipe(
        Effect.map((text) => ({
          status: response.status,
          headers: response.headers,
          body: (text === "" ? null : JSON.parse(text)) as Record<string, unknown> | null,
        })),
      ),
    ),
  );

const target = (id: string) => ({ kind: "booking", id });

const authorOf = (answer: { body: Record<string, unknown> | null }) =>
  String(answer.body?.["authorId"]);

it.live("the first request creates a Person and a binding; the same token reuses them", () =>
  Effect.gen(function* firstSignIn() {
    const { api, tokenFor } = yield* signedInApi;
    const alice = yield* tokenFor({ sub: "alice", name: " Alice Example " });

    const booked = yield* send(api, "POST", "/bookings", alice, { id: "b-1", guestName: "Ada" });
    expect(booked).toMatchObject({
      status: 201,
      body: { id: "b-1", guestName: "Ada", status: "active" },
    });
    const first = yield* send(api, "POST", "/add_comment", alice, {
      target: target("b-1"),
      body: "First.",
    });
    expect(first.status).toBe(200);
    const aliceId = authorOf(first);

    const person = yield* send(api, "GET", `/people/${aliceId}`, alice);
    expect(person).toMatchObject({
      status: 200,
      body: { id: aliceId, displayName: "Alice Example" },
    });

    const second = yield* send(api, "POST", "/add_comment", alice, {
      target: target("b-1"),
      body: "Second.",
    });
    expect(authorOf(second)).toBe(aliceId);
  }),
);

it.live("another subject is another person, even with the same email", () =>
  Effect.gen(function* otherSubject() {
    const { api, tokenFor } = yield* signedInApi;
    const email = "shared@example.com";
    const alice = yield* tokenFor({ sub: "alice", name: "Alice", email });
    const bob = yield* tokenFor({ sub: "bob", email });

    yield* send(api, "POST", "/bookings", alice, { id: "b-a", guestName: "Ada" });
    yield* send(api, "POST", "/bookings", bob, { id: "b-b", guestName: "Grace" });
    const fromAlice = yield* send(api, "POST", "/add_comment", alice, {
      target: target("b-a"),
      body: "Mine.",
    });
    const fromBob = yield* send(api, "POST", "/add_comment", bob, {
      target: target("b-b"),
      body: "Mine too.",
    });
    expect(authorOf(fromBob)).not.toBe(authorOf(fromAlice));

    // No `name` claim: a neutral name, never the email.
    const bobPerson = yield* send(api, "GET", `/people/${authorOf(fromBob)}`, bob);
    expect(bobPerson.body).toMatchObject({ displayName: "New member" });

    // Bob cannot comment on Alice's booking: it looks missing to him.
    const onAlices = yield* send(api, "POST", "/add_comment", bob, {
      target: target("b-a"),
      body: "Hi.",
    });
    expect(onAlices).toMatchObject({ status: 404, body: { error: { code: "not_found" } } });
  }),
);

it.live("a missing, malformed or foreign-signed token is a 401", () =>
  Effect.gen(function* badTokens() {
    const { api } = yield* signedInApi;
    const missing = yield* send(api, "GET", "/bookings/demo");
    expect(missing).toMatchObject({ status: 401, body: { error: { code: "token_missing" } } });

    const malformed = yield* send(api, "GET", "/bookings/demo", "not-a-jwt");
    expect(malformed).toMatchObject({ status: 401, body: { error: { code: "token_invalid" } } });

    const otherKeys = yield* AuthJwtTesting.keys;
    const forged = yield* otherKeys.sign({ iss: issuer, sub: "alice" });
    const refused = yield* send(api, "GET", "/bookings/demo", forged);
    expect(refused).toMatchObject({ status: 401, body: { error: { code: "token_invalid" } } });
  }),
);

it.live("a signed-in member books, reads, and edits, lists and removes a comment", () =>
  Effect.gen(function* memberActions() {
    const { api, tokenFor } = yield* signedInApi;
    const carol = yield* tokenFor({ sub: "carol", name: "Carol" });

    expect(yield* send(api, "GET", "/bookings/demo", carol)).toMatchObject({
      status: 200,
      body: { id: "demo", status: "active" },
    });
    yield* send(api, "POST", "/bookings", carol, { id: "b-c", guestName: "Carol" });
    const added = yield* send(api, "POST", "/add_comment", carol, {
      target: target("b-c"),
      body: "Late check-in.",
    });
    const id = String(added.body?.["id"]);

    const edited = yield* send(api, "POST", "/edit_comment", carol, {
      id,
      body: "Early check-in.",
    });
    expect(edited).toMatchObject({ status: 200, body: { id, body: "Early check-in." } });

    const listed = yield* send(api, "POST", "/list_comments", carol, {
      target: target("b-c"),
      page: { size: 20 },
    });
    expect(listed).toMatchObject({
      status: 200,
      body: { items: [{ id, body: "Early check-in." }] },
    });

    const removed = yield* send(api, "POST", "/remove_comment", carol, { id });
    expect(removed.status).toBe(200);
    const after = yield* send(api, "POST", "/list_comments", carol, {
      target: target("b-c"),
      page: { size: 20 },
    });
    expect(after.body).toMatchObject({ items: [] });

    // cancel_booking is not mounted on HTTP.
    const cancel = yield* send(api, "POST", "/cancel_booking", carol, { id: "b-c" });
    expect(cancel.status).toBe(404);
  }),
);
