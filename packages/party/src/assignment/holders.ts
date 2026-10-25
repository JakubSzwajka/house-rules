import { Effect } from "effect";
import type { PartyStore } from "../storage.js";

export const makeHolders = (store: PartyStore["Service"], limit: number) => ({
  holdersOf: Effect.fn("Party.holdersOf")(function* (input: {
    readonly role: string;
    readonly scope?: string | null;
  }) {
    const ids = yield* store.holderIds(input.role, input.scope ?? null, limit + 1);
    return { ids: ids.slice(0, limit), truncated: ids.length > limit };
  }),
});
