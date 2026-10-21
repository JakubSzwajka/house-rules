import { featureFixture } from "./feature-fixtures.ts";
import { afterAll, expect, it } from "@effect/vitest";
import { defineOperation, NoInput } from "@house-rules/domain";
import { DateTime, Effect, Schema } from "effect";
import { endpoint } from "../index.ts";
import { answer, webRequest } from "./delivery-fixtures.ts";
import { callMcpTool, mcpInitialize, mcpPost, openMcpSession } from "./delivery-mcp-client.ts";
import { bindFixture } from "./execution-fixtures.ts";
import { bothFixture, mcpFixture } from "./router-fixtures.ts";

const disposers: Array<() => Promise<void>> = [];
afterAll(() => Promise.all(disposers.map((dispose) => dispose())));
const when = bindFixture(
  featureFixture(
    defineOperation("when_is_it", {
      description: "Read a count and an instant.",
      input: NoInput,
      output: Schema.Struct({ count: Schema.FiniteFromString, at: Schema.Date }),
      failure: Schema.Never,
      permission: null,
      readOnly: true,
    }),
  ),
  () => Effect.succeed({ count: 5, at: DateTime.toDateUtc(DateTime.makeUnsafe(0)) }),
);

it.effect("HTTP and the real MCP router encode transforming outputs exactly once", () =>
  Effect.gen(function* () {
    const fixture = bothFixture([when], { endpoints: [endpoint(when)] });
    disposers.push(fixture.dispose);
    const encoded = { count: "5", at: "1970-01-01T00:00:00.000Z" };
    const http = yield* answer(
      fixture.handler,
      webRequest("https://app.example/when_is_it", {
        method: "POST",
        body: "{}",
      }),
    );
    expect(http.status).toBe(200);
    expect(http.body).toEqual(encoded);
    const session = yield* openMcpSession(fixture.handler, { authorization: "Bearer fixture" });
    const mcp = yield* callMcpTool(fixture.handler, session, "when_is_it", {});
    expect(mcp.answer.status).toBe(200);
    expect(mcp.result).toMatchObject({ isError: false, structuredContent: encoded });
    expect(mcp.result?.["content"]).toEqual([{ type: "text", text: JSON.stringify(encoded) }]);
  }),
);

it.effect(
  "MCP admits only configured browser Origins, and still accepts requests without Origin",
  () =>
    Effect.gen(function* () {
      const fixture = mcpFixture([when], {
        allowedOrigins: ["https://client.example"],
        tools: [{ feature: when, title: "When", idempotent: true, openWorld: false }],
      });
      disposers.push(fixture.dispose);
      for (const origin of [undefined, "https://client.example", "https://evil.example", "null"]) {
        const response = yield* mcpPost(
          fixture.handler,
          {
            authorization: "Bearer fixture",
            ...(origin === undefined ? {} : { origin }),
          },
          mcpInitialize,
        );
        expect(response.status).toBe(
          origin === undefined || origin === "https://client.example" ? 200 : 403,
        );
      }
      const defaultFixture = mcpFixture([when], {
        tools: [{ feature: when, title: "When", idempotent: true, openWorld: false }],
      });
      disposers.push(defaultFixture.dispose);
      expect(
        (yield* mcpPost(
          defaultFixture.handler,
          {
            authorization: "Bearer fixture",
            origin: "https://client.example",
          },
          mcpInitialize,
        )).status,
      ).toBe(403);
    }),
);
