import { Toast as Primitive } from "radix-ui";
import { X } from "lucide-react";
import type { CallRow } from "../../session.ts";
import { CopyButton } from "../../copy-button.tsx";
export const ToastProvider = Primitive.Provider;
export function Toasts({
  rows,
  dismiss,
}: {
  rows: readonly (CallRow & { toastId: number })[];
  dismiss: (id: number) => void;
}) {
  return (
    <>
      {rows.map((row) => (
        <Primitive.Root
          key={row.toastId}
          duration={7000}
          onOpenChange={(open) => {
            if (!open) dismiss(row.toastId);
          }}
          className="relative grid w-full gap-2 rounded-lg border bg-background p-4 pr-9 shadow-xl data-[state=open]:animate-in data-[state=open]:slide-in-from-right"
        >
          <Primitive.Title
            className={
              row.status >= 400 || row.code === "InvalidCredentials"
                ? "text-sm font-semibold text-destructive"
                : "text-sm font-semibold"
            }
          >
            {row.status} · {row.code ?? "OK"}
          </Primitive.Title>
          <Primitive.Description className="text-sm">{row.message}</Primitive.Description>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="truncate">{row.requestId ?? "No request id returned"}</span>
            {row.requestId && <CopyButton value={row.requestId} />}
          </div>
          <Primitive.Close aria-label="Dismiss notification" className="absolute right-3 top-3">
            <X className="size-4" />
          </Primitive.Close>
        </Primitive.Root>
      ))}
      <Primitive.Viewport className="fixed bottom-16 right-4 z-[100] flex max-h-screen w-[min(380px,calc(100vw-2rem))] flex-col gap-2 outline-none" />
    </>
  );
}
