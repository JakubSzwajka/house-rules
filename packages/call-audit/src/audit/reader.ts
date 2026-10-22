import { Context, type Effect } from "effect";
import type { AuditReadFailed, AuditRow, ReadRowsOptions } from "./audit.ts";
export class AuditReader extends Context.Service<
  AuditReader,
  {
    readonly readRows: (
      options?: ReadRowsOptions,
    ) => Effect.Effect<readonly AuditRow[], AuditReadFailed>;
  }
>()("@house-rules/call-audit/AuditReader") {}
