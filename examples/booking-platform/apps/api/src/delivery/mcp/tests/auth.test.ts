import { afterAll, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { app } from "../../../composition/index.js";
import { handler } from "../../../main.js";
import { metadataHandler } from "../metadata.js";
import { mcpRoute } from "../route.js";
import { appWithFakeVerifier, config } from "./fake-verifier.js";
import { mcpInitialize, mcpSend } from "./mcp-client.js";

const faked = appWithFakeVerifier();
const mcp = mcpRoute(faked, config);
const unverified = mcpRoute(app, config);
afterAll(() =>
  Promise.all([mcp.dispose(), unverified.dispose(), handler.dispose()])
    .then(() => faked.dispose())
    .then(() => app.dispose()),
);

const metadataUrl = "https://hosti.example/.well-known/oauth-protected-resource/mcp";

it.effect("no token is a 401 whose challenge names resource_metadata", () =>
  Effect.gen(function* missingToken() {
    for (const method of ["POST", "GET", "DELETE"]) {
      const answer = yield* mcpSend(mcp, {}, mcpInitialize, method);
      expect(answer.status).toBe(401);
      expect(answer.headers.get("www-authenticate")).toBe(
        `Bearer resource_metadata="${metadataUrl}"`,
      );
      expect(JSON.parse(answer.body)).toMatchObject({ error: { code: "token_missing" } });
    }
  }),
);

it.effect("an unknown token is a 401 invalid_token with the same challenge", () =>
  Effect.gen(function* badToken() {
    const answer = yield* mcpSend(mcp, { authorization: "Bearer tok-nobody" }, mcpInitialize);
    expect(answer.status).toBe(401);
    expect(answer.headers.get("www-authenticate")).toBe(
      `Bearer error="invalid_token", resource_metadata="${metadataUrl}"`,
    );
  }),
);

it.effect("the metadata document names this resource and its authorization server", () =>
  Effect.gen(function* metadata() {
    const serve = metadataHandler(config);
    for (const path of [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
    ]) {
      const response = yield* Effect.promise(() =>
        serve(new Request(`https://hosti.example${path}`) as Request),
      );
      expect(response.status).toBe(200);
      expect(yield* Effect.promise(() => response.json())).toEqual({
        resource: "https://hosti.example/mcp",
        authorization_servers: ["https://id.example"],
        bearer_methods_supported: ["header"],
        resource_name: "Hosti",
      });
    }
  }),
);

it.effect(
  "fails closed: with no real verifier, even a token the fake would accept is refused",
  () =>
    Effect.gen(function* noVerifier() {
      const answer = yield* mcpSend(unverified, { authorization: "Bearer tok-a" }, mcpInitialize);
      expect(answer.status).toBe(401);
      expect(JSON.parse(answer.body)).toMatchObject({ error: { code: "token_invalid" } });
    }),
);

it.effect("fails closed: the running app without auth config refuses MCP and its metadata", () =>
  Effect.gen(function* notConfigured() {
    for (const method of ["POST", "GET", "DELETE"]) {
      const answer = yield* mcpSend(
        handler,
        { authorization: "Bearer tok-a" },
        mcpInitialize,
        method,
      );
      expect(answer.status).toBe(503);
      expect(JSON.parse(answer.body)).toMatchObject({ error: { code: "not_configured" } });
    }
    const response = yield* Effect.promise(() =>
      handler(new Request("https://hosti.example/.well-known/oauth-protected-resource") as Request),
    );
    expect(response.status).toBe(503);
  }),
);
