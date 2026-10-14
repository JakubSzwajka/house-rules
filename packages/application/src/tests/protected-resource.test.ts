import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { protectedResource, protectedResourceMetadataPath } from "../index.ts";

const options = {
  resource: "https://app.example/mcp",
  authorizationServers: ["https://issuer.example/"],
  resourceName: "Booking example",
};

const ask = (handler: (request: Request) => Promise<Response>, method = "GET") =>
  Effect.gen(function* () {
    const response = yield* Effect.promise(() =>
      handler(
        new Request(`https://app.example${protectedResourceMetadataPath}/mcp`, {
          method,
        }) as Request,
      ),
    );
    const body = yield* Effect.promise(() => response.text());
    return { response, body };
  });

describe("protectedResource", () => {
  it.effect("serves the RFC 9728 metadata on GET and HEAD", () =>
    Effect.gen(function* () {
      const resource = protectedResource(options);
      expect(resource.paths).toEqual([
        "/.well-known/oauth-protected-resource",
        "/.well-known/oauth-protected-resource/mcp",
      ]);
      const { response, body } = yield* ask(resource.handler);
      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(JSON.parse(body)).toEqual({
        resource: "https://app.example/mcp",
        authorization_servers: ["https://issuer.example/"],
        bearer_methods_supported: ["header"],
        resource_name: "Booking example",
      });
    }),
  );

  it.effect("answers HEAD with the GET status and headers and an empty body", () =>
    Effect.gen(function* () {
      const resource = protectedResource(options);
      const get = yield* ask(resource.handler);
      const head = yield* ask(resource.handler, "HEAD");
      expect(head.response.status).toBe(200);
      expect(head.body).toBe("");
      expect(head.response.headers.get("content-type")).toBe(
        get.response.headers.get("content-type"),
      );
      expect(head.response.headers.get("cache-control")).toBe("public, max-age=3600");
      const closed = yield* ask(protectedResource(undefined).handler, "HEAD");
      expect(closed.response.status).toBe(503);
      expect(closed.response.headers.get("cache-control")).toBe("no-store");
      expect(closed.body).toBe("");
    }),
  );

  it("keeps each authorization server exactly as given", () => {
    const servers = [
      "https://issuer.example",
      "https://issuer.example/",
      "https://auth.example.com/tenant/",
      "https://Auth.Example.com:443/a/../b",
    ];
    const resource = protectedResource({ ...options, authorizationServers: servers });
    expect(resource.metadata.authorization_servers).toEqual(servers);
  });

  it.effect("answers 405 to any other method", () =>
    Effect.gen(function* () {
      const { response, body } = yield* ask(protectedResource(options).handler, "POST");
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("GET, HEAD");
      expect(JSON.parse(body)).toMatchObject({ error: { code: "method_not_allowed" } });
    }),
  );

  it.effect("fails closed with 503 not_configured when auth is unset", () =>
    Effect.gen(function* () {
      const resource = protectedResource(undefined, "/mcp");
      expect(resource.configured).toBe(false);
      // @ts-expect-error an unconfigured resource has no challenge
      expect(resource.challenge).toBeUndefined();
      expect(resource.paths).toEqual([
        "/.well-known/oauth-protected-resource",
        "/.well-known/oauth-protected-resource/mcp",
      ]);
      const { response, body } = yield* ask(resource.handler);
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(JSON.parse(body)).toMatchObject({ error: { code: "not_configured" } });
      expect((yield* ask(resource.handler, "DELETE")).response.status).toBe(405);
      expect(protectedResource(undefined).paths).toEqual(["/.well-known/oauth-protected-resource"]);
    }),
  );

  it("builds the WWW-Authenticate challenge with resource_metadata", () => {
    const resource = protectedResource(options);
    const metadataUrl = "https://app.example/.well-known/oauth-protected-resource/mcp";
    expect(resource.metadataUrl).toBe(metadataUrl);
    expect(resource.challenge()).toBe(`Bearer resource_metadata="${metadataUrl}"`);
    expect(resource.challenge("invalid_token")).toBe(
      `Bearer error="invalid_token", resource_metadata="${metadataUrl}"`,
    );
  });

  it("omits resource_name when not given and keeps a root resource on one path", () => {
    const resource = protectedResource({
      resource: "https://app.example/",
      authorizationServers: ["https://issuer.example"],
    });
    expect(resource.paths).toEqual(["/.well-known/oauth-protected-resource"]);
    expect(resource.metadata).not.toHaveProperty("resource_name");
    expect(resource.metadataUrl).toBe("https://app.example/.well-known/oauth-protected-resource");
  });

  it("refuses a resource or authorization server that is not an http(s) URL", () => {
    expect(() => protectedResource({ ...options, resource: "/mcp" })).toThrow(TypeError);
    expect(() => protectedResource({ ...options, authorizationServers: [] })).toThrow(TypeError);
    expect(() =>
      protectedResource({ ...options, authorizationServers: ["ftp://issuer.example"] }),
    ).toThrow(TypeError);
  });
});
