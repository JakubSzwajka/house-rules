import { Effect, Layer } from "effect";
import { AuditReader } from "../../audit/reader.ts";
import { clampLimit } from "../../audit/limits.ts";
import type { AuditRow, ReadRowsOptions } from "../../audit/audit.ts";
export const memoryAuditReader = (log: { readonly rows: () => readonly AuditRow[] }) =>
  Layer.succeed(AuditReader, {
    readRows: (options: ReadRowsOptions = {}) =>
      Effect.sync(() =>
        log
          .rows()
          .filter((row) => options.viewerId === undefined || row.viewerId === options.viewerId)
          .slice()
          .reverse()
          .slice(0, clampLimit(options.limit)),
      ),
  });
