import { expect, it } from "@effect/vitest";
import {
  composition,
  defineContract,
  implement,
  route,
  toFetchHandler,
} from "@house-rules/capability";
import { serve } from "@house-rules/node-host";
import { Context, Effect, Layer, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

it.live(
  "composition through a real Node socket checks CSRF against Host, not forwarded headers",
  () =>
    Effect.gen(function* () {
      let calls = 0;
      const echo = implement(
        defineContract("echo", {
          description: "Echo one field.",
          input: Schema.Struct({ message: Schema.String }),
          output: Schema.String,
          failure: Schema.Never,
          permission: "public",
        }),
        ({ message }) =>
          Effect.sync(() => {
            calls++;
            return message;
          }),
      );
      const app = composition({
        layer: Layer.empty,
        caller: () => Effect.succeed(Context.empty()),
        views: {},
      });
      const api = toFetchHandler(app, { routes: [route(echo, "POST /echo")], maxBodyBytes: 64 });
      const host = yield* Effect.promise(() =>
        serve(api, {
          port: 0,
          hostname: "127.0.0.1",
          onClose: () => api.dispose().then(() => app.dispose()),
        }),
      );
      const client = yield* HttpClient.HttpClient;
      const post = (origin: string, body = '{"message":"hello"}') =>
        client.execute(
          HttpClientRequest.post(new URL("/echo", host.url).href).pipe(
            HttpClientRequest.setHeaders({
              origin,
              cookie: "session=yes",
              "x-forwarded-host": "other.example",
            }),
            HttpClientRequest.bodyText(body, "application/json"),
          ),
        );
      try {
        const accepted = yield* post(host.url.origin);
        expect(accepted.status).toBe(200);
        expect(yield* accepted.json).toBe("hello");
        for (const origin of [
          "http://public.example:8080",
          host.url.origin.replace("http:", "https:"),
          "http://other.example",
          "null",
        ]) {
          const refused = yield* post(origin);
          expect(refused.status).toBe(403);
          expect(yield* refused.json).toMatchObject({ error: { code: "cross_origin" } });
        }
        const oversized = yield* post(
          host.url.origin,
          JSON.stringify({ message: "x".repeat(100) }),
        );
        expect(oversized.status).toBe(413);
        expect(calls).toBe(1);
      } finally {
        yield* Effect.promise(() => host.close());
      }
      const closed = yield* Effect.promise(() =>
        api(
          new Request("http://public.example:8080/echo", {
            method: "POST",
            body: '{"message":"late"}',
            headers: { "content-type": "application/json" },
          }) as Request,
        ),
      );
      expect(closed.status).toBe(503);
    }).pipe(Effect.provide(FetchHttpClient.layer)),
);

it.live("a TLS proxy's public origin accepts cookie writes over a real Node socket", () =>
  Effect.gen(function* () {
    let calls = 0;
    const echo = implement(
      defineContract("proxy-echo", {
        description: "Echo one field behind a TLS proxy.",
        input: Schema.Struct({ message: Schema.String }),
        output: Schema.String,
        failure: Schema.Never,
        permission: "public",
      }),
      ({ message }) =>
        Effect.sync(() => {
          calls++;
          return message;
        }),
    );
    const app = composition({
      layer: Layer.empty,
      caller: () => Effect.succeed(Context.empty()),
      views: {},
    });
    const api = toFetchHandler(app, {
      routes: [route(echo, "POST /echo")],
      origins: ["https://public.example"],
    });
    const host = yield* Effect.promise(() =>
      serve(api, {
        port: 0,
        hostname: "127.0.0.1",
        onClose: () => api.dispose().then(() => app.dispose()),
      }),
    );
    const client = yield* HttpClient.HttpClient;
    try {
      for (const [origin, authority, status] of [
        ["https://public.example", host.url.host, 200],
        ["https://other.example", host.url.host, 403],
        [host.url.origin, host.url.host, 403],
        ["http://spoofed.example", "spoofed.example", 403],
      ] as const) {
        const response = yield* client.execute(
          HttpClientRequest.post(new URL("/echo", host.url).href).pipe(
            HttpClientRequest.setHeaders({ origin, host: authority, cookie: "session=yes" }),
            HttpClientRequest.bodyText('{"message":"hello"}', "application/json"),
          ),
        );
        expect(response.status).toBe(status);
        if (status === 200) expect(yield* response.json).toBe("hello");
        else expect(yield* response.json).toMatchObject({ error: { code: "cross_origin" } });
      }
      expect(calls).toBe(1);
    } finally {
      yield* Effect.promise(() => host.close());
    }
  }).pipe(Effect.provide(FetchHttpClient.layer)),
);
