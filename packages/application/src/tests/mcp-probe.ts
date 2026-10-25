import { featureFixture } from "./feature-fixtures.ts";
import { afterAll } from "@effect/vitest";
import { defineOperation, errorKind, type InputSchema } from "@house-rules/domain";
import { Effect, Schema } from "effect";
import { bindFixture } from "./execution-fixtures.ts";
import { callMcpTool, mcpPost, openMcpSession } from "./delivery-mcp-client.ts";
import { mcpFixture } from "./router-fixtures.ts";

export class ProbeRejected extends Schema.TaggedError<ProbeRejected>()("ProbeRejected", {
  kind: errorKind("invalid"),
  message: Schema.String,
}) {}
const disposers: Array<() => Promise<void>> = [];
afterAll(() => Promise.all(disposers.map((dispose) => dispose())));
export const wireValue = (value: unknown): unknown => {
  const text = JSON.stringify(value);
  return text === undefined ? undefined : JSON.parse(text);
};

export const mcpProbe = <I extends InputSchema>(name: string, input: I) => {
  const calls: I["Type"][] = [];
  const feature = bindFixture(
    featureFixture(
      defineOperation(name, {
        description: "Probe one input through the real MCP router.",
        input,
        output: Schema.String,
        failure: Schema.Never,
        permission: null,
        readOnly: true,
      }),
    ),
    (value) =>
      Effect.sync(() => {
        calls.push(value);
        return "ok";
      }),
  );
  const fixture = mcpFixture([feature], {
    tools: [{ feature, title: "Probe", idempotent: true, openWorld: false }],
  });
  disposers.push(fixture.dispose);
  let session: Record<string, string> | undefined;
  const ready = Effect.gen(function* () {
    if (session === undefined)
      session = yield* openMcpSession(fixture.handler, { authorization: "Bearer fixture" });
    return session;
  });
  const schema = Effect.gen(function* () {
    const answer = yield* mcpPost(fixture.handler, yield* ready, {
      jsonrpc: "2.0",
      id: 9,
      method: "tools/list",
      params: {},
    });
    const tools = answer.messages.find((message) => message.id === 9)?.result?.["tools"] as
      | Array<{
          name: string;
          inputSchema: Record<string, unknown>;
          annotations: Record<string, unknown>;
          description?: string;
        }>
      | undefined;
    const tool = tools?.find((tool) => tool.name === name);
    if (tool === undefined) return yield* Effect.die("The router did not list its probe tool");
    return tool;
  });
  const decode = (raw: unknown): Effect.Effect<I["Type"], ProbeRejected> =>
    Effect.gen(function* () {
      calls.length = 0;
      const answer = yield* callMcpTool(fixture.handler, yield* ready, name, raw);
      if (calls.length !== 1 || answer.result?.["isError"] !== false) {
        return yield* new ProbeRejected({
          message: JSON.stringify(answer.result ?? answer.answer.messages),
        });
      }
      return calls[0] as I["Type"];
    });
  return { feature, input, calls, schema, decode, fixture };
};
