import { Avatar as Primitive } from "radix-ui";
export function Avatar({ name }: { name: string }) {
  return (
    <Primitive.Root className="relative flex size-9 shrink-0 overflow-hidden rounded-full border">
      <Primitive.Fallback className="flex size-full items-center justify-center bg-muted text-xs font-semibold">
        {name
          .split(/\s+/u)
          .map((part) => part[0])
          .slice(0, 2)
          .join("")
          .toUpperCase()}
      </Primitive.Fallback>
    </Primitive.Root>
  );
}
