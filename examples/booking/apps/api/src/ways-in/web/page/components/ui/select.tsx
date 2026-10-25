import { Select as Primitive } from "radix-ui";
import { Check, ChevronDown } from "lucide-react";
export function Select({
  name,
  value,
  onValueChange,
  options,
  placeholder = "Choose…",
  required = false,
}: {
  name?: string;
  value: string;
  onValueChange: (value: string) => void;
  options: readonly { value: string; label: string; disabled?: boolean }[];
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <Primitive.Root name={name} value={value} onValueChange={onValueChange} required={required}>
      <Primitive.Trigger
        aria-label={name ?? placeholder}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-background px-3 text-sm shadow-xs"
      >
        <Primitive.Value placeholder={placeholder} />
        <ChevronDown className="size-4 opacity-50" />
      </Primitive.Trigger>
      <Primitive.Portal>
        <Primitive.Content
          position="popper"
          sideOffset={4}
          className="z-[60] max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-auto rounded-md border bg-popover p-1 shadow-md"
        >
          <Primitive.Viewport>
            {options.map((option) => (
              <Primitive.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className="relative cursor-default rounded-sm py-2 pr-8 pl-2 text-sm outline-none focus:bg-accent data-[disabled]:opacity-40"
              >
                <Primitive.ItemText>{option.label}</Primitive.ItemText>
                <Primitive.ItemIndicator className="absolute right-2 top-2">
                  <Check className="size-4" />
                </Primitive.ItemIndicator>
              </Primitive.Item>
            ))}
          </Primitive.Viewport>
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
