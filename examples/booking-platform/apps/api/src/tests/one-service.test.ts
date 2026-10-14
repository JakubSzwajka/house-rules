import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it, vi } from "@effect/vitest";
import { Effect, FileSystem } from "effect";

const page = "<!doctype html><title>Booking example</title>";
const asset = "/assets/index-Bv2s0r59.js";

const oneService = Effect.gen(function* oneService() {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "booking-web-" });
  yield* fs.makeDirectory(`${root}/assets`);
  yield* fs.writeFileString(`${root}/index.html`, page);
  yield* fs.writeFileString(`${root}${asset}`, "console.log('page')");
  yield* fs.writeFileString(`${root}/.env`, "SECRET=1");
  vi.stubEnv("WEB_ROOT", root);
  const main = yield* Effect.promise(() => import("../main.js"));
  const { app } = yield* Effect.promise(() => import("../composition/index.js"));
  yield* Effect.addFinalizer(() =>
    Effect.promise(() => main.handler.dispose().then(app.dispose)).pipe(
      Effect.ensuring(Effect.sync(() => vi.unstubAllEnvs())),
    ),
  );
  return main.handler;
}).pipe(Effect.provide(NodeServices.layer));

const send = (
  handler: (request: Request) => Promise<Response>,
  path: string,
  init: RequestInit = {},
) =>
  Effect.promise(() => handler(new Request(`https://booking.example${path}`, init))).pipe(
    Effect.flatMap((response) =>
      Effect.promise(() => response.text()).pipe(
        Effect.map((body) => ({ status: response.status, headers: response.headers, body })),
      ),
    ),
  );

const html = { headers: { accept: "text/html" } };

it.effect("one handler serves the built page and the API", () =>
  Effect.gen(function* servesBoth() {
    const handler = yield* oneService;

    const home = yield* send(handler, "/", html);
    expect(home.status).toBe(200);
    expect(home.body).toBe(page);
    expect(home.headers.get("cache-control")).toBe("no-cache");

    const script = yield* send(handler, asset);
    expect(script.status).toBe(200);
    expect(script.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");

    const deepLink = yield* send(handler, "/bookings/b-1", html);
    expect(deepLink.body).toBe(page);

    expect((yield* send(handler, "/.env", html)).status).toBe(404);
    expect((yield* send(handler, "/assets/gone.js")).status).toBe(404);

    const booking = yield* send(handler, "/api/bookings/demo", html);
    expect(booking.status).toBe(200);
    expect(JSON.parse(booking.body)).toEqual({
      id: "demo",
      guestName: "Ada Lovelace",
      status: "active",
    });

    // Paths the API owns never fall back to the page, even when a browser asks for HTML.
    const missing = yield* send(handler, "/api/nothing/here", html);
    expect(missing.status).toBe(404);
    expect(missing.body).not.toBe(page);
    const metadata = yield* send(handler, "/.well-known/oauth-protected-resource", html);
    expect(metadata.status).toBe(503);
    const mcp = yield* send(handler, "/mcp", html);
    expect(mcp.status).toBe(503);
  }),
);
