import { CallWatch, type RecordSocket } from "@house-rules/application";
import { DateTime, Effect, Layer } from "effect";
import { postgresAuditStore } from "./adapters/postgres/postgres-audit-store.ts";
import { readRows } from "./adapters/postgres/read-rows.ts";
import { retentionLoop, runRetention } from "./retention/retention.ts";
import { logLine, makeWatch, policyRecorder, storeRecorder } from "./watch/watch.ts";
import { policy, presets } from "./policy/policy.ts";
import { memoryAuditReader } from "./adapters/memory/reader.ts";
import { postgresAuditReader } from "./adapters/postgres/reader.ts";
import { AuditStore } from "./storage.ts";
import type {
  AuditRecord,
  AuditRow,
  CallAuditLayerOptions,
  CallAuditOptions,
  CallAuditTableOptions,
} from "./audit/audit.ts";

export type MemoryAuditLog = Readonly<{
  entries: () => ReadonlyArray<AuditRecord>;
  rows: () => ReadonlyArray<AuditRow>;
  clear: () => void;
  record: (entry: AuditRecord) => Effect.Effect<void>;
}>;

export const memoryAuditLog = (): MemoryAuditLog => {
  const recorded: Array<AuditRecord> = [];
  const rows: Array<AuditRow> = [];
  return {
    entries: () => [...recorded],
    rows: () => [...rows],
    clear: () => {
      recorded.length = 0;
      rows.length = 0;
    },
    record: (entry) =>
      Effect.map(DateTime.now, (now) => {
        recorded.push(entry);
        rows.push({ ...entry, recordedAt: DateTime.toDateUtc(now) });
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

const layerMemory = (log: MemoryAuditLog, options: CallAuditOptions = nobody) =>
  Layer.succeed(CallWatch, makeWatch(options.who, log.record));

export const CallAudit = {
  reader: { memory: memoryAuditReader, postgres: postgresAuditReader },
  record: {
    memory: (log: MemoryAuditLog, options?: CallAuditOptions): RecordSocket => ({
      layer: layerMemory(log, options),
    }),
    postgres: (
      options: CallAuditLayerOptions,
    ): RecordSocket<never, Layer.Services<typeof postgresAuditStore>> => ({
      layer: layer(options).pipe(Layer.provide(postgresAuditStore)),
    }),
  },
  layer,
  layerPostgres: (options: CallAuditLayerOptions) =>
    layer(options).pipe(Layer.provideMerge(postgresAuditStore)),
  layerLog: (options: CallAuditOptions) =>
    Layer.succeed(CallWatch, makeWatch(options.who, logLine)),
  layerTable,
  layerMemory,
  readRows,
  erase: (viewerId: string) => AuditStore.use((store) => store.erase(viewerId)),
  runRetention,
  presets,
  policy,
} as const;
