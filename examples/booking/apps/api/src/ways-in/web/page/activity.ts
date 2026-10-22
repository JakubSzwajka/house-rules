import { api } from "../endpoints.ts";
import type { CallRow, Client } from "./session.ts";
export type Activity = Awaited<ReturnType<Client["myActivity"]>>;
export type DockRow = {
  feature: string;
  requestId: string | null;
  outcome: string;
  http: number | null;
  ms: number;
  read: boolean;
  source: string;
};
const reads = new Set<string>(
  Object.values(api.endpoints)
    .filter((e) => e.feature.readOnly)
    .map((e) => e.feature.name),
);
export const mergeActivity = (calls: readonly CallRow[], audit: Activity): readonly DockRow[] => {
  const byId = new Map(audit.filter((a) => a.requestId !== null).map((a) => [a.requestId, a]));
  const seen = new Set(calls.map((c) => c.requestId));
  return [
    ...calls.map((c) => ({
      feature: c.name,
      requestId: c.requestId ?? null,
      outcome: byId.get(c.requestId ?? "")?.outcome ?? c.message,
      http: c.status,
      ms: c.ms,
      read: reads.has(c.name),
      source: byId.has(c.requestId ?? "") ? "tab + audit" : "tab",
    })),
    ...audit
      .filter((a) => a.requestId === null || !seen.has(a.requestId))
      .map((a) => ({
        feature: a.feature,
        requestId: a.requestId,
        outcome: a.outcome,
        http: null,
        ms: a.ms,
        read: a.kind === "read",
        source: "audit",
      })),
  ];
};
