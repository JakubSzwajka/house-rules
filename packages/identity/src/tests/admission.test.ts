import { expect, it } from "@effect/vitest";
import {
  call,
  composition,
  defineFeature,
  defineWay,
  endpoint,
  May,
  Mean,
  StepTrace,
  toFetchHandler,
} from "@house-rules/application";
import { AuthJwtTesting } from "@house-rules/auth-jwt";
import { ActorId, memoryUnitOfWork } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import { ActorStanding, Identity } from "../index.js";

it.effect(
  "disabled actors cannot run a permission-free feature through HTTP or in-process call",
  () =>
    Effect.gen(function* () {
      const keys = yield* AuthJwtTesting.keys;
      const issuer = "https://admission.example";
      const token = yield* keys.sign({ iss: issuer, sub: "disabled", exp: 4_000_000_000 });
      let ran = 0;
      let active = false;
      const free = defineFeature("permission_free", {
        description: "Exercise admission before an empty permission closure.",
        input: Schema.Struct({}),
        output: Schema.String,
        failure: Schema.Never,
        permission: null,
        edges: [],
        flags: { readOnly: true },
        handler: () =>
          Effect.sync(() => {
            ran++;
            return "ran";
          }),
      });
      const web = defineWay({
        protocol: "http",
        name: "web",
        path: "/web",
        features: [free],
        endpoints: [endpoint(free, "GET /free")],
        who: Identity.who({ token: "bearer" }),
        mean: Mean.no,
      });
      const app = composition({
        modules: {
          mounts: [],
          layer: Layer.mergeAll(
            Identity.layerMemory({ providers: [Identity.oidc({ issuer, jwks: keys.jwks })] }),
            Identity.subject({ issuer }),
            Identity.refuse,
            Layer.succeed(ActorStanding, {
              check: () => Effect.sync(() => (active ? "active" : "disabled")),
            }),
            StepTrace.layer(),
            memoryUnitOfWork,
          ),
        },
        features: [free],
        ways: [web],
        may: Effect.succeed(May.fixed([])),
        system: [],
      });
      const handler = toFetchHandler(app);
      const incoming = {
        url: "https://app.example/web/free",
        headers: new Headers({ authorization: `Bearer ${token}` }),
      };
      try {
        expect(
          yield* Effect.promise(() => call(app, free, {}, incoming, { way: "web" })),
        ).toMatchObject({ ok: false, error: { status: 401, code: "actor_disabled" } });
        const denied = yield* Effect.promise(() =>
          handler(new Request(incoming.url, { headers: incoming.headers }) as Request),
        );
        expect(denied.status).toBe(401);
        expect(yield* Effect.promise(() => denied.json())).toMatchObject({
          error: { code: "actor_disabled" },
        });
        expect(ran).toBe(0);
        active = true;
        expect(yield* Effect.promise(() => call(app, free, {}, incoming, { way: "web" }))).toEqual({
          ok: true,
          value: "ran",
        });
        expect(ran).toBe(1);
      } finally {
        yield* Effect.promise(() => handler.dispose().then(app.dispose));
      }
    }),
);

it.effect("OIDC kind overrides and Clerk impersonation require explicit opt-in", () =>
  Effect.gen(function* () {
    const keys = yield* AuthJwtTesting.keys;
    const issuer = "https://clerk.example.com";
    const publishableKey = "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k";
    for (const kind of ["session", "oauth_access"] as const) {
      const token = yield* keys.sign({ iss: issuer, sub: "user_owner" });
      const layer = Layer.mergeAll(
        Identity.layerMemory({ providers: [Identity.oidc({ issuer, jwks: keys.jwks, kind })] }),
        Identity.subject({ issuer }),
        Identity.refuse,
        Identity.everyoneActive,
      );
      expect(
        yield* Identity.who({ token: "bearer", accept: [kind] })
          .resolve({ url: issuer, headers: new Headers({ authorization: `Bearer ${token}` }) })
          .pipe(Effect.provide(layer)),
      ).toEqual({ id: "user_owner" });
    }
    const token = yield* keys.sign({
      iss: issuer,
      sub: "user_owner",
      sid: "sess",
      act: { sub: "user_admin" },
    });
    const layer = Layer.mergeAll(
      Identity.layerMemory({
        providers: [
          Identity.clerk({
            publishableKey,
            authorizedParties: [issuer],
            jwks: keys.jwks,
            allowImpersonation: true,
          }),
        ],
      }),
      Identity.subject({ issuer }),
      Identity.refuse,
      Identity.everyoneActive,
    );
    expect(
      yield* Identity.who({ token: "bearer", accept: ["session"] })
        .resolve({ url: issuer, headers: new Headers({ authorization: `Bearer ${token}` }) })
        .pipe(Effect.provide(layer)),
    ).toEqual({ id: ActorId.make("user_owner") });
  }),
);
