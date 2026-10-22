import { useState } from "react";
import { useDashboard, useResource } from "./dashboard.tsx";
import { DataTable, PageHeading } from "./screen-kit.tsx";
import { TableCell } from "./components/ui/table.tsx";
import { Badge } from "./components/ui/badge.tsx";
import { Select } from "./components/ui/select.tsx";
import { Tooltip } from "./components/ui/tooltip.tsx";
import { CopyButton } from "./copy-button.tsx";
export function relativeTime(at: number) {
  const minutes = Math.max(
    0,
    Math.floor((performance.timeOrigin + performance.now() - at) / 60000),
  );
  return minutes === 0
    ? "Just now"
    : minutes < 60
      ? `${minutes}m ago`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)}h ago`
        : `${Math.floor(minutes / 1440)}d ago`;
}
export function AuditPanel() {
  const { client, epoch, profile } = useDashboard();
  const audit = useResource(() => client.recentAudit({}), [client, epoch]);
  const people = useResource(
    () =>
      profile.access.permissions.includes("party:admin")
        ? client.listPeople({})
        : Promise.resolve([]),
    [client, epoch],
  );
  const [outcome, setOutcome] = useState("all");
  const [feature, setFeature] = useState("all");
  const rows = (audit.data ?? []).filter(
    (row) =>
      (outcome === "all" ||
        (outcome === "success" ? row.outcome === "success" : row.outcome !== "success")) &&
      (feature === "all" || row.feature === feature),
  );
  return (
    <>
      <PageHeading
        title="Audit"
        description="The latest 50 feature calls, including refused requests."
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="w-44">
          <Select
            name="Outcome"
            value={outcome}
            onValueChange={setOutcome}
            options={[
              { value: "all", label: "All outcomes" },
              { value: "success", label: "Success" },
              { value: "failure", label: "Refusals / failures" },
            ]}
          />
        </div>
        <div className="min-w-48">
          <Select
            name="Feature"
            value={feature}
            onValueChange={setFeature}
            options={[
              { value: "all", label: "All features" },
              ...[...new Set(audit.data?.map((row) => row.feature))].map((name) => ({
                value: name,
                label: name,
              })),
            ]}
          />
        </div>
      </div>
      <DataTable
        columns={["Time", "Who", "Feature", "Outcome", "Request id"]}
        rows={rows}
        loading={audit.loading}
        error={audit.error}
        rowKey={(row) => `${row.requestId}-${row.feature}`}
        empty={<p>No calls match these filters. Choose all outcomes to see more.</p>}
        render={(row) => (
          <>
            <TableCell className="px-5">
              <Tooltip
                text={new Intl.DateTimeFormat(undefined, {
                  dateStyle: "medium",
                  timeStyle: "medium",
                }).format(row.at)}
              >
                <span>{relativeTime(row.at)}</span>
              </Tooltip>
            </TableCell>
            <TableCell>
              {people.data?.find((person) => person.id === row.who)?.displayName ??
                row.who?.slice(0, 12) ??
                "System / anonymous"}
            </TableCell>
            <TableCell className="font-mono text-xs">{row.feature}</TableCell>
            <TableCell>
              <Badge variant={row.outcome === "success" ? "secondary" : "destructive"}>
                {row.outcome}
              </Badge>
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-1 font-mono text-xs">
                {row.requestId?.slice(0, 16) ?? "Not returned"}
                {row.requestId && <CopyButton value={row.requestId} />}
              </div>
            </TableCell>
          </>
        )}
      />
    </>
  );
}
