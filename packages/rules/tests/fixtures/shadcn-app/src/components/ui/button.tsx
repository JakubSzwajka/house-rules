import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

const buttonVariants = cva("inline-flex items-center rounded-lg focus-visible:ring-[3px]", {
  variants: {
    variant: {
      default: "bg-primary text-primary-foreground",
      outline: "border bg-background",
    },
    size: {
      default: "h-9 px-4",
      sm: "h-8 px-3",
    },
  },
  defaultVariants: { variant: "default", size: "default" },
});

export function Button({
  className,
  variant,
  size,
  ...props
}: ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return <button className={buttonVariants({ variant, size, className })} {...props} />;
}
