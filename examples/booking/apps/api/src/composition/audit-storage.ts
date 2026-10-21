import type { MemoryAuditLog } from "@house-rules/call-audit";
import { Context } from "effect";
import type { SqlClient } from "effect/sql/SqlClient";

export class AuditStorage extends Context.Service<
  AuditStorage,
  | { readonly kind: "memory"; readonly log: MemoryAuditLog }
  | { readonly kind: "postgres"; readonly client: SqlClient }
>()("@example/api/AuditStorage") {}
