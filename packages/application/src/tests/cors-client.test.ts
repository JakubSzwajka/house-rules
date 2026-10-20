import { afterAll, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { defineApi, endpoint, HttpFailure, toFetchHandler, toPromiseClient } from "../index.ts";
import { makeApp, renameGuest, showBooking, webRequest } from "./delivery-fixtures.ts";

const api = defineApi(
  { prefix: "/api" },
  {
    showBooking: endpoint(showBooking, "GET /bookings/:id", { codes: ["not_found"] }),
    renameGuest: endpoint(renameGuest, "PATCH /bookings/:id"),
  },
);

const t = makeApp({
  endpoints: Object.values(api.endpoints),
  cors: { origins: ["https://web.example"] },
});
const handler = toFetchHandler(t.app);
afterAll(() => handler.dispose().then(t.dispose));

const safelistedResponse = new Set([
  "cache-control",
  "content-language",
  "content-length",
  "content-type",
  "expires",
  "last-modified",
  "pragma",
]);

const listed = (value: string | null) =>
  (value ?? "").split(",").map((each) => each.trim().toLowerCase());

const blocked = () => Promise.reject(new TypeError("Failed to fetch"));

const readableTo = (page: string, response: Response): Promise<Response> => {
  if (response.headers.get("access-control-allow-origin") !== page) return blocked();
  const exposed = listed(response.headers.get("access-control-expose-headers"));
  const readable = new Headers();
  for (const [name, value] of response.headers) {
    if (safelistedResponse.has(name) || exposed.includes(name)) readable.set(name, value);
  }
  return Promise.resolve(
    new Response(response.body, { status: response.status, headers: readable }) as Response,
  );
};

const allows = (page: string, sent: Request, names: ReadonlyArray<string>, asked: Response) => {
  const allowedHeaders = listed(asked.headers.get("access-control-allow-headers"));
  return (
    asked.ok &&
    asked.headers.get("access-control-allow-origin") === page &&
    listed(asked.headers.get("access-control-allow-methods")).includes(sent.method.toLowerCase()) &&
    names.every((name) => allowedHeaders.includes(name))
  );
};

const browserOn =
  (page: string): typeof globalThis.fetch =>
  (url, init) => {
    const sent = webRequest(String(url), init);
    const names = [...sent.headers.keys()].filter((name) => name !== "accept");
    const preflight = webRequest(sent.url, {
      method: "OPTIONS",
      headers: {
        origin: page,
        "access-control-request-method": sent.method,
        "access-control-request-headers": names.join(","),
      },
    });
    return handler(preflight).then((asked) => {
      if (!allows(page, sent, names, asked)) return blocked();
      const headers = new Headers(sent.headers);
      headers.set("origin", page);
      return handler(webRequest(sent.url, { ...init, headers })).then((response) =>
        readableTo(page, response),
      );
    });
  };

const clientOn = (page: string) =>
  toPromiseClient(api, {
    baseUrl: "https://api.example",
    token: () => "tok-ada",
    fetch: browserOn(page),
  });

const failureOf = <A>(call: () => Promise<A>) =>
  Effect.promise(() =>
    call().then(
      () => undefined,
      (error: unknown) => error,
    ),
  ).pipe(
    Effect.flatMap((error) =>
      Schema.is(HttpFailure)(error) ? Effect.succeed(error) : Effect.die(error),
    ),
  );

it.effect("a page on a listed origin reads and writes through the client's baseUrl", () =>
  Effect.gen(function* listedPage() {
    const client = clientOn("https://web.example");
    const booking = yield* Effect.promise(() => client.showBooking({ id: "b-1" }));
    expect(booking).toMatchObject({ id: "b-1", guestName: "Ada" });
    const renamed = yield* Effect.promise(() =>
      client.renameGuest({ id: "b-1", guestName: "Ada Lovelace" }),
    );
    expect(renamed).toEqual({ id: "b-1" });
  }),
);

it.effect("the exposed failure code reaches the page as a typed failure", () =>
  Effect.gen(function* typedFailure() {
    const failure = yield* failureOf(() =>
      clientOn("https://web.example").showBooking({ id: "missing" }),
    );
    expect(failure).toMatchObject({ code: "not_found", status: 404 });
  }),
);

it.effect("a page on an unlisted origin is blocked by its browser before any call runs", () =>
  Effect.gen(function* unlistedPage() {
    const before = { ...t.work };
    const failure = yield* failureOf(() =>
      clientOn("https://evil.example").renameGuest({ id: "b-1", guestName: "Mallory" }),
    );
    expect(failure).toMatchObject({ code: "Unknown", status: 0 });
    expect(t.work).toEqual(before);
  }),
);
