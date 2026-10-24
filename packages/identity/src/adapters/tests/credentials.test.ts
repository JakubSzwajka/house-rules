import { expect, it } from "@effect/vitest";
import { Authenticator } from "@house-rules/application";
import { AuthJwtTesting, type TestKeys } from "@house-rules/auth-jwt";
import { ActorId, UnitOfWork } from "@house-rules/domain";
import { Context, Effect, Layer, Option, Redacted } from "effect";
import {
  ActorResolver,
  ActorStanding,
  FirstSignIn,
  Identity,
  IdentityStoreUnavailable,
} from "../../index.js";
import { identityWorldsTesting } from "./stores.js";

const issuer = "https://clerk.example.com";
const actorId = ActorId.make("agent");
const owner = ActorId.make("owner");
const publishableKey = "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k";
const incoming = (token?: string) => ({
  url: "https://app.example.com",
  headers: new Headers(token === undefined ? {} : { authorization: `Bearer ${token}` }),
});
class KeysTesting extends Context.Service<KeysTesting, TestKeys>()("identity/tests/KeysTesting") {}
const tokenProvider = Identity.apiTokens({
  prefix: "bapp_",
  hmacKey: Redacted.make("test hmac key"),
});

for (const name of ["memory", "postgres"] as const) {
  const world = Layer.unwrap(
    Effect.gen(function* () {
      const keys = yield* AuthJwtTesting.keys;
      const options = {
        providers: [
          Identity.clerk({
            publishableKey,
            authorizedParties: ["https://app.example.com"],
            jwks: keys.jwks,
          }),
          tokenProvider,
          Identity.oidc({ issuer: "https://oidc.example", jwks: keys.jwks }),
        ],
      };
      const layer = identityWorldsTesting(options)[name === "postgres" ? 0 : 1];
      return Layer.mergeAll(
        layer.layer,
        Layer.succeed(KeysTesting, keys),
        Identity.refuse,
        Identity.everyoneActive,
      );
    }),
  );
  it.layer(world)(`${name} credential admission`, (test) => {
    test.effect(
      "each verified kind is admitted only by its way, and opaque tokens never use login slots",
      () =>
        Effect.gen(function* () {
          const keys = yield* KeysTesting;
          const identity = yield* Identity;
          yield* UnitOfWork.atomic(identity.bind({ issuer, subject: "user_owner" }, owner));
          yield* UnitOfWork.atomic(
            identity.bind({ issuer: "https://oidc.example", subject: "oidc" }, owner),
          );
          const issued = yield* UnitOfWork.atomic(
            identity.issueToken({
              actorId,
              name: "agent-token",
              scopes: ["read", "write"],
              createdBy: owner,
            }),
          );
          const session = yield* keys.sign(
            { iss: issuer, sub: "user_owner", sid: "sess", azp: "https://app.example.com" },
            { typ: "JWT" },
          );
          const oauth = yield* keys.sign(
            { iss: issuer, sub: "user_owner", sid: "sess" },
            { typ: "at+jwt" },
          );
          const machine = yield* keys.sign(
            { iss: issuer, sub: "mch_robot", sid: "sess" },
            { typ: "JWT" },
          );
          const jwt = yield* keys.sign({ iss: "https://oidc.example", sub: "oidc" });
          const fixtures = [
            ["session", session],
            ["oauth_access", oauth],
            ["api_token", issued.secret],
            ["jwt", jwt],
          ] as const;
          for (const [kind, token] of fixtures) {
            for (const accept of ["session", "oauth_access", "api_token", "jwt"] as const) {
              const result = yield* Effect.result(
                Identity.who({ token: "bearer", accept: [accept] }).resolve(incoming(token)),
              );
              if (kind === accept)
                expect(result).toMatchObject({
                  _tag: "Success",
                  success: { id: kind === "api_token" ? actorId : owner },
                });
              else
                expect(result).toMatchObject({
                  _tag: "Failure",
                  failure: { status: 401, code: "token_invalid" },
                });
            }
          }
          expect(
            yield* Effect.flip(
              Identity.who({
                token: "bearer",
                accept: ["session", "oauth_access", "jwt", "api_token"],
              }).resolve(incoming(machine)),
            ),
          ).toMatchObject({ status: 401, code: "token_invalid" });
          const noLogin = Layer.mergeAll(
            Layer.succeed(ActorResolver, {
              resolve: () => Effect.die("API tokens must skip ActorResolver"),
            }),
            Layer.succeed(FirstSignIn, () => Effect.die("API tokens must skip FirstSignIn")),
          );
          expect(
            yield* Identity.who({ token: "bearer", accept: ["api_token"] })
              .resolve(incoming(issued.secret))
              .pipe(Effect.provide(noLogin)),
          ).toEqual({ id: actorId });
          const auth = yield* Authenticator;
          expect(yield* Effect.flip(auth.verify(issued.secret))).toMatchObject({
            reason: "invalid",
          });
          expect(yield* Effect.flip(auth.verify(oauth))).toMatchObject({ reason: "invalid" });
          expect((yield* Identity.who({ token: "bearer" }).resolve(incoming(session))).id).toBe(
            owner,
          );
          expect((yield* Identity.who({ token: "bearer" }).resolve(incoming(jwt))).id).toBe(owner);
        }),
    );

    test.effect("signed Clerk typ and claims prove OAuth, session and machine separation", () =>
      Effect.gen(function* () {
        const keys = yield* KeysTesting;
        const web = Identity.who({ token: "bearer", accept: ["session"] });
        for (const [claims, header] of [
          [{ sub: "user_owner", sid: "sess" }, { typ: "application/at+jwt" }],
          [{ sub: "mch_robot", sid: "sess" }, { typ: "JWT" }],
          [{ sub: "user_owner" }, { typ: "JWT" }],
          [{ sub: "user_owner", sid: "sess", act: { sub: "user_admin" } }, { typ: "JWT" }],
          [{ sub: "user_owner", sid: "sess", azp: "https://attacker.example" }, { typ: "JWT" }],
          [{ sub: "user_owner", sid: "sess" }, { typ: "custom" }],
          [{ sub: "user_owner", sid: "sess", exp: -10 }, { typ: "JWT" }],
        ] as const) {
          const token = yield* keys.sign({ iss: issuer, ...claims }, header);
          expect(yield* Effect.flip(web.resolve(incoming(token)))).toMatchObject({
            status: 401,
            code: "token_invalid",
          });
        }
        const unbound = yield* keys.sign({ iss: issuer, sub: "user_unbound", sid: "sess" });
        expect(yield* Effect.flip(web.resolve(incoming(unbound)))).toMatchObject({
          status: 403,
          code: "not_invited",
        });
        for (const token of [
          "ak_opaque",
          "oat_opaque",
          "mt_opaque",
          "unknown_opaque",
          "bapp_x.y.z",
        ])
          expect(yield* Effect.flip(web.resolve(incoming(token)))).toMatchObject({
            status: 401,
            code: "token_invalid",
          });
      }),
    );

    test.effect(
      "standing runs before scope and refuses disabled or missing actors before work",
      () =>
        Effect.gen(function* () {
          const identity = yield* Identity;
          const token = yield* UnitOfWork.atomic(
            identity.issueToken({ actorId, name: "standing", scopes: ["read"], createdBy: owner }),
          );
          let ran = false;
          const who = Identity.who({
            token: "bearer",
            accept: ["api_token"],
            requireScope: "write",
          });
          for (const status of ["disabled", "missing"] as const) {
            const result = yield* Effect.flip(
              who.resolve(incoming(token.secret)).pipe(
                Effect.andThen(
                  Effect.sync(() => {
                    ran = true;
                  }),
                ),
                Effect.provide(
                  Layer.succeed(ActorStanding, { check: () => Effect.succeed(status) }),
                ),
              ),
            );
            expect(result).toMatchObject({
              status: 401,
              code: status === "disabled" ? "actor_disabled" : "token_invalid",
            });
          }
          expect(ran).toBe(false);
          expect(yield* Effect.flip(who.resolve(incoming(token.secret)))).toMatchObject({
            status: 403,
            code: "scope_too_wide",
          });
          const down = Identity.standing(
            Effect.succeed(() => Effect.fail(new IdentityStoreUnavailable({ cause: "private" }))),
          );
          expect(
            yield* Effect.flip(who.resolve(incoming(token.secret)).pipe(Effect.provide(down))),
          ).toMatchObject({ status: 503, code: "identity_unavailable" });
        }),
    );

    test.effect("issue, list, revoke, rollback and buffered use never expose a stored secret", () =>
      Effect.gen(function* () {
        const identity = yield* Identity;
        const input = { actorId, name: "lifecycle", scopes: ["read"], createdBy: owner };
        expect(yield* Effect.flip(identity.issueToken(input))).toMatchObject({
          _tag: "NoOpenUnit",
        });
        const issued = yield* UnitOfWork.atomic(identity.issueToken(input));
        expect(issued.secret).toMatch(/^bapp_[a-f0-9]{16}_[a-f0-9]{64}$/u);
        expect(issued.fact).toEqual({
          kind: "identity.token_issued",
          after: { name: "lifecycle", scopes: ["read"] },
        });
        const summary = (yield* identity.listTokens(actorId)).find(
          (row) => row.id === issued.token.id,
        );
        expect(summary).toEqual(issued.token);
        expect(JSON.stringify(summary)).not.toContain("secret");
        const who = Identity.who({ token: "bearer", accept: ["api_token"], requireScope: "read" });
        yield* who.resolve(incoming(issued.secret));
        expect(
          (yield* identity.listTokens(actorId)).find((row) => row.id === issued.token.id)
            ?.lastUsedAt,
        ).toBeNull();
        yield* UnitOfWork.atomic(identity.recordTokenUse());
        expect(
          (yield* identity.listTokens(actorId)).find((row) => row.id === issued.token.id)
            ?.lastUsedAt,
        ).not.toBeNull();
        const revoked = yield* UnitOfWork.atomic(identity.revokeToken(issued.token.id));
        expect(revoked?.fact).toEqual({
          kind: "identity.token_revoked",
          before: { revoked: false },
          after: { revoked: true },
        });
        expect(yield* UnitOfWork.atomic(identity.revokeToken(issued.token.id))).toBeNull();
        expect(yield* Effect.flip(who.resolve(incoming(issued.secret)))).toMatchObject({
          status: 401,
          code: "token_invalid",
        });
        const unknown = `bapp_${"00".repeat(8)}_${"00".repeat(32)}`;
        expect(yield* Effect.flip(who.resolve(incoming(unknown)))).toMatchObject({
          status: 401,
          code: "token_invalid",
        });
        const rollback = yield* Effect.flip(
          UnitOfWork.atomic(
            identity
              .issueToken({ ...input, name: "rollback" })
              .pipe(Effect.andThen(Effect.fail("rollback"))),
          ),
        );
        expect(rollback).toBe("rollback");
        expect((yield* identity.listTokens()).some((row) => row.name === "rollback")).toBe(false);
      }),
    );
  });
}
