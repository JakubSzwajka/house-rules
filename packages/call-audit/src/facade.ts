import { CallWatch } from "@house-rules/capability";
import { Effect, Layer } from "effect";
import { makeWatch } from "./internal/watch.ts";
import type { AuditEntry } from "./types.ts";

export type CallAuditOptions = Readonly<{
  who: Effect.Effect<string | null>;
}>;

export type MemoryAuditLog = Readonly<{
  entries: () => ReadonlyArray<AuditEntry>;
  clear: () => void;
  record: (entry: AuditEntry) => Effect.Effect<void>;
}>;

export const memoryAuditLog = (): MemoryAuditLog => {
  const recorded: Array<AuditEntry> = [];
  return {
    entries: () => [...recorded],
    clear: () => {
      recorded.length = 0;
    },
    record: (entry) =>
      Effect.sync(() => {
        recorded.push(entry);
      }),
  };
};

const nobody: CallAuditOptions = { who: Effect.succeed(null) };

export const CallAudit = {
  layerLog: (options: CallAuditOptions) =>
    Layer.succeed(
      CallWatch,
      makeWatch(options.who, (entry) => Effect.logInfo(`capability call ${JSON.stringify(entry)}`)),
    ),
  layerMemory: (log: MemoryAuditLog, options: CallAuditOptions = nobody) =>
    Layer.succeed(CallWatch, makeWatch(options.who, log.record)),
} as const;
