import { CallWatch } from "@house-rules/capability";
import { Effect, Layer } from "effect";
import { SqlClient } from "effect/unstable/sql/SqlClient";
import { readRows } from "./internal/read-rows.ts";
import { makeWatch } from "./internal/watch.ts";
import type { AuditEntry } from "./types.ts";

export type CallAuditOptions = Readonly<{
  who: Effect.Effect<string | null>;
}>;

export type CallAuditTableOptions = CallAuditOptions &
  Readonly<{
    log?: boolean;
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

const logLine = (entry: AuditEntry) => Effect.logInfo(`capability call ${JSON.stringify(entry)}`);

export const CallAudit = {
  layerLog: (options: CallAuditOptions) =>
    Layer.succeed(CallWatch, makeWatch(options.who, logLine)),
  layerTable: (options: CallAuditTableOptions) =>
    Layer.effect(
      CallWatch,
      Effect.gen(function* tableWatch() {
        const sql = yield* SqlClient;
        const insertRow = (entry: AuditEntry) =>
          sql`insert into call_audit (capability, permission, viewer_id, outcome, ms)
            values (${entry.capability}, ${entry.permission}, ${entry.viewerId}, ${entry.outcome}, ${Math.round(entry.ms)})`;
        return makeWatch(options.who, (entry) =>
          Effect.all(
            [
              // Each write is sandboxed on its own, so a broken table still leaves the log line.
              options.log === true ? Effect.ignoreCause(logLine(entry)) : Effect.void,
              Effect.ignoreCause(insertRow(entry)),
            ],
            { discard: true },
          ),
        );
      }),
    ),
  readRows,
  layerMemory: (log: MemoryAuditLog, options: CallAuditOptions = nobody) =>
    Layer.succeed(CallWatch, makeWatch(options.who, log.record)),
} as const;
