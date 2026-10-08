import { type CallKind, isMcpChannel } from "@house-rules/capability";
import { Duration } from "effect";
import type { AuditClass, AuditEntry, AuditPolicy } from "../audit/audit.ts";

export const classOf = (
  entry: Readonly<{ outcome: string; kind?: CallKind | null | undefined }>,
): AuditClass => {
  if (entry.outcome !== "success") return "failure";
  return entry.kind === "read" ? "read" : "write";
};

const ninetyDays = Duration.days(90);
const twelveMonths = Duration.days(365);

const minimal: AuditPolicy = {
  keep: (entry) => classOf(entry) !== "read",
  retention: { read: ninetyDays, write: ninetyDays, failure: ninetyDays },
  onWriteFailure: "ignore",
  erasure: "delete",
};

const agentAware: AuditPolicy = {
  keep: (entry) => classOf(entry) !== "read" || isMcpChannel(entry.channel ?? ""),
  retention: { read: twelveMonths, write: twelveMonths, failure: twelveMonths },
  onWriteFailure: "log",
  erasure: "delete",
};

const strict: AuditPolicy = {
  keep: () => true,
  retention: { read: twelveMonths, write: twelveMonths, failure: twelveMonths },
  onWriteFailure: "log",
  erasure: "delete",
};

export const presets = { minimal, agentAware, strict } as const;

export const policy = (overrides: Partial<AuditPolicy> = {}): AuditPolicy => ({
  ...minimal,
  ...overrides,
});
