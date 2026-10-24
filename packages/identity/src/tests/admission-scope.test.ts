import { expect, it } from "@effect/vitest";
import {
  composition,
  defineFeature,
  defineWay,
  endpoint,
  May,
  Mean,
  StepTrace,
  toFetchHandler,
} from "@house-rules/application";
import { ActorId, memoryUnitOfWork, UnitOfWork } from "@house-rules/domain";
import { Effect, Layer, Redacted, Schema } from "effect";
import { Identity } from "../index.js";

it.effect(
  "a read token on a write way is refused before JSON decoding; a write token reaches decoding",
  () =>
    Effect.gen(function* () {
      let ran = false;
      const write = defineFeature("scope_write", {
        description: "Exercise the scope boundary before decoding.",
        input: Schema.Struct({ name: Schema.String }),
        output: Schema.Void,
        failure: Schema.Never,
        permission: null,
        edges: [],
        handler: () =>
          Effect.sync(() => {
            ran = true;
          }),
      });
      const way = defineWay({
        protocol: "http",
        name: "write",
        path: "/api",
        features: [write],
        endpoints: [endpoint(write, "POST /write")],
        who: Identity.who({ token: "bearer", accept: ["api_token"], requireScope: "write" }),
        mean: Mean.no,
      });
      const app = composition({
        modules: {
          mounts: [],
          layer: Layer.mergeAll(
            Identity.layerMemory({
              providers: [
                Identity.apiTokens({ prefix: "bapp_", hmacKey: Redacted.make("scope fixture") }),
              ],
            }),
            Identity.everyoneActive,
            Identity.refuse,
            memoryUnitOfWork,
            StepTrace.layer(),
          ),
        },
        features: [write],
        ways: [way],
        may: Effect.succeed(May.fixed([])),
        system: [],
      });
      const handler = toFetchHandler(app);
      try {
        const context = yield* app.runtime.contextEffect;
        const tokens = yield* Effect.gen(function* () {
          const identity = yield* Identity;
          const base = {
            actorId: ActorId.make("agent"),
            createdBy: ActorId.make("owner"),
            name: "scope",
          };
          return yield* UnitOfWork.atomic(
            Effect.all([
              identity.issueToken({ ...base, scopes: ["read"] }),
              identity.issueToken({ ...base, scopes: ["read", "write"] }),
            ]),
          );
        }).pipe(Effect.provideContext(context));
        const request = (token: string) =>
          new Request("https://app.example/api/write", {
            method: "POST",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: "{",
          }) as Request;
        const read = yield* Effect.promise(() => handler(request(tokens[0].secret)));
        expect(read.status).toBe(403);
        expect(yield* Effect.promise(() => read.json())).toMatchObject({
          error: { code: "scope_too_wide" },
        });
        const writeResponse = yield* Effect.promise(() => handler(request(tokens[1].secret)));
        expect(writeResponse.status).toBe(400);
        expect(ran).toBe(false);
        const cookie = Identity.who({ token: { cookie: "__session" }, accept: ["session"] });
        expect(
          yield* Effect.flip(
            cookie
              .resolve({
                url: "https://app.example",
                headers: new Headers({ cookie: `__session=${tokens[0].secret}` }),
              })
              .pipe(Effect.provideContext(context)),
          ),
        ).toMatchObject({ status: 401, code: "token_invalid" });
      } finally {
        yield* Effect.promise(() => handler.dispose().then(app.dispose));
      }
    }),
);
