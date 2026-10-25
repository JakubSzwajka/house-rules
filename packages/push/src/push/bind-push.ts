import { type Binding, bindOperation } from "@house-rules/application";
import { Effect } from "effect";
import type { makePush } from "./push-service.js";
import { PushCallerDenied, PushSubscriptionNotFound } from "./push.js";
import { PushOperations } from "./operations.js";
const subscriptionHidden = () =>
  Effect.fail(new PushSubscriptionNotFound({ message: "Push subscription not found." }));
export const bindPush = (service: ReturnType<typeof makePush>): readonly Binding[] => [
  bindOperation(PushOperations.subscribe, (input, { caller }) =>
    caller.kind === "person" ? service.subscribe(caller.actor, input) : subscriptionHidden(),
  ),
  bindOperation(PushOperations.unsubscribe, ({ endpoint }, { caller }) =>
    caller.kind === "person" ? service.unsubscribe(caller.actor, endpoint) : subscriptionHidden(),
  ),
  bindOperation(PushOperations.listMine, (_, { caller }) =>
    caller.kind === "person" ? service.listMine(caller.actor) : Effect.succeed([]),
  ),
  bindOperation(PushOperations.isSubscribed, ({ endpoint }, { caller }) =>
    caller.kind === "person" ? service.isSubscribed(caller.actor, endpoint) : Effect.succeed(false),
  ),
  bindOperation(PushOperations.subscriptionsFor, ({ owner }) => service.subscriptionsFor(owner)),
  bindOperation(PushOperations.forgetExpired, ({ endpoint }) => service.forgetExpired(endpoint)),
  bindOperation(PushOperations.deliver, ({ owner, payload, idempotencyKey, ttl }, { caller }) =>
    caller.kind === "system"
      ? service.deliver(owner, payload, idempotencyKey, ttl)
      : Effect.fail(new PushCallerDenied()),
  ),
];
