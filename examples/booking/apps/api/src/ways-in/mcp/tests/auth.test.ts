import { assert, it } from "@effect/vitest";
import { toFetchHandler, call, Mean } from "@house-rules/application";
import { AuthJwt, AuthJwtTesting } from "@house-rules/auth-jwt";
import { Actor, ActorId } from "@house-rules/domain";
import { Identity } from "@house-rules/identity";
import { Effect, Layer } from "effect";
import { createApp, Features, modulesLayer, resourceOf } from "../../../composition/index.ts";
import { databaseTesting } from "../../../composition/tests/database.ts";
import { webWay } from "../../web/way.ts";
import { mcpWay } from "../way.ts";
import { rpcTesting, sessionTesting, requestTesting } from "./protocol.ts";

it.live(
  "signed MCP admission checks challenge, metadata, signature, issuer, audience, expiry and existing sessions",
  () =>
    Effect.gen(function* () {
      if (mcpWay.protocol !== "mcp") return assert.fail("Expected MCP");
      const template = mcpWay;
      const keys = yield* AuthJwtTesting.keys;
      const issuer = "https://outside.invalid";
      const resource = resourceOf("https://booking.example", issuer);
      if (!resource.configured) return assert.fail("Expected configured resource");
      const auth = AuthJwt.layer({ issuer, jwks: keys.jwks }).pipe(Layer.orDie);
      const identity = Identity.who({
        token: "bearer",
        audience: resource.metadata.resource,
        challenge: resource.challenge,
      });
      const who = {
        resolve: (incoming: { headers: Headers; url: string }) =>
          identity.resolve(incoming).pipe(Effect.provide(auth)),
      };
      const app = yield* Effect.acquireRelease(
        Effect.sync(() => createApp([{ ...template, resource, who }])),
        (app) => Effect.promise(() => app.dispose()),
      );
      const router = yield* Effect.acquireRelease(
        Effect.sync(() => toFetchHandler(app)),
        (router) => Effect.promise(() => router.dispose()),
      );
      const missing = yield* rpcTesting(router, {}, {});
      assert.strictEqual(missing.status, 401);
      assert.include(missing.headers.get("www-authenticate") ?? "", "resource_metadata");
      for (const path of resource.paths)
        for (const method of ["GET", "HEAD", "POST"]) {
          const r = yield* Effect.promise(() =>
            router(new Request(`https://booking.example${path}`, { method })),
          );
          assert.strictEqual(r.status, method === "POST" ? 405 : 200);
          if (method === "GET")
            assert.deepInclude(yield* Effect.promise(() => r.json()), {
              resource: "https://booking.example/mcp",
              authorization_servers: [issuer],
            });
          if (method === "HEAD") assert.strictEqual(yield* Effect.promise(() => r.text()), "");
        }
      const token = yield* keys.sign({
        iss: issuer,
        sub: "alice",
        aud: "https://booking.example/mcp",
      });
      const session = yield* sessionTesting(router, { authorization: `Bearer ${token}` });
      assert.notStrictEqual(session["mcp-session-id"], "");
      const other = yield* AuthJwtTesting.keys;
      const badTokens = [
        yield* keys.sign({ iss: issuer, sub: "alice", aud: "https://elsewhere.invalid/mcp" }),
        yield* keys.sign({
          iss: "https://wrong.invalid",
          sub: "alice",
          aud: "https://booking.example/mcp",
        }),
        yield* keys.sign({ iss: issuer, sub: "alice", aud: "https://booking.example/mcp", exp: 1 }),
        yield* other.sign({ iss: issuer, sub: "alice", aud: "https://booking.example/mcp" }),
      ];
      for (const bad of badTokens) {
        const refused = yield* rpcTesting(
          router,
          { ...session, authorization: `Bearer ${bad}` },
          { jsonrpc: "2.0", id: 9, method: "tools/list", params: {} },
        );
        assert.strictEqual(refused.status, 401);
        assert.include(refused.headers.get("www-authenticate") ?? "", "invalid_token");
      }
      const withoutToken = {
        "mcp-session-id": session["mcp-session-id"],
        "mcp-protocol-version": session["mcp-protocol-version"],
      };
      assert.strictEqual(
        (yield* rpcTesting(router, withoutToken, {
          jsonrpc: "2.0",
          id: 10,
          method: "tools/list",
          params: {},
        })).status,
        401,
      );
      assert.isDefined((yield* requestTesting(router, session, "tools/list", {}))?.["tools"]);
      const closedApp = yield* Effect.acquireRelease(
        Effect.sync(() => createApp([mcpWay])),
        (app) => Effect.promise(() => app.dispose()),
      );
      const closed = yield* Effect.acquireRelease(
        Effect.sync(() => toFetchHandler(closedApp)),
        (router) => Effect.promise(() => router.dispose()),
      );
      const unset = yield* rpcTesting(closed, {}, {});
      assert.strictEqual(unset.status, 503);
      assert.isFalse(unset.headers.has("www-authenticate"));
      for (const path of resourceOf("https://booking.example", "").paths)
        for (const method of ["GET", "HEAD", "POST"]) {
          const r = yield* Effect.promise(() =>
            closed(new Request(`https://booking.example${path}`, { method })),
          );
          assert.strictEqual(r.status, method === "POST" ? 405 : 503);
          assert.isFalse(r.headers.has("www-authenticate"));
          if (method === "GET")
            assert.include(yield* Effect.promise(() => r.text()), "not_configured");
          if (method === "HEAD") assert.strictEqual(yield* Effect.promise(() => r.text()), "");
        }
    }).pipe(Effect.scoped),
);

