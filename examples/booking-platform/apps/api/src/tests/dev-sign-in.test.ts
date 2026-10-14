import { expect, it } from "@effect/vitest";
import {
  type CallEntry,
  composition,
  HttpFailure,
  toFetchHandler,
  toPromiseClient,
} from "@house-rules/application";
import { Config, ConfigProvider, Effect, Schema } from "effect";
import { visitorCaller } from "../composition/callers.js";
import { memoryAppLayer } from "../composition/app-layer.js";
import { webCaller } from "../composition/index.js";
import { devMode, type SignInMode, signInConfig, visitorMode } from "../composition/sign-in.js";
import { bookingViews } from "../composition/views.js";
import { api, devApi } from "../delivery/http/api.js";
import { devRoutes, memberRoutes } from "../delivery/http/routes.js";

const origin = "https://booking.example";

const mounted = (mode: SignInMode) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const app = composition({
        layer: memoryAppLayer(mode),
        caller: webCaller,
        views: bookingViews,
      });
      const members = toFetchHandler(app, { routes: memberRoutes });
      const dev = toFetchHandler(app, { routes: devRoutes, caller: visitorCaller });
      const calls: CallEntry[] = [];
      const fetch = (input: string | URL | Request, init?: RequestInit) => {
        const request = new Request(input, init);
        const path = new URL(request.url).pathname;
        return path.startsWith(`${devApi.prefix}/`) ? dev(request) : members(request);
      };
      const signIn = toPromiseClient(devApi, {
        baseUrl: origin,
        fetch,
        onCall: (e) => calls.push(e),
      });
      const as = (token: string) =>
        toPromiseClient(api, {
          baseUrl: origin,
          fetch,
          token: () => token,
          onCall: (e) => calls.push(e),
        });
      return { app, members, dev, signIn, as, calls };
    }),
    ({ app, members, dev }) =>
      Effect.promise(() => Promise.all([members.dispose(), dev.dispose()]).then(app.dispose)),
  );

const rejection = (promise: Promise<unknown>) =>
  Effect.promise(() =>
    promise.then(
      () => "resolved",
      (error: unknown) => error,
    ),
  );

it.live("with DEV_ISSUER on, signing in by name creates a Person once per name", () =>
  Effect.gen(function* devSignIn() {
    const { signIn, as } = yield* mounted(devMode);
    const { token: alice } = yield* Effect.promise(() => signIn.signIn({ name: "Alice" }));
    const me = yield* Effect.promise(() => as(alice).showMe({}));
    expect(me.displayName).toBe("Alice");

    const { token: again } = yield* Effect.promise(() => signIn.signIn({ name: "alice" }));
    expect((yield* Effect.promise(() => as(again).showMe({}))).id).toBe(me.id);

    const { token: bob } = yield* Effect.promise(() => signIn.signIn({ name: "Bob" }));
    expect((yield* Effect.promise(() => as(bob).showMe({}))).id).not.toBe(me.id);
  }),
);

it.live("Bob cannot edit Alice's comment: it looks missing to him", () =>
  Effect.gen(function* notYours() {
    const { signIn, as } = yield* mounted(devMode);
    const { token: alice } = yield* Effect.promise(() => signIn.signIn({ name: "Alice" }));
    const { token: bob } = yield* Effect.promise(() => signIn.signIn({ name: "Bob" }));
    yield* Effect.promise(() => as(alice).bookBooking({ id: "b-1", guestName: "Ada" }));
    const target = { kind: "booking", id: "b-1" };
    const comment = yield* Effect.promise(() => as(alice).addComment({ target, body: "Late." }));

    const refused = yield* rejection(as(bob).editComment({ id: comment.id, body: "Mine now." }));
    expect(Schema.is(HttpFailure)(refused)).toBe(true);
    expect(refused).toMatchObject({ status: 404, code: "not_found" });
    const listed = yield* Effect.promise(() =>
      as(alice).listComments({ target, page: { size: 20 } }),
    );
    expect(listed.items.map((item) => item.body)).toEqual(["Late."]);
  }),
);

it.live("with DEV_ISSUER off, dev sign-in answers 404 not_found and issues nothing", () =>
  Effect.gen(function* devOff() {
    const { signIn, calls } = yield* mounted(visitorMode);
    const refused = yield* rejection(signIn.signIn({ name: "Alice" }));
    expect(refused).toMatchObject({ status: 404, code: "not_found" });
    expect(calls).toMatchObject([{ name: "dev_sign_in", path: "/api/dev/sign-in", status: 404 }]);
  }),
);

const modeFrom = (env: Record<string, string>) =>
  signInConfig.parse(ConfigProvider.fromUnknown(env));

it.effect("the sign-in switch: off, dev, refused in production, refused beside AUTH_ISSUER", () =>
  Effect.gen(function* switches() {
    expect(yield* modeFrom({})).toEqual(visitorMode);
    expect(yield* modeFrom({ DEV_ISSUER: "1", NODE_ENV: "development" })).toEqual(devMode);
    expect((yield* modeFrom({ AUTH_ISSUER: "https://id.example" })).kind).toBe("jwt");
    for (const env of [
      { DEV_ISSUER: "1", NODE_ENV: "production" },
      { DEV_ISSUER: "1", AUTH_ISSUER: "https://id.example" },
      { DEV_ISSUER: "yes" },
    ]) {
      const error = yield* Effect.flip(modeFrom(env));
      expect(error).toBeInstanceOf(Config.ConfigError);
    }
    const production = yield* Effect.flip(modeFrom({ DEV_ISSUER: "1", NODE_ENV: "production" }));
    expect(production.message).toContain("NODE_ENV=production");
  }),
);

it("mount serves every key of the API list, under its prefix", () => {
  const listed = (list: typeof api | typeof devApi) =>
    Object.values(list.endpoints).map((e) => `${e.method} ${list.prefix}${e.path}`);
  const served = (routes: typeof memberRoutes | typeof devRoutes) =>
    routes.map((r) => `${r.method} ${r.path}`);
  expect(served(memberRoutes).sort()).toEqual(listed(api).sort());
  expect(served(devRoutes)).toEqual(listed(devApi));
  expect(served(memberRoutes)).toContain("POST /api/add_comment");
});
