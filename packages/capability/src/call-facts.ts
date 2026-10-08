import { Context, Effect, Option } from "effect";
import { McpSchema } from "effect/unstable/ai";
import type { AnyContract } from "./contract.ts";

export type CallKind = "read" | "write";

export type CallFacts = Readonly<{
  kind: CallKind;
  targetId: string | null;
  channel: string;
  requestId: string | null;
}>;

export const CallChannel = Context.Reference<string>("@house-rules/capability/CallChannel", {
  defaultValue: () => "unknown",
});

export const CallRequestId = Context.Reference<string | null>(
  "@house-rules/capability/CallRequestId",
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

export const unknownCallFacts = (contract: AnyContract): CallFacts => ({
  kind: contract.annotations.readOnly ? "read" : "write",
  targetId: null,
  channel: "unknown",
  requestId: null,
});

const targetIdOf = (contract: AnyContract, input: unknown): string | null => {
  const field = contract.audit?.target;
  if (field === undefined || typeof input !== "object" || input === null) return null;
  if (!Object.hasOwn(input, field)) return null;
  const value: unknown = (input as Record<string, unknown>)[field];
  return typeof value === "string" ? value.slice(0, maxTargetIdLength) : null;
};

export const callFactsOf = (contract: AnyContract, input: unknown): Effect.Effect<CallFacts> =>
  Effect.gen(function* callFacts() {
    // The MCP server provides McpRequestContext to every tool call, so an MCP call wins over the app's channel.
    const mcp = yield* Effect.serviceOption(McpSchema.McpRequestContext);
    const channel = Option.isSome(mcp)
      ? mcpChannel(mcp.value.clientInfo?.name)
      : yield* CallChannel;
    return {
      kind: contract.annotations.readOnly ? "read" : "write",
      targetId: targetIdOf(contract, input),
      channel,
      requestId: yield* CallRequestId,
    };
  });
