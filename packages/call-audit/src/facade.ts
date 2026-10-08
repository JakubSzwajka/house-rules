import { CallWatch } from "@house-rules/capability";
import { Effect, Layer } from "effect";
import { postgresAuditStore } from "./adapters/postgres/postgres-audit-store.ts";
import { readRows } from "./adapters/postgres/read-rows.ts";
import { retentionLoop, runRetention } from "./internal/retention.ts";
import { logLine, makeWatch, policyRecorder, storeRecorder } from "./internal/watch.ts";
import { policy, presets } from "./policy.ts";
import { AuditStore } from "./storage.ts";
import type {
  AuditEntry,
  CallAuditLayerOptions,
  CallAuditOptions,
  CallAuditTableOptions,
} from "./types.ts";

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

const layer = (options: CallAuditLayerOptions) =>
  Layer.effect(
    CallWatch,
    Effect.gen(function* policyWatch() {
      const store = yield* AuditStore;
      yield* retentionLoop(options.policy, options.retention).pipe(
        Effect.provideService(AuditStore, store),
        Effect.forkScoped,
      );
      return makeWatch(
        options.who,
        policyRecorder(
          options.policy,
          storeRecorder(store, options.policy.onWriteFailure),
          options.log === true,
        ),
      );
    }),
  );

const layerTable = (options: CallAuditTableOptions) =>
  Layer.effect(
    CallWatch,
    Effect.gen(function* tableWatch() {
      const store = yield* AuditStore;
      return makeWatch(
        options.who,
        policyRecorder(
          { ...presets.strict, onWriteFailure: "ignore" },
          storeRecorder(store, "ignore"),
          options.log === true,
        ),
      );
    }),
  ).pipe(Layer.provide(postgresAuditStore));

export const CallAudit = {
  layer,
  layerPostgres: (options: CallAuditLayerOptions) =>
    layer(options).pipe(Layer.provideMerge(postgresAuditStore)),
  layerLog: (options: CallAuditOptions) =>
    Layer.succeed(CallWatch, makeWatch(options.who, logLine)),
  layerTable,
  layerMemory: (log: MemoryAuditLog, options: CallAuditOptions = nobody) =>
    Layer.succeed(CallWatch, makeWatch(options.who, log.record)),
  readRows,
  erase: (viewerId: string) => AuditStore.use((store) => store.erase(viewerId)),
  runRetention,
  presets,
  policy,
} as const;
