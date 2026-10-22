import type { ComponentProps } from "react";
import { Dialog as Primitive } from "radix-ui";
import { X } from "lucide-react";
export const Sheet = Primitive.Root;
export const SheetTitle = Primitive.Title;
export const SheetDescription = Primitive.Description;
export function SheetContent({ children, ...props }: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Overlay className="fixed inset-0 z-50 bg-black/40" />
      <Primitive.Content
        className="fixed inset-y-0 right-0 z-50 w-full max-w-lg overflow-y-auto border-l bg-background p-6 shadow-xl"
        {...props}
      >
        <div className="grid gap-6 pt-6">{children}</div>
        <Primitive.Close
          className="absolute right-4 top-4 rounded p-1 hover:bg-muted"
          aria-label="Close"
        >
          <X className="size-4" />
        </Primitive.Close>
      </Primitive.Content>
    </Primitive.Portal>
  );
}
