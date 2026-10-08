import type { AuditClass } from "../types.ts";

export const defaultLimit = 100;
export const maxLimit = 1000;

export const clampLimit = (limit: number | undefined): number => {
  if (limit === undefined || Number.isNaN(limit)) return defaultLimit;
  return Math.min(maxLimit, Math.max(1, Math.floor(limit)));
};

export const auditClasses = ["read", "write", "failure"] as const;

export const noneDeleted: Readonly<Record<AuditClass, number>> = { read: 0, write: 0, failure: 0 };

export const clampBatchSize = (batchSize: number): number =>
  Number.isFinite(batchSize) ? Math.max(1, Math.floor(batchSize)) : 1000;
