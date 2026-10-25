import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Terminal } from "lucide-react";
import { Button } from "./components/ui/button.tsx";
import { Badge } from "./components/ui/badge.tsx";
import { Label } from "./components/ui/label.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./components/ui/table.tsx";
import { CopyButton } from "./copy-button.tsx";
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
  const latest = calls.find((call) => call.name !== "my_activity")?.requestId;
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
  }, [client, personId, open, latest]);
  const rows = mergeActivity(
    calls,
    audit !== null && audit.personId === personId ? audit.rows : [],
  ).filter((row) => reads || !row.read);
  return (
    <section
      aria-label="Under the hood"
      className={`fixed inset-x-0 bottom-0 z-40 border-t bg-background shadow-lg ${personId ? "md:left-64" : ""}`}
    >
      <div className="flex items-center gap-3 px-5 py-2">
        <Button
          variant="ghost"
          aria-expanded={open}
          aria-controls="audit-dock"
          onClick={() => setOpen(!open)}
        >
          <Terminal className="size-4" />
          Under the hood
          {open ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
        </Button>
        <span className="text-xs text-muted-foreground">{rows.length} calls</span>
        {open && (
          <Label className="ml-auto flex gap-2 text-xs">
            <input
              type="checkbox"
              checked={reads}
              onChange={(event) => setReads(event.target.checked)}
            />
            Include reads
          </Label>
        )}
      </div>
      {open && (
        <div id="audit-dock" className="max-h-80 overflow-auto border-t px-5 py-3">
          {problem && (
            <p role="alert" className="mb-2 text-xs text-destructive">
              Your audit is unavailable. Calls from this tab are still shown.
            </p>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                {["Feature / detail", "Outcome", "HTTP", "Duration", "Source", "Request id"].map(
                  (heading) => (
                    <TableHead key={heading}>{heading}</TableHead>
                  ),
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, index) => (
                <TableRow key={`${row.requestId}-${index}`}>
                  <TableCell>
                    <details>
                      <summary className="cursor-pointer font-mono text-xs">{row.feature}</summary>
                      <div className="py-3 text-xs">
                        <p>
                          {row.outcome} · {Math.round(row.ms)} ms · {row.source}
                        </p>
                        <details className="mt-2">
                          <summary className="cursor-pointer text-muted-foreground">Raw</summary>
                          <pre className="mt-2 max-w-xl overflow-auto rounded bg-muted p-3">
                            {JSON.stringify(row, null, 2)}
                          </pre>
                        </details>
                      </div>
                    </details>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        row.outcome === "success" ||
                        row.outcome === "OK" ||
                        row.outcome.endsWith("completed.")
                          ? "secondary"
                          : "destructive"
                      }
                    >
                      {row.outcome}
                    </Badge>
                  </TableCell>
                  <TableCell>{row.http ?? "Not supplied"}</TableCell>
                  <TableCell>{Math.round(row.ms)} ms</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{row.source}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 font-mono text-xs">
                      {row.requestId?.slice(0, 12) ?? "Not returned"}
                      {row.requestId && <CopyButton value={row.requestId} />}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {rows.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No activity yet. Try making a booking, or include read calls.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
