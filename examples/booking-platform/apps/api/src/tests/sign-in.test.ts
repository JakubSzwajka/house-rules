import { expect, it } from "@effect/vitest";
import { HttpFailure } from "@house-rules/application";
import { AuthJwtTesting } from "@house-rules/auth-jwt";
import { Effect, Option, Schema } from "effect";
import { localSignIn } from "../composition/sign-in.js";
import { api, publicApi, tokenApi } from "../delivery/http/api.js";
import { memberRoutes, publicRoutes } from "../delivery/http/routes.js";
import { accountsApi, origin, password, rejection } from "./accounts-api.js";

const target = (id: string) => ({ kind: "booking", id });

it.live(
  "sign up, then sign in: the first call creates the Person, and later sign-ins reuse it",
  () =>
    Effect.gen(function* signUpThenIn() {
      const { visitor, tokens, as, calls } = yield* accountsApi();
      const signedUp = yield* Effect.promise(() =>
        visitor.signUp({ email: " Alice@Example.test ", password, displayName: " Alice " }),
      );
      // The page's sign-up sets the session cookie; the body keeps no token.
      expect(Object.keys(signedUp).sort()).toEqual(["accountId", "expiresAt"]);
      expect(calls.at(-1)).toMatchObject({ name: "sign_up", path: "/api/sign-up", status: 201 });

      const first = yield* Effect.promise(() =>
        tokens.signIn({ email: "alice@example.test", password }),
      );
      const me = yield* Effect.promise(() => as(first.token).showMe({}));
      expect(me.displayName).toBe("Alice");

      const second = yield* Effect.promise(() =>
        tokens.signIn({ email: "ALICE@example.test", password }),
      );
      expect(second.token).not.toBe("");
      expect((yield* Effect.promise(() => as(second.token).showMe({}))).id).toBe(me.id);
      expect((yield* Effect.promise(() => as(first.token).showMe({}))).id).toBe(me.id);
      expect(JSON.stringify(calls)).not.toContain(password);
    }),
);

it.live("a wrong password and an unknown email get the same 401 invalid_credentials", () =>
  Effect.gen(function* refused() {
    const { visitor, fetch } = yield* accountsApi();
    yield* Effect.promise(() =>
      visitor.signUp({ email: "bob@example.test", password, displayName: "Bob" }),
    );
    const answer = (email: string, tried: string) =>
      Effect.promise(() =>
        fetch(`${origin}/api/sign-in`, {
          method: "POST",
          headers: { "content-type": "application/json", origin },
          body: JSON.stringify({ email, password: tried }),
        }).then((response) =>
          response.json().then((body: unknown) => ({ status: response.status, body })),
        ),
      );
    const wrong = yield* answer("bob@example.test", "not bob's password");
    const unknown = yield* answer("nobody@example.test", password);
    expect(wrong).toEqual({
      status: 401,
      body: {
        error: {
          code: "invalid_credentials",
          message: "That email and password do not match an account.",
        },
      },
    });
    expect(unknown).toEqual(wrong);
  }),
);

it.live("the same email twice is 409 taken, whatever its case", () =>
  Effect.gen(function* taken() {
    const { visitor } = yield* accountsApi();
    yield* Effect.promise(() =>
      visitor.signUp({ email: "carol@example.test", password, displayName: "Carol" }),
    );
    const again = yield* rejection(
      visitor.signUp({ email: "CAROL@example.test", password, displayName: "Other" }),
    );
    expect(Schema.is(HttpFailure)(again)).toBe(true);
    expect(again).toMatchObject({ status: 409, code: "taken" });
    const short = yield* rejection(
      visitor.signUp({ email: "dan@example.test", password: "short", displayName: "Dan" }),
    );
    expect(short).toMatchObject({ status: 400, code: "invalid_input" });
  }),
);

it.live("change_password needs the current one; then the old password fails", () =>
  Effect.gen(function* changes() {
    const { tokens, signUpAndIn } = yield* accountsApi();
    const erin = yield* signUpAndIn("erin@example.test", "Erin");
    const next = "another long secret";

    const wrong = yield* rejection(erin.changePassword({ current: "not the password", next }));
    expect(wrong).toMatchObject({ status: 401, code: "invalid_credentials" });

    expect(yield* Effect.promise(() => erin.changePassword({ current: password, next }))).toEqual(
      {},
    );
    const old = yield* rejection(tokens.signIn({ email: "erin@example.test", password }));
    expect(old).toMatchObject({ status: 401, code: "invalid_credentials" });
    const fresh = yield* Effect.promise(() =>
      tokens.signIn({ email: "erin@example.test", password: next }),
    );
    expect(fresh.token.length).toBeGreaterThan(0);
  }),
);

it.live("a person renames only themselves", () =>
  Effect.gen(function* renames() {
    const { signUpAndIn } = yield* accountsApi();
    const frank = yield* signUpAndIn("frank@example.test", "Frank");
    const grace = yield* signUpAndIn("grace@example.test", "Grace");
    const me = yield* Effect.promise(() => frank.showMe({}));
    const renamed = yield* Effect.promise(() =>
      frank.renamePerson({ id: me.id, displayName: "Franklin" }),
    );
    expect(renamed).toMatchObject({ id: me.id, displayName: "Franklin" });
    expect((yield* Effect.promise(() => frank.showMe({}))).displayName).toBe("Franklin");

    const notYou = yield* rejection(grace.renamePerson({ id: me.id, displayName: "Mine" }));
    expect(notYou).toMatchObject({ status: 403, code: "forbidden" });
    const blank = yield* rejection(frank.renamePerson({ id: me.id, displayName: "  " }));
    expect(blank).toMatchObject({ status: 400, code: "invalid_input" });
  }),
);

