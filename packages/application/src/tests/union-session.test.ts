import { expect, expectTypeOf, it } from "@effect/vitest";
import { Clock, Effect, Layer, Schema } from "effect";
import {
  type BodyOf,
  type SessionOption,
  composition,
  defineFeature,
  defineWay,
  endpoint,
  May,
  Mean,
  Runtime,
  StepTrace,
  systemStart,
  toFetchHandler,
  toOpenApi,
} from "../index.ts";
import { testActor } from "./execution-fixtures.ts";
import { webRequest } from "./delivery-fixtures.ts";

const signIn = defineFeature("union_sign_in", {
  description: "Sign in or return a refusal as data.",
  input: Schema.Struct({ valid: Schema.Boolean }),
  output: Schema.Union([
    Schema.Struct({
      kind: Schema.Literal("signed_in"),
      token: Schema.String,
      expiresAt: Schema.Finite,
    }),
    Schema.Struct({ kind: Schema.Literal("invalid"), attempts: Schema.Finite }),
  ]),
  failure: Schema.Never,
  permission: null,
  start: systemStart("sign in"),
  handler: ({ valid }) =>
    Clock.currentTimeMillis.pipe(
      Effect.map((now) =>
        valid
          ? { kind: "signed_in" as const, token: "private-token", expiresAt: now + 60_000 }
          : { kind: "invalid" as const, attempts: 1 },
      ),
    ),
});
const route = endpoint(signIn, "POST /sign-in", { session: "issue" });
expectTypeOf<SessionOption<typeof signIn>>().toEqualTypeOf<"issue" | "clear">();
expectTypeOf<BodyOf<typeof signIn, "issue">>().toEqualTypeOf<
  | { readonly kind: "signed_in"; readonly expiresAt: number }
  | { readonly kind: "invalid"; readonly attempts: number }
>();

it.effect("union sessions issue only on a token member, omit tokens, and still enforce CSRF", () =>
  Effect.gen(function* () {
    const way = defineWay({
      name: "web",
      path: "/",
      protocol: "http",
      features: [signIn],
      public: [signIn],
      endpoints: [route],
      session: { cookie: "sid" },
      who: { resolve: () => Effect.succeed(testActor) },
      mean: Mean.no,
    });
    const app = composition({
      modules: { mounts: [], layer: StepTrace.layer() },
      features: [signIn],
      ways: [way],
      may: Effect.succeed(May.fixed([])),
      system: [],
    });
    const handler = toFetchHandler(app);
    yield* Effect.addFinalizer(() =>
      Effect.promise(() => handler.dispose().then(() => app.dispose())),
    );
    for (const valid of [true, false]) {
      const request = (origin?: string) =>
        webRequest("https://app.example/sign-in", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(origin === undefined ? {} : { origin }),
          },
          body: JSON.stringify({ valid }),
        });
      const refused = yield* Effect.promise(() => handler(request()));
      expect(refused.status).toBe(403);
      expect(refused.headers.has("set-cookie")).toBe(false);
      const crossOrigin = yield* Effect.promise(() => handler(request("https://evil.example")));
      expect(crossOrigin.status).toBe(403);
      const response = yield* Effect.promise(() => handler(request("https://app.example")));
      expect(response.status).toBe(200);
      const body = yield* Effect.promise(() => response.json());
      expect(body).toEqual(
        valid
          ? { kind: "signed_in", expiresAt: expect.any(Number) }
          : { kind: "invalid", attempts: 1 },
      );
      expect(JSON.stringify(body)).not.toContain("token");
      expect(response.headers.has("set-cookie")).toBe(valid);
      if (valid) expect(response.headers.get("set-cookie")).toContain("sid=private-token;");
    }
    const document = toOpenApi([route], { title: "sessions", version: "1", public: way.public });
    expect(JSON.stringify(document)).not.toContain('"token"');
    expect(JSON.stringify(document)).toContain('"attempts"');
  }),
);
