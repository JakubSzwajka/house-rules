import type { CallRow } from "./session.ts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./components/ui/card.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./components/ui/table.tsx";
export function CallLog({ rows }: { rows: readonly CallRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Calls in this tab</CardTitle>
        <CardDescription>
          Passwords and session tokens are never logged. Reloading clears this log.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {["Feature", "HTTP", "Code", "Message", "Request id"].map((heading) => (
                <TableHead key={heading}>{heading}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => (
              <TableRow key={`${row.requestId}-${index}`}>
                <TableCell>{row.name}</TableCell>
                <TableCell>{row.status}</TableCell>
                <TableCell>{row.code ?? "OK"}</TableCell>
                <TableCell>{row.message}</TableCell>
                <TableCell className="font-mono text-xs">
                  {row.requestId ?? "not returned"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
