import type { ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "./components/ui/button.tsx";
import { Badge } from "./components/ui/badge.tsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./components/ui/dialog.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./components/ui/table.tsx";
import { Tooltip } from "./components/ui/tooltip.tsx";
import { Skeleton } from "./components/ui/skeleton.tsx";
import type { RowAction } from "./dashboard.tsx";
export function GuardButton({
  reason,
  children,
  onClick,
  variant = "default",
}: {
  reason?: string | undefined;
  children: ReactNode;
  onClick: () => void;
  variant?: "default" | "outline";
}) {
  const button = (
    <Button variant={variant} disabled={!!reason} onClick={onClick}>
      {children}
    </Button>
  );
  return reason ? <Tooltip text={reason}>{button}</Tooltip> : button;
}
export function RowActions({ actions }: { actions: readonly RowAction[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Row actions">
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.map((action) => (
          <DropdownMenuItem
            key={action.label}
            aria-disabled={!!action.reason}
            className={action.destructive ? "text-destructive" : ""}
            onSelect={(event) => {
              if (action.reason) event.preventDefault();
              else action.onSelect();
            }}
          >
            {action.reason ? (
              <Tooltip text={action.reason}>
                <span className="opacity-50">{action.label}</span>
              </Tooltip>
            ) : (
              action.label
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
export function FormDialog({
  title,
  description,
  open,
  onOpenChange,
  children,
}: {
  title: string;
  description: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  render,
  empty,
  loading,
  error,
}: {
  columns: readonly string[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  render: (row: T) => ReactNode;
  empty: ReactNode;
  loading?: boolean;
  error?: string | undefined;
}) {
  if (loading)
    return (
      <div aria-label="Loading" className="space-y-3 rounded-xl border p-6">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  if (error)
    return (
      <p role="alert" className="rounded-xl border p-6 text-sm text-destructive">
        {error}
      </p>
    );
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((name) => (
              <TableHead key={name} className="bg-muted/40 px-5">
                {name}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={rowKey(row)}>{render(row)}</TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={columns.length}>
                <div className="grid justify-items-center gap-3 py-12 text-muted-foreground">
                  {empty}
                </div>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
export function ScopeBadges({
  items,
}: {
  items: readonly {
    roleKey: string;
    organisationId: string | null;
    roleName?: string;
    organisationName?: string | null;
  }[];
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item) => (
        <Badge key={`${item.roleKey}-${item.organisationId}`} variant="secondary">
          {item.roleName ?? item.roleKey} ·{" "}
          {item.organisationName ?? item.organisationId ?? "Global"}
        </Badge>
      ))}
      {items.length === 0 && (
        <span className="text-xs text-muted-foreground">No roles assigned</span>
      )}
    </div>
  );
}
export function PageHeading({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex gap-2">{children}</div>
    </div>
  );
}
