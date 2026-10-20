import { expect, layer } from "@effect/vitest";
import { defineNode, NoInput } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { call, defineEntry, endpoint } from "../../index.ts";
import { bindFixture } from "../../tests/entry-fixtures.ts";
import { bothFixture } from "../../tests/router-fixtures.ts";
import { mcpInitialize } from "../../tests/delivery-mcp-client.ts";
import { answer, webRequest } from "../../tests/delivery-fixtures.ts";
import { sqlWorld } from "./unit-of-work-fixtures.ts";

layer(sqlWorld, { excludeTestServices: true, timeout: "30 seconds" })(
  "raw SQL plumbing views",
  (it) => {
    it.effect(
      "maps a real unwrapped SqlError to unavailable without an app mapper or SQL disclosure",
      () =>
        Effect.gen(function* () {
          const sql = yield* SqlClient;
          const error = yield* Effect.flip(sql`select house_rules_missing_private_column`);
          const entry = bindFixture(
            defineEntry(
              defineNode("probe", {
                description: "Read.",
                input: NoInput,
                output: Schema.Void,
                failure: Schema.Never,
                permission: null,
                readOnly: true,
              }),
            ),
            () => Effect.void,
          );
          const fixture = bothFixture([entry], {
            endpoints: [endpoint(entry)],
            extra: Layer.effectDiscard(Effect.fail(error)),
          });
          const result = yield* Effect.promise(() =>
            call(fixture.app, entry, {}, { headers: new Headers(), url: "/" }, { way: "web" }),
          );
          expect(result).toMatchObject({
            ok: false,
            view: {
              status: 503,
              body: { error: { code: "unavailable", message: "Try again shortly." } },
            },
          });
          const http = yield* answer(
            fixture.handler,
            webRequest("https://app.example/probe", { method: "POST", body: "{}" }),
          );
          expect(http.status).toBe(503);
          const mcp = yield* answer(
            fixture.handler,
            webRequest("https://app.example/mcp", {
              method: "POST",
              headers: { authorization: "Bearer fixture", "content-type": "application/json" },
              body: JSON.stringify(mcpInitialize),
            }),
          );
          expect(mcp.status).toBe(503);
          for (const body of [http.body, mcp.body]) {
            expect(body).toEqual({ error: { code: "unavailable", message: "Try again shortly." } });
            expect(JSON.stringify(body)).not.toMatch(
              /house_rules_missing_private_column|SqlError|Postgres|binding|adapter/u,
            );
            expect(JSON.stringify(body)).not.toContain(error.message);
          }
          yield* Effect.promise(fixture.dispose);
        }),
    );
  },
);