it.live(
  "real PG MCP both read-only tools enforce fake A/B privacy; cancel is absent",
  () =>
    Effect.gen(function* () {
      if (mcpWay.protocol !== "mcp") return assert.fail("Expected MCP");
      const template = mcpWay;
      const actor = (id: string) => Actor.make({ id: ActorId.make(id) });
      const fake = (id: string) => ({ resolve: () => Effect.succeed(actor(id)) });
      const resource = resourceOf("https://booking.example", "https://outside.invalid");
      assert.strictEqual(mcpWay.mean, Mean.elicitation);
      const app = yield* Effect.acquireRelease(
        Effect.sync(() =>
          createApp(
            [
              { ...webWay, who: fake("A") },
              {
                ...template,
                resource,
                who: {
                  resolve: (incoming: { headers: Headers; url: string }) =>
                    Effect.succeed(
                      actor(incoming.headers.get("authorization") === "Bearer B" ? "B" : "A"),
                    ),
                },
              },
            ],
            { modules: modulesLayer().pipe(Layer.provide(databaseTesting)) },
          ),
        ),
        (app) => Effect.promise(() => app.dispose()),
      );
      const router = yield* Effect.acquireRelease(
        Effect.sync(() => toFetchHandler(app)),
        (router) => Effect.promise(() => router.dispose()),
      );
      const booked = yield* Effect.promise(() =>
        call(
          app,
          Features.makeBooking,
          { id: "a", guestName: "Alice", paymentId: "pa", amount: 100 },
          { headers: new Headers(), url: "https://booking.example/api" },
          { way: "web" },
        ),
      );
      assert.isTrue(booked.ok);
      for (const name of ["A", "B"]) {
        const session = yield* sessionTesting(router, { authorization: `Bearer ${name}` });
        const listed = yield* requestTesting(router, session, "tools/list", {});
        const tools = listed?.["tools"] as readonly {
          name: string;
          annotations: { readOnlyHint: boolean; destructiveHint: boolean };
        }[];
        assert.deepStrictEqual(tools.map((t) => t.name).sort(), ["my_bookings", "show_booking"]);
        assert.isTrue(
          tools.every((t) => t.annotations.readOnlyHint && !t.annotations.destructiveHint),
        );
        const shown = yield* requestTesting(router, session, "tools/call", {
          name: "show_booking",
          arguments: { id: "a" },
        });
        const mine = yield* requestTesting(router, session, "tools/call", {
          name: "my_bookings",
          arguments: {},
        });
        assert.strictEqual(shown?.["isError"], name === "B");
        assert.isFalse(mine?.["isError"]);
        if (name === "A") {
          assert.deepInclude(shown?.["structuredContent"], { id: "a", ownerId: "A" });
          assert.include(JSON.stringify(mine), "Alice");
        } else {
          assert.notInclude(JSON.stringify(shown), "Alice");
          assert.notInclude(JSON.stringify(mine), "Alice");
          assert.notInclude(JSON.stringify(mine), '"id":"a"');
        }
        const cancel = yield* rpcTesting(router, session, {
          jsonrpc: "2.0",
          id: 7,
          method: "tools/call",
          params: { name: "cancel_booking", arguments: { id: "a" } },
        });
        assert.isDefined(cancel.messages.find((m) => m.id === 7)?.error);
      }
    }).pipe(Effect.scoped),
  30_000,
);
