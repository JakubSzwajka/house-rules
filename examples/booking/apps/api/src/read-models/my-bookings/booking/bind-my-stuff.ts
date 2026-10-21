import { bindOperation, type Binding } from "@house-rules/application";
import type { Actor } from "@house-rules/domain";
import { Effect } from "effect";
import { type MyBooking, type ReadUnavailable, ReadCallerDenied } from "./my-bookings.ts";
import { myBookingsNode } from "./operations.ts";

export const bindMyStuff = (service: {
  readonly myBookings: (actor: Actor) => Effect.Effect<readonly MyBooking[], ReadUnavailable>;
}): readonly Binding[] => [
  bindOperation(myBookingsNode, (_input, { caller }) =>
    caller.kind === "person"
      ? service.myBookings(caller.actor)
      : Effect.fail(new ReadCallerDenied()),
  ),
];
