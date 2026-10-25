import type { ReactNode } from "react";
import { Tooltip as Primitive } from "radix-ui";
export const TooltipProvider = Primitive.Provider;
export function Tooltip({ children, text }: { children: ReactNode; text: string }) {
  return (
    <Primitive.Root>
      <Primitive.Trigger asChild>
        <span tabIndex={0} className="inline-flex">
          {children}
        </span>
      </Primitive.Trigger>
      <Primitive.Portal>
        <Primitive.Content
          sideOffset={5}
          className="z-[70] max-w-xs rounded-md bg-primary px-3 py-2 text-xs text-primary-foreground shadow-md"
        >
          {text}
          <Primitive.Arrow className="fill-primary" />
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
