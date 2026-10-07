export type AuditEntry = Readonly<{
  capability: string;
  permission: string;
  viewerId: string | null;
  outcome: string;
  ms: number;
}>;
