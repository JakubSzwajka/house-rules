import { expect, it, vi } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import {
  defineApi,
  defineContract,
  endpoint,
  HttpFailure,
  toHttpClient,
  toPromiseClient,
} from "../index.ts";

const read = defineContract("read_value", {
  description: "Read one value by id.",
  input: Schema.Struct({ id: Schema.String }),
  output: Schema.String,
  failure: Schema.Never,
  permission: "public",
});

const write = defineContract("write_value", {
  description: "Write one value.",
  input: Schema.Struct({ value: Schema.String }),
  output: Schema.String,
  failure: Schema.Never,
  permission: "public",
});

type Hit = Readonly<{ url: string; method: string; bearer: boolean; init?: RequestInit }>;

const reply = (body: string | null, init: ResponseInit): Promise<Response> =>
  // This workspace loads two @types/node versions, so tsc sees the Response constructor and the Response type differ.
  Promise.resolve(new Response(body, init) as Response);

const network = (status: number) => {
  // app.example answers `status`; any other origin is the collector. Like fetch, it follows redirects by default.
  const hits: Array<Hit> = [];
  const send = (
    input: Parameters<typeof globalThis.fetch>[0],
    init?: RequestInit,
  ): ReturnType<typeof globalThis.fetch> => {
    const url = new URL(String(input));
    hits.push({
      url: url.href,
      method: init?.method ?? "GET",
      bearer: new Headers(init?.headers).has("authorization"),
      ...(init === undefined ? {} : { init }),
    });
    if (url.origin !== "https://app.example") return reply('"collected"', { status: 200 });
    if (status < 300 || status >= 400) return reply('"okay"', { status });
    const location = "https://collector.example/collected";
    if (init?.redirect === "manual") return reply(null, { status, headers: { location } });
    return send(location, init);
  };
  const fetch: typeof globalThis.fetch = send;
  return { hits, fetch };
};

const withBearer = <A, E, R>(effect: Effect.Effect<A, E, R | HttpClient.HttpClient>) =>
  effect.pipe(
    Effect.updateService(HttpClient.HttpClient, (client) =>
      HttpClient.mapRequest(client, (request) => HttpClientRequest.bearerToken(request, "tok-ada")),
    ),
  );

const asHttpFailure = (error: unknown) =>
  Schema.is(HttpFailure)(error) ? Effect.succeed(error) : Effect.die(error);

const failureOf = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.flip(effect).pipe(Effect.flatMap(asHttpFailure));

const rejectionOf = (call: () => Promise<unknown>) =>
  Effect.promise(() =>
    call().then(
      () => undefined,
      (error: unknown) => error,
    ),
  ).pipe(Effect.flatMap(asHttpFailure));

const escapes = [
  "//collector.example/x",
  "/\\collector.example/x",
  "/\t/collector.example/x",
  "/\n/collector.example/x",
  "/\r/collector.example/x",
];

it.effect("toHttpClient refuses a raw endpoint path that a URL parser reads as another host", () =>
  Effect.gen(function* rawPaths() {
    const { hits, fetch } = network(200);
    // With no page, a stand-in origin still shows the escape; with a page, the page's origin is the one to hold.
    for (const page of [undefined, { origin: "https://app.example", pathname: "/page" }]) {
      vi.stubGlobal("location", page);
      for (const path of escapes) {
        const client = toHttpClient([endpoint(read, `GET ${path}` as `GET /${string}`)]);
        const failure = yield* failureOf(
          withBearer(client.read_value({ id: "7" })).pipe(
            Effect.provide(FetchHttpClient.layer),
            Effect.provideService(FetchHttpClient.Fetch, fetch),
          ),
        );
        expect(failure, path).toMatchObject({ code: "Unknown", status: 0 });
      }
    }
    expect(hits).toEqual([]);
  }).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals()))),
);

it.effect("an empty path value cannot fold `/:id/host` into `//host`", () =>
  Effect.gen(function* emptyValue() {
    vi.stubGlobal("location", { origin: "https://app.example", pathname: "/" });
    const { hits, fetch } = network(200);
    const api = defineApi({}, { read: endpoint(read, "GET /:id/collector.example/x") });
    const viaEffect = toHttpClient([api.endpoints.read]).read_value({ id: "" });
    const typed = yield* failureOf(
      withBearer(viaEffect).pipe(
        Effect.provide(FetchHttpClient.layer),
        Effect.provideService(FetchHttpClient.Fetch, fetch),
      ),
    );
    const promised = yield* rejectionOf(() =>
      toPromiseClient(api, { token: () => "tok-ada", fetch }).read({ id: "" }),
    );
    for (const failure of [typed, promised]) {
      expect(failure).toMatchObject({ code: "Unknown", status: 0 });
      expect(String(failure.body)).toMatch(/id cannot be empty/u);
    }
    expect(hits).toEqual([]);
  }).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals()))),
);

