import type { ComponentProps } from "react";

export function NativeSelect(props: ComponentProps<"select">) {
  return <select {...props} />;
}
