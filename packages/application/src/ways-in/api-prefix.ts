import { prefixOf } from "../contract/api.ts";
import type { Endpoint } from "../contract/endpoint.ts";

export const prefixMismatch = (
  endpoints: readonly Endpoint[],
  prefix: string,
): string | undefined => {
  for (const shape of endpoints) {
    const declared = prefixOf(shape);
    if (declared !== undefined && declared !== prefix)
      return `API prefix ${declared} does not match way prefix ${prefix}`;
  }
};
