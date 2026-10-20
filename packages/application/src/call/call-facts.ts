import { Context, Effect, Option } from "effect";
import { McpSchema } from "effect/ai";
import type { AnyEntry } from "../entry/entry.ts";

export type CallKind = "read" | "write";

export type CallFacts = Readonly<{
  kind: CallKind;
  target: string;
  targetId: string | null;
  channel: string;
  requestId: string | null;
}>;

export const CallChannel = Context.Reference<string>("@house-rules/application/CallChannel", {
  defaultValue: () => "unknown",
});

export const CallRequestId = Context.Reference<string | null>(
  "@house-rules/application/CallRequestId",
  { defaultValue: () => null },
);

export const maxClientNameLength = 40;
export const maxTargetIdLength = 256;

const notClientNameCharacter = /[^A-Za-z0-9._ -]/gu;

export const mcpChannel = (clientName: string | undefined): string => {
  const name = (clientName ?? "")
    .replace(notClientNameCharacter, "")
    .trim()
    .slice(0, maxClientNameLength)
    .trim();
  return name === "" ? "mcp" : `mcp:${name}`;
};

export const isMcpChannel = (channel: string): boolean =>
  channel === "mcp" || channel.startsWith("mcp:");

export const unknownCallFacts = (entry: AnyEntry): CallFacts => ({
  kind: entry.readOnly ? "read" : "write",
  target: entry.node.name,
  targetId: null,
  channel: "unknown",
  requestId: null,
});

export const callFactsOf = (entry: AnyEntry): Effect.Effect<CallFacts> =>
  Effect.gen(function* callFacts() {
    // The MCP server provides McpRequestContext to every tool call, so an MCP call wins over the app's channel.
    const mcp = yield* Effect.serviceOption(McpSchema.McpRequestContext);
    const channel = Option.isSome(mcp)
      ? mcpChannel(mcp.value.clientInfo?.name)
      : yield* CallChannel;
    return {
      kind: entry.readOnly ? "read" : "write",
      target: entry.node.name,
      targetId: null,
      channel,
      requestId: yield* CallRequestId,
    };
  });