it.effect("neither client follows a redirect, so nothing reaches the other origin", () =>
  Effect.gen(function* redirects() {
    for (const status of [302, 307, 308]) {
      const { hits, fetch } = network(status);
      const api = defineApi({}, { write: endpoint(write, "POST /write") });
      const promised = yield* rejectionOf(() =>
        toPromiseClient(api, {
          baseUrl: "https://app.example",
          token: () => "tok-ada",
          fetch,
        }).write({ value: "private" }),
      );
      const typed = yield* failureOf(
        withBearer(
          toHttpClient([api.endpoints.write], { baseUrl: "https://app.example" }).write_value({
            value: "private",
          }),
        ).pipe(
          Effect.provide(FetchHttpClient.layer),
          Effect.provideService(FetchHttpClient.Fetch, fetch),
          // An app's own fetch options still go out, beside the redirect mode the client sets.
          Effect.provideService(FetchHttpClient.RequestInit, { credentials: "include" }),
        ),
      );
      for (const failure of [promised, typed]) {
        expect(failure, String(status)).toMatchObject({ code: "Unknown", status });
      }
      expect(hits.map((hit) => new URL(hit.url).origin)).toEqual([
        "https://app.example",
        "https://app.example",
      ]);
      expect(hits.every((hit) => hit.bearer && hit.init?.redirect === "manual")).toBe(true);
      expect(hits[1]?.init?.credentials).toBe("include");
    }
  }),
);

const badBases = [
  "",
  "http:",
  "https:",
  "http:/",
  "http:127.0.0.1:1234",
  "http:/collector.example",
  "http:collector.example",
  "https:\\\\collector.example",
  "/api",
  "collector.example",
  "//collector.example",
  " https://app.example",
  "https://app.example\t",
  "https://user:pw@app.example",
  "https://@app.example",
  "https://app.example?x=1",
  "https://app.example#top",
  "file:///etc/passwd",
  "mailto:a@app.example",
  "data:text/plain,x",
  "javascript:alert(1)",
  "https://",
];

it("a baseUrl that is not an absolute http or https URL is refused when the client is built", () => {
  const api = defineApi({}, { write: endpoint(write, "POST /collector.example/x") });
  for (const baseUrl of badBases) {
    expect(() => toHttpClient([api.endpoints.write], { baseUrl }), baseUrl).toThrow(
      /^toHttpClient: baseUrl /u,
    );
    expect(() => toPromiseClient(api, { baseUrl }), baseUrl).toThrow(/^toPromiseClient: baseUrl /u);
    expect(() => toPromiseClient(api, { baseUrl }), baseUrl).toThrow(TypeError);
  }
  for (const baseUrl of [
    "https://app.example",
    "HTTP://127.0.0.1:1234",
    "https://app.example/v1",
  ]) {
    expect(() => toPromiseClient(api, { baseUrl }), baseUrl).not.toThrow();
  }
});

it.effect("with no baseUrl and no http page, every call fails before anything is sent", () =>
  Effect.gen(function* noBase() {
    const { hits, fetch } = network(200);
    const api = defineApi({}, { write: endpoint(write, "POST /collector.example/x") });
    for (const page of [undefined, { origin: "null" }, { origin: "file://" }, {}]) {
      vi.stubGlobal("location", page);
      const typed = yield* failureOf(
        withBearer(toHttpClient([api.endpoints.write]).write_value({ value: "private" })).pipe(
          Effect.provide(FetchHttpClient.layer),
          Effect.provideService(FetchHttpClient.Fetch, fetch),
        ),
      );
      const promised = yield* rejectionOf(() =>
        toPromiseClient(api, { token: () => "tok-ada", fetch }).write({ value: "private" }),
      );
      for (const failure of [typed, promised]) {
        expect(failure).toMatchObject({ code: "Unknown", status: 0 });
        expect(String(failure.body)).toMatch(/no base origin/u);
      }
    }
    expect(hits).toEqual([]);
  }).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals()))),
);

it.effect("a baseUrl with a path keeps it, and the page's path never joins the URL", () =>
  Effect.gen(function* basePath() {
    const { hits, fetch } = network(200);
    const api = defineApi({}, { write: endpoint(write, "POST /write") });
    yield* Effect.promise(() =>
      toPromiseClient(api, { baseUrl: "https://app.example/v1", fetch }).write({ value: "x" }),
    );
    vi.stubGlobal("location", { origin: "https://app.example", pathname: "/deep/page" });
    yield* Effect.promise(() => toPromiseClient(api, { fetch }).write({ value: "x" }));
    expect(hits.map((hit) => hit.url)).toEqual([
      "https://app.example/v1/write",
      "https://app.example/write",
    ]);
  }).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals()))),
);

it.effect("fetch options given only to the client's layer still go out", () =>
  Effect.gen(function* layerInit() {
    const { hits, fetch } = network(200);
    const api = defineApi({}, { write: endpoint(write, "POST /write") });
    const options = Layer.succeed(FetchHttpClient.RequestInit, {
      credentials: "omit",
      cache: "no-store",
      headers: { "x-layer": "kept" },
    });
    yield* toHttpClient([api.endpoints.write], { baseUrl: "https://app.example" })
      .write_value({ value: "x" })
      .pipe(
        Effect.provide(FetchHttpClient.layer.pipe(Layer.provide(options))),
        Effect.provideService(FetchHttpClient.Fetch, fetch),
      );
    const init = hits[0]?.init;
    expect(init).toMatchObject({ credentials: "omit", cache: "no-store", redirect: "manual" });
    expect(new Headers(init?.headers).get("x-layer")).toBe("kept");
    expect(new Headers(init?.headers).get("accept")).toBe("application/json");
  }),
);
