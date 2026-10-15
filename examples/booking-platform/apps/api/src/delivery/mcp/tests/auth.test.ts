import { afterAll, expect, it } from "@effect/vitest";
import { AuthJwtTesting } from "@house-rules/auth-jwt";
import { Effect } from "effect";
import { sessionCookie } from "../../../composition/callers.js";
import { app } from "../../../composition/index.js";
import { handler } from "../../../main.js";
import { mcpInitialize, mcpSend } from "./mcp-client.js";
import { bearer, issuer, resource, signedInApp } from "./signed-in.js";

afterAll(() => handler.dispose().then(() => app.dispose()));

const metadataUrl = "https://booking.example/.well-known/oauth-protected-resource/mcp";

it.live("no token is a 401 whose challenge names resource_metadata", () =>
  Effect.gen(function* missingToken() {
    const { mcp } = yield* signedInApp;
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

it.live("a bad token, a web sign-in token and a foreign-signed token are 401 invalid_token", () =>
  Effect.gen(function* badTokens() {
    const { mcp, noAudienceToken, accountsToken } = yield* signedInApp;
    const otherKeys = yield* AuthJwtTesting.keys;
    const tokens = [
      "not-a-jwt",
      // Issued for no audience, so not for this resource.
      yield* noAudienceToken("alice"),
      // The app's own sign-in token: MCP trusts only its authorization server.
      yield* accountsToken("web@example.test"),
      yield* otherKeys.sign({ iss: issuer, sub: "alice", aud: "https://booking.example/mcp" }),
    ];
    for (const token of tokens) {
      const answer = yield* mcpSend(mcp, bearer(token), mcpInitialize);
      expect(answer.status).toBe(401);
      expect(answer.headers.get("www-authenticate")).toBe(
        `Bearer error="invalid_token", resource_metadata="${metadataUrl}"`,
      );
      expect(JSON.parse(answer.body)).toMatchObject({ error: { code: "token_invalid" } });
    }
  }),
);

it.live("the web session cookie is ignored: MCP reads only the bearer header", () =>
  Effect.gen(function* cookieIgnored() {
    const { mcp, mcpToken, accountsToken } = yield* signedInApp;
    // Even a token MCP would accept is no token at all when it comes as the page's cookie.
    for (const token of [yield* mcpToken("alice"), yield* accountsToken("cookie@example.test")]) {
      const cookie = { cookie: `${sessionCookie}=${token}` };
      const answer = yield* mcpSend(mcp, cookie, mcpInitialize);
      expect(answer.status).toBe(401);
      expect(JSON.parse(answer.body)).toMatchObject({ error: { code: "token_missing" } });
    }
  }),
);

it.live("a token issued for this resource opens a session", () =>
  Effect.gen(function* goodToken() {
    const { mcp, mcpToken } = yield* signedInApp;
    const answer = yield* mcpSend(mcp, bearer(yield* mcpToken("alice")), mcpInitialize);
    expect(answer.status).toBe(200);
  }),
);

it.effect("the metadata document names this resource and its authorization server", () =>
  Effect.gen(function* metadata() {
    expect(resource.paths).toEqual([
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
    ]);
    for (const path of resource.paths) {
      const response = yield* Effect.promise(() =>
        resource.handler(new Request(`https://booking.example${path}`) as Request),
      );
      expect(response.status).toBe(200);
      expect(yield* Effect.promise(() => response.json())).toEqual({
        resource: "https://booking.example/mcp",
        authorization_servers: ["https://id.example"],
        bearer_methods_supported: ["header"],
        resource_name: "Booking example",
      });
    }
  }),
);

it.effect("fails closed: the running app without auth config refuses MCP and its metadata", () =>
  Effect.gen(function* notConfigured() {
    for (const method of ["POST", "GET", "DELETE"]) {
      const answer = yield* mcpSend(handler, bearer("tok-a"), mcpInitialize, method);
      expect(answer.status).toBe(503);
      expect(answer.headers.get("www-authenticate")).toBeNull();
      expect(JSON.parse(answer.body)).toMatchObject({ error: { code: "not_configured" } });
    }
    for (const path of [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
    ]) {
      const response = yield* Effect.promise(() =>
        handler(new Request(`https://booking.example${path}`) as Request),
      );
      expect(response.status).toBe(503);
      const post = yield* Effect.promise(() =>
        handler(new Request(`https://booking.example${path}`, { method: "POST" }) as Request),
      );
      expect(post.status).toBe(405);
    }
  }),
);
