import { Effect, Layer } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { AuditReader } from "../../audit/reader.ts";
import type { ReadRowsOptions } from "../../audit/audit.ts";
import { readRows } from "./read-rows.ts";
export const postgresAuditReader = Layer.effect(
  AuditReader,
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    return {
      readRows: (options?: ReadRowsOptions) =>
        readRows(options).pipe(Effect.provideService(SqlClient, sql)),
    };
  }),
);
