import { useEffect, useState } from "react";
import { Button } from "./components/ui/button.tsx";
import { Label } from "./components/ui/label.tsx";
import { mergeActivity, type Activity } from "./activity.ts";
import type { CallRow, Client } from "./session.ts";

export function AuditDock({
  client,
  personId,
  calls,
}: {
  client: Client;
  personId: string | undefined;
  calls: readonly CallRow[];
}) {
  const [open, setOpen] = useState(false);
  const [reads, setReads] = useState(false);
  const [audit, setAudit] = useState<{ personId: string; rows: Activity } | null>(null);
  const [problem, setProblem] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const latest = calls.find((c) => c.name !== "my_activity")?.requestId;
  useEffect(() => {
    if (!personId || !open) return;
    let cancelled = false;
    void client
      .myActivity({})
      .then((rows) => {
        if (!cancelled) {
          setAudit({ personId, rows });
          setProblem(false);
        }
      })
      .catch(() => {
        if (!cancelled) setProblem(true);
      });
    return () => {
      cancelled = true;
    };
  }, [client, personId, open, latest, refresh]);
  const rows = mergeActivity(
    calls,
    audit !== null && audit.personId === personId ? audit.rows : [],
  ).filter((row) => reads || !row.read);
  return (
    <section
      aria-label="Under the hood"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background shadow-lg md:left-72"
    >
      <div className="flex items-center gap-4 px-5 py-2">
        <Button
          variant="ghost"
          aria-expanded={open}
          aria-controls="audit-dock"
          onClick={() => setOpen(!open)}
        >
          Under the hood {open ? "▾" : "▴"}
        </Button>
        <span className="text-xs text-muted-foreground">
          {rows.length} calls · this tab + your audit
        </span>
        {open && (
          <>
            <Label className="ml-auto flex gap-2">
              <input
                type="checkbox"
                checked={reads}
                onChange={(event) => setReads(event.target.checked)}
              />
              Include reads
            </Label>
            <Button variant="outline" disabled={!personId} onClick={() => setRefresh((n) => n + 1)}>
              Refresh
            </Button>
          </>
        )}
      </div>
      {open && (
        <div id="audit-dock" className="max-h-80 overflow-auto border-t px-5 py-3">
          {!personId && (
            <p className="mb-2 text-xs text-muted-foreground">
              Sign in to include your server audit rows.
            </p>
          )}
          {problem && (
            <p className="mb-2 text-xs text-destructive">
              Could not load your audit. The tab log is still available.
            </p>
          )}
          <table className="w-full text-left text-xs">
            <thead>
              <tr>
                {["Feature", "Outcome", "HTTP", "ms", "Source", "Request id"].map((h) => (
                  <th className="p-2" key={h}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr className="border-t" key={`${row.requestId}-${index}`}>
                  <td className="p-2">{row.feature}</td>
                  <td className="p-2">{row.outcome}</td>
                  <td className="p-2">{row.http ?? ""}</td>
                  <td className="p-2">{Math.round(row.ms)}</td>
                  <td className="p-2">{row.source}</td>
                  <td className="p-2 font-mono">{row.requestId ?? "not returned"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <p className="p-2 text-xs text-muted-foreground">
              No calls. Enable reads to see read-only activity.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
