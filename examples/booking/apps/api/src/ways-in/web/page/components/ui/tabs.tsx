import type { ComponentProps } from "react";
import { Tabs as Primitive } from "radix-ui";
import { cn } from "../class-names.ts";
export const Tabs = Primitive.Root;
export const TabsContent = Primitive.Content;
export function TabsList({ className, ...props }: ComponentProps<typeof Primitive.List>) {
  return (
    <Primitive.List
      className={cn(
        "mb-6 inline-flex h-10 items-center gap-1 rounded-lg bg-muted p-1 text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
export function TabsTrigger({ className, ...props }: ComponentProps<typeof Primitive.Trigger>) {
  return (
    <Primitive.Trigger
      className={cn(
        "rounded-md px-4 py-1.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
        className,
      )}
      {...props}
    />
  );
}
