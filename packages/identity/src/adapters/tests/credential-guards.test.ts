import { expect, it } from "@effect/vitest";
import { vi } from "vitest";
import { AuthJwt, AuthJwtTesting } from "@house-rules/auth-jwt";
import { ActorId, memoryUnitOfWork, UnitOfWork } from "@house-rules/domain";
import { Effect, Layer, Redacted } from "effect";
import * as Hex from "effect/encoding/Hex";
import {
  ApiTokenStore,
  Identity,
  IdentityStoreUnavailable,
  memoryApiTokenStore,
} from "../../index.js";

const issuer = "https://clerk.example.com";
const actorId = ActorId.make("agent");
const owner = ActorId.make("owner");
const publishableKey = "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k";
const incoming = (token: string) => ({
  url: issuer,
  headers: new Headers({ authorization: `Bearer ${token}` }),
});
const tokenProvider = Identity.apiTokens({
  prefix: "bapp_",
  hmacKey: Redacted.make("test hmac key"),
});
const slots = Layer.mergeAll(
  Identity.subject({ issuer }),
  Identity.refuse,
  Identity.everyoneActive,
);

it.effect("wrong kind refuses before signature verification or a token-store read", () =>
  Effect.gen(function* () {
    const keys = yield* AuthJwtTesting.keys;
    const token = yield* keys.sign({ iss: issuer, sub: "user_owner", sid: "sess" });
    let reads = 0;
    const store = Layer.succeed(ApiTokenStore, {
      find: () =>
        Effect.sync(() => {
          reads++;
          return undefined;
        }),
      insert: () => Effect.void,
      list: () => Effect.succeed([]),
      revoke: () => Effect.succeed(undefined),
      recordUse: () => Effect.void,
    });
    const layer = Identity.providers({
      providers: [Identity.clerk({ publishableKey, authorizedParties: [issuer] }), tokenProvider],
    }).pipe(Layer.provide(store));
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new TypeError("network unavailable"));
    yield* Effect.gen(function* () {
      expect(
        yield* Effect.flip(
          Identity.who({ token: "bearer", accept: ["api_token"] }).resolve(incoming(token)),
        ),
      ).toMatchObject({ code: "token_invalid" });
      expect(
        yield* Effect.flip(
          Identity.who({ token: "bearer", accept: ["session"] }).resolve(
            incoming("bapp_0011223344556677_" + "00".repeat(32)),
          ),
        ),
      ).toMatchObject({ code: "token_invalid" });
      expect(fetch).not.toHaveBeenCalled();
      expect(reads).toBe(0);
      expect(
        yield* Effect.flip(
          Identity.who({ token: "bearer", accept: ["session"] }).resolve(incoming(token)),
        ),
      ).toMatchObject({ status: 503, code: "auth_unavailable" });
    }).pipe(
      Effect.provide(Layer.merge(layer, slots)),
      Effect.ensuring(Effect.sync(() => fetch.mockRestore())),
    );
  }),
);

it.effect(
  "a migrated token verifies the token:<secret> HMAC, including dummy work on a lookup miss",
  () =>
    Effect.gen(function* () {
      const lower = Identity.providers({ providers: [tokenProvider] }).pipe(
        Layer.provideMerge(memoryApiTokenStore()),
      );
      const secret = "ab".repeat(32);
      const key = yield* Effect.promise(() =>
        globalThis.crypto.subtle.importKey(
          "raw",
          new TextEncoder().encode("test hmac key"),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"],
        ),
      );
      const digest = yield* Effect.promise(() =>
        globalThis.crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`token:${secret}`)),
      );
      const compare = vi.spyOn(globalThis.crypto.subtle, "verify");
      yield* Effect.gen(function* () {
        const store = yield* ApiTokenStore;
        yield* UnitOfWork.atomic(
          store.insert({
            id: "00000000-0000-4000-8000-000000000001",
            actorId,
            name: "migrated",
            scopes: ["read"],
            lookup: "0123456789abcdef",
            secretHmac: Hex.encode(new Uint8Array(digest)),
            createdBy: owner,
            createdAt: 0,
            lastUsedAt: null,
            revokedAt: null,
          }),
        );
        const who = Identity.who({ token: "bearer", accept: ["api_token"] });
        expect(yield* who.resolve(incoming(`bapp_0123456789abcdef_${secret}`))).toEqual({
          id: actorId,
        });
        for (const token of [
          `bapp_0123456789abcdef_${"00".repeat(32)}`,
          `bapp_0000000000000000_${secret}`,
        ])
          expect(yield* Effect.flip(who.resolve(incoming(token)))).toMatchObject({
            code: "token_invalid",
          });
        expect(compare).toHaveBeenCalledTimes(3);
        for (const call of compare.mock.calls) expect(call[2]).toHaveProperty("byteLength", 32);
        const broken = Identity.providers({ providers: [tokenProvider] }).pipe(
          Layer.provide(
            Layer.succeed(ApiTokenStore, {
              ...store,
              find: () =>
                Effect.fail(new IdentityStoreUnavailable({ cause: "private token store" })),
            }),
          ),
        );
        expect(
          yield* Effect.flip(
            who.resolve(incoming(`bapp_0123456789abcdef_${secret}`)).pipe(Effect.provide(broken)),
          ),
        ).toMatchObject({ status: 503, code: "identity_unavailable" });
      }).pipe(
        Effect.provide(Layer.mergeAll(lower, slots, memoryUnitOfWork)),
        Effect.ensuring(Effect.sync(() => compare.mockRestore())),
      );
    }),
);

it.effect("kind admission is repeated on the verified protected header", () =>
  Effect.gen(function* () {
    const keys = yield* AuthJwtTesting.keys;
    const token = yield* keys.sign({ iss: issuer, sub: "user_owner", sid: "sess" }, { typ: "JWT" });
    const verifier = vi.spyOn(AuthJwt, "verifier").mockImplementation(() =>
      Effect.succeed({
        verify: () =>
          Effect.succeed({
            header: { alg: "ES256", typ: "at+jwt" },
            principal: {
              issuer,
              subject: "user_owner",
              audience: [],
              scopes: [],
              claims: { sub: "user_owner", sid: "sess" },
            },
          }),
      }),
    );
    yield* Effect.gen(function* () {
      expect(
        yield* Effect.flip(
          Identity.who({ token: "bearer", accept: ["session"] }).resolve(incoming(token)),
        ),
      ).toMatchObject({ status: 401, code: "token_invalid" });
    }).pipe(
      Effect.provide(
        Layer.merge(
          Identity.layerMemory({
            providers: [
              Identity.clerk({ publishableKey, authorizedParties: [issuer], jwks: keys.jwks }),
            ],
          }),
          slots,
        ),
      ),
      Effect.ensuring(Effect.sync(() => verifier.mockRestore())),
    );
  }),
);