it.live("my bookings show only my own", () =>
  Effect.gen(function* onlyMine() {
    const { signUpAndIn } = yield* accountsApi();
    const alice = yield* signUpAndIn("alice2@example.test", "Alice");
    const bob = yield* signUpAndIn("bob2@example.test", "Bob");
    yield* Effect.promise(() => alice.bookBooking({ id: "a-2", guestName: "Ada" }));
    yield* Effect.promise(() => alice.bookBooking({ id: "a-1", guestName: "Ada" }));
    yield* Effect.promise(() => bob.bookBooking({ id: "b-1", guestName: "Grace" }));

    const mine = yield* Effect.promise(() => alice.listMyBookings({}));
    expect(mine.items).toEqual([
      { id: "a-1", guestName: "Ada", status: "active" },
      { id: "a-2", guestName: "Ada", status: "active" },
    ]);
    expect((yield* Effect.promise(() => bob.listMyBookings({}))).items.map((b) => b.id)).toEqual([
      "b-1",
    ]);
  }),
);

it.live("Bob cannot edit Alice's comment: it looks missing to him", () =>
  Effect.gen(function* notYours() {
    const { signUpAndIn } = yield* accountsApi();
    const alice = yield* signUpAndIn("alice3@example.test", "Alice");
    const bob = yield* signUpAndIn("bob3@example.test", "Bob");
    yield* Effect.promise(() => alice.bookBooking({ id: "c-1", guestName: "Ada" }));
    const comment = yield* Effect.promise(() =>
      alice.addComment({ target: target("c-1"), body: "Late." }),
    );
    const refused = yield* rejection(bob.editComment({ id: comment.id, body: "Mine now." }));
    expect(refused).toMatchObject({ status: 404, code: "not_found" });
    const edited = yield* Effect.promise(() =>
      alice.editComment({ id: comment.id, body: "Early." }),
    );
    expect(edited.body).toBe("Early.");
    yield* Effect.promise(() => alice.removeComment({ id: comment.id }));
    const listed = yield* Effect.promise(() =>
      alice.listComments({ target: target("c-1"), page: { size: 20 } }),
    );
    expect(listed.items).toEqual([]);
  }),
);

it.live("a missing, malformed, foreign-signed or other-server token is a 401", () =>
  Effect.gen(function* badTokens() {
    const { fetch } = yield* accountsApi();
    const other = yield* accountsApi();
    yield* Effect.promise(() =>
      other.visitor.signUp({ email: "other@example.test", password, displayName: "Other" }),
    );
    const fromOther = yield* Effect.promise(() =>
      other.tokens.signIn({ email: "other@example.test", password }),
    );
    const status = (token?: string) =>
      Effect.promise(() =>
        fetch(`${origin}/api/me`, {
          headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
        }).then((response) =>
          response
            .json()
            .then((body: { error: { code: string } }) => [response.status, body.error.code]),
        ),
      );
    expect(yield* status()).toEqual([401, "token_missing"]);
    expect(yield* status("not-a-jwt")).toEqual([401, "token_invalid"]);
    const keys = yield* AuthJwtTesting.keys;
    const forged = yield* keys.sign({ iss: "http://localhost:3000", sub: "alice" });
    expect(yield* status(forged)).toEqual([401, "token_invalid"]);
    // Each server start makes a new temporary key, so its tokens fail anywhere else.
    expect(yield* status(fromOther.token)).toEqual([401, "token_invalid"]);
  }),
);

it.live("a token from the MCP issuer is a 401 on a web member route", () =>
  Effect.gen(function* mcpTokenOnWeb() {
    const keys = yield* AuthJwtTesting.keys;
    const issuer = "https://id.example";
    const { fetch } = yield* accountsApi({
      ...localSignIn,
      mcp: Option.some({ issuer, jwks: keys.jwks }),
    });
    const token = yield* keys.sign({
      iss: issuer,
      sub: "alice",
      aud: "https://booking.example/mcp",
    });
    const answer = yield* Effect.promise(() =>
      fetch(`${origin}/api/me`, { headers: { authorization: `Bearer ${token}` } }).then(
        (response) =>
          response
            .json()
            .then((body: { error: { code: string } }) => [response.status, body.error.code]),
      ),
    );
    expect(answer).toEqual([401, "token_invalid"]);
  }),
);

it.live("repeated wrong passwords lock the account across requests, even for the right one", () =>
  Effect.gen(function* locks() {
    const { visitor } = yield* accountsApi();
    yield* Effect.promise(() =>
      visitor.signUp({ email: "heidi@example.test", password, displayName: "Heidi" }),
    );
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const wrong = yield* rejection(
        visitor.signIn({ email: "heidi@example.test", password: `wrong password ${attempt}` }),
      );
      expect(wrong).toMatchObject({ status: 401, code: "invalid_credentials" });
    }
    const right = yield* rejection(visitor.signIn({ email: "heidi@example.test", password }));
    expect(right).toMatchObject({ status: 401, code: "invalid_credentials" });
  }),
);

it("mount serves every key of both API lists, under their prefix", () => {
  const listed = (list: typeof api | typeof publicApi | typeof tokenApi) =>
    Object.values(list.endpoints).map((e) => `${e.method} ${list.prefix}${e.path}`);
  const served = (routes: typeof memberRoutes | typeof publicRoutes) =>
    routes.map((r) => `${r.method} ${r.path}`);
  expect(served(memberRoutes).sort()).toEqual(listed(api).sort());
  expect(served(publicRoutes).sort()).toEqual([...listed(publicApi), ...listed(tokenApi)].sort());
  expect(served(publicRoutes)).toContain("POST /api/sign-up");
  // cancel_booking is not mounted on HTTP.
  expect(served(memberRoutes).join(" ")).not.toContain("cancel");
});
